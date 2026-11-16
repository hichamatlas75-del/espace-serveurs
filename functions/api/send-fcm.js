/**
 * ============================================================================
 * GREY CORNER — CLOUDFLARE DISPATCHER : FCM HTTP v1 DISPATCHER
 * Compatible à la fois avec :
 *   1. Cloudflare Pages Functions (Route: POST /api/send-fcm)
 *   2. Cloudflare Worker autonome (greycorner-fcm)
 * ============================================================================
 * Envoie des notifications Push vers l'API Google Firebase Cloud Messaging v1
 * aux smartphones des serveurs même si l'application est totalement FERMÉE.
 */

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// Helper : Convertit une clé PEM RSA en ArrayBuffer pour Web Crypto
function pemToArrayBuffer(pem) {
    if (!pem) throw new Error("Clé privée PEM vide ou manquante.");
    const cleanPem = pem
        .replace(/\\n/g, "\n")
        .replace(/-----BEGIN[ A-Z_-]+-----/g, "")
        .replace(/-----END[ A-Z_-]+-----/g, "")
        .replace(/\s+/g, "");
    const binary = atob(cleanPem);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        buffer[i] = binary.charCodeAt(i);
    }
    return buffer.buffer;
}

// Helper : Base64URL encoder
function base64UrlEncode(str) {
    const b64 = typeof str === "string" ? btoa(str) : btoa(String.fromCharCode(...new Uint8Array(str)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Résout le compte de service Firebase depuis les variables d'environnement Cloudflare
function resolveServiceAccount(env) {
    if (!env) return null;

    // Format 1 : FIREBASE_SERVICE_ACCOUNT (JSON complet)
    if (env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            return typeof env.FIREBASE_SERVICE_ACCOUNT === "string"
                ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)
                : env.FIREBASE_SERVICE_ACCOUNT;
        } catch (e) {
            console.warn("⚠️ Erreur de parsing de FIREBASE_SERVICE_ACCOUNT:", e);
        }
    }

    // Format 2 : Variables séparées (comme configuré dans le Cloudflare Worker greycorner-fcm)
    const privateKey = env.FIREBASE_PRIVATE_KEY || env.FIRBASE_PRIVATE_KEY;
    const clientEmail = env.FIREBASE_CLIENT_EMAIL;
    const projectId = env.FIREBASE_PROJECT_ID || "grey-corner-restaurant";

    if (privateKey && clientEmail) {
        return {
            project_id: projectId,
            client_email: clientEmail,
            private_key: privateKey.replace(/\\n/g, "\n")
        };
    }

    return null;
}

// Génère un jeton Google OAuth2 Bearer via l'API Web Crypto (RS256)
async function getGoogleOAuth2Token(serviceAccount) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const claimSet = {
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedClaim = base64UrlEncode(JSON.stringify(claimSet));
    const unsignedToken = `${encodedHeader}.${encodedClaim}`;

    const keyBuffer = pemToArrayBuffer(serviceAccount.private_key);
    const cryptoKey = await crypto.subtle.importKey(
        "pkcs8",
        keyBuffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        cryptoKey,
        new TextEncoder().encode(unsignedToken)
    );

    const jwt = `${unsignedToken}.${base64UrlEncode(signature)}`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: jwt
        })
    });

    if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        throw new Error(`Google OAuth2 error (${tokenRes.status}): ${errText}`);
    }

    const tokenData = await tokenRes.json();
    return tokenData.access_token;
}

