import { BADGES, CACHE_LINKS, CAMPAIGN, GOALS, PHASES, SOURCES, WEEK_INTENT } from "./data.js";
import {
  STORAGE_KEY,
  adaptSession,
  addDays,
  auditEvent,
  applyFailedTopSet,
  averageGoalProgress,
  campaignContext,
  collectEvidence,
  dateFromISO,
  decodedCache,
  defaultState,
  earnedBadges,
  formatDate,
  formatLoad,
  generateSession,
  goalById,
  goalProgress,
  monthGrid,
  monthLabel,
  moveWorkoutDate,
  normalizeState,
  phaseForWeek,
  readinessMode,
  resetRecommendedPlan,
  restTimerRemaining,
  restoreBackup,
  reviewPayload,
  serializeBackup,
  scheduledDatesForWeek,
  sessionInfoForDate,
  shiftMonth,
  todayISO,
  weekDates,
  weekForDate,
  weeklyGate,
} from "./core.js";

const app = document.querySelector("#app-main");
const dialogs = {
  set: document.querySelector("#set-dialog"),
  exercise: document.querySelector("#exercise-dialog"),
  evidence: document.querySelector("#evidence-dialog"),
  swap: document.querySelector("#swap-dialog"),
  more: document.querySelector("#more-dialog"),
  confirm: document.querySelector("#confirm-dialog"),
  move: document.querySelector("#move-dialog"),
  density: document.querySelector("#density-dialog"),
};

const ACCENTS = {
  incline: "#d6a344",
  ohp: "#d9824b",
  chin: "#58b9cc",
  pullups: "#6ca9da",
  curl: "#9586dc",
  squat: "#60c989",
};

const NAV = [
  { id: "today", label: "Today", icon: "01", mobile: true },
  { id: "calendar", label: "Calendar", icon: "02", mobile: true },
  { id: "goals", label: "Goals", icon: "03", mobile: true },
  { id: "vault", label: "Vault", icon: "04", mobile: true },
  { id: "review", label: "Review", icon: "05", mobile: false },
  { id: "philosophy", label: "Method", icon: "06", mobile: false },
  { id: "settings", label: "Settings", icon: "07", mobile: false },
];

let state = loadState();
let installPrompt = null;
let confirmCallback = null;
let timerInterval = null;

function loadState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return defaultState();
  }
}

function persist({ render = false } = {}) {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateChrome();
  if (render) renderRoute();
}

