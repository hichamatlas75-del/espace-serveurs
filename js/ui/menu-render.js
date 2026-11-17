/**
 * GREY CORNER — TACTILE HUB MENU RENDERING & UI COMPONENT (ES Module)
 * Modèle HUB Tactile : Grandes pastilles catégories & Plats imposants
 * 100% Mobile First, Black & Gold Luxury Style
 */

import { menuData } from '../data/menu-data.js';
import { currentLang } from '../services/i18n.js';
import { addToCart, showToast } from '../services/cart.js';
import { closeBurgerMenu, checkItemOptionsAndAdd } from './modals.js';
import {
  isBreakfastAvailable,
  isKitchenAvailable,
  isKitchenCategory,
  isCouscousAvailable,
  isCouscousCategory,
  getCouscousScheduleInfo,
  getCouscousNoticeInner,
  getCouscousBlockedMessage,
  getKitchenScheduleInfo,
  getKitchenBlockedMessage,
  getBreakfastBlockedMessage,
  getKitchenNoticeInner,
  getBreakfastNoticeInner
} from '../services/schedule.js';

export let activeCategoryId = null;
export let isViewAllMode = false;
let imagesProtected = false;
let activeLightboxItem = null;

/**
 * SVG Icons for Category Pastille Badges
 */
function getCategorySvgIcon(categoryId) {
  const icons = {
    "petit-dejeuner": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>`,
    "entrees": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"></path><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"></path></svg>`,
    "entrees-chaudes": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>`,
    "plats": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1z"></path><path d="M4 18a8 8 0 0 1 16 0"></path><line x1="12" y1="6" x2="12" y2="3"></line></svg>`,
    "couscous-vendredi": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 5H9l3-5z"></path><path d="M5 14a7 7 0 0 0 14 0H5z"></path><path d="M3 18h18v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2z"></path></svg>`,
    "sandwichs": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="6" rx="3"></rect><path d="M5 11a7 7 0 0 1 14 0"></path><line x1="3" y1="14" x2="21" y2="14"></line></svg>`,
    "burgers": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a8 8 0 0 1 16 0H4z"></path><rect x="3" y="15" width="18" height="4" rx="2"></rect><line x1="5" y1="13" x2="19" y2="13"></line></svg>`,
    "panini": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="9" ry="5"></ellipse><line x1="8" y1="10" x2="10" y2="14"></line><line x1="12" y1="10" x2="14" y2="14"></line></svg>`,
    "pizza": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l9 16a2 2 0 0 1-1.7 3H4.7A2 2 0 0 1 3 18L12 2z"></path><circle cx="12" cy="12" r="1.5" fill="currentColor"></circle><circle cx="9" cy="16" r="1" fill="currentColor"></circle><circle cx="15" cy="15" r="1" fill="currentColor"></circle></svg>`,
    "pasta": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v10"></path><path d="M9 8c1.5 2 4.5 2 6 0"></path><path d="M9 16c1.5-2 4.5-2 6 0"></path></svg>`,
    "crepes": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="8" rx="8" ry="4"></ellipse><path d="M4 8v4c0 2.2 3.6 4 8 4s8-1.8 8-4V8"></path><path d="M4 12v4c0 2.2 3.6 4 8 4s8-1.8 8-4v-4"></path></svg>`,
    "crepes-salees": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V6s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>`,
    "gateaux": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"></path><path d="M4 16s2-1 4-1 4 1 4 1 2-1 4-1 4 1 4 1"></path><path d="M2 21h20"></path><circle cx="12" cy="5" r="2"></circle></svg>`,
    "boissons-chaudes": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><path d="M6 2v3"></path><path d="M10 2v3"></path><path d="M14 2v3"></path></svg>`,
    "soda": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="16" rx="3"></rect><line x1="6" y1="8" x2="18" y2="8"></line><line x1="10" y1="2" x2="14" y2="2"></line></svg>`,
    "eau-minerale": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>`,
    "boissons": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"></path><path d="M12 15v6"></path><path d="M17 3l3 8H4l3-8h10z"></path></svg>`,
    "ice-tea": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l-1.5 16a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2L6 3z"></path><line x1="6" y1="8" x2="18" y2="8"></line><line x1="14" y1="2" x2="16" y2="12"></line></svg>`,
    "ice-coffee": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12l-1.5 16a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2L6 4z"></path><rect x="9" y="10" width="3" height="3" rx="0.5"></rect><rect x="12" y="13" width="3" height="3" rx="0.5"></rect></svg>`,
    "frappuccino": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8h10l-1.2 13a2 2 0 0 1-2 1.8H10.2a2 2 0 0 1-2-1.8L7 8z"></path><path d="M7 8a5 5 0 0 1 10 0"></path><line x1="12" y1="2" x2="15" y2="12"></line></svg>`,
    "cocktails": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 22h8"></path><path d="M12 15v7"></path><path d="M5 3l7 8 7-8H5z"></path></svg>`,
    "mojito": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="16" rx="2"></rect><circle cx="12" cy="11" r="3"></circle><line x1="12" y1="2" x2="12" y2="4"></line></svg>`,
    "smoothies": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 6h10l-1.5 14a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2L7 6z"></path><path d="M12 6c-2-3 2-4 0-6"></path><path d="M16 3l-2 3"></path></svg>`,
    "smoothie-bowl": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12a10 10 0 0 0 20 0H2z"></path><circle cx="8" cy="8" r="1.5"></circle><circle cx="12" cy="6" r="1.5"></circle><circle cx="16" cy="8" r="1.5"></circle></svg>`,
    "milkshakes": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8h8l-1.2 12a2 2 0 0 1-2 2h-1.6a2 2 0 0 1-2-2L8 8z"></path><path d="M8 8a4 4 0 0 1 8 0"></path><line x1="12" y1="2" x2="14" y2="10"></line></svg>`,
    "glace": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10a6 6 0 0 1 12 0c0 4-3 6-6 6s-6-2-6-6z"></path><path d="M12 16v5"></path><path d="M8 21h8"></path></svg>`
  };

  return icons[categoryId] || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v8"></path><path d="M8 12h8"></path></svg>`;
}

