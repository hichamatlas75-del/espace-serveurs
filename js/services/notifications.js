/**
 * GREY CORNER — NOTIFICATIONS & WAITER CALLS SERVICE (ES Module)
 */

import { currentLang } from './i18n.js';
import { showToast } from './cart.js';
import { dbService } from '../config/firebase.js';
import { showTableSelectorModal, setPendingActionAfterTableSelect } from '../ui/modals.js';
import { playServiceCallSound } from './sound.js';

export let memoryNotifications = [];
const cooldowns = {};
let unsubscribersList = [];
const notifiedCallIds = new Set();
const notifiedOrderIds = new Set();

export function checkCallCooldown(type) {
  const lastTime = cooldowns[type] || 0;
  const elapsed = (Date.now() - lastTime) / 1000;
  if (elapsed < 60) {
    return Math.ceil(60 - elapsed);
  }
  return 0;
}

export function setCallCooldown(type) {
  cooldowns[type] = Date.now();
}

export function triggerQuickServiceCall(clientTable, type) {
  if (!clientTable) {
    const tableMsgs = {
      fr: "Veuillez choisir votre numéro de table.",
      en: "Please select your table number.",
      de: "Bitte wählen Sie Ihre Tischnummer.",
      es: "Por favor, elija su número de mesa.",
      ar: "يرجى اختيار رقم طاولتك."
    };
    showToast(tableMsgs[currentLang] || tableMsgs.fr);
    setPendingActionAfterTableSelect((selectedTable) => triggerQuickServiceCall(selectedTable, type));
    showTableSelectorModal();
    return;
  }

  const waitRemaining = checkCallCooldown(type);
  if (waitRemaining > 0) {
    const errorMsgs = {
      fr: `Veuillez attendre ${waitRemaining}s avant de renouveler cet appel.`,
      en: `Please wait ${waitRemaining}s before repeating this request.`,
      de: `Bitte warten Sie ${waitRemaining}s, bevor Sie diese Anfrage wiederholen.`,
      es: `Por favor, espere ${waitRemaining}s antes de repetir esta llamada.`,
      ar: `يرجى الانتظار ${waitRemaining} ثانية قبل تكرار هذا الطلب.`
    };
    showToast(errorMsgs[currentLang] || errorMsgs.fr);
    return;
  }

  const btnId = type === "waiter" ? "cabCallWaiter" : (type === "water" ? "cabRequestWater" : "cabRequestBill");
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.add("active");

  dbService.sendCall(clientTable, type, (success, callId) => {
    if (btn) btn.classList.remove("active");

    if (success) {
      playServiceCallSound();
      setCallCooldown(type);

      const okMsgs = {
        fr: "Appel envoyé ! Votre serveur a été alerté.",
        en: "Call sent! Your waiter has been alerted.",
        de: "Anruf gesendet! Ihr Kellner wurde benachrichtigt.",
        es: "¡Llamada enviada! Su camarero ha sido avisado.",
        ar: "تم إرسال الطلب ! تم إشعار نادلك."
      };
      showToast(okMsgs[currentLang] || okMsgs.fr);
      if (callId) {
        try {
          localStorage.setItem(`last_call_${type}`, String(callId));
          localStorage.setItem(`last_call_${type}_time`, String(Date.now()));
        } catch (e) {}
        listenToClientCall(callId, type, clientTable);
      }
    } else {
      showToast("Erreur de connexion. Veuillez réessayer.");
    }
  });
}

export function triggerHapticVibrate() {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate([200, 100, 200, 100, 300]);
    } catch (e) {}
  }
}

let chimeAudio = null;
let audioCtx = null;

function getChimeAudio() {
  if (!chimeAudio) {
    chimeAudio = new Audio("https://assets.mixkit.co/active_storage/sfx/911/911-200.wav");
    chimeAudio.volume = 0.55;
  }
  return chimeAudio;
}

function getAudioContext() {
  if (!audioCtx && typeof window !== "undefined") {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

if (typeof window !== "undefined") {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx) {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      }
    } catch (e) {}

    try {
      const audio = getChimeAudio();
      audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
      }).catch(() => {});
    } catch (e) {}

    document.removeEventListener("touchstart", unlockAudio);
    document.removeEventListener("click", unlockAudio);
    document.removeEventListener("pointerdown", unlockAudio);
  };

  document.addEventListener("touchstart", unlockAudio, { once: true });
  document.addEventListener("click", unlockAudio, { once: true });
  document.addEventListener("pointerdown", unlockAudio, { once: true });
}

export function playChimeSound() {
  let playedWebAudio = false;

  try {
    const ctx = getAudioContext();
    if (ctx) {
      const now = ctx.currentTime;

      // Note 1 (E5 - 659.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.4, now);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.8);

      // Note 2 (B5 - 987.77 Hz, 140ms delay)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(987.77, now + 0.14);
      gain2.gain.setValueAtTime(0.5, now + 0.14);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.14);
      osc2.stop(now + 1.2);

      playedWebAudio = true;
    }
  } catch (e) {
    console.warn("⚠️ Web Audio chime error:", e);
  }

  // Fallback / secondary HTML5 Audio element
  if (!playedWebAudio) {
    try {
      const chime = getChimeAudio();
      chime.currentTime = 0;
      const promise = chime.play();
      if (promise !== undefined) {
        promise.catch(e => console.log("🔊 Audio autoplay status:", e));
      }
    } catch (e) {}
  }
}

