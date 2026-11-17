/**
 * GREY CORNER — DYNAMIC SCHEDULE & SERVICE HOURS SERVICE (ES Module)
 * - Restaurant Opening Hours: 07:00 – 23:00 daily
 * - Breakfast Service Hours:
 *     * Monday – Friday: 07:00 – 13:00
 *     * Saturday – Sunday (Week-end): 07:00 – 14:00
 * All times based on Africa/Casablanca (Morocco) timezone.
 */

import { currentLang } from './i18n.js';

export function getMoroccoDateTime() {
  const now = new Date();
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Casablanca',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    let weekday = "Mon";
    let hour = 12;
    let minute = 0;
    for (const p of parts) {
      if (p.type === 'weekday') weekday = p.value;
      if (p.type === 'hour') hour = parseInt(p.value, 10);
      if (p.type === 'minute') minute = parseInt(p.value, 10);
    }
    return {
      weekday,
      hour,
      minute,
      decimalHour: hour + (minute / 60),
      isWeekend: (weekday === "Sat" || weekday === "Sun")
    };
  } catch (e) {
    // Fallback to local device time
    const day = now.getDay();
    const hour = now.getHours();
    const minute = now.getMinutes();
    return {
      weekday: (day === 0 ? "Sun" : day === 6 ? "Sat" : "Mon"),
      hour,
      minute,
      decimalHour: hour + (minute / 60),
      isWeekend: (day === 0 || day === 6)
    };
  }
}

/**
 * Check if the restaurant is currently open (07:00 - 23:00)
 */
export function isRestaurantOpen() {
  const { decimalHour } = getMoroccoDateTime();
  return decimalHour >= 7 && decimalHour < 23;
}

/**
 * Check if breakfast service is currently available
 * - Mon - Fri (Semaine): 07:00 – 13:00
 * - Sat - Sun (Week-end): 07:00 – 14:00
 */
export function isBreakfastAvailable() {
  const { isWeekend, decimalHour } = getMoroccoDateTime();
  const cutoff = isWeekend ? 14 : 13;
  return decimalHour >= 7 && decimalHour < cutoff;
}

/**
 * Detect current day and breakfast service status
 * - Mon - Fri: 07:00 – 13:00
 * - Sat - Sun: 07:00 – 14:00
 */
export function getBreakfastScheduleInfo() {
  const { weekday, decimalHour, isWeekend } = getMoroccoDateTime();
  const cutoffHour = isWeekend ? 14 : 13;
  const isAvailable = decimalHour >= 7 && decimalHour < cutoffHour;
  const isBefore = decimalHour < 7;
  const isAfter = decimalHour >= cutoffHour;

  return {
    weekday,
    isWeekend,
    startHour: 7,
    cutoffHour,
    isAvailable,
    isBefore,
    isAfter,
    decimalHour
  };
}

/**
 * Generate HTML content for the dynamic breakfast notice above breakfast dishes
 */