// Récupère les tokens FCM enregistrés dans Firestore via l'API REST
async function getActiveWaiterTokens(projectId, accessToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/waiter_fcm_tokens`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
        console.warn(`Firestore tokens read status: ${res.status}`);
        return [];
    }

    const data = await res.json();
    if (!data.documents || !Array.isArray(data.documents)) return [];

    const tokens = [];
    data.documents.forEach((doc) => {
        const fields = doc.fields || {};
        const isActive = fields.active ? fields.active.booleanValue : true;
        const token = fields.token ? fields.token.stringValue : null;
        const platform = fields.platform ? fields.platform.stringValue : "";
        const userAgent = fields.userAgent ? fields.userAgent.stringValue : "";
        if (isActive && token) {
            tokens.push({ token, name: doc.name, platform, userAgent });
        }
    });

    return tokens;
}

// Cœur du traitement de la requête FCM
async function handleFcmRequest(request, env) {
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
        const payload = await request.json();
        const { type, title, body, tableId, docId } = payload;

        const serviceAccount = resolveServiceAccount(env);

        if (!serviceAccount) {
            console.warn("⚠️ Clés Firebase introuvables dans l'environnement Cloudflare.");
            return new Response(JSON.stringify({
                status: "skipped",
                message: "Identifiants Firebase non configurés dans Cloudflare (FIREBASE_PRIVATE_KEY ou FIREBASE_SERVICE_ACCOUNT manquant)."
            }), {
                status: 200,
                headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
            });
        }

        const projectId = serviceAccount.project_id || "grey-corner-restaurant";
        const accessToken = await getGoogleOAuth2Token(serviceAccount);
        const waiterTokens = await getActiveWaiterTokens(projectId, accessToken);

        const isOrder = String(type || "").toLowerCase().includes("order");
        const defaultTitle = isOrder
            ? `👨‍🍳 Nouvelle Commande — Table ${tableId}`
            : `🔔 Appel Serveur — Table ${tableId}`;
        const finalTitle = title || defaultTitle;
        const finalBody = body || (isOrder ? "Nouvelle commande en attente de validation" : `Table ${tableId} sollicite le service.`);

        // Construire la liste des cibles : tokens enregistrés + diffusion de secours sur le topic "waiters"
        const targets = [];
        const seenTokens = new Set();

        waiterTokens.forEach((t) => {
            if (t.token && !seenTokens.has(t.token)) {
                seenTokens.add(t.token);
                targets.push({
                    type: "token",
                    value: t.token,
                    platform: t.platform,
                    userAgent: t.userAgent
                });
            }
        });

        // Diffusion automatique sur le topic "waiters" pour réveiller les APKs natives abonnées
        targets.push({
            type: "topic",
            value: "waiters",
            platform: "android_native",
            userAgent: "GreyCornerWaiterApp"
        });

        const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

        const results = await Promise.all(
            targets.map(async (target) => {
                const isNativeAndroid = (target.platform === "android_native")
                    || (target.userAgent && target.userAgent.includes("GreyCornerWaiterApp"))
                    || (target.type === "topic");

                // Payload FCM v1 structuré pour réveiller l'écran et déclencher l'alarme de l'APK
                const messageObj = {
                    data: {
                        title: String(finalTitle),
                        body: String(finalBody),
                        type: String(type || "call"),
                        table: String(tableId || ""),
                        tableId: String(tableId || ""),
                        docId: String(docId || ""),
                        orderId: String(docId || ""),
                        callId: String(docId || ""),
                        url: "/waiter.html"
                    },
                    android: {
                        priority: "high",
                        ttl: "0s"
                    },
                    webpush: {
                        headers: {
                            Urgency: "high"
                        },
                        notification: {
                            title: String(finalTitle),
                            body: String(finalBody),
                            icon: "/images/android-chrome-192x192.png",
                            badge: "/images/android-chrome-192x192.png",
                            vibrate: [500, 200, 500, 200, 1000],
                            tag: `waiter-${type}-${tableId || Date.now()}`,
                            renotify: true,
                            requireInteraction: true
                        }
                    }
                };

                if (target.type === "topic") {
                    messageObj.topic = target.value;
                } else {
                    messageObj.token = target.value;
                }

                // Pour les navigateurs Web classiques, on ajoute la racine notification pour assurer l'affichage.
                // Pour l'APK Android (native ou topic), on NE MET PAS de racine notification afin d'empêcher
                // Google Play Services d'intercepter le message et permettre à onMessageReceived() d'allumer l'écran.
                if (!isNativeAndroid) {
                    messageObj.notification = {
                        title: String(finalTitle),
                        body: String(finalBody)
                    };
                }

                try {
                    const pushRes = await fetch(fcmUrl, {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ message: messageObj })
                    });
                    return pushRes.ok;
                } catch (pushErr) {
                    console.error("Erreur envoi FCM pour cible:", target.value, pushErr);
                    return false;
                }
            })
        );

        const successCount = results.filter(Boolean).length;

        return new Response(JSON.stringify({
            status: "success",
            sent: successCount,
            total: targets.length
        }), {
            status: 200,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
    } catch (err) {
        console.error("❌ Erreur traitement FCM:", err);
        return new Response(JSON.stringify({ error: err.message || String(err) }), {
            status: 500,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
    }
}

// ── EXPORTS POUR CLOUDFLARE PAGES FUNCTIONS (/api/send-fcm) ──────────────────
export async function onRequestPost(context) {
    return handleFcmRequest(context.request, context.env);
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ── EXPORT POUR CLOUDFLARE WORKER AUTONOME (greycorner-fcm) ──────────────────
export default {
    async fetch(request, env, ctx) {
        return handleFcmRequest(request, env);
    }
};