export function addNotificationToHistory(message, tableId) {
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  memoryNotifications.push({
    id: Math.random().toString(36).substr(2, 9),
    time: timeStr,
    title: "Service Grey Corner",
    message: message,
    table: tableId
  });

  if (memoryNotifications.length > 25) {
    memoryNotifications.shift();
  }

  const callBadge = document.getElementById("cabCallBadge");
  if (callBadge) {
    callBadge.style.display = "block";
  }
  const bellBadge = document.getElementById("bellBadge");
  if (bellBadge) {
    bellBadge.style.display = "block";
  }
}

let activeClientCallUnsubs = new Map();
let activeClientOrderUnsubs = new Map();

export function listenToClientCall(callId, type, clientTable) {
  if (!callId) return;
  const key = String(callId);
  if (activeClientCallUnsubs.has(key)) return;

  const unsub = dbService.onSingleCallChange(callId, (c) => {
    if (!c || c.status !== "accepted") return;
    if (notifiedCallIds.has(String(c.id))) return;
    notifiedCallIds.add(String(c.id));

    try {
      localStorage.removeItem(`last_call_${c.type || type}`);
      localStorage.removeItem(`last_call_${c.type || type}_time`);
    } catch (e) {}

    const typeNames = {
      waiter: "Appel serveur",
      water: "Demande d'eau",
      bill: "Demande d'addition"
    };
    const typeLabel = typeNames[c.type || type] || "Demande";
    const acceptedMsgs = {
      fr: `🔔 Le serveur a accepté votre ${typeLabel} et arrive à votre table !`,
      en: `🔔 The waiter accepted your ${typeLabel} and is coming to your table!`,
      de: `🔔 Ihr Kellner hat Ihre ${typeLabel} angenommen und kommt zu Ihrem Tisch!`,
      es: `🔔 ¡El camarero ha aceptado su petición y se dirige a su mesa!`,
      ar: `🔔 لقد قبل النادل طلبك وهو في الطريق إلى طاولتك !`
    };
    const msg = acceptedMsgs[currentLang] || acceptedMsgs.fr;

    showToast(msg);
    playChimeSound();
    triggerHapticVibrate();
    addNotificationToHistory(msg, clientTable || c.table);

    // Arrêt immédiat de l'écoute dès que l'appel a été accepté
    const u = activeClientCallUnsubs.get(key);
    if (typeof u === "function") {
      try { u(); } catch (e) {}
    }
    activeClientCallUnsubs.delete(key);
  });

  if (typeof unsub === "function") {
    activeClientCallUnsubs.set(key, unsub);
  }
}

export function listenToClientOrder(orderId, clientTable) {
  if (!orderId) return;
  const key = String(orderId);
  if (activeClientOrderUnsubs.has(key)) return;

  const unsub = dbService.onSinglePreOrderChange(orderId, (o) => {
    if (!o || o.status !== "accepted") return;
    if (notifiedOrderIds.has(String(o.id))) return;
    notifiedOrderIds.add(String(o.id));

    try {
      localStorage.removeItem("last_pre_order_id");
      localStorage.removeItem("last_pre_order_time");
    } catch (e) {}

    const acceptedMsgs = {
      fr: "👨‍🍳 Le serveur a validé votre précommande !",
      en: "👨‍🍳 The waiter confirmed your pre-order!",
      de: "👨‍🍳 Der Kellner hat Ihre Vorbestellung bestätigt!",
      es: "👨‍🍳 ¡El camarero ha confirmado su prepedido!",
      ar: "👨‍🍳 لقد وافق النادل على طلبك المسبق !"
    };
    const msg = acceptedMsgs[currentLang] || acceptedMsgs.fr;

    showToast(msg);
    playChimeSound();
    triggerHapticVibrate();
    addNotificationToHistory(msg, clientTable || o.table);

    // Arrêt immédiat de l'écoute dès que la commande a été acceptée
    const u = activeClientOrderUnsubs.get(key);
    if (typeof u === "function") {
      try { u(); } catch (e) {}
    }
    activeClientOrderUnsubs.delete(key);
  });

  if (typeof unsub === "function") {
    activeClientOrderUnsubs.set(key, unsub);
  }
}