export function getBreakfastNoticeInner(lang = "fr") {
  const info = getBreakfastScheduleInfo();
  const dayName = WEEKDAY_NAMES[info.weekday]?.[lang] || WEEKDAY_NAMES[info.weekday]?.fr || info.weekday;

  const todayLabel = {
    fr: "Aujourd'hui",
    en: "Today",
    es: "Hoy",
    de: "Heute",
    ar: "اليوم"
  }[lang] || "Aujourd'hui";

  let statusText = "";
  if (info.isBefore) {
    const beforeTexts = {
      fr: "Service petit-déjeuner commence à 07h00",
      en: "Breakfast service starts at 07:00",
      es: "El servicio de desayuno comienza a las 07:00",
      de: "Frühstücksservice beginnt um 07:00 Uhr",
      ar: "يبدأ فطور الصباح عند الساعة 07:00"
    };
    statusText = beforeTexts[lang] || beforeTexts.fr;
  } else if (info.isAvailable) {
    const availableTexts = {
      fr: `Service petit-déjeuner en cours (jusqu'à ${info.cutoffHour}h00)`,
      en: `Breakfast service open (until ${info.cutoffHour}:00)`,
      es: `Servicio de desayuno en curso (hasta las ${info.cutoffHour}:00)`,
      de: `Frühstücksservice läuft (bis ${info.cutoffHour}:00 Uhr)`,
      ar: `خدمة فطور الصباح متوفرة حالياً (حتى الساعة ${info.cutoffHour}:00)`
    };
    statusText = availableTexts[lang] || availableTexts.fr;
  } else {
    const endedTexts = {
      fr: "Service petit-déjeuner terminé pour aujourd'hui",
      en: "Breakfast service ended for today",
      es: "Servicio de desayuno finalizado por hoy",
      de: "Frühstücksservice für heute beendet",
      ar: "انتهت خدمة فطور الصباح لهذا اليوم"
    };
    statusText = endedTexts[lang] || endedTexts.fr;
  }

  const slotLabels = {
    weekday: { fr: "Semaine", en: "Weekdays", es: "Semana", de: "Werktags", ar: "الأسبوع" },
    weekend: { fr: "Week-end", en: "Weekend", es: "Fin de semana", de: "Wochenende", ar: "عطلة نهاية الأسبوع" }
  };

  const isWk = !info.isWeekend;
  const isWkEnd = info.isWeekend;

  return `
    <div class="esn-card-inner">
      <div class="esn-primary-row">
        <span class="esn-icon">☕</span>
        <div class="esn-title-group">
          <span class="esn-badge-today">${todayLabel} (${dayName})</span>
          <strong class="esn-main-status">${statusText}</strong>
        </div>
      </div>
      <div class="esn-schedule-pills">
        <span class="esn-pill ${isWk ? 'esn-pill-active' : ''}">
          ${isWk ? '<span class="esn-pin">📍</span>' : ''}${slotLabels.weekday[lang] || slotLabels.weekday.fr} : 07h00 – 13h00
        </span>
        <span class="esn-pill ${isWkEnd ? 'esn-pill-active' : ''}">
          ${isWkEnd ? '<span class="esn-pin">📍</span>' : ''}${slotLabels.weekend[lang] || slotLabels.weekend.fr} : 07h00 – 14h00
        </span>
      </div>
    </div>
  `;
}

/**
 * Localized Day of Week Names
 */
export const WEEKDAY_NAMES = {
  Mon: { fr: "Lundi", en: "Monday", es: "Lunes", de: "Montag", ar: "الإثنين" },
  Tue: { fr: "Mardi", en: "Tuesday", es: "Martes", de: "Dienstag", ar: "الثلاثاء" },
  Wed: { fr: "Mercredi", en: "Wednesday", es: "Miércoles", de: "Mittwoch", ar: "الأربعاء" },
  Thu: { fr: "Jeudi", en: "Thursday", es: "Jueves", de: "Donnerstag", ar: "الخميس" },
  Fri: { fr: "Vendredi", en: "Friday", es: "Viernes", de: "Freitag", ar: "الجمعة" },
  Sat: { fr: "Samedi", en: "Saturday", es: "Sábado", de: "Samstag", ar: "السبت" },
  Sun: { fr: "Dimanche", en: "Sunday", es: "Domingo", de: "Sonntag", ar: "الأحد" }
};

/**
 * Detect current day and point kitchen service start time
 * - Mon - Fri: starts at 12:00
 * - Saturday: starts at 13:00
 * - Sunday: starts at 14:00
 * - Daily closing: 23:00
 */
export function getKitchenScheduleInfo() {
  const { weekday, decimalHour } = getMoroccoDateTime();

  let startHour = 12;
  let dayType = "weekday";

  if (weekday === "Sat") {
    startHour = 13;
    dayType = "saturday";
  } else if (weekday === "Sun") {
    startHour = 14;
    dayType = "sunday";
  } else {
    startHour = 12;
    dayType = "weekday";
  }

  const isBefore = (decimalHour < startHour);
  const isOpen = (decimalHour >= startHour && decimalHour < 23);
  const isClosed = (decimalHour >= 23 || decimalHour < 7);

  return {
    weekday,
    dayType,
    startHour,
    isBefore,
    isOpen,
    isClosed
  };
}

