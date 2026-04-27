"use strict";

// ─────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────
const db = {
  getTables() {
    return JSON.parse(localStorage.getItem("apnea_tables") || "[]");
  },
  getTable(id) {
    return this.getTables().find((t) => t.id === id) || null;
  },
  saveTable(table) {
    const list = this.getTables();
    const i = list.findIndex((t) => t.id === table.id);
    if (i >= 0) list[i] = table;
    else list.push(table);
    localStorage.setItem("apnea_tables", JSON.stringify(list));
  },
  deleteTable(id) {
    localStorage.setItem(
      "apnea_tables",
      JSON.stringify(this.getTables().filter((t) => t.id !== id)),
    );
  },
  getSessions() {
    return JSON.parse(localStorage.getItem("apnea_sessions") || "[]");
  },
  saveSession(s) {
    const list = this.getSessions();
    list.unshift(s);
    localStorage.setItem("apnea_sessions", JSON.stringify(list));
  },
  clearSessions() {
    localStorage.removeItem("apnea_sessions");
  },
  clearAllData() {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("apnea_")) localStorage.removeItem(key);
    }
  },
};

// ─────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function parseTimeStr(str) {
  if (!str) return 0;
  str = String(str).trim();
  if (str.includes(":")) {
    const [m, s] = str.split(":").map((n) => parseInt(n) || 0);
    return m * 60 + s;
  }
  return parseInt(str) || 0;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

// ─────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────
const settings = {
  get voiceEnabled() {
    return localStorage.getItem("apnea_voice") !== "off";
  },
  set voiceEnabled(v) {
    localStorage.setItem("apnea_voice", v ? "on" : "off");
  },
  get audioMode() {
    return localStorage.getItem("apnea_audio_mode") || "voice";
  },
  set audioMode(v) {
    localStorage.setItem("apnea_audio_mode", v);
  },
  get voiceGender() {
    const v = localStorage.getItem("apnea_voice_gender");
    return v === "male" ? "male" : "female";
  },
  set voiceGender(v) {
    localStorage.setItem("apnea_voice_gender", v === "male" ? "male" : "female");
  },
  get countdownFrom5() {
    return localStorage.getItem("apnea_countdown_from_5") === "true";
  },
  set countdownFrom5(v) {
    localStorage.setItem("apnea_countdown_from_5", v ? "true" : "false");
  },
  get relaxationDuration() {
    const raw = localStorage.getItem("apnea_relax_duration");
    if (raw === null) return 60;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 60;
  },
  set relaxationDuration(v) {
    localStorage.setItem("apnea_relax_duration", String(v | 0));
  },
  get relaxationSound() {
    return localStorage.getItem("apnea_relax_sound") || "none";
  },
  set relaxationSound(v) {
    localStorage.setItem("apnea_relax_sound", v);
  },
};