function h(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uid(prefix = "entry") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function toast(message, type = "") {
  const node = document.createElement("div");
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  document.querySelector("#toast-stack").append(node);
  setTimeout(() => node.remove(), 3600);
}

function route() {
  const raw = location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  return { page: parts[0] || "today", param: parts[1] || null };
}

function navMarkup(mobile = false) {
  const current = route().page;
  const items = mobile ? NAV.filter((item) => item.mobile) : NAV;
  const markup = items.map((item) => `
    <a class="nav-item ${current === item.id ? "active" : ""}" href="#/${item.id}" style="--nav-accent:${item.id === "vault" ? "#d6a344" : "#58b9cc"}">
      <span aria-hidden="true">${item.icon}</span><span>${item.label}</span>
    </a>`).join("");
  if (mobile) {
    return `${markup}<button class="nav-item ${["review", "philosophy", "settings"].includes(current) ? "active" : ""}" type="button" data-open-more><span>••</span><span>More</span></button>`;
  }
  return markup;
}

function updateChrome() {
  document.querySelectorAll("[data-nav]").forEach((node) => {
    node.innerHTML = navMarkup(node.classList.contains("mobile-nav"));
  });
  document.querySelector("#more-nav").innerHTML = NAV.filter((item) => !item.mobile).map((item) => `
    <a class="nav-item" href="#/${item.id}" data-close-more-link><span>${item.icon}</span><span>${item.label}</span></a>`).join("");

  const context = campaignContext(todayISO());
  document.querySelector("#campaign-phase").textContent = context.summit ? "SUMMIT" : context.after ? "CAMPAIGN ARCHIVE" : context.phase.name.toUpperCase();
  document.querySelector("#days-remaining").textContent = context.after ? "LEDGER CLOSED" : `${context.daysRemaining} DAYS`;
  document.querySelector("#rail-week").textContent = context.summit ? "SUMMIT / 04" : `WEEK ${String(context.activeWeek).padStart(2, "0")} / 16`;

  const ticker = GOALS.map((goal) => {
    const progress = goalProgress(goal, state);
    return `<span><b>${h(goal.short)}</b> ${progress.percent}% CLOSED <i>${h(progress.remaining)}</i></span>`;
  }).join("");
  document.querySelector("#ticker-track").innerHTML = ticker + ticker;
}

function isOpen(key, fallback = false) {
  const saved = state.ui.collapsed?.[key];
  return saved === undefined ? fallback : !saved;
}

function ring(percent, label = "GAP CLOSED", accent = "#d6a344") {
  return `<div class="ring" style="--progress:${percent};--accent:${accent}"><div><strong>${percent}%</strong><small>${label}</small></div></div>`;
}

function statusPill(workout) {
  if (!workout || workout.status === "planned") return `<span class="status-pill">PLANNED</span>`;
  if (workout.status === "complete" && workout.approvedModified) return `<span class="status-pill modified">APPROVED MODIFIED</span>`;
  if (workout.status === "complete") return `<span class="status-pill complete">COMPLETE</span>`;
  return `<span class="status-pill">IN PROGRESS</span>`;
}

function renderRoute() {
  updateChrome();
  const current = route();
  if (current.page === "workout") renderWorkout(current.param || todayISO());
  else if (current.page === "calendar") renderCalendar();
  else if (current.page === "goals") renderGoals();
  else if (current.page === "vault") renderVault();
  else if (current.page === "review") renderReview();
  else if (current.page === "philosophy") renderPhilosophy();
  else if (current.page === "settings") renderSettings();
  else renderToday();
  bindDetails();
  requestAnimationFrame(() => app.focus({ preventScroll: true }));
}

function currentCampaignWeek() {
  return campaignContext(todayISO()).activeWeek;
}

function getSession(date) {
  return state.workouts[date] || generateSession(date, state);
}

function exercisePlanText(exercise) {
  const load = exercise.load === 0 ? "BODYWEIGHT" : exercise.load === null || exercise.load === undefined ? "RAMP / CHOOSE" : formatLoad(exercise.load);
  if (exercise.kind === "density") return `${exercise.reps} total / ${exercise.duration} min`;
  return `${exercise.sets} × ${exercise.reps} · ${load}`;
}

function nextScheduledDate(from = todayISO()) {
  for (let offset = 0; offset <= 130; offset += 1) {
    const date = addDays(from, offset);
    if (sessionInfoForDate(date, state)) return date;
  }
  return null;
}

function gateMarkup(gate, compact = false) {
  return `<div class="week-gate">${gate.checks.map((check) => `
    <div class="gate-row">
      <span class="gate-check ${check.pass ? "done" : ""}">${check.pass ? "✓" : "·"}</span>
      <div><b>${h(check.label)}</b>${compact ? "" : `<small>${check.pass ? "Standard met" : "Still required"}</small>`}</div>
      <strong>${h(check.value)}</strong>
    </div>`).join("")}</div>`;
}

function renderToday() {
  const date = todayISO();
  const context = campaignContext(date);
  const week = context.activeWeek;
  const phase = phaseForWeek(week);
  const plannedDate = sessionInfoForDate(date, state) ? date : nextScheduledDate(date);
  const session = plannedDate ? getSession(plannedDate) : null;
  const daily = state.daily[date] || {};
  const gate = weeklyGate(week, state);
  const overall = averageGoalProgress(state);
  const earned = earnedBadges(state).filter((badge) => badge.earned).length;
  const unlocked = Object.values(state.caches).filter((cache) => cache.unlockedAt).length;
  const dateLine = formatDate(date, { weekday: "long", month: "long", year: "numeric" });

  app.innerHTML = `<section class="route">
    <article class="command-card" data-mark="${String(week).padStart(2, "0")}">
      <div>
        <span class="eyebrow">${h(dateLine)} · Week ${week}</span>
        <h1>${context.summit ? "Summit week." : sessionInfoForDate(date, state) ? "The work is ready." : "Recover on purpose."}</h1>
        <p>${context.summit ? "One official attempt per mission. Keep the standards intact." : phase.purpose}</p>
        <div class="mission-row" style="margin-top:1rem">
          <span class="mode-pill">${h(phase.name)}</span>
          <span class="status-pill">${overall}% TOTAL GAP CLOSED</span>
        </div>
      </div>
      <div class="command-side">${ring(overall, "CAMPAIGN")}</div>
    </article>

    <div class="stat-grid">
      <div class="stat"><span>Training week</span><strong>${String(week).padStart(2, "0")}</strong><small>of sixteen</small></div>
      <div class="stat"><span>Outcomes</span><strong>${gate.completed}/4</strong><small>this week</small></div>
      <div class="stat"><span>Badges</span><strong>${earned}</strong><small>of ${BADGES.length} earned</small></div>
      <div class="stat"><span>Caches</span><strong>${unlocked}</strong><small>of sixteen unlocked</small></div>
    </div>

    <div class="dashboard-grid">
      <article class="panel clip today-primary">
        <div class="section-head">
          <div><span class="eyebrow">${plannedDate === date ? "TODAY'S TRAINING" : "NEXT TRAINING"}</span><h2>${session ? h(session.name) : "Campaign complete"}</h2></div>
          ${session ? statusPill(state.workouts[plannedDate]) : ""}
        </div>
        ${session ? `<div class="workout-preview">
          <p class="muted">${h(formatDate(plannedDate, { weekday: "long", month: "long" }))} · ${h(session.focus)}</p>
          <ul class="preview-list">${session.exercises.slice(0, 5).map((exercise) => `<li><div><b>${h(exercise.name)}</b><span>${h(exercise.cue)}</span></div><code>${h(exercisePlanText(exercise))}</code></li>`).join("")}</ul>
          <a class="button primary" href="#/workout/${plannedDate}">${state.workouts[plannedDate]?.status === "active" ? "Resume guided workout" : "Open guided workout"}</a>
        </div>` : `<div class="empty-state"><div><b>The sixteen-week ledger is closed.</b><span>Your history remains on this device.</span></div></div>`}
      </article>

      <article class="panel quick-log">
        <div><span class="eyebrow">DAILY NONNEGOTIABLES</span><h2>Protein + bodyweight</h2><p class="muted">Protein is logged daily. Weight is standardized at least three times each week.</p></div>
        <div class="quick-log-grid">
          <label><span>Protein today (g)</span><input type="number" min="0" max="500" step="1" inputmode="numeric" value="${h(daily.protein ?? "")}" data-daily-field="protein" data-date="${date}" placeholder="${state.settings.proteinTarget}"></label>
          <label><span>Morning weight (lb)</span><input type="number" min="50" max="500" step="0.1" inputmode="decimal" value="${h(daily.weight ?? "")}" data-daily-field="weight" data-date="${date}" placeholder="205.0"></label>
        </div>
        <p class="form-note">Weigh under consistent conditions: after waking and bathroom, before food, in similar clothing.</p>
        <button class="button secondary" type="button" data-save-daily data-date="${date}">Post to ledger</button>
      </article>

      <article class="panel span-two">
        <div class="section-head"><div><span class="eyebrow">WEEK ${week} GATE</span><h2>Earn the cache—do not buy it.</h2></div><a class="button small ghost" href="#/review">Open review</a></div>
        ${gateMarkup(gate, true)}
      </article>
    </div>
  </section>`;
}

function renderCalendar() {
  const selected = state.ui.calendarMonth || CAMPAIGN.start.slice(0, 7);
  const grid = monthGrid(selected);
  const today = todayISO();
  app.innerHTML = `<section class="route">
    <div class="section-head"><div><span class="eyebrow">CAMPAIGN MAP</span><h1>Calendar</h1><p>Every programmed day opens directly into its guided workout. Completed history stays attached to the original plan.</p></div></div>
    <article class="panel calendar-panel">
      <div class="calendar-controls">
        <button class="icon-button" type="button" data-month-shift="-1" aria-label="Previous month">←</button>
        <h1>${h(monthLabel(selected))}</h1>
        <button class="icon-button" type="button" data-month-shift="1" aria-label="Next month">→</button>
      </div>
      <div class="calendar-weekdays" aria-hidden="true">${["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => `<span>${day}</span>`).join("")}</div>
      <div class="calendar-grid">${grid.map((cell) => {
        const info = sessionInfoForDate(cell.date, state);
        const workout = state.workouts[cell.date];
        const completed = workout?.status === "complete";
        const modified = completed && workout.approvedModified;
        const missed = info && cell.date < today && !completed;
        const classes = ["calendar-day", !cell.inMonth && "outside", info && "planned", completed && "completed", modified && "modified", missed && "missed", cell.date === today && "today"].filter(Boolean).join(" ");
        const body = `<strong>${dateFromISO(cell.date).getDate()}</strong>${info ? `<b>${h(info.code)}</b><small>W${info.week}${info.summit ? " · SUMMIT" : ""}</small>` : ""}`;
        return info ? `<button class="${classes}" type="button" data-open-workout="${cell.date}" aria-label="Open ${h(info.name)} on ${h(formatDate(cell.date))}">${body}</button>` : `<div class="${classes}">${body}</div>`;
      }).join("")}</div>
      <div class="calendar-legend"><span><i></i> Planned</span><span><i class="done"></i> Complete</span><span><i class="changed"></i> Approved modified</span><span><i class="miss"></i> Open past date</span></div>
    </article>
    <article class="panel"><span class="eyebrow">FIXED WEEKLY RHYTHM</span><div class="stat-grid" style="margin-top:.7rem">
      <div class="stat"><span>Monday</span><strong>HP</strong><small>Heavy press + medium squat</small></div>
      <div class="stat"><span>Tuesday</span><strong>PULL</strong><small>Heavy weighted pulling</small></div>
      <div class="stat"><span>Thursday</span><strong>SQ</strong><small>Heavy squat + medium press</small></div>
      <div class="stat"><span>Saturday</span><strong>VOL</strong><small>Medium pull + density</small></div>
    </div></article>
  </section>`;
}

function baselineText(goal, baseline) {
  if (!baseline) return "Week 1 assessment required";
  if (goal.type === "endurance") return `${baseline.total} / ${baseline.duration} min · max set ${baseline.maxSet || "—"}`;
  return `${goal.id === "chin" ? "+" : ""}${baseline.load} × ${baseline.reps}${baseline.rpe ? ` @ RPE ${baseline.rpe}` : ""}`;
}

function evidenceText(goal, item) {
  if (goal.type === "endurance") return `${item.total} reps / ${item.duration} min`;
  return `${goal.id === "chin" ? "+" : ""}${item.load} × ${item.reps} @ RPE ${item.rpe || "—"}`;
}

function renderGoals() {
  app.innerHTML = `<section class="route">
    <article class="command-card" data-mark="6">
      <div><span class="eyebrow">SIX GOLD MISSIONS · DECEMBER 31</span><h1>Progress begins at zero.</h1><p>Each dial measures only the portion of the baseline-to-Gold gap you close after the campaign begins. Estimates can move a dial, but only a clean verified performance earns a medal.</p></div>
      <div class="command-side">${ring(averageGoalProgress(state), "TOTAL GAP")}</div>
    </article>
    <div class="goal-grid">${GOALS.map((goal, index) => {
      const result = goalProgress(goal, state);
      const evidence = collectEvidence(state, goal.id).filter((item) => item.id !== result.baseline?.evidenceId).slice(-4).reverse();
      return `<details class="goal-card" style="--accent:${ACCENTS[goal.id]}" data-collapse-key="goal:${goal.id}" ${isOpen(`goal:${goal.id}`, index === 0) ? "open" : ""}>
        <summary>
          ${ring(result.percent, "GAP", ACCENTS[goal.id])}
          <div><span class="eyebrow">MISSION ${String(goal.order).padStart(2, "0")}</span><h2>${h(goal.targetText)}</h2><p>${h(goal.name)}</p></div>
        </summary>
        <div class="goal-body">
          <div class="progress-track" style="--progress:${result.percent}%;--accent:${ACCENTS[goal.id]}"><i></i></div>
          <div class="goal-meta">
            <div><span>Starting line</span><strong>${h(baselineText(goal, result.baseline))}</strong></div>
            <div><span>Gap remaining</span><strong>${h(result.remaining)}</strong></div>
            <div><span>Unclosed percentage</span><strong>${100 - result.percent}% remaining</strong></div>
            <div><span>${goal.type === "endurance" ? "Best sustained evidence" : "Conservative capacity"}</span><strong>${goal.type === "endurance" ? `${result.bestTotal} reps / ${result.bestDuration} min` : `${Math.round(result.bestMetric || 0)} lb e1RM · ~${result.projectedReps || 0} reps at Gold load`}</strong></div>
            ${goal.id === "chin" ? `<div style="grid-column:1/-1"><span>Relative system load</span><strong>${result.relativeStrength.toFixed(2)}× bodyweight now · ${((state.settings.bodyweight + goal.target.load) / state.settings.bodyweight).toFixed(2)}× at Gold</strong></div>` : ""}
          </div>
          <div class="medal-row">${result.medals.map((medal) => `<span class="medal-pill ${medal.tier.toLowerCase()} ${medal.earned ? "earned" : ""}"><b>${medal.earned ? "EARNED" : "LOCKED"} · ${medal.tier}</b>${h(medal.label)}</span>`).join("")}</div>
          <div><span class="eyebrow">THE STANDARD</span><p class="muted">${h(goal.standard)}</p></div>
          <div><span class="eyebrow">WHY THIS CAN MOVE</span><p class="muted">${h(goal.why)}</p><p class="micro">Required change: ${h(goal.deltaText)}.</p></div>
          <div class="evidence-list">${evidence.length ? evidence.map((item) => `<div class="evidence-row"><time>${h(formatDate(item.date))}</time><strong>${h(evidenceText(goal, item))}</strong><small>${h(item.source || "manual")}</small></div>`).join("") : `<div class="empty-state"><div><b>No post-baseline evidence yet.</b><span>The dial correctly remains at 0%.</span></div></div>`}</div>
          <button class="button secondary" type="button" data-log-evidence="${goal.id}">${goal.id === "squat" && !result.baseline ? "Establish squat baseline" : "Log verified attempt"}</button>
        </div>
      </details>`;
    }).join("")}</div>
  </section>`;
}

function renderReadiness(date, session) {
  const saved = state.readiness[date];
  const priorSquat = Object.values(state.workouts).filter((workout) => workout.date < date && workout.exercises?.some((exercise) => exercise.goalId === "squat") && Number.isFinite(Number(workout.nextDayPain))).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const historyWorsening = Number(priorSquat?.nextDayPain) > Number(state.settings.squatPainLimit);
  const mode = session?.readinessMode || readinessMode(saved);
  const sealed = Boolean(state.weeklyReviews?.[weekForDate(date)]?.sealedAt);
  const modeCopy = {
    green: "Full prescription is available. Keep the planned RPE cap.",
    yellow: "The app removed 5% load and one backoff set, with RPE capped at 8.",
    red: "Heavy goal loading is disabled. Complete the approved recovery substitute to protect the streak.",
  };
  return `<article class="panel readiness-card ${mode || ""}">
    <div class="section-head"><div><span class="eyebrow">STEP 1 · READINESS</span><h2>${mode ? `${mode.toUpperCase()} directive` : "Run the four-signal check"}</h2></div>${mode ? `<span class="mode-pill ${mode}">${mode}</span>` : ""}</div>
    <form id="readiness-form" data-date="${date}" data-prior-worsening="${historyWorsening}">
      <div class="readiness-grid">
        ${readinessSelect("sleep", "Sleep quality", saved?.sleep)}
        ${readinessSelect("energy", "Energy", saved?.energy)}
        ${readinessSelect("recovery", "Prior-session recovery", saved?.recovery)}
        <label><span>Joint pain 0–10</span><input name="pain" type="number" min="0" max="10" step="1" required value="${h(saved?.pain ?? "")}" placeholder="0"></label>
        <label class="check-row"><input name="swelling" type="checkbox" ${saved?.swelling ? "checked" : ""}><span><b>New swelling</b><small>Unusual or increasing joint swelling</small></span></label>
        <label class="check-row"><input name="gaitChange" type="checkbox" ${saved?.gaitChange ? "checked" : ""}><span><b>Gait change</b><small>Limp or altered movement today</small></span></label>
        <label class="check-row"><input name="instability" type="checkbox" ${saved?.instability ? "checked" : ""}><span><b>Instability</b><small>Buckling, giving way, or loss of control</small></span></label>
        <label class="check-row"><input name="neurologic" type="checkbox" ${saved?.neurologic ? "checked" : ""}><span><b>Neurologic sign</b><small>New numbness, weakness, or radiating symptoms</small></span></label>
        <label class="check-row"><input name="nextDayWorsening" type="checkbox" ${saved?.nextDayWorsening || historyWorsening ? "checked" : ""} ${historyWorsening ? "disabled" : ""}><span><b>Next-day worsening</b><small>${historyWorsening ? `Auto-detected after ${h(formatDate(priorSquat.date))}` : "Symptoms worsened after the last lower-body exposure"}</small></span></label>
        <label class="check-row"><input name="redFlag" type="checkbox" ${saved?.redFlag ? "checked" : ""}><span><b>Other stop signal</b><small>Sharp pain, illness, or clinician-directed stop</small></span></label>
      </div>
      ${mode ? `<div class="directive"><b>${mode.toUpperCase()} PLAN</b><span>${h(modeCopy[mode])}</span></div>` : ""}
      <div class="readiness-preview"><span><b>GREEN</b> full prescription</span><span><b>YELLOW</b> −5%, one fewer backoff, RPE ≤8</span><span><b>RED</b> no heavy loading; approved substitute counts</span></div>
      <div class="actions" style="margin-top:.8rem"><button class="button ${saved ? "ghost" : "primary"}" type="submit" ${sealed ? "disabled" : ""}>${sealed ? "Week sealed" : saved ? "Re-run readiness + rebuild unstarted plan" : "Set today’s training mode"}</button></div>
    </form>
  </article>`;
}

function readinessSelect(name, label, value) {
  return `<label><span>${label}</span><select name="${name}" required><option value="">Choose</option>${[1, 2, 3, 4, 5].map((score) => `<option value="${score}" ${Number(value) === score ? "selected" : ""}>${score} · ${score === 1 ? "Very poor" : score === 2 ? "Poor" : score === 3 ? "Okay" : score === 4 ? "Good" : "Excellent"}</option>`).join("")}</select></label>`;
}

function setPlanLabel(exercise, set) {
  if (exercise.kind === "density") return `${set.planned.reps} strict reps in ${exercise.duration} min`;
  const load = set.planned.load === 0 ? "bodyweight" : formatLoad(set.planned.load);
  return `${load} × ${set.planned.reps}`;
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function densityElapsed(exercise) {
  const density = exercise.densityState || {};
  const previous = Number(density.elapsedBefore || 0);
  return density.running && density.startedAt ? previous + Math.max(0, (Date.now() - Number(density.startedAt)) / 1000) : previous;
}

function gripCue(minute) {
  return ["PRONATED", "NEUTRAL", "RINGS / FREE"][Math.floor((Math.max(1, minute) - 1) / 5) % 3];
}

function renderDensityConsole(exercise, date, canTrain, editable) {
  const density = exercise.densityState || { minuteLogs: {} };
  const elapsed = Math.min(Number(exercise.duration) * 60, densityElapsed(exercise));
  const currentMinute = Math.min(Number(exercise.duration), Math.max(1, Math.floor(elapsed / 60) + 1));
  const logs = density.minuteLogs || {};
  const total = Object.values(logs).reduce((sum, item) => sum + Number(item.reps || 0), 0);
  const targetPerMinute = Math.max(1, Math.round(Number(exercise.reps) / Number(exercise.duration)));
  const completed = exercise.setsPlan?.[0]?.status === "complete";
  const controlsDisabled = !canTrain || !editable || completed;
  const minutes = Array.from({ length: Number(exercise.duration) }, (_, index) => index + 1);
  return `<div class="density-console" data-density-console data-date="${date}" data-exercise-id="${exercise.id}">
    <div class="density-hero">
      <div><span class="eyebrow">CONTINUOUS BLOCK CLOCK</span><strong data-density-clock>${formatClock(elapsed)}</strong><small>of ${formatClock(Number(exercise.duration) * 60)}</small></div>
      <div class="density-tally"><span>TALLY</span><b data-density-total>${total}</b><small>${targetPerMinute}/min target · minute <i data-density-current>${currentMinute}</i></small></div>
    </div>
    <div class="density-cue"><span>NEXT GRIP CUE</span><strong data-density-grip>${gripCue(currentMinute)}</strong><small>Stop if strict range, grip safety, or elbow/shoulder tolerance fails.</small></div>
    <div class="actions density-actions">
      ${!density.startedAt && !density.elapsedBefore ? `<button class="button primary" type="button" data-density-start="${exercise.id}" data-date="${date}" ${controlsDisabled ? "disabled" : ""}>Start continuous clock</button>` : density.running ? `<button class="button secondary" type="button" data-density-pause="${exercise.id}" data-date="${date}" ${controlsDisabled ? "disabled" : ""}>Pause clock</button>` : `<button class="button secondary" type="button" data-density-resume="${exercise.id}" data-date="${date}" ${controlsDisabled ? "disabled" : ""}>Resume clock</button>`}
      <button class="button ghost" type="button" data-density-minute="${currentMinute}" data-exercise-id="${exercise.id}" data-date="${date}" ${controlsDisabled ? "disabled" : ""}>Log minute ${currentMinute}</button>
      <button class="button ghost" type="button" data-density-finish="${exercise.id}" data-date="${date}" ${controlsDisabled || (!density.startedAt && !density.elapsedBefore) ? "disabled" : ""}>Finish / stop block</button>
    </div>
    <div class="minute-grid" aria-label="Minute-by-minute pull-up log">${minutes.map((minute) => {
      const item = logs[minute];
      return `<button type="button" class="minute-cell ${item ? item.clean === false ? "unclean" : "logged" : ""}" data-density-minute="${minute}" data-exercise-id="${exercise.id}" data-date="${date}" ${!editable || completed ? "disabled" : ""}><span>${minute}</span><b>${item ? item.reps : "·"}</b></button>`;
    }).join("")}</div>
  </div>`;
}

function renderExercise(exercise, index, date, canTrain, editable, firstPending) {
  const complete = exercise.setsPlan.filter((set) => set.status === "complete").length;
  const open = isOpen(`exercise:${date}:${exercise.id}`, exercise.setsPlan.some((set) => set.id === firstPending));
  const densityLike = exercise.goalId === "pullups" && Number(exercise.duration) > 0;
  return `<details class="exercise-card" data-collapse-key="exercise:${date}:${exercise.id}" data-exercise-id="${exercise.id}" ${open ? "open" : ""}>
    <summary><span class="exercise-order">${String(index + 1).padStart(2, "0")}</span><div><h3>${h(exercise.name)}</h3><p>${h(exercisePlanText(exercise))} · target RPE ${exercise.rpe} · <b class="rest-label">REST AFTER SET ${formatClock(exercise.rest)}</b></p></div><span class="status-pill ${complete === exercise.setsPlan.length ? "complete" : ""}">${complete}/${exercise.setsPlan.length}</span></summary>
    <div class="exercise-body">
      <div class="exercise-toolbar">
        <button class="chip-button" type="button" data-edit-exercise="${exercise.id}" data-date="${date}" ${!editable ? "disabled" : ""}>Edit</button>
        <button class="chip-button" type="button" data-move-exercise="${exercise.id}" data-direction="-1" data-date="${date}" ${index === 0 || !editable ? "disabled" : ""}>↑ Move</button>
        <button class="chip-button" type="button" data-move-exercise="${exercise.id}" data-direction="1" data-date="${date}" ${!editable ? "disabled" : ""}>↓ Move</button>
        <button class="chip-button" type="button" data-add-set="${exercise.id}" data-date="${date}" ${!editable || densityLike || exercise.lockedAfterMiss ? "disabled" : ""}>+ Set</button>
        <button class="chip-button" type="button" data-remove-set="${exercise.id}" data-date="${date}" ${!editable || densityLike ? "disabled" : ""}>− Set</button>
        <button class="chip-button danger-text" type="button" data-delete-exercise="${exercise.id}" data-date="${date}" ${!editable ? "disabled" : ""}>Delete</button>
      </div>
      <div class="cue"><b>TECHNIQUE</b> · ${h(exercise.cue)}</div>
      ${densityLike ? renderDensityConsole(exercise, date, canTrain, editable) : `<div class="set-list">${exercise.setsPlan.map((set) => {
        const actual = set.actual;
        const action = set.status === "pending" ? "data-start-set" : "data-log-set";
        const actionCopy = set.status === "pending" ? "START →" : set.status === "active" ? "LOG SET →" : set.status === "skipped" ? "REOPEN →" : "EDIT RESULT";
        return `<button class="set-row ${set.status} ${set.id === firstPending ? "active" : ""}" type="button" ${action} data-date="${date}" data-exercise-id="${exercise.id}" data-set-id="${set.id}" ${!canTrain || !editable ? "disabled" : ""}>
          <span class="set-state">${set.status === "complete" ? "✓" : set.status === "skipped" ? "—" : set.index}</span>
          <span class="set-plan"><b>${h(setPlanLabel(exercise, set))}</b><small>RPE ${set.planned.rpe} · rest after ${formatClock(set.planned.rest)}</small></span>
          <span class="set-actual">${actual?.reps !== undefined ? `${actual.load === 0 ? "BW" : `${actual.load} lb`} × ${actual.reps}<br>RPE ${actual.rpe}` : actionCopy}</span>
        </button>`;
      }).join("")}</div>`}
    </div>
  </details>`;
}

function renderWorkout(date) {
  const info = sessionInfoForDate(date, state);
  if (!info) {
    app.innerHTML = `<section class="route"><a class="route-back" href="#/calendar">← Calendar</a><div class="empty-state"><div><b>No workout is planned for ${h(formatDate(date))}.</b><span>Recovery days stay clear by design.</span></div></div></section>`;
    return;
  }
  const session = getSession(date);
  const readiness = state.readiness[date];
  const weekSealed = Boolean(state.weeklyReviews?.[session.week]?.sealedAt);
  const editable = session.status !== "complete" && !weekSealed;
  const canTrain = Boolean(readiness) && editable;
  const allSets = session.exercises.flatMap((exercise) => exercise.setsPlan.map((set) => ({ exercise, set })));
  const firstPending = (allSets.find(({ set }) => set.status === "active") || allSets.find(({ set }) => set.status === "pending"))?.set.id;
  const completeSets = allSets.filter(({ set }) => set.status === "complete").length;
  const steps = ["Readiness", "Warm-up", "Main work", "Accessories", "Finish"];
  const stepIndex = !readiness ? 0 : completeSets === 0 ? 1 : session.status === "complete" ? 4 : completeSets < Math.max(2, allSets.length * 0.55) ? 2 : 3;
  const phase = phaseForWeek(session.week);
  app.innerHTML = `<section class="route">
    <article class="panel workout-head" data-week="${session.summit ? "S" : String(session.week).padStart(2, "0")}">
      <a class="route-back" href="#/calendar">← Campaign calendar</a>
      <div class="workout-title-row"><div><span class="eyebrow">${h(formatDate(date, { weekday: "long", month: "long", year: true }))} · ${h(phase.name)}</span><h1>${h(session.name)}</h1><p class="muted">${h(session.focus)}</p>${session.movedFrom ? `<p class="form-note">Moved from ${h(formatDate(session.movedFrom, { weekday: "long", month: "long" }))}; plan identity preserved.</p>` : ""}</div>${statusPill(session)}</div>
      <div class="session-duration"><span>FULL SESSION ESTIMATE</span><strong>${h(session.duration || "60–90 min")}</strong><small>Individual 04:00 labels below mean rest after a heavy set—not workout length.</small></div>
      <div class="workout-steps">${steps.map((step, index) => `<span class="workout-step ${index === stepIndex ? "active" : ""} ${index < stepIndex || session.status === "complete" ? "done" : ""}">${index + 1} · ${step}</span>`).join("")}</div>
      <div class="actions workout-controls">
        <button class="button small ghost" type="button" data-move-workout="${date}" ${!editable || session.summit ? "disabled" : ""}>${session.summit ? "Summit date fixed" : "Move this workout"}</button>
        <button class="button small ghost" type="button" data-reset-recommended="${date}" ${!editable ? "disabled" : ""}>Reset future to recommended</button>
        ${session.status === "complete" && !weekSealed ? `<button class="button small secondary" type="button" data-reopen-workout="${date}">Reopen workout</button>` : ""}
      </div>
    </article>

    ${renderReadiness(date, session)}
    ${session.directive ? `<div class="directive ${session.readinessMode || ""}"><b>NONNEGOTIABLE AUTO-PLAN</b><span>${h(session.directive)}</span></div>` : ""}

    <div class="workout-layout">
      <div class="exercise-stack">
        ${!readiness && !weekSealed ? `<div class="panel"><p class="muted" style="margin:0">Complete readiness first. Your prescribed plan is visible, but set starts remain locked until the Green, Yellow, or Red directive is set.</p></div>` : ""}
        ${weekSealed ? `<div class="panel"><p class="muted" style="margin:0">This week is sealed. Reopen it from Weekly Review before changing history.</p></div>` : ""}
        ${session.exercises.map((exercise, index) => renderExercise(exercise, index, date, canTrain, editable, firstPending)).join("")}
        <button class="button ghost" type="button" data-add-exercise data-date="${date}" ${!editable ? "disabled" : ""}>+ Add exercise to this workout</button>
      </div>
      <aside class="workout-sidebar">
        <article class="panel workout-finish">
          <div><span class="eyebrow">FINISH THE ENTRY</span><h2>${session.status === "complete" ? "Workout sealed" : "Close the loop"}</h2><p class="muted">A scheduled outcome counts only when the session is finished and main work—or the Red substitute—is logged.</p></div>
          <div class="stat-grid">
            <div class="stat"><span>Sets done</span><strong>${completeSets}</strong><small>of ${allSets.length}</small></div>
            <div class="stat"><span>Mode</span><strong>${session.readinessMode?.slice(0, 1).toUpperCase() || "—"}</strong><small>${session.readinessMode || "readiness open"}</small></div>
          </div>
          <div class="planned-actual"><div><span>PLANNED</span><strong>${allSets.length} sets · ${h(session.duration || "session")}</strong></div><div><span>PERFORMED</span><strong>${completeSets} complete · ${allSets.filter(({ set }) => set.status === "skipped").length} skipped</strong></div></div>
          <div class="finish-grid">
            <label><span>Post pain 0–10</span><input id="post-pain" type="number" min="0" max="10" step="1" value="${h(session.postPain ?? "")}" ${weekSealed ? "disabled" : ""}></label>
            <label><span>Next-day pain 0–10</span><input id="next-day-pain" type="number" min="0" max="10" step="1" value="${h(session.nextDayPain ?? "")}" placeholder="Update tomorrow" ${weekSealed ? "disabled" : ""}></label>
          </div>
          ${session.backoffTriggered ? `<label class="check-row"><input id="backoff-obeyed" type="checkbox" ${session.backoffObeyed ? "checked" : ""}><span><b>I obeyed the backoff</b><small>No retry; reduced load; no more than two clean backoff sets</small></span></label>` : ""}
          <button class="button primary" type="button" data-finish-workout="${date}" ${!canTrain || session.status === "complete" ? "disabled" : ""}>${session.status === "complete" ? "Workout complete" : "Finish scheduled outcome"}</button>
          ${session.status === "complete" ? `<button class="button ghost" type="button" data-save-followup="${date}" ${weekSealed ? "disabled" : ""}>Save symptom follow-up</button>` : ""}
          ${session.status === "complete" ? `<p class="form-note">Completed ${h(new Date(session.completedAt).toLocaleString())}. Planned and performed data are preserved.</p>` : ""}
        </article>
      </aside>
    </div>
  </section>`;
}

function rewardArtwork(week, title) {
  const group = [1, 8, 14, 16].includes(week) ? "TRAIL" : [3, 4, 6].includes(week) ? "SLEEP" : [10, 15].includes(week) ? "LIFE" : [11, 13].includes(week) ? "REC" : week === 5 ? "FUEL" : week === 12 ? "CAREER" : "GEAR";
  const art = {
    TRAIL: '<path d="M12 62c18-3 26-22 32-40 10 18 19 30 40 40v10H12z"/><path d="M16 75h64"/>',
    SLEEP: '<path d="M65 18a28 28 0 1 0 11 50A32 32 0 1 1 65 18z"/><path d="M25 24h12M31 18v12"/>',
    LIFE: '<path d="M14 45 48 17l34 28v34H14z"/><path d="M38 79V56h20v23"/>',
    REC: '<path d="M11 51c9-25 17 25 27 0s18 25 28 0 18 0 18 0"/><circle cx="48" cy="28" r="10"/>',
    FUEL: '<path d="M24 16v64M16 16v22c0 9 16 9 16 0V16M65 16v64M65 16c20 12 18 31 0 34"/>',
    CAREER: '<path d="M14 24h68v54H14z"/><path d="M33 24v-8h30v8M14 46h68M43 43h10v7H43z"/>',
    GEAR: '<circle cx="48" cy="48" r="25"/><circle cx="48" cy="48" r="9"/><path d="M48 11v12M48 73v12M11 48h12M73 48h12"/>',
  }[group];
  return `<svg class="reward-art" viewBox="0 0 96 96" role="img" aria-label="${h(title)} illustration"><title>${h(title)}</title><g>${art}</g><text x="48" y="92">W${String(week).padStart(2, "0")}</text></svg>`;
}

function renderVault() {
  const badges = earnedBadges(state);
  const earnedCount = badges.filter((badge) => badge.earned).length;
  const banked = Object.entries(state.caches).filter(([, cache]) => cache.status === "banked").reduce((sum, [week]) => sum + decodedCache(Number(week)).value, 0);
  const claimed = Object.entries(state.caches).filter(([, cache]) => cache.status === "claimed").reduce((sum, [week]) => sum + decodedCache(Number(week)).value, 0);
  app.innerHTML = `<section class="route">
    <article class="command-card" data-mark="$">
      <div><span class="eyebrow">THE SIXTEEN CACHES · $${state.settings.vaultCap} DEFAULT CAP</span><h1>Earn first. Reveal second.</h1><p>One recovery- or life-improving reward is sealed inside each week. Missed caches remain recoverable. Medical needs are never rewards and are never gated.</p></div>
      <div class="command-side stat-grid"><div class="stat"><span>Banked</span><strong>$${banked}</strong><small>house fund</small></div><div class="stat"><span>Claimed</span><strong>$${claimed}</strong><small>chosen rewards</small></div></div>
    </article>
    <div class="cache-grid">${Array.from({ length: 16 }, (_, index) => {
      const week = index + 1;
      const gate = weeklyGate(week, state);
      const saved = state.caches[week] || {};
      const unlocked = saved.unlockValid !== false && Boolean(saved.unlockedAt || gate.complete);
      const reward = unlocked ? decodedCache(week) : null;
      const link = unlocked ? CACHE_LINKS[week] : null;
      const title = saved.swap?.title || reward?.title;
      const reason = saved.swap?.reason || reward?.reason;
      const statusClass = saved.status || (unlocked ? "unlocked" : "locked");
      return `<article class="cache-card ${statusClass}" data-week="${String(week).padStart(2, "0")}">
        <div class="cache-top"><span class="cache-lock">${unlocked ? "OPEN" : "LOCK"}</span><span class="eyebrow">WEEK ${String(week).padStart(2, "0")}</span></div>
        ${unlocked ? `<div class="reward-reveal">${rewardArtwork(week, title)}<div><span class="cache-value">$${reward.value}</span><h3>${h(title)}</h3><p>${h(reason)}</p></div></div>
          <div class="reward-check"><b>UNLOCK-TIME CHECK</b><span>${h(link.check)}</span><a href="${h(link.url)}" target="_blank" rel="noreferrer">${h(link.label)} ↗</a></div>
          <div class="actions"><button class="button small primary" type="button" data-cache-action="claimed" data-week="${week}" ${saved.status ? "disabled" : ""}>Claim</button><button class="button small secondary" type="button" data-cache-action="banked" data-week="${week}" ${saved.status ? "disabled" : ""}>Bank</button><button class="button small ghost" type="button" data-swap-cache="${week}" ${saved.status ? "disabled" : ""}>Swap</button></div>
          ${saved.status ? `<span class="status-pill ${saved.status === "claimed" ? "complete" : "modified"}">${saved.status.toUpperCase()}</span>` : ""}` : `<div><h3>Sealed cache</h3><p>Exact reward hidden until every weekly standard is met and the review is sealed.</p></div>${gateMarkup({ checks: gate.checks.slice(0, 3) }, true)}`}
        <div class="cache-progress"><div class="progress-track" style="--progress:${gate.checks.filter((check) => check.pass).length / gate.checks.length * 100}%"><i></i></div></div>
      </article>`;
    }).join("")}</div>
    <article class="panel"><span class="eyebrow">RECOVERY RULE</span><p class="muted" style="margin:0">A missed week does not destroy its cache. Complete every missing gate and seal that exact week later to recover it. Claim it, bank it toward the house fund, or swap it for an equal-value reward. Current price, fit, terms, and clinical suitability are checked only after reveal.</p></article>
    <div class="section-head"><div><span class="eyebrow">BADGE WALL</span><h1>${earnedCount} / ${badges.length} earned</h1><p>Every badge begins locked. Baseline numbers never award hardware.</p></div></div>
    <div class="badge-grid">${badges.map((badge) => `<article class="badge-card ${badge.earned ? "earned" : ""}"><span class="badge-icon"><span>${h(badge.icon)}</span></span><div><b>${h(badge.name)}</b><small>${badge.earned ? `Earned ${formatDate(badge.earnedAt)}` : h(badge.description)}</small></div></article>`).join("")}</div>
  </section>`;
}

function renderReview() {
  const week = Number(state.ui.reviewWeek || currentCampaignWeek());
  const gate = weeklyGate(week, state);
  const review = state.weeklyReviews[week] || {};
  const payload = review.snapshot || reviewPayload(week, state);
  payload.sessions ||= [];
  payload.topSets ||= [];
  payload.pullup ||= { total: 0, longestProvenMinutes: 0, bestPace: 0 };
  payload.audit ||= [];
  payload.phase ||= { current: phaseForWeek(week).name, next: phaseForWeek(Math.min(16, week + 1)).name, nextIntent: WEEK_INTENT[Math.min(15, week)].label };
  const trend = payload.compliance.weightTrend;
  app.innerHTML = `<section class="route">
    <div class="review-selector panel"><button class="icon-button" type="button" data-review-shift="-1" ${week <= 1 ? "disabled" : ""}>←</button><div><span class="eyebrow">AUTO-GENERATED REVIEW</span><h2>Week ${week} · ${h(phaseForWeek(week).name)}</h2></div><button class="icon-button" type="button" data-review-shift="1" ${week >= 16 ? "disabled" : ""}>→</button></div>
    <article class="review-card">
      <div class="review-summary">
        <div class="review-metric"><span>Workouts</span><strong>${gate.completed}/4</strong></div>
        <div class="review-metric"><span>Protein</span><strong>${gate.proteinAverage}g</strong></div>
        <div class="review-metric"><span>Weight avg</span><strong>${gate.weighIns.length ? `${gate.weightAverage.toFixed(1)} lb` : "—"}</strong><small>${trend === null || trend === undefined ? "trend pending" : `${trend >= 0 ? "+" : ""}${Number(trend).toFixed(1)} vs prior`}</small></div>
        <div class="review-metric"><span>Ledger</span><strong>${gate.sealed ? "SEALED" : "OPEN"}</strong></div>
      </div>
      <div class="review-copy">${h(payload.narrative)}</div>
      ${review.snapshot ? `<span class="status-pill complete">IMMUTABLE SNAPSHOT · ${h(new Date(review.sealedAt).toLocaleString())}</span>` : ""}
    </article>
    <div class="two-column">
      <article class="panel">
        <span class="eyebrow">PLANNED VS ACTUAL</span><h2>Four scheduled outcomes</h2>
        <div class="outcome-list">${payload.sessions.map((session) => `<div class="outcome-row"><div><b>${h(formatDate(session.date))}</b><small>${h(session.name)}</small></div><span class="status-pill ${session.outcome === "full" ? "complete" : session.outcome === "modified" ? "modified" : ""}">${h(session.outcome)}</span><small>${h(session.readiness || "—")} · pain ${h(session.postPain ?? "—")} / next ${h(session.nextDayPain ?? "—")}</small></div>`).join("")}</div>
      </article>
      <article class="panel">
        <span class="eyebrow">HEADLINE PERFORMANCE</span><h2>Top sets + proven density</h2>
        <div class="outcome-list">${payload.topSets.length ? payload.topSets.map((set) => `<div class="outcome-row"><div><b>${h(set.exercise)}</b><small>${h(formatDate(set.date))}</small></div><strong class="mono">${set.goalId === "pullups" ? `${set.actual.reps} / ${set.duration} min` : `${set.actual.load} × ${set.actual.reps}`}</strong><small>RPE ${h(set.actual.rpe)} · pain ${h(set.actual.pain)} · ${set.actual.clean ? "clean" : "not clean"}${set.e1rm ? ` · e1RM ${set.e1rm}${set.e1rmBasis ? ` (${h(set.e1rmBasis)})` : ""}` : ""}</small></div>`).join("") : `<div class="empty-state compact"><div><b>No headline sets logged.</b><span>They appear automatically as workouts pile up.</span></div></div>`}</div>
        <div class="pull-proof"><span>PULL-UP PROOF</span><strong>${payload.pullup.total} reps · ${payload.pullup.longestProvenMinutes} min · ${Number(payload.pullup.bestPace).toFixed(1)}/min</strong></div>
      </article>
    </div>
    <article class="panel">
      <div class="section-head"><div><span class="eyebrow">SIXFOLD MOVEMENT</span><h2>Gap closed + work remaining</h2></div><span class="mode-pill">${h(payload.phase.current)}</span></div>
      <div class="review-goals">${payload.goalProgress.map((goal) => `<div><span>${h(goal.name)}</span><b>${goal.percent}% closed</b><div class="progress-track" style="--progress:${goal.percent}%"><i></i></div><small>${h(goal.remaining)}</small></div>`).join("")}</div>
      <div class="next-decision"><b>NEXT WEEK · ${h(payload.nextWeek.intent)}</b><span>${h(payload.nextWeek.phase)}. ${h(review.nextAction || "Use this week’s data and readiness to choose the exact loads.")}</span></div>
    </article>
    <div class="two-column">
      <article class="panel">
        <span class="eyebrow">DAILY RECOVERY LEDGER</span><h2>Seven entries. Three weigh-ins.</h2>
        <div class="week-gate daily-ledger">${weekDates(week).map((date) => `<div class="daily-row"><div><b>${h(formatDate(date, { weekday: "short", month: "short" }))}</b><small>${date}</small></div><label><span>Protein g</span><input type="number" min="0" max="500" value="${h(state.daily[date]?.protein ?? "")}" data-week-daily="protein" data-date="${date}"></label><label><span>Weight lb</span><input type="number" min="50" max="500" step="0.1" value="${h(state.daily[date]?.weight ?? "")}" data-week-daily="weight" data-date="${date}"></label></div>`).join("")}</div>
      </article>
      <article class="panel">
        <span class="eyebrow">WEEKLY GATE</span><h2>All standards required.</h2>${gateMarkup(gate)}
      </article>
    </div>
    <article class="panel">
      <form id="review-form" data-week="${week}">
        <span class="eyebrow">HUMAN JUDGMENT</span><h2>The app writes the numbers. You write the lesson.</h2>
        <div class="form-grid two">
          <label><span>Biggest win</span><textarea name="win" ${gate.sealed ? "disabled" : ""}>${h(review.win || "")}</textarea></label>
          <label><span>What needs adjustment</span><textarea name="lesson" ${gate.sealed ? "disabled" : ""}>${h(review.lesson || "")}</textarea></label>
          <label class="span-two"><span>One action for next week</span><input name="nextAction" value="${h(review.nextAction || "")}" ${gate.sealed ? "disabled" : ""}></label>
        </div>
        <label class="check-row"><input name="backoffConfirmed" type="checkbox" ${review.backoffConfirmed ? "checked" : ""} ${gate.sealed ? "disabled" : ""}><span><b>Backoff protocol obeyed</b><small>I did not retry failed top sets; prescribed reductions and pain limits were followed.</small></span></label>
        <div class="actions" style="margin-top:.8rem">
          <button class="button ghost" type="submit" ${gate.sealed ? "disabled" : ""}>Save review</button>
          <button class="button primary" type="button" data-seal-review="${week}" ${gate.sealed || !gate.eligibleToSeal ? "disabled" : ""}>${gate.sealed ? "Review sealed" : "Seal review + open cache"}</button>
          ${gate.sealed ? `<button class="button danger ghost" type="button" data-reopen-week="${week}">Reopen week + recalculate rewards</button>` : ""}
          <button class="button secondary" type="button" data-export-review="${week}">Export JSON for Project 52</button>
          <button class="button ghost" type="button" data-copy-review="${week}">Copy summary</button>
        </div>
        ${!gate.eligibleToSeal && !gate.sealed ? `<p class="form-note">Complete every open gate above. Save the backoff confirmation before sealing.</p>` : ""}
      </form>
    </article>
    ${payload.audit?.length ? `<article class="panel"><span class="eyebrow">AUDIT TRAIL</span><div class="audit-list">${payload.audit.slice(-12).reverse().map((entry) => `<div><time>${h(new Date(entry.at).toLocaleString())}</time><strong>${h(entry.type.replaceAll("-", " "))}</strong></div>`).join("")}</div></article>` : ""}
  </section>`;
}

function renderPhilosophy() {
  app.innerHTML = `<section class="route">
    <article class="command-card" data-mark="Φ"><div><span class="eyebrow">PROGRAM PHILOSOPHY</span><h1>Specific. Autoregulated. Recoverable.</h1><p>This is a high-ambition sixteen-week campaign, not a promise of six PRs. The plan raises the probability of progress while protecting the standards that make each goal legitimate.</p></div><div class="command-side"><span class="mode-pill yellow">Stretch targets</span></div></article>
    <div class="philosophy-grid">
      <article class="panel principle"><h2>Specificity + two exposures</h2><p>Each press and pull pattern receives a heavy, lower-volume exposure and a medium-load, higher-volume exposure. Squat gets both a tolerance exposure and a heavier practice day.</p></article>
      <article class="panel principle"><h2>RPE-based autoregulation</h2><p>Planned loads are starting points. Green, Yellow, and Red decisions convert readiness into a real change in load and volume before the first work set.</p></article>
      <article class="panel principle"><h2>Fatigue is managed</h2><p>Weeks 4, 8, and 12 deload. Weeks 15–16 taper. Missed top sets cannot be retried; the app automatically reduces backoff work.</p></article>
      <article class="panel principle"><h2>Performance stays honest</h2><p>Estimates can move progress dials, but medals require the actual load, reps, duration, technique, and pain standard. Ten minutes is never extrapolated into an hour medal.</p></article>
    </div>
    <article class="panel"><span class="eyebrow">THE SIXTEEN-WEEK ARC</span><div class="phase-strip" style="margin-top:.8rem">${PHASES.map((phase) => `<div class="phase-cell ${phase.weeks.includes(currentCampaignWeek()) ? "active" : ""}"><b>${h(phase.name)}</b><br>W${phase.weeks.join("–")}</div>`).join("")}</div><div class="preview-list" style="margin-top:.8rem">${WEEK_INTENT.map((item) => `<li><div><b>Week ${item.week} · ${h(item.label)}</b><span>${h(phaseForWeek(item.week).purpose)}</span></div><code>${Math.round(item.volume * 100)}% VOL</code></li>`).join("")}</div></article>
    <article class="panel"><span class="eyebrow">MISSION LOGIC + REQUIRED CHANGE</span><div class="goal-grid" style="margin-top:.8rem">${GOALS.map((goal) => `<div class="goal-meta"><div><span>${h(goal.name)}</span><strong>${h(goal.targetText)}</strong></div><div><span>Gap</span><strong>${h(goal.deltaText)}</strong></div><div style="grid-column:1/-1"><span>Programming reason</span><strong>${h(goal.why)}</strong></div></div>`).join("")}</div></article>
    <article class="panel"><span class="eyebrow">NONNEGOTIABLE BACKOFF PLAN</span><h2>The rule exists before the miss.</h2><div class="preview-list">
      <li><div><b>Yellow day</b><span>Reduce working loads 5%, remove one backoff set, cap RPE at 7–8.</span></div><code>−5%</code></li>
      <li><div><b>Red day</b><span>No heavy goal loading. Approved recovery or rehab substitute counts.</span></div><code>RECOVER</code></li>
      <li><div><b>Failed top set</b><span>No retry. Reduce 7.5–10% and perform no more than two clean backoffs.</span></div><code>NO RETRY</code></li>
      <li><div><b>Two consecutive misses</b><span>Reduce the next training max 5–7.5% and rebuild with clean reps.</span></div><code>RESET</code></li>
      <li><div><b>Squat symptoms</b><span>Clinician guidance and the pain ceiling override every load target and reward.</span></div><code>SAFETY</code></li>
    </div></article>
    <article class="panel"><span class="eyebrow">EVIDENCE BASE</span><h2>Primary research and professional guidance</h2><ul class="source-list">${SOURCES.map((source) => `<li><a href="${source.url}" target="_blank" rel="noreferrer">${h(source.title)}</a> — ${h(source.note)}</li>`).join("")}</ul><p class="form-note" style="margin-top:1rem">This app is training organization, not medical diagnosis or treatment. Pain, instability, neurologic symptoms, chest pain, or unexpected shortness of breath require appropriate clinical judgment. The Altra shortlist is not a promise of fit or a nurse discount; current brand terms govern eligibility.</p></article>
  </section>`;
}

function renderSettings() {
  app.innerHTML = `<section class="route">
    <div class="section-head"><div><span class="eyebrow">LOCAL CONTROL</span><h1>Settings</h1><p>Your ledger stays in this browser unless you export it. Back it up before changing phones or clearing site data.</p></div></div>
    <div class="settings-grid">
      <article class="panel settings-card">
        <span class="eyebrow">NONNEGOTIABLE GUARDRAILS</span><h2>Recovery settings</h2>
        <form id="settings-form">
          <div class="setting-row"><label><span>Daily protein target (g)</span><input name="proteinTarget" type="number" min="50" max="350" value="${state.settings.proteinTarget}" required></label><p>Weekly cache requires seven entries and an average at or above this floor.</p></div>
          <div class="setting-row"><label><span>Squat pain ceiling (0–10)</span><input name="squatPainLimit" type="number" min="0" max="5" value="${state.settings.squatPainLimit}" required></label><p>Only change this with appropriate clinician guidance.</p></div>
          <div class="setting-row"><label><span>Reference bodyweight (lb)</span><input name="bodyweight" type="number" min="50" max="500" step="0.1" value="${state.settings.bodyweight}" required></label><p>Used for weighted-chin relative strength estimates when no same-day weigh-in exists.</p></div>
          <div class="setting-row"><label><span>Sixteen-cache spending cap ($)</span><input name="vaultCap" type="number" min="0" max="10000" step="25" value="${state.settings.vaultCap}" required></label><p>The built-in cache values total $1,000. Swaps must stay within each unlocked value.</p></div>
          <label class="check-row"><input name="timerVibrate" type="checkbox" ${state.settings.timerVibrate ? "checked" : ""}><span><b>Vibrate when rest ends</b><small>Subject to device and browser support</small></span></label>
          <button class="button primary" type="submit" style="margin-top:.8rem">Save settings</button>
        </form>
      </article>
      <article class="panel settings-card">
        <span class="eyebrow">INSTALL + DATA</span><h2>Own the ledger</h2>
        <div class="setting-row"><b>Install as an app</b><p>Add SIXFOLD to the home screen for a full-screen, offline-capable experience.</p><button class="button secondary" type="button" data-install>Install / show instructions</button></div>
        <div class="setting-row"><b>Backup</b><p>Downloads workouts, evidence, settings, reviews, and cache decisions as one JSON file.</p><button class="button ghost" type="button" data-backup>Download full backup</button></div>
        <div class="setting-row"><b>Restore</b><p>Restoring replaces this browser’s current ledger after validation.</p><button class="button ghost" type="button" data-restore>Choose backup file</button></div>
        <div class="setting-row"><b>Reset campaign</b><p>Returns every dial and badge to zero/locked. Export a backup first.</p><button class="button danger" type="button" data-reset>Reset all local data</button></div>
      </article>
    </div>
    <article class="panel"><span class="eyebrow">MISSION STANDARDS LOCKED</span><p class="muted">Ordinary workout edits cannot change the six medal definitions, target date, strict technique rules, or baseline-to-Gold scoring. That keeps the hardware legitimate while letting you adapt the route.</p></article>
    <article class="panel"><span class="eyebrow">PRIVACY + REWARD SECRECY</span><p class="muted">No account or server is required; the standalone app stores entries locally on this device. That means clearing browser data can erase them. Reward descriptions are hidden in the normal interface until earned, but a determined person can inspect any purely static site’s source. True cryptographic secrecy would require a small authenticated backend.</p></article>
  </section>`;
}

function bindDetails() {
  document.querySelectorAll("details[data-collapse-key]").forEach((details) => {
    details.addEventListener("toggle", () => {
      state.ui.collapsed[details.dataset.collapseKey] = !details.open;
      persist();
    });
  });
}

function ensureWorkout(date, mode = undefined) {
  if (!state.workouts[date]) state.workouts[date] = generateSession(date, state, mode);
  return state.workouts[date];
}

function rebuildUnstartedSession(date, mode) {
  const existing = state.workouts[date];
  const fresh = generateSession(date, state, mode);
  if (!existing) return fresh;
  const hasCompleted = existing.exercises?.some((exercise) => exercise.setsPlan?.some((set) => set.status !== "pending"));
  if (!hasCompleted) return { ...fresh, status: existing.status, startedAt: existing.startedAt };
  // Preserve performed work; adjust only untouched exercises and sets.
  const adapted = adaptSession(existing, mode);
  adapted.exercises = adapted.exercises.map((exercise) => {
    const old = existing.exercises.find((item) => item.id === exercise.id);
    if (!old) return exercise;
    const hasHistory = old.setsPlan.some((set) => set.status !== "pending");
    return hasHistory ? old : exercise;
  });
  return adapted;
}

function startSet(date, exerciseId, setId) {
  const session = ensureWorkout(date);
  if (!state.readiness[date]) return toast("Run readiness before starting a set.", "error");
  if (session.status === "complete" || state.weeklyReviews?.[session.week]?.sealedAt) return toast("Reopen this entry before changing it.", "error");
  const active = session.exercises.flatMap((exercise) => exercise.setsPlan).find((set) => set.status === "active" && set.id !== setId);
  if (active) return toast("Log or skip the active set before starting another.", "error");
  const set = session.exercises.find((item) => item.id === exerciseId)?.setsPlan.find((item) => item.id === setId);
  if (!set || set.status !== "pending") return;
  set.status = "active";
  set.startedAt = new Date().toISOString();
  session.activeSet = { exerciseId, setId };
  session.status = "active";
  session.startedAt ||= set.startedAt;
  state.workouts[date] = session;
  state.restTimer = null;
  auditEvent(state, "set-started", { date, week: session.week, exerciseId, setId });
  persist({ render: true });
  toast("Set started. Tap LOG SET when the reps are done.", "success");
}

function openSetDialog(date, exerciseId, setId) {
  const session = ensureWorkout(date);
  const exercise = session.exercises.find((item) => item.id === exerciseId);
  const set = exercise?.setsPlan.find((item) => item.id === setId);
  if (!exercise || !set) return;
  document.querySelector("#set-date").value = date;
  document.querySelector("#set-exercise-id").value = exerciseId;
  document.querySelector("#set-id").value = setId;
  document.querySelector("#set-dialog-title").textContent = `${exercise.name} · Set ${set.index}`;
  document.querySelector("#set-load").value = set.actual?.load ?? set.planned.load ?? 0;
  document.querySelector("#set-reps").value = set.actual?.reps ?? set.planned.reps ?? "";
  document.querySelector("#set-rpe").value = set.actual?.rpe ?? set.planned.rpe ?? "";
  document.querySelector("#set-pain").value = set.actual?.pain ?? 0;
  document.querySelector("#set-rest").value = set.planned.rest ?? exercise.rest ?? 90;
  document.querySelector("#set-clean").checked = set.actual?.clean ?? true;
  document.querySelector("#set-note").value = set.actual?.note ?? "";
  dialogs.set.showModal();
}

function saveSet() {
  const date = document.querySelector("#set-date").value;
  const exerciseId = document.querySelector("#set-exercise-id").value;
  const setId = document.querySelector("#set-id").value;
  let session = ensureWorkout(date);
  let exercise = session.exercises.find((item) => item.id === exerciseId);
  let set = exercise?.setsPlan.find((item) => item.id === setId);
  if (!exercise || !set) return;
  const actual = {
    load: numberOrNull(document.querySelector("#set-load").value) ?? 0,
    reps: numberOrNull(document.querySelector("#set-reps").value) ?? 0,
    rpe: numberOrNull(document.querySelector("#set-rpe").value) ?? set.planned.rpe,
    pain: numberOrNull(document.querySelector("#set-pain").value) ?? 0,
    clean: document.querySelector("#set-clean").checked,
    note: document.querySelector("#set-note").value.trim(),
    duration: exercise.duration || null,
    loggedAt: new Date().toISOString(),
    startedAt: set.startedAt || null,
  };
  const restAfter = numberOrNull(document.querySelector("#set-rest").value) ?? set.planned.rest ?? exercise.rest ?? 90;
  set.planned.rest = restAfter;
  set.actual = actual;
  set.status = "complete";
  session.status = "active";
  session.startedAt ||= new Date().toISOString();

  const painFailure = actual.pain >= 5 || (exercise.goalId === "squat" && actual.pain > Number(state.settings.squatPainLimit));
  const failedTop = ["top", "test"].includes(exercise.kind) && (actual.reps < Number(set.planned.reps) || actual.rpe >= 9.5 || !actual.clean || painFailure);
  if (failedTop && !session.backoffTriggered) {
    session = applyFailedTopSet(session, exerciseId);
    state.workouts[date] = session;
    toast("Miss protocol applied: no retry; backoff reduced.", "error");
  }

  const refreshed = state.workouts[date] || session;
  if (refreshed.backoffTriggered) {
    const cleanBackoffs = refreshed.exercises.filter((item) => item.kind === "backoff").flatMap((item) => item.setsPlan).filter((item) => item.status === "complete" && item.actual?.clean && Number(item.actual.rpe) <= 8);
    if (cleanBackoffs.length > 0) refreshed.backoffObeyed = true;
  }
  state.workouts[date] = refreshed;
  delete refreshed.activeSet;
  auditEvent(state, "set-logged", { date, week: refreshed.week, exerciseId, setId, failedTop, pain: actual.pain, rpe: actual.rpe });
  startRest(restAfter, `${exercise.name} · rest after set`, date);
  persist();
  dialogs.set.close();
  renderRoute();
}

function densityExercise(date, exerciseId) {
  const session = ensureWorkout(date);
  const exercise = session?.exercises.find((item) => item.id === exerciseId);
  if (!exercise) return {};
  exercise.densityState ||= { running: false, startedAt: null, elapsedBefore: 0, minuteLogs: {} };
  exercise.densityState.minuteLogs ||= {};
  return { session, exercise, density: exercise.densityState };
}

function startDensity(date, exerciseId) {
  const { session, exercise, density } = densityExercise(date, exerciseId);
  if (!session || !state.readiness[date] || session.status === "complete" || state.weeklyReviews?.[session.week]?.sealedAt) return;
  density.running = true;
  density.startedAt = Date.now();
  exercise.setsPlan[0].status = "active";
  exercise.setsPlan[0].startedAt ||= new Date().toISOString();
  session.status = "active";
  session.startedAt ||= new Date().toISOString();
  state.workouts[date] = session;
  state.restTimer = null;
  auditEvent(state, "density-started", { date, week: session.week, exerciseId });
  persist({ render: true });
}

function pauseDensity(date, exerciseId, { quiet = false } = {}) {
  const { session, density } = densityExercise(date, exerciseId);
  if (!session || !density.running) return;
  density.elapsedBefore = densityElapsed({ densityState: density });
  density.running = false;
  density.startedAt = null;
  state.workouts[date] = session;
  persist({ render: true });
  if (!quiet) toast("Density clock paused. Elapsed time is preserved.");
}

function resumeDensity(date, exerciseId) {
  const { session, density } = densityExercise(date, exerciseId);
  if (!session || session.status === "complete" || state.weeklyReviews?.[session.week]?.sealedAt) return;
  density.running = true;
  density.startedAt = Date.now();
  state.workouts[date] = session;
  persist({ render: true });
}

function openDensityMinute(date, exerciseId, minute) {
  const { exercise, density } = densityExercise(date, exerciseId);
  if (!exercise) return;
  const existing = density.minuteLogs[minute] || {};
  document.querySelector("#density-date").value = date;
  document.querySelector("#density-exercise-id").value = exerciseId;
  document.querySelector("#density-minute").value = minute;
  document.querySelector("#density-dialog-title").textContent = `${exercise.name} · Minute ${minute}`;
  document.querySelector("#density-reps").value = existing.reps ?? Math.max(1, Math.round(exercise.reps / exercise.duration));
  document.querySelector("#density-grip").value = existing.grip || (gripCue(minute) === "RINGS / FREE" ? "Rings / free" : gripCue(minute)[0] + gripCue(minute).slice(1).toLowerCase());
  document.querySelector("#density-rpe").value = existing.rpe ?? exercise.rpe;
  document.querySelector("#density-pain").value = existing.pain ?? 0;
  document.querySelector("#density-clean").checked = existing.clean ?? true;
  document.querySelector("#density-note").value = existing.note || "";
  dialogs.density.showModal();
}

function saveDensityMinute() {
  const date = document.querySelector("#density-date").value;
  const exerciseId = document.querySelector("#density-exercise-id").value;
  const minute = Number(document.querySelector("#density-minute").value);
  const { session, density } = densityExercise(date, exerciseId);
  if (!session) return;
  const entry = {
    reps: Number(document.querySelector("#density-reps").value),
    grip: document.querySelector("#density-grip").value,
    rpe: Number(document.querySelector("#density-rpe").value),
    pain: Number(document.querySelector("#density-pain").value),
    clean: document.querySelector("#density-clean").checked,
    note: document.querySelector("#density-note").value.trim(),
    loggedAt: new Date().toISOString(),
  };
  density.minuteLogs[minute] = entry;
  const stop = !entry.clean || entry.pain >= 5;
  if (stop && density.running) {
    density.elapsedBefore = densityElapsed({ densityState: density });
    density.running = false;
    density.startedAt = null;
  }
  state.workouts[date] = session;
  auditEvent(state, "density-minute-logged", { date, week: session.week, exerciseId, minute, reps: entry.reps, pain: entry.pain, clean: entry.clean });
  persist();
  dialogs.density.close();
  if (stop) toast("Stop rule triggered. Clock paused—do not trade strict form or joint tolerance for reps.", "error");
  renderRoute();
}

function finishDensity(date, exerciseId) {
  const { session, exercise, density } = densityExercise(date, exerciseId);
  if (!session || !exercise) return;
  const elapsed = Math.min(Number(exercise.duration) * 60, densityElapsed(exercise));
  density.elapsedBefore = elapsed;
  density.running = false;
  density.startedAt = null;
  density.finishedAt = new Date().toISOString();
  const logs = Object.values(density.minuteLogs);
  const total = logs.reduce((sum, item) => sum + Number(item.reps || 0), 0);
  const actual = {
    load: 0,
    reps: total,
    duration: Math.min(Number(exercise.duration), Math.floor(elapsed / 60)),
    rpe: logs.length ? Math.max(...logs.map((item) => Number(item.rpe || exercise.rpe))) : exercise.rpe,
    pain: logs.length ? Math.max(...logs.map((item) => Number(item.pain || 0))) : 0,
    clean: logs.length > 0 && logs.every((item) => item.clean !== false),
    note: `${logs.length} minute entries; continuous timer proof retained.`,
    loggedAt: density.finishedAt,
    startedAt: exercise.setsPlan[0].startedAt || null,
  };
  exercise.setsPlan[0].actual = actual;
  exercise.setsPlan[0].status = "complete";
  session.status = "active";
  state.workouts[date] = session;
  auditEvent(state, "density-finished", { date, week: session.week, exerciseId, total, duration: actual.duration, clean: actual.clean });
  persist({ render: true });
  toast(`Density block logged: ${total} strict reps / ${actual.duration} proven min.`, actual.clean ? "success" : "error");
}

function tickDensity() {
  document.querySelectorAll("[data-density-console]").forEach((consoleNode) => {
    const { exercise, density } = densityExercise(consoleNode.dataset.date, consoleNode.dataset.exerciseId);
    if (!exercise) return;
    const elapsed = Math.min(Number(exercise.duration) * 60, densityElapsed(exercise));
    const minute = Math.min(Number(exercise.duration), Math.max(1, Math.floor(elapsed / 60) + 1));
    consoleNode.querySelector("[data-density-clock]").textContent = formatClock(elapsed);
    consoleNode.querySelector("[data-density-current]").textContent = minute;
    consoleNode.querySelector("[data-density-grip]").textContent = gripCue(minute);
    const currentButton = consoleNode.querySelector("[data-density-minute]");
    if (currentButton && density.running) {
      currentButton.dataset.densityMinute = minute;
      currentButton.textContent = `Log minute ${minute}`;
    }
    if (density.running && elapsed >= Number(exercise.duration) * 60) {
      pauseDensity(consoleNode.dataset.date, consoleNode.dataset.exerciseId, { quiet: true });
      toast("Planned density duration reached. Log the final minute, then finish the block.", "success");
    }
  });
}

function skipSet() {
  const reason = window.prompt("Why is this set being skipped? This note stays in the ledger.");
  if (!reason?.trim()) return;
  const date = document.querySelector("#set-date").value;
  const exerciseId = document.querySelector("#set-exercise-id").value;
  const setId = document.querySelector("#set-id").value;
  const session = ensureWorkout(date);
  const set = session.exercises.find((item) => item.id === exerciseId)?.setsPlan.find((item) => item.id === setId);
  if (!set) return;
  set.status = "skipped";
  set.actual = { note: reason.trim(), loggedAt: new Date().toISOString() };
  session.status = "active";
  session.startedAt ||= new Date().toISOString();
  state.workouts[date] = session;
  delete session.activeSet;
  auditEvent(state, "set-skipped", { date, week: session.week, exerciseId, setId, reason: reason.trim() });
  persist();
  dialogs.set.close();
  renderRoute();
}

function resetSetPlans(exercise, oldPlans = []) {
  exercise.setsPlan = Array.from({ length: exercise.sets }, (_, index) => {
    const existing = oldPlans[index];
    if (existing?.status !== "pending") return existing;
    return {
      id: existing?.id || `${exercise.id}-set-${index + 1}`,
      index: index + 1,
      planned: { load: exercise.load, reps: exercise.reps, rpe: exercise.rpe, rest: exercise.rest },
      originalPlanned: existing?.originalPlanned || { load: exercise.load, reps: exercise.reps, rpe: exercise.rpe, rest: exercise.rest },
      status: "pending",
      actual: null,
    };
  });
}

function openExerciseDialog(date, exerciseId = "") {
  const session = ensureWorkout(date);
  const exercise = session.exercises.find((item) => item.id === exerciseId);
  document.querySelector("#edit-date").value = date;
  document.querySelector("#edit-exercise-id").value = exerciseId;
  document.querySelector("#exercise-dialog-title").textContent = exercise ? "Edit exercise" : "Add exercise";
  document.querySelector("#edit-name").value = exercise?.name || "";
  document.querySelector("#edit-sets").value = exercise?.sets || 3;
  document.querySelector("#edit-reps").value = exercise?.reps || 10;
  document.querySelector("#edit-load").value = exercise?.load ?? "";
  document.querySelector("#edit-rest").value = exercise?.rest || 90;
  document.querySelector("#edit-rpe").value = exercise?.rpe || 7;
  document.querySelector("#edit-cue").value = exercise?.cue || "";
  document.querySelector("#edit-alternatives").value = (exercise?.alternatives || []).join(", ");
  const alternatives = exercise?.alternatives || [];
  document.querySelector("#edit-substitute").innerHTML = `<option value="">Keep entered name</option>${alternatives.map((name) => `<option value="${h(name)}">Use: ${h(name)}</option>`).join("")}`;
  document.querySelectorAll('input[name="edit-scope"]').forEach((radio) => { radio.disabled = !exercise; });
  dialogs.exercise.showModal();
}

function saveExercise() {
  const date = document.querySelector("#edit-date").value;
  const exerciseId = document.querySelector("#edit-exercise-id").value;
  const session = ensureWorkout(date);
  const substitute = document.querySelector("#edit-substitute").value;
  const changes = {
    name: substitute || document.querySelector("#edit-name").value.trim(),
    sets: Number(document.querySelector("#edit-sets").value),
    reps: Number(document.querySelector("#edit-reps").value),
    load: numberOrNull(document.querySelector("#edit-load").value),
    rest: Number(document.querySelector("#edit-rest").value),
    rpe: Number(document.querySelector("#edit-rpe").value),
    cue: document.querySelector("#edit-cue").value.trim(),
    alternatives: document.querySelector("#edit-alternatives").value.split(",").map((value) => value.trim()).filter(Boolean),
  };
  if (!exerciseId) {
    const id = uid("custom");
    const item = { id, kind: "accessory", goalId: null, userModified: true, ...changes };
    resetSetPlans(item);
    session.exercises.push(item);
    state.workouts[date] = session;
  } else {
    const scope = document.querySelector('input[name="edit-scope"]:checked')?.value || "today";
    if (scope === "template") state.templateEdits[`${session.key}:${exerciseId}`] = { ...(state.templateEdits[`${session.key}:${exerciseId}`] || {}), ...changes };
    if (scope === "future") state.futureEdits.push({ id: uid("edit"), from: date, sessionKey: session.key, exerciseId, changes });
    const item = session.exercises.find((entry) => entry.id === exerciseId);
    if (item && session.status !== "complete") {
      const oldPlans = item.setsPlan || [];
      item.recommended ||= { name: item.name, sets: item.sets, reps: item.reps, load: item.load, rest: item.rest, rpe: item.rpe, cue: item.cue, alternatives: item.alternatives };
      Object.assign(item, changes);
      item.userModified = true;
      resetSetPlans(item, oldPlans);
    }
    state.workouts[date] = session;
  }
  session.userModified = true;
  auditEvent(state, "workout-edited", { date, week: session.week, exerciseId: exerciseId || null, scope: exerciseId ? document.querySelector('input[name="edit-scope"]:checked')?.value || "today" : "today" });
  persist();
  dialogs.exercise.close();
  toast("Workout plan updated. Completed history was preserved.", "success");
  renderRoute();
}

function openEvidenceDialog(goalId) {
  const goal = goalById(goalId);
  document.querySelector("#evidence-goal-id").value = goalId;
  document.querySelector("#evidence-dialog-title").textContent = goal.name;
  document.querySelector("#strength-evidence-fields").hidden = goal.type === "endurance";
  document.querySelector("#endurance-evidence-fields").hidden = goal.type !== "endurance";
  document.querySelector("#evidence-next-day-wrap").hidden = goalId !== "squat";
  ["#evidence-load", "#evidence-reps", "#evidence-rpe", "#evidence-pain", "#evidence-next-day-pain", "#evidence-total", "#evidence-duration"].forEach((selector) => { document.querySelector(selector).value = ""; });
  document.querySelector("#evidence-clean").checked = true;
  dialogs.evidence.showModal();
}

function saveEvidence() {
  const goalId = document.querySelector("#evidence-goal-id").value;
  const goal = goalById(goalId);
  const item = {
    id: uid("evidence"),
    goalId,
    date: todayISO(),
    clean: document.querySelector("#evidence-clean").checked,
    source: "manual",
    loggedAt: new Date().toISOString(),
  };
  if (goal.type === "endurance") {
    item.total = numberOrNull(document.querySelector("#evidence-total").value) || 0;
    item.duration = numberOrNull(document.querySelector("#evidence-duration").value) || 0;
  } else {
    item.load = numberOrNull(document.querySelector("#evidence-load").value) || 0;
    item.reps = numberOrNull(document.querySelector("#evidence-reps").value) || 0;
    item.rpe = numberOrNull(document.querySelector("#evidence-rpe").value) || 10;
    item.pain = numberOrNull(document.querySelector("#evidence-pain").value) || 0;
    item.nextDayPain = goalId === "squat" ? numberOrNull(document.querySelector("#evidence-next-day-pain").value) : item.pain;
    item.bodyweight = state.settings.bodyweight;
  }
  if (goalId === "squat" && !state.baselines.squat) {
    if (!item.clean || item.pain > Number(state.settings.squatPainLimit) || !Number.isFinite(item.nextDayPain) || item.nextDayPain > Number(state.settings.squatPainLimit)) {
      toast("A squat baseline needs clean reps plus same-day and next-day pain within the ceiling.", "error");
      return;
    }
    state.baselines.squat = { ...item, evidenceId: item.id };
    toast("Squat baseline established. Its dial remains at 0%.", "success");
  }
  state.evidence.push(item);
  persist();
  dialogs.evidence.close();
  renderRoute();
}

function saveDaily(date, fields) {
  state.daily[date] ||= {};
  Object.entries(fields).forEach(([key, value]) => {
    const parsed = numberOrNull(value);
    if (parsed === null) delete state.daily[date][key];
    else state.daily[date][key] = parsed;
  });
  persist();
}

function finishWorkout(date) {
  const session = ensureWorkout(date);
  const mainLogged = session.approvedModified
    ? session.exercises.some((exercise) => exercise.kind === "recovery" && exercise.setsPlan.some((set) => set.status === "complete"))
    : session.exercises.some((exercise) => ["top", "test", "density"].includes(exercise.kind) && exercise.setsPlan.some((set) => set.status === "complete"));
  if (!mainLogged) {
    toast("Log the main work or approved Red substitute before finishing.", "error");
    return;
  }
  if (session.backoffTriggered && !document.querySelector("#backoff-obeyed")?.checked) {
    toast("Confirm the miss protocol before finishing this session.", "error");
    return;
  }
  session.postPain = numberOrNull(document.querySelector("#post-pain")?.value);
  session.nextDayPain = numberOrNull(document.querySelector("#next-day-pain")?.value);
  session.backoffObeyed = session.backoffTriggered ? true : session.backoffObeyed;
  session.status = "complete";
  session.completedAt = new Date().toISOString();
  state.workouts[date] = session;
  establishSquatBaselineFromWorkout(session);
  state.restTimer = null;
  auditEvent(state, "workout-completed", { date, week: session.week, outcome: session.approvedModified ? "approved-modified" : session.userModified ? "modified" : "full", postPain: session.postPain, nextDayPain: session.nextDayPain });
  persist();
  toast("Scheduled outcome complete. Ledger updated.", "success");
  renderRoute();
}

function establishSquatBaselineFromWorkout(session) {
  if (state.baselines.squat || session.week !== 1) return;
  if (session.nextDayPain === null || Number(session.nextDayPain) > Number(state.settings.squatPainLimit)) return;
  const candidates = session.exercises
    .filter((exercise) => exercise.goalId === "squat")
    .flatMap((exercise) => exercise.setsPlan.map((set) => ({ exercise, set })))
    .filter(({ set }) => set.status === "complete" && set.actual?.clean && Number(set.actual.pain) <= Number(state.settings.squatPainLimit))
    .sort((a, b) => Number(b.set.actual.load) - Number(a.set.actual.load));
  const best = candidates[0];
  if (!best) return;
  state.baselines.squat = {
    ...best.set.actual,
    nextDayPain: Number(session.nextDayPain),
    date: session.date,
    evidenceId: `workout-${session.date}-${best.exercise.id}-${best.set.id}`,
  };
  toast("Squat baseline established. Progress remains 0% until you improve it.", "success");
}

function saveSymptomFollowup(date) {
  const session = state.workouts[date];
  if (!session) return;
  session.postPain = numberOrNull(document.querySelector("#post-pain")?.value);
  session.nextDayPain = numberOrNull(document.querySelector("#next-day-pain")?.value);
  establishSquatBaselineFromWorkout(session);
  state.workouts[date] = session;
  persist();
  toast("Symptom follow-up saved. Squat evidence recalculated.", "success");
  renderRoute();
}

function mutateExercise(date, exerciseId, mutation) {
  const session = ensureWorkout(date);
  const index = session.exercises.findIndex((item) => item.id === exerciseId);
  if (index < 0 || session.status === "complete" || state.weeklyReviews?.[session.week]?.sealedAt) return;
  mutation(session, index);
  session.userModified = true;
  state.workouts[date] = session;
  auditEvent(state, "workout-structure-edited", { date, week: session.week, exerciseId });
  persist();
  renderRoute();
}

function openMoveDialog(from) {
  const week = weekForDate(from);
  const dates = weekDates(week);
  document.querySelector("#move-from").value = from;
  document.querySelector("#move-to").value = from;
  document.querySelector("#move-to").min = dates[0];
  document.querySelector("#move-to").max = dates[6];
  document.querySelector("#move-range").textContent = `Week ${week}: ${formatDate(dates[0])} through ${formatDate(dates[6])}. Choose an open date.`;
  dialogs.move.showModal();
}

function saveMove() {
  const from = document.querySelector("#move-from").value;
  const to = document.querySelector("#move-to").value;
  try {
    state = moveWorkoutDate(state, from, to);
    persist();
    dialogs.move.close();
    location.hash = `#/workout/${to}`;
    toast(`Workout moved to ${formatDate(to, { weekday: "long", month: "long" })}.`, "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

function reopenWorkout(date) {
  const session = state.workouts[date];
  if (!session || state.weeklyReviews?.[session.week]?.sealedAt) return;
  session.status = "active";
  session.completedAt = null;
  auditEvent(state, "workout-reopened", { date, week: session.week });
  persist({ render: true });
  toast("Workout reopened. Planned and performed history remains available.");
}

function reopenWeek(week) {
  const review = state.weeklyReviews[week];
  if (!review?.sealedAt) return;
  review.archivedSnapshots ||= [];
  if (review.snapshot) review.archivedSnapshots.push({ reopenedAt: new Date().toISOString(), snapshot: review.snapshot });
  delete review.sealedAt;
  delete review.snapshot;
  state.caches[week] = { ...(state.caches[week] || {}), unlockValid: false, invalidatedAt: new Date().toISOString() };
  auditEvent(state, "week-reopened", { week });
  persist({ render: true });
  toast(`Week ${week} reopened. Badge and cache eligibility will recalculate.`, "success");
}

function askConfirm(title, copy, callback) {
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-copy").textContent = copy;
  confirmCallback = callback;
  dialogs.confirm.showModal();
}

function startRest(seconds, context, date) {
  const now = Date.now();
  state.restTimer = { endAt: now + seconds * 1000, remaining: seconds * 1000, running: true, context, date };
  persist();
  tickRest();
}

function stopRest() {
  state.restTimer = null;
  persist();
  tickRest();
}

function restRemaining() {
  return restTimerRemaining(state.restTimer);
}

function tickRest() {
  const dock = document.querySelector("#rest-dock");
  if (!state.restTimer) {
    dock.hidden = true;
    document.body.classList.remove("resting");
    return;
  }
  const remaining = restRemaining();
  if (remaining <= 0) {
    if (state.settings.timerVibrate && navigator.vibrate) navigator.vibrate([180, 90, 180]);
    toast("Rest complete. Next set is ready.", "success");
    state.restTimer = null;
    persist();
    dock.hidden = true;
    document.body.classList.remove("resting");
    return;
  }
  const totalSeconds = Math.ceil(remaining / 1000);
  document.querySelector("#rest-time").textContent = `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
  document.querySelector("#rest-context").textContent = state.restTimer.context;
  document.querySelector("[data-rest-toggle]").textContent = state.restTimer.running ? "Pause" : "Resume";
  dock.hidden = false;
  document.body.classList.add("resting");
}

function adjustRest(seconds) {
  if (!state.restTimer) return;
  if (state.restTimer.running) state.restTimer.endAt = Math.max(Date.now() + 1000, state.restTimer.endAt + seconds * 1000);
  else state.restTimer.remaining = Math.max(1000, state.restTimer.remaining + seconds * 1000);
  persist();
  tickRest();
}

function toggleRest() {
  if (!state.restTimer) return;
  if (state.restTimer.running) {
    state.restTimer.remaining = restRemaining();
    state.restTimer.running = false;
  } else {
    state.restTimer.endAt = Date.now() + state.restTimer.remaining;
    state.restTimer.running = true;
  }
  persist();
  tickRest();
}

function downloadJSON(filename, data) {
  downloadText(filename, JSON.stringify(data, null, 2));
}

function downloadText(filename, body) {
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    document.querySelector("#install-app").hidden = true;
    return;
  }
  toast("On iPhone: Share → Add to Home Screen. On Android/Desktop: use the browser Install option.");
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.matches("[data-open-more]")) dialogs.more.showModal();
  if (target.matches("[data-close-more], [data-close-more-link]")) dialogs.more.close();
  if (target.dataset.openWorkout) location.hash = `#/workout/${target.dataset.openWorkout}`;
  if (target.dataset.monthShift) {
    state.ui.calendarMonth = shiftMonth(state.ui.calendarMonth || CAMPAIGN.start.slice(0, 7), Number(target.dataset.monthShift));
    persist({ render: true });
  }
  if (target.matches("[data-save-daily]")) {
    const date = target.dataset.date;
    const values = {};
    document.querySelectorAll(`[data-daily-field][data-date="${date}"]`).forEach((input) => { values[input.dataset.dailyField] = input.value; });
    saveDaily(date, values);
    toast("Daily nonnegotiables posted.", "success");
    renderRoute();
  }
  if (target.matches("[data-log-evidence]")) openEvidenceDialog(target.dataset.logEvidence);
  if (target.matches("[data-start-set]")) startSet(target.dataset.date, target.dataset.exerciseId, target.dataset.setId);
  if (target.matches("[data-log-set]")) openSetDialog(target.dataset.date, target.dataset.exerciseId, target.dataset.setId);
  if (target.dataset.densityStart) startDensity(target.dataset.date, target.dataset.densityStart);
  if (target.dataset.densityPause) pauseDensity(target.dataset.date, target.dataset.densityPause);
  if (target.dataset.densityResume) resumeDensity(target.dataset.date, target.dataset.densityResume);
  if (target.dataset.densityMinute) openDensityMinute(target.dataset.date, target.dataset.exerciseId, Number(target.dataset.densityMinute));
  if (target.dataset.densityFinish) askConfirm("Finish this density block?", "The continuous elapsed time and every logged minute will become the official result. No unperformed minutes are projected.", () => finishDensity(target.dataset.date, target.dataset.densityFinish));
  if (target.matches("[data-edit-exercise]")) openExerciseDialog(target.dataset.date, target.dataset.editExercise);
  if (target.matches("[data-add-exercise]")) openExerciseDialog(target.dataset.date);
  if (target.matches("[data-move-exercise]")) mutateExercise(target.dataset.date, target.dataset.moveExercise, (session, index) => {
    const next = index + Number(target.dataset.direction);
    if (next < 0 || next >= session.exercises.length) return;
    [session.exercises[index], session.exercises[next]] = [session.exercises[next], session.exercises[index]];
  });
  if (target.matches("[data-add-set]")) mutateExercise(target.dataset.date, target.dataset.addSet, (session, index) => {
    const item = session.exercises[index];
    item.sets += 1;
    resetSetPlans(item, item.setsPlan);
  });
  if (target.matches("[data-remove-set]")) mutateExercise(target.dataset.date, target.dataset.removeSet, (session, index) => {
    const item = session.exercises[index];
    const last = item.setsPlan.at(-1);
    if (item.sets <= 1 || last?.status !== "pending") {
      toast("Only an unlogged final set can be removed.", "error");
      return;
    }
    item.sets -= 1;
    item.setsPlan.pop();
  });
  if (target.matches("[data-delete-exercise]")) askConfirm("Delete this exercise?", "Only this dated workout changes. Completed history elsewhere is untouched.", () => {
    mutateExercise(target.dataset.date, target.dataset.deleteExercise, (session, index) => session.exercises.splice(index, 1));
  });
  if (target.dataset.moveWorkout) openMoveDialog(target.dataset.moveWorkout);
  if (target.dataset.resetRecommended) askConfirm("Reset to the recommended plan?", "Uncompleted instances of this session template will return to SIXFOLD programming. Completed history stays untouched.", () => {
    try {
      state = resetRecommendedPlan(state, target.dataset.resetRecommended);
      persist({ render: true });
      toast("Recommended plan restored for all uncompleted matching sessions.", "success");
    } catch (error) { toast(error.message, "error"); }
  });
  if (target.dataset.reopenWorkout) askConfirm("Reopen this workout?", "Performed results stay recorded, but you may edit or add to the entry until the week is sealed.", () => reopenWorkout(target.dataset.reopenWorkout));
  if (target.dataset.finishWorkout) finishWorkout(target.dataset.finishWorkout);
  if (target.dataset.saveFollowup) saveSymptomFollowup(target.dataset.saveFollowup);
  if (target.dataset.reviewShift) {
    state.ui.reviewWeek = Math.max(1, Math.min(16, Number(state.ui.reviewWeek || currentCampaignWeek()) + Number(target.dataset.reviewShift)));
    persist({ render: true });
  }
  if (target.dataset.sealReview) {
    const week = Number(target.dataset.sealReview);
    const gate = weeklyGate(week, state);
    if (!gate.eligibleToSeal) return toast("Every weekly gate must pass before sealing.", "error");
    state.weeklyReviews[week] ||= {};
    state.weeklyReviews[week].sealedAt = new Date().toISOString();
    state.caches[week] = { ...(state.caches[week] || {}), unlockedAt: new Date().toISOString(), unlockValid: true };
    auditEvent(state, "week-sealed", { week });
    state.weeklyReviews[week].snapshot = reviewPayload(week, state);
    persist();
    toast(`Week ${week} sealed. Cache unlocked.`, "success");
    renderRoute();
  }
  if (target.dataset.reopenWeek) askConfirm("Reopen this sealed week?", "The snapshot will be archived, badges will recalculate, and the cache will relock until every gate passes and the week is sealed again.", () => reopenWeek(Number(target.dataset.reopenWeek)));
  if (target.dataset.exportReview) {
    const week = Number(target.dataset.exportReview);
    downloadJSON(`sixfold-week-${String(week).padStart(2, "0")}-project52.json`, state.weeklyReviews?.[week]?.snapshot || reviewPayload(week, state));
  }
  if (target.dataset.copyReview) {
    const week = Number(target.dataset.copyReview);
    navigator.clipboard?.writeText((state.weeklyReviews?.[week]?.snapshot || reviewPayload(week, state)).narrative).then(() => toast("Weekly summary copied.", "success"));
  }
  if (target.dataset.cacheAction) {
    const week = Number(target.dataset.week);
    if (state.caches[week]?.unlockValid === false || (!state.caches[week]?.unlockedAt && !weeklyGate(week, state).complete)) return;
    state.caches[week] = { ...(state.caches[week] || {}), status: target.dataset.cacheAction, decidedAt: new Date().toISOString() };
    persist({ render: true });
  }
  if (target.dataset.swapCache) {
    const week = Number(target.dataset.swapCache);
    const reward = decodedCache(week);
    document.querySelector("#swap-week").value = week;
    document.querySelector("#swap-title").value = "";
    document.querySelector("#swap-reason").value = "";
    document.querySelector("#swap-limit").textContent = `The replacement may cost no more than $${reward.value}. Medical care is never contingent on earning this cache.`;
    dialogs.swap.showModal();
  }
  if (target.matches("[data-install], #install-app")) installApp();
  if (target.matches("[data-backup]")) downloadText(`sixfold-backup-${todayISO()}.json`, serializeBackup(state));
  if (target.matches("[data-restore]")) document.querySelector("#restore-input").click();
  if (target.matches("[data-reset]")) askConfirm("Reset the entire ledger?", "Every workout, badge, cache, review, and progress dial on this device will be erased. This cannot be undone without a backup.", () => {
    state = defaultState();
    persist({ render: true });
    toast("IRON LEDGER reset. Every goal is back to 0%.");
  });
  if (target.dataset.restAdjust) adjustRest(Number(target.dataset.restAdjust));
  if (target.matches("[data-rest-toggle]")) toggleRest();
  if (target.matches("[data-rest-skip]")) stopRest();
});

document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "set-form") saveSet();
  if (event.target.id === "density-form") saveDensityMinute();
  if (event.target.id === "move-form") saveMove();
  if (event.target.id === "exercise-form") saveExercise();
  if (event.target.id === "evidence-form") saveEvidence();
  if (event.target.id === "readiness-form") {
    const form = new FormData(event.target);
    const date = event.target.dataset.date;
    state.readiness[date] = {
      sleep: Number(form.get("sleep")),
      energy: Number(form.get("energy")),
      recovery: Number(form.get("recovery")),
      pain: Number(form.get("pain")),
      redFlag: form.get("redFlag") === "on",
      swelling: form.get("swelling") === "on",
      gaitChange: form.get("gaitChange") === "on",
      instability: form.get("instability") === "on",
      neurologic: form.get("neurologic") === "on",
      nextDayWorsening: form.get("nextDayWorsening") === "on" || event.target.dataset.priorWorsening === "true",
      loggedAt: new Date().toISOString(),
    };
    const mode = readinessMode(state.readiness[date]);
    state.workouts[date] = rebuildUnstartedSession(date, mode);
    state.workouts[date].status = state.workouts[date].status === "planned" ? "active" : state.workouts[date].status;
    state.workouts[date].startedAt ||= new Date().toISOString();
    persist();
    toast(`${mode.toUpperCase()} directive locked for today.`, mode === "red" ? "error" : "success");
    renderRoute();
  }
  if (event.target.id === "review-form") {
    const week = Number(event.target.dataset.week);
    const form = new FormData(event.target);
    state.weeklyReviews[week] = {
      ...(state.weeklyReviews[week] || {}),
      win: String(form.get("win") || "").trim(),
      lesson: String(form.get("lesson") || "").trim(),
      nextAction: String(form.get("nextAction") || "").trim(),
      backoffConfirmed: form.get("backoffConfirmed") === "on",
      savedAt: new Date().toISOString(),
    };
    persist();
    toast("Weekly judgment saved.", "success");
    renderRoute();
  }
  if (event.target.id === "settings-form") {
    const form = new FormData(event.target);
    state.settings.proteinTarget = Number(form.get("proteinTarget"));
    state.settings.squatPainLimit = Number(form.get("squatPainLimit"));
    state.settings.bodyweight = Number(form.get("bodyweight"));
    state.settings.vaultCap = Number(form.get("vaultCap"));
    state.settings.timerVibrate = form.get("timerVibrate") === "on";
    persist();
    toast("Settings saved.", "success");
    renderRoute();
  }
  if (event.target.id === "swap-form") {
    const week = Number(document.querySelector("#swap-week").value);
    state.caches[week] = {
      ...(state.caches[week] || {}),
      swap: { title: document.querySelector("#swap-title").value.trim(), reason: document.querySelector("#swap-reason").value.trim() },
      swappedAt: new Date().toISOString(),
    };
    persist();
    dialogs.swap.close();
    toast("Equal-value swap locked. Claim or bank when ready.", "success");
    renderRoute();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-week-daily]")) {
    saveDaily(event.target.dataset.date, { [event.target.dataset.weekDaily]: event.target.value });
    renderRoute();
  }
});

document.querySelector("#skip-set").addEventListener("click", skipSet);
document.querySelector("#confirm-action").addEventListener("click", () => {
  const callback = confirmCallback;
  confirmCallback = null;
  dialogs.confirm.close();
  callback?.();
});
document.querySelector("#restore-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imported = restoreBackup(await file.text());
    askConfirm("Restore this backup?", "The current local ledger will be replaced. Export it first if needed.", () => {
      state = imported;
      persist({ render: true });
      toast("Backup restored.", "success");
    });
  } catch (error) {
    toast(`Restore failed: ${error.message}`, "error");
  } finally {
    event.target.value = "";
  }
});

window.addEventListener("hashchange", () => {
  dialogs.more.close();
  renderRoute();
});
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  document.querySelector("#install-app").hidden = false;
});
window.addEventListener("appinstalled", () => toast("SIXFOLD installed.", "success"));

if ("serviceWorker" in navigator) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    location.reload();
  });
  navigator.serviceWorker.register("./service-worker.js").then((registration) => registration.update()).catch(() => {});
}
if (!location.hash) location.replace("#/today");
updateChrome();
renderRoute();
tickRest();
timerInterval = window.setInterval(() => { tickRest(); tickDensity(); }, 500);