/**
 * Generate HTML content for the dynamic kitchen notice above cold starters
 */
export function getKitchenNoticeInner(lang = "fr") {
  const info = getKitchenScheduleInfo();
  const dayName = WEEKDAY_NAMES[info.weekday]?.[lang] || WEEKDAY_NAMES[info.weekday]?.fr || info.weekday;

  const todayLabel = {
    fr: "Aujourd'hui",
    en: "Today",
    es: "Hoy",
    de: "Heute",
    ar: "اليوم"
  }[lang] || "Aujourd'hui";

  let statusText = "";
  if (info.isBefore) {
    const beforeTexts = {
      fr: `Le service cuisine commence à ${info.startHour}h00`,
      en: `Kitchen service starts at ${info.startHour}:00`,
      es: `El servicio de cocina comienza a las ${info.startHour}:00`,
      de: `Küchenservice beginnt um ${info.startHour}:00 Uhr`,
      ar: `يبدأ عمل المطبخ عند الساعة ${info.startHour}:00`
    };
    statusText = beforeTexts[lang] || beforeTexts.fr;
  } else if (info.isOpen) {
    const openTexts = {
      fr: `Service cuisine ouvert (débuté à ${info.startHour}h00)`,
      en: `Kitchen service open (started at ${info.startHour}:00)`,
      es: `Servicio de cocina abierto (iniciado a las ${info.startHour}:00)`,
      de: `Küchenservice geöffnet (ab ${info.startHour}:00 Uhr)`,
      ar: `خدمة المطبخ مفتوحة (بدأت عند ${info.startHour}:00)`
    };
    statusText = openTexts[lang] || openTexts.fr;
  } else {
    const closedTexts = {
      fr: `Service cuisine fermé • Reprise à ${info.startHour}h00`,
      en: `Kitchen service closed • Reopens at ${info.startHour}:00`,
      es: `Servicio de cocina cerrado • Abre a las ${info.startHour}:00`,
      de: `Küchenservice geschlossen • Öffnet um ${info.startHour}:00 Uhr`,
      ar: `المطبخ مغلق حالياً • يفتح عند ${info.startHour}:00`
    };
    statusText = closedTexts[lang] || closedTexts.fr;
  }

  const slotLabels = {
    weekday: { fr: "Semaine", en: "Weekdays", es: "Semana", de: "Werktags", ar: "الأسبوع" },
    saturday: { fr: "Samedi", en: "Saturday", es: "Sábado", de: "Samstag", ar: "السبت" },
    sunday: { fr: "Dimanche", en: "Sunday", es: "Domingo", de: "Sonntag", ar: "الأحد" }
  };

  const isWk = info.dayType === "weekday";
  const isSat = info.dayType === "saturday";
  const isSun = info.dayType === "sunday";

  return `
    <div class="esn-card-inner">
      <div class="esn-primary-row">
        <span class="esn-icon">🕒</span>
        <div class="esn-title-group">
          <span class="esn-badge-today">${todayLabel} (${dayName})</span>
          <strong class="esn-main-status">${statusText}</strong>
        </div>
      </div>
      <div class="esn-schedule-pills">
        <span class="esn-pill ${isWk ? 'esn-pill-active' : ''}">
          ${isWk ? '<span class="esn-pin">📍</span>' : ''}${slotLabels.weekday[lang] || slotLabels.weekday.fr} : 12h00
        </span>
        <span class="esn-pill ${isSat ? 'esn-pill-active' : ''}">
          ${isSat ? '<span class="esn-pin">📍</span>' : ''}${slotLabels.saturday[lang] || slotLabels.saturday.fr} : 13h00
        </span>
        <span class="esn-pill ${isSun ? 'esn-pill-active' : ''}">
          ${isSun ? '<span class="esn-pin">📍</span>' : ''}${slotLabels.sunday[lang] || slotLabels.sunday.fr} : 14h00
        </span>
      </div>
    </div>
  `;
}

