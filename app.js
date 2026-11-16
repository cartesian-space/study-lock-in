// ===== THEME (fast cache to prevent flash) =====
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme-cache', theme);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  if (document.getElementById('hourHeatmap')) renderHourHeatmap();
  if (state) {
    state.theme = next;
    saveUIState();  // localStorage only — no TOML write
    console.log('[ui-state] theme →', next);
  }
}
applyTheme(localStorage.getItem('theme-cache') || 'light');

// ===== DIM / FOCUS MODE =====
let dimMode = localStorage.getItem('dim-mode') === 'true';

// ── Zen Audio — looping lo-fi study music ──
const zenAudio = (() => {
  // Zen Audio instantiation (with baseurl support)
  const siteCfgEl = document.getElementById('site-config');
  const siteCfg = siteCfgEl ? JSON.parse(siteCfgEl.textContent || '{}') : {};
  const audioSrc = (siteCfg.baseurl && siteCfg.baseurl !== '/' ? siteCfg.baseurl + '/' : '') + 'zen-music.mp3';
  const audio = new Audio(audioSrc);
  audio.loop = true;
  audio.volume = 0;
  let running = false;
  let fadeTimer = null;

  function fade(target, duration) {
    if (fadeTimer) cancelAnimationFrame(fadeTimer);
    const start = audio.volume;
    const diff = target - start;
    const startTime = performance.now();
    function step(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      audio.volume = start + diff * t;
      if (t < 1) fadeTimer = requestAnimationFrame(step);
    }
    fadeTimer = requestAnimationFrame(step);
  }

  function start() {
    if (running) return;
    running = true;
    audio.play().then(() => fade(0.45, 1500)).catch(() => {});
  }

  function stop() {
    if (!running) return;
    running = false;
    fade(0, 1500);
    setTimeout(() => { if (!running) audio.pause(); }, 1600);
  }

  return { start, stop, get running() { return running; } };
})();
// ── Zen Focus Reminder (browser notifications) ──
let zenReminderInterval = null;
const ZEN_NUDGES = [
  '🌿 Your study session is waiting…',
  '📖 Come back and focus!',
  '🧘 Zen mode is still on — time to study.',
  '🎯 Stay on track, get back to your tasks!',
  '💡 5 minutes gone — are you still studying?',
];

// Gentle bell "tung" — warm, inviting single-strike chime
function playTung() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    // Main bell tone (G5 ~784 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(784, now);
    gain1.gain.setValueAtTime(0.35, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
    osc1.connect(gain1).connect(ctx.destination);

    // Soft harmonic overtone (octave above, quieter)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1568, now);
    gain2.gain.setValueAtTime(0.12, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    osc2.connect(gain2).connect(ctx.destination);

    // Warm low body (fundamental, one octave below)
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(392, now);
    gain3.gain.setValueAtTime(0.15, now);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 2.2);
    osc3.connect(gain3).connect(ctx.destination);

    [osc1, osc2, osc3].forEach(o => { o.start(now); o.stop(now + 2.5); });
    setTimeout(() => ctx.close(), 3000);
  } catch (_) {}
}

function startZenReminder() {
  stopZenReminder();
  if (Notification.permission === 'default') Notification.requestPermission();
  zenReminderInterval = setInterval(() => {
    if (!dimMode || !document.hidden) return;
    if (Notification.permission !== 'granted') return;
    const msg = ZEN_NUDGES[Math.floor(Math.random() * ZEN_NUDGES.length)];
    new Notification('Study Tracker — Zen Mode', { body: msg, icon: '🌿', silent: true });
    playTung();
  }, 5 * 60 * 1000);
}

function stopZenReminder() {
  if (zenReminderInterval) { clearInterval(zenReminderInterval); zenReminderInterval = null; }
}

// ── Music toggle (independent of zen mode) ──
let musicOn = localStorage.getItem('music-on') === 'true';

function toggleMusic() {
  musicOn = !musicOn;
  localStorage.setItem('music-on', musicOn);
  const btn = document.getElementById('musicToggle');
  if (btn) btn.classList.toggle('active', musicOn);
  if (musicOn) zenAudio.start(); else zenAudio.stop();
}

function toggleDimMode() {
  dimMode = !dimMode;
  localStorage.setItem('dim-mode', dimMode);
  document.documentElement.classList.toggle('dim-mode', dimMode);
  const btn = document.getElementById('dimToggle');
  if (btn) btn.classList.toggle('active', dimMode);
  // Toggle zen reminders only
  if (dimMode) startZenReminder(); else stopZenReminder();
  if (dimMode) applyZenFocus({ scroll: true }); else clearZenFocus();
}
function setFocusedBlock() { /* legacy no-op: zen focus is per task now (applyZenFocus) */ }

// ── Zen mode: spotlight ONE task; everything else is dimmed ──────────
let _zenTaskId = null;
function clearZenFocus() { document.querySelectorAll('.task-item.zen-focus').forEach(t => t.classList.remove('zen-focus')); }
/** Highlight the chosen task (or the first unfinished one in the open section). */
function applyZenFocus({ taskId, scroll = false } = {}) {
  if (!dimMode) return;
  const items = [...document.querySelectorAll('#dayPanels .task-item')];
  if (!items.length) return;
  if (taskId) _zenTaskId = taskId;
  let target = items.find(t => t.dataset.task === _zenTaskId);
  if (!target) target = items.find(t => !t.classList.contains('done')) || items[0];
  _zenTaskId = target.dataset.task;
  clearZenFocus();
  target.classList.add('zen-focus');
  if (scroll) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
/** After ticking the spotlighted task, move on to the next unfinished one. */
function advanceZenFocus(fromTaskId) {
  if (!dimMode || fromTaskId !== _zenTaskId) return;
  const items = [...document.querySelectorAll('#dayPanels .task-item')];
  const i = items.findIndex(t => t.dataset.task === fromTaskId);
  const next = items.slice(i + 1).find(t => !t.classList.contains('done')) || items.find(t => !t.classList.contains('done'));
  if (next) applyZenFocus({ taskId: next.dataset.task, scroll: true });
}
// Clicking anywhere on a task card (not its buttons/links) moves the spotlight there.
document.addEventListener('click', e => {
  if (!dimMode) return;
  const item = e.target.closest('#dayPanels .task-item');
  if (!item || e.target.closest('a, button, input, textarea, .task-menu')) return;
  applyZenFocus({ taskId: item.dataset.task });
});
if (dimMode) document.documentElement.classList.add('dim-mode');
if (musicOn) zenAudio.start();

// ===== PASSCODE / LOCK LOGIC =====
let _isUnlocked = false;

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ========================================================
// ASCII ART BACKGROUND ENGINE FOR MINIMAL LOCK SCREEN
// Moving ambient art: Brain, Education, AI, Math
// ========================================================

const ASCII_ART_COLLECTION = [
  // --- 1. BRAIN (Cortex / Neuro / Synapse) ---
  {
    category: 'brain',
    label: '// BRAIN · CORTEX //',
    lines: [
      "      .-''''-.     .-''''-.",
      "    .'        `._.'        '.",
      "   /   .-.      :      .-.   \\",
      "  :   (   )     :     (   )   :",
      "  :    `-'      :      `-'    :",
      "   \\           / \\           /",
      "    '.____..-'     '-..____.'"
    ]
  },
  {
    category: 'brain',
    label: '// SYNAPSE MESH //',
    lines: [
      "        [🧠]",
      "      (o)=====(o)",
      "     / | \\   / | \\",
      "    *  |  * *  |  *",
      "     \\ | /   \\ | /",
      "      (o)=====(o)"
    ]
  },
  {
    category: 'brain',
    label: '// NEURAL IQ //',
    lines: [
      "      .-'\"\"'-.",
      "    .'  ____  '.",
      "   /   / __ \\   \\",
      "  |   | (__) |   |",
      "  |    \\____/    |",
      "   \\  BRAIN-AI  /",
      "    '.  PSYCHE .'",
      "      '-....-'"
    ]
  },

  // --- 2. EDUCATION (Books / Scholar / Syllabus) ---
  {
    category: 'education',
    label: '// KNOWLEDGE · STUDY //',
    lines: [
      "       ______   ______",
      "     .-\"      \\ /      \"-.",
      "    |  STUDY   |   LOCK   |",
      "    |  LEARN   |   GROW   |",
      "    |  DEEP    |   FOCUS  |",
      "    '----------'----------'"
    ]
  },
  {
    category: 'education',
    label: '// ACADEMIA · DEGREE //',
    lines: [
      "          .--------.",
      "         /          \\",
      "        /  KNOWLEDGE \\",
      "       *--------------*",
      "       | \\          / |",
      "          \\        /",
      "           '------'"
    ]
  },
  {
    category: 'education',
    label: '// SYLLABUS · ARCHIVE //',
    lines: [
      "     .-------------------.",
      "    /__KNOWLEDGE_BASE___/|",
      "   |  CURRICULUM // ML | |",
      "   |-------------------|/|",
      "   |  STUDY // LOCK-IN | |",
      "   '-------------------'/"
    ]
  },

  // --- 3. AI (Neural Nets / Transformer / Tensors) ---
  {
    category: 'ai',
    label: '// DEEP NEURAL NET //',
    lines: [
      "   [IN]     [HIDDEN]     [OUT]",
      "    (o)-------(o)--------(o)",
      "     \\       /   \\      /",
      "      \\     /     \\    /",
      "       (o)---------(o)",
      "      /   \\       /   \\",
      "    (o)-------(o)--------(o)",
      "     W·x + b   -->   ReLU(z)"
    ]
  },
  {
    category: 'ai',
    label: '// TRANSFORMER ATTENTION //',
    lines: [
      "   +-------------------------+",
      "   | ATTENTION IS ALL U NEED |",
      "   |   Q·K^T / sqrt(d_k)     |",
      "   |     [ TRANSFORMER ]     |",
      "   +-------------------------+"
    ]
  },
  {
    category: 'ai',
    label: '// AI TENSOR AGENT //',
    lines: [
      "       .------------.",
      "      /  AI AGENT   /|",
      "     +-------------+ |",
      "     |  [ 0 1 0 ]  | |",
      "     |  TENSOR_NET |/",
      "     '-------------'"
    ]
  },

  // --- 4. MATH (Calculus / Integrals / Euler / Linear Algebra) ---
  {
    category: 'math',
    label: '// CALCULUS & LIMITS //',
    lines: [
      "         b",
      "        /",
      "       |  f(x) dx = F(b) - F(a)",
      "      /",
      "     a",
      "     lim_{x→0} (sin x / x) = 1"
    ]
  },
  {
    category: 'math',
    label: '// EULER & BASEL SERIES //',
    lines: [
      "       e^(i·π) + 1 = 0",
      "         ∞",
      "        ---",
      "        \\    1       π²",
      "        /   ---  =  ----",
      "        ---  k²       6",
      "        k=1"
    ]
  },
  {
    category: 'math',
    label: '// EIGEN & GRADIENT //',
    lines: [
      "     [ cos θ  -sin θ ]",
      "     [ sin θ   cos θ ]",
      "     det(A - λI) = 0",
      "     ∇_θ L = E[ ∇ log p(x) ]"
    ]
  }
];

const ASCII_SCATTERED_SYMBOLS = [
  "∫ f(x) dx", "∑ x_i", "∂L/∂w", "σ(Wx+b)", "∇_θ L", "e^(iπ) = -1",
  "det(A)", "λ_max", "lim x→∞", "√2", "π ≈ 3.1415", "∞", "∀x ∈ ℝ",
  "∃ε > 0", "P(A|B)", "H(X)", "E=mc²", "c²=a²+b²", "Q·K^T / √d",
  "softmax", "argmax", "ReLU", "[0 1 0 1]", "loss → 0.00", "epoch++",
  "tensor", "synapse", "cortex", "axiom", "lemma", "Q.E.D.", "f: X → Y",
  "⟨u, v⟩", "∥W∥₂", "μ ± 2σ", "dx/dt", "∮ B·dl = μ₀I", "∇²ψ", "argmax_y P(y|x)"
];

const _lockAscii = {
  running: false,
  animId: null,
  canvas: null,
  ctx: null,
  sprites: [],
  particles: [],
  mouse: { x: -9999, y: -9999 },
  initialized: false
};

function initLockAscii() {
  const canvas = document.getElementById('lockAsciiCanvas');
  if (!canvas) return false;
  _lockAscii.canvas = canvas;
  _lockAscii.ctx = canvas.getContext('2d');
  
  function resize() {
    if (!_lockAscii.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    _lockAscii.canvas.width = Math.floor(w * dpr);
    _lockAscii.canvas.height = Math.floor(h * dpr);
    _lockAscii.canvas.style.width = w + 'px';
    _lockAscii.canvas.style.height = h + 'px';
    _lockAscii.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', resize);
  resize();

  const lockScreen = document.getElementById('lockScreen');
  if (lockScreen) {
    lockScreen.addEventListener('click', (e) => {
      if (!e.target.closest('button, a')) {
        const input = document.getElementById('passcodeInput');
        if (input && document.activeElement !== input) input.focus();
      }
    });
    lockScreen.addEventListener('mousemove', (e) => {
      _lockAscii.mouse.x = e.clientX;
      _lockAscii.mouse.y = e.clientY;
    });
    lockScreen.addEventListener('mouseleave', () => {
      _lockAscii.mouse.x = -9999;
      _lockAscii.mouse.y = -9999;
    });
  }

  window.addEventListener('keydown', (e) => {
    if (!_isUnlocked) {
      const input = document.getElementById('passcodeInput');
      if (input && document.activeElement !== input && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        input.focus();
      }
    }
  });

  // Create ASCII Sprites
  const W = window.innerWidth;
  const H = window.innerHeight;
  const numSprites = Math.max(6, Math.min(ASCII_ART_COLLECTION.length, Math.floor(W / 180)));
  
  _lockAscii.sprites = ASCII_ART_COLLECTION.slice(0, numSprites).map((art, idx) => {
    const maxLine = Math.max(...art.lines.map(l => l.length));
    const spriteW = maxLine * 7.2;
    const spriteH = (art.lines.length + 2) * 14;
    
    // Spread them in a grid-like distribution with random jitter
    const cols = Math.ceil(Math.sqrt(numSprites));
    const rows = Math.ceil(numSprites / cols);
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    
    const startX = (col / cols) * W + (Math.random() - 0.5) * 80;
    const startY = (row / rows) * H + (Math.random() - 0.5) * 60;
    
    const speed = 0.2 + Math.random() * 0.25;
    const angle = Math.random() * Math.PI * 2;

    return {
      category: art.category,
      label: art.label,
      lines: art.lines,
      w: spriteW,
      h: spriteH,
      x: startX,
      y: startY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      phase: Math.random() * Math.PI * 2,
      phaseSpeed: 0.0012 + Math.random() * 0.001,
      amplitude: 5 + Math.random() * 6
    };
  });

  // Create scattered math & tech particles
  const numParticles = Math.min(38, Math.max(20, Math.floor(W / 45)));
  _lockAscii.particles = [];
  for (let i = 0; i < numParticles; i++) {
    const sym = ASCII_SCATTERED_SYMBOLS[i % ASCII_SCATTERED_SYMBOLS.length];
    const speed = 0.12 + Math.random() * 0.22;
    const angle = Math.random() * Math.PI * 2;
    _lockAscii.particles.push({
      text: sym,
      x: Math.random() * W,
      y: Math.random() * H,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      seed: Math.random() * 1000,
      size: 10 + Math.random() * 2.5
    });
  }

  _lockAscii.initialized = true;
  return true;
}

function startLockAscii() {
  if (_lockAscii.running) return;
  if (!_lockAscii.initialized) {
    initLockAscii();
  }
  _lockAscii.running = true;

  function loop(time) {
    if (!_lockAscii.running) return;
    renderLockAscii(time);
    _lockAscii.animId = requestAnimationFrame(loop);
  }

  _lockAscii.animId = requestAnimationFrame(loop);
}

function stopLockAscii() {
  _lockAscii.running = false;
  if (_lockAscii.animId) {
    cancelAnimationFrame(_lockAscii.animId);
    _lockAscii.animId = null;
  }
}

function renderLockAscii(time) {
  const ctx = _lockAscii.ctx;
  const canvas = _lockAscii.canvas;
  if (!ctx || !canvas) return;

  const W = window.innerWidth;
  const H = window.innerHeight;
  ctx.clearRect(0, 0, W, H);

  const isLight = document.documentElement.getAttribute('data-theme') === 'light';

  // 1. Draw Scattered Math & AI Particles in Background
  ctx.font = '10.5px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  for (let i = 0; i < _lockAscii.particles.length; i++) {
    const p = _lockAscii.particles[i];
    p.x += p.vx;
    p.y += p.vy;

    // Wrap boundaries
    if (p.x < -120) p.x = W + 50;
    if (p.x > W + 120) p.x = -50;
    if (p.y < -50) p.y = H + 30;
    if (p.y > H + 50) p.y = -30;

    // Gentle pulse
    const pulse = Math.sin(time * 0.0015 + p.seed) * 0.5 + 0.5;
    const alpha = isLight ? (0.08 + pulse * 0.12) : (0.12 + pulse * 0.18);

    ctx.fillStyle = isLight
      ? `rgba(50, 45, 40, ${alpha.toFixed(3)})`
      : `rgba(235, 230, 220, ${alpha.toFixed(3)})`;
    ctx.fillText(p.text, p.x, p.y);
  }

  // 2. Draw Moving Multi-line ASCII Art Sprites
  for (let i = 0; i < _lockAscii.sprites.length; i++) {
    const s = _lockAscii.sprites[i];

    // Physics update with bobbing
    s.x += s.vx;
    s.y += s.vy;

    // Boundary wrapping
    if (s.x > W + 100) s.x = -s.w - 50;
    if (s.x < -s.w - 100) s.x = W + 50;
    if (s.y > H + 80) s.y = -s.h - 50;
    if (s.y < -s.h - 80) s.y = H + 50;

    // Interactive gentle mouse push
    const centerX = s.x + s.w / 2;
    const centerY = s.y + s.h / 2;
    const dx = centerX - _lockAscii.mouse.x;
    const dy = centerY - _lockAscii.mouse.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 180 && dist > 0) {
      const force = ((180 - dist) / 180) * 0.8;
      s.x += (dx / dist) * force;
      s.y += (dy / dist) * force;
    }

    const bobY = s.y + Math.sin(time * s.phaseSpeed + s.phase) * s.amplitude;

    // Category styling & subtle color tinting
    let artColor, labelColor;
    if (isLight) {
      if (s.category === 'brain') {
        artColor = 'rgba(2, 132, 199, 0.22)';
        labelColor = 'rgba(2, 132, 199, 0.35)';
      } else if (s.category === 'education') {
        artColor = 'rgba(180, 83, 9, 0.22)';
        labelColor = 'rgba(180, 83, 9, 0.35)';
      } else if (s.category === 'ai') {
        artColor = 'rgba(126, 34, 206, 0.22)';
        labelColor = 'rgba(126, 34, 206, 0.35)';
      } else { // math
        artColor = 'rgba(40, 35, 30, 0.25)';
        labelColor = 'rgba(40, 35, 30, 0.38)';
      }
    } else {
      if (s.category === 'brain') {
        artColor = 'rgba(56, 189, 248, 0.28)';
        labelColor = 'rgba(56, 189, 248, 0.45)';
      } else if (s.category === 'education') {
        artColor = 'rgba(251, 191, 36, 0.28)';
        labelColor = 'rgba(251, 191, 36, 0.45)';
      } else if (s.category === 'ai') {
        artColor = 'rgba(168, 85, 247, 0.28)';
        labelColor = 'rgba(168, 85, 247, 0.45)';
      } else { // math
        artColor = 'rgba(245, 240, 230, 0.32)';
        labelColor = 'rgba(217, 119, 6, 0.48)';
      }
    }

    // Render category tag
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = labelColor;
    ctx.fillText(s.label, s.x, bobY);

    // Render ASCII art body lines
    ctx.font = '10.5px "JetBrains Mono", monospace';
    ctx.fillStyle = artColor;
    const lineHeight = 13.5;
    for (let l = 0; l < s.lines.length; l++) {
      ctx.fillText(s.lines[l], s.x, bobY + (l + 1) * lineHeight);
    }
  }
}

function getSiteConfig() {
  const el = document.getElementById('site-config');
  return el ? JSON.parse(el.textContent || '{}') : { baseurl: '', passcodeHash: '' };
}

function checkLockState() {
  const unlocked = localStorage.getItem('study-lock-in:unlocked') === 'true';
  const lockScreen = document.getElementById('lockScreen');
  if (unlocked) {
    _isUnlocked = true;
    stopLockAscii();
    if (lockScreen) lockScreen.style.display = 'none';
    return true;
  } else {
    _isUnlocked = false;
    if (lockScreen) {
      lockScreen.style.display = 'flex';
      startLockAscii();
      setupLockMethod();
      const input = document.getElementById('passcodeInput');
      if (input) { input.value = ''; setTimeout(() => input.focus(), 100); }
      _applyLockCooldown();
    }
    return false;
  }
}

// ── Passcode helpers ─────────────────────────────────────────────
// The only accepted passcode is the one whose SHA-256 matches: the custom hash (if changed on this
// device) or _config.yml's passcode_hash. There is no hard-coded fallback passcode any more.
const LOCK_FAIL_KEY = 'study-lock-in:lock-failures';   // { count, until } — throttles repeated wrong guesses
const LOCK_FREE_TRIES = 5, LOCK_BASE_WAIT_S = 30, LOCK_MAX_WAIT_S = 300;
function _passcodeTargetHash() {
  return localStorage.getItem('study-lock-in:custom-passcode-hash') || getSiteConfig().passcodeHash
    || 'ef537ff85794828b8460be01daab559098fb6eb696fc9df92ea8ab5c1c0e3579'; // only if _config.yml has no hash
}
function _lockFailures() {
  try { return JSON.parse(localStorage.getItem(LOCK_FAIL_KEY)) || { count: 0, until: 0 }; } catch { return { count: 0, until: 0 }; }
}
function _lockWaitLeft() { return Math.max(0, Math.ceil((_lockFailures().until - Date.now()) / 1000)); }
function _recordLockFailure() {
  const f = _lockFailures();
  f.count += 1;
  if (f.count >= LOCK_FREE_TRIES) {
    const wait = Math.min(LOCK_MAX_WAIT_S, LOCK_BASE_WAIT_S * 2 ** (f.count - LOCK_FREE_TRIES));
    f.until = Date.now() + wait * 1000;
  }
  localStorage.setItem(LOCK_FAIL_KEY, JSON.stringify(f));
  return f;
}
let _lockCountdown = null;
/** Disable the passcode form while a cooldown is running, with a live countdown. */
function _applyLockCooldown() {
  const input = document.getElementById('passcodeInput');
  const btn = document.querySelector('.lock-minimal-submit');
  const errorEl = document.getElementById('lockError');
  clearInterval(_lockCountdown);
  const tick = () => {
    const left = _lockWaitLeft();
    if (input) input.disabled = left > 0;
    if (btn) btn.disabled = left > 0;
    if (left > 0) { if (errorEl) errorEl.textContent = `Too many wrong attempts. Try again in ${left}s.`; }
    else { clearInterval(_lockCountdown); if (errorEl && /Too many/.test(errorEl.textContent)) errorEl.textContent = ''; if (input) input.focus(); }
  };
  tick();
  if (_lockWaitLeft() > 0) _lockCountdown = setInterval(tick, 1000);
}

/** Shared by the passcode and Google sign-in paths. */
async function _completeUnlock(toast = '🔓 Workspace unlocked') {
  localStorage.removeItem(LOCK_FAIL_KEY);
  localStorage.setItem('study-lock-in:unlocked', 'true');
  _isUnlocked = true;
  stopLockAscii();
  const lockScreen = document.getElementById('lockScreen');
  if (lockScreen) {
    lockScreen.style.opacity = '0';
    lockScreen.style.transition = 'opacity 0.25s ease';
    setTimeout(() => { lockScreen.style.display = 'none'; lockScreen.style.opacity = '1'; }, 250);
  }
  if (!state) await bootTracker();
  showToast(toast);
}

// ── Google sign-in (Google Identity Services) ────────────────────────
// Enabled when _config.yml has google_client_id. Only the account whose lower-cased email hashes to
// allowed_email_sha256 may unlock. The ID token is verified in the browser: RS256 signature against
// Google's published keys, issuer, audience (our client id), expiry, email_verified, email hash.
// NOTE: this is still a client-side gate (the data ships inside the page); see CLAUDE.md.
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
function _b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function _b64urlJson(s) { return JSON.parse(new TextDecoder().decode(_b64urlToBytes(s))); }

async function verifyGoogleCredential(token) {
  const cfg = getSiteConfig();
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'Malformed sign-in token.' };
  let header, payload;
  try { header = _b64urlJson(parts[0]); payload = _b64urlJson(parts[1]); } catch { return { ok: false, reason: 'Unreadable sign-in token.' }; }
  if (header.alg !== 'RS256' || !header.kid) return { ok: false, reason: 'Unexpected token algorithm.' };
  // signature
  let jwks;
  try { jwks = await (await fetch(GOOGLE_CERTS_URL)).json(); } catch { return { ok: false, reason: 'Could not reach Google to verify the sign-in. Check your connection.' }; }
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'Unknown signing key.' };
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, _b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!valid) return { ok: false, reason: 'Invalid sign-in signature.' };
  } catch { return { ok: false, reason: 'Could not verify the sign-in signature.' }; }
  // claims
  const now = Date.now() / 1000;
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) return { ok: false, reason: 'Token not issued by Google.' };
  if (payload.aud !== cfg.googleClientId) return { ok: false, reason: 'Token was issued for a different app.' };
  if (!payload.exp || payload.exp < now - 60) return { ok: false, reason: 'Sign-in expired — try again.' };
  if (!payload.email || payload.email_verified !== true) return { ok: false, reason: 'Google account email is not verified.' };
  const emailHash = await sha256(String(payload.email).trim().toLowerCase());
  if (!cfg.allowedEmailHash || emailHash !== cfg.allowedEmailHash) return { ok: false, reason: `${payload.email} isn't allowed to open this workspace.`, email: payload.email };
  return { ok: true, email: payload.email };
}