/**
 * Normalise or generate Category ID
 */
function getCatId(category) {
  if (category.id) return category.id;
  const fr = (category.category && category.category.fr) ? category.category.fr : "";
  return fr.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Get category representative image
 */
function getCatImage(category) {
  if (category.items && category.items.length > 0 && category.items[0].image) {
    return category.items[0].image;
  }
  return "images/logo-gold.webp";
}

/**
 * Determine default initial category:
 * - If during breakfast hours (until 13h weekdays, 14h weekends): starts at "petit-dejeuner"
 * - If outside breakfast hours: skips "petit-dejeuner" and starts directly at "entrees" (Entrées froides)
 */
export function getDefaultInitialCategoryId() {
  if (!menuData || menuData.length === 0) return null;

  if (isBreakfastAvailable()) {
    return getCatId(menuData[0]); // "petit-dejeuner"
  }

  // Hors horaire petit-déjeuner : sauter le petit-déjeuner et commencer directement sur les entrées froides ("entrees")
  const entreesCat = menuData.find(c => getCatId(c) === "entrees");
  if (entreesCat) {
    return "entrees";
  }

  return menuData.length > 1 ? getCatId(menuData[1]) : getCatId(menuData[0]);
}

/**
 * Render the Category Pastilles Hub
 */
export function renderCategoryPastilles() {
  const container = document.getElementById("hubCategories");
  if (!container || !menuData || !Array.isArray(menuData)) return;

  if (!activeCategoryId && menuData.length > 0) {
    activeCategoryId = getDefaultInitialCategoryId();
  }

  container.innerHTML = "";

  menuData.forEach((category) => {
    const catId = getCatId(category);
    const catName = (category.category && (category.category[currentLang] || category.category.fr)) || catId;
    const catImg = getCatImage(category);
    const iconSvg = getCategorySvgIcon(catId);
    const isActive = (catId === activeCategoryId && !isViewAllMode);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `hub-cat-item ${isActive ? "active" : ""}`;
    btn.dataset.catId = catId;
    btn.setAttribute("aria-label", catName);

    btn.innerHTML = `
      <div class="hub-cat-circle">
        <img src="${catImg}" alt="${catName}" class="hub-cat-img" loading="lazy" />
        <div class="hub-cat-overlay"></div>
        <div class="hub-cat-icon">${iconSvg}</div>
      </div>
      <span class="hub-cat-label">${catName}</span>
    `;

    btn.addEventListener("click", () => {
      selectCategory(catId);
    });

    container.appendChild(btn);

    if (isActive) {
      setTimeout(() => {
        btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }, 80);
    }
  });
}

/**
 * Select a category and display its dishes
 */
export function selectCategory(catId, smoothScroll = true) {
  activeCategoryId = catId;
  isViewAllMode = false;

  // Clear search input
  const searchInput = document.getElementById("searchInput");
  const clearBtn = document.getElementById("searchClearBtn");
  if (searchInput && searchInput.value) {
    searchInput.value = "";
    if (clearBtn) clearBtn.style.display = "none";
  }

  // Update active pastille UI
  const pastilles = document.querySelectorAll(".hub-cat-item");
  pastilles.forEach(p => {
    const isThis = p.dataset.catId === catId;
    p.classList.toggle("active", isThis);
    if (isThis) {
      p.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  });

  // Render dishes for this category
  renderDishes();

  // Scroll to dishes area smoothly if user is scrolled past
  if (smoothScroll) {
    const hubNav = document.querySelector(".hub-categories-wrap");
    const offset = hubNav ? hubNav.offsetHeight + 10 : 120;
    const menuGrid = document.getElementById("menu-grid");
    if (menuGrid) {
      const targetY = menuGrid.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({
        top: Math.max(0, targetY),
        behavior: "smooth"
      });
    }
  }

  closeBurgerMenu();
}

/**
 * Switch to View All Mode (Tous les plats)
 */
export function showAllDishes() {
  isViewAllMode = true;
  document.querySelectorAll(".hub-cat-item").forEach(p => p.classList.remove("active"));
  renderDishes();
}

/**
 * Render Dish Cards
 */
export function renderDishes(filterTerm = "") {
  const menuGrid = document.getElementById("menu-grid");
  if (!menuGrid || !menuData) return;

  const term = (filterTerm || "").toLowerCase().trim();

  // 1. SEARCH MODE: filter across all dishes
  if (term) {
    menuGrid.innerHTML = "";
    const resultsWrap = document.createElement("div");
    resultsWrap.className = "hub-results-wrap";

    const titleTexts = {
      fr: `Résultats pour "${filterTerm}"`,
      en: `Results for "${filterTerm}"`,
      de: `Ergebnisse für "${filterTerm}"`,
      ar: `نتائج البحث عن "${filterTerm}"`
    };

    resultsWrap.innerHTML = `
      <div class="hub-section-header">
        <div class="hub-header-left">
          <h2 class="hub-section-title">${titleTexts[currentLang] || titleTexts.fr}</h2>
        </div>
      </div>
      <div class="hub-dishes-grid"></div>
    `;

    const grid = resultsWrap.querySelector(".hub-dishes-grid");
    let matchCount = 0;

    menuData.forEach(cat => {
      const catId = getCatId(cat);
      const catName = cat.category[currentLang] || cat.category.fr;

      (cat.items || []).forEach((item, idx) => {
        const name = (item.name[currentLang] || item.name.fr || "").toLowerCase();
        const desc = (item.description[currentLang] || item.description.fr || "").toLowerCase();

        if (name.includes(term) || desc.includes(term)) {
          matchCount++;
          item.categoryId = catId;
          item.categoryNameFr = cat.category.fr;
          grid.appendChild(createDishCard(item, catId, idx, catName));
        }
      });
    });

    if (matchCount === 0) {
      const noResultsTexts = {
        fr: "Aucun plat trouvé pour cette recherche.",
        en: "No dish found for this search.",
        de: "Kein Gericht für diese Suche gefunden.",
        ar: "لم يتم العثور على أي طبق لهذا البحث."
      };
      grid.innerHTML = `<div class="hub-no-results">${noResultsTexts[currentLang] || noResultsTexts.fr}</div>`;
    }

    menuGrid.appendChild(resultsWrap);
    return;
  }

  // 2. VIEW ALL MODE: all categories in succession
  if (isViewAllMode) {
    menuGrid.innerHTML = "";
    const allWrap = document.createElement("div");
    allWrap.className = "hub-view-all-wrap";

    const viewAllTitle = {
      fr: "Tous nos plats & spécialités",
      en: "All our dishes & specialties",
      de: "Alle unsere Gerichte & Spezialitäten",
      ar: "جميع الأطباق والمشروبات"
    };

    allWrap.innerHTML = `
      <div class="hub-section-header hub-view-all-header">
        <h2 class="hub-section-title">${viewAllTitle[currentLang] || viewAllTitle.fr}</h2>
      </div>
    `;

    menuData.forEach(cat => {
      const catId = getCatId(cat);
      const catName = cat.category[currentLang] || cat.category.fr;
      const catSection = document.createElement("section");
      catSection.className = "hub-category-section";
      catSection.id = `cat-section-${catId}`;

      const isBreakfastCat = (catId === "petit-dejeuner");
      const isEntreesCat = (catId === "entrees");

      catSection.innerHTML = `
        <div class="hub-section-header">
          <div class="hub-header-left">
            <h3 class="hub-section-title">${catName}</h3>
            <span class="hub-section-count">${cat.items?.length || 0}</span>
          </div>
        </div>
        ${isBreakfastCat ? `
          <div class="breakfast-service-notice ${!isBreakfastAvailable() ? 'is-ended' : ''}">
            ${getBreakfastNoticeInner(currentLang)}
          </div>
        ` : ""}
        ${isEntreesCat ? `
          <div class="entrees-service-notice">
            ${getKitchenNoticeInner(currentLang)}
          </div>
        ` : ""}
        ${isCouscousCategory(catId) ? `
          <div class="couscous-service-notice ${!isCouscousAvailable() ? 'is-ended' : ''}">
            ${getCouscousNoticeInner(currentLang)}
          </div>
        ` : ""}
        <div class="hub-dishes-grid"></div>
      `;

      const grid = catSection.querySelector(".hub-dishes-grid");
      (cat.items || []).forEach((item, idx) => {
        item.categoryId = catId;
        item.categoryNameFr = cat.category.fr;
        grid.appendChild(createDishCard(item, catId, idx));
      });

      allWrap.appendChild(catSection);
    });

    menuGrid.appendChild(allWrap);
    return;
  }

  // 3. SINGLE CATEGORY MODE (DEFAULT HUB TACTILE)
  if (!activeCategoryId && menuData.length > 0) {
    activeCategoryId = getDefaultInitialCategoryId();
  }

  const activeCategory = menuData.find(c => getCatId(c) === activeCategoryId) || menuData[0];
  if (!activeCategory) return;

  const currentCatId = getCatId(activeCategory);
  const catTitle = activeCategory.category[currentLang] || activeCategory.category.fr;
  const items = activeCategory.items || [];
  const isBreakfastCurrent = (currentCatId === "petit-dejeuner");
  const isEntreesCurrent = (currentCatId === "entrees");

  const voirToutTexts = {
    fr: "Voir tout",
    en: "View all",
    de: "Alle ansehen",
    es: "Ver todo",
    ar: "عرض الكل"
  };

  const countTexts = {
    fr: `${items.length} plats`,
    en: `${items.length} items`,
    de: `${items.length} Gerichte`,
    es: `${items.length} platos`,
    ar: `${items.length} أطباق`
  };

  menuGrid.innerHTML = `
    <div class="hub-single-category-wrap">
      <div class="hub-section-header">
        <div class="hub-header-left">
          <h2 class="hub-section-title">${catTitle}</h2>
          <span class="hub-section-count">${countTexts[currentLang] || countTexts.fr}</span>
        </div>
        <button type="button" class="hub-view-all-btn" id="hubViewAllBtn" aria-label="Voir tout le menu">
          <span>${voirToutTexts[currentLang] || voirToutTexts.fr}</span>
          <svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
        </button>
      </div>
      ${isBreakfastCurrent ? `
        <div class="breakfast-service-notice ${!isBreakfastAvailable() ? 'is-ended' : ''}">
          ${getBreakfastNoticeInner(currentLang)}
        </div>
      ` : ""}
      ${isKitchenCategory(currentCatId) ? `
        <div class="entrees-service-notice">
          ${getKitchenNoticeInner(currentLang)}
        </div>
      ` : ""}
      ${isCouscousCategory(currentCatId) ? `
        <div class="couscous-service-notice ${!isCouscousAvailable() ? 'is-ended' : ''}">
          ${getCouscousNoticeInner(currentLang)}
        </div>
      ` : ""}
      <div class="hub-dishes-grid"></div>
    </div>
  `;

  const btnViewAll = menuGrid.querySelector("#hubViewAllBtn");
  if (btnViewAll) {
    btnViewAll.addEventListener("click", showAllDishes);
  }

  const grid = menuGrid.querySelector(".hub-dishes-grid");
  items.forEach((item, idx) => {
    item.categoryId = currentCatId;
    item.categoryNameFr = activeCategory.category.fr;
    grid.appendChild(createDishCard(item, currentCatId, idx));
  });
}

/**
 * Create a single dish card with prominent image
 */
function createDishCard(item, categoryId, itemIndex, categoryBadge = "") {
  const card = document.createElement("article");
  const isBreakfast = (categoryId === "petit-dejeuner");
  const isKitchen = isKitchenCategory(categoryId);
  const isCouscous = isCouscousCategory(categoryId, item.name?.fr || item.name);

  const isBreakfastBlocked = isBreakfast && !isBreakfastAvailable();
  const isKitchenBlocked = isKitchen && !isKitchenAvailable();
  const isCouscousBlocked = isCouscous && !isCouscousAvailable();
  const isOver = isBreakfastBlocked || isKitchenBlocked || isCouscousBlocked;

  card.className = `hub-card menu-item ${isOver ? "hub-card-disabled" : ""}`;
  if (isOver) {
    card.dataset.blockedReason = isCouscousBlocked ? "couscous" : isKitchenBlocked ? "kitchen" : "breakfast";
  }
  card.id = `item-${categoryId}-${itemIndex}`;
  card.style.setProperty("--item-index", itemIndex);
  card._menuItem = item;
  card.dataset.img = item.image;

  const itemName = item.name[currentLang] || item.name.fr || "";
  const itemDesc = item.description[currentLang] || item.description.fr || "";

  const badgeNewText = currentLang === "en" ? "NEW"
    : currentLang === "de" ? "NEU"
      : currentLang === "es" ? "NUEVO"
        : currentLang === "ar" ? "جديد"
          : "NOUVEAU";

  let orderBtnText = "";
  let unavailBadgeText = "";

  if (isBreakfastBlocked) {
    orderBtnText = currentLang === "en" ? "Ended"
      : currentLang === "de" ? "Beendet"
        : currentLang === "es" ? "Finalizado"
          : currentLang === "ar" ? "انتهى"
            : "Terminé";

    unavailBadgeText = currentLang === "en" ? "🕒 Until 13h (14h w-e)"
      : currentLang === "de" ? "🕒 Bis 13h (14h WE)"
        : currentLang === "es" ? "🕒 Hasta las 13h (14h finde)"
          : currentLang === "ar" ? "🕒 حتى 13:00 (14:00 عطلة)"
            : "🕒 Servi jusqu'à 13h (14h w-e)";
  } else if (isCouscousBlocked) {
    const cInfo = getCouscousScheduleInfo();
    if (cInfo.isBefore) {
      orderBtnText = currentLang === "en" ? "From 12:00"
        : currentLang === "de" ? "Ab 12h"
          : currentLang === "es" ? "Desde 12h"
            : currentLang === "ar" ? "من 12:00"
              : "Dès 12h";
      unavailBadgeText = currentLang === "en" ? "🕒 Friday at 12:00"
        : currentLang === "de" ? "🕒 Freitag ab 12h"
          : currentLang === "es" ? "🕒 Viernes desde 12h"
            : currentLang === "ar" ? "🕒 الجمعة من 12:00"
              : "🕒 Vendredi dès 12h";
    } else if (cInfo.isAfter) {
      orderBtnText = currentLang === "en" ? "Ended"
        : currentLang === "de" ? "Beendet"
          : currentLang === "es" ? "Finalizado"
            : currentLang === "ar" ? "انتهى"
              : "Terminé";
      unavailBadgeText = currentLang === "en" ? "🌙 Service ended"
        : currentLang === "de" ? "🌙 Service beendet"
          : currentLang === "es" ? "🌙 Servicio finalizado"
            : currentLang === "ar" ? "🌙 انتهت الخدمة"
              : "🌙 Service terminé (17h)";
    } else {
      orderBtnText = currentLang === "en" ? "Fridays"
        : currentLang === "de" ? "Freitags"
          : currentLang === "es" ? "Viernes"
            : currentLang === "ar" ? "الجمعة"
              : "Vendredi";
      unavailBadgeText = currentLang === "en" ? "📅 Fridays (12h-17h)"
        : currentLang === "de" ? "📅 Freitags (12-17h)"
          : currentLang === "es" ? "📅 Viernes (12h-17h)"
            : currentLang === "ar" ? "📅 الجمعة (12-17)"
              : "📅 Vendredi (12h-17h)";
    }
  } else if (isKitchenBlocked) {
    const kInfo = getKitchenScheduleInfo();
    if (kInfo.isClosed) {
      orderBtnText = currentLang === "en" ? "Closed"
        : currentLang === "de" ? "Geschlossen"
          : currentLang === "es" ? "Cerrado"
            : currentLang === "ar" ? "مغلق"
              : "Fermé";
      unavailBadgeText = currentLang === "en" ? "🌙 Closed"
        : currentLang === "de" ? "🌙 Geschlossen"
          : currentLang === "es" ? "🌙 Cerrado"
            : currentLang === "ar" ? "🌙 مغلق"
              : "🌙 Service fermé";
    } else {
      orderBtnText = currentLang === "en" ? `From ${kInfo.startHour}:00`
        : currentLang === "de" ? `Ab ${kInfo.startHour}h`
          : currentLang === "es" ? `Desde ${kInfo.startHour}h`
            : currentLang === "ar" ? `من ${kInfo.startHour}:00`
              : `Dès ${kInfo.startHour}h`;
      unavailBadgeText = currentLang === "en" ? `🕒 Kitchen at ${kInfo.startHour}:00`
        : currentLang === "de" ? `🕒 Küche ab ${kInfo.startHour}h`
          : currentLang === "es" ? `🕒 Cocina desde las ${kInfo.startHour}h`
            : currentLang === "ar" ? `🕒 المطبخ من ${kInfo.startHour}:00`
              : `🕒 Cuisine dès ${kInfo.startHour}h00`;
    }
  } else {
    orderBtnText = currentLang === "en" ? "Order"
      : currentLang === "de" ? "Bestellen"
        : currentLang === "es" ? "Pedir"
          : currentLang === "ar" ? "اطلب"
            : "Commander";
  }

  card.innerHTML = `
    <div class="hub-card-media">
      <img src="${item.image}" alt="${itemName}" class="hub-card-img" loading="lazy" />
      <div class="hub-card-gradient"></div>
      ${isOver ? `<span class="hub-badge-unavailable">${unavailBadgeText}</span>` : ""}
      ${!isOver && item.isNew ? `<span class="hub-badge-new">${badgeNewText}</span>` : ""}
      ${categoryBadge ? `<span class="hub-badge-cat">${categoryBadge}</span>` : ""}
      <div class="hub-card-zoom-hint" title="Agrandir">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          <line x1="11" y1="8" x2="11" y2="14"></line>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      </div>
    </div>
    <div class="hub-card-content">
      <div class="hub-card-header">
        <h3 class="hub-card-name item-name">${itemName}</h3>
      </div>
      ${itemDesc ? `<p class="hub-card-desc item-desc">${itemDesc}</p>` : ""}
      <div class="hub-card-footer">
        <div class="hub-card-price-wrap">
          <span class="hub-card-price item-price">${item.price}</span>
        </div>
        <button type="button" class="hub-order-btn add-to-cart-btn ${isOver ? 'btn-disabled' : ''}" ${isOver ? 'disabled aria-disabled="true"' : ''} aria-label="${orderBtnText}">
          <span class="hub-order-btn-label">${orderBtnText}</span>
          <svg class="hub-order-btn-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <path d="M16 10a4 4 0 0 1-8 0"></path>
          </svg>
        </button>
      </div>
    </div>
  `;

  return card;
}

/**
 * Apply Search Filter
 */
export function applySearchFilter() {
  const input = document.getElementById("searchInput");
  const clearBtn = document.getElementById("searchClearBtn");
  if (!input) return;

  const term = (input.value || "").trim();
  if (clearBtn) {
    clearBtn.style.display = term ? "flex" : "none";
  }

  renderDishes(term);
}

/**
 * Activate live search
 */
export function activateSearch() {
  const searchInput = document.getElementById("searchInput");
  const clearBtn = document.getElementById("searchClearBtn");
  if (!searchInput) return;

  searchInput.removeEventListener("input", applySearchFilter);
  searchInput.addEventListener("input", applySearchFilter);

  if (clearBtn && !clearBtn._hasClickListener) {
    clearBtn._hasClickListener = true;
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      applySearchFilter();
      searchInput.focus();
    });
  }
}