/**
 * Text messages for opening status
 */
const STATUS_TEXTS = {
  open: {
    fr: "Ouvert actuellement jusqu'à 23h00",
    en: "Open now until 23:00",
    de: "Jetzt geöffnet bis 23:00",
    es: "Abierto ahora hasta las 23:00",
    ar: "مفتوح الآن حتى 23:00"
  },
  closed: {
    fr: "Fermé actuellement • Ouvre à 07h00",
    en: "Closed now • Opens at 07:00",
    de: "Geschlossen • Öffnet um 07:00",
    es: "Cerrado ahora • Abre a las 07:00",
    ar: "مغلق الآن • يفتح عند 07:00"
  }
};

/**
 * Category IDs that belong to the kitchen (repas / cuisine)
 */
export const KITCHEN_CATEGORY_IDS = new Set([
  "entrees",
  "entrees-chaudes",
  "plats",
  "sandwichs",
  "burgers",
  "panini",
  "pizza",
  "pasta",
  "crepes-salees"
]);

export function isKitchenCategory(catId) {
  if (!catId) return false;
  return KITCHEN_CATEGORY_IDS.has(String(catId).toLowerCase().trim());
}

/**
 * Check if category or item is Couscous
 */
export function isCouscousCategory(catId, itemName = "") {
  if (catId) {
    const id = String(catId).toLowerCase().trim();
    if (id === "couscous-vendredi" || id === "couscous" || id.includes("couscous")) {
      return true;
    }
  }
  if (itemName) {
    const name = (typeof itemName === "object" ? (itemName.fr || Object.values(itemName)[0] || "") : String(itemName)).toLowerCase();
    if (name.includes("couscous")) {
      return true;
    }
  }
  return false;
}

/**
 * Check if Couscous service is currently available
 * - Exclusive service: Friday only, between 12:00 and 17:00 (Casablanca time)
 */
export function isCouscousAvailable() {
  const { weekday, decimalHour } = getMoroccoDateTime();
  return (weekday === "Fri" && decimalHour >= 12 && decimalHour < 17);
}

/**
 * Detect current day and Couscous service status
 */
export function getCouscousScheduleInfo() {
  const { weekday, decimalHour } = getMoroccoDateTime();
  const isFriday = (weekday === "Fri");
  const isBefore = isFriday && (decimalHour < 12);
  const isAvailable = isFriday && (decimalHour >= 12 && decimalHour < 17);
  const isAfter = isFriday && (decimalHour >= 17);
  const isOtherDay = !isFriday;

  return {
    weekday,
    isFriday,
    startHour: 12,
    cutoffHour: 17,
    isAvailable,
    isBefore,
    isAfter,
    isOtherDay,
    decimalHour
  };
}

/**
 * Generate HTML content for the dynamic Couscous notice banner
 */