// ─────────────────────────────────────────────
// Audio clips
// ─────────────────────────────────────────────
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playBeep(freq = 440, duration = 0.1, type = "sine") {
  if (!settings.voiceEnabled) return;
  const ctx = getAudioCtx();
  if (ctx.state === "suspended") ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

const audioExt =
  new Audio().canPlayType("audio/webm; codecs=opus") !== "" ? "opus" : "mp3";

const CLIP_KEYS = [
  "rest",
  "hold",
  "relax",
  "after_contraction",
  "one_breath",
  "complete",
  "tap_contraction",
  "n10",
  "count_321",
  "count_54321",
];

const clips = {};
function loadClips() {
  const voice = settings.voiceGender;
  CLIP_KEYS.forEach((key) => {
    const a = new Audio(`audio/${voice}/${key}.${audioExt}`);
    a.preload = "auto";
    clips[key] = a;
  });
}
loadClips();

let _currentClip = null;
let _audioUnlocked = false;

function unlockAudio() {
  _audioUnlocked = true;
  const ctx = getAudioCtx();
  if (ctx.state === "suspended") ctx.resume();
  Object.values(clips).forEach((a) => {
    const wasMuted = a.muted;
    a.muted = true;
    a.play()
      .then(() => {
        a.pause();
        a.currentTime = 0;
        a.muted = wasMuted;
      })
      .catch(() => {
        a.muted = wasMuted;
      });
  });
}

function tryUnlockAudio() {
  if (_audioUnlocked) return;
  unlockAudio();
}

document.addEventListener("pointerdown", tryUnlockAudio, { once: true });
document.addEventListener("touchstart", tryUnlockAudio, { once: true });
document.addEventListener("keydown", tryUnlockAudio, { once: true });

let _relaxSound = null;
function startRelaxSound() {
  const name = settings.relaxationSound;
  if (name === "none") return;
  _relaxSound = new Audio(`audio/sounds/${name}.mp3`);
  _relaxSound.loop = true;
  _relaxSound.volume = 0.4;
  _relaxSound.play().catch(() => {});
}
function stopRelaxSound() {
  if (!_relaxSound) return;
  _relaxSound.pause();
  _relaxSound = null;
}

function getCountdownCue(t) {
  if (t === 10) return "n10";
  const isVoice = settings.audioMode !== "beep";
  if (isVoice) {
    if (settings.countdownFrom5 && t === 5) return "count_54321";
    if (!settings.countdownFrom5 && t === 3) return "count_321";
    return null;
  }
  const beepValues = settings.countdownFrom5 ? [5, 4, 3, 2, 1] : [3, 2, 1];
  return beepValues.includes(t) ? `n${t}` : null;
}

function speak(key, thenKey = null) {
  if (!settings.voiceEnabled) return;

  if (settings.audioMode === "beep") {
    // Simple beep logic:
    // n10 -> Double beep (10s warning)
    // n3, n2, n1 -> Standard beep (final countdown)
    // Start of hold (hold_n) -> Higher beep
    // Complete -> Sequence of beeps
    if (key === "n10") {
      playBeep(440, 0.1);
      setTimeout(() => playBeep(440, 0.1), 180);
    } else if (key.startsWith("n")) {
      playBeep(440, 0.1);
    } else if (key.startsWith("hold")) {
      playBeep(880, 0.2);
    } else if (key === "complete") {
      playBeep(880, 0.1);
      setTimeout(() => playBeep(1100, 0.1), 150);
      setTimeout(() => playBeep(1320, 0.3), 300);
    } else {
      playBeep(660, 0.1);
    }
    if (thenKey) setTimeout(() => speak(thenKey), 400);
    return;
  }

  if (_currentClip) {
    _currentClip.onended = null;
    _currentClip.pause();
    _currentClip.currentTime = 0;
  }
  const audio = clips[key];
  if (!audio) return;
  audio.currentTime = 0;
  _currentClip = audio;
  audio.onended = thenKey ? () => speak(thenKey) : null;
  audio.play().catch(() => {});
}

// ─────────────────────────────────────────────
// Session Engine
// ─────────────────────────────────────────────
class SessionEngine {
  constructor(table, { onTick, onPhaseChange, onComplete }) {
    this.table = table;
    this.onTick = onTick;
    this.onPhaseChange = onPhaseChange;
    this.onComplete = onComplete;

    this.phases = this._buildPhases();
    this.phaseIdx = -1;
    this.timeLeft = 0;
    this.elapsed = 0;
    this.timer = null;
    this.paused = false;
    this.startTime = Date.now();
    this.completedRounds = 0;
  }

  get totalRounds() {
    const p = this.table.params;
    if (this.table.type === "wonka") return p.breathholds;
    if (this.table.type === "custom") return p.rounds.length;
    return p.rounds;
  }

  _buildPhases() {
    const { type, params: p } = this.table;
    const phases = [];

    if (settings.relaxationDuration > 0) {
      phases.push({ kind: "relax", dur: settings.relaxationDuration, round: 0 });
    }

    if (type === "wonka") {
      for (let i = 0; i < p.breathholds; i++) {
        phases.push({ kind: "hold", dur: null, round: i + 1, countUp: true });
        phases.push({
          kind: "countdown",
          dur: p.countdownAfterContraction,
          round: i + 1,
        });
        if (i < p.breathholds - 1)
          phases.push({
            kind: "breath",
            dur: null,
            round: i + 1,
            userTriggered: true,
          });
      }
    } else {
      const rounds = this._buildRounds();

      for (let i = 0; i < rounds.length; i++) {
        phases.push({ kind: "hold", dur: rounds[i].hold, round: i + 1 });
        if (i < rounds.length - 1)
          phases.push({ kind: "rest", dur: rounds[i].rest, round: i + 1 });
      }
    }

    return phases;
  }

  _buildRounds() {
    const { type, params: p } = this.table;
    if (type === "co2")
      return Array.from({ length: p.rounds }, (_, i) => ({
        hold: p.holdTime,
        rest: Math.max(10, p.startRest - i * p.restDecrement),
      }));
    if (type === "o2")
      return Array.from({ length: p.rounds }, (_, i) => ({
        hold: p.startHold + i * p.holdIncrement,
        rest: p.restTime,
      }));
    if (type === "custom") return p.rounds;
    return [];
  }

  start() {
    this._enter(0);
  }

  _enter(idx) {
    stopRelaxSound();

    if (idx >= this.phases.length) {
      this._complete();
      return;
    }

    this.phaseIdx = idx;
    const ph = this.phases[idx];

    if (ph.countUp) {
      this.elapsed = 0;
      this.timeLeft = null;
    } else {
      this.timeLeft = ph.dur;
      this.elapsed = 0;
    }

    this._announce(ph);
    this.onPhaseChange(this._state());
    clearInterval(this.timer);

    if (ph.kind === "relax") startRelaxSound();

    if (ph.userTriggered) {
      // no timer — wait for signalReady()
      return;
    }

    if (ph.countUp) {
      this.timer = setInterval(() => {
        if (this.paused) return;
        this.elapsed++;
        this.onTick(this._state());
      }, 1000);
    } else {
      this.timer = setInterval(() => {
        if (this.paused) return;
        this.timeLeft--;
        const t = this.timeLeft;
        const cue = getCountdownCue(t);
        if (cue) speak(cue);
        this.onTick(this._state());
        if (t <= 0) {
          clearInterval(this.timer);
          if (ph.kind === "hold") this.completedRounds++;
          this._enter(idx + 1);
        }
      }, 1000);
    }
  }

  signalReady() {
    const ph = this.phases[this.phaseIdx];
    if (ph?.userTriggered) this._enter(this.phaseIdx + 1);
  }

  signalSkipRelax() {
    const ph = this.phases[this.phaseIdx];
    if (ph?.kind !== "relax") return;
    clearInterval(this.timer);
    this._enter(this.phaseIdx + 1);
  }

  signalContraction() {
    const ph = this.phases[this.phaseIdx];
    if (ph?.kind === "hold" && ph.countUp) {
      clearInterval(this.timer);
      this.completedRounds++;
      this._enter(this.phaseIdx + 1);
    }
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  stop() {
    clearInterval(this.timer);
    stopRelaxSound();
    this._persist(false);
  }

  _complete() {
    clearInterval(this.timer);
    stopRelaxSound();
    speak("complete");
    this._persist(true);
    this.onComplete(this._state());
  }

  _persist(completed) {
    db.saveSession({
      id: uid(),
      tableId: this.table.id,
      tableName: this.table.name,
      tableType: this.table.type,
      date: new Date().toISOString(),
      completedRounds: this.completedRounds,
      totalRounds: this.totalRounds,
      totalDuration: Math.round((Date.now() - this.startTime) / 1000),
      completed,
    });
  }

  _announce(ph) {
    const announceKey = {
      rest: "rest",
      countdown: "after_contraction",
      breath: "one_breath",
      relax: "relax",
    }[ph.kind];
    // Chain the initial countdown after the announce when the phase starts
    // at a threshold, so they don't overlap.
    const initialCount = !ph.countUp ? getCountdownCue(ph.dur) : null;
    if (announceKey) {
      speak(announceKey, initialCount);
      return;
    }
    if (ph.kind === "hold") {
      const thenKey = ph.countUp ? "tap_contraction" : initialCount;
      speak("hold", thenKey);
    }
  }

  _state() {
    const ph = this.phases[this.phaseIdx] || {};
    const next = this.phases[this.phaseIdx + 1] || null;
    return {
      phase: ph,
      next,
      timeLeft: this.timeLeft,
      elapsed: this.elapsed,
      completedRounds: this.completedRounds,
      totalRounds: this.totalRounds,
      paused: this.paused,
      duration: Math.round((Date.now() - this.startTime) / 1000),
    };
  }
}

// ─────────────────────────────────────────────
// App state
// ─────────────────────────────────────────────
let currentSession = null;

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────
function navigate(view, params = {}) {
  const main = document.getElementById("main");
  const title = document.getElementById("header-title");
  const btnBack = document.getElementById("btn-back");
  const btnHist = document.getElementById("btn-history");
  const btnSettings = document.getElementById("btn-settings");
  const btnSound = document.getElementById("btn-sound");

  btnBack.style.visibility = view === "tables" ? "hidden" : "";
  btnBack.style.pointerEvents = view === "tables" ? "none" : "";
  btnHist.style.visibility = view !== "tables" ? "hidden" : "";
  btnHist.style.pointerEvents = view !== "tables" ? "none" : "";
  btnSettings.style.visibility = view !== "tables" ? "hidden" : "";
  btnSettings.style.pointerEvents = view !== "tables" ? "none" : "";
  const showSound = view === "tables" || view === "session";
  btnSound.style.visibility = showSound ? "" : "hidden";
  btnSound.style.pointerEvents = showSound ? "" : "none";

  btnBack.onclick = () => {
    if (view === "session" && currentSession) {
      if (!confirm("Stop the current session?")) return;
      currentSession.stop();
      currentSession = null;
    }
    navigate("tables");
  };

  switch (view) {
    case "tables":
      title.textContent = "Apnea Dry Training Tables";
      renderTables(main);
      break;
    case "edit":
      title.textContent = params.id ? "Edit Table" : "New Table";
      renderEdit(main, params.id || null);
      break;
    case "session":
      const table = db.getTable(params.tableId);
      title.textContent = table ? table.name : "Session";
      renderSession(main, params.tableId);
      break;
    case "history":
      title.textContent = "History";
      renderHistory(main);
      break;
    case "settings":
      title.textContent = "Settings";
      renderSettings(main);
      break;
  }
}

// ─────────────────────────────────────────────
// View helpers
// ─────────────────────────────────────────────
function typeIcon(type) {
  const labels = { co2: "CO₂", o2: "O₂", wonka: "W", custom: "···" };
  const cls = {
    co2: "icon-co2",
    o2: "icon-o2",
    wonka: "icon-wonka",
    custom: "icon-custom",
  };
  return `<div class="table-icon ${cls[type] || ""}">${labels[type] || "?"}</div>`;
}

function tableSummary(t) {
  const p = t.params;
  switch (t.type) {
    case "co2":
      return (
        `${p.rounds} rounds · hold ${fmtTime(p.holdTime)} · rest ` +
        `${fmtTime(p.startRest)} → ${fmtTime(Math.max(10, p.startRest - (p.rounds - 1) * p.restDecrement))}`
      );
    case "o2":
      return (
        `${p.rounds} rounds · hold ` +
        `${fmtTime(p.startHold)} → ${fmtTime(p.startHold + (p.rounds - 1) * p.holdIncrement)}` +
        ` · rest ${fmtTime(p.restTime)}`
      );
    case "wonka":
      return `${p.breathholds} breathholds · hold ${p.countdownAfterContraction} more seconds`;
    case "custom":
      return `${p.rounds.length} rounds`;
    default:
      return "";
  }
}

function phaseLabel(kind) {
  return (
    {
      ready: "Get Ready",
      prep: "Preparation",
      relax: "Relax",
      hold: "Hold",
      rest: "Rest",
      countdown: "Hold",
      breath: "One Single Breath",
      cooldown: "Recovery",
    }[kind] || kind
  );
}

function phaseClass(kind) {
  if (kind === "hold" || kind === "countdown") return "phase-hold";
  if (kind === "rest" || kind === "cooldown") return "phase-rest";
  return "phase-prep";
}

function nextLabel(next) {
  if (!next) return "";
  if (next.kind === "countdown") return `Next: Hold ${next.dur} more seconds`;
  if (next.countUp) return `Next: ${phaseLabel(next.kind)}`;
  return `Next: ${phaseLabel(next.kind)}${next.dur ? " " + fmtTime(next.dur) : ""}`;
}

// ─────────────────────────────────────────────
// View: Tables
// ─────────────────────────────────────────────
function renderTables(main) {
  const tables = db.getTables();
  let html = "";

  if (tables.length === 0) {
    html = `<div class="empty-state">
      <h3>No tables yet</h3>
      <p>Tap + to create your first training table.</p>
    </div>`;
  } else {
    html =
      `<div class="card">` +
      tables
        .map(
          (t) => `
        <div class="card-row" data-id="${t.id}">
          ${typeIcon(t.type)}
          <div class="table-info">
            <div class="table-name">${t.name}</div>
            <div class="table-meta">${tableSummary(t)}</div>
          </div>
          <button class="btn-delete-row" data-id="${t.id}" title="Delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>`,
        )
        .join("") +
      `</div>`;
  }

  main.innerHTML =
    html +
    `<div class="list-bottom-pad"></div>` +
    `<button class="fab" id="btn-new" title="New table">+</button>`;

  main.querySelectorAll(".btn-delete-row").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const table = db.getTable(btn.dataset.id);
      if (table && confirm(`Delete "${table.name}"?`)) {
        db.deleteTable(btn.dataset.id);
        renderTables(main);
      }
    });
  });

  main.querySelectorAll(".card-row").forEach((row) => {
    // tap → start session
    row.addEventListener("click", () =>
      navigate("session", { tableId: row.dataset.id }),
    );

    // long-press → edit
    let pressTimer;
    row.addEventListener("pointerdown", () => {
      pressTimer = setTimeout(
        () => navigate("edit", { id: row.dataset.id }),
        600,
      );
    });
    row.addEventListener("pointerup", () => clearTimeout(pressTimer));
    row.addEventListener("pointerleave", () => clearTimeout(pressTimer));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      navigate("edit", { id: row.dataset.id });
    });
  });

  document
    .getElementById("btn-new")
    .addEventListener("click", () => navigate("edit", {}));
}