/**
 * Setup Lightbox
 */

// ── Mapping ingrédient → emoji ──────────────────────────────────────────────
const INGREDIENT_EMOJI_MAP = {
  // Fruits
  "framboise": "🫐", "raspberry": "🫐", "himbeere": "🫐", "frambuesa": "🫐",
  "fraise": "🍓", "strawberry": "🍓", "erdbeere": "🍓", "fresa": "🍓",
  "orange": "🍊", "orangen": "🍊", "naranja": "🍊",
  "banane": "🍌", "banana": "🍌", "banane ": "🍌", "plátano": "🍌", "platano": "🍌",
  "ananas": "🍍", "pineapple": "🍍", "piña": "🍍", "pina": "🍍",
  "mangue": "🥭", "mango": "🥭",
  "myrtille": "🫐", "blueberry": "🫐", "blaubeere": "🫐", "arándano": "🫐", "arandano": "🫐",
  "kiwi": "🥝",
  "avocat": "🥑", "avocado": "🥑", "aguacate": "🥑",
  "pêche": "🍑", "peach": "🍑", "pfirsich": "🍑", "melocotón": "🍑", "melocoton": "🍑",
  "poire": "🍐", "pear": "🍐", "birne": "🍐", "pera": "🍐",
  "citron": "🍋", "lemon": "🍋", "zitrone": "🍋", "limón": "🍋", "limon": "🍋",
  "noix de coco": "🥥", "coconut": "🥥", "kokosnuss": "🥥", "coco": "🥥",
  "datte": "🌴", "date": "🌴", "dattel": "🌴", "dátil": "🌴", "datil": "🌴",
  "fruits secs": "🌰", "fruits sec": "🌰", "dried fruits": "🌰", "trockenfrüchte": "🌰", "frutos secos": "🌰", "fruto seco": "🌰", "فواكه جافة": "🌰",
  "fruits de saison": "🥝", "fruits de saison en décoration": "🥝", "seasonal fruit": "🥝", "saisonfrüchte": "🥝", "frutas de temporada": "🥝", "fruta de temporada": "🥝", "فواكه موسمية": "🥝",
  // Légumes
  "carotte": "🥕", "carrot": "🥕", "karotte": "🥕", "zanahoria": "🥕",
  // Condiments & aromates
  "miel": "🍯", "honey": "🍯", "honig": "🍯",
  "menthe": "🌿", "mint": "🌿", "minze": "🌿", "menta": "🌿",
  "gingembre": "🫚", "ginger": "🫚", "ingwer": "🫚", "jengibre": "🫚",
  "bissap": "🌺", "hibiscus": "🌺", "hibisco": "🌺",
  // Boissons & sirops
  "sirop bleu curaçao": "💙", "blue curaçao": "💙", "blue-curaçao": "💙", "curaçao azul": "💙",
  "redbull": "⚡", "red bull": "⚡",
  "sodawater": "💧",
};