export function getCouscousNoticeInner(lang = "fr") {
  const info = getCouscousScheduleInfo();
  const dayName = WEEKDAY_NAMES[info.weekday]?.[lang] || WEEKDAY_NAMES[info.weekday]?.fr || info.weekday;

  const todayLabel = {
    fr: "Aujourd'hui",
    en: "Today",
    es: "Hoy",
    de: "Heute",
    ar: "اليوم"
  }[lang] || "Aujourd'hui";

  let statusText = "";
  if (info.isAvailable) {
    const availableTexts = {
      fr: "Service Couscous du Vendredi en cours (jusqu'à 17h00)",
      en: "Friday Couscous service open (until 17:00)",
      es: "Servicio de Cuscús del Viernes en curso (hasta las 17:00)",
      de: "Freitags-Couscous Service geöffnet (bis 17:00 Uhr)",
      ar: "خدمة كسكس الجمعة متوفرة حالياً (حتى الساعة 17:00)"
    };
    statusText = availableTexts[lang] || availableTexts.fr;
  } else if (info.isBefore) {
    const beforeTexts = {
      fr: "Service Couscous disponible dès 12h00 aujourd'hui (jusqu'à 17h00)",
      en: "Couscous service starts at 12:00 today (until 17:00)",
      es: "Servicio de Cuscús disponible a partir de las 12:00 hoy (hasta las 17:00)",
      de: "Couscous-Service beginnt heute um 12:00 Uhr (bis 17:00 Uhr)",
      ar: "خدمة الكسكس تبدأ اليوم عند الساعة 12:00 (حتى 17:00)"
    };
    statusText = beforeTexts[lang] || beforeTexts.fr;
  } else if (info.isAfter) {
    const endedTexts = {
      fr: "Service Couscous terminé pour aujourd'hui (servi le vendredi de 12h à 17h)",
      en: "Couscous service ended for today (served Fridays 12:00 to 17:00)",
      es: "Servicio de Cuscús finalizado por hoy (servido los viernes de 12:00 a 17:00)",
      de: "Couscous-Service für heute beendet (freitags von 12:00 bis 17:00 Uhr)",
      ar: "انتهت خدمة الكسكس لهذا اليوم (يُقدَّم يوم الجمعة من 12:00 إلى 17:00)"
    };
    statusText = endedTexts[lang] || endedTexts.fr;
  } else {
    const otherDayTexts = {
      fr: "Disponible exclusivement le Vendredi de 12h00 à 17h00",
      en: "Available exclusively on Fridays from 12:00 to 17:00",
      es: "Disponible exclusivamente los Viernes de 12:00 a 17:00",
      de: "Ausschließlich freitags von 12:00 bis 17:00 Uhr erhältlich",
      ar: "متوفر حصرياً كل يوم جمعة من الساعة 12:00 إلى 17:00"
    };
    statusText = otherDayTexts[lang] || otherDayTexts.fr;
  }

  const fridaySlotLabel = {
    fr: "Vendredi",
    en: "Friday",
    es: "Viernes",
    de: "Freitag",
    ar: "الجمعة"
  }[lang] || "Vendredi";

  return `
    <div class="esn-card-inner">
      <div class="esn-primary-row">
        <span class="esn-icon">🍲</span>
        <div class="esn-title-group">
          <span class="esn-badge-today">${todayLabel} (${dayName})</span>
          <strong class="esn-main-status">${statusText}</strong>
        </div>
      </div>
      <div class="esn-schedule-pills">
        <span class="esn-pill ${info.isAvailable ? 'esn-pill-active' : ''}">
          ${info.isAvailable ? '<span class="esn-pin">📍</span>' : ''}${fridaySlotLabel} : 12h00 – 17h00
        </span>
      </div>
    </div>
  `;
}

/**
 * Localized message when couscous order is blocked
 */
