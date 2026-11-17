/**
 * GREY CORNER — CLIENT BASKET / CART SERVICE (ES Module)
 */

import { currentLang } from './i18n.js';
import {
  isBreakfastAvailable,
  isKitchenAvailable,
  isKitchenCategory,
  isCouscousAvailable,
  isCouscousCategory,
  getKitchenBlockedMessage,
  getBreakfastBlockedMessage,
  getCouscousBlockedMessage
} from './schedule.js';
import { playAddToCartSound, playTapSound } from './sound.js';

export let clientCart = [];

export function initClientCart() {
  clientCart.length = 0;
  try {
    const items = JSON.parse(localStorage.getItem("grey_cart") || "[]");
    if (Array.isArray(items)) {
      items.forEach(item => clientCart.push(item));
    }
  } catch (e) {
    clientCart.length = 0;
  }
  updateCartUI();
}

export function saveClientCart() {
  localStorage.setItem("grey_cart", JSON.stringify(clientCart));
  updateCartUI();
}

export function clearCart() {
  clientCart.length = 0;
  saveClientCart();
}

export function showToast(message) {
  let toast = document.getElementById("toastNotification");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toastNotification";
    toast.className = "toast-notification";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

export function addToCart(menuItem, choices = null) {
  if (!menuItem) return;

  const catId = menuItem.categoryId || "";
  const nameFr = (menuItem.name && menuItem.name.fr) ? menuItem.name.fr : String(menuItem.name || "");
  if (catId === "petit-dejeuner" && !isBreakfastAvailable()) {
    showToast(getBreakfastBlockedMessage(currentLang));
    return;
  }
  if (isCouscousCategory(catId, nameFr) && !isCouscousAvailable()) {
    showToast(getCouscousBlockedMessage(currentLang));
    return;
  }
  if (isKitchenCategory(catId) && !isKitchenAvailable()) {
    showToast(getKitchenBlockedMessage(currentLang));
    return;
  }

  let cartItemId = menuItem.name.fr;
  if (choices && choices.length > 0) {
    cartItemId += `_${choices.join('_')}`;
  }

  const existingIndex = clientCart.findIndex(item => item.id === cartItemId);
  if (existingIndex !== -1) {
    clientCart[existingIndex].qty += 1;
  } else {
    clientCart.push({
      id: cartItemId,
      name: menuItem.name,
      categoryId: catId,
      categoryNameFr: menuItem.categoryNameFr || "",
      price: parseFloat(menuItem.price) || 0,
      image: menuItem.image,
      qty: 1,
      note: "",
      drinkChoices: choices
    });
  }
  saveClientCart();
  playAddToCartSound();
  const toastMsgs = {
    fr: "Ajouté au panier !",
    en: "Added to basket !",
    de: "In den Korb gelegt !",
    es: "¡Añadido a la cesta!",
    ar: "تمت إضافته إلى السلة !"
  };
  const choicesStr = (choices && choices.length > 0) ? ` (${choices.join(', ')})` : '';
  showToast(`${menuItem.name[currentLang] || menuItem.name.fr}${choicesStr} — ${toastMsgs[currentLang] || toastMsgs.fr}`);
}

export function checkCartBlockedItems(cart = clientCart) {
  if (!cart || cart.length === 0) return { blocked: false };
  const breakfastBlocked = !isBreakfastAvailable();
  const kitchenBlocked = !isKitchenAvailable();
  const couscousBlocked = !isCouscousAvailable();

  for (const item of cart) {
    let catId = item.categoryId;
    if (!catId && item.categoryNameFr) {
      catId = item.categoryNameFr.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }
    const nameFr = (item.name && item.name.fr) ? item.name.fr : String(item.name || "");
    if (catId === "petit-dejeuner" && breakfastBlocked) {
      return {
        blocked: true,
        reason: "breakfast",
        message: getBreakfastBlockedMessage(currentLang),
        item
      };
    }
    if (isCouscousCategory(catId, nameFr) && couscousBlocked) {
      return {
        blocked: true,
        reason: "couscous",
        message: getCouscousBlockedMessage(currentLang),
        item
      };
    }
    if (isKitchenCategory(catId) && kitchenBlocked) {
      return {
        blocked: true,
        reason: "kitchen",
        message: getKitchenBlockedMessage(currentLang),
        item
      };
    }
  }
  return { blocked: false };
}

export function updateCartUI() {
  const badge = document.getElementById("cabCartBadge");
  const totalItems = clientCart.reduce((sum, item) => sum + item.qty, 0);

  if (badge) {
    if (totalItems > 0) {
      badge.textContent = totalItems;
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }
  }

  const cdItemsList = document.getElementById("cdItemsList");
  const cdEmptyState = document.getElementById("cdEmptyState");
  const cdNotesSection = document.getElementById("cdNotesSection");
  const cdFooter = document.getElementById("cdFooter");
  const cdTotalPrice = document.getElementById("cdTotalPrice");

  if (cdItemsList) {
    if (clientCart.length === 0) {
      cdItemsList.innerHTML = "";
      if (cdEmptyState) cdEmptyState.style.display = "flex";
      if (cdNotesSection) cdNotesSection.style.display = "none";
      if (cdFooter) cdFooter.style.display = "none";
    } else {
      if (cdEmptyState) cdEmptyState.style.display = "none";
      if (cdNotesSection) cdNotesSection.style.display = "flex";
      if (cdFooter) cdFooter.style.display = "block";

      cdItemsList.innerHTML = "";
      clientCart.forEach(item => {
        const itemDiv = document.createElement("div");
        itemDiv.className = "cd-item";
        const catLower = (item.categoryNameFr || "").toLowerCase();
        const isDrinkItem = catLower.includes("boisson") ||
          catLower.includes("petit-d") ||
          catLower.includes("café");
        const isIceCream = catLower.includes("glace");
        const isDessertItem = catLower.includes("gateau") ||
          catLower.includes("gâteau") ||
          catLower.includes("crêpe") ||
          catLower.includes("crepe");
        const choiceIcon = isDrinkItem ? '☕' : (isIceCream ? '🍨' : (isDessertItem ? '🍰' : '🍽️'));
        const drinkChoicesStr = item.drinkChoices && item.drinkChoices.length > 0
          ? `<div style="font-size:0.75rem; color:var(--sc-gold-light); margin-top:2px;">${choiceIcon} ${item.drinkChoices.join(', ')}</div>`
          : '';

        const itemCatId = item.categoryId || (item.categoryNameFr ? item.categoryNameFr.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : "");
        const itemNameFr = (item.name && item.name.fr) ? item.name.fr : String(item.name || "");
        const isItemBreakfastBlocked = (itemCatId === "petit-dejeuner" && !isBreakfastAvailable());
        const isItemCouscousBlocked = (isCouscousCategory(itemCatId, itemNameFr) && !isCouscousAvailable());
        const isItemKitchenBlocked = (isKitchenCategory(itemCatId) && !isKitchenAvailable());
        const isItemBlocked = isItemBreakfastBlocked || isItemKitchenBlocked || isItemCouscousBlocked;

        const couscousTagText = currentLang === 'en' ? 'Fridays 12:00-17:00 only'
          : currentLang === 'ar' ? 'الجمعة 12-17 فقط'
          : currentLang === 'es' ? 'Viernes 12h-17h solo'
          : currentLang === 'de' ? 'Nur Fr. 12-17h'
          : 'Vendredi 12h-17h uniquement';

        const blockedBadge = isItemBlocked
          ? `<div class="cd-item-blocked-tag" style="display:inline-flex; align-items:center; gap:4px; font-size:0.72rem; color:#ef4444; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.25); border-radius:4px; padding:2px 6px; margin-top:3px; font-weight:500;">
               <span>⚠️</span> ${isItemCouscousBlocked
                 ? couscousTagText
                 : isItemBreakfastBlocked
                   ? (currentLang === 'en' ? 'Breakfast ended' : currentLang === 'ar' ? 'فطور الصباح انتهى' : 'Petit-déjeuner terminé')
                   : (currentLang === 'en' ? 'Kitchen closed' : currentLang === 'ar' ? 'المطبخ مغلق' : 'Cuisine fermée')}
             </div>`
          : '';

        if (isItemBlocked) {
          itemDiv.classList.add("cd-item-disabled");
          itemDiv.style.opacity = "0.78";
        }

        itemDiv.innerHTML = `
          <div class="cd-item-img" style="background-image: url('${item.image}')"></div>
          <div class="cd-item-details">
            <h4 class="cd-item-name">${item.name[currentLang] || item.name.fr || item.name}</h4>
            ${drinkChoicesStr}
            ${blockedBadge}
            <span class="cd-item-price">${item.price * item.qty} MAD</span>
          </div>
          <div class="cd-item-actions">
            <div class="cd-qty-wrap">
              <button class="cd-qty-btn cd-dec" data-id="${item.id}">-</button>
              <span class="cd-qty-num">${item.qty}</span>
              <button class="cd-qty-btn cd-inc" data-id="${item.id}">+</button>
            </div>
            <button class="cd-remove-btn" data-id="${item.id}" title="Supprimer">🗑️</button>
          </div>
        `;

        itemDiv.querySelector(".cd-dec").addEventListener("click", () => {
          playTapSound();
          const idx = clientCart.findIndex(c => c.id === item.id);
          if (idx !== -1) {
            if (clientCart[idx].qty > 1) {
              clientCart[idx].qty -= 1;
            } else {
              clientCart.splice(idx, 1);
            }
            saveClientCart();
          }
        });

        itemDiv.querySelector(".cd-inc").addEventListener("click", () => {
          playAddToCartSound();
          const idx = clientCart.findIndex(c => c.id === item.id);
          if (idx !== -1) {
            clientCart[idx].qty += 1;
            saveClientCart();
          }
        });

        itemDiv.querySelector(".cd-remove-btn").addEventListener("click", () => {
          playTapSound();
          const idx = clientCart.findIndex(c => c.id === item.id);
          if (idx !== -1) {
            clientCart.splice(idx, 1);
            saveClientCart();
          }
        });

        cdItemsList.appendChild(itemDiv);
      });

      const totalPrice = clientCart.reduce((sum, item) => sum + (item.price * item.qty), 0);
      if (cdTotalPrice) cdTotalPrice.textContent = `${totalPrice} MAD`;

      // Warning banner if any cart items are blocked
      const blockedCheck = checkCartBlockedItems();
      let blockedNoticeEl = document.getElementById("cdBlockedNotice");
      if (blockedCheck.blocked) {
        if (!blockedNoticeEl && cdFooter) {
          blockedNoticeEl = document.createElement("div");
          blockedNoticeEl.id = "cdBlockedNotice";
          blockedNoticeEl.className = "cd-blocked-alert";
          blockedNoticeEl.style.cssText = "background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:8px 12px; margin-bottom:12px; font-size:0.78rem; color:#ef4444; line-height:1.35; text-align:left;";
          cdFooter.insertBefore(blockedNoticeEl, cdFooter.firstChild);
        }
        if (blockedNoticeEl) {
          const noticeTexts = {
            fr: "⚠️ <strong>Attention :</strong> Certains articles de votre panier ne sont pas disponibles actuellement aux horaires de service. Veuillez les retirer (🗑️) pour valider votre commande.",
            en: "⚠️ <strong>Notice:</strong> Some items in your cart are outside service hours. Please remove them (🗑️) to submit your order.",
            de: "⚠️ <strong>Hinweis:</strong> Einige Artikel in Ihrem Korb liegen außerhalb der Servicezeiten. Bitte entfernen Sie sie (🗑️), um zu bestellen.",
            es: "⚠️ <strong>Aviso:</strong> Algunos artículos de su cesta están fuera del horario de servicio. Elimínelos (🗑️) para realizar el pedido.",
            ar: "⚠️ <strong>تنبيه :</strong> بعض المنتجات في سلتك غير متوفرة حالياً خارج أوقات الخدمة. يرجى حذفها (🗑️) لإتمام الطلب."
          };
          blockedNoticeEl.innerHTML = noticeTexts[currentLang] || noticeTexts.fr;
          blockedNoticeEl.style.display = "block";
        }
      } else if (blockedNoticeEl) {
        blockedNoticeEl.style.display = "none";
      }
    }
  }
}

// Bind to window for backwards compatibility
window.clientCart = clientCart;
window.initClientCart = initClientCart;
window.saveClientCart = saveClientCart;
window.clearCart = clearCart;
window.addToCart = addToCart;
window.checkCartBlockedItems = checkCartBlockedItems;
window.updateCartUI = updateCartUI;
window.showToast = showToast;