/**
 * Catégories qui affichent le sticker ingrédients
 */
const INGREDIENT_STICKER_CATEGORIES = [
  "cocktails", "mojito", "smoothies", "smoothie-bowl",
  "boissons", "milkshakes", "ice-coffee", "frappuccino"
];

/**
 * Génère le HTML du sticker ingrédients à partir d'une description FR
 */
function buildIngredientSticker(item, lang) {
  if (!item) return "";

  // Déterminer si cet item mérite un sticker (catégorie boisson/smoothie)
  // On se base sur la description : elle contient des ingrédients séparés par des virgules
  const descFr = (item.description && item.description.fr) ? item.description.fr : "";
  const descLang = (item.description && item.description[lang]) ? item.description[lang] : descFr;

  // Heuristique : si la description FR est une liste d'ingrédients séparés par des virgules
  const looksLikeIngredients = descFr.length <= 180 && descFr.includes(",");
  if (!looksLikeIngredients) return "";

  // Parser les ingrédients depuis la description en langue courante
  const rawIngredients = descLang.split(",").map(s => s.replace(/\.$/, "").trim()).filter(Boolean);

  // Construire la liste avec emojis (sans doublon si l'emoji est déjà présent)
  const ingredientItems = rawIngredients.map(ing => {
    const hasEmoji = /\p{Extended_Pictographic}/u.test(ing);
    if (hasEmoji) {
      return `<span class="lb-ingr-item">${ing}</span>`;
    }
    const ingLower = ing.toLowerCase();
    let emoji = "✨";
    for (const [key, em] of Object.entries(INGREDIENT_EMOJI_MAP)) {
      if (ingLower.includes(key)) { emoji = em; break; }
    }
    return `<span class="lb-ingr-item">${emoji} ${ing}</span>`;
  });

  if (ingredientItems.length === 0) return "";

  const labels = { fr: "Ingrédients", en: "Ingredients", de: "Zutaten", es: "Ingredientes", ar: "المكوّنات" };
  const label = labels[lang] || labels.fr;

  return `
    <div class="lb-ingredient-sticker">
      <div class="lb-ingr-header">${label}</div>
      <div class="lb-ingr-list">${ingredientItems.join("")}</div>
    </div>`;
}