export function getCouscousBlockedMessage(lang = "fr") {
  const info = getCouscousScheduleInfo();
  if (info.isBefore) {
    const beforeMsgs = {
      fr: "Le couscous est servi uniquement le vendredi à partir de 12h00 (jusqu'à 17h00).",
      en: "Couscous is served only on Fridays starting from 12:00 (until 17:00).",
      es: "El cuscús se sirve únicamente los viernes a partir de las 12:00 (hasta las 17:00).",
      de: "Couscous wird nur freitags ab 12:00 Uhr serviert (bis 17:00 Uhr).",
      ar: "يُقدَّم الكسكس حصرياً يوم الجمعة ابتداءً من الساعة 12:00 (حتى 17:00)."
    };
    return beforeMsgs[lang] || beforeMsgs.fr;
  }
  if (info.isAfter) {
    const afterMsgs = {
      fr: "Le service couscous est terminé pour aujourd'hui (servi le vendredi de 12h00 à 17h00).",
      en: "Couscous service has ended for today (served Fridays from 12:00 to 17:00).",
      es: "El servicio de cuscús ha finalizado por hoy (servido los viernes de 12:00 a 17:00).",
      de: "Der Couscous-Service ist für heute beendet (freitags von 12:00 bis 17:00 Uhr).",
      ar: "انتهت خدمة الكسكس لهذا اليوم (يُقدَّم يوم الجمعة من 12:00 إلى 17:00)."
    };
    return afterMsgs[lang] || afterMsgs.fr;
  }
  const otherMsgs = {
    fr: "Le couscous est disponible exclusivement le vendredi entre 12h00 et 17h00.",
    en: "Couscous is available exclusively on Fridays between 12:00 and 17:00.",
    es: "El cuscús está disponible exclusivamente los viernes entre las 12:00 y las 17:00.",
    de: "Couscous ist ausschließlich freitags zwischen 12:00 und 17:00 Uhr erhältlich.",
    ar: "الكسكس متوفر حصرياً كل يوم جمعة بين الساعة 12:00 و 17:00."
  };
  return otherMsgs[lang] || otherMsgs.fr;
}

/**
 * Check if kitchen service is currently available (orderable)
 * - Weekdays: 12:00 – 23:00
 * - Saturday: 13:00 – 23:00
 * - Sunday: 14:00 – 23:00
 */
export function isKitchenAvailable() {
  const { isBefore, isClosed } = getKitchenScheduleInfo();
  return !isBefore && !isClosed;
}

/**
 * Localized message when kitchen order is blocked
 */
export function getKitchenBlockedMessage(lang = "fr") {
  const info = getKitchenScheduleInfo();
  if (info.isClosed) {
    const closedMsgs = {
      fr: `Le service cuisine est fermé pour la nuit (reprise aujourd'hui à ${info.startHour}h00).`,
      en: `Kitchen service is closed for the night (resumes today at ${info.startHour}:00).`,
      es: `El servicio de cocina está cerrado por la noche (reabre hoy a las ${info.startHour}:00).`,
      de: `Der Küchenservice ist für die Nacht geschlossen (öffnet heute um ${info.startHour}:00 Uhr).`,
      ar: `خدمة المطبخ مغلقة لهذه الليلة (تستأنف اليوم عند الساعة ${info.startHour}:00).`
    };
    return closedMsgs[lang] || closedMsgs.fr;
  }
  const beforeMsgs = {
    fr: `Le service cuisine commence à ${info.startHour}h00 aujourd'hui (12h en semaine, 13h samedi, 14h dimanche).`,
    en: `Kitchen service starts at ${info.startHour}:00 today (12:00 weekdays, 13:00 Sat, 14:00 Sun).`,
    es: `El servicio de cocina comienza a las ${info.startHour}:00 hoy (12:00 entre semana, 13:00 sáb, 14:00 dom).`,
    de: `Der Küchenservice beginnt heute um ${info.startHour}:00 Uhr (12:00 werktags, 13:00 Sa, 14:00 So).`,
    ar: `يبدأ عمل المطبخ عند الساعة ${info.startHour}:00 اليوم (12:00 خلال الأسبوع، 13:00 السبت، 14:00 الأحد).`
  };
  return beforeMsgs[lang] || beforeMsgs.fr;
}

/**
 * Localized message when breakfast order is blocked
 */
export function getBreakfastBlockedMessage(lang = "fr") {
  const msgs = {
    fr: "Le service petit-déjeuner est terminé (servi de 07h00 à 13h00 en semaine et 14h00 le week-end).",
    en: "Breakfast service has ended (served 07:00 to 13:00 weekdays, 14:00 weekends).",
    de: "Der Frühstücksservice ist beendet (werktags von 07:00 bis 13:00 Uhr, am Wochenende bis 14:00 Uhr).",
    es: "El servicio de desayuno ha finalizado (servido de 07:00 a 13:00 de lunes a viernes y 14:00 fines de semana).",
    ar: "انتهت فترة تقديم فطور الصباح (يُقدَّم من 07:00 إلى 13:00 طيلة الأسبوع وحتى 14:00 في عطلة نهاية الأسبوع)."
  };
  return msgs[lang] || msgs.fr;
}

