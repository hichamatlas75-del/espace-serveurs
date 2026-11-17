/**
 * GREY CORNER — CLIENT LOYALTY CLUB SERVICE (ES Module)
 * Paliers VIP & Double Récompense :
 * - Palier 1 (500 pts) : ☕ 1 Boisson Chaude au choix
 * - Palier 2 (1 000 pts) : 🍹 1 Jus de Fruits Frais au choix
 * - Rang VIP (🥉 Bronze x1.0 / 🥈 Silver x1.1 / 🥇 Gold x1.25 / 💎 Platine x1.5)
 */

import { currentLang } from './i18n.js';
import { dbService, normalizePhone, getVipTier } from '../config/firebase.js';
import { showToast } from './cart.js';
import { playPointsGainedSound } from './sound.js';
import { clientTable, showTableSelectorModal, setPendingActionAfterTableSelect } from '../ui/modals.js';

let loyaltyListenerUnsub = null;
let currentMemberData = null;

export const LOYALTY_I18N = {
  fr: {
    badge: "Club Fidélité",
    tagline: "Paliers VIP & Boissons Offertes !",
    firstNamePlaceholder: "Votre prénom",
    phonePlaceholder: "N° de téléphone (ex: 06...)",
    joinBtn: "🎁 Rejoindre / Voir mes points (+20 pts offerts)",
    hello: "Bonjour",
    pointsRemaining: "Plus que {rem} pts pour votre Boisson Chaude offerte (500 pts) !",
    juiceRemaining: "Boisson Chaude disponible ! Plus que {rem} pts pour 1 Jus au choix (1 000 pts)",
    claimDrinkBtn: "☕ Demander Boisson Chaude (-500 pts)",
    claimJuiceBtn: "🍹 Demander Jus au Choix (-1 000 pts)",
    claimDrinkSent: "Demande de Boisson Chaude envoyée ! Le serveur arrive.",
    claimJuiceSent: "Demande de Jus de Fruits envoyée ! Le serveur arrive.",
    switchAccount: "Changer de compte",
    phoneError: "Veuillez entrer un numéro de téléphone valide.",
    nameError: "Veuillez renseigner votre prénom.",
    tablePrompt: "Veuillez choisir votre numéro de table pour recevoir votre boisson offerte.",
    welcomeToast: "🎉 Bienvenue au Club ! +20 points offerts !",
    welcomeBackToast: "👋 Bon retour parmi nous {name} !",
    multiplierLabel: "Multiplicateur {mult} ({tier})",
    lifetimeLabel: "Cumul : {earned} pts",
    nextTierHint: "Encore {rem} pts pour atteindre le rang {next} !"
  },
  ar: {
    badge: "نادي الوفاء",
    tagline: "مستويات VIP ومشروبات مجانية !",
    firstNamePlaceholder: "الاسم الشخصي",
    phonePlaceholder: "رقم الهاتف (مثال: 06...)",
    joinBtn: "🎁 انضمام / رصيد نقاطي (+20 نقطة هدية)",
    hello: "مرحباً",
    pointsRemaining: "باقي {rem} نقطة فقط على مشروبكم الساخن المجاني (500 نقطة) !",
    juiceRemaining: "المشروب الساخن جاهز ! باقي {rem} نقطة على عصير طازج مجاني (1000 نقطة)",
    claimDrinkBtn: "☕ طلب مشروب ساخن مجاني (500 نقطة)",
    claimJuiceBtn: "🍹 طلب عصير طازج من اختياركم (1000 نقطة)",
    claimDrinkSent: "تم إرسال الطلب ! النادل قادم لتقديم مشروبكم الساخن المجاني.",
    claimJuiceSent: "تم إرسال الطلب ! النادل قادم لتقديم عصيركم الطازج المجاني.",
    switchAccount: "تغيير الحساب",
    phoneError: "يرجى إدخال رقم هاتف صحيح.",
    nameError: "يرجى كتابة الاسم الشخصي.",
    tablePrompt: "يرجى اختيار رقم الطاولة للحصول على مشروبكم المجاني.",
    welcomeToast: "🎉 أهلاً بكم في نادي الوفاء ! +20 نقطة هدية !",
    welcomeBackToast: "👋 مرحباً بعودتكم {name} !",
    multiplierLabel: "مضاعف النقاط {mult} ({tier})",
    lifetimeLabel: "المجموع الكلي : {earned} نقطة",
    nextTierHint: "باقي {rem} نقطة للوصول إلى مستوى {next} !"
  },
  en: {
    badge: "Loyalty Club",
    tagline: "VIP Tiers & Free Drinks!",
    firstNamePlaceholder: "Your first name",
    phonePlaceholder: "Phone number (e.g. 06...)",
    joinBtn: "🎁 Join / Check Points (+20 pts bonus)",
    hello: "Hello",
    pointsRemaining: "{rem} pts left before your free hot drink (500 pts)!",
    juiceRemaining: "Hot drink ready! {rem} pts left for a fresh juice (1000 pts)",
    claimDrinkBtn: "☕ Claim Free Hot Drink (500 pts)",
    claimJuiceBtn: "🍹 Claim Free Fresh Juice (1000 pts)",
    claimDrinkSent: "Hot drink request sent! The waiter is on their way.",
    claimJuiceSent: "Fresh juice request sent! The waiter is on their way.",
    switchAccount: "Switch account",
    phoneError: "Please enter a valid phone number.",
    nameError: "Please enter your first name.",
    tablePrompt: "Please select your table number to receive your free drink.",
    welcomeToast: "🎉 Welcome to the Club! +20 bonus points awarded!",
    welcomeBackToast: "👋 Welcome back {name}!",
    multiplierLabel: "Multiplier {mult} ({tier})",
    lifetimeLabel: "Lifetime: {earned} pts",
    nextTierHint: "{rem} pts left to reach {next}!"
  },
  de: {
    badge: "Treue-Club",
    tagline: "VIP-Stufen & Gratis-Getränke!",
    firstNamePlaceholder: "Ihr Vorname",
    phonePlaceholder: "Telefonnummer (z.B. 06...)",
    joinBtn: "🎁 Beitreten / Punkte prüfen (+20 Pkt)",
    hello: "Hallo",
    pointsRemaining: "Noch {rem} Pkt bis zum Gratis-Heißgetränk (500 Pkt)!",
    juiceRemaining: "Heißgetränk bereit! Noch {rem} Pkt für 1 frischen Saft (1000 Pkt)",
    claimDrinkBtn: "☕ Gratis Heißgetränk anfordern (500 Pkt)",
    claimJuiceBtn: "🍹 Gratis Frischen Saft anfordern (1000 Pkt)",
    claimDrinkSent: "Heißgetränk angefordert! Die Bedienung bringt es gleich.",
    claimJuiceSent: "Frischer Saft angefordert! Die Bedienung bringt ihn gleich.",
    switchAccount: "Konto wechseln",
    phoneError: "Bitte geben Sie eine gültige Telefonnummer ein.",
    nameError: "Bitte geben Sie Ihren Vornamen ein.",
    tablePrompt: "Bitte wählen Sie Ihre Tischnummer für das Gratis-Getränk.",
    welcomeToast: "🎉 Willkommen im Club! +20 Punkte geschenkt!",
    welcomeBackToast: "👋 Willkommen zurück {name}!",
    multiplierLabel: "Multiplikator {mult} ({tier})",
    lifetimeLabel: "Gesamt: {earned} Pkt",
    nextTierHint: "Noch {rem} Pkt bis zur Stufe {next}!"
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


let lastRenderedPoints = null;
let lastRenderedPhone = null;

function animatePointsCounter(el, startVal, endVal, duration = 1200) {
  if (!el) return;
  const startTime = performance.now();
  const range = endVal - startVal;
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(startVal + range * easeOut);
    el.textContent = current;
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = endVal;
    }
  }
  requestAnimationFrame(step);
}