export function closeLightbox() {
  const secureLightbox = document.getElementById("secureLightbox");
  const secureLightboxContent = document.querySelector(".secure-lightbox-content");
  if (!secureLightbox) return;

  secureLightbox.classList.remove("active");
  if (secureLightboxContent) secureLightboxContent.style.backgroundImage = "";

  const lbAddBtn = document.getElementById("secureLightboxAddBtn");
  if (lbAddBtn) lbAddBtn.style.display = "none";

  const lbCaption = document.getElementById("secureLightboxCaption");
  if (lbCaption) lbCaption.innerHTML = "";

  // Remove sticker if present
  const existingSticker = document.querySelector(".lb-ingredient-sticker");
  if (existingSticker) existingSticker.remove();

  document.body.classList.remove("no-scroll");
  document.documentElement.classList.remove("no-scroll");
}

export function openLightboxForItem(item, imgUrl) {
  const secureLightbox = document.getElementById("secureLightbox");
  const secureLightboxContent = document.querySelector(".secure-lightbox-content");
  if (!secureLightbox || !secureLightboxContent || !imgUrl) return;

  const lbAddBtn = document.getElementById("secureLightboxAddBtn");
  const lbCaption = document.getElementById("secureLightboxCaption");
  activeLightboxItem = item;

  secureLightboxContent.style.backgroundImage = `url("${imgUrl}")`;

  // ── Sticker ingrédients ──────────────────────────────────────────────────
  // Remove old sticker
  const oldSticker = secureLightboxContent.querySelector(".lb-ingredient-sticker");
  if (oldSticker) oldSticker.remove();

  if (item) {
    const stickerHtml = buildIngredientSticker(item, currentLang);
    if (stickerHtml) {
      secureLightboxContent.insertAdjacentHTML("beforeend", stickerHtml);
    }
  }

  // ── Caption enrichie (nom + description) ────────────────────────────────
  if (item && lbCaption) {
    const name = item.name[currentLang] || item.name.fr;
    const descFr = (item.description && item.description.fr) || "";
    const descLang = (item.description && item.description[currentLang]) || descFr;
    const looksLikeIngredients = descFr.length <= 180 && descFr.includes(",");

    if (looksLikeIngredients) {
      // Pour les boissons : afficher le nom + prix uniquement (les ingrédients sont dans le sticker)
      lbCaption.innerHTML = `<span class="lb-caption-name">${name}</span><span class="lb-caption-price">${item.price} MAD</span>`;
    } else {
      // Pour les autres plats : nom + prix + description courte
      lbCaption.innerHTML = `<span class="lb-caption-name">${name}</span><span class="lb-caption-price">${item.price} MAD</span><span class="lb-caption-desc">${descLang}</span>`;
    }
  } else if (lbCaption) {
    lbCaption.innerHTML = "";
  }

  if (item && lbAddBtn) {
    lbAddBtn.style.display = "block";
    const isBreakfast = (item.categoryId === "petit-dejeuner");
    const isKitchen = isKitchenCategory(item.categoryId);
    const isCouscous = isCouscousCategory(item.categoryId, item.name?.fr || item.name);
    const isBreakfastBlocked = isBreakfast && !isBreakfastAvailable();
    const isKitchenBlocked = isKitchen && !isKitchenAvailable();
    const isCouscousBlocked = isCouscous && !isCouscousAvailable();
    const isBlocked = isBreakfastBlocked || isKitchenBlocked || isCouscousBlocked;

    if (isBlocked) {
      lbAddBtn.disabled = true;
      lbAddBtn.classList.add("btn-disabled");
      lbAddBtn.style.opacity = "0.55";
      lbAddBtn.style.cursor = "not-allowed";
      if (isCouscousBlocked) {
        const cInfo = getCouscousScheduleInfo();
        const cText = cInfo.isBefore
          ? (currentLang === "en" ? "Couscous from 12:00" : currentLang === "ar" ? "الكسكس من 12:00" : "Couscous dès 12h00")
          : cInfo.isAfter
            ? (currentLang === "en" ? "Service Ended (17:00)" : currentLang === "ar" ? "انتهت الخدمة (17:00)" : "Service Terminé (17h00)")
            : (currentLang === "en" ? "Vendredi (12h-17h)" : currentLang === "ar" ? "الجمعة (12-17)" : "Vendredi (12h-17h)");
        lbAddBtn.textContent = cText;
      } else if (isKitchenBlocked) {
        const kInfo = getKitchenScheduleInfo();
        const kText = kInfo.isClosed
          ? (currentLang === "en" ? "Kitchen Closed"
            : currentLang === "de" ? "Küche geschlossen"
              : currentLang === "es" ? "Cocina cerrada"
                : currentLang === "ar" ? "المطبخ مغلق"
                  : "Cuisine Fermée")
          : (currentLang === "en" ? `Kitchen from ${kInfo.startHour}:00`
            : currentLang === "de" ? `Küche ab ${kInfo.startHour}:00`
              : currentLang === "es" ? `Cocina desde las ${kInfo.startHour}:00`
                : currentLang === "ar" ? `المطبخ ابتداءً من ${kInfo.startHour}:00`
                  : `Cuisine dès ${kInfo.startHour}h00`);
        lbAddBtn.textContent = kText;
      } else {
        const endText = currentLang === "en" ? "Service Ended"
          : currentLang === "de" ? "Service Beendet"
            : currentLang === "es" ? "Servicio Finalizado"
              : currentLang === "ar" ? "انتهت فترة التقديم"
                : "Service Terminé";
        lbAddBtn.textContent = endText;
      }
    } else {
      lbAddBtn.disabled = false;
      lbAddBtn.classList.remove("btn-disabled");
      lbAddBtn.style.opacity = "";
      lbAddBtn.style.cursor = "";
      const btnText = currentLang === "en" ? "Order"
        : currentLang === "de" ? "Bestellen"
          : currentLang === "es" ? "Pedir"
            : currentLang === "ar" ? "اطلب"
              : "Commander";
      lbAddBtn.textContent = btnText;
    }
  } else if (lbAddBtn) {
    lbAddBtn.style.display = "none";
  }

  secureLightbox.classList.add("active");
  document.body.classList.add("no-scroll");
  document.documentElement.classList.add("no-scroll");
}