/**
 * Update the dynamic opening badge in the header
 */
export function updateScheduleUI() {
  const badge = document.getElementById("headerStatusBadge");
  const textEl = document.getElementById("headerStatusText");
  const lang = currentLang || "fr";

  if (badge && textEl) {
    const open = isRestaurantOpen();
    badge.classList.toggle("status-open", open);
    badge.classList.toggle("status-closed", !open);

    const stateKey = open ? "open" : "closed";
    const dict = STATUS_TEXTS[stateKey];
    textEl.textContent = dict[lang] || dict.fr;
  }

  // Also dynamically update any entrees notices on page
  const entreesNotices = document.querySelectorAll(".entrees-service-notice");
  if (entreesNotices.length > 0) {
    const innerHtml = getKitchenNoticeInner(lang);
    entreesNotices.forEach(el => {
      el.innerHTML = innerHtml;
    });
  }

  // Also dynamically update any breakfast notices on page
  const breakfastNotices = document.querySelectorAll(".breakfast-service-notice");
  if (breakfastNotices.length > 0) {
    const innerHtml = getBreakfastNoticeInner(lang);
    const isAvail = isBreakfastAvailable();
    breakfastNotices.forEach(el => {
      el.innerHTML = innerHtml;
      el.classList.toggle("is-ended", !isAvail);
    });
  }

  // Also dynamically update any couscous notices on page
  const couscousNotices = document.querySelectorAll(".couscous-service-notice");
  if (couscousNotices.length > 0) {
    const innerHtml = getCouscousNoticeInner(lang);
    const isAvail = isCouscousAvailable();
    couscousNotices.forEach(el => {
      el.innerHTML = innerHtml;
      el.classList.toggle("is-ended", !isAvail);
    });
  }

  // Check for real-time state changes and re-render dishes if needed
  const currB = isBreakfastAvailable();
  const currK = isKitchenAvailable();
  const currC = isCouscousAvailable();
  if (window._prevBreakfastAvailable !== undefined && (
    window._prevBreakfastAvailable !== currB ||
    window._prevKitchenAvailable !== currK ||
    window._prevCouscousAvailable !== currC
  )) {
    window._prevBreakfastAvailable = currB;
    window._prevKitchenAvailable = currK;
    window._prevCouscousAvailable = currC;
    if (typeof window.renderMenu === "function") {
      window.renderMenu();
    }
  } else {
    window._prevBreakfastAvailable = currB;
    window._prevKitchenAvailable = currK;
    window._prevCouscousAvailable = currC;
  }
}

// Global binding for backwards compatibility
window.isRestaurantOpen = isRestaurantOpen;
window.isBreakfastAvailable = isBreakfastAvailable;
window.isKitchenAvailable = isKitchenAvailable;
window.isKitchenCategory = isKitchenCategory;
window.isCouscousCategory = isCouscousCategory;
window.isCouscousAvailable = isCouscousAvailable;
window.getCouscousScheduleInfo = getCouscousScheduleInfo;
window.getCouscousNoticeInner = getCouscousNoticeInner;
window.getCouscousBlockedMessage = getCouscousBlockedMessage;
window.getKitchenBlockedMessage = getKitchenBlockedMessage;
window.getBreakfastBlockedMessage = getBreakfastBlockedMessage;
window.updateScheduleUI = updateScheduleUI;
window.getKitchenScheduleInfo = getKitchenScheduleInfo;
window.getKitchenNoticeInner = getKitchenNoticeInner;
window.getBreakfastScheduleInfo = getBreakfastScheduleInfo;
window.getBreakfastNoticeInner = getBreakfastNoticeInner;
