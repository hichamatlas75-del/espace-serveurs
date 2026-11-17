/**
 * GREY CORNER — MAIN CLIENT ENTRY POINT (ES Module)
 */

import { isFirebaseActive, db, dbService, whenAuthReady } from './config/firebase.js';
import { menuData } from './data/menu-data.js';
import { currentLang, setLanguage, updatePrixInfo, applyLanguageToStaticTexts, updateHeaderLangUI, t } from './services/i18n.js';
import { updateScheduleUI } from './services/schedule.js';
import { GPSService } from './services/gps.js';
import { initClientCart, saveClientCart, clearCart, addToCart, updateCartUI, showToast } from './services/cart.js';
import { submitPreOrder, submitOrderOrWhatsApp } from './services/orders.js';
import { triggerQuickServiceCall, renderNotificationHistory, subscribeToActiveWaiterEvents, setupNotificationDrawer } from './services/notifications.js';
import {
  openCartDrawer, closeCartDrawer, openTableModal, closeTableModal,
  showTableSelectorModal, parseTableFromUrl, clientTable, updateTableUI,
  setupBurgerMenu,
  GC_showGpsBlocked, GC_hideGpsBlocked, GC_switchGpsTab, GC_dismissGpsBlocked,
  GC_showPreorderModal, GC_hidePreorderModal,
  GC_chooseTableFallback, GC_requestGpsAgain
} from './ui/modals.js';
import { renderMenu, toggleCategoryDrawer, openDrawer, closeDrawer, updateFloatingButtons, setupFloatingButtons } from './ui/menu-render.js';
import { initFeedbackWidget, updateFeedbackTexts } from './ui/feedback.js';
import { initLoyaltyWidget } from './services/loyalty.js';
import { updateSoundUI, toggleSoundMute, playTapSound } from './services/sound.js';

