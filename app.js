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
};

// ─────────────────────────────────────────────
// Audio clips
// ─────────────────────────────────────────────
const audioExt =
  new Audio().canPlayType("audio/webm; codecs=opus") !== "" ? "opus" : "mp3";

const CLIP_KEYS = [
  "ready",
  "prep",
  "rest",
  "after_contraction",
  "one_breath",
  "recovery",
  "complete",
  "tap_contraction",
  "n1",
  "n2",
  "n3",
  "n5",
  "n10",
  ...Array.from({ length: 20 }, (_, i) => `hold_${i + 1}`),
];

const clips = {};
CLIP_KEYS.forEach((key) => {
  const a = new Audio(`audio/${key}.${audioExt}`);
  a.preload = "auto";
  clips[key] = a;
});

let _currentClip = null;

function speak(key, thenKey = null) {
  if (!settings.voiceEnabled) return;
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

    if (type === "wonka") {
      if (p.prepTime > 0)
        phases.push({ kind: "prep", dur: p.prepTime, round: 0 });

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
      // single cooldown after all rounds
      if (p.cooldownTime > 0)
        phases.push({
          kind: "cooldown",
          dur: p.cooldownTime,
          round: p.breathholds,
        });
    } else {
      const rounds = this._buildRounds();
      phases.push({ kind: "ready", dur: 5, round: 0 });

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
        if ([10, 5, 3, 2, 1].includes(t)) speak(`n${t}`);
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
    this._persist(false);
  }

  _complete() {
    clearInterval(this.timer);
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
    const n = ph.round;
    const key = {
      ready: "ready",
      prep: "prep",
      rest: "rest",
      countdown: "after_contraction",
      breath: "one_breath",
      cooldown: "recovery",
    }[ph.kind];
    if (key) {
      speak(key);
      return;
    }
    if (ph.kind === "hold") {
      const holdKey = n >= 1 && n <= 20 ? `hold_${n}` : null;
      if (holdKey) speak(holdKey, ph.countUp ? "tap_contraction" : null);
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

  btnBack.style.visibility = view === "tables" ? "hidden" : "";
  btnBack.style.pointerEvents = view === "tables" ? "none" : "";
  btnHist.style.visibility = view !== "tables" ? "hidden" : "";
  btnHist.style.pointerEvents = view !== "tables" ? "none" : "";

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
      title.textContent = "Session";
      renderSession(main, params.tableId);
      break;
    case "history":
      title.textContent = "History";
      renderHistory(main);
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
      return `${p.breathholds} breathholds · hold after contraction ${fmtTime(p.countdownAfterContraction)}`;
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
      hold: "Hold",
      rest: "Rest",
      countdown: "Hold After Contraction",
      breath: "One Breath",
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
          <label class="form-label">Initial Relaxation</label>
          ${timePairHtml("f-prepTime", p.prepTime ?? 120)}
        </div>
        <div class="form-group">
          <label class="form-label">Hold After 1st Contraction</label>
          ${timePairHtml("f-countdownAfterContraction", p.countdownAfterContraction ?? 30)}
        </div>
        <div class="form-group">
          <label class="form-label">Final Cooldown Time (after last round)</label>
          ${timePairHtml("f-cooldownTime", p.cooldownTime ?? 120)}
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
        prepTime: getTimePair("f-prepTime"),
        countdownAfterContraction: getTimePair("f-countdownAfterContraction"),
        cooldownTime: getTimePair("f-cooldownTime"),
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

  main.innerHTML = `
    <div class="session-wrap">
      <div class="session-round"  id="s-round"></div>
      <div class="session-phase"  id="s-phase"></div>
      <div class="session-timer"  id="s-timer">–:––</div>
      <div class="session-next"   id="s-next"></div>
      <button class="btn-contraction" id="btn-contraction" hidden>First Contraction</button>
      <button class="btn-contraction btn-ready" id="btn-ready" hidden>Ready</button>
      <div class="session-controls">
        <button class="btn btn-secondary" id="btn-pause">Pause</button>
        <button class="btn btn-danger"    id="btn-stop">Stop</button>
      </div>
    </div>`;

  function updateUI({
    phase,
    next,
    timeLeft,
    elapsed,
    completedRounds,
    totalRounds,
    paused,
  }) {
    document.getElementById("s-round").textContent = phase.round
      ? `Round ${phase.round} of ${totalRounds}`
      : "";

    const phaseEl = document.getElementById("s-phase");
    phaseEl.textContent = phaseLabel(phase.kind);
    phaseEl.className = `session-phase ${phaseClass(phase.kind)}`;

    document.getElementById("s-timer").textContent = phase.countUp
      ? fmtTime(elapsed)
      : phase.userTriggered
        ? "–"
        : fmtTime(timeLeft ?? 0);

    document.getElementById("s-next").textContent = nextLabel(next);

    document.getElementById("btn-contraction").hidden = !(
      phase.kind === "hold" && phase.countUp
    );

    document.getElementById("btn-ready").hidden = !phase.userTriggered;

    document.getElementById("btn-pause").textContent = paused
      ? "Resume"
      : "Pause";
  }

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
      if (confirm("Really delete everything?")) {
        db.clearSessions();
        renderHistory(main);
      }
    }
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
  if (btnContraction && !btnContraction.hidden) {
    e.preventDefault();
    btnContraction.click();
  } else if (btnReady && !btnReady.hidden) {
    e.preventDefault();
    btnReady.click();
  } else if (btnDone) {
    e.preventDefault();
    btnDone.click();
  }
});

showDisclaimer();
navigate("tables");