async function onGoogleCredential(response) {
  const err = document.getElementById('googleSigninError');
  if (err) err.textContent = 'Verifying…';
  const r = await verifyGoogleCredential(response && response.credential);
  if (r.ok) { if (err) err.textContent = ''; await _completeUnlock('🔓 Signed in with Google'); }
  else {
    if (err) err.textContent = r.reason;
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  }
}

let _gisLoading = null;
function _loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (_gisLoading) return _gisLoading;
  _gisLoading = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.defer = true;
    sc.onload = resolve; sc.onerror = () => { _gisLoading = null; reject(new Error('gsi')); };
    document.head.appendChild(sc);
  });
  return _gisLoading;
}

/** Choose the lock method: Google sign-in when configured, otherwise the passcode form. */
function setupLockMethod() {
  const cfg = getSiteConfig();
  const g = document.getElementById('googleSignin'), form = document.getElementById('lockForm');
  if (!cfg.googleClientId) { if (g) g.hidden = true; if (form) form.hidden = false; return; }
  if (form) form.hidden = true;
  if (g) g.hidden = false;
  const err = document.getElementById('googleSigninError');
  _loadGoogleScript().then(() => {
    google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogleCredential, auto_select: false, cancel_on_tap_outside: true });
    const host = document.getElementById('googleSigninButton');
    if (host) { host.innerHTML = ''; google.accounts.id.renderButton(host, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 260, locale: 'en' }); }
  }).catch(() => { if (err) err.textContent = 'Could not load Google sign-in. Check your connection and reload.'; });
}

async function handleUnlock(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('passcodeInput');
  const errorEl = document.getElementById('lockError');
  const card = document.querySelector('.lock-card');
  const entered = (input?.value || '').trim();
  
  if (_lockWaitLeft() > 0) { _applyLockCooldown(); return; }
  if (!entered) {
    if (errorEl) errorEl.textContent = 'Please enter your passcode.';
    return;
  }

  const enteredHash = await sha256(entered);
  if (enteredHash === _passcodeTargetHash()) {
    await _completeUnlock();
  } else {
    const f = _recordLockFailure();
    if (input) input.value = '';
    if (_lockWaitLeft() > 0) _applyLockCooldown();
    else if (errorEl) {
      const left = LOCK_FREE_TRIES - f.count;
      errorEl.textContent = left <= 2 ? `Incorrect passcode. ${left} attempt${left === 1 ? '' : 's'} left before a short pause.` : 'Incorrect passcode. Try again.';
    }
    if (card) {
      card.classList.remove('shake-anim');
      void card.offsetWidth;
      card.classList.add('shake-anim');
    }
  }
}

function lockApp() {
  localStorage.removeItem('study-lock-in:unlocked');
  _isUnlocked = false;
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();   // don't silently re-sign-in
  if (zenAudio.running) zenAudio.stop();
  const lockScreen = document.getElementById('lockScreen');
  if (lockScreen) {
    lockScreen.style.display = 'flex';
    lockScreen.style.opacity = '1';
    startLockAscii();
    setupLockMethod();
    const input = document.getElementById('passcodeInput');
    if (input) { input.value = ''; input.focus(); }
    const errorEl = document.getElementById('lockError');
    if (errorEl) errorEl.textContent = '';
  }
  showToast('🔒 Workspace locked');
}