function triggerPointsAnimation(delta, currentPoints) {
  const badgeWrap = document.querySelector(".loyalty-score-badge");
  const bannerWrap = document.getElementById("loyaltyCardBanner");

  if (badgeWrap) {
    // 1. Badge flottant de delta (+XX pts / -XX pts)
    const floatEl = document.createElement("div");
    floatEl.className = `loyalty-points-floating-delta ${delta > 0 ? "gain" : "deduct"}`;
    floatEl.textContent = delta > 0 ? `+${delta} pts ✨` : `${delta} pts`;
    badgeWrap.appendChild(floatEl);
    setTimeout(() => { floatEl.remove(); }, 1700);

    // 2. Pulse d'aura dorée sur le score
    badgeWrap.classList.remove("pts-updated");
    void badgeWrap.offsetWidth;
    badgeWrap.classList.add("pts-updated");
    setTimeout(() => { badgeWrap.classList.remove("pts-updated"); }, 1300);

    // 3. Gerbe de particules étoiles scintillantes (lors d'un gain)
    if (delta > 0) {
      const sparkleIcons = ["✨", "⭐", "🌟", "💛", "✨", "✦"];
      const angles = [0, 45, 90, 135, 180, 225, 270, 315];
      for (let i = 0; i < 6; i++) {
        const p = document.createElement("span");
        p.className = "loyalty-sparkle-particle";
        p.textContent = sparkleIcons[i % sparkleIcons.length];
        const rad = (angles[i] * Math.PI) / 180;
        const dist = 28 + Math.random() * 22;
        const dx = `${Math.cos(rad) * dist}px`;
        const dy = `${Math.sin(rad) * dist - 12}px`;
        p.style.setProperty("--dx", dx);
        p.style.setProperty("--dy", dy);
        p.style.right = "8px";
        p.style.top = "-4px";
        badgeWrap.appendChild(p);
        setTimeout(() => { p.remove(); }, 1300);
      }
    }
  }

  // 4. Balayage scintillant sur toute la carte fidélité
  if (bannerWrap && delta > 0) {
    bannerWrap.classList.remove("pts-celebrate");
    void bannerWrap.offsetWidth;
    bannerWrap.classList.add("pts-celebrate");
    setTimeout(() => { bannerWrap.classList.remove("pts-celebrate"); }, 1400);
  }
}