// ─────────────────────────────────────────────
// View: Edit
// ─────────────────────────────────────────────
function timePairHtml(name, totalSec = 0) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `<div class="time-pair">
    <input type="number" id="${name}_m" min="0" max="99"  value="${m}" placeholder="0">
    <span>:</span>
    <input type="number" id="${name}_s" min="0" max="59"  value="${s.toString().padStart(2, "0")}" placeholder="00">
  </div>`;
}

function getTimePair(name) {
  const m = parseInt(document.getElementById(name + "_m")?.value) || 0;
  const s = parseInt(document.getElementById(name + "_s")?.value) || 0;
  return m * 60 + s;
}

function renderEdit(main, id) {
  const table = id ? db.getTable(id) : null;
  const type = table?.type || "co2";

  main.innerHTML = `
    <div class="form-group">
      <label class="form-label">Name</label>
      <input class="form-input" id="f-name" value="${table?.name || ""}" placeholder="Table name">
    </div>
    <div class="form-group">
      <label class="form-label">Type</label>
      <select class="form-input" id="f-type">
        <option value="co2"    ${type === "co2" ? "selected" : ""}>CO₂ Tolerance</option>
        <option value="o2"     ${type === "o2" ? "selected" : ""}>O₂ Efficiency</option>
        <option value="wonka"  ${type === "wonka" ? "selected" : ""}>Wonka</option>
        <option value="custom" ${type === "custom" ? "selected" : ""}>Custom</option>
      </select>
    </div>
    <div id="type-fields"></div>
    ${id ? `<div class="delete-zone"><button class="btn btn-danger" id="btn-delete">Delete Table</button></div>` : ""}
    <div style="height:80px"></div>
    <button class="fab" id="btn-save" title="Save">✓</button>`;

  function renderTypeFields(t) {
    const p = table?.params || {};
    const el = document.getElementById("type-fields");

    if (t === "co2") {
      el.innerHTML = `
        <div class="form-group">
          <label class="form-label">Rounds</label>
          <input class="form-input" id="f-rounds" type="number" min="1" max="30" value="${p.rounds || 8}">
        </div>
        <div class="form-group">
          <label class="form-label">Breath Hold (fixed)</label>
          ${timePairHtml("f-holdTime", p.holdTime ?? 90)}
        </div>
        <div class="form-group">
          <label class="form-label">Starting Rest Time</label>
          ${timePairHtml("f-startRest", p.startRest ?? 120)}
        </div>
        <div class="form-group">
          <label class="form-label">Rest Decrement per Round (sec)</label>
          <input class="form-input" id="f-restDecrement" type="number" min="0" max="120" value="${p.restDecrement ?? 15}">
        </div>`;
    } else if (t === "o2") {
      el.innerHTML = `
        <div class="form-group">
          <label class="form-label">Rounds</label>
          <input class="form-input" id="f-rounds" type="number" min="1" max="30" value="${p.rounds || 8}">
        </div>
        <div class="form-group">
          <label class="form-label">Starting Hold Time</label>
          ${timePairHtml("f-startHold", p.startHold ?? 60)}
        </div>
        <div class="form-group">
          <label class="form-label">Hold Increment per Round (sec)</label>
          <input class="form-input" id="f-holdIncrement" type="number" min="0" max="120" value="${p.holdIncrement ?? 15}">
        </div>
        <div class="form-group">
          <label class="form-label">Rest Time (fixed)</label>
          ${timePairHtml("f-restTime", p.restTime ?? 120)}
        </div>`;
    } else if (t === "wonka") {
      el.innerHTML = `
        <div class="form-group">
          <label class="form-label">Number of Breathholds</label>
          <input class="form-input" id="f-breathholds" type="number" min="1" max="30" value="${p.breathholds || 5}">
        </div>
        <div class="form-group">
          <label class="form-label">Hold After 1st Contraction</label>
          ${timePairHtml("f-countdownAfterContraction", p.countdownAfterContraction ?? 30)}
        </div>`;
    } else if (t === "custom") {
      const rounds =
        p.rounds && p.rounds.length > 0 ? p.rounds : [{ hold: 90, rest: 120 }];
      renderCustomRounds(el, rounds);
    }
  }

  function renderCustomRounds(container, rounds) {
    const rows = rounds
      .map(
        (r, i) => `
      <div class="round-row">
        <span class="round-num">${i + 1}</span>
        <span class="round-label">Hold</span>
        <input class="round-time" type="text" value="${fmtTime(r.hold)}" placeholder="1:30">
        <span class="round-label" style="margin-left:6px">Rest</span>
        <input class="round-time" type="text" value="${fmtTime(r.rest)}" placeholder="2:00">
        <span class="round-sep"></span>
        <button type="button" class="btn-remove" data-idx="${i}" title="Remove">✕</button>
      </div>`,
      )
      .join("");

    container.innerHTML = `
      <div class="form-group">
        <label class="form-label">Rounds</label>
        <div class="rounds-editor" id="rounds-editor">${rows}</div>
        <button type="button" class="btn-add-round" id="btn-add-round">+ Add Round</button>
      </div>`;

    document.getElementById("btn-add-round").addEventListener("click", () => {
      const current = readCustomRounds();
      const last = current[current.length - 1] || { hold: 90, rest: 120 };
      renderCustomRounds(container, [
        ...current,
        { hold: last.hold, rest: last.rest },
      ]);
    });

    container.querySelectorAll(".btn-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const current = readCustomRounds();
        if (current.length <= 1) return;
        current.splice(parseInt(btn.dataset.idx), 1);
        renderCustomRounds(container, current);
      });
    });
  }

  function readCustomRounds() {
    return Array.from(
      document.querySelectorAll("#rounds-editor .round-row"),
    ).map((row) => {
      const inputs = row.querySelectorAll(".round-time");
      return {
        hold: parseTimeStr(inputs[0]?.value),
        rest: parseTimeStr(inputs[1]?.value),
      };
    });
  }

  renderTypeFields(type);
  document
    .getElementById("f-type")
    .addEventListener("change", (e) => renderTypeFields(e.target.value));

  document.getElementById("btn-save").addEventListener("click", () => {
    const name = document.getElementById("f-name").value.trim();
    if (!name) {
      alert("Please enter a name.");
      return;
    }
    const t = document.getElementById("f-type").value;

    let params;
    if (t === "co2") {
      params = {
        rounds: parseInt(document.getElementById("f-rounds").value) || 8,
        holdTime: getTimePair("f-holdTime"),
        startRest: getTimePair("f-startRest"),
        restDecrement:
          parseInt(document.getElementById("f-restDecrement").value) || 0,
      };
    } else if (t === "o2") {
      params = {
        rounds: parseInt(document.getElementById("f-rounds").value) || 8,
        startHold: getTimePair("f-startHold"),
        holdIncrement:
          parseInt(document.getElementById("f-holdIncrement").value) || 0,
        restTime: getTimePair("f-restTime"),
      };
    } else if (t === "wonka") {
      params = {
        breathholds:
          parseInt(document.getElementById("f-breathholds").value) || 5,
        countdownAfterContraction: getTimePair("f-countdownAfterContraction"),
      };
    } else {
      params = { rounds: readCustomRounds() };
    }

    db.saveTable({ id: table?.id || uid(), name, type: t, params });
    navigate("tables");
  });

  if (id) {
    document.getElementById("btn-delete")?.addEventListener("click", () => {
      if (confirm(`Delete "${table.name}"?`)) {
        db.deleteTable(id);
        navigate("tables");
      }
    });
  }
}

