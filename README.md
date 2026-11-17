# ☕ Grey Corner — Plateforme Digitale & Club Fidélité

Ce document détaille l'architecture complète, les règles métier du **Menu Digital**, le système d'**Appels Serveurs** et toutes les règles du **Club Fidélité** de Grey Corner.

---

## 📑 Sommaire
1. [Vue d'ensemble de la Plateforme](#1-vue-densemble-de-la-plateforme)
2. [Règles du Menu Digital Client & Commandes](#2-règles-du-menu-digital-client--commandes)
3. [Règles de l'Application Serveurs (Waiter POS)](#3-règles-de-lapplication-serveurs-waiter-pos)
4. [Règles d'Or du Club Fidélité (Loyalty)](#4-règles-dor-du-club-fidélité-loyalty)
5. [Pleins Pouvoirs Administrateur & Direction](#5-pleins-pouvoirs-administrateur--direction)
6. [Architecture Multi-Dépôts & Double Déploiement Cloudflare](#6-architecture-multi-dépôts--double-déploiement-cloudflare)
7. [Mécanisme Temps Réel des Alertes > 100 Points](#7-mécanisme-temps-réel-des-alertes--100-points)
8. [Gestion du Cache Navigateur & Versioning (Cache Buster)](#8-gestion-du-cache-navigateur--versioning-cache-buster)
9. [Architecture Technique & Base de Données D1 SQLite](#9-architecture-technique--base-de-données-d1-sqlite)
10. [Protocole de Déploiement Anti-Erreur (Checklist)](#10-protocole-de-déploiement-anti-erreur-checklist)

---

## 1. Vue d'ensemble de la Plateforme

Grey Corner dispose d'un écosystème web connecté en temps réel via Cloudflare Pages & D1 SQLite :

- **Menu Client (`index.html`) :** Application PWA responsive multi-langue (Français, Arabe, Anglais, Allemand), consultation du menu, pré-commandes par table, adhésion au Club Fidélité, et suivi du solde de points.
- **Application Serveurs (`waiter.html` / APK Android Native) :** Réception instantanée des appels et commandes par table, sonneries d'alerte, validation d'encaissement et attribution de points fidélité.
- **Tableau de Bord Direction (`admin.html`) :** Supervision en temps réel des tables, audit des encaissements, validation des alertes fidélité (> 100 pts), ajustement libre des points, export WhatsApp et statistiques.
- **API Cloudflare Pages (`functions/api/[[route]].js`) :** Moteur REST sécurisé connecté à la base SQLite D1 haute performance.

---

## 2. Règles du Menu Digital Client & Commandes

### A. Sélection de Table & Zone
- Chaque commande ou appel doit être rattaché à une **Table** (1 à 25) et une **Zone** :
  - **Zone 1 (RDC) :** Tables 101 à 112 (affichées Tables 1 à 12).
  - **Zone 2 (Étage) :** Tables 201 à 206 (affichées Tables 13 à 18).
  - **Zone 3 (Terrasse) :** Tables 301 à 307 (affichées Tables 19 à 25).
- Si le client scanne un QR code de table avec paramètre d'URL (ex. `?table=5`), la table est pré-sélectionnée automatiquement.

### B. Panier & Pré-commandes
- Le client compose son panier avec choix des options (laits, sirops, cuisson, suppléments).
- Envoi de la commande avec ou sans numéro de fidélité.
- Statuts de la commande :
  - `pending` : Commande reçue, sonne sur les téléphones des serveurs.
  - `accepted` : Prise en charge par un serveur (la sonnerie s'arrête sur tous les appareils).
  - `completed` : Commande servie, encaissée et clôturée.

### C. Appels Serveurs & Sons
- Le client peut émettre 3 types d'appels :
  1. **Appel Serveur Standard** (Besoin d'aide, commande additionnelle).
  2. **Demande de l'Addition** (Espèces / TPE / Carte).
  3. **Demande de Consommation Gratuite Fidélité** (500 pts).
- L'appel fait sonner les appareils serveurs connectés. Dès qu'un serveur clique sur **« Prendre en charge »**, un push silencieux `CANCEL_ALERT` coupe immédiatement l'alarme sonore de tous ses collègues.

---

## 3. Règles de l'Application Serveurs (Waiter POS)

1. **Identification du Serveur :** Chaque serveur sélectionne son profil (ex. *Serveur 1*, *Karim*, *Hamza*) ou renseigne son nom.
2. **Encaissement Direct & Attribution de Points :**
   - Le serveur peut encaisser une commande existante ou saisir un encaissement direct par numéro de téléphone.
   - **Règle 1 DH = 1 Point.**
3. **Contrôle Antifraude :**
   - Le serveur est soumis aux règles d'anti-fraude automatiques (délai de 2h et seuil direction > 100 pts).
   - Les messages d'avertissement et de succès sont affichés clairement sans bloquer l'activité en salle.

---

## 4. Règles d'Or du Club Fidélité (Loyalty)

### 🥇 Règle 1 : Identifiant Unique
- **Le numéro de téléphone est le seul et unique repère du client.**
- Normalisation automatique des formats marocains (`06...`, `07...`, `05...`, `+212...`, `00212...`).
- Même si le client saisit un prénom différent ou fait une faute d'orthographe, le compte rattaché au numéro de téléphone prime toujours.

### 🎁 Règle 2 : Cadeau de Bienvenue
- Dès l'inscription ou la première commande enregistrée sur un numéro, **+20 points de bienvenue** sont offerts automatiquement sur le compte.

### 👑 Règle 3 : Les 4 Paliers VIP & Multiplicateurs de Points
Pour valoriser la fidélité dans la durée et créer une dynamique d'émulation, les points sont attribués selon le **Rang VIP** du client.
> [!IMPORTANT]
> **RÈGLE DU STATUT ACQUIS À VIE :**  
> Les paliers VIP sont calculés sur le **cumul total à vie des points gagnés (`totalEarned`)**.  
> Par conséquent, **dépenser ses points pour s'offrir une boisson ne fait JAMAIS régresser le client dans son rang VIP** !

| Rang VIP | Points Cumulés à Vie (`totalEarned`) | Multiplicateur | Règle d'Attribution & Bonus |
| :---: | :---: | :---: | :--- |
| 🥉 **Bronze** | 0 à 199 pts | **x1.0** | **1 DH = 1.0 pt** (Ratio standard) |
| 🥈 **Silver VIP** | 200 à 499 pts | **x1.1** | **1 DH = 1.1 pt** (+10% de points bonus) |
| 🥇 **Gold VIP** | 500 à 999 pts | **x1.25** | **1 DH = 1.25 pt** (+25% de points bonus) |
| 💎 **Platine VIP** | 1 000+ pts | **x1.5** | **1 DH = 1.5 pt** (+50% de points bonus) |

*Exemple pratique :*  
Pour une addition de 100 DH :
- Un client **Bronze** reçoit **100 pts**
- Un client **Silver** reçoit **110 pts**
- Un client **Gold** reçoit **125 pts**
- Un client **Platine** reçoit **150 pts**

### ☕🍹 Règle 4 : Double Système de Récompenses (Paliers 500 & 1 000 pts)
Deux niveaux de déblocage de récompenses sont accessibles selon le solde de points disponibles (`points`) :

1. **Palier 1 (500 Points) : ☕ 1 Boisson Chaude au choix**
   - Café, Espresso, Cappuccino, Thé à la menthe, Thé d'infusion, Chocolat chaud.
   - Dès 500 points, le bouton doré **« ☕ Demander ma Boisson Chaude (-500 pts) »** s'active.

2. **Palier 2 (1 000 Points) : 🍹 1 Jus de Fruits Frais au choix**
   - Jus d'orange pressée minute, Cocktails détox, Smoothies signatures.
   - Dès 1 000 points, le bouton violet **« 🍹 Demander mon Jus au choix (-1 000 pts) »** s'active.
   - Le client garde la liberté totale : consommer sa boisson chaude à 500 pts, ou attendre 1 000 pts pour déguster un jus premium.

### 🛑 Règle 5 : Règle Antifraude Serveurs (< 2 Heures)
- **Objectif :** Empêcher les abus ou attributions répétées de points sur le même numéro de téléphone lors d'un même service.
- **Principe :** Un serveur ne peut attribuer des points au même numéro de téléphone qu'**une seule fois toutes les 2 heures (120 minutes)**.
- **En cas de tentative prématurée :**
  - La demande est immédiatement bloquée par l'API Cloudflare.
  - L'écran indique précisément : *« ⛔ BLOCAGE ANTIFRAUDE (Moins de 2h) : Ce numéro a déjà été crédité il y a moins de 2 heures (Table X). Nouveau crédit autorisé dans Y minute(s). »*

### 🚨 Règle 6 : Additions > 100 DH (> 100 Points) par les Serveurs
- **L'encaissement et la commande passent TOUJOURS :**
  - Le montant passe obligatoirement, la commande est encaissée, clôturée et le client n'est jamais bloqué en caisse.
- **Mise en attente de validation direction :**
  - Si le montant saisi par un serveur est supérieur à **100 DH (> 100 pts)**, les points ne sont pas crédités instantanément.
  - La transaction est créée avec le statut :  
    `⏳ [EN ATTENTE VALIDATION ADMIN >100 PTS] Encaissement X DH (+Y pts [Rang VIP xRatio]) — Table Z`.
  - Le serveur et le client reçoivent la confirmation :  
    *« ✅ Addition validée ! Les points (>100 pts) sont en attente de confirmation par la direction. »*
- **Traitement par la Direction (`admin.html`) :**
  - L'alerte apparaît en haut du tableau de bord dans la section **« Contrôle & Validation des Points (> 100 pts) »**.
  - L'administrateur dispose de 3 actions directes :
    1. **✅ Valider & Créditer :** Valide le ticket de caisse. Les points sont immédiatement crédités sur le compte client.
    2. **✏️ Rectifier :** Si le serveur s'est trompé dans la saisie (ex. a tapé 500 DH au lieu de 50 DH), l'admin renseigne le vrai montant (50 DH) ; le client reçoit exactement +50 points et la transaction est archivée avec l'historique complet.
    3. **❌ Rejeter :** En cas d'erreur totale ou de fraude, l'admin rejette la demande. **0 point n'est crédité**, et le client n'est pas pénalisé par le blocage des 2 heures.

---

## 5. Pleins Pouvoirs Administrateur & Direction

L'administrateur dispose d'une **liberté totale et sans aucune restriction** pour gérer les points des clients :

| Action Admin | Restriction de délai (2h) ? | Seuil >100 pts ? | Description |
| :--- | :---: | :---: | :--- |
| **Ajouter des points** | ❌ **Aucune** | ❌ **Aucun** | L'admin peut créditer n'importe quel montant (10 pts, 150 pts, 1000 pts) à tout moment, sans aucun délai d'attente. |
| **Déduire des points** | ❌ **Aucune** | ❌ **Aucun** | L'admin peut déduire n'importe quel nombre de points (correction, remboursement, annulation) avec motif d'ajustement. |
| **Offrir une Boisson Chaude** | ❌ **Aucune** | ❌ **Aucun** | Déduction directe de 500 points pour accorder une boisson chaude offerte. |
| **Offrir un Jus au choix** | ❌ **Aucune** | ❌ **Aucun** | Déduction directe de 1 000 points pour accorder un jus de fruits frais offert. |
| **Rectifier un montant** | ❌ **Aucune** | ❌ **Aucun** | Correction en 1 clic des erreurs de saisie des serveurs. |
| **Campagnes WhatsApp Ciblées** | ❌ **Aucune** | ❌ **Aucun** | Filtrage par rang VIP (Bronze, Silver, Gold, Platine) ou éligibilité cadeau (Jus vs Boisson). |

---

## 6. Architecture Multi-Dépôts & Double Déploiement Cloudflare

> [!IMPORTANT]
> **RÈGLE FONDAMENTALE DE DÉPLOIEMENT : IL EXISTE DEUX DÉPÔTS GITHUB DISTINCTS.**
> Ne jamais modifier l'un sans mettre à jour l'autre ! Toute mise à jour de code partagé doit obligatoirement être poussée sur les deux dépôts.

| Dépôt GitHub | Répertoire Local | Projet Cloudflare Pages | URL Production | Contenu & Rôle Principal |
| :--- | :--- | :--- | :--- | :--- |
| **`menugreycorner.git`** | `c:\Users\mplp000\AndroidStudioProjects\menugreycorner` | `menugreycorner` | **https://menugreycorner.pages.dev** | Menu Digital interactif des clients (`index.html`), précommandes, adhésion fidélité, console admin miroir. |
| **`espace-serveurs.git`** | `C:\Users\mplp000\OneDrive\Dokumente\GitHub\espace-serveurs` | `espace-serveurs-hub` | **https://espace-serveurs-hub.pages.dev** | Hub Opérationnel Serveurs en racine (`index.html` = `waiter.html`), PWA Android/tablettes et **Console Admin Direction (`/admin`)**. |

### Règle de synchronisation des fichiers partagés :
Lorsque vous modifiez l'un de ces fichiers dans `menugreycorner`, **copiez-le immédiatement** dans `espace-serveurs` :
- `functions/api/[[route]].js` (Moteur API Cloudflare)
- `firebase-config.js` (Couche temps réel D1)
- `admin.html` et `admin.js` (Console direction)
- `waiter.html` et `waiter.js` (Application serveurs ; noter que dans `espace-serveurs`, `index.html` est une copie conforme de `waiter.html`)
- `waiter.css` et `admin.css` (Feuilles de style)
- `js/bundle.js` et `js/config/firebase.js` (Bundle client)
- `schema.sql` (Structure SQLite D1)

---

## 7. Mécanisme Temps Réel des Alertes > 100 Points

Pour qu'une demande serveur apparaisse instantanément sur la console admin sans nécessiter de rechargement manuel de la page :

1. **Emission par le serveur :**
   - Lorsqu'une addition > 100 DH est encaissée par un serveur, le backend D1 insère une transaction de type `EARN` avec la note `⏳ [EN ATTENTE VALIDATION ADMIN >100 PTS]` et `pointsDelta > 100`. Le solde du client n'est pas encore incrémenté.
2. **Détection API :**
   - L'endpoint `GET /api/loyalty/alerts` renvoie toutes les transactions où `pointsDelta > 100` n'ayant pas encore été validées, rectifiées ou rejetées par l'administrateur, tout en excluant les crédits directs de l'admin.
3. **Boucle de Polling Actif (3 secondes) :**
   - Dans `admin.js`, une boucle active tourne en continu :
     ```javascript
     loadLoyaltyAlerts();
     setInterval(loadLoyaltyAlerts, 3000);
     ```
   - Dès qu'un serveur enregistre une addition > 100 DH sur son téléphone, la console admin reçoit l'alerte sous 3 secondes maximum.
   - Le badge `⚠️ N` s'allume sur l'onglet **Club Fidélité** et la section dorée **« Alertes & Contrôle Serveurs »** s'affiche automatiquement.
4. **Validation et rafraîchissement immédiat de la base membres :**
   - Lorsque l'admin clique sur `✅ Valider & Créditer`, l'API D1 met à jour `loyalty_members` et `loyalty_transactions`.
   - Côté client, `verifyLoyaltyAlert` déclenche immédiatement `syncMembersNow()` et `loadLoyaltyAlerts()` : l'alerte disparaît et le nouveau solde du client s'actualise en direct dans le tableau sans décalage.

---

## 8. Gestion du Cache Navigateur & Versioning (Cache Buster)

Les navigateurs modernes (en particulier sur mobile et tablettes de service) mettent agressivement en cache les scripts JavaScript.

### Règle d'incrémentation de version :
À chaque modification de code JavaScript ou CSS, le paramètre de version dans les balises `<script>` et `<link>` doit être incrémenté sur **toutes les pages HTML** :
- `admin.html` : `admin.css?v=5.0`, `firebase-config.js?v=5.0`, `admin.js?v=5.0`
- `waiter.html` / `index.html` : `waiter.css?v=5.0`, `firebase-config.js?v=5.0`, `waiter.js?v=5.0`
- Recompilation du bundle ESBuild :
  ```powershell
  npx esbuild js/main.js --bundle --outfile=js/bundle.js --format=iife
  ```

---

## 9. Architecture Technique & Base de Données D1 SQLite

### Schéma des Tables D1 SQLite

1. **`loyalty_members` :**
   - `phone` (TEXT, Clé primaire normalisée)
   - `firstName` (TEXT, Prénom du client)
   - `points` (INTEGER, Solde actif)
   - `totalEarned` (INTEGER, Cumul historique)
   - `rewardsClaimed` (INTEGER, Nombre de boissons gratuites reçues)
   - `source` (TEXT, `qr_menu`, `waiter_direct`, `admin`)
   - `createdAt`, `updatedAt` (ISO Timestamp)

2. **`loyalty_transactions` :**
   - `id` (TEXT, Clé primaire)
   - `phone` (TEXT, Référence client)
   - `type` (`WELCOME`, `EARN`, `REDEEM`, `ADMIN_ADJUST`, `REJECTED`)
   - `pointsDelta` (INTEGER, Points ajoutés ou déduits)
   - `amountDH` (REAL, Montant de l'addition)
   - `tableNumber` (TEXT, Table concernée)
   - `orderId` (TEXT, Id de commande liée)
   - `validatedBy` (TEXT, Profil du serveur ou admin)
   - `note` (TEXT, Historique et détails de validation)
   - `createdAt` (ISO Timestamp)

3. **`pre_orders` :**
   - Commandes clients avec statut, liste des articles, table, zone et flag `loyaltyCredited`.

4. **`waiters_calls` :**
   - Appels serveurs, demandes d'addition et demandes de consommation gratuite.

5. **`system_config` :**
   - Réglages globaux (`loyalty_config`, `system_frozen`).

---

## 10. Protocole de Déploiement Anti-Erreur (Checklist)

Pour éviter tout désalignement ou bug en production, suivre obligatoirement cette procédure :

- [ ] **1. Validation Syntaxique :**  
  Exécuter `node --check` sur tous les fichiers JS modifiés (`[[route]].js`, `firebase-config.js`, `admin.js`, `waiter.js`, `bundle.js`).
- [ ] **2. Recompilation Bundle :**  
  Si `js/main.js` ou des modules ont été touchés, exécuter `npx esbuild js/main.js --bundle --outfile=js/bundle.js --format=iife`.
- [ ] **3. Incrémentation Cache Buster :**  
  Monter la version (`?v=5.X`) dans `admin.html`, `waiter.html`, et `index.html`.
- [ ] **4. Copie vers `espace-serveurs` :**  
  Copier les fichiers mis à jour de `menugreycorner` vers `C:\Users\mplp000\OneDrive\Dokumente\GitHub\espace-serveurs` (sans oublier de dupliquer `waiter.html` en `index.html` dans `espace-serveurs`).
- [ ] **5. Double Commit & Push :**  
  1. `git -C "c:\Users\mplp000\AndroidStudioProjects\menugreycorner" add -A; git commit -m "..."; git push origin main`
  2. `git -C "C:\Users\mplp000\OneDrive\Dokumente\GitHub\espace-serveurs" add -A; git commit -m "..."; git push origin main`
- [ ] **6. Test de Contrôle en Production :**  
  Tester les deux URL de production :
  - `https://menugreycorner.pages.dev/api/loyalty/alerts`
  - `https://espace-serveurs-hub.pages.dev/api/loyalty/alerts`

---

*Grey Corner — Système d'Encaissement & Club Fidélité développé pour Cloudflare Pages & D1.*