export function enableSecureLightbox() {
  const secureLightbox = document.getElementById("secureLightbox");
  const secureLightboxContent = document.querySelector(".secure-lightbox-content");
  if (!secureLightbox || !secureLightboxContent) return;

  const lbAddBtn = document.getElementById("secureLightboxAddBtn");
  if (lbAddBtn && !lbAddBtn._hasListener) {
    lbAddBtn._hasListener = true;
    lbAddBtn.addEventListener("click", () => {
      if (lbAddBtn.disabled) {
        if (activeLightboxItem && isCouscousCategory(activeLightboxItem.categoryId, activeLightboxItem.name?.fr || activeLightboxItem.name)) {
          showToast(getCouscousBlockedMessage(currentLang));
        } else if (activeLightboxItem && isKitchenCategory(activeLightboxItem.categoryId)) {
          showToast(getKitchenBlockedMessage(currentLang));
        } else {
          showToast(getBreakfastBlockedMessage(currentLang));
        }
        return;
      }
      if (activeLightboxItem) {
        checkItemOptionsAndAdd(activeLightboxItem);
        closeLightbox();
      }
    });
  }

  const closeBtn = secureLightbox.querySelector(".close-btn");
  if (closeBtn && !closeBtn._hasListener) {
    closeBtn._hasListener = true;
    closeBtn.addEventListener("click", closeLightbox);
  }

  if (!secureLightbox._hasClickListener) {
    secureLightbox._hasClickListener = true;
    secureLightbox.addEventListener("click", (e) => {
      if (e.target === secureLightbox) {
        closeLightbox();
      }
    });
  }
}