// ─────────────────────────────────────────────
// View: Session
// ─────────────────────────────────────────────
function renderSession(main, tableId) {
  const table = db.getTable(tableId);
  if (!table) {
    navigate("tables");
    return;
  }

  const introMsg =
    settings.relaxationDuration > 0
      ? `Start the session with ${fmtTime(settings.relaxationDuration)} of relaxation. Use it to settle and prepare for your first breath hold.`
      : `Take as much time as you need for initial relaxation and your breathe-up.`;

  main.innerHTML = `
    <div class="session-start-screen">
      <div class="start-icon">${typeIcon(table.type)}</div>
      <h2>Ready to start?</h2>
      <p>${introMsg}</p>
      <div class="start-meta">${table.name} · ${tableSummary(table)}</div>
      <button class="btn btn-primary" id="btn-start-session">Start Session</button>
    </div>`;

  document.getElementById("btn-start-session").addEventListener("click", () => {
    startActualSession();
  });

  function startActualSession() {
    main.innerHTML = `
      <div class="session-wrap">
        <div class="session-round"  id="s-round"></div>
        <div class="session-phase"  id="s-phase"></div>
        <div class="session-timer"  id="s-timer">–:––</div>
        <div class="session-next"   id="s-next"></div>
        <button class="btn-contraction" id="btn-contraction" hidden>First Contraction</button>
        <button class="btn-contraction btn-ready" id="btn-ready" hidden>Ready</button>
        <button class="btn-skip" id="btn-skip-relax" hidden>Skip to first hold</button>
        <div class="session-controls">
          <button class="btn btn-secondary" id="btn-pause">Pause</button>
          <button class="btn btn-danger"    id="btn-stop">Stop</button>
        </div>
      </div>`;

    currentSession = new SessionEngine(table, {
      onTick: updateUI,
      onPhaseChange: updateUI,
      onComplete: ({ completedRounds, totalRounds, duration }) => {
        main.innerHTML = `
          <div class="session-complete">
            <div class="checkmark">✓</div>
            <h2>Session Complete</h2>
            <p>${completedRounds} of ${totalRounds} rounds completed.<br>Total time: ${fmtTime(duration)}.</p>
            <button class="btn btn-primary" id="btn-done">Done</button>
          </div>`;
        document
          .getElementById("btn-done")
          .addEventListener("click", () => navigate("tables"));
        currentSession = null;
      },
    });

    document
      .getElementById("btn-contraction")
      .addEventListener("click", () => currentSession?.signalContraction());
    document
      .getElementById("btn-ready")
      .addEventListener("click", () => currentSession?.signalReady());
    document
      .getElementById("btn-skip-relax")
      .addEventListener("click", () => currentSession?.signalSkipRelax());

    document.getElementById("btn-pause").addEventListener("click", () => {
      const paused = currentSession?.togglePause();
      document.getElementById("btn-pause").textContent = paused
        ? "Resume"
        : "Pause";
    });

    document.getElementById("btn-stop").addEventListener("click", () => {
      if (confirm("Stop the session?")) {
        currentSession?.stop();
        currentSession = null;
        navigate("tables");
      }
    });

    currentSession.start();
  }

  function updateUI({
    phase,
    next,
    timeLeft,
    elapsed,
    completedRounds,
    totalRounds,
    paused,
  }) {
    const roundEl = document.getElementById("s-round");
    if (roundEl) {
      roundEl.textContent = phase.round
        ? `Round ${phase.round} of ${totalRounds}`
        : "";
    }

    const phaseEl = document.getElementById("s-phase");
    if (phaseEl) {
      let label = phaseLabel(phase.kind);
      if (phase.kind === "countdown") {
        label = `Hold ${phase.dur} more seconds`;
      }
      phaseEl.textContent = label;
      phaseEl.className = `session-phase ${phaseClass(phase.kind)}`;
    }

    const timerEl = document.getElementById("s-timer");
    if (timerEl) {
      timerEl.textContent = phase.countUp
        ? fmtTime(elapsed)
        : phase.userTriggered
          ? "–"
          : fmtTime(timeLeft ?? 0);
    }

    const nextEl = document.getElementById("s-next");
    if (nextEl) {
      nextEl.textContent = nextLabel(next);
    }

    const btnContraction = document.getElementById("btn-contraction");
    if (btnContraction) {
      btnContraction.hidden = !(phase.kind === "hold" && phase.countUp);
    }

    const btnReady = document.getElementById("btn-ready");
    if (btnReady) {
      btnReady.hidden = !phase.userTriggered;
    }

    const btnSkipRelax = document.getElementById("btn-skip-relax");
    if (btnSkipRelax) {
      btnSkipRelax.hidden = phase.kind !== "relax";
    }

    const btnPause = document.getElementById("btn-pause");
    if (btnPause) {
      btnPause.textContent = paused ? "Resume" : "Pause";
    }
  }
}

