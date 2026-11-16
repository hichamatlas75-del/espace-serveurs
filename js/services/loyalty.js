/**
 * GREY CORNER — CLIENT LOYALTY CLUB SERVICE (ES Module)
 * Règle d'or : 500 POINTS = 1 CONSOMMATION OFFERTE
 * Bonus bienvenue : +20 POINTS offerts à l'inscription
 * Ratio : 1 DH = 1 POINT
 */

import { currentLang } from './i18n.js';
import { dbService, normalizePhone } from '../config/firebase.js';
import { showToast } from './cart.js';
import { clientTable, showTableSelectorModal, setPendingActionAfterTableSelect } from '../ui/modals.js';

let loyaltyListenerUnsub = null;
let currentMemberData = null;

export const LOYALTY_I18N = {
  fr: {
    badge: "Club Fidélité",
    tagline: "500 pts = 1 consommation offerte !",
    firstNamePlaceholder: "Votre prénom",
    phonePlaceholder: "N° de téléphone (ex: 06...)",
    joinBtn: "🎁 Rejoindre / Voir mes points (+20 pts offerts)",
    hello: "Bonjour",
    pointsRemaining: "Plus que {rem} pts avant votre consommation offerte !",
    rewardUnlocked: "🎉 Félicitations ! Votre consommation gratuite est disponible !",
    claimBtn: "🎁 Demander ma consommation gratuite (500 pts)",
    claimSent: "Demande envoyée ! Le serveur arrive pour vous offrir votre boisson.",
    switchAccount: "Changer de compte",
    phoneError: "Veuillez entrer un numéro de téléphone valide.",
    nameError: "Veuillez renseigner votre prénom.",
    tablePrompt: "Veuillez choisir votre numéro de table pour recevoir votre consommation gratuite.",
    welcomeToast: "🎉 Bienvenue au Club ! +20 points offerts !",
    welcomeBackToast: "👋 Bon retour parmi nous {name} !"
  },
  ar: {
    badge: "نادي الوفاء",
    tagline: "500 نقطة = 1 مشروب مجاني !",
    firstNamePlaceholder: "الاسم الشخصي",
    phonePlaceholder: "رقم الهاتف (مثال: 06...)",
    joinBtn: "🎁 انضمام / رصيد نقاطي (+20 نقطة هدية)",
    hello: "مرحباً",
    pointsRemaining: "باقي {rem} نقطة فقط على مشروبكم المجاني !",
    rewardUnlocked: "🎉 تهانينا ! مشروبكم المجاني جاهز للطلب الآن !",
    claimBtn: "🎁 طلب مشروبي المجاني (500 نقطة)",
    claimSent: "تم إرسال الطلب ! النادل قادم لتقديم مشروبكم المجاني.",
    switchAccount: "تغيير الحساب",
    phoneError: "يرجى إدخال رقم هاتف صحيح.",
    nameError: "يرجى كتابة الاسم الشخصي.",
    tablePrompt: "يرجى اختيار رقم الطاولة للحصول على مشروبكم المجاني.",
    welcomeToast: "🎉 أهلاً بكم في نادي الوفاء ! +20 نقطة هدية !",
    welcomeBackToast: "👋 مرحباً بعودتكم {name} !"
  },
  en: {
    badge: "Loyalty Club",
    tagline: "500 pts = 1 free drink!",
    firstNamePlaceholder: "Your first name",
    phonePlaceholder: "Phone number (e.g. 06...)",
    joinBtn: "🎁 Join / Check Points (+20 pts bonus)",
    hello: "Hello",
    pointsRemaining: "{rem} pts left before your free drink!",
    rewardUnlocked: "🎉 Congratulations! Your free drink is ready to claim!",
    claimBtn: "🎁 Claim my free drink (500 pts)",
    claimSent: "Request sent! The waiter is on their way with your free drink.",
    switchAccount: "Switch account",
    phoneError: "Please enter a valid phone number.",
    nameError: "Please enter your first name.",
    tablePrompt: "Please select your table number to receive your free drink.",
    welcomeToast: "🎉 Welcome to the Club! +20 bonus points awarded!",
    welcomeBackToast: "👋 Welcome back {name}!"
  },
  de: {
    badge: "Treue-Club",
    tagline: "500 Pkt = 1 Gratis-Getränk!",
    firstNamePlaceholder: "Ihr Vorname",
    phonePlaceholder: "Telefonnummer (z.B. 06...)",
    joinBtn: "🎁 Beitreten / Punkte prüfen (+20 Pkt)",
    hello: "Hallo",
    pointsRemaining: "Noch {rem} Pkt bis zum Gratis-Getränk!",
    rewardUnlocked: "🎉 Glückwunsch! Ihr Gratis-Getränk ist abholbereit!",
    claimBtn: "🎁 Gratis-Getränk anfordern (500 Pkt)",
    claimSent: "Anfrage gesendet! Die Bedienung bringt Ihr Gratis-Getränk.",
    switchAccount: "Konto wechseln",
    phoneError: "Bitte geben Sie eine gültige Telefonnummer ein.",
    nameError: "Bitte geben Sie Ihren Vornamen ein.",
    tablePrompt: "Bitte wählen Sie Ihre Tischnummer für das Gratis-Getränk.",
    welcomeToast: "🎉 Willkommen im Club! +20 Punkte geschenkt!",
    welcomeBackToast: "👋 Willkommen zurück {name}!"
  }
};

