/**
 * GREY CORNER — ORDERS SERVICE (ES Module)
 */

import { currentLang } from './i18n.js';
import { clientCart, saveClientCart, clearCart, showToast, checkCartBlockedItems } from './cart.js';
import { db, dbService, sendFcmToWaiters, getTableZoneName } from '../config/firebase.js';
import { showTableSelectorModal, setPendingActionAfterTableSelect } from '../ui/modals.js';
import { subscribeToActiveWaiterEvents, listenToClientOrder } from './notifications.js';
import { playOrderSuccessSound } from './sound.js';

export const WHATSAPP_NUMBER = '212666265160';

export function GC_sendWhatsApp() {
  if (!clientCart || clientCart.length === 0) {
    const emptyMsgs = {
      fr: 'Votre panier est vide.',
      en: 'Your cart is empty.',
      de: 'Ihr Warenkorb ist leer.',
      es: 'Su cesta está vacía.',
      ar: 'سلتكم فارغة.'
    };
    alert(emptyMsgs[currentLang] || emptyMsgs.fr);
    return;
  }

  const blockedCheck = checkCartBlockedItems();
  if (blockedCheck.blocked) {
    showToast(blockedCheck.message);
    return;
  }

  const lang = currentLang || localStorage.getItem('lang') || 'fr';
  const modeLabel = window.GC_preorderMode === 'pickup'
    ? 'À emporter (comptoir)'
    : ('À table' + (window.GC_preorderTable ? ' n°' + window.GC_preorderTable : " — numéro à préciser à l'arrivée"));
  let lines = '', total = 0;
  clientCart.forEach(item => {
    const qty = item.qty || 1;
    const price = item.price || 0;
    const sub = price * qty;
    total += sub;
    const name = (item.name && typeof item.name === 'object')
      ? (item.name[lang] || item.name.fr || Object.values(item.name)[0])
      : (item.name || 'Article');
    const drinkInfo = (item.drinkChoices && item.drinkChoices.length > 0)
      ? ' (' + item.drinkChoices.join(', ') + ')'
      : '';
    lines += `• ${name}${drinkInfo}${qty > 1 ? ' x' + qty : ''} — ${sub} MAD\n`;
  });
  const noteEl = document.getElementById('cdSpecialNote');
  const noteText = noteEl && noteEl.value.trim() ? '\n📝 Note : ' + noteEl.value.trim() : '';
  const msg = `🛒 *Précommande Grey Corner*\nMode : ${modeLabel}\n─────────────────────\n${lines}─────────────────────\n💰 Total : ${total} MAD${noteText}`;
  window.open('https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(msg), '_blank');
  setTimeout(() => {
    clearCart();
    if (noteEl) noteEl.value = '';
    const ov = document.getElementById('cartDrawerOverlay');
    const dr = document.getElementById('cartDrawer');
    if (ov) ov.classList.remove('active');
    if (dr) dr.classList.remove('active');
    document.body.style.overflow = '';
  }, 600);
}

export function submitOrderOrWhatsApp(clientTable, onComplete) {
  if (window.GC_isPreorder) {
    const blockedCheck = checkCartBlockedItems();
    if (blockedCheck.blocked) {
      showToast(blockedCheck.message);
      if (onComplete) onComplete();
      return;
    }
    GC_sendWhatsApp();
    if (onComplete) onComplete();
    return;
  }
  submitPreOrder(clientTable, onComplete);
}

export function submitPreOrder(clientTable, onComplete) {
  if (!clientCart || clientCart.length === 0) return;

  const btn = document.getElementById("cdSubmitBtn");
  const spinner = document.getElementById("cdSubmitSpinner");

  const resetBtn = () => {
    if (btn) btn.disabled = false;
    if (spinner) spinner.style.display = "none";
    if (onComplete) onComplete();
  };

  const blockedCheck = checkCartBlockedItems();
  if (blockedCheck.blocked) {
    resetBtn();
    showToast(blockedCheck.message);
    return;
  }

  if (window.systemFrozen) {
    const frozenMsgs = {
      fr: "Le service est temporairement suspendu (mode rush). Merci de patienter un instant.",
      en: "Service is temporarily paused (rush mode). Please wait a moment.",
      de: "Der Service ist vorübergehend pausiert (Stoßzeit). Bitte warten Sie einen Moment.",
      es: "El servicio está temporalmente suspendido (modo hora punta). Gracias por su paciencia.",
      ar: "الخدمة معلقة مؤقتاً (فترة الذروة). يرجى الانتظار لحظات."
    };
    showToast(frozenMsgs[currentLang] || frozenMsgs.fr);
    return;
  }

  if (!clientTable) {
    resetBtn();
    const tableMsgs = {
      fr: "Veuillez choisir votre numéro de table avant d'envoyer la commande.",
      en: "Please select your table number before sending the order.",
      de: "Bitte wählen Sie Ihre Tischnummer, bevor Sie die Bestellung senden.",
      es: "Por favor, elija su número de mesa antes de enviar el pedido.",
      ar: "يرجى اختيار رقم طاولتك قبل إرسال الطلب."
    };
    showToast(tableMsgs[currentLang] || tableMsgs.fr);
    setPendingActionAfterTableSelect((selectedTable) => submitPreOrder(selectedTable, onComplete));
    showTableSelectorModal();
    return;
  }

  if (btn) {
    if (btn.disabled) return;
    btn.disabled = true;
  }
  if (spinner) spinner.style.display = "block";

  const note = document.getElementById("cdSpecialNote") ? document.getElementById("cdSpecialNote").value : "";
  const totalPrice = clientCart.reduce((sum, item) => sum + (item.price * item.qty), 0);

  const itemsList = clientCart.map(c => {
    let nameFr = c.name.fr || c.name;
    if (c.drinkChoices && c.drinkChoices.length > 0) {
      nameFr += ` (${c.drinkChoices.join(', ')})`;
    }
    return {
      name: nameFr,
      name_lang: nameFr,
      category: c.categoryNameFr || "",
      price: c.price.toString(),
      qty: c.qty,
      note: c.note || ""
    };
  });

  const loyaltyPhone = localStorage.getItem("gc_loyalty_phone") || "";
  const loyaltyName = localStorage.getItem("gc_loyalty_name") || "";
  const loyaltyInfo = loyaltyPhone ? { phone: loyaltyPhone, name: loyaltyName } : null;

  dbService.sendPreOrder(clientTable, itemsList, note, totalPrice, loyaltyInfo, (success, orderId) => {
    resetBtn();
    if (success) {
      playOrderSuccessSound();

      const okMsgs = {
        fr: "Précommande envoyée ! Le serveur arrive la confirmer.",
        en: "Pre-order sent! The waiter is coming to confirm.",
        de: "Vorbestellung gesendet! Der Kellner kommt zur Bestätigung.",
        es: "¡Pedido anticipado enviado! El camarero viene a confirmarlo.",
        ar: "تم إرسال الطلب المسبق ! النادل قادم لتأكيده."
      };
      showToast(okMsgs[currentLang] || okMsgs.fr);

      clearCart();
      if (document.getElementById("cdSpecialNote")) {
        document.getElementById("cdSpecialNote").value = "";
      }

      const cdOverlay = document.getElementById("cartDrawerOverlay");
      const cdDrawer = document.getElementById("cartDrawer");
      if (cdOverlay) cdOverlay.classList.remove("active");
      if (cdDrawer) cdDrawer.classList.remove("active");
      document.body.classList.remove("no-scroll");

      try {
        localStorage.setItem("last_pre_order_id", String(orderId));
        localStorage.setItem("last_pre_order_time", String(Date.now()));
      } catch (e) {}

      // Armement de la notification de secours au cas où le serveur n'a pas réagi
      armBackupOrderReminder(orderId, clientTable, totalPrice);

      // Subscribe strictly to this pre-order status update
      if (typeof listenToClientOrder === "function") {
        listenToClientOrder(orderId, clientTable);
      } else {
        subscribeToActiveWaiterEvents(clientTable);
      }
    } else {
      const errMsgs = {
        fr: "Erreur de connexion. Veuillez réessayer.",
        en: "Connection error. Please try again.",
        de: "Verbindungsfehler. Bitte versuchen Sie es erneut.",
        es: "Error de conexión. Por favor, inténtelo de nuevo.",
        ar: "خطأ في الاتصال. يرجى المحاولة مرة أخرى."
      };
      showToast(errMsgs[currentLang] || errMsgs.fr);
    }
  });
}

/**
 * Surveillance et relance automatique de secours si la commande n'est pas acceptée
 */
function armBackupOrderReminder(orderId, table, total) {
  if (!orderId || !table) return;

  // Secours N°1 après 25 secondes si toujours en attente
  setTimeout(() => {
    const checkOrder = (order) => {
      if (order && order.status === "pending") {
        console.log("🚨 NOTIFICATION DE SECOURS (25s) : Commande toujours en attente !");
        const zone = getTableZoneName ? getTableZoneName(table) : `Table ${table}`;
        sendFcmToWaiters(
          "PRE_ORDER",
          `⚠️ RAPPEL DE SECOURS — ${zone}`,
          `Commande non validée après 25s ! Total : ${total} MAD`,
          table,
          orderId
        );
      }
    };
    if (typeof dbService !== "undefined" && dbService && typeof dbService.getOrder === "function") {
      dbService.getOrder(orderId, checkOrder);
    }
  }, 25000);

  // Secours N°2 d'urgence après 55 secondes
  setTimeout(() => {
    const checkOrder = (order) => {
      if (order && order.status === "pending") {
        console.log("🚨 ALARME D'URGENCE (55s) : Relance finale de secours !");
        const zone = getTableZoneName ? getTableZoneName(table) : `Table ${table}`;
        sendFcmToWaiters(
          "PRE_ORDER",
          `🚨 ALARME URGENTE — ${zone}`,
          `Commande EN ATTENTE depuis 1 min ! Le client attend.`,
          table,
          orderId
        );
      }
    };
    if (typeof dbService !== "undefined" && dbService && typeof dbService.getOrder === "function") {
      dbService.getOrder(orderId, checkOrder);
    }
  }, 55000);
}

window.submitPreOrder = submitPreOrder;
window.submitOrderOrWhatsApp = submitOrderOrWhatsApp;
window.GC_sendWhatsApp = GC_sendWhatsApp;