export function renderLoggedInUI(member) {
  const t = getT();
  const loggedOutWrap = document.getElementById("loyaltyLoggedOutView");
  const loggedInWrap = document.getElementById("loyaltyLoggedInView");

  if (loggedOutWrap) loggedOutWrap.style.display = "none";
  if (loggedInWrap) loggedInWrap.style.display = "block";

  const pts = member.points || 0;
  const totalEarned = member.totalEarned || pts;
  const tier = (getVipTier ? getVipTier(pts) : null) || {
    id: "bronze", name: "Bronze", icon: "🥉", ratio: 1.0, bonusLabel: "+0%", badgeClass: "vip-bronze", nextTier: "Silver VIP", ptsToNext: 200 - pts
  };

  const nameEl = document.getElementById("loyaltyMemberName");
  if (nameEl) nameEl.textContent = `${t.hello} ${member.firstName || "Client"}`;

  const vipBadgeEl = document.getElementById("loyaltyVipBadge");
  if (vipBadgeEl) {
    vipBadgeEl.className = `loyalty-vip-pill ${tier.badgeClass}`;
    vipBadgeEl.textContent = `${tier.icon} ${tier.name}`;
  }

  const ptsEl = document.getElementById("loyaltyPointsVal");
  const phone = member.phone;

  // Détection mise à jour des points et déclenchement de l'animation
  if (lastRenderedPhone === phone && lastRenderedPoints !== null && pts !== lastRenderedPoints) {
    const delta = pts - lastRenderedPoints;
    const oldVal = lastRenderedPoints;

    triggerPointsAnimation(delta, pts);

    if (delta > 0) {
      try { playPointsGainedSound(); } catch (e) {}
      const toastMsgs = {
        fr: `🎉 +${delta} points crédités ! Nouveau solde : ${pts} pts`,
        en: `🎉 +${delta} points credited! New balance: ${pts} pts`,
        de: `🎉 +${delta} Punkte gutgeschrieben! Neuer Stand: ${pts} Pkt`,
        es: `🎉 ¡+${delta} puntos acreditados! Nuevo saldo: ${pts} pts`,
        ar: `🎉 تم إضافة +${delta} نقطة ! رصيدكم الجديد: ${pts} نقطة`
      };
      showToast(toastMsgs[currentLang] || toastMsgs.fr);
    }

    animatePointsCounter(ptsEl, oldVal, pts, 1200);
  } else {
    if (ptsEl) ptsEl.textContent = pts;
  }

  lastRenderedPoints = pts;
  lastRenderedPhone = phone;

  const multEl = document.getElementById("loyaltyVipMultiplierText");
  if (multEl) {
    multEl.textContent = t.multiplierLabel.replace("{mult}", `x${tier.ratio}`).replace("{tier}", tier.bonusLabel);
  }

  const lifeEl = document.getElementById("loyaltyVipLifetimeText");
  if (lifeEl) {
    lifeEl.textContent = t.lifetimeLabel.replace("{earned}", totalEarned);
  }

  // Barre de progression
  const nextTarget = pts < 500 ? 500 : (pts < 1000 ? 1000 : 1000);
  const pct = Math.min(100, Math.max(0, (pts / nextTarget) * 100));
  const fillEl = document.getElementById("loyaltyProgressFill");
  if (fillEl) fillEl.style.width = `${pct}%`;

  const statusEl = document.getElementById("loyaltyStatusText");
  const rewardsBox = document.getElementById("loyaltyRewardEligibleBox");
  const claimDrinkBtn = document.getElementById("loyaltyClaimDrinkBtn");
  const claimJuiceBtn = document.getElementById("loyaltyClaimJuiceBtn");
  const bannerWrap = document.getElementById("loyaltyCardBanner");

  const canDrink = pts >= 500;
  const canJuice = pts >= 1000;

  if (canJuice) {
    if (statusEl) {
      statusEl.textContent = "🎉 1 Jus de Fruits OU 1 Boisson Chaude disponible !";
      statusEl.classList.add("ready-celebrate");
    }
    if (bannerWrap) bannerWrap.classList.add("reward-ready-border");
    if (rewardsBox) rewardsBox.style.display = "flex";
    if (claimJuiceBtn) {
      claimJuiceBtn.style.display = "inline-flex";
      claimJuiceBtn.textContent = t.claimJuiceBtn;
    }
    if (claimDrinkBtn) {
      claimDrinkBtn.style.display = "inline-flex";
      claimDrinkBtn.textContent = t.claimDrinkBtn;
    }
  } else if (canDrink) {
    if (statusEl) {
      const remJuice = Math.max(0, 1000 - pts);
      statusEl.textContent = t.juiceRemaining.replace("{rem}", remJuice);
      statusEl.classList.add("ready-celebrate");
    }
    if (bannerWrap) bannerWrap.classList.add("reward-ready-border");
    if (rewardsBox) rewardsBox.style.display = "flex";
    if (claimJuiceBtn) claimJuiceBtn.style.display = "none";
    if (claimDrinkBtn) {
      claimDrinkBtn.style.display = "inline-flex";
      claimDrinkBtn.textContent = t.claimDrinkBtn;
    }
  } else {
    const remDrink = Math.max(0, 500 - pts);
    if (statusEl) {
      statusEl.textContent = t.pointsRemaining.replace("{rem}", remDrink);
      statusEl.classList.remove("ready-celebrate");
    }
    if (bannerWrap) bannerWrap.classList.remove("reward-ready-border");
    if (rewardsBox) rewardsBox.style.display = "none";
    if (claimDrinkBtn) claimDrinkBtn.style.display = "none";
    if (claimJuiceBtn) claimJuiceBtn.style.display = "none";
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

  // Bouton Récompense 1 : Boisson Chaude (500 pts)
  const claimDrinkBtn = document.getElementById("loyaltyClaimDrinkBtn");
  if (claimDrinkBtn && !claimDrinkBtn._hasLoyaltyEvent) {
    claimDrinkBtn._hasLoyaltyEvent = true;
    claimDrinkBtn.addEventListener("click", () => {
      const t = getT();
      const phone = getStoredLoyaltyPhone();
      const name = getStoredLoyaltyName();

      if (!clientTable) {
        showToast(t.tablePrompt);
        setPendingActionAfterTableSelect(() => {
          triggerRewardClaim(phone, name, "hot_drink", t.claimDrinkSent);
        });
        showTableSelectorModal();
        return;
      }

      triggerRewardClaim(phone, name, "hot_drink", t.claimDrinkSent);
    });
  }

  // Bouton Récompense 2 : Jus au Choix (1 000 pts)
  const claimJuiceBtn = document.getElementById("loyaltyClaimJuiceBtn");
  if (claimJuiceBtn && !claimJuiceBtn._hasLoyaltyEvent) {
    claimJuiceBtn._hasLoyaltyEvent = true;
    claimJuiceBtn.addEventListener("click", () => {
      const t = getT();
      const phone = getStoredLoyaltyPhone();
      const name = getStoredLoyaltyName();

      if (!clientTable) {
        showToast(t.tablePrompt);
        setPendingActionAfterTableSelect(() => {
          triggerRewardClaim(phone, name, "juice", t.claimJuiceSent);
        });
        showTableSelectorModal();
        return;
      }

      triggerRewardClaim(phone, name, "juice", t.claimJuiceSent);
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

function triggerRewardClaim(phone, name, rewardType, successMsg) {
  const btn = rewardType === "juice" 
    ? document.getElementById("loyaltyClaimJuiceBtn") 
    : document.getElementById("loyaltyClaimDrinkBtn");

  if (btn) btn.disabled = true;

  dbService.claimLoyaltyRewardRequest(phone, clientTable, name, rewardType, (success) => {
    if (btn) btn.disabled = false;
    if (success) {
      try {
        const chime = new Audio("https://assets.mixkit.co/active_storage/sfx/911/911-200.wav");
        chime.volume = 0.5;
        chime.play();
      } catch(e) {}

      showToast(successMsg);
    } else {
      showToast("Erreur de connexion. Veuillez réessayer.");
    }
  });
}