/**
 * Protect images against right-click / drag
 */
export function protectImages() {
  if (imagesProtected) return;
  document.addEventListener("contextmenu", (e) => {
    if (e.target.tagName === "IMG" || e.target.classList.contains("hub-card-media") || e.target.classList.contains("hub-cat-circle")) {
      e.preventDefault();
    }
  });
  imagesProtected = true;
}

/**
 * Setup Burger Menu Category Navigation Links
 */
export function setupNavigationListeners() {
  const burgerLinks = document.querySelectorAll("#burgerNav a");
  burgerLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      if (href && href.startsWith("#")) {
        e.preventDefault();
        const targetId = href.substring(1);
        selectCategory(targetId);
      }
    });
  });
}

/**
 * Main Entry: Render the entire Hub Tactile UI
 */
export function renderMenu() {
  const menuGrid = document.getElementById("menu-grid");
  if (!menuData || !Array.isArray(menuData) || !menuGrid) {
    return;
  }

  // Set default active category if none
  if (!activeCategoryId && menuData.length > 0) {
    activeCategoryId = getDefaultInitialCategoryId();
  }

  // Render Category Pastilles
  renderCategoryPastilles();

  // Render Dishes
  renderDishes();

  // Setup Delegated Click Listener on Menu Grid
  if (!menuGrid._hasDelegatedListener) {
    menuGrid._hasDelegatedListener = true;
    menuGrid.addEventListener("click", (e) => {
      const addBtn = e.target.closest(".hub-order-btn, .hub-add-btn, .add-to-cart-btn");
      if (addBtn) {
        e.stopPropagation();
        const card = addBtn.closest(".hub-card");
        if (card && card._menuItem) {
          if (card.classList.contains("hub-card-disabled") || addBtn.disabled) {
            if (card.dataset.blockedReason === "couscous" || isCouscousCategory(card._menuItem.categoryId, card._menuItem.name?.fr || card._menuItem.name)) {
              showToast(getCouscousBlockedMessage(currentLang));
            } else if (card.dataset.blockedReason === "kitchen" || isKitchenCategory(card._menuItem.categoryId)) {
              showToast(getKitchenBlockedMessage(currentLang));
            } else {
              showToast(getBreakfastBlockedMessage(currentLang));
            }
            return;
          }
          checkItemOptionsAndAdd(card._menuItem);
          // Quick tap animation
          addBtn.style.transform = "scale(0.92)";
          setTimeout(() => { addBtn.style.transform = ""; }, 180);
        }
        return;
      }

      const card = e.target.closest(".hub-card");
      if (card && card._menuItem) {
        openLightboxForItem(card._menuItem, card.dataset.img);
      }
    });
  }

  setupNavigationListeners();
  activateSearch();
  enableSecureLightbox();
  protectImages();
}

// Window global bindings & backward compatibility stubs
export function toggleCategoryDrawer(drawerIdOrElement) {
  if (typeof drawerIdOrElement === "string") {
    selectCategory(drawerIdOrElement);
  }
}
export function openDrawer() {}
export function closeDrawer() {}
export function updateFloatingButtons() {}
export function setupFloatingButtons() {}

window.renderMenu = renderMenu;
window.selectCategory = selectCategory;
window.showAllDishes = showAllDishes;
window.closeLightbox = closeLightbox;
window.setupNavigationListeners = setupNavigationListeners;
window.toggleCategoryDrawer = toggleCategoryDrawer;