export function subscribeToActiveWaiterEvents(clientTable) {
  if (!clientTable) return;

  // Optimisation Firestore : Écouter UNIQUEMENT les appels du client s'il en a fait un récemment (< 15 min)
  const callTypes = ["waiter", "water", "bill"];
  const now = Date.now();
  callTypes.forEach(t => {
    try {
      const callId = localStorage.getItem(`last_call_${t}`);
      const callTime = parseInt(localStorage.getItem(`last_call_${t}_time`) || "0", 10);
      if (callId && (!callTime || (now - callTime) < 15 * 60 * 1000)) {
        listenToClientCall(callId, t, clientTable);
      } else if (callId && callTime && (now - callTime) >= 15 * 60 * 1000) {
        localStorage.removeItem(`last_call_${t}`);
        localStorage.removeItem(`last_call_${t}_time`);
      }
    } catch (e) {}
  });

  // Écouter UNIQUEMENT la précommande du client s'il en a fait une récemment (< 30 min)
  try {
    const orderId = localStorage.getItem("last_pre_order_id");
    const orderTime = parseInt(localStorage.getItem("last_pre_order_time") || "0", 10);
    if (orderId && (!orderTime || (now - orderTime) < 30 * 60 * 1000)) {
      listenToClientOrder(orderId, clientTable);
    } else if (orderId && orderTime && (now - orderTime) >= 30 * 60 * 1000) {
      localStorage.removeItem("last_pre_order_id");
      localStorage.removeItem("last_pre_order_time");
    }
  } catch (e) {}
}

export function renderNotificationHistory(clientTable) {
  const ndContentFeed = document.getElementById("ndContentFeed");
  if (!ndContentFeed) return;
  ndContentFeed.innerHTML = "";

  const tableNotifications = clientTable
    ? memoryNotifications.filter(n => !n.table || String(n.table) === String(clientTable))
    : memoryNotifications;

  if (tableNotifications.length === 0) {
    const emptyMsgs = {
      fr: "Aucune notification récente.<br><span style='font-size:0.75rem;opacity:0.7;'>Vos appels serveur et suivis de commande apparaîtront ici.</span>",
      en: "No recent notifications.<br><span style='font-size:0.75rem;opacity:0.7;'>Your waiter calls and order updates will appear here.</span>",
      de: "Keine aktuellen Benachrichtigungen.<br><span style='font-size:0.75rem;opacity:0.7;'>Ihre Kellnerrufe und Bestellaktualisierungen werden hier angezeigt.</span>",
      es: "No hay notificaciones recientes.<br><span style='font-size:0.75rem;opacity:0.7;'>Sus llamadas al camarero y el estado de sus pedidos aparecerán aquí.</span>",
      ar: "لا توجد إشعارات حديثة.<br><span style='font-size:0.75rem;opacity:0.7;'>ستظهر هنا طلبات النادل ومتابعة طلباتك.</span>"
    };
    ndContentFeed.innerHTML = `
      <div style="text-align: center; color: rgba(240, 234, 216, 0.6); padding: 40px 20px; font-size: 0.85rem; line-height: 1.6;">
        🔔<br>${emptyMsgs[currentLang] || emptyMsgs.fr}
      </div>
    `;
    return;
  }

  tableNotifications.slice().reverse().forEach(notif => {
    const card = document.createElement("div");
    card.className = "nd-card";
    card.innerHTML = `
      <div class="nd-card-header">
        <span class="nd-card-title">${notif.title}</span>
        <span class="nd-card-time">${notif.time}</span>
      </div>
      <div class="nd-card-body">${notif.message}</div>
    `;
    ndContentFeed.appendChild(card);
  });
}

export function setupNotificationDrawer(getClientTable) {
  const bellBtn = document.getElementById("notificationBellBtn");
  const ndOverlay = document.getElementById("notificationDrawerOverlay");
  const ndCloseBtn = document.getElementById("ndCloseBtn");
  const bellBadge = document.getElementById("bellBadge");

  if (bellBtn) {
    bellBtn.onclick = () => {
      if (bellBadge) bellBadge.style.display = "none";
      if (ndOverlay) ndOverlay.classList.add("active");
      const currentTable = typeof getClientTable === "function" ? getClientTable() : getClientTable;
      const tableBadge = document.getElementById("ndTableBadge");
      if (tableBadge) {
        const tableLabel = currentLang === "ar" ? "طاولة" : (currentLang === "es" ? "Mesa" : (currentLang === "de" ? "Tisch" : "Table"));
        tableBadge.textContent = currentTable ? `${tableLabel} ${currentTable}` : tableLabel;
      }
      renderNotificationHistory(currentTable);
    };
  }

  if (ndCloseBtn) {
    ndCloseBtn.onclick = () => {
      if (ndOverlay) ndOverlay.classList.remove("active");
    };
  }

  if (ndOverlay) {
    ndOverlay.onclick = (e) => {
      if (e.target === ndOverlay) {
        ndOverlay.classList.remove("active");
      }
    };
  }
}

window.triggerQuickServiceCall = triggerQuickServiceCall;
window.renderNotificationHistory = renderNotificationHistory;
window.subscribeToActiveWaiterEvents = subscribeToActiveWaiterEvents;
window.listenToClientCall = listenToClientCall;
window.listenToClientOrder = listenToClientOrder;
window.playChimeSound = playChimeSound;
window.triggerHapticVibrate = triggerHapticVibrate;