document.addEventListener("DOMContentLoaded", () => {
  const table = parseTableFromUrl();
  initClientCart();
  applyLanguageToStaticTexts();
  initFeedbackWidget();
  initLoyaltyWidget();
  updateHeaderLangUI();
  updateScheduleUI();
  setInterval(updateScheduleUI, 60000);

  // Set initial active flag state based on currentLang
  document.querySelectorAll(".lang-button[data-lang]").forEach(b => {
    b.classList.toggle("active", b.dataset.lang === currentLang);
  });

  renderMenu();
  setupBurgerMenu();
  setupFloatingButtons();
  setupNotificationDrawer(() => clientTable);
  updatePrixInfo();
  updateCartUI();
  updateSoundUI();
  GPSService.init();

  document.querySelectorAll(".gc-sound-toggle-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSoundMute();
    });
  });

  // Back to top button listener
  const btt = document.getElementById("backToTop");
  if (btt) {
    window.addEventListener("scroll", () => {
      btt.classList.toggle("show", window.scrollY > 350);
    }, { passive: true });
    btt.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // System freeze (rush mode) listener from admin
  if (typeof dbService !== "undefined" && typeof dbService.onSystemFreezeChange === "function") {
    dbService.onSystemFreezeChange((frozen) => {
      window.systemFrozen = frozen;
      let banner = document.getElementById("clientFreezeBanner");
      const submitBtn = document.getElementById("cdSubmitBtn");

      if (frozen) {
        if (!banner) {
          banner = document.createElement("div");
          banner.id = "clientFreezeBanner";
          banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(135deg,#c0392b,#962d22);color:#fff;text-align:center;padding:10px 16px;font-family:'DM Sans',sans-serif;font-size:0.82rem;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.3);letter-spacing:0.02em;";
          banner.textContent = "⏳ Mode rush actif : La prise de commande est momentanément suspendue. Merci de votre compréhension !";
          document.body.appendChild(banner);
        } else {
          banner.style.display = "block";
        }
        if (submitBtn) submitBtn.classList.add("frozen-disabled");
      } else {
        if (banner) banner.style.display = "none";
        if (submitBtn) submitBtn.classList.remove("frozen-disabled");
      }
    });
  }

  if (table) {
    subscribeToActiveWaiterEvents(table);
  }

  // ============================================================
  //  LANGUAGE SYSTEM & HEADER DROPDOWN
  // ============================================================

  const headerLangWrapper = document.getElementById("headerLangWrapper");
  const headerLangBtn = document.getElementById("headerLangBtn");

  if (headerLangBtn && headerLangWrapper) {
    headerLangBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = headerLangWrapper.classList.toggle("open");
      headerLangBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (!headerLangWrapper.contains(e.target)) {
        headerLangWrapper.classList.remove("open");
        headerLangBtn.setAttribute("aria-expanded", "false");
      }
    });

    // Close dropdown on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && headerLangWrapper.classList.contains("open")) {
        headerLangWrapper.classList.remove("open");
        headerLangBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  document.querySelectorAll(".lang-button[data-lang]").forEach(btn => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.lang;
      if (setLanguage(lang)) {
        document.querySelectorAll(".lang-button[data-lang]").forEach(b => {
          b.classList.toggle("active", b.dataset.lang === lang);
        });
        if (headerLangWrapper) {
          headerLangWrapper.classList.remove("open");
          if (headerLangBtn) headerLangBtn.setAttribute("aria-expanded", "false");
        }
        renderMenu();
        updateCartUI();
        updateTableUI();
        updateScheduleUI();
        updateFeedbackTexts();
        initLoyaltyWidget();
        if (GPSService && GPSService.lastState) {
          GPSService.updateUI(GPSService.lastState);
        }
      }
    });
  });

  // Allow clicking table badge in cart header to pick/change table
  const tableBadge = document.getElementById("cdTableBadge");
  if (tableBadge) {
    tableBadge.addEventListener("click", showTableSelectorModal);
  }

  // Action Bar & Cart buttons
  const btnCall = document.getElementById("cabCallWaiter");
  const btnWater = document.getElementById("cabRequestWater");
  const btnBill = document.getElementById("cabRequestBill");
  const btnOpenCart = document.getElementById("cabOpenCart");
  const btnCloseCart = document.getElementById("cdCloseBtn");
  const overlayCart = document.getElementById("cartDrawerOverlay");
  const btnSubmitOrder = document.getElementById("cdSubmitBtn");

  if (btnCall) btnCall.addEventListener("click", () => triggerQuickServiceCall(clientTable, "waiter"));
  if (btnWater) btnWater.addEventListener("click", () => triggerQuickServiceCall(clientTable, "water"));
  if (btnBill) btnBill.addEventListener("click", () => triggerQuickServiceCall(clientTable, "bill"));

  if (btnOpenCart) btnOpenCart.addEventListener("click", openCartDrawer);
  if (btnCloseCart) btnCloseCart.addEventListener("click", closeCartDrawer);
  if (overlayCart) overlayCart.addEventListener("click", closeCartDrawer);

  if (btnSubmitOrder) btnSubmitOrder.addEventListener("click", () => submitOrderOrWhatsApp(clientTable));

  // ── Share Menu Button (Native Web Share + Clipboard Fallback) ──
  const shareBtn = document.getElementById("shareMenu");
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const url = window.location.href;
      const texts = {
        fr: { title: "Grey Corner — Menu", text: "🍽️ Découvrez le menu Grey Corner Café à Fès !" },
        en: { title: "Grey Corner — Menu", text: "🍽️ Discover the Grey Corner Café menu in Fès!" },
        de: { title: "Grey Corner — Menü", text: "🍽️ Entdecken Sie das Menü des Grey Corner Café in Fès!" },
        es: { title: "Grey Corner — Menú", text: "🍽️ ¡Descubra la carta de Grey Corner Café en Fez!" },
        ar: { title: "Grey Corner — قائمة الطعام", text: "🍽️ اكتشف قائمة مقهى Grey Corner في فاس!" }
      };
      const tShare = texts[currentLang] || texts.fr;

      if (navigator.share) {
        try {
          await navigator.share({ title: tShare.title, text: tShare.text, url });
          return;
        } catch (e) {
          // Fallback if user cancels
        }
      }

      // Desktop clipboard fallback
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.cssText = "position:fixed;opacity:0;top:0;left:0;";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }

      const toastMsg = {
        fr: "Lien copié ✓",
        en: "Link copied ✓",
        de: "Link kopiert ✓",
        es: "Enlace copiado ✓",
        ar: "تم نسخ الرابط ✓"
      };
      const toast = document.getElementById("scToast");
      if (toast) {
        toast.textContent = toastMsg[currentLang] || toastMsg.fr;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 2400);
      } else {
        showToast(toastMsg[currentLang] || toastMsg.fr);
      }
    });
  }

  console.log("🚀 Main ES Module initialized successfully.");
});