function getT() {
  return LOYALTY_I18N[currentLang] || LOYALTY_I18N.fr;
}

export function getStoredLoyaltyPhone() {
  return localStorage.getItem("gc_loyalty_phone") || "";
}

export function getStoredLoyaltyName() {
  return localStorage.getItem("gc_loyalty_name") || "";
}

export function initLoyaltyWidget() {
  const storedPhone = getStoredLoyaltyPhone();
  if (storedPhone) {
    subscribeToMember(storedPhone);
  } else {
    renderLoggedOutUI();
  }

  setupLoyaltyEvents();
}

function subscribeToMember(phone) {
  if (loyaltyListenerUnsub) {
    try { loyaltyListenerUnsub(); } catch(e) {}
    loyaltyListenerUnsub = null;
  }

  loyaltyListenerUnsub = dbService.onLoyaltyMemberChange(phone, (member) => {
    if (member) {
      currentMemberData = member;
      localStorage.setItem("gc_loyalty_phone", member.phone);
      localStorage.setItem("gc_loyalty_name", member.firstName || "Client");
      renderLoggedInUI(member);
    } else {
      // Le membre n'existe pas encore ou a été purgé
      renderLoggedOutUI();
    }
  });
}

export function renderLoggedOutUI() {
  const t = getT();
  const loggedOutWrap = document.getElementById("loyaltyLoggedOutView");
  const loggedInWrap = document.getElementById("loyaltyLoggedInView");

  if (loggedOutWrap) loggedOutWrap.style.display = "block";
  if (loggedInWrap) loggedInWrap.style.display = "none";

  const btn = document.getElementById("loyaltyJoinBtn");
  if (btn) btn.textContent = t.joinBtn;

  const fnInput = document.getElementById("loyaltyFirstNameInput");
  if (fnInput) fnInput.placeholder = t.firstNamePlaceholder;

  const phInput = document.getElementById("loyaltyPhoneInput");
  if (phInput) phInput.placeholder = t.phonePlaceholder;

  const tagEl = document.getElementById("loyaltyTaglineText");
  if (tagEl) tagEl.textContent = t.tagline;

  const badgeEl = document.getElementById("loyaltyBadgeText");
  if (badgeEl) badgeEl.textContent = t.badge;
}

export function renderLoggedInUI(member) {
  const t = getT();
  const loggedOutWrap = document.getElementById("loyaltyLoggedOutView");
  const loggedInWrap = document.getElementById("loyaltyLoggedInView");

  if (loggedOutWrap) loggedOutWrap.style.display = "none";
  if (loggedInWrap) loggedInWrap.style.display = "block";

  const nameEl = document.getElementById("loyaltyMemberName");
  if (nameEl) nameEl.textContent = `${t.hello} ${member.firstName || "Client"}`;

  const ptsEl = document.getElementById("loyaltyPointsVal");
  const pts = member.points || 0;
  if (ptsEl) ptsEl.textContent = pts;

  const pct = Math.min(100, Math.max(0, (pts / 500) * 100));
  const fillEl = document.getElementById("loyaltyProgressFill");
  if (fillEl) fillEl.style.width = `${pct}%`;

  const remaining = Math.max(0, 500 - pts);
  const statusEl = document.getElementById("loyaltyStatusText");
  const claimBtn = document.getElementById("loyaltyClaimBtn");
  const bannerWrap = document.getElementById("loyaltyCardBanner");

  if (pts >= 500) {
    if (statusEl) {
      statusEl.textContent = t.rewardUnlocked;
      statusEl.classList.add("ready-celebrate");
    }
    if (claimBtn) {
      claimBtn.style.display = "inline-flex";
      claimBtn.textContent = t.claimBtn;
    }
    if (bannerWrap) bannerWrap.classList.add("reward-ready-border");
  } else {
    if (statusEl) {
      statusEl.textContent = t.pointsRemaining.replace("{rem}", remaining);
      statusEl.classList.remove("ready-celebrate");
    }
    if (claimBtn) claimBtn.style.display = "none";
    if (bannerWrap) bannerWrap.classList.remove("reward-ready-border");
  }

  const switchBtn = document.getElementById("loyaltySwitchAccountBtn");
  if (switchBtn) switchBtn.textContent = t.switchAccount;
}