// ─────────────────────────────────────────────
// View: History
// ─────────────────────────────────────────────
function renderHistory(main) {
  const sessions = db.getSessions();

  if (sessions.length === 0) {
    main.innerHTML = `<div class="empty-state">
      <h3>No sessions yet</h3>
      <p>Complete a training session to see your history here.</p>
    </div>`;
    return;
  }

  const rows = sessions
    .map((s) => {
      const badge = s.completed
        ? `<span class="badge-ok">✓ Complete</span>`
        : `<span class="badge-partial">${s.completedRounds}/${s.totalRounds} rounds</span>`;
      return `
      <div class="history-item">
        <div class="history-top">
          <span class="history-name">${s.tableName}</span>
          <span class="history-date">${fmtDate(s.date)}</span>
        </div>
        <div class="history-meta">
          ${badge}
          <span class="dot">·</span>
          ${fmtTime(s.totalDuration)}
          <span class="dot">·</span>
          ${s.tableType.toUpperCase()}
        </div>
      </div>`;
    })
    .join("");

  main.innerHTML = `
    <div class="card">${rows}</div>
    <div class="delete-zone" style="margin-top: 24px">
      <button class="btn btn-danger" id="btn-clear-history">Clear All History</button>
    </div>
    <div class="list-bottom-pad"></div>`;

  document.getElementById("btn-clear-history").addEventListener("click", () => {
    if (
      confirm(
        "Are you sure you want to delete ALL training history? This cannot be undone.",
      )
    ) {
      db.clearSessions();
      renderHistory(main);
    }
  });
}

