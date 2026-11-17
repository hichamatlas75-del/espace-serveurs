/**
 * GREY CORNER — ELEGANT SOUND SERVICE (Web Audio API)
 * Synthèse audio directe ultra-robuste, 100% synchrone et sans aucune latence.
 * Compatible avec tous les navigateurs mobiles (iOS Safari, Android Chrome) et desktop.
 */

let audioCtx = null;
let isMuted = false;

// Initialiser l'état sourdine depuis le localStorage (par défaut: sonore = false)
try {
  isMuted = localStorage.getItem("gc_sound_muted") === "true";
} catch (e) {
  isMuted = false;
}

/**
 * Récupère ou instancie l'AudioContext singleton
 */
function getAudioContext() {
  if (typeof window === "undefined") return null;

  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }

  // Si le contexte s'est suspendu (politique d'économie d'énergie du navigateur),
  // on le réveille immédiatement
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }

  return audioCtx;
}

/**
 * Déverrouille l'AudioContext silencieusement dès le premier contact utilisateur
 */
if (typeof window !== "undefined") {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    } catch (e) {}

    document.removeEventListener("touchstart", unlockAudio);
    document.removeEventListener("click", unlockAudio);
    document.removeEventListener("pointerdown", unlockAudio);
  };

  document.addEventListener("touchstart", unlockAudio, { once: true, passive: true });
  document.addEventListener("click", unlockAudio, { once: true, passive: true });
  document.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
}

/**
 * Micro-vibration haptique (Android)
 */
function triggerHaptic(duration = 12) {
  if (isMuted) return;
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate(duration);
    } catch (e) {}
  }
}

/**
 * Moteur universel de synthèse d'une note pure
 * - Initialisation du gain à 0 pour bannir tout clac/pop
 * - Montée douce en 4ms (attaque feutrée)
 * - Décroissance exponentielle naturelle
 * - Démarrage 100% synchrone pour respecter les politiques de sécurité mobiles
 */
function playTone({ freq, type = "sine", duration = 0.15, gain = 0.22, pitchDrop = 0, delay = 0 }) {
  if (isMuted) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime + Math.max(0, delay);
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = type;

    // 1. Initialiser impérativement à 0 pour éviter tout pic de saturation initial
    gainNode.gain.setValueAtTime(0, ctx.currentTime);

    // 2. Attaque soyeuse de 4ms
    gainNode.gain.linearRampToValueAtTime(gain, now + 0.004);

    // 3. Décroissance exponentielle vers silence complet
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    // 4. Fréquence et glissement éventuel
    osc.frequency.setValueAtTime(freq, now);
    if (pitchDrop > 0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq - pitchDrop), now + duration);
    }

    // Connecter directement à la sortie
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Démarrage synchrone
    osc.start(now);
    osc.stop(now + duration + 0.05);

    // Nettoyage mémoire automatique après la fin de la note
    osc.onended = () => {
      try {
        osc.disconnect();
        gainNode.disconnect();
      } catch (e) {}
    };
  } catch (e) {
    console.warn("PlayTone warning:", e);
  }
}

// ── PALETTE SONORE GREY CORNER ───────────────────────────────────────────────

/**
 * 1. CLIC & TOUCHER LÉGER (Soft Wood Tap - 70ms)
 * Pour +, -, ouvrir/fermer le panier, replier catégorie.
 */
export function playTapSound() {
  playTone({ freq: 520, pitchDrop: 160, duration: 0.07, gain: 0.22, type: "sine" });
  triggerHaptic(10);
}

/**
 * 2. AJOUTER UN ARTICLE AU PANIER (Marimba Chime - 2 notes ascendantes douces)
 * Fa#4 (370Hz) -> Do#5 (554Hz)
 */
export function playAddToCartSound() {
  // Note 1 (370 Hz)
  playTone({ freq: 370, duration: 0.16, gain: 0.22, delay: 0 });
  // Note 2 (554 Hz) avec léger décalage musical de 70ms
  playTone({ freq: 554, duration: 0.25, gain: 0.26, delay: 0.07 });
  triggerHaptic(18);
}

/**
 * 3. CHOISIR SA TABLE (Pure Crystal Ping - 220ms)
 * Note pure La5 (880 Hz)
 */
export function playTableSelectSound() {
  playTone({ freq: 880, duration: 0.22, gain: 0.24 });
  triggerHaptic(16);
}

/**
 * 4. APPEL SERVEUR / EAU / ADDITION (Concierge Bell - Mi6 1318Hz + Mi7 2637Hz)
 * Sonorité clochette d'hôtel feutrée
 */
export function playServiceCallSound() {
  playTone({ freq: 1318.5, duration: 0.45, gain: 0.22, delay: 0 });
  playTone({ freq: 2637.0, duration: 0.35, gain: 0.10, delay: 0.01 });
  triggerHaptic([15, 30, 15]);
}

/**
 * 5. CONFIRMATION COMMANDE (Golden Arpeggio - Do5, Mi5, Sol5, Do6)
 * Arpège céleste ascendant
 */
export function playOrderSuccessSound() {
  playTone({ freq: 523.25, duration: 0.35, gain: 0.20, delay: 0.00 }); // Do5
  playTone({ freq: 659.25, duration: 0.38, gain: 0.22, delay: 0.09 }); // Mi5
  playTone({ freq: 783.99, duration: 0.42, gain: 0.24, delay: 0.18 }); // Sol5
  playTone({ freq: 1046.50, duration: 0.60, gain: 0.26, delay: 0.27 }); // Do6
  triggerHaptic([25, 35, 25]);
}

/**
 * Basculer l'état muet / sonore
 */
export function toggleSoundMute() {
  isMuted = !isMuted;

  try {
    localStorage.setItem("gc_sound_muted", isMuted ? "true" : "false");
  } catch (e) {}

  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  updateSoundUI();

  // Si on vient de réactiver le son, jouer un petit tap clair de confirmation
  if (!isMuted) {
    playTapSound();
  }

  return isMuted;
}

export function isSoundMuted() {
  return isMuted;
}

/**
 * Met à jour tous les boutons d'affichage son (Header & Panier)
 */
export function updateSoundUI() {
  if (typeof document === "undefined") return;

  const btns = document.querySelectorAll(".gc-sound-toggle-btn");
  btns.forEach(btn => {
    const iconEl = btn.querySelector(".gc-sound-icon");
    const iconText = isMuted ? "🔇" : "🔊";

    if (iconEl) {
      iconEl.textContent = iconText;
    } else {
      btn.innerHTML = iconText;
    }

    btn.setAttribute("aria-label", isMuted ? "Activer le son" : "Couper le son");
    btn.classList.toggle("muted", isMuted);
  });
}

// Exposer globalement sur window pour rétrocompatibilité et tests console
if (typeof window !== "undefined") {
  window.GC_Sound = {
    playTap: playTapSound,
    playAddToCart: playAddToCartSound,
    playTableSelect: playTableSelectSound,
    playServiceCall: playServiceCallSound,
    playOrderSuccess: playOrderSuccessSound,
    toggleMute: toggleSoundMute,
    isMuted: isSoundMuted,
    updateUI: updateSoundUI
  };
}