function setupLoyaltyEvents() {
  const joinBtn = document.getElementById("loyaltyJoinBtn");
  const phoneInput = document.getElementById("loyaltyPhoneInput");
  const fnInput = document.getElementById("loyaltyFirstNameInput");

  if (joinBtn && !joinBtn._hasLoyaltyEvent) {
    joinBtn._hasLoyaltyEvent = true;
    joinBtn.addEventListener("click", () => {
      const rawPhone = phoneInput ? phoneInput.value : "";
      const rawName = fnInput ? fnInput.value : "";
      const cleanPhone = normalizePhone(rawPhone);
      const t = getT();

      if (!cleanPhone || cleanPhone.length < 8) {
        showToast(t.phoneError);
        if (phoneInput) phoneInput.focus();
        return;
      }

      joinBtn.disabled = true;
      joinBtn.style.opacity = "0.7";

      dbService.createOrGetLoyaltyMember(cleanPhone, rawName || "Client", "qr_menu", (success, member, isNew) => {
        joinBtn.disabled = false;
        joinBtn.style.opacity = "1";

        if (success && member) {
          localStorage.setItem("gc_loyalty_phone", member.phone);
          localStorage.setItem("gc_loyalty_name", member.firstName || "Client");
          subscribeToMember(member.phone);

          if (isNew) {
            showToast(t.welcomeToast);
          } else {
            showToast(t.welcomeBackToast.replace("{name}", member.firstName || ""));
          }
        } else {
          showToast("Erreur de connexion. Veuillez réessayer.");
        }
      });
    });
  }

  const claimBtn = document.getElementById("loyaltyClaimBtn");
  if (claimBtn && !claimBtn._hasLoyaltyEvent) {
    claimBtn._hasLoyaltyEvent = true;
    claimBtn.addEventListener("click", () => {
      const t = getT();
      const phone = getStoredLoyaltyPhone();
      const name = getStoredLoyaltyName();

      if (!clientTable) {
        showToast(t.tablePrompt);
        setPendingActionAfterTableSelect(() => {
          triggerRewardClaim(phone, name, t);
        });
        showTableSelectorModal();
        return;
      }

      triggerRewardClaim(phone, name, t);
    });
  }

  const switchBtn = document.getElementById("loyaltySwitchAccountBtn");
  if (switchBtn && !switchBtn._hasLoyaltyEvent) {
    switchBtn._hasLoyaltyEvent = true;
    switchBtn.addEventListener("click", () => {
      if (loyaltyListenerUnsub) {
        try { loyaltyListenerUnsub(); } catch(e) {}
        loyaltyListenerUnsub = null;
      }
      localStorage.removeItem("gc_loyalty_phone");
      localStorage.removeItem("gc_loyalty_name");
      currentMemberData = null;
      renderLoggedOutUI();
    });
  }
}

function triggerRewardClaim(phone, name, t) {
  const claimBtn = document.getElementById("loyaltyClaimBtn");
  if (claimBtn) claimBtn.disabled = true;

  dbService.claimLoyaltyRewardRequest(phone, clientTable, name, (success) => {
    if (claimBtn) claimBtn.disabled = false;
    if (success) {
      try {
        const chime = new Audio("https://assets.mixkit.co/active_storage/sfx/911/911-200.wav");
        chime.volume = 0.5;
        chime.play();
      } catch(e) {}

      showToast(t.claimSent);
    } else {
      showToast("Erreur de connexion. Veuillez réessayer.");
    }
  });
}