// ─────────────────────────────────────────────
// View: Settings
// ─────────────────────────────────────────────
function renderSettings(main) {
  main.innerHTML = `
    <div class="card">
      <div class="settings-row">
        <div class="settings-label">
          <div class="settings-title">Audio Cues</div>
          <div class="settings-desc">Audio guidance during sessions</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="toggle-voice" ${settings.voiceEnabled ? "checked" : ""}>
          <span class="slider round"></span>
        </label>
      </div>
      <div class="settings-row" id="audio-mode-row" style="${settings.voiceEnabled ? "" : "display:none"}">
        <div class="settings-label">
          <div class="settings-title">Cue Type</div>
          <div class="settings-desc">Choose between voice and simple beeps</div>
        </div>
        <select class="form-input" id="select-audio-mode" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
          <option value="voice" ${settings.audioMode === "voice" ? "selected" : ""}>Voice</option>
          <option value="beep" ${settings.audioMode === "beep" ? "selected" : ""}>Beep</option>
        </select>
      </div>
      <div class="settings-row" id="voice-gender-row" style="${settings.voiceEnabled && settings.audioMode === "voice" ? "" : "display:none"}">
        <div class="settings-label">
          <div class="settings-title">Voice</div>
          <div class="settings-desc">Spoken voice gender</div>
        </div>
        <select class="form-input" id="select-voice-gender" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
          <option value="female" ${settings.voiceGender === "female" ? "selected" : ""}>Female</option>
          <option value="male" ${settings.voiceGender === "male" ? "selected" : ""}>Male</option>
        </select>
      </div>
      <div class="settings-row" id="countdown-from-row" style="${settings.voiceEnabled ? "" : "display:none"}">
        <div class="settings-label">
          <div class="settings-title">Countdown Start</div>
          <div class="settings-desc">When to begin the final countdown</div>
        </div>
        <select class="form-input" id="select-countdown-from" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
          <option value="3" ${!settings.countdownFrom5 ? "selected" : ""}>3 seconds</option>
          <option value="5" ${settings.countdownFrom5 ? "selected" : ""}>5 seconds</option>
        </select>
      </div>
      <div class="settings-row">
        <div class="settings-label">
          <div class="settings-title">Initial Relaxation</div>
          <div class="settings-desc">Settle in before the first hold</div>
        </div>
        <select class="form-input" id="select-relax-duration" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
          <option value="0" ${settings.relaxationDuration === 0 ? "selected" : ""}>Off</option>
          <option value="30" ${settings.relaxationDuration === 30 ? "selected" : ""}>30 seconds</option>
          <option value="60" ${settings.relaxationDuration === 60 ? "selected" : ""}>1 minute</option>
          <option value="120" ${settings.relaxationDuration === 120 ? "selected" : ""}>2 minutes</option>
          <option value="180" ${settings.relaxationDuration === 180 ? "selected" : ""}>3 minutes</option>
          <option value="300" ${settings.relaxationDuration === 300 ? "selected" : ""}>5 minutes</option>
        </select>
      </div>
      <div class="settings-row" id="relax-sound-row" style="${settings.relaxationDuration > 0 ? "" : "display:none"}">
        <div class="settings-label">
          <div class="settings-title">Relaxation Sound</div>
          <div class="settings-desc">Optional ambient loop during relaxation</div>
        </div>
        <select class="form-input" id="select-relax-sound" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
          <option value="none" ${settings.relaxationSound === "none" ? "selected" : ""}>None</option>
          <option value="rain" ${settings.relaxationSound === "rain" ? "selected" : ""}>Rain</option>
          <option value="waves" ${settings.relaxationSound === "waves" ? "selected" : ""}>Waves</option>
          <option value="forest" ${settings.relaxationSound === "forest" ? "selected" : ""}>Forest</option>
          <option value="campfire" ${settings.relaxationSound === "campfire" ? "selected" : ""}>Campfire</option>
        </select>
      </div>
    </div>

    <div class="delete-zone" style="margin-top: 40px">
      <button class="btn btn-danger" id="btn-delete-all">Delete All Data</button>
      <p class="settings-help">This will permanently delete all your training tables, history, and preferences.</p>
    </div>

    <div class="delete-zone" style="margin-top: 24px">
      <button class="btn btn-secondary" id="btn-reload-assets">Reload App</button>
      <p class="settings-help">Force-download fresh JS, CSS, and audio. Use after updating the app on Safari.</p>
    </div>
  `;

  const updateAudioRowsVisibility = () => {
    const enabled = settings.voiceEnabled;
    document.getElementById("audio-mode-row").style.display = enabled
      ? ""
      : "none";
    document.getElementById("voice-gender-row").style.display =
      enabled && settings.audioMode === "voice" ? "" : "none";
    document.getElementById("countdown-from-row").style.display = enabled
      ? ""
      : "none";
  };

  document.getElementById("toggle-voice").addEventListener("change", (e) => {
    settings.voiceEnabled = e.target.checked;
    updateAudioRowsVisibility();
    updateSoundBtn();
  });

  document
    .getElementById("select-audio-mode")
    .addEventListener("change", (e) => {
      settings.audioMode = e.target.value;
      updateAudioRowsVisibility();
    });

  document
    .getElementById("select-voice-gender")
    .addEventListener("change", (e) => {
      settings.voiceGender = e.target.value;
      loadClips();
      speak("count_321");
    });

  document
    .getElementById("select-countdown-from")
    .addEventListener("change", (e) => {
      settings.countdownFrom5 = e.target.value === "5";
    });

  document
    .getElementById("select-relax-duration")
    .addEventListener("change", (e) => {
      settings.relaxationDuration = parseInt(e.target.value, 10) || 0;
      document.getElementById("relax-sound-row").style.display =
        settings.relaxationDuration > 0 ? "" : "none";
    });

  let _soundPreview = null;
  let _soundPreviewTimer = null;
  document
    .getElementById("select-relax-sound")
    .addEventListener("change", (e) => {
      settings.relaxationSound = e.target.value;
      if (_soundPreview) {
        _soundPreview.pause();
        _soundPreview = null;
      }
      if (_soundPreviewTimer) {
        clearTimeout(_soundPreviewTimer);
        _soundPreviewTimer = null;
      }
      if (settings.relaxationSound === "none") return;
      _soundPreview = new Audio(`audio/sounds/${settings.relaxationSound}.mp3`);
      _soundPreview.volume = 0.4;
      _soundPreview.play().catch(() => {});
      _soundPreviewTimer = setTimeout(() => {
        if (_soundPreview) {
          _soundPreview.pause();
          _soundPreview = null;
        }
      }, 3000);
    });

  document.getElementById("btn-delete-all").addEventListener("click", () => {
    if (
      confirm(
        "Delete ALL data? This will remove all your custom tables, training history, and preferences. This cannot be undone.",
      )
    ) {
      db.clearAllData();
      location.href = location.pathname;
    }
  });

  document.getElementById("btn-reload-assets").addEventListener("click", () => {
    location.href = "?v=" + Date.now();
  });
}

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
function showDisclaimer() {
  if (localStorage.getItem("apnea_disclaimer_accepted") === "true") return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-content">
      <h2>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Safety Warning
      </h2>
      <p>Breath holding exercises carry inherent risks. By using this app, you agree to follow these safety rules:</p>
      <ul>
        <li><strong>Never</strong> train in or near water (pools, tubs, etc.). Shallow water blackout can be fatal.</li>
        <li>Only perform <strong>dry training</strong> on a bed, sofa, or floor.</li>
        <li>Do not train without proper knowledge or certification from a recognized apnea organization.</li>
        <li>Consult a physician before starting any breath-holding practice.</li>
      </ul>
      <button class="btn btn-primary" id="btn-accept-disclaimer">I Understand & Accept</button>
    </div>
  `;
  document.body.appendChild(overlay);

  document
    .getElementById("btn-accept-disclaimer")
    .addEventListener("click", () => {
      localStorage.setItem("apnea_disclaimer_accepted", "true");
      overlay.remove();
    });
}

const SVG_SOUND_ON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
const SVG_SOUND_OFF = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

const btnSound = document.getElementById("btn-sound");
function updateSoundBtn() {
  btnSound.innerHTML = settings.voiceEnabled ? SVG_SOUND_ON : SVG_SOUND_OFF;
  btnSound.style.opacity = settings.voiceEnabled ? "1" : "0.4";
}
btnSound.addEventListener("click", () => {
  settings.voiceEnabled = !settings.voiceEnabled;
  updateSoundBtn();
});
updateSoundBtn();

document
  .getElementById("btn-history")
  .addEventListener("click", () => navigate("history"));
document
  .getElementById("btn-settings")
  .addEventListener("click", () => navigate("settings"));

document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat) return;
  const t = e.target;
  if (
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT"
  )
    return;
  const btnContraction = document.getElementById("btn-contraction");
  const btnReady = document.getElementById("btn-ready");
  const btnDone = document.getElementById("btn-done");
  const btnStart = document.getElementById("btn-start-session");
  if (btnContraction && !btnContraction.hidden) {
    e.preventDefault();
    btnContraction.click();
  } else if (btnReady && !btnReady.hidden) {
    e.preventDefault();
    btnReady.click();
  } else if (btnStart) {
    e.preventDefault();
    btnStart.click();
  } else if (btnDone) {
    e.preventDefault();
    btnDone.click();
  }
});

showDisclaimer();
navigate("tables");