function togglePasscodeVisibility() {
  const input = document.getElementById('passcodeInput');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function changePasscode() {
  const cur = prompt('Enter your CURRENT passcode:');
  if (!cur) return;
  const curHash = await sha256(cur.trim());
  if (curHash !== _passcodeTargetHash()) {
    alert('Incorrect current passcode.');
    return;
  }
  const next = prompt('Enter your NEW passcode (at least 4 characters):');
  if (!next || !next.trim()) return;
  if (next.trim().length < 4) { alert('Passcode must be at least 4 characters.'); return; }
  const again = prompt('Type the NEW passcode again to confirm:');
  if (again === null) return;
  if (again.trim() !== next.trim()) { alert('Passcodes did not match — nothing was changed.'); return; }
  const nextHash = await sha256(next.trim());
  localStorage.setItem('study-lock-in:custom-passcode-hash', nextHash);
  showToast('🔑 Passcode updated successfully');
}

// ===== STATE & DATA LAYER (CLIENT-SIDE) =====
let state = null;
let activeComposeTaskId = null;
let _allSyllabi = {};
let _activeSyllabusKey = 'math-for-ml';

let _embeddedSyllabiCache = null;
function getEmbeddedSyllabi() {
  if (_embeddedSyllabiCache) return _embeddedSyllabiCache;
  const el = document.getElementById('syllabi-data');
  try {
    _embeddedSyllabiCache = el ? JSON.parse(el.textContent || '{}') || {} : {};
  } catch (err) {
    console.error('Failed to parse embedded syllabi', err);
    _embeddedSyllabiCache = {};
  }
  return _embeddedSyllabiCache;
}

function slugify(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Normalise one raw YAML syllabus into in-memory app state.
 *
 * Current schema:  sections: [{ id, title, subtitle, requires: [], tasks: [{ text, done, bonus, ... }] }]
 * Legacy schema:   days: [{ title, label, blocks: [{ is_bonus, tasks: [...] }] }]   (still accepted)
 *
 * Internally each section is a "day" with blocks (current schema → exactly one implicit block),
 * so the rest of the app keeps working on state.days[].blocks[].tasks[].
 */
function syllabusToState(raw) {
  raw = raw || {};
  const meta = { ...(raw.meta || {}) };
  if (!meta.title) meta.title = 'Study Lock-In';
  if (meta.subtitle == null) meta.subtitle = '';
  const rawState = raw.state || {};
  const days = [];
  const checked = {}, doneAt = {}, comments = {}, journal = {}, timeLog = {}, customResources = {};

  const readTask = (rawTask, taskId, forceBonus) => {
    rawTask = rawTask || {};
    if (rawTask.done) checked[taskId] = true;
    if (rawTask.done_at) doneAt[taskId] = rawTask.done_at;
    if (rawTask.comments && rawTask.comments.length) comments[taskId] = [...rawTask.comments];
    if (rawTask.custom_resources && rawTask.custom_resources.length) customResources[taskId] = [...rawTask.custom_resources];
    return {
      id: taskId,
      text: rawTask.text || '',
      resources: rawTask.resources || [],
      bonus: !!(rawTask.bonus || forceBonus),
    };
  };

  if (Array.isArray(raw.sections)) {
    const used = new Set();
    raw.sections.forEach((sec, si) => {
      sec = sec || {};
      let id = slugify(sec.id) || slugify(sec.title) || `section-${si + 1}`;
      if (used.has(id)) { let n = 2; while (used.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
      used.add(id);
      if (sec.journal) journal[id] = sec.journal;
      if (sec.time_logged) timeLog[id] = sec.time_logged;
      const title = sec.title || `Section ${si + 1}`;
      days.push({
        id,
        title,
        subtitle: sec.subtitle || '',
        label: title,
        requires: (sec.requires || []).map(r => String(r).trim()).filter(Boolean),
        blocks: [{ id: `${id}-blk`, title: '', tasks: (sec.tasks || []).map((t, ti) => readTask(t, `${id}-t${ti + 1}`)) }],
      });
    });
  } else {
    // Legacy day/block schema — ids stay positional (day-N-blk-M-task-K) exactly as before.
    (raw.days || []).forEach((rawDay, di) => {
      const dayId = `day-${di + 1}`;
      if (rawDay.journal) journal[dayId] = rawDay.journal;
      if (rawDay.time_logged) timeLog[dayId] = rawDay.time_logged;
      const blocks = (rawDay.blocks || []).map((rawBlock, bi) => {
        const blockId = `${dayId}-blk-${bi + 1}`;
        return {
          id: blockId,
          title: rawBlock.title || '',
          tasks: (rawBlock.tasks || []).map((rawTask, ti) => readTask(rawTask, `${blockId}-task-${ti + 1}`, rawBlock.is_bonus)),
        };
      });
      const title = rawDay.title || `Section ${di + 1}`;
      days.push({ id: dayId, title, subtitle: rawDay.subtitle || '', label: rawDay.label || title, requires: [], blocks });
    });
  }

  const ids = new Set(days.map(d => d.id));
  const firstDay = days.length ? days[0].id : '';
  const pick = (...c) => c.find(v => v && ids.has(v)) || firstDay;

  return {
    meta,
    days,
    checked,
    doneAt,
    comments,
    customResources,
    journal,
    timeLog,
    activeDay: pick(rawState.active_section, rawState.active_day),
    journalDay: pick(rawState.journal_section, rawState.journal_day),
    startDate: rawState.start_date || null,
    theme: rawState.theme || 'dark',
  };
}

// ── Legacy id migration ───────────────────────────────────────────
// _data/legacy_ids.yml maps old positional ids (day-4, day-4-blk-2-task-1) to the
// section ids (llama-cpp, llama-cpp-t5) for progress that only lives in localStorage.
// Safe to delete that file once every device has loaded the app once.
let _legacyIds = null;
function getLegacyIdMap(key) {
  if (_legacyIds === null) {
    const el = document.getElementById('legacy-ids');
    try { _legacyIds = (el && JSON.parse(el.textContent || 'null')) || {}; } catch { _legacyIds = {}; }
  }
  return _legacyIds[key] || null;
}

/** Rewrite legacy ids inside a state-like object in place. Returns true if anything changed. */
function migrateLegacyIds(obj, key) {
  const map = getLegacyIdMap(key);
  if (!map || !obj || typeof obj !== 'object') return false;
  let changed = false;
  for (const f of ['checked', 'doneAt', 'comments', 'customResources', 'journal', 'timeLog']) {
    const src = obj[f];
    if (!src || typeof src !== 'object') continue;
    for (const k of Object.keys(src)) {
      if (!map[k]) continue;
      if (!(map[k] in src)) src[map[k]] = src[k];
      delete src[k];
      changed = true;
    }
  }
  for (const f of ['activeDay', 'journalDay']) {
    if (obj[f] && map[obj[f]]) { obj[f] = map[obj[f]]; changed = true; }
  }
  return changed;
}

function loadLocalOverrides(syllabusKey) {
  try {
    const storageKey = `study-lock-in:state:${syllabusKey}`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (migrateLegacyIds(parsed, syllabusKey)) {
      delete parsed.days; // stale legacy structure; the YAML is the structure source of truth
      localStorage.setItem(storageKey, JSON.stringify(parsed));
      console.log('[migrate] legacy ids → section ids for', syllabusKey);
    }
    return parsed;
  } catch (e) {
    console.warn('Failed to parse local state', e);
    return null;
  }
}

function saveLocalState() {
  if (!state || !_activeSyllabusKey) return;
  try {
    localStorage.setItem(`study-lock-in:state:${_activeSyllabusKey}`, JSON.stringify(state));
    console.log('[storage] state saved for', _activeSyllabusKey);
  } catch (e) {
    console.error('Failed to save state to localStorage', e);
  }
}

/** Embedded (Jekyll-built) syllabus + this device's localStorage progress, for ANY syllabus key. */
function getSyllabusState(key) {
  const all = getEmbeddedSyllabi();
  const raw = all[key] || { meta: { title: 'Study Tracker' }, sections: [] };
  const base = syllabusToState(raw);
  const o = loadLocalOverrides(key);
  if (!o) return base;
  const ids = new Set(base.days.map(d => d.id));
  return {
    ...base,
    checked: { ...base.checked, ...(o.checked || {}) },
    doneAt: { ...base.doneAt, ...(o.doneAt || {}) },
    journal: { ...base.journal, ...(o.journal || {}) },
    timeLog: { ...base.timeLog, ...(o.timeLog || {}) },
    comments: { ...base.comments, ...(o.comments || {}) },
    customResources: { ...base.customResources, ...(o.customResources || {}) },
    activeDay: ids.has(o.activeDay) ? o.activeDay : base.activeDay,
    journalDay: ids.has(o.journalDay) ? o.journalDay : base.journalDay,
    startDate: o.startDate || base.startDate,
    theme: o.theme || base.theme,
  };
}

function loadStateForSyllabus(key) {
  _allSyllabi = getEmbeddedSyllabi();
  const resolved = _allSyllabi[key] ? key : (Object.keys(_allSyllabi)[0] || key);
  state = getSyllabusState(resolved);
  _activeSyllabusKey = resolved;
  localStorage.setItem('study-lock-in:active-syllabus', resolved);
  loadUIState();
  state.journalDay = state.activeDay;   // notes always belong to the open section
}

function postEvent(event) {
  console.log('[local-event] apply:', event.op, event);
  if (!state) return Promise.resolve();

  const op = event.op;
  if (op === 'task') {
    state.checked[event.id] = event.v;
    if (event.v) {
      if (!state.doneAt) state.doneAt = {};
      state.doneAt[event.id] = new Date().toISOString();
      appendLocalActivity(findTaskText(event.id), 'done');
    } else {
      if (state.doneAt) delete state.doneAt[event.id];
      appendLocalActivity(findTaskText(event.id), 'undone');
    }
  } else if (op === 'journal') {
    const dayId = event.dayId || event.day;
    if (event.v) state.journal[dayId] = event.v; else delete state.journal[dayId];
  } else if (op === 'time') {
    const dayId = event.dayId || event.day;
    state.timeLog[dayId] = (state.timeLog[dayId] || 0) + event.v;
  } else if (op === 'set') {
    if (['activeDay', 'journalDay', 'startDate', 'theme'].includes(event.k)) {
      state[event.k] = event.v;
    }
  } else if (op === 'comment_add') {
    if (!state.comments) state.comments = {};
    if (!state.comments[event.id]) state.comments[event.id] = [];
    state.comments[event.id].push(event.v);
  } else if (op === 'comment_rm') {
    if (state.comments && state.comments[event.id]) {
      state.comments[event.id].splice(event.idx, 1);
      if (!state.comments[event.id].length) delete state.comments[event.id];
    }
  } else if (op === 'res_add') {
    if (!state.customResources) state.customResources = {};
    if (!state.customResources[event.id]) state.customResources[event.id] = [];
    state.customResources[event.id].push({ label: event.label, url: event.url });
  } else if (op === 'res_rm') {
    if (state.customResources && state.customResources[event.id]) {
      state.customResources[event.id].splice(event.idx, 1);
      if (!state.customResources[event.id].length) delete state.customResources[event.id];
    }
  } else if (op === 'meta_edit') {
    if (!state.meta) state.meta = {};
    for (const k of ['title', 'subtitle']) if (k in event) state.meta[k] = event[k];
  } else if (op === 'day_edit') {
    const day = (state.days || []).find(d => d.id === event.id);
    if (day) for (const k of ['title', 'subtitle', 'label']) if (k in event) day[k] = event[k];
  } else if (op === 'block_edit') {
    for (const d of state.days || []) {
      const b = (d.blocks || []).find(blk => blk.id === event.id);
      if (b) { for (const k of ['title', 'badge', 'icon', 'isBonus']) if (k in event) b[k] = event[k]; break; }
    }
  } else if (op === 'activity_add') {
    addLocalActivity(event.entry);
  } else if (op === 'activity_rm') {
    removeLocalActivity(event.key);
  } else if (op === 'task_edit') {
    for (const d of state.days || []) {
      for (const b of d.blocks || []) {
        const t = (b.tasks || []).find(tsk => tsk.id === event.id);
        if (t && 'text' in event) { t.text = event.text; break; }
      }
    }
  }

  saveLocalState();
  return Promise.resolve();
}

// ===== HELPERS =====


// ── UI State (localStorage) ─────────────────────────────────────
// activeDay, journalDay, theme are pure navigation preferences.
// They NEVER write to the TOML file — stored in localStorage only,
// keyed per-syllabus so switching syllabuses restores the right position.

const _UI_STATE_KEY = 'study-tracker-ui';

function _uiStateKey() {
  return `${_UI_STATE_KEY}:${_activeSyllabusKey || 'default'}`;
}

function saveUIState() {
  const ui = {
    activeDay:  state.activeDay  || '',
    journalDay: state.journalDay || '',
    theme:      state.theme      || 'dark',
  };
  localStorage.setItem(_uiStateKey(), JSON.stringify(ui));
  console.log('[ui-state] saved to localStorage:', ui);
}

function loadUIState() {
  try {
    const raw = localStorage.getItem(_uiStateKey());
    if (!raw) { console.log('[ui-state] no saved UI state for', _uiStateKey()); return; }
    const ui = JSON.parse(raw);
    migrateLegacyIds(ui, _activeSyllabusKey);
    // Only apply if the day still exists in the loaded syllabus
    const dayIds = new Set((state.days || []).map(d => d.id));
    if (ui.activeDay  && dayIds.has(ui.activeDay))  state.activeDay  = ui.activeDay;
    if (ui.journalDay && dayIds.has(ui.journalDay)) state.journalDay = ui.journalDay;
    if (ui.theme) { state.theme = ui.theme; applyTheme(ui.theme); }
    console.log('[ui-state] restored from localStorage:', ui);
  } catch (e) {
    console.warn('[ui-state] loadUIState error:', e);
  }
}

/** Measure the sticky header and write its height into --header-height so
 *  the day-nav can stick flush below it. Re-runs on resize too. */
function _syncHeaderHeight() {
  // Defer to after the browser finishes layout — rAF fires post-paint,
  // so getBoundingClientRect() returns the real rendered height, not 0.
  requestAnimationFrame(() => {
    const header = document.querySelector('.header');
    if (!header) return;
    const h = header.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--header-height', h + 'px');
    console.log('[layout] _syncHeaderHeight: header height =', h + 'px');
  });
}
window.addEventListener('resize', _syncHeaderHeight);
// Store observer globally so renderApp() can re-observe the new header element after each re-render
if (typeof ResizeObserver !== 'undefined') {
  window._headerObserver = new ResizeObserver(_syncHeaderHeight);
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function findDay(id) { return state.days.find(d => d.id === id); }
function findDayIndex(id) { return state.days.findIndex(d => d.id === id); }
function getActiveDay() { return findDay(state.activeDay); }

// ===== INLINE EDITING =====
function makeEditable(el, currentValue, onSave, opts = {}) {
  if (el.querySelector('input, textarea')) return;
  const isMultiline = opts.multiline || false;
  const input = document.createElement(isMultiline ? 'textarea' : 'input');
  input.type = 'text';
  input.className = 'inline-edit-input' + (isMultiline ? ' multiline' : '');
  input.value = currentValue;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  const originalHTML = el.innerHTML;
  el.innerHTML = '';
  el.appendChild(input);
  el.classList.add('editing');
  input.focus();
  input.select();
  let saved = false;
  const save = () => {
    if (saved) return; saved = true;
    const v = input.value.trim();
    el.classList.remove('editing');
    if (v && v !== currentValue) { onSave(v); }
    else { el.innerHTML = originalHTML; }
  };
  const cancel = () => { saved = true; el.innerHTML = originalHTML; el.classList.remove('editing'); };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !isMultiline) { e.preventDefault(); input.blur(); }
    if (e.key === 'Enter' && isMultiline && (e.ctrlKey || e.metaKey)) { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

function editMeta(field, el) {
  const val = (state.meta && state.meta[field]) || '';
  makeEditable(el, val, newVal => {
    state.meta[field] = newVal;
    postEvent({ op: 'meta_edit', [field]: newVal });
    if (field === 'title') document.title = newVal;
    renderApp();
  });
}

function editDayField(dayId, field, el) {
  const day = findDay(dayId);
  if (!day) return;
  makeEditable(el, day[field] || '', newVal => {
    if (field === 'title' && day.label === day.title) day.label = newVal; // label mirrors title in the sections schema
    day[field] = newVal;
    postEvent({ op: 'day_edit', id: dayId, [field]: newVal });
    if (field === 'label' || field === 'title') renderDayNav();
    renderActivePanel();
    renderJournal();
  });
}

function editBlockTitle(blockId, el) {
  for (const day of state.days) {
    for (const block of day.blocks) {
      if (block.id === blockId) {
        makeEditable(el, block.title, newVal => {
          block.title = newVal;
          postEvent({ op: 'block_edit', id: blockId, title: newVal });
          renderActivePanel();
        });
        return;
      }
    }
  }
}

function editTaskInline(taskId, el) {
  for (const day of state.days) {
    for (const block of day.blocks) {
      for (const task of block.tasks) {
        if (task.id === taskId) {
          makeEditable(el, task.text, newVal => {
            task.text = newVal;
            postEvent({ op: 'task_edit', id: taskId, text: newVal });
            renderActivePanel();
          }, { multiline: true });
          return;
        }
      }
    }
  }
}

function toggleTaskMenu(taskId) {
  const pop = document.getElementById('task-menu-' + taskId);
  if (!pop) return;
  const open = pop.hidden;
  closeTaskMenus();
  if (!open) return;
  pop.classList.remove('up');
  pop.hidden = false;
  pop.closest('.task-item')?.classList.add('menu-open');    // lift this card above its neighbours
  // open downward; flip up only when there isn't room below in the viewport
  const r = pop.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 8 && r.top - r.height - 50 > 0) pop.classList.add('up');
}
function closeTaskMenus() {
  document.querySelectorAll('.task-menu-pop:not([hidden])').forEach(p => { p.hidden = true; });
  document.querySelectorAll('.task-item.menu-open').forEach(t => t.classList.remove('menu-open'));
}

/** Edit button handler: open the inline editor on the task's text (text is no longer click-to-edit). */
function editTaskText(taskId) {
  const el = document.querySelector(`#task-${CSS.escape(taskId)} .task-text`);
  if (el) editTaskInline(taskId, el);
}

// ===== RENDER: APP SHELL =====
function renderApp() {
  console.log('[render] renderApp: building UI, days:', state.days?.length, '| activeDay:', state.activeDay);
  const app = document.getElementById('app');
  const meta = state.meta || {};
  app.innerHTML = `
    <header class="header">
      <div class="header-content">
        <div class="header-left">
          <div class="logo">
            <div class="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div><h1 class="editable" onclick="editMeta('title', this)" title="Click to edit title">${escapeHtml(meta.title || 'Study Tracker')}</h1>
            <p class="subtitle editable" onclick="editMeta('subtitle', this)" title="Click to edit subtitle">${escapeHtml(meta.subtitle || 'Click to set subtitle')}</p></div>
          </div>
          <nav class="view-switch" aria-label="View">
            <a href="#study" data-view="study" onclick="setView('study'); return false;">Study</a>
            <a href="#overview" data-view="overview" onclick="setView('overview'); return false;">Overview</a>
          </nav>
        </div>
        <div class="header-right">
          <div class="header-stat"><span class="stat-label">Overall</span><span class="stat-value" id="overallPercent">0%</span></div>
          <div class="header-stat header-stat-streak"><span class="stat-label">Streak</span><span class="stat-value" id="streakCount">0 🔥</span></div>
          <div class="syllabus-switcher" id="syllabusSwitcher" title="Switch syllabus">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            <select id="syllabusSelect" title="Switch active syllabus"></select>
          </div>
          <div class="app-menu" id="appMenu">
            <button class="app-menu-btn" id="appMenuBtn" onclick="toggleAppMenu(event)" title="Menu" aria-haspopup="true" aria-expanded="false">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
            </button>
            <div class="app-menu-pop" role="menu" hidden>
              <button class="app-menu-item" id="themeToggle" role="menuitem">
                <svg class="theme-icon icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                <svg class="theme-icon icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                <span>Toggle theme</span></button>
              <button class="app-menu-item" id="musicToggle" role="menuitem">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                <span>Study music</span><i class="app-menu-state"></i></button>
              <button class="app-menu-item" id="dimToggle" role="menuitem">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c-4-4-8-7.5-8-12a8 8 0 0 1 16 0c0 4.5-4 8-8 12z"/><path d="M12 10v6"/><path d="M9 13l3-3 3 3"/></svg>
                <span>Zen mode</span><i class="app-menu-state"></i></button>
              <div class="app-menu-sep"></div>
              <button class="app-menu-item" id="dataToggle" role="menuitem">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>Export / Import</span></button>
              <button class="app-menu-item danger" id="resetBtn" role="menuitem">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                <span>Reset progress…</span></button>
              <div class="app-menu-sep"></div>
              <button class="app-menu-item" id="lockBtn" onclick="lockApp()" role="menuitem">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <span>Lock workspace</span></button>
            </div>
          </div>
        </div>
      </div>
      <div class="data-panel" id="dataPanel" style="display:none">
        <div class="data-panel-content">
          <div class="data-section">
            <h3 class="data-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>
              Export & Git Sync
            </h3>
            <div class="data-buttons">
              <button class="data-btn" onclick="exportSyllabus()" title="Download YAML file to drop into _data/syllabi/ and commit">
                <span class="data-btn-icon">💾</span>
                <span class="data-btn-text">Export for Git<small>.yml</small></span>
              </button>
              <button class="data-btn" onclick="exportState()" title="Download JSON state backup">
                <span class="data-btn-icon">📦</span>
                <span class="data-btn-text">Backup State<small>.json</small></span>
              </button>
              <button class="data-btn" onclick="exportActivity()" title="Download the merged activity log to replace _data/activity.yml and commit">
                <span class="data-btn-icon">🔥</span>
                <span class="data-btn-text">Export Activity<small>activity.yml</small></span>
              </button>
            </div>
          </div>
          <div class="data-divider"></div>
          <div class="data-section">
            <h3 class="data-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="17 11 12 6 7 11"/><line x1="12" y1="6" x2="12" y2="18"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>
              Import & Git Baseline
            </h3>
            <div class="data-buttons">
              <button class="data-btn import-btn" onclick="importSyllabusFile()" title="Load a .yml or .json file — replaces active syllabus data">
                <span class="data-btn-icon">📂</span>
                <span class="data-btn-text">Import File<small>.yml / .json</small></span>
              </button>
              <button class="data-btn" onclick="resetToRepoBaseline()" title="Discard unexported local progress and reload pristine YAML from Git">
                <span class="data-btn-icon">🔄</span>
                <span class="data-btn-text">Reset to Git<small>Baseline</small></span>
              </button>
            </div>
            <p class="data-hint">💡 Workflow: Export .yml → drop in <code>_data/syllabi/</code> → commit & push to GitHub Pages.</p>
          </div>
          <div class="data-divider"></div>
          <div class="data-section">
            <h3 class="data-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Security
            </h3>
            <div class="data-buttons">
              <button class="data-btn" onclick="changePasscode()" title="Change passcode">
                <span class="data-btn-icon">🔑</span>
                <span class="data-btn-text">Change Passcode</span>
              </button>
              <button class="data-btn" onclick="lockApp()" title="Lock workspace immediately">
                <span class="data-btn-icon">🔒</span>
                <span class="data-btn-text">Lock Workspace</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="overall-progress"><div class="overall-progress-bar" id="overallBar" style="width:0%"></div></div>
    </header>

    <div class="overview-head view-overview-only">
      <h2>Overview</h2>
      <p>Progress, activity and how your syllabi connect.</p>
    </div>
    <div class="stats-grid" id="statsGrid">
      <div class="stat-card"><div class="stat-card-icon tasks-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div><div class="stat-card-info"><span class="stat-card-value" id="completedTasks">0 / 0</span><span class="stat-card-label">Tasks Completed</span></div></div>
      <div class="stat-card"><div class="stat-card-icon bonus-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div><div class="stat-card-info"><span class="stat-card-value" id="bonusDone">0 / 0</span><span class="stat-card-label">Bonus Tasks Done</span></div></div>
      <div class="stat-card"><div class="stat-card-icon days-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div class="stat-card-info"><span class="stat-card-value" id="daysComplete">0 / 0</span><span class="stat-card-label">Sections Done</span></div></div>
    </div>

    <div class="activity-heatmap" id="activityHeatmap">
      <div class="heatmap-header">
        <h3 class="heatmap-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Study Activity
        </h3>
        <button class="log-activity-btn" id="logActivityBtn" onclick="toggleLogActivity()" title="Log something you studied that isn't in a syllabus (a talk, an article, a video…)">+ Log</button>
        <div class="heatmap-legend">
          <span class="heatmap-legend-label">Less</span>
          <span class="heatmap-legend-cell" data-level="0"></span>
          <span class="heatmap-legend-cell" data-level="1"></span>
          <span class="heatmap-legend-cell" data-level="2"></span>
          <span class="heatmap-legend-cell" data-level="3"></span>
          <span class="heatmap-legend-cell" data-level="4"></span>
          <span class="heatmap-legend-cell" data-level="5"></span>
          <span class="heatmap-legend-cell" data-level="6"></span>
          <span class="heatmap-legend-cell" data-level="7"></span>
          <span class="heatmap-legend-cell" data-level="8"></span>
          <span class="heatmap-legend-label">🔥</span>
        </div>
      </div>
      <div class="log-activity" id="logActivity" hidden></div>
      <div class="heatmap-body" id="heatmapBody"></div>
    </div>

    <div class="hour-heatmap" id="hourHeatmap"></div>


    <div class="study-layout view-study-only">
      <nav class="day-nav" id="dayNav" aria-label="Sections"></nav>
      <div class="study-main">
        <div id="addDayFormArea"></div>
        <main class="day-panels" id="dayPanels"></main>
        <section class="journal-section" id="journalSection"></section>
      </div>
    </div>
    <footer class="footer"><p>${escapeHtml(meta.title || 'Study Tracker')} · Data saved locally · <span class="editable footer-edit" onclick="editMeta('title', this.closest('.footer').querySelector('p'))" title="Click to edit">✏️</span></p></footer>

  `;

  // Bind static events
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('dimToggle').addEventListener('click', toggleDimMode);
  const dimBtn = document.getElementById('dimToggle');
  if (dimMode) dimBtn.classList.add('active');
  document.getElementById('musicToggle').addEventListener('click', toggleMusic);
  const musicBtn = document.getElementById('musicToggle');
  if (musicOn) musicBtn.classList.add('active');
  document.getElementById('resetBtn').addEventListener('click', resetAll);
  document.getElementById('dataToggle').addEventListener('click', toggleDataPanel);
  document.querySelectorAll('.app-menu-item').forEach(it => it.addEventListener('click', () => closeAppMenu()));
  _syncMenuStates();
  applyView();

  renderDayNav();
  renderActivePanel();
  renderJournal();
  updateStats();
  loadSyllabusList();
  // Keep day-nav sticky exactly below the header; also re-observe the new header element
  _syncHeaderHeight();
  if (typeof ResizeObserver !== 'undefined' && window._headerObserver) {
    const h = document.querySelector('.header');
    if (h) window._headerObserver.observe(h);
  }
}

// ===== VIEWS: Study (do the current section) / Overview (stats, heatmap, map) =====
const VIEW_KEY = 'study-lock-in:view';
function getView() {
  const h = (location.hash || '').replace('#', '');
  if (h === 'study' || h === 'overview') return h;
  return localStorage.getItem(VIEW_KEY) === 'overview' ? 'overview' : 'study';
}
function applyView() {
  const v = getView();
  document.body.dataset.view = v;
  if (v === 'overview') requestAnimationFrame(() => renderHourHeatmap());   // canvas needs a visible size
  document.querySelectorAll('.view-switch a').forEach(a => {
    a.classList.toggle('on', a.dataset.view === v);
    a.setAttribute('aria-current', a.dataset.view === v ? 'page' : 'false');
  });
}
function setView(v) {
  if (v !== 'study' && v !== 'overview') return;
  localStorage.setItem(VIEW_KEY, v);
  if (location.hash !== '#' + v) history.pushState(null, '', '#' + v);
  applyView();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', applyView);
window.addEventListener('popstate', applyView);

// ===== HEADER ⋯ MENU =====
function toggleAppMenu(e) {
  if (e) e.stopPropagation();
  const pop = document.querySelector('#appMenu .app-menu-pop');
  if (!pop) return;
  const open = pop.hidden;
  pop.hidden = !open;
  document.getElementById('appMenuBtn')?.setAttribute('aria-expanded', String(open));
  if (open) _syncMenuStates();
}
function closeAppMenu() {
  const pop = document.querySelector('#appMenu .app-menu-pop');
  if (pop && !pop.hidden) { pop.hidden = true; document.getElementById('appMenuBtn')?.setAttribute('aria-expanded', 'false'); }
}
function _syncMenuStates() {
  document.getElementById('musicToggle')?.classList.toggle('active', !!musicOn);
  document.getElementById('dimToggle')?.classList.toggle('active', !!dimMode);
}
document.addEventListener('click', e => {
  if (!e.target.closest('#appMenu')) closeAppMenu();
  if (!e.target.closest('.task-menu')) closeTaskMenus();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAppMenu(); closeTaskMenus(); } });

// ===== RENDER: DAY NAVIGATION =====
function renderDayNav() {
  const nav = document.getElementById('dayNav');
  let html = '';
  state.days.forEach((day, i) => {
    const isActive = day.id === state.activeDay;
    const isComplete = isDayComplete(day.id);
    const cls = ['day-pill'];
    if (isActive) cls.push('active');
    if (isComplete) cls.push('completed');
    html += `<button class="${cls.join(' ')}" data-day="${day.id}" onclick="switchDay('${day.id}')">
      <span class="day-pill-number">${i + 1}</span>
      <span class="day-pill-label">${escapeHtml(day.label || day.title)}</span>
      <div class="day-pill-progress"><div class="day-pill-bar" id="dayBar-${day.id}"></div></div>
    </button>`;
  });
  // Add day button
  html += `<button class="day-pill add-day-pill" onclick="showAddDayForm()" title="Add a new section">
    <span class="day-pill-number">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </span>
    <span class="day-pill-label">ADD SECTION</span>
  </button>`;
  nav.innerHTML = html;

  // The section nav is a single horizontally scrolling row; keep the active section visible
  const activePill = nav.querySelector('.day-pill.active');
  if (activePill && _isVerticalNav(nav)) {
    if (nav.scrollHeight > nav.clientHeight) nav.scrollTop = activePill.offsetTop - (nav.clientHeight - activePill.offsetHeight) / 2;
  } else if (activePill && nav.scrollWidth > nav.clientWidth) {
    nav.scrollLeft = activePill.offsetLeft - (nav.clientWidth - activePill.offsetWidth) / 2;
  }
  _bindDayNavScroll(nav);
}

/** Desktop niceties for the scrolling section nav: vertical wheel scrolls it sideways, edges fade when more is hidden. */
/** PC shows the section list as a vertical sidebar; phones keep the horizontal scrolling row. */
function _isVerticalNav(nav) { return getComputedStyle(nav).flexDirection === 'column'; }

function _bindDayNavScroll(nav) {
  const updateFade = () => {
    if (_isVerticalNav(nav)) { nav.classList.remove('fade-left', 'fade-right'); return; }
    const max = nav.scrollWidth - nav.clientWidth;
    nav.classList.toggle('fade-left', nav.scrollLeft > 2);
    nav.classList.toggle('fade-right', max > 2 && nav.scrollLeft < max - 2);
  };
  if (!nav._scrollBound) {
    nav._scrollBound = true;
    nav.addEventListener('scroll', updateFade, { passive: true });
    nav.addEventListener('wheel', e => {
      if (_isVerticalNav(nav)) return;   // sidebar scrolls vertically as normal
      if (nav.scrollWidth <= nav.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // trackpads already scroll sideways
      e.preventDefault();
      nav.scrollLeft += e.deltaY;
    }, { passive: false });
    nav._updateFade = updateFade;
  }
  updateFade();
}
window.addEventListener('resize', () => {
  document.querySelectorAll('#dayNav, .journal-tabs').forEach(el => { if (el._updateFade) el._updateFade(); });
});

// ===== RENDER: ACTIVE DAY PANEL =====
function renderActivePanel() {
  const container = document.getElementById('dayPanels');
  const day = getActiveDay();
  if (!day) { container.innerHTML = '<p class="empty-state">No sections yet. Click <strong>+ ADD SECTION</strong> to get started.</p>'; return; }

  if (!day.blocks || !day.blocks.length) day.blocks = [{ id: `${day.id}-blk`, title: '', tasks: [] }];
  const tasks = day.blocks.flatMap(b => b.tasks);
  const addBlockId = day.blocks[day.blocks.length - 1].id;
  const prog = sectionProgress(day, state.checked);

  // Prerequisites (same-syllabus ids or "other-syllabus/section-id")
  let reqHtml = '';
  if ((day.requires || []).length) {
    const model = buildSyllabiMap();
    const chips = day.requires.map(ref => {
      const id = resolveSectionRef(ref, _activeSyllabusKey);
      const n = model.byId[id];
      if (!n) return `<span class="req-chip is-ghost" title="Not found — treated as satisfied">✓ ${escapeHtml(ref)}</span>`;
      const ok = model.satisfied(id);
      const syl = model.sylByKey[n.key];
      return `<button class="req-chip ${ok ? 'is-ok' : 'is-blocking'}" style="--c:${syl.color}" onclick="mapGo('${_jsq(n.key)}','${_jsq(n.sid)}')" title="${ok ? 'Done' : 'Not done yet'}">
        ${ok ? '✓' : '○'} <i>${escapeHtml(syl.short)}</i> ${escapeHtml(n.title)}</button>`;
    }).join('');
    reqHtml = `<div class="section-requires"><span class="section-requires-label">Requires</span>${chips}</div>`;
  }

  let html = `<div class="day-panel active">
    <div class="day-header">
      <h2 class="day-title editable" onclick="editDayField('${day.id}', 'title', this)" title="Click to edit title">${escapeHtml(day.title)}</h2>
      <p class="day-subtitle editable" onclick="editDayField('${day.id}', 'subtitle', this)" title="Click to edit subtitle">${escapeHtml(day.subtitle || 'Click to add subtitle…')}</p>
      <div class="day-meta">
        <span class="day-progress-text">${prog.done}/${prog.total} tasks${prog.complete ? ' · ✓ section done' : ''}</span>
        ${state.days.length > 1 ? `<button class="meta-action-btn danger" onclick="removeDay('${day.id}')" title="Delete section">🗑️</button>` : ''}
      </div>
      ${reqHtml}
    </div>
    <div class="block-card section-card expanded" data-block="${addBlockId}">
      <div class="block-content"><div class="block-tasks">`;

  tasks.forEach(task => { html += renderTask(task, day.id); });   // original order; completed tasks stay in place

  html += `<div class="add-task-row">
        <button class="add-item-btn" onclick="showAddTaskForm('${addBlockId}')" id="add-task-trigger-${addBlockId}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add task
        </button>
        <div class="add-task-form" id="add-task-form-${addBlockId}" style="display:none">
          <textarea placeholder="Task description..." class="add-item-input" id="add-task-input-${addBlockId}" rows="2" onkeydown="handleAddTaskKey(event, '${addBlockId}')"></textarea>
          <div class="add-item-actions">
            <button class="resource-form-btn save" onclick="submitAddTask('${addBlockId}')">Add</button>
            <button class="resource-form-btn cancel" onclick="cancelAddTask('${addBlockId}')">Cancel</button>
          </div>
        </div>
      </div>`;

  html += '</div></div></div></div>';
  container.innerHTML = html;
  if (container.dataset.day !== day.id) { container.dataset.day = day.id; _zenTaskId = null; }
  applyZenFocus();
}

/**
 * Display-only formatting for task text (the stored text is untouched, so export/import are unaffected):
 * numbered problems "(1) … (2) …" each start on their own line, and the "✔ Check:" answer key becomes
 * its own block with one answer per line. "(N)" only splits after whitespace, so f′(3) or h(1) stay intact.
 */
/**
 * Escape text and draw every well-formed matrix literal "[[a, b], [c, d]]" as a real grid
 * (rows × columns with book-style brackets). Anything that isn't a rectangular, flat matrix stays as text.
 */
function renderMatrices(text) {
  let out = '', i = 0;
  while (i < text.length) {
    const start = text.indexOf('[[', i);
    if (start < 0) break;
    // find the matching close bracket
    let depth = 0, end = -1;
    for (let k = start; k < text.length; k++) {
      if (text[k] === '[') depth++;
      else if (text[k] === ']' && --depth === 0) { end = k; break; }
    }
    const grid = end > 0 ? _parseMatrix(text.slice(start, end + 1)) : null;
    if (!grid) { out += escapeHtml(text.slice(i, start + 2)); i = start + 2; continue; }
    out += escapeHtml(text.slice(i, start));
    const cols = grid[0].length, raw = text.slice(start, end + 1);
    out += `<span class="mx" role="img" aria-label="matrix ${escapeHtml(raw)}" title="${escapeHtml(raw)}"><span class="mx-grid" style="grid-template-columns:repeat(${cols},auto)">`
      + grid.flat().map(c => `<span class="mx-cell">${escapeHtml(c)}</span>`).join('') + '</span></span>';
    i = end + 1;
  }
  return out + escapeHtml(text.slice(i));
}

function _parseMatrix(src) {
  const inner = src.slice(1, -1).trim();                // "[a, b], [c, d]"
  const rows = [];
  let k = 0;
  while (k < inner.length) {
    const open = inner.indexOf('[', k);
    if (open < 0) { if (inner.slice(k).replace(/[\s,]/g, '')) return null; break; }
    if (inner.slice(k, open).replace(/[\s,]/g, '')) return null;   // junk between rows
    const close = inner.indexOf(']', open);
    if (close < 0) return null;
    const body = inner.slice(open + 1, close);
    if (body.includes('[')) return null;                // deeper nesting → not a 2-D matrix
    const cells = body.split(',').map(c => c.trim());
    if (cells.some(c => !c || c.length > 16)) return null;
    rows.push(cells);
    k = close + 1;
  }
  if (!rows.length || rows.some(r => r.length !== rows[0].length)) return null;
  return rows;
}

/** Split a task's leading type prefix ("Watch:", "Worksheet —", "Code (NumPy, 10 min):"…) into a tag. Display only. */
function taskKind(text) {
  const t = text || '';
  let m = t.match(/^Worksheet\s+—\s*/);
  if (m) { const b = t.slice(m[0].length); return { kind: 'worksheet', label: 'Worksheet', body: b.charAt(0).toUpperCase() + b.slice(1) }; }
  m = t.match(/^(Watch|Read|Code|Reflect)((?:\s*\([^)]*\))?):\s*/);
  if (m) return { kind: m[1].toLowerCase(), label: m[1] + (m[2] ? ' · ' + m[2].trim().slice(1, -1) : ''), body: t.slice(m[0].length) };
  return { kind: '', label: '', body: t };
}

function formatTaskText(text, isWorksheet = /^Worksheet\b/.test(text || '')) {
  const raw = text || '';
  // Matrices render as grids in worksheets only (Code/Read tasks may contain literal array syntax).
  const html = isWorksheet ? renderMatrices(raw) : escapeHtml(raw);
  // Each "(N)" problem becomes its own block line (number in a fixed gutter); any intro text stays above.
  const lines = body => {
    const parts = body.split(/(?:^|\s)\((\d{1,2})\)\s/);      // [intro, n1, text1, n2, text2, …]
    if (parts.length === 1) return body;
    let out = parts[0].trim() ? `<span class="task-intro">${parts[0].trim()}</span>` : '';
    for (let i = 1; i < parts.length; i += 2) {
      out += `<span class="task-line"><b class="task-num">(${parts[i]})</b><span class="task-line-body">${parts[i + 1].trim()}</span></span>`;
    }
    return out;
  };
  const at = html.indexOf('✔ Check:');
  if (at < 0) return lines(html);
  const main = html.slice(0, at).trimEnd();
  const check = html.slice(at + '✔ Check:'.length).trim().replace(/;\s+(?=\(\d{1,2}\)\s)/g, ' ');
  return `${lines(main)}<details class="task-answers" onclick="event.stopPropagation()"><summary>Show answers</summary><span class="task-check">${lines(check)}</span></details>`;
}

// ===== LINK FAVICONS =====
// The site's favicon via DuckDuckGo's icon service (only the domain is sent, no referrer); cached by the
// browser. Falls back to the generic external-link icon when offline or when the site has none.
const LINK_FALLBACK_SVG = '<svg class="res-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
function linkIcon(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return LINK_FALLBACK_SVG; }
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) return LINK_FALLBACK_SVG;
  const src = `https://icons.duckduckgo.com/ip3/${host}.ico`;
  return `<img class="res-favicon" src="${src}" alt="" width="14" height="14" loading="lazy" decoding="async" referrerpolicy="no-referrer"
    onerror="this.outerHTML=LINK_FALLBACK_SVG">`;
}

// ===== RENDER: SINGLE TASK =====
function renderTask(task, dayId) {
  const checked = state.checked[task.id] ? 'checked' : '';
  const doneClass = state.checked[task.id] ? 'done' : '';
  const builtInRes = task.resources || [];
  const customRes = (state.customResources && state.customResources[task.id]) || [];
  const comments = (state.comments && state.comments[task.id]) || [];
  const commentCount = comments.length;
  const hasComments = commentCount > 0 ? 'has-comments' : '';
  const isComposing = activeComposeTaskId === task.id;

  let resourceHtml = '';
  if (builtInRes.length || customRes.length) {
    resourceHtml = '<div class="task-resources">';
    builtInRes.forEach(r => {
      resourceHtml += `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="resource-link">
        ${linkIcon(r.url)}
        ${escapeHtml(r.label)}</a>`;
    });
    customRes.forEach((r, idx) => {
      resourceHtml += `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="resource-link custom-resource" onclick="event.stopPropagation()">
        ${linkIcon(r.url)}
        ${escapeHtml(r.label)}
        <span class="resource-remove" onclick="event.preventDefault();event.stopPropagation();removeCustomResource('${task.id}', ${idx})" title="Remove">×</span></a>`;
    });
    resourceHtml += '</div>';
  }

  // Resource add button
  resourceHtml += `<div class="add-resource-wrapper" onclick="event.stopPropagation()">
    <button class="add-resource-btn" onclick="showAddResourceForm('${task.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Resource
    </button>
    <div class="add-resource-form" id="resource-form-${task.id}" style="display:none">
      <input type="text" placeholder="Label (e.g. My Notes)" class="resource-input" id="resource-label-${task.id}" onkeydown="handleResourceKeydown(event, '${task.id}')">
      <input type="text" placeholder="https://example.com" class="resource-input" id="resource-url-${task.id}" onkeydown="handleResourceKeydown(event, '${task.id}')">
      <div class="resource-form-actions">
        <button class="resource-form-btn save" onclick="addCustomResource('${task.id}')">Save</button>
        <button class="resource-form-btn cancel" onclick="hideAddResourceForm('${task.id}')">Cancel</button>
      </div>
    </div>
  </div>`;

  // Comment thread — lives inside the task card (below the toolbar), styled as a chat-like thread.
  // Comment text gets the same matrix grids as worksheets; typed line breaks are kept.
  const AVATAR = '<span class="comment-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>';
  let commentHtml = '';
  if (isComposing || commentCount > 0) {
    commentHtml = `<div class="inline-comments comment-thread" id="comments-${task.id}" onclick="event.stopPropagation()">
      <div class="comment-thread-head">Notes${commentCount ? ` · ${commentCount}` : ''}</div>`;
    comments.forEach((c, i) => {
      commentHtml += `<div class="comment-item">${AVATAR}
        <div class="comment-bubble">
          <div class="comment-text">${renderMatrices(String(c)).replace(/\n/g, '<br>')}</div>
          <button class="comment-delete" onclick="removeComment('${task.id}', ${i})" title="Delete note" aria-label="Delete note">Delete</button>
        </div>
      </div>`;
    });
    if (isComposing) {
      commentHtml += `<div class="comment-item comment-compose">${AVATAR}
        <div class="comment-bubble">
          <textarea class="comment-input" id="commentInput" placeholder="Add a note… (matrices like [[1, 2], [3, 4]] render as grids · Ctrl/⌘+Enter to post)" rows="2"
            onclick="event.stopPropagation()" onkeydown="handleCommentKeydown(event, '${task.id}')"></textarea>
          <div class="comment-compose-actions">
            <button class="comment-submit" onclick="event.stopPropagation(); submitComment('${task.id}')">Post note</button>
            ${commentCount > 0 ? `<button class="comment-resolve" onclick="event.stopPropagation(); resolveComments('${task.id}')">Resolve all</button>` : ''}
            <button class="resource-form-btn cancel" onclick="event.stopPropagation(); closeCompose()">Cancel</button>
          </div>
        </div>
      </div>`;
    }
    commentHtml += '</div>';
  }

  const ICON = {
    done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  };

  // Content uses the full row width; all actions (incl. marking done) live in a labelled toolbar underneath.
  const kind = taskKind(task.text);
  const tags = (kind.label ? `<span class="task-kind kind-${kind.kind}">${escapeHtml(kind.label)}</span>` : '')
    + (task.bonus ? '<span class="task-bonus-tag" title="Bonus — optional, does not block section completion">★ bonus</span>' : '');
  return `<div class="task-item ${doneClass} ${isComposing ? 'commenting' : ''} ${kind.kind ? 'kind-' + kind.kind : ''}" data-task="${task.id}" id="task-${task.id}">
    <div class="task-info">
      ${tags ? `<div class="task-tags">${tags}</div>` : ''}<span class="task-text">${formatTaskText(kind.body, kind.kind === 'worksheet')}</span>
      ${resourceHtml}
    </div>
    <div class="task-toolbar">
      <label class="task-btn task-done-btn" title="Mark done / undo" aria-label="Mark done / undo" onclick="event.stopPropagation()">
        <input type="checkbox" class="task-checkbox" ${checked} onchange="toggleTask('${task.id}', this)">
        ${ICON.done}<span class="when-todo">Mark done</span><span class="when-done">Done</span>
      </label>
      <button class="task-btn comment-trigger ${hasComments}" onclick="event.preventDefault(); event.stopPropagation(); toggleCommentCard('${task.id}')" title="Comment" aria-label="Comment">
        ${ICON.comment}<span class="lbl-comment">Comment</span><span class="comment-count">${commentCount || ''}</span>
      </button>
      <div class="task-menu">
        <button class="task-btn task-menu-btn" onclick="event.stopPropagation(); toggleTaskMenu('${task.id}')" title="More actions" aria-label="More actions" aria-haspopup="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
        </button>
        <div class="task-menu-pop" id="task-menu-${task.id}" role="menu" hidden>
          <button class="task-menu-item copy-btn" role="menuitem" onclick="event.stopPropagation(); closeTaskMenus(); copyTaskText('${task.id}', this.closest('.task-menu').querySelector('.task-menu-btn'))">${ICON.copy}<span>Copy text</span></button>
          <button class="task-menu-item" role="menuitem" onclick="event.stopPropagation(); closeTaskMenus(); editTaskText('${task.id}')">${ICON.edit}<span>Edit task</span></button>
          <button class="task-menu-item" role="menuitem" onclick="event.stopPropagation(); closeTaskMenus(); showAddResourceForm('${task.id}')">${ICON.link}<span>Add link</span></button>
          <div class="task-menu-sep"></div>
          <button class="task-menu-item danger" role="menuitem" onclick="event.stopPropagation(); closeTaskMenus(); removeTask('${task.id}')">${ICON.trash}<span>Delete task</span></button>
        </div>
      </div>
    </div>
    ${commentHtml}
  </div>`;
}

// ===== RENDER: JOURNAL =====
function renderJournal() {
  const section = document.getElementById('journalSection');
  if (!state.days.length) { section.innerHTML = ''; return; }

  let tabsHtml = state.days.map(d => {
    const isActive = d.id === state.journalDay;
    const hasContent = state.journal[d.id] && state.journal[d.id].trim();
    return `<button class="journal-tab ${isActive ? 'active' : ''} ${hasContent ? 'has-content' : ''}"
      data-jday="${d.id}" onclick="switchJournalDay('${d.id}')" title="${escapeHtml(d.title)}">${escapeHtml(d.label || d.title)}</button>`;
  }).join('');

  const currentText = state.journal[state.journalDay] || '';

  section.innerHTML = `
    <h2 class="section-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Notes for this section</h2>
    <div class="journal-tabs">${tabsHtml}</div>
    <div class="journal-area">
      <textarea id="journalText" placeholder="Key takeaways, aha moments, questions for later…">${escapeHtml(currentText)}</textarea>
      <button class="journal-save" id="journalSave">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Note
      </button>
    </div>`;

  // Journal tabs scroll horizontally like the section bar; keep the selected tab in view
  const tabs = section.querySelector('.journal-tabs');
  const activeTab = tabs.querySelector('.journal-tab.active');
  if (activeTab && tabs.scrollWidth > tabs.clientWidth) {
    tabs.scrollLeft = activeTab.offsetLeft - tabs.offsetLeft - (tabs.clientWidth - activeTab.offsetWidth) / 2;
  }
  _bindDayNavScroll(tabs);

  document.getElementById('journalSave').addEventListener('click', function () {
    saveJournalEntry();
    this.classList.add('saved'); this.textContent = '✓ Saved';
    setTimeout(() => {
      this.classList.remove('saved');
      this.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Note`;
    }, 1500);
  });
}

// ===== UPDATE STATS =====
function updateStats() {
  let totalTasks = 0, completedTasks = 0, totalBonus = 0, completedBonus = 0, daysComplete = 0;

  state.days.forEach(day => {
    day.blocks.forEach(block => {
      block.tasks.forEach(task => {
        const done = !!state.checked[task.id];
        if (task.bonus) { totalBonus++; if (done) completedBonus++; }
        else { totalTasks++; if (done) completedTasks++; }
      });
    });
    const p = sectionProgress(day, state.checked);
    const bar = document.getElementById('dayBar-' + day.id);
    if (bar) bar.style.width = (p.pct * 100) + '%';
    const pill = document.querySelector(`.day-pill[data-day="${day.id}"]`);
    if (pill) {
      pill.classList.toggle('completed', p.complete);
      // partly done → sidebar pie badge showing the share completed
      const partial = !p.complete && p.done > 0;
      pill.classList.toggle('partial', partial);
      pill.style.setProperty('--pct', `${(p.pct * 100).toFixed(1)}%`);
      pill.title = p.total ? `${p.done}/${p.total} tasks · ${Math.round(p.pct * 100)}%` : '';
    }
    // keep the open section's "x/y tasks" counter in sync without re-rendering the panel
    if (day.id === state.activeDay) {
      const counter = document.querySelector('.day-panel .day-progress-text');
      if (counter) counter.textContent = `${p.done}/${p.total} tasks${p.complete ? ' · ✓ section done' : ''}`;
    }
    if (p.complete) daysComplete++;
  });

  const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const el = id => document.getElementById(id);
  el('overallPercent').textContent = pct + '%';
  el('overallBar').style.width = pct + '%';
  el('completedTasks').textContent = `${completedTasks} / ${totalTasks}`;
  el('bonusDone').textContent = `${completedBonus} / ${totalBonus}`;
  el('daysComplete').textContent = `${daysComplete} / ${state.days.length}`;

  el('streakCount').textContent = calculateStreak() + ' 🔥';
  if (typeof renderOverview === 'function') renderOverview();
}

/** Progress of one section. Bonus tasks never block completion (unless a section has only bonus tasks). */
function sectionProgress(day, checked) {
  let req = 0, reqDone = 0, all = 0, allDone = 0;
  for (const b of (day.blocks || [])) for (const t of (b.tasks || [])) {
    const c = !!(checked && checked[t.id]);
    all++; if (c) allDone++;
    if (!t.bonus) { req++; if (c) reqDone++; }
  }
  const total = req || all, done = req ? reqDone : allDone;
  return { done, total, pct: total ? done / total : 0, complete: total > 0 && done === total };
}

function isDayComplete(dayId) {
  const day = findDay(dayId);
  return !!day && sectionProgress(day, state.checked).complete;
}

function calculateStreak() {
  let streak = 0;
  for (const day of state.days) {
    if (isDayComplete(day.id)) streak++;
    else break;
  }
  return streak;
}

// ===== DAY MANAGEMENT =====
function switchDay(dayId) {
  if (state.journalDay !== dayId && document.getElementById('journalText')) saveJournalEntry();
  state.activeDay = dayId;
  state.journalDay = dayId;   // the notes box always belongs to the open section
  saveUIState();  // localStorage only — no TOML write
  console.log('[ui-state] activeDay →', dayId);
  document.querySelectorAll('.day-pill').forEach(p => p.classList.toggle('active', p.dataset.day === dayId));
  renderActivePanel();
  renderJournal();
}

function showAddDayForm() {
  const area = document.getElementById('addDayFormArea');
  area.innerHTML = `<div class="add-day-form-panel">
    <h3>Add Section</h3>
    <input type="text" placeholder="Title (e.g. Attention Mechanisms)" class="add-item-input" id="addDayTitle" autofocus>
    <input type="text" placeholder="Subtitle (optional)" class="add-item-input" id="addDaySubtitle">
    <div class="add-item-actions">
      <button class="resource-form-btn save" onclick="submitAddDay()">Add Section</button>
      <button class="resource-form-btn cancel" onclick="cancelAddDay()">Cancel</button>
    </div>
  </div>`;
  document.getElementById('addDayTitle').focus();
  document.getElementById('addDayTitle').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitAddDay();
    if (e.key === 'Escape') cancelAddDay();
  });
}

function cancelAddDay() { document.getElementById('addDayFormArea').innerHTML = ''; }

function submitAddDay() {
  const title = document.getElementById('addDayTitle').value.trim();
  if (!title) { showToast('⚠️ Title is required'); return; }
  const subtitle = document.getElementById('addDaySubtitle').value.trim();
  const base = slugify(title) || 'section';
  let dayId = base, n = 2;
  while (findDay(dayId)) dayId = `${base}-${n++}`;
  const day = { id: dayId, title, subtitle, label: title, requires: [], blocks: [{ id: `${dayId}-blk`, title: '', tasks: [] }] };
  state.days.push(day);
  postEvent({ op: 'day_add', day });
  cancelAddDay();
  renderDayNav();
  renderJournal();
  switchDay(dayId);
  updateStats();
  showToast('📅 Section added — export to keep it');
}

// editDayField, editBlockTitle, editTaskInline — defined in INLINE EDITING section above

function removeDay(dayId) {
  if (!confirm('Delete this section and all its tasks? This cannot be undone.')) return;
  state.days = state.days.filter(d => d.id !== dayId);
  postEvent({ op: 'day_rm', id: dayId });
  if (state.activeDay === dayId) state.activeDay = state.days.length ? state.days[0].id : '';
  if (state.journalDay === dayId) state.journalDay = state.days.length ? state.days[0].id : '';
  renderDayNav();
  renderActivePanel();
  renderJournal();
  updateStats();
  showToast('🗑️ Section removed');
}

// ===== BLOCK MANAGEMENT =====
function showAddBlockForm(dayId) {
  document.getElementById('add-block-trigger-' + dayId).style.display = 'none';
  document.getElementById('add-block-form-' + dayId).style.display = 'flex';
  document.getElementById('add-block-title-' + dayId).focus();
}
function cancelAddBlock(dayId) {
  document.getElementById('add-block-trigger-' + dayId).style.display = '';
  document.getElementById('add-block-form-' + dayId).style.display = 'none';
}
function handleAddBlockKey(e, dayId) {
  if (e.key === 'Enter') { e.preventDefault(); submitAddBlock(dayId); }
  if (e.key === 'Escape') cancelAddBlock(dayId);
}
function submitAddBlock(dayId) {
  const title = document.getElementById('add-block-title-' + dayId).value.trim();
  if (!title) { showToast('⚠️ Block title required'); return; }
  const badge = document.getElementById('add-block-badge-' + dayId).value;
  const icons = { morning: '☀️', afternoon: '🔧', evening: '🌙', bonus: '⭐' };
  const blockId = uid('blk');
  const block = { id: blockId, title, badge, icon: icons[badge] || '📌', isBonus: badge === 'bonus', tasks: [] };
  const day = findDay(dayId);
  if (day) { day.blocks.push(block); postEvent({ op: 'block_add', dayId, block }); }
  renderActivePanel();
  updateStats();
  showToast('📦 Block added');
}
function removeBlock(blockId) {
  if (!confirm('Remove this block and all its tasks?')) return;
  state.days.forEach(day => { day.blocks = day.blocks.filter(b => b.id !== blockId); });
  postEvent({ op: 'block_rm', id: blockId });
  renderActivePanel();
  updateStats();
  showToast('🗑️ Block removed');
}

// ===== TASK MANAGEMENT =====
function toggleBlock(header) {
  const card = header.closest('.block-card');
  card.classList.toggle('expanded');
  if (card.classList.contains('expanded')) setFocusedBlock(card);
}

function toggleTask(taskId, checkbox) {
  state.checked[taskId] = checkbox.checked;
  // Post event, then refresh heatmap after server has written activity.toml
  postEvent({ op: 'task', id: taskId, v: checkbox.checked })
    .then(() => fetchActivity())
    .then(renderHeatmap);
  if (!state.startDate && checkbox.checked) {
    state.startDate = new Date().toISOString();
    postEvent({ op: 'set', k: 'startDate', v: state.startDate });
  }
  const item = checkbox.closest('.task-item');
  item.classList.toggle('done', checkbox.checked);
  updateStats();
  if (checkbox.checked) {
    fireBurst(checkbox);
    // Drop task text into trophy pile
    const taskText = item.querySelector('.task-text');
    if (taskText) dropTrophy(taskText.textContent.trim());
    const dayId = findDayForTask(taskId);
    if (dayId && isDayComplete(dayId)) { fireDayComplete(); showToast('🎉 Section complete!'); }
    advanceZenFocus(taskId);
  } else {
    // Remove from trophy pile when unchecked
    const taskText = item.querySelector('.task-text');
    if (taskText) removeTrophy(taskText.textContent.trim());
  }
}

function findDayForTask(taskId) {
  for (const day of state.days)
    for (const block of day.blocks)
      for (const task of block.tasks)
        if (task.id === taskId) return day.id;
  return null;
}

function showAddTaskForm(blockId) {
  document.getElementById('add-task-trigger-' + blockId).style.display = 'none';
  document.getElementById('add-task-form-' + blockId).style.display = 'flex';
  document.getElementById('add-task-input-' + blockId).focus();
}
function cancelAddTask(blockId) {
  document.getElementById('add-task-trigger-' + blockId).style.display = '';
  document.getElementById('add-task-form-' + blockId).style.display = 'none';
  document.getElementById('add-task-input-' + blockId).value = '';
}
function handleAddTaskKey(e, blockId) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitAddTask(blockId); }
  if (e.key === 'Escape') cancelAddTask(blockId);
}
function submitAddTask(blockId) {
  const input = document.getElementById('add-task-input-' + blockId);
  const text = input.value.trim();
  if (!text) { showToast('⚠️ Task description required'); return; }
  const taskId = uid('task');
  const task = { id: taskId, text, resources: [] };
  // Find block and add task
  for (const day of state.days) {
    for (const block of day.blocks) {
      if (block.id === blockId) { block.tasks.push(task); break; }
    }
  }
  postEvent({ op: 'task_add', blockId, task });
  input.value = '';
  renderActivePanel();
  updateStats();
  showToast('✅ Task added');
}

// editTaskInline — defined in INLINE EDITING section above

function removeTask(taskId) {
  if (!confirm('Remove this task?')) return;
  state.days.forEach(day => {
    day.blocks.forEach(block => { block.tasks = block.tasks.filter(t => t.id !== taskId); });
  });
  delete state.checked[taskId];
  if (state.customResources) delete state.customResources[taskId];
  if (state.comments) delete state.comments[taskId];
  postEvent({ op: 'task_rm', id: taskId });
  renderActivePanel();
  updateStats();
  showToast('🗑️ Task removed');
}

function copyTaskText(taskId, btn) {
  let text = '';
  state.days.forEach(day => {
    day.blocks.forEach(block => {
      block.tasks.forEach(t => { if (t.id === taskId) text = t.text; });
    });
  });
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied');
    btn.title = 'Copied!';
    showToast('📋 Copied to clipboard');
    setTimeout(() => { btn.classList.remove('copied'); btn.title = 'Copy text'; }, 1500);
  }).catch(() => {
    // Fallback for non-HTTPS
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    btn.classList.add('copied');
    showToast('📋 Copied to clipboard');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  });
}

// ===== CUSTOM RESOURCES =====
function showAddResourceForm(taskId) {
  document.querySelectorAll('.add-resource-form').forEach(f => f.style.display = 'none');
  const form = document.getElementById('resource-form-' + taskId);
  if (form) { form.style.display = 'flex'; setTimeout(() => document.getElementById('resource-label-' + taskId)?.focus(), 50); }
}
function hideAddResourceForm(taskId) {
  const form = document.getElementById('resource-form-' + taskId);
  if (form) { form.style.display = 'none'; }
}
function addCustomResource(taskId) {
  const label = document.getElementById('resource-label-' + taskId).value.trim();
  const url = document.getElementById('resource-url-' + taskId).value.trim();
  if (!label || !url) { showToast('⚠️ Both label and URL required'); return; }
  postEvent({ op: 'res_add', id: taskId, label, url });
  renderActivePanel(); showToast('🔗 Resource added');
}
function removeCustomResource(taskId, idx) {
  if (!state.customResources || !state.customResources[taskId]) return;
  postEvent({ op: 'res_rm', id: taskId, idx });
  renderActivePanel(); showToast('🗑️ Resource removed');
}
function handleResourceKeydown(e, taskId) {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); addCustomResource(taskId); }
  if (e.key === 'Escape') hideAddResourceForm(taskId);
}

// ===== COMMENTS (inline) =====
function toggleCommentCard(taskId) {
  if (activeComposeTaskId === taskId) closeCompose();
  else openCompose(taskId);
}
function openCompose(taskId) {
  activeComposeTaskId = taskId;
  renderActivePanel();
  setTimeout(() => { const inp = document.getElementById('commentInput'); if (inp) inp.focus(); }, 50);
}
function closeCompose() {
  activeComposeTaskId = null;
  renderActivePanel();
}
function formatCommentTime(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr), diff = Date.now() - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return ''; }
}
function handleCommentKeydown(e, taskId) {
  e.stopPropagation();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitComment(taskId); }
  if (e.key === 'Escape') closeCompose();
}
function submitComment(taskId) {
  const input = document.getElementById('commentInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  postEvent({ op: 'comment_add', id: taskId, v: text });   // postEvent is the only place that mutates state
  renderActivePanel(); showToast('💬 Comment added');
  // Re-open compose on same task
  setTimeout(() => { activeComposeTaskId = taskId; renderActivePanel();
    setTimeout(() => { const inp = document.getElementById('commentInput'); if (inp) inp.focus(); }, 50);
  }, 0);
}
function removeComment(taskId, idx) {
  if (!state.comments || !state.comments[taskId]) return;
  postEvent({ op: 'comment_rm', id: taskId, idx });
  renderActivePanel();
}
function resolveComments(taskId) {
  if (!state.comments || !state.comments[taskId]) return;
  const count = state.comments[taskId].length;
  for (let i = count - 1; i >= 0; i--) postEvent({ op: 'comment_rm', id: taskId, idx: i });
  closeCompose();
  showToast('✅ Resolved');
}

// ===== JOURNAL =====
function switchJournalDay(dayId) {
  saveJournalEntry();
  state.journalDay = dayId;
  saveUIState();  // localStorage only — no TOML write
  console.log('[ui-state] journalDay →', dayId);
  renderJournal();
}
function saveJournalEntry() {
  const textarea = document.getElementById('journalText');
  if (!textarea) return;
  const text = textarea.value.trim();
  const dayId = state.journalDay;
  if (text) state.journal[dayId] = text;
  else delete state.journal[dayId];
  postEvent({ op: 'journal', dayId, v: text });
}

// ===== CELEBRATIONS (Khan Academy-style particle bursts) =====
const BURST_COLORS = [
  '#F5C518', '#FFD700', '#FFA500', '#FF6B6B', '#4ECDC4',
  '#45B7D1', '#96E6A1', '#DDA0DD', '#FF85A2', '#FFDAB9',
];

const SHAPES = ['circle', 'star', 'diamond', 'sparkle'];

function createBurstCanvas() {
  let canvas = document.getElementById('burstCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'burstCanvas';
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:99999;';
    document.body.appendChild(canvas);
  }
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  return canvas;
}

let _particles = [];
let _animFrame = null;

function spawnParticles(x, y, count, opts = {}) {
  const spread = opts.spread || 1;
  const sizeMin = opts.sizeMin || 3;
  const sizeMax = opts.sizeMax || 8;
  const speedMin = opts.speedMin || 2;
  const speedMax = opts.speedMax || 8;
  const gravity = opts.gravity !== undefined ? opts.gravity : 0.12;
  const colors = opts.colors || BURST_COLORS;

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * spread;
    const speed = speedMin + Math.random() * (speedMax - speedMin);
    _particles.push({
      x, y,
      vx: Math.cos(angle) * speed * (0.5 + Math.random()),
      vy: Math.sin(angle) * speed * (0.5 + Math.random()) - 2,
      size: sizeMin + Math.random() * (sizeMax - sizeMin),
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.3,
      gravity,
      drag: 0.97 + Math.random() * 0.02,
      life: 1,
      decay: 0.008 + Math.random() * 0.010,
      shimmer: Math.random() > 0.5,
    });
  }

  if (!_animFrame) tickBurst();
}

function drawStar(ctx, cx, cy, r, points, rotation) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = (i % 2 === 0) ? r : r * 0.4;
    const a = rotation + (Math.PI * i / points);
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawSparkle(ctx, cx, cy, r, rotation) {
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = rotation + (Math.PI * i / 2);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
}

function drawDiamond(ctx, cx, cy, r, rotation) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.6, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r * 0.6, 0);
  ctx.closePath();
  ctx.restore();
}

function tickBurst() {
  const canvas = createBurstCanvas();
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  _particles = _particles.filter(p => p.life > 0);

  if (_particles.length === 0) {
    _animFrame = null;
    canvas.remove();
    return;
  }

  for (const p of _particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.rotation += p.rotSpeed;
    p.life -= p.decay;

    const alpha = Math.max(0, p.life);
    const shimmerAlpha = p.shimmer ? alpha * (0.6 + 0.4 * Math.sin(Date.now() * 0.02 + p.rotation * 10)) : alpha;
    ctx.globalAlpha = shimmerAlpha;

    if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    } else if (p.shape === 'star') {
      drawStar(ctx, p.x, p.y, p.size, 5, p.rotation);
      ctx.fillStyle = p.color;
      ctx.fill();
    } else if (p.shape === 'sparkle') {
      drawSparkle(ctx, p.x, p.y, p.size * 1.5, p.rotation);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (p.shape === 'diamond') {
      drawDiamond(ctx, p.x, p.y, p.size, p.rotation);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  _animFrame = requestAnimationFrame(tickBurst);
}

// Small burst from a checkbox (every task tick)
function fireBurst(checkbox) {
  const rect = checkbox.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Main burst — high speed so particles fly across the whole page
  spawnParticles(x, y, 28, {
    spread: 2.0,
    sizeMin: 3, sizeMax: 9,
    speedMin: 8, speedMax: 18,
    gravity: 0.06,
  });

  // Secondary scattered bursts at random positions across the page
  for (let i = 0; i < 3; i++) {
    const rx = Math.random() * w;
    const ry = Math.random() * h * 0.6;
    setTimeout(() => {
      spawnParticles(rx, ry, 10, {
        spread: 1.8,
        sizeMin: 2, sizeMax: 7,
        speedMin: 3, speedMax: 9,
        gravity: 0.07,
        colors: ['#FFD700', '#F5C518', '#fff', '#FFA500', '#4ECDC4', '#FF6B6B'],
      });
    }, 50 + i * 80);
  }

  // Glitter trail floating upward from checkbox
  spawnParticles(x, y, 8, {
    spread: 0.6,
    sizeMin: 1.5, sizeMax: 5,
    speedMin: 2, speedMax: 6,
    gravity: -0.05,
    colors: ['#FFD700', '#F5C518', '#fff', '#FFA500'],
  });
}

// Big celebration (full day complete)
function fireDayComplete() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Multiple bursts across the screen
  const burstPoints = [
    [w * 0.2, h * 0.3], [w * 0.5, h * 0.2], [w * 0.8, h * 0.3],
    [w * 0.3, h * 0.5], [w * 0.7, h * 0.5],
  ];

  burstPoints.forEach(([bx, by], i) => {
    setTimeout(() => {
      spawnParticles(bx, by, 30, {
        spread: 1.5,
        sizeMin: 3, sizeMax: 10,
        speedMin: 4, speedMax: 12,
        gravity: 0.15,
      });
    }, i * 120);
  });

  // Shower from top
  setTimeout(() => {
    for (let i = 0; i < 40; i++) {
      setTimeout(() => {
        spawnParticles(Math.random() * w, -10, 3, {
          spread: 0.5,
          sizeMin: 3, sizeMax: 7,
          speedMin: 0.5, speedMax: 2,
          gravity: 0.2,
          colors: ['#F5C518', '#FFD700', '#e6b800', '#FFA500'],
        });
      }, i * 30);
    }
  }, 400);
}

// ===== TOAST =====
function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

// ===== RESET =====
function resetAll() {
  if (!confirm('🗑️ Reset ALL progress for this syllabus? Checkboxes, time, journal, and comments will be cleared. Structure (sections/tasks) is kept.')) return;
  state.checked = {};
  state.doneAt = {};
  state.journal = {};
  state.timeLog = {};
  state.comments = {};
  state.customResources = {};
  saveLocalState();
  activeComposeTaskId = null;
  renderApp();
  renderHeatmap(getActivityLog());
  showToast('♻️ All progress reset');
}

function resetToRepoBaseline() {
  if (!confirm(`Reset "${_activeSyllabusKey}" to the original committed git baseline? This will discard any unexported local edits on this machine.`)) return;
  localStorage.removeItem(`study-lock-in:state:${_activeSyllabusKey}`);
  loadStateForSyllabus(_activeSyllabusKey);
  renderApp();
  renderHeatmap(getActivityLog());
  showToast('🔄 Restored from Git baseline');
}

// ===== DATA PANEL (Export / Import) =====
function toggleDataPanel() {
  const panel = document.getElementById('dataPanel');
  const btn = document.getElementById('dataToggle');
  if (panel.style.display === 'none') {
    panel.style.display = 'block';
    btn.classList.add('active');
  } else {
    panel.style.display = 'none';
    btn.classList.remove('active');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

function _yq(v) { return JSON.stringify(v == null ? '' : String(v)); }

/** Multiline text as a `|-` block scalar when that round-trips exactly, else a quoted string. */
function _yamlText(key, text, indent) {
  const pad = ' '.repeat(indent);
  const t = String(text);
  const blockSafe = t.includes('\n') && !t.includes('\r') && !/^[ \t]/.test(t) && !/\n$/.test(t);
  if (!blockSafe) return [`${pad}${key}: ${_yq(t)}`];
  return [`${pad}${key}: |-`, ...t.split('\n').map(l => (l ? `${pad}  ${l}` : ''))];
}

/** Serialise state to the `_data/syllabi/*.yml` schema (see CLAUDE.md). Output is deterministic. */
function stateToYaml(s) {
  const lines = [];
  lines.push('# Study Lock-In syllabus — curriculum + progress. Exported by the app; edit freely.');
  lines.push('');
  lines.push('meta:');
  const meta = s.meta || {};
  lines.push(`  title: ${_yq(meta.title || 'Study Tracker')}`);
  lines.push(`  subtitle: ${_yq(meta.subtitle || '')}`);
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'title' || k === 'subtitle' || v == null || v === '') continue;
    if (typeof v === 'string') lines.push(`  ${k}: ${_yq(v)}`);
    else if (typeof v === 'number' || typeof v === 'boolean') lines.push(`  ${k}: ${v}`);
  }
  lines.push('');
  lines.push('state:');
  lines.push(`  theme: ${_yq(s.theme || 'dark')}`);
  lines.push(`  active_section: ${_yq(s.activeDay || '')}`);
  lines.push(`  journal_section: ${_yq(s.journalDay || '')}`);
  if (s.startDate) lines.push(`  start_date: ${_yq(s.startDate)}`);
  lines.push('');
  lines.push('sections:');

  for (const sec of (s.days || [])) {
    lines.push(`  - id: ${_yq(sec.id)}`);
    lines.push(`    title: ${_yq(sec.title || '')}`);
    if (sec.subtitle) lines.push(`    subtitle: ${_yq(sec.subtitle)}`);
    const reqs = sec.requires || [];
    if (reqs.length) {
      lines.push('    requires:');
      for (const r of reqs) lines.push(`      - ${_yq(r)}`);
    }
    const j = s.journal?.[sec.id] || '';
    if (j) lines.push(..._yamlText('journal', j, 4));
    const tl = s.timeLog?.[sec.id] || 0;
    if (tl) lines.push(`    time_logged: ${tl}`);

    const tasks = (sec.blocks || []).flatMap(b => b.tasks || []);
    if (!tasks.length) { lines.push('    tasks: []'); continue; }
    lines.push('    tasks:');
    for (const task of tasks) {
      lines.push(`      - text: ${_yq(task.text || '')}`);
      const isDone = !!s.checked?.[task.id];
      lines.push(`        done: ${isDone}`);
      if (task.bonus) lines.push('        bonus: true');
      const doneAt = s.doneAt?.[task.id];
      if (isDone && doneAt) lines.push(`        done_at: ${_yq(doneAt)}`);
      const cmts = s.comments?.[task.id] || [];
      if (cmts.length) {
        lines.push('        comments:');
        for (const c of cmts) lines.push(`          - ${_yq(c)}`);
      }
      for (const [key, list] of [['resources', task.resources || []], ['custom_resources', s.customResources?.[task.id] || []]]) {
        if (!list.length) continue;
        lines.push(`        ${key}:`);
        for (const r of list) {
          lines.push(`          - label: ${_yq(r.label || '')}`);
          lines.push(`            url: ${_yq(r.url || '')}`);
        }
      }
    }
  }

  return lines.join('\n') + '\n';
}

function exportSyllabus() {
  if (!state) return;
  const yamlContent = stateToYaml(state);
  const blob = new Blob([yamlContent], { type: 'text/yaml;charset=utf-8' });
  const filename = `${_activeSyllabusKey}.yml`;
  downloadBlob(blob, filename);
  showToast(`📄 Exported ${filename} — drop into _data/syllabi/ to commit!`);
}

function exportState() {
  if (!state) return;
  const jsonContent = JSON.stringify(state, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
  downloadBlob(blob, `study-lock-in-${_activeSyllabusKey}-state.json`);
  showToast('📦 State backup exported');
}

function importSyllabusFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.yml,.yaml';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm(`Import "${file.name}"? This will replace your current active syllabus data on this device.`)) return;

    try {
      const text = await file.text();
      if (file.name.endsWith('.json')) {
        const imported = JSON.parse(text);
        if (Array.isArray(imported.days)) {
          const legacyMap = getLegacyIdMap(_activeSyllabusKey);
          const isLegacyBackup = !!legacyMap && imported.days.some(d => legacyMap[d.id]);
          for (const f of ['checked', 'doneAt', 'journal', 'timeLog', 'comments', 'customResources']) {
            if (!imported[f] || typeof imported[f] !== 'object') imported[f] = {};
          }
          if (isLegacyBackup) {
            // Backup from before the sections migration: keep today's structure, carry the progress over.
            migrateLegacyIds(imported, _activeSyllabusKey);
            for (const f of ['checked', 'doneAt', 'journal', 'timeLog', 'comments', 'customResources']) state[f] = imported[f];
            if (findDay(imported.activeDay)) state.activeDay = imported.activeDay;
            if (findDay(imported.journalDay)) state.journalDay = imported.journalDay;
            if (imported.startDate) state.startDate = imported.startDate;
          } else {
            imported.days.forEach(d => { d.blocks = d.blocks || []; d.requires = d.requires || []; d.label = d.label || d.title; });
            imported.meta = imported.meta || state.meta;
            state = imported;
          }
          saveLocalState();
          renderApp();
          renderHeatmap(getActivityLog());
          showToast(`📦 Imported ${state.days.length} sections${isLegacyBackup ? ' (migrated from old backup)' : ''}`);
        } else {
          alert('That JSON is not a Study Lock-In state backup (no "days" array).');
        }
      } else {
        alert('To import YAML, you can replace the file in _data/syllabi/ and push to GitHub, or export as JSON.');
      }
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  };
  input.click();
}

// ===== SYLLABUS MODEL (progress + prerequisites across every syllabus in _data/syllabi) =====
// Read-only over the same data as everything else: embedded syllabi JSON + localStorage progress.
// Powers the "Requires" chips on a section and the Overview page.
const MAP_COLORS = ['#5B7046', '#B07A2E', '#4F6D8F', '#7A5C8E', '#A0573F', '#3F7A73', '#8E5A74', '#5C6470'];

function _jsq(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function _shortTitle(t) { return String(t || '').split(/[\s/:—-]+/).filter(Boolean)[0] || ''; }

function syllabusColor(key, meta) {
  if (meta && /^#[0-9a-f]{3,8}$/i.test(String(meta.color || ''))) return meta.color;
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return MAP_COLORS[h % MAP_COLORS.length];
}

/** "other-syllabus/section-id" or "section-id" (same syllabus) → global node id "key/section-id". */
function resolveSectionRef(ref, fromKey) {
  const r = String(ref || '').trim();
  const i = r.indexOf('/');
  return i > 0 ? `${r.slice(0, i).trim()}/${slugify(r.slice(i + 1))}` : `${fromKey}/${slugify(r)}`;
}

function buildSyllabiMap() {
  const all = getEmbeddedSyllabi();
  const syllabi = Object.keys(all).map(key => {
    const st = (key === _activeSyllabusKey && state) ? state : getSyllabusState(key);
    const meta = st.meta || {};
    const status = String(meta.status || 'active').toLowerCase();
    const nodes = (st.days || []).map((d, i) => ({
      id: `${key}/${d.id}`, key, sid: d.id, index: i,
      title: d.label || d.title, fullTitle: d.title,
      requires: d.requires || [],
      ...sectionProgress(d, st.checked || {}),
    }));
    const done = nodes.filter(n => n.complete).length;
    const taskDone = nodes.reduce((a, n) => a + n.done, 0), taskTotal = nodes.reduce((a, n) => a + n.total, 0);
    return {
      key, status, nodes, done,
      title: meta.title || key,
      short: meta.short || _shortTitle(meta.title || key),
      taskPct: taskTotal ? taskDone / taskTotal : 0,
      color: syllabusColor(key, meta),
      activeSid: st.activeDay,
      pct: nodes.length ? done / nodes.length : 0,
    };
  });

  const byId = {}, sylByKey = {};
  syllabi.forEach(s => { sylByKey[s.key] = s; s.nodes.forEach(n => { byId[n.id] = n; }); });

  // A prerequisite is satisfied when it is complete, its syllabus is marked done, or it no longer exists.
  const satisfied = id => {
    const n = byId[id];
    if (!n) return true;
    return sylByKey[n.key].status === 'done' || n.complete;
  };

  syllabi.forEach(s => s.nodes.forEach((n, i) => {
    n.prereqs = [];
    if (i > 0) n.prereqs.push({ id: s.nodes[i - 1].id, implicit: true });
    n.requires.forEach(ref => {
      const id = resolveSectionRef(ref, s.key);
      if (id !== n.id) n.prereqs.push({ id, implicit: false, ref });
    });
  }));
  syllabi.forEach(s => s.nodes.forEach(n => {
    n.blockedBy = n.prereqs.filter(p => !satisfied(p.id));
    n.inProgress = !n.complete && n.done > 0;
    n.ready = s.status === 'active' && !n.complete && n.blockedBy.length === 0;
  }));

  return { syllabi, byId, sylByKey, satisfied };
}

/** Jump to a section (switching syllabus if needed) — used by "Requires" chips and Overview links. */
function mapGo(key, sid) {
  if (key !== _activeSyllabusKey) switchSyllabus(key);
  if (findDay(sid)) {
    switchDay(sid);
    renderDayNav();
    updateStats();
  }
  setView('study');
  const target = document.getElementById('dayNav');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== SYLLABUS SWITCHER =====
function loadSyllabusList() {
  _allSyllabi = getEmbeddedSyllabi();
  const keys = Object.keys(_allSyllabi);
  const sel = document.getElementById('syllabusSelect');
  if (!sel) return;

  sel.onchange = null;
  sel.innerHTML = '';

  keys.forEach(k => {
    const opt = document.createElement('option');
    opt.value = k;
    const title = _allSyllabi[k]?.meta?.title || k.replace(/-/g, ' ');
    opt.textContent = title;
    if (k === _activeSyllabusKey) opt.selected = true;
    sel.appendChild(opt);
  });

  sel.onchange = (e) => {
    const chosen = e.target.value;
    if (chosen && chosen !== _activeSyllabusKey) {
      switchSyllabus(chosen);
    }
  };
}

function switchSyllabus(key) {
  if (!key) return;
  loadStateForSyllabus(key);
  activeComposeTaskId = null;
  renderApp();
  renderHeatmap(getActivityLog());
  showToast(`📚 Switched syllabus to ${key.replace(/-/g, ' ')}`);
}

// ===== TROPHY PILE (completed tasks gravity wall) =====
const TROPHY_KEY = 'study-tracker-trophies';

function getTrophies() {
  try { return JSON.parse(localStorage.getItem(TROPHY_KEY) || '[]'); }
  catch { return []; }
}

function saveTrophies(trophies) {
  localStorage.setItem(TROPHY_KEY, JSON.stringify(trophies));
}

function ensureTrophyContainer() {
  let container = document.getElementById('trophyPile');
  if (!container) {
    container = document.createElement('div');
    container.id = 'trophyPile';
    container.className = 'trophy-pile';
    container.innerHTML = `
      <div class="trophy-header">
        <span class="trophy-counter"><span id="trophyCount">0</span> done</span>
        <button class="trophy-clear" onclick="clearTrophies()" title="Clear trophy pile">✕</button>
      </div>
      <div class="trophy-chips" id="trophyChips"></div>
    `;
    document.body.appendChild(container);
  }
  return container;
}

function renderTrophyChips(animate) {
  const container = ensureTrophyContainer();
  const chipsEl = document.getElementById('trophyChips');
  const trophies = getTrophies();
  document.getElementById('trophyCount').textContent = trophies.length;

  if (trophies.length === 0) {
    container.classList.remove('visible');
    return;
  }
  container.classList.add('visible');

  // Only render what's there — don't re-render everything for perf
  chipsEl.innerHTML = '';
  trophies.forEach((t, i) => {
    const chip = document.createElement('div');
    chip.className = 'trophy-chip';
    if (animate && i === trophies.length - 1) chip.classList.add('trophy-drop');
    // Random slight rotation for gravity-pile feel
    const rot = (Math.random() - 0.5) * 8;
    chip.style.transform = `rotate(${rot}deg)`;
    // Truncate long texts
    chip.textContent = t.text.length > 50 ? t.text.slice(0, 47) + '…' : t.text;
    chip.title = t.text;
    chipsEl.appendChild(chip);
  });
}

function dropTrophy(text) {
  const trophies = getTrophies();
  // Avoid duplicates
  if (trophies.some(t => t.text === text)) return;
  trophies.push({ text, ts: Date.now() });
  saveTrophies(trophies);
  renderTrophyChips(true);
}

function removeTrophy(text) {
  let trophies = getTrophies();
  trophies = trophies.filter(t => t.text !== text);
  saveTrophies(trophies);
  renderTrophyChips(false);
}

function clearTrophies() {
  if (!confirm('Clear all completed task trophies?')) return;
  localStorage.removeItem(TROPHY_KEY);
  renderTrophyChips(false);
  showToast('🧹 Trophy pile cleared');
}

function loadTrophyPile() {
  ensureTrophyContainer();
  renderTrophyChips(false);
}

// ===== ACTIVITY DATA & HEATMAP =====

function getEmbeddedActivity() {
  const el = document.getElementById('activity-data');
  if (!el || !el.textContent.trim()) return [];
  try {
    const parsed = JSON.parse(el.textContent);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.log)) return parsed.log;
      return Object.values(parsed);
    }
    return [];
  } catch (err) {
    console.warn('Could not parse activity data JSON:', err);
    return [];
  }
}

function getLocalActivity() {
  try {
    const raw = localStorage.getItem('study-lock-in:activity');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

const _activityKey = (e) => `${e.t}|${e.syllabus}|${e.topic}|${e.action}`;

/** Base (committed) activity + device-only activity, de-duplicated and in time order.
 *  De-duplication matters once you export activity.yml and push: the same entries
 *  then exist both in the embedded data and in this device's localStorage. */
function getActivityLog() {
  const base = getEmbeddedActivity();
  const seen = new Set(base.map(_activityKey));
  const local = getLocalActivity().filter(e => !seen.has(_activityKey(e)));
  return [...base, ...local].sort((a, b) => new Date(a.t) - new Date(b.t));
}

/** Drop local entries that are already part of the committed _data/activity.yml. */
function pruneLocalActivity() {
  const local = getLocalActivity();
  if (!local.length) return;
  const seen = new Set(getEmbeddedActivity().map(_activityKey));
  const remaining = local.filter(e => !seen.has(_activityKey(e)));
  if (remaining.length !== local.length) {
    localStorage.setItem('study-lock-in:activity', JSON.stringify(remaining));
    console.log(`[activity] pruned ${local.length - remaining.length} entries already in activity.yml`);
  }
}

function activityToYaml(log) {
  const lines = [
    '# Study Lock-In — activity log (powers the contribution heatmap)',
    '# Exported: ' + new Date().toISOString(),
  ];
  for (const e of log) {
    if (!e || !e.t) continue;
    lines.push(`- t: ${JSON.stringify(e.t)}`);
    lines.push(`  syllabus: ${JSON.stringify(e.syllabus || '')}`);
    lines.push(`  topic: ${JSON.stringify(e.topic || '')}`);
    lines.push(`  action: ${JSON.stringify(e.action || 'done')}`);
  }
  return lines.join('\n') + '\n';
}

/** Download the full merged log as activity.yml — drop it into _data/ and commit. */
function exportActivity() {
  const log = getActivityLog();
  const newCount = log.length - getEmbeddedActivity().length;
  const blob = new Blob([activityToYaml(log)], { type: 'text/yaml;charset=utf-8' });
  downloadBlob(blob, 'activity.yml');
  showToast(`🔥 Exported activity.yml (${log.length} entries, ${newCount} new) — replace _data/activity.yml & commit`);
}

// ── Ad-hoc activity (things studied outside any syllabus) ──────────────
const ADHOC_DEFAULT_CATEGORY = 'Daily Study Log';

function addLocalActivity(entry) {
  const log = getLocalActivity();
  log.push(entry);
  localStorage.setItem('study-lock-in:activity', JSON.stringify(log));
  renderHeatmap(getActivityLog());
}

function removeLocalActivity(key) {
  const log = getLocalActivity().filter(e => _activityKey(e) !== key);
  localStorage.setItem('study-lock-in:activity', JSON.stringify(log));
  renderHeatmap(getActivityLog());
}

/** Categories offered in the form: what's already in the log, plus every syllabus title. */
function _activityCategories() {
  const cats = new Set([ADHOC_DEFAULT_CATEGORY]);
  getActivityLog().forEach(e => e.syllabus && cats.add(e.syllabus));
  Object.values(getEmbeddedSyllabi()).forEach(s => s?.meta?.title && cats.add(s.meta.title));
  return [...cats];
}

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toggleLogActivity(forceOpen) {
  const box = document.getElementById('logActivity');
  if (!box) return;
  const open = forceOpen === true || box.hidden;
  box.hidden = !open;
  document.getElementById('logActivityBtn')?.classList.toggle('active', open);
  if (open) { renderLogActivity(); setTimeout(() => document.getElementById('logTopic')?.focus(), 30); }
}

function renderLogActivity() {
  const box = document.getElementById('logActivity');
  if (!box || box.hidden) return;
  const lastCat = localStorage.getItem('study-lock-in:last-activity-category') || ADHOC_DEFAULT_CATEGORY;
  const committed = new Set(getEmbeddedActivity().map(_activityKey));
  // Unexported manual entries (local, not task ticks), newest first
  const recent = getLocalActivity().filter(e => e.manual && e.action === 'done' && !committed.has(_activityKey(e)))
    .sort((a, b) => new Date(b.t) - new Date(a.t)).slice(0, 8);
  box.innerHTML = `
    <form class="log-activity-form" onsubmit="event.preventDefault(); submitLogActivity()">
      <input id="logTopic" class="add-item-input" type="text" placeholder="What did you study? e.g. Talk: How Discord stores trillions of messages" maxlength="200" required>
      <input id="logCategory" class="add-item-input" type="text" list="logCategoryList" value="${escapeHtml(lastCat)}" placeholder="Category" title="Category (shown in the heatmap tooltip)">
      <datalist id="logCategoryList">${_activityCategories().map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
      <input id="logDate" class="add-item-input" type="date" value="${_todayStr()}" max="${_todayStr()}" title="Date studied">
      <div class="add-item-actions">
        <button type="submit" class="resource-form-btn save">Add</button>
        <button type="button" class="resource-form-btn cancel" onclick="toggleLogActivity()">Close</button>
      </div>
    </form>
    ${recent.length ? `<div class="log-activity-recent"><span class="log-activity-recent-label">Logged on this device — not exported yet</span>
      ${recent.map(e => `<div class="log-activity-item"><span class="log-activity-date">${escapeHtml(formatHeatmapDate(_localDateOf(e.t)))}</span>
        <span class="log-activity-topic">${escapeHtml(e.topic)}</span><span class="log-activity-cat">${escapeHtml(e.syllabus)}</span>
        <button class="log-activity-rm" onclick="removeLogActivity('${_jsq(_activityKey(e))}')" title="Remove">×</button></div>`).join('')}
      <span class="log-activity-hint">Export Activity (Data panel) → replace <code>_data/activity.yml</code> → commit to sync.</span></div>` : ''}`;
}

function _localDateOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function submitLogActivity() {
  const topic = document.getElementById('logTopic').value.trim();
  if (!topic) { showToast('⚠️ What did you study?'); return; }
  const category = document.getElementById('logCategory').value.trim() || ADHOC_DEFAULT_CATEGORY;
  const date = document.getElementById('logDate').value || _todayStr();
  // Today → now; a past date → noon local time on that day (keeps it on the right heatmap cell in any timezone)
  const t = date === _todayStr() ? new Date() : new Date(`${date}T12:00:00`);
  const entry = { t: t.toISOString(), syllabus: category, topic, action: 'done', manual: true };
  localStorage.setItem('study-lock-in:last-activity-category', category);
  postEvent({ op: 'activity_add', entry });
  renderLogActivity();
  setTimeout(() => document.getElementById('logTopic')?.focus(), 30);
  showToast(`🔥 Logged: ${topic.length > 40 ? topic.slice(0, 39) + '…' : topic}`);
}

function removeLogActivity(key) {
  if (!confirm('Remove this activity entry?')) return;
  postEvent({ op: 'activity_rm', key });
  renderLogActivity();
}

function appendLocalActivity(topic, action) {
  try {
    const log = getLocalActivity();
    log.push({
      t: new Date().toISOString(),
      syllabus: state?.meta?.title || _activeSyllabusKey,
      topic: topic || 'Task',
      action: action || 'done',
    });
    localStorage.setItem('study-lock-in:activity', JSON.stringify(log));
    renderHeatmap(getActivityLog());
  } catch (e) {
    console.warn('Failed to append local activity', e);
  }
}

function findTaskText(taskId) {
  if (!state || !state.days) return taskId;
  for (const d of state.days) {
    for (const b of (d.blocks || [])) {
      for (const t of (b.tasks || [])) {
        if (t.id === taskId) return t.text;
      }
    }
  }
  return taskId;
}

function fetchActivity() {
  return Promise.resolve(getActivityLog());
}

let _heatmapResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_heatmapResizeTimer);
  _heatmapResizeTimer = setTimeout(() => { if (document.getElementById('heatmapBody') && state) renderHeatmap(); }, 150);
});

// ===== STUDY HOURS: last 7 days × 24 hours, from each activity entry's local time =====
function _fmtHour(h) { const s = h < 12 ? 'am' : 'pm'; const x = h % 12 === 0 ? 12 : h % 12; return `${x} ${s}`; }

function renderHourHeatmap(activityLog) {
  const host = document.getElementById('hourHeatmap');
  if (!host) return;
  activityLog = activityLog || getActivityLog();
  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];                                              // oldest first → today last
  for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push(d); }
  const grid = {}; days.forEach(d => { grid[dayKey(d)] = Array.from({ length: 24 }, () => ({ n: 0, topics: [] })); });

  for (const e of activityLog || []) {
    if (!e || !e.t) continue;
    const t = new Date(e.t); if (isNaN(t)) continue;
    const row = grid[dayKey(t)]; if (!row) continue;
    const cell = row[t.getHours()];
    if (e.action === 'done') { cell.n++; cell.topics.push(e); }
    else if (e.action === 'undone') {
      cell.n = Math.max(0, cell.n - 1);
      const i = cell.topics.map(x => x.topic).lastIndexOf(e.topic);   // drop the un-ticked item from the tooltip too
      if (i >= 0) cell.topics.splice(i, 1); else cell.topics.pop();
    }
  }

  const all = Object.values(grid).flat();
  const max = Math.max(0, ...all.map(c => c.n));
  const total = all.reduce((a, c) => a + c.n, 0);
  const level = n => (n <= 0 || !max) ? 0 : Math.min(4, Math.ceil((n / max) * 4));
  // peak hour across the week
  const byHour = Array.from({ length: 24 }, (_, h) => days.reduce((a, d) => a + grid[dayKey(d)][h].n, 0));
  const peak = byHour.indexOf(Math.max(...byHour));
  const activeDays = days.filter(d => grid[dayKey(d)].some(c => c.n > 0)).length;
  const now = new Date(), nowH = now.getHours(), todayKey = dayKey(today);
  const dayLabel = d => dayKey(d) === todayKey ? 'Today'
    : d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.getDate();

  // Weather-map (filled contour) style is drawn on a canvas by _drawHourField(); an invisible 7×24 grid
  // on top keeps the per-hour tooltips.
  let hits = '', labels = '';
  for (const d of days) {
    const k = dayKey(d), isToday = k === todayKey, row = grid[k];
    labels += `<span class="hh-day${isToday ? ' is-today' : ''}">${escapeHtml(dayLabel(d))}</span>`;
    row.forEach((c, h) => {
      const future = isToday && h > nowH, current = isToday && h === nowH;
      const label = `${dayLabel(d)} · ${_fmtHour(h)}–${_fmtHour((h + 1) % 24)}`;
      let tip = c.n ? `${label}: ${c.n} item${c.n > 1 ? 's' : ''}` : `${label}: nothing logged`;
      c.topics.slice(0, 4).forEach(x => { const tp = String(x.topic || ''); tip += `\n• ${tp.length > 70 ? tp.slice(0, 67) + '…' : tp}`; });
      if (c.topics.length > 4) tip += `\n… and ${c.topics.length - 4} more`;
      hits += `<span class="hh-hit${future ? ' future' : ''}${current ? ' now' : ''}" data-level="${level(c.n)}" title="${escapeHtml(tip)}"></span>`;
    });
  }
  let axis = '';
  for (let h = 0; h < 24; h += 3) axis += `<span style="left:${(h / 24 * 100).toFixed(3)}%">${_fmtHour(h).replace(' ', '')}</span>`;
  const cells = `
    <div class="hh-days">${labels}</div>
    <div class="hh-plot">
      <div class="hh-axis">${axis}</div>
      <div class="hh-field">
        <canvas class="hh-canvas" aria-hidden="true"></canvas>
        <div class="hh-hits">${hits}</div>
      </div>
      <div class="hh-legend"><span>Less</span>${[0,1,2,3,4,5,6,7,8].map(i => `<i style="background:var(--hh${i})"></i>`).join('')}<span>More</span></div>
    </div>`;

  host.innerHTML = `
    <div class="hh-header">
      <h3 class="heatmap-title">Study hours <span class="heatmap-range">last 7 days</span></h3>
      <span class="hh-summary">${total ? `${total} item${total > 1 ? 's' : ''} on ${activeDays} day${activeDays > 1 ? 's' : ''} · most active around <b>${_fmtHour(peak)}</b>` : 'Nothing logged in the last 7 days yet'}</span>
    </div>
    <div class="hh-wrap">${cells}</div>`;
  _drawHourField(host.querySelector('.hh-canvas'), days.map(d => grid[dayKey(d)].map(c => c.n)));
}

/**
 * Filled-contour "weather map": counts (7 × 24) → smooth field (Gaussian spread over neighbouring hours
 * and days) on a coarse grid → bilinear interpolation per pixel → quantised into 9 flat levels from the
 * yearly heatmap palette (--hh0…--hh8), with thin darker contour lines where levels meet. No blur.
 */
function _drawHourField(canvas, counts) {
  if (!canvas) return;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;                                     // hidden (Study view) — redrawn when Overview shows
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(canvas);
  const palette = Array.from({ length: 9 }, (_, i) => {
    const c = css.getPropertyValue('--hh' + i).trim() || '#ccc';
    const m = c.match(/^#([0-9a-f]{6})$/i); const n = m ? parseInt(m[1], 16) : 0xcccccc;
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  });
  const ROWS = counts.length, COLS = 24;
  // coarse field: 4 samples per hour, 4 per day, Gaussian kernel (σ ≈ 0.85 h, 0.6 day)
  const GX = COLS * 4, GY = ROWS * 4, sx = 0.85, sy = 0.6;
  const field = new Float32Array(GX * GY); let fmax = 0;
  for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
    const x = (gx + 0.5) / 4, y = (gy + 0.5) / 4; let v = 0;     // in cell units
    for (let r = 0; r < ROWS; r++) {
      const dy = (y - (r + 0.5)) / sy; if (dy * dy > 16) continue;
      const row = counts[r];
      for (let h = 0; h < COLS; h++) {
        const n = row[h]; if (!n) continue;
        const dx = (x - (h + 0.5)) / sx; if (dx * dx > 16) continue;
        v += n * Math.exp(-0.5 * (dx * dx + dy * dy));
      }
    }
    field[gy * GX + gx] = v; if (v > fmax) fmax = v;
  }
  const img = ctx.createImageData(canvas.width, canvas.height), px = img.data;
  const lv = new Uint8Array(canvas.width * canvas.height);
  for (let py = 0; py < canvas.height; py++) {
    const fy = Math.min(GY - 1.001, Math.max(0, (py + 0.5) / canvas.height * GY - 0.5));
    const y0 = Math.floor(fy), ty = fy - y0;
    for (let pxl = 0; pxl < canvas.width; pxl++) {
      const fx = Math.min(GX - 1.001, Math.max(0, (pxl + 0.5) / canvas.width * GX - 0.5));
      const x0 = Math.floor(fx), tx = fx - x0, i0 = y0 * GX + x0;
      const v = (field[i0] * (1 - tx) + field[i0 + 1] * tx) * (1 - ty) + (field[i0 + GX] * (1 - tx) + field[i0 + GX + 1] * tx) * ty;
      const t = fmax ? v / fmax : 0;
      lv[py * canvas.width + pxl] = t < 0.08 ? 0 : Math.min(8, 1 + Math.floor(((t - 0.08) / 0.92) * 8));
    }
  }
  for (let i = 0, n = lv.length; i < n; i++) {
    const L = lv[i], c = palette[L];
    // contour line: darken where the level differs from the right or lower neighbour
    const edge = (i % canvas.width < canvas.width - 1 && lv[i + 1] !== L) || (i + canvas.width < n && lv[i + canvas.width] !== L);
    const k = edge ? 0.78 : 1;
    px[i * 4] = c[0] * k; px[i * 4 + 1] = c[1] * k; px[i * 4 + 2] = c[2] * k; px[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function renderHeatmap(activityLog) {
  activityLog = activityLog || getActivityLog();
  if (!Array.isArray(activityLog)) activityLog = [];
  renderHourHeatmap(activityLog);

  const body = document.getElementById('heatmapBody');
  if (!body) return;

  // Local date string helper (avoids UTC timezone shift)
  const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  // Aggregate daily counts: { "2026-11-01": { count: 3, topics: [...] } }
  const dailyData = {};
  for (const entry of activityLog) {
    if (!entry || !entry.t) continue;
    const entryDate = new Date(entry.t);
    if (isNaN(entryDate.getTime())) continue;
    const dateStr = toDateStr(entryDate);
    if (!dailyData[dateStr]) dailyData[dateStr] = { count: 0, topics: [] };
    if (entry.action === 'done') {
      dailyData[dateStr].count++;
      dailyData[dateStr].topics.push({ topic: entry.topic, syllabus: entry.syllabus });
    } else if (entry.action === 'undone') {
      dailyData[dateStr].count = Math.max(0, dailyData[dateStr].count - 1);
    }
  }

  // Rolling 12-month window: the 11 previous months + the current month (shown last).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let anchor = new Date(today);

  // If the device clock is far from the data (no activity in the window ending today),
  // anchor the window on the latest activity date so the grid never renders empty.
  const activeDates = Object.keys(dailyData).filter(d => dailyData[d].count > 0).sort();
  if (activeDates.length) {
    const windowStartStr = toDateStr(new Date(today.getFullYear(), today.getMonth() - 11, 1));
    const hasActivityInWindow = activeDates.some(d => d >= windowStartStr && d <= toDateStr(today));
    if (!hasActivityInWindow) anchor = new Date(activeDates[activeDates.length - 1] + 'T00:00:00');
  }

  const rangeStart = new Date(anchor.getFullYear(), anchor.getMonth() - 11, 1); // 1st of month, 11 months back
  const endDate = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);     // last day of anchor month
  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const rangeLabel = `${monthNamesShort[rangeStart.getMonth()]} ${rangeStart.getFullYear()} – ${monthNamesShort[endDate.getMonth()]} ${endDate.getFullYear()}`;

  const titleEl = document.querySelector('.heatmap-title');
  if (titleEl) {
    titleEl.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      Study Activity <span class="heatmap-range">${rangeLabel}</span>
    `;
  }

  // Align grid start to the Sunday on/before the window start
  const startDate = new Date(rangeStart);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const weeks = [];
  let currentDate = new Date(startDate);
  let weekCells = [];
  let totalActivities = 0;
  const monthPositions = [];
  let lastMonth = -1;

  while (currentDate <= endDate) {
    const dateStr = toDateStr(currentDate);
    const data = dailyData[dateStr] || { count: 0, topics: [] };
    const level = Math.min(8, data.count);
    const isFuture = currentDate > today;
    const outOfRange = currentDate < rangeStart; // padding days before the window

    if (data.count > 0 && !outOfRange) totalActivities += data.count;

    const m = currentDate.getMonth();
    const y = currentDate.getFullYear();
    if (m !== lastMonth && !outOfRange) {
      monthPositions.push({ month: m, year: y, weekIndex: weeks.length });
      lastMonth = m;
    }

    weekCells.push({
      date: dateStr,
      level: isFuture ? -1 : level,
      outOfRange,
      count: data.count,
      topics: data.topics,
      dayOfWeek: currentDate.getDay(),
    });

    if (currentDate.getDay() === 6 || currentDate >= endDate) {
      weeks.push(weekCells);
      weekCells = [];
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Render grid
  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  let html = '<div class="heatmap-grid">';
  html += '<div class="heatmap-day-labels">';
  for (const label of dayLabels) {
    html += `<span class="heatmap-day-label">${label}</span>`;
  }
  html += '</div>';

  const monthStartWeeks = new Set(monthPositions.filter((_, i) => i > 0).map(mp => mp.weekIndex));
  html += '<div class="heatmap-weeks">';
  for (let wi = 0; wi < weeks.length; wi++) {
    const week = weeks[wi];
    const isMonthStart = monthStartWeeks.has(wi);
    html += `<div class="heatmap-week${isMonthStart ? ' month-start' : ''}">`;
    if (week.length < 7 && weeks.indexOf(week) === 0) {
      for (let p = 0; p < 7 - week.length; p++) {
        html += '<span class="heatmap-cell empty"></span>';
      }
    }
    for (const cell of week) {
      if (cell.outOfRange) {
        html += '<span class="heatmap-cell empty"></span>';
      } else if (cell.level < 0) {
        html += `<span class="heatmap-cell future" data-level="0" data-date="${cell.date}"></span>`;
      } else {
        const tooltipLines = [];
        if (cell.count > 0) {
          tooltipLines.push(`${cell.count} task${cell.count > 1 ? 's' : ''} on ${formatHeatmapDate(cell.date)}`);
          const bySyllabus = {};
          for (const t of cell.topics) {
            if (!bySyllabus[t.syllabus]) bySyllabus[t.syllabus] = [];
            bySyllabus[t.syllabus].push(t.topic);
          }
          for (const [syl, topics] of Object.entries(bySyllabus)) {
            tooltipLines.push(`\n${syl}:`);
            for (const top of topics.slice(0, 5)) {
              const short = top && top.length > 60 ? top.substring(0, 57) + '...' : (top || '');
              tooltipLines.push(`  • ${short}`);
            }
            if (topics.length > 5) tooltipLines.push(`  … and ${topics.length - 5} more`);
          }
        } else {
          tooltipLines.push(`No activity on ${formatHeatmapDate(cell.date)}`);
        }
        html += `<span class="heatmap-cell" data-level="${cell.level}" data-date="${cell.date}" title="${escapeHtml(tooltipLines.join('\n'))}"></span>`;
      }
    }
    if (week.length < 7 && weeks.indexOf(week) === weeks.length - 1) {
      for (let p = 0; p < 7 - week.length; p++) {
        html += '<span class="heatmap-cell empty"></span>';
      }
    }
    html += '</div>';
  }
  html += '</div></div>';
  // Month labels live inside the scrollable body so they scroll with the grid on narrow screens
  html += '<div class="heatmap-months"></div>';
  body.innerHTML = html;

  // Desktop: grow the cells so the year fills the card width (phones keep the fixed small cells + scroll).
  body.style.removeProperty('--hm-cell');
  if (window.innerWidth > 768 && weeks.length) {
    const labelsW = body.querySelector('.heatmap-day-labels').offsetWidth + 4;
    const gap = 2, monthGap = 4 * monthStartWeeks.size;
    const avail = body.clientWidth - labelsW - monthGap;
    const size = Math.max(11, Math.min(20, Math.floor((avail + gap) / weeks.length) - gap));
    body.style.setProperty('--hm-cell', size + 'px');
  }

  // Position month labels from the rendered week columns, so they stay aligned
  // whatever cell size the current breakpoint uses.
  const gridEl = body.querySelector('.heatmap-grid');
  const weekEls = body.querySelectorAll('.heatmap-week');
  const monthsEl = body.querySelector('.heatmap-months');
  const gridLeft = gridEl.getBoundingClientRect().left;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let monthHtml = '';
  for (const mp of monthPositions) {
    if (!weekEls[mp.weekIndex]) continue;
    const px = weekEls[mp.weekIndex].getBoundingClientRect().left - gridLeft;
    monthHtml += `<span class="heatmap-month-label" style="left:${px}px">${monthNames[mp.month]}${mp.month === 0 ? ` ’${String(mp.year).slice(2)}` : ''}</span>`;
  }
  monthsEl.style.width = gridEl.scrollWidth + 'px';
  monthsEl.innerHTML = monthHtml;

  // When the grid overflows (phones), scroll so today / the latest activity is in view
  if (body.scrollWidth > body.clientWidth) {
    const focusCell = body.querySelector(`.heatmap-cell[data-date="${toDateStr(today)}"]`)
      || [...body.querySelectorAll('.heatmap-cell[data-date]:not(.future)')].pop();
    if (focusCell) {
      const cellX = focusCell.getBoundingClientRect().left - body.getBoundingClientRect().left + body.scrollLeft;
      body.scrollLeft = Math.max(0, cellX - body.clientWidth + 48);
    }
  }

  // Touch devices have no hover tooltips — tapping a cell shows its summary instead
  body.onclick = (e) => {
    const cell = e.target.closest('.heatmap-cell[title]');
    if (!cell || !window.matchMedia('(hover: none)').matches) return;
    showToast(cell.getAttribute('title').split('\n')[0]);
  };
}

function formatHeatmapDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Boot & Init ────────────────────────────────────────────────
async function bootTracker() {
  console.log('[boot] Starting Study Lock-In...');
  const savedSyllabus = localStorage.getItem('study-lock-in:active-syllabus') || 'math-for-ml';
  loadStateForSyllabus(savedSyllabus);

  renderApp();
  if (state.meta && state.meta.title) document.title = state.meta.title;

  loadTrophyPile();
  pruneLocalActivity();
  renderHeatmap(getActivityLog());
  console.log('[boot] Ready.');
}

async function init() {
  // Check passcode lock
  const isUnlocked = checkLockState();
  if (isUnlocked) {
    await bootTracker();
  } else {
    console.log('[lock] App locked behind passcode screen.');
  }
}

document.addEventListener('DOMContentLoaded', init);
