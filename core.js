import {
  BADGES,
  CACHE_VAULT,
  CAMPAIGN,
  GOALS,
  PHASES,
  PULLUP_DENSITY,
  SESSION_DAYS,
  SUMMIT,
  WEEK_INTENT,
} from "./data.js";

export const STORAGE_KEY = "iron-ledger-state-v1";
export const SCHEMA_VERSION = 1;

export function auditEvent(state, type, detail = {}) {
  state.audit ||= [];
  const entry = {
    id: `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    type,
    ...detail,
  };
  state.audit.push(entry);
  return entry;
}

export function dateFromISO(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function isoFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(iso, amount) {
  const date = dateFromISO(iso);
  date.setDate(date.getDate() + amount);
  return isoFromDate(date);
}

export function daysBetween(fromISO, toISO) {
  return Math.round((dateFromISO(toISO) - dateFromISO(fromISO)) / 86400000);
}

export function todayISO() {
  return isoFromDate(new Date());
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function roundLoad(value, increment = 2.5) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value / increment) * increment);
}

export function formatLoad(load, prefix = "") {
  if (!Number.isFinite(Number(load))) return "Choose load";
  const value = Number(load);
  return `${prefix}${Number.isInteger(value) ? value : value.toFixed(1)} lb`;
}

export function formatDate(iso, options = {}) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: options.weekday ?? "short",
    month: options.month ?? "short",
    day: options.day ?? "numeric",
    ...(options.year ? { year: options.year } : {}),
  }).format(dateFromISO(iso));
}

export function weekForDate(iso) {
  if (iso < CAMPAIGN.start) return 0;
  if (iso > CAMPAIGN.target) return 17;
  return clamp(Math.floor(daysBetween(CAMPAIGN.start, iso) / 7) + 1, 1, 16);
}

export function weekDates(week) {
  const start = addDays(CAMPAIGN.start, (clamp(week, 1, 16) - 1) * 7);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function phaseForWeek(week) {
  return PHASES.find((phase) => phase.weeks.includes(clamp(week, 1, 16))) ?? PHASES[0];
}

export function campaignContext(iso = todayISO()) {
  const week = weekForDate(iso);
  const activeWeek = clamp(week, 1, 16);
  return {
    week,
    activeWeek,
    phase: phaseForWeek(activeWeek),
    daysRemaining: Math.max(0, daysBetween(iso, CAMPAIGN.target)),
    before: week === 0,
    after: week === 17,
    summit: iso >= CAMPAIGN.summitStart && iso <= CAMPAIGN.target,
  };
}

export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      proteinTarget: 170,
      squatPainLimit: 2,
      vaultCap: 1000,
      timerVibrate: true,
      bodyweight: 205,
    },
    baselines: {},
    evidence: [],
    daily: {},
    readiness: {},
    workouts: {},
    scheduleMoves: {},
    templateEdits: {},
    futureEdits: [],
    weeklyReviews: {},
    caches: {},
    audit: [],
    ui: { collapsed: {}, calendarMonth: CAMPAIGN.start.slice(0, 7) },
    restTimer: null,
  };
}

export function normalizeState(input) {
  const base = defaultState();
  if (!input || typeof input !== "object") return base;
  return {
    ...base,
    ...input,
    schemaVersion: SCHEMA_VERSION,
    settings: { ...base.settings, ...(input.settings || {}) },
    baselines: { ...(input.baselines || {}) },
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    daily: { ...(input.daily || {}) },
    readiness: { ...(input.readiness || {}) },
    workouts: { ...(input.workouts || {}) },
    scheduleMoves: { ...(input.scheduleMoves || {}) },
    templateEdits: { ...(input.templateEdits || {}) },
    futureEdits: Array.isArray(input.futureEdits) ? input.futureEdits : [],
    weeklyReviews: { ...(input.weeklyReviews || {}) },
    caches: { ...(input.caches || {}) },
    audit: Array.isArray(input.audit) ? input.audit : [],
    ui: { ...base.ui, ...(input.ui || {}), collapsed: { ...(input.ui?.collapsed || {}) } },
  };
}

export function goalById(id) {
  return GOALS.find((goal) => goal.id === id);
}

export function getBaseline(goal, state) {
  return state.baselines?.[goal.id] || goal.baseline || null;
}

export function estimatedOneRepMax(load, reps, rpe = 10) {
  const safeLoad = Number(load);
  const safeReps = Number(reps);
  if (!Number.isFinite(safeLoad) || !Number.isFinite(safeReps) || safeLoad <= 0 || safeReps <= 0) return 0;
  // RPE contributes conservatively: half a rep of credit per reported RIR,
  // capped at 1.5 reps so a subjective rating cannot overwhelm performance.
  const rirCredit = Math.min(1.5, clamp(10 - (Number.isFinite(Number(rpe)) ? Number(rpe) : 10), 0, 5) * 0.5);
  return safeLoad * (1 + (safeReps + rirCredit) / 30);
}

export function projectedRepsAtLoad(e1rm, load) {
  if (!Number.isFinite(Number(e1rm)) || !Number.isFinite(Number(load)) || Number(load) <= 0) return 0;
  return clamp(Math.floor(30 * (Number(e1rm) / Number(load) - 1)), 0, 30);
}

function strengthMetric(goal, attempt, state) {
  const bodyweight = Number(attempt.bodyweight ?? state.settings.bodyweight ?? goal.baseline?.bodyweight ?? 0);
  const systemLoad = goal.id === "chin" ? Number(attempt.load) + bodyweight : Number(attempt.load);
  return estimatedOneRepMax(systemLoad, attempt.reps, attempt.rpe ?? 10);
}

function enduranceMetric(attempt) {
  const totalRatio = clamp(Number(attempt.total) / 500, 0, 1);
  const durationRatio = clamp(Number(attempt.duration) / 60, 0, 1);
  return 0.65 * totalRatio + 0.35 * durationRatio;
}

export function collectEvidence(state, goalId) {
  const direct = state.evidence
    .filter((item) => item.goalId === goalId)
    .map((item) => ({ ...item, source: item.source || "manual" }));

  const workoutEvidence = [];
  Object.entries(state.workouts).forEach(([date, workout]) => {
    (workout.exercises || []).forEach((exercise) => {
      if (exercise.goalId !== goalId) return;
      (exercise.setsPlan || []).forEach((set) => {
        if (!set.actual || set.status !== "complete") return;
        if (goalId === "pullups") {
          workoutEvidence.push({
            id: `workout-${date}-${exercise.id}-${set.id}`,
            goalId,
            date,
            total: Number(set.actual.reps),
            duration: Number(set.actual.duration ?? exercise.duration ?? 0),
            clean: set.actual.clean !== false,
            source: "workout",
          });
        } else {
          workoutEvidence.push({
            id: `workout-${date}-${exercise.id}-${set.id}`,
            goalId,
            date,
            load: Number(set.actual.load),
            reps: Number(set.actual.reps),
            rpe: Number(set.actual.rpe || 10),
            pain: Number(set.actual.pain || 0),
            nextDayPain: Number.isFinite(Number(workout.nextDayPain)) ? Number(workout.nextDayPain) : null,
            clean: set.actual.clean !== false,
            bodyweight: Number(state.daily?.[date]?.weight || state.settings.bodyweight || 0),
            source: "workout",
          });
        }
      });
    });
  });

  return [...direct, ...workoutEvidence].filter((item) => item.clean !== false);
}

export function attemptMeets(goal, attempt, standard, state) {
  if (!attempt || attempt.clean === false) return false;
  if (goal.type === "endurance") {
    return Number(attempt.total) >= standard.total && Number(attempt.duration) >= standard.duration;
  }
  if (Number(attempt.load) < standard.load || Number(attempt.reps) < standard.reps) return false;
  if (goal.id === "squat") {
    const pain = Number(attempt.pain ?? 99);
    if (attempt.nextDayPain === null || attempt.nextDayPain === undefined || attempt.nextDayPain === "") return false;
    const nextDayPain = Number(attempt.nextDayPain);
    return pain <= Number(state.settings.squatPainLimit) && Number.isFinite(nextDayPain) && nextDayPain <= Number(state.settings.squatPainLimit);
  }
  return true;
}

export function medalStatus(goal, state) {
  const baseline = getBaseline(goal, state);
  const attempts = collectEvidence(state, goal.id).filter((attempt) => {
    if (attempt.id === baseline?.evidenceId) return false;
    if (goal.id === "squat" && baseline?.date && attempt.date === baseline.date) return false;
    return true;
  });
  return goal.medals.map((medal) => {
    const match = attempts
      .filter((attempt) => attemptMeets(goal, attempt, medal, state))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    return { ...medal, earned: Boolean(match), earnedAt: match?.date || null };
  });
}

export function goalProgress(goal, state) {
  const baseline = getBaseline(goal, state);
  const medals = medalStatus(goal, state);
  const gold = medals.find((medal) => medal.tier === "Gold")?.earned;
  if (!baseline) {
    return { percent: 0, baseline: null, best: null, medals, remaining: goal.deltaText, needsBaseline: true };
  }

  const attempts = collectEvidence(state, goal.id).filter((attempt) => {
    if (attempt.id === baseline.evidenceId) return false;
    if (goal.id === "squat" && baseline.date && attempt.date === baseline.date) return false;
    return true;
  });
  if (goal.type === "endurance") {
    const baselineScore = enduranceMetric(baseline);
    const best = attempts.sort((a, b) => enduranceMetric(b) - enduranceMetric(a))[0] || null;
    const bestScore = best ? enduranceMetric(best) : baselineScore;
    const raw = ((bestScore - baselineScore) / Math.max(0.001, 1 - baselineScore)) * 100;
    const percent = gold ? 100 : clamp(Math.floor(raw), 0, 99);
    const bestTotal = Math.max(baseline.total, Number(best?.total || 0));
    const bestDuration = Math.max(baseline.duration, Number(best?.duration || 0));
    return {
      percent,
      baseline,
      best,
      medals,
      remaining: `${Math.max(0, 500 - bestTotal)} reps and ${Math.max(0, 60 - bestDuration)} sustained min remain`,
      bestTotal,
      bestDuration,
      needsBaseline: false,
    };
  }

  const baselineMetric = strengthMetric(goal, baseline, state);
  const targetMetric = strengthMetric(goal, { ...goal.target, rpe: 10 }, state);
  const best = attempts.sort((a, b) => strengthMetric(goal, b, state) - strengthMetric(goal, a, state))[0] || null;
  const bestMetric = best ? Math.max(baselineMetric, strengthMetric(goal, best, state)) : baselineMetric;
  const raw = ((bestMetric - baselineMetric) / Math.max(1, targetMetric - baselineMetric)) * 100;
  const percent = gold ? 100 : clamp(Math.floor(raw), 0, 99);
  const bestLoad = Math.max(Number(baseline.load), Number(best?.load || 0));
  return {
    percent,
    baseline,
    best,
    medals,
    remaining: `${Math.max(0, goal.target.load - bestLoad)} lb of target load remains`,
    baselineMetric,
    bestMetric,
    targetMetric,
    projectedReps: projectedRepsAtLoad(bestMetric, goal.id === "chin" ? goal.target.load + Number(state.settings.bodyweight) : goal.target.load),
    relativeStrength: goal.id === "chin" ? (Number(state.settings.bodyweight) + bestLoad) / Number(state.settings.bodyweight) : null,
    needsBaseline: false,
  };
}

export function trainingMaxMultiplier(goalId, state) {
  const attempts = Object.values(state.workouts)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .flatMap((workout) => (workout.exercises || [])
      .filter((exercise) => exercise.goalId === goalId && ["top", "test"].includes(exercise.kind))
      .map((exercise) => ({ workout, exercise, set: exercise.setsPlan?.find((item) => item.status === "complete") })))
    .filter((entry) => entry.set?.actual)
    .map((entry) => ({
      date: entry.workout.date,
      failed: entry.set.actual.clean === false || Number(entry.set.actual.reps) < Number(entry.set.planned.reps) || Number(entry.set.actual.rpe) >= 9.5,
    }));
  const lastTwo = attempts.slice(-2);
  return lastTwo.length === 2 && lastTwo.every((attempt) => attempt.failed) ? 0.95 : 1;
}

export function overallProgress(state) {
  const values = GOALS.map((goal) => goalProgress(goal, state).percent);
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function readinessMode(readiness) {
  if (!readiness) return null;
  const sleep = Number(readiness.sleep || 0);
  const energy = Number(readiness.energy || 0);
  const recovery = Number(readiness.recovery || 0);
  const pain = Number(readiness.pain || 0);
  const average = (sleep + energy + recovery) / 3;
  if (readiness.redFlag || readiness.swelling || readiness.gaitChange || readiness.instability || readiness.neurologic || readiness.nextDayWorsening || pain >= 5 || sleep <= 1 || energy <= 1 || recovery <= 1) return "red";
  if (pain >= 3 || average < 3.5) return "yellow";
  return "green";
}

function goalLoad(goalId, week, state, modifier = 1) {
  const goal = goalById(goalId);
  const baseline = getBaseline(goal, state);
  if (!baseline) return null;
  const intent = WEEK_INTENT[clamp(week, 1, 16) - 1];
  const raw = Number(baseline.load) + (Number(goal.target.load) - Number(baseline.load)) * intent.load;
  return roundLoad(raw * modifier * trainingMaxMultiplier(goalId, state), goalId === "squat" ? 5 : 2.5);
}

function setPlan(exerciseId, count, plan) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => ({
    id: `${exerciseId}-set-${index + 1}`,
    index: index + 1,
    planned: { ...plan },
    originalPlanned: { ...plan },
    status: "pending",
    actual: null,
  }));
}

function exercise(config) {
  return {
    alternatives: [],
    cue: "Move with control and stop before technique changes.",
    ...config,
    setsPlan: setPlan(config.id, config.sets, {
      load: config.load,
      reps: config.reps,
      rpe: config.rpe,
      rest: config.rest,
    }),
  };
}

function adjustedSetCount(base, volume) {
  return Math.max(1, Math.round(base * volume));
}

function createNormalExercises(sessionKey, week, state) {
  const intent = WEEK_INTENT[week - 1];
  const deload = phaseForWeek(week).id.startsWith("deload");
  const incline = goalLoad("incline", week, state);
  const ohp = goalLoad("ohp", week, state);
  const chin = goalLoad("chin", week, state);
  const curl = goalLoad("curl", week, state);
  const squat = goalLoad("squat", week, state);
  const backoffs = deload ? 2 : 3;
  const density = PULLUP_DENSITY[week - 1];

  const warm = (id, name, cue) => exercise({ id, name, kind: "warmup", sets: 2, reps: 8, load: null, rest: 45, rpe: 4, cue, alternatives: ["Clinician-approved mobility sequence"] });

  if (sessionKey === "heavy-press") {
    return [
      warm("press-primer", "Press primer", "Scapular control, rotator-cuff activation, then progressive empty-bar reps."),
      exercise({ id: "incline-top", name: "30° Incline Bench · Top Set", goalId: "incline", kind: "top", sets: 1, reps: intent.topReps, load: incline, rest: 240, rpe: deload ? 6 : 8, cue: "Fixed 30° bench. Controlled touch. Stop with one to two clean reps available.", alternatives: ["Neutral-grip dumbbell incline press", "Machine incline press"] }),
      exercise({ id: "incline-backoff", name: "30° Incline Bench · Backoff", goalId: "incline", kind: "backoff", sets: backoffs, reps: 6, load: roundLoad(incline * 0.90), rest: 180, rpe: deload ? 6 : 7.5, cue: "Repeat the same bar path; every rep should look alike.", alternatives: ["Neutral-grip dumbbell incline press"] }),
      exercise({ id: "ohp-strength", name: "Strict Seated OHP", goalId: "ohp", kind: "medium", sets: adjustedSetCount(3, intent.volume), reps: 5, load: roundLoad(ohp * 0.90), rest: 180, rpe: deload ? 6 : 7.5, cue: "No leg drive. Ribs down. Finish stacked over shoulders.", alternatives: ["Neutral-grip dumbbell shoulder press", "Landmine press"] }),
      exercise({ id: "squat-medium", name: "Pain-Controlled Squat · Medium", goalId: "squat", kind: "medium", sets: adjustedSetCount(3, intent.volume), reps: 8, load: squat ? roundLoad(squat * 0.80, 5) : null, rest: 150, rpe: 6.5, cue: "Use the cleared variation and range. Stop if pain exceeds your limit.", alternatives: ["Clinician-approved squat regression", "Supported sit-to-stand"] }),
      exercise({ id: "triceps", name: "Cable Triceps Extension", kind: "accessory", sets: adjustedSetCount(3, intent.volume), reps: 10, load: null, rest: 75, rpe: 8, cue: "Keep shoulders quiet; earn full elbow extension.", alternatives: ["Cross-body cable extension", "Band pressdown"] }),
      exercise({ id: "lateral-raise", name: "Cable Lateral Raise", kind: "accessory", sets: adjustedSetCount(3, intent.volume), reps: 15, load: null, rest: 60, rpe: 8, cue: "Lead with elbows and keep the upper trap relaxed.", alternatives: ["Dumbbell lateral raise"] }),
    ];
  }

  if (sessionKey === "heavy-pull") {
    return [
      warm("pull-primer", "Pull primer", "Scapular pull-ups, easy hangs, and progressive bodyweight reps."),
      exercise({ id: "chin-top", name: "Weighted Chin-Up · Top Set", goalId: "chin", kind: "top", sets: 1, reps: intent.topReps, load: chin, rest: 240, rpe: deload ? 6 : 8, cue: "Dead hang to chin clearly over bar. No kick and no reach with the neck.", alternatives: ["Neutral-grip weighted chin-up", "Heavy pulldown"] }),
      exercise({ id: "chin-backoff", name: "Weighted Chin-Up · Backoff", goalId: "chin", kind: "backoff", sets: backoffs, reps: 6, load: roundLoad(chin * 0.80), rest: 180, rpe: deload ? 6 : 7.5, cue: "Keep every rep strict; remove load before range shortens.", alternatives: ["Band-assisted strict chin-up", "Neutral-grip pulldown"] }),
      exercise({ id: "curl-heavy", name: "Wall-Strict EZ Curl", goalId: "curl", kind: "top", sets: adjustedSetCount(3, intent.volume), reps: 6, load: curl, rest: 150, rpe: deload ? 6 : 8, cue: "Head, back, and hips remain on the wall. No hip drive.", alternatives: ["Cable curl with back supported", "Strict dumbbell curl"] }),
      exercise({ id: "row", name: "Chest-Supported Row", kind: "accessory", sets: adjustedSetCount(3, intent.volume), reps: 8, load: null, rest: 120, rpe: 8, cue: "Pause at the torso without shrugging.", alternatives: ["Seated cable row"] }),
      exercise({ id: "rear-delt", name: "Rear-Delt Cable Fly", kind: "accessory", sets: adjustedSetCount(3, intent.volume), reps: 15, load: null, rest: 60, rpe: 8, cue: "Reach wide; do not turn it into a row.", alternatives: ["Reverse pec deck"] }),
    ];
  }

  if (sessionKey === "heavy-squat") {
    return [
      warm("lower-primer", "Lower-body primer", "Use the exact clinician-approved sequence; build range before load."),
      exercise({ id: "squat-top", name: "Pain-Controlled Squat · Top Set", goalId: "squat", kind: "top", sets: 1, reps: week <= 3 ? 8 : intent.topReps + 2, load: squat, rest: 240, rpe: deload ? 6 : 7.5, cue: "Stable mechanics and approved range. Pain ceiling is a rule, not a suggestion.", alternatives: ["Clinician-approved squat regression", "Box squat to cleared depth"] }),
      exercise({ id: "squat-backoff", name: "Pain-Controlled Squat · Backoff", goalId: "squat", kind: "backoff", sets: deload ? 1 : 2, reps: 8, load: squat ? roundLoad(squat * 0.85, 5) : null, rest: 180, rpe: 6.5, cue: "Same depth and tempo. End the set at the first loss of control.", alternatives: ["Supported split squat", "Leg press in cleared range"] }),
      exercise({ id: "incline-volume", name: "30° Incline Bench · Volume", goalId: "incline", kind: "medium", sets: adjustedSetCount(4, intent.volume), reps: 8, load: roundLoad(incline * 0.80), rest: 150, rpe: deload ? 6 : 7.5, cue: "Submaximal, smooth, and repeatable. Do not chase failure.", alternatives: ["Neutral-grip dumbbell incline press"] }),
      exercise({ id: "ohp-volume", name: "Strict Seated OHP · Volume", goalId: "ohp", kind: "medium", sets: adjustedSetCount(3, intent.volume), reps: 8, load: roundLoad(ohp * 0.78), rest: 150, rpe: deload ? 6 : 7.5, cue: "Keep the torso fixed and stop before the press becomes a backbend.", alternatives: ["Landmine press", "Neutral-grip dumbbell press"] }),
      exercise({ id: "hamstring", name: "Hamstring Curl", kind: "accessory", sets: adjustedSetCount(3, intent.volume), reps: 12, load: null, rest: 75, rpe: 7.5, cue: "Controlled range with no symptom escalation.", alternatives: ["Clinician-approved hamstring isometric"] }),
      exercise({ id: "thursday-delts", name: "Cable Lateral Raise", kind: "accessory", sets: adjustedSetCount(2, intent.volume), reps: 15, load: null, rest: 60, rpe: 8, cue: "Keep the shoulder quiet and stop before upper-trap compensation.", alternatives: ["Dumbbell lateral raise"] }),
      exercise({ id: "thursday-triceps", name: "Cable Triceps Extension", kind: "accessory", sets: adjustedSetCount(2, intent.volume), reps: 12, load: null, rest: 75, rpe: 8, cue: "Smooth elbow extension without shoulder drift.", alternatives: ["Cross-body cable extension", "Band pressdown"] }),
    ];
  }

  return [
    warm("pull-volume-primer", "Pull-volume primer", "Easy scapular pulls, wrist preparation, and two submaximal sets."),
    exercise({ id: "pullup-density", name: `Strict Pull-Up Density · ${density.reps}/min × ${density.minutes}`, goalId: "pullups", kind: "density", sets: 1, reps: density.reps * density.minutes, duration: density.minutes, load: 0, rest: 60, rpe: deload ? 6 : 7.5, cue: `Start each minute with ${density.reps} strict reps. Stop the block if strict range or joint tolerance fails.`, alternatives: ["Band-assisted density block", "Shorter strict density block"] }),
    exercise({ id: "chin-volume", name: "Weighted Chin-Up · Technique Volume", goalId: "chin", kind: "medium", sets: adjustedSetCount(2, intent.volume), reps: 8, load: roundLoad(chin * 0.62), rest: 150, rpe: deload ? 6 : 7, cue: "This comes after density: keep it light, strict, and wrist-neutral. Skip if elbows or grip are irritated.", alternatives: ["Neutral-grip pulldown", "Band-assisted strict chin-up"] }),
    exercise({ id: "saturday-row", name: "Chest-Supported Row", kind: "accessory", sets: adjustedSetCount(3, intent.volume), reps: 10, load: null, rest: 120, rpe: 8, cue: "Pause at the torso without shrugging or extending the low back.", alternatives: ["Seated cable row"] }),
    exercise({ id: "curl-volume", name: "Wall-Strict EZ Curl · Volume", goalId: "curl", kind: "medium", sets: adjustedSetCount(3, intent.volume), reps: 10, load: roundLoad(curl * 0.72), rest: 90, rpe: 7.5, cue: "Keep three-point wall contact and lower under control.", alternatives: ["Back-supported cable curl"] }),
    exercise({ id: "saturday-rear-delt", name: "Rear-Delt Cable Fly", kind: "accessory", sets: adjustedSetCount(3, intent.volume), reps: 15, load: null, rest: 60, rpe: 7.5, cue: "Reach wide; do not turn the rep into a row.", alternatives: ["Reverse pec deck", "Band face pull"] }),
  ];
}

function createSummitExercises(date) {
  if (date === "2026-12-28") return [
    exercise({ id: "summit-incline", name: "Gold Attempt · 30° Incline Bench", goalId: "incline", kind: "test", sets: 1, reps: 8, load: 250, rest: 420, rpe: 10, cue: "Take only after progressive warm-ups. One official attempt; no immediate retry.", alternatives: ["End test and record best clean warm-up"] }),
    exercise({ id: "summit-ohp", name: "Gold Attempt · Strict Seated OHP", goalId: "ohp", kind: "test", sets: 1, reps: 5, load: 185, rest: 420, rpe: 10, cue: "No leg drive or lumbar compensation. One official attempt.", alternatives: ["End test and record best clean warm-up"] }),
  ];
  if (date === "2026-12-29") return [
    exercise({ id: "summit-squat", name: "Gold Attempt · Pain-Controlled Squat", goalId: "squat", kind: "test", sets: 1, reps: 10, load: 200, rest: 420, rpe: 9, cue: "Only test if readiness and symptom response permit. The pain limit remains in force.", alternatives: ["Clinician-approved submaximal assessment"] }),
  ];
  if (date === "2026-12-30") return [
    exercise({ id: "summit-chin", name: "Gold Attempt · Weighted Chin-Up", goalId: "chin", kind: "test", sets: 1, reps: 6, load: 130, rest: 420, rpe: 10, cue: "Strict dead-hang reps. One official attempt.", alternatives: ["End test and record best clean warm-up"] }),
    exercise({ id: "summit-curl", name: "Gold Attempt · Wall-Strict EZ Curl", goalId: "curl", kind: "test", sets: 1, reps: 5, load: 135, rest: 300, rpe: 10, cue: "Three-point wall contact. One official attempt.", alternatives: ["End test and record best clean warm-up"] }),
  ];
  return [
    exercise({ id: "summit-hour", name: "Gold Attempt · Pull-Up Hour", goalId: "pullups", kind: "test", sets: 1, reps: 500, duration: 60, load: 0, rest: 60, rpe: 10, cue: "Alternate 8 and 9 strict reps per minute. The clock runs continuously.", alternatives: ["Record the strict total achieved in 60 minutes"] }),
  ];
}

function applyEdits(exercises, sessionKey, date, state) {
  return exercises.map((item) => {
    const template = state.templateEdits?.[`${sessionKey}:${item.id}`] || {};
    const future = (state.futureEdits || [])
      .filter((edit) => edit.sessionKey === sessionKey && edit.exerciseId === item.id && edit.from <= date)
      .sort((a, b) => a.from.localeCompare(b.from))
      .reduce((merged, edit) => ({ ...merged, ...edit.changes }), {});
    const merged = { ...item, ...template, ...future };
    if (Object.keys(template).length || Object.keys(future).length) {
      merged.userModified = true;
      merged.recommended = {
        name: item.name,
        sets: item.sets,
        reps: item.reps,
        load: item.load,
        rest: item.rest,
        rpe: item.rpe,
        cue: item.cue,
        alternatives: item.alternatives,
      };
      merged.setsPlan = setPlan(merged.id, merged.sets, { load: merged.load, reps: merged.reps, rpe: merged.rpe, rest: merged.rest });
    }
    return merged;
  });
}

export function adaptSession(session, mode) {
  if (!mode || mode === "green") return { ...session, readinessMode: mode || null };
  const adapted = structuredClone(session);
  adapted.readinessMode = mode;
  if (mode === "yellow") {
    adapted.directive = "YELLOW: loads reduced 5%, one backoff set removed, and working RPE capped at 8.";
    adapted.exercises = adapted.exercises.map((item) => {
      const copy = { ...item };
      if (["top", "backoff", "medium", "test"].includes(copy.kind) && Number.isFinite(copy.load)) copy.load = roundLoad(copy.load * 0.95);
      if (copy.kind === "backoff") copy.sets = Math.max(1, copy.sets - 1);
      copy.rpe = Math.min(8, copy.rpe);
      copy.setsPlan = setPlan(copy.id, copy.sets, { load: copy.load, reps: copy.reps, rpe: copy.rpe, rest: copy.rest });
      return copy;
    });
    return adapted;
  }

  adapted.directive = "RED: no heavy goal loading. Approved recovery substitutions count as the scheduled outcome.";
  adapted.approvedModified = true;
  adapted.exercises = adapted.exercises.map((item) => {
    if (["top", "backoff", "medium", "density", "test"].includes(item.kind)) {
      const name = item.alternatives?.[0] || "Clinician-approved recovery / rehab substitute";
      return exercise({
        id: item.id,
        name: `Recovery Substitute · ${name}`,
        originalGoalId: item.goalId || null,
        goalId: null,
        kind: "recovery",
        sets: 2,
        reps: item.kind === "density" ? 5 : 10,
        load: null,
        rest: 60,
        rpe: 5,
        cue: "Keep this easy and clinician-approved. Stop with symptom escalation.",
        alternatives: ["Walking or cleared aerobic recovery", "Clinician-assigned rehab sequence"],
      });
    }
    const copy = { ...item, sets: Math.min(2, item.sets), rpe: Math.min(6, item.rpe) };
    copy.setsPlan = setPlan(copy.id, copy.sets, { load: copy.load, reps: copy.reps, rpe: copy.rpe, rest: copy.rest });
    return copy;
  });
  return adapted;
}

function baseSessionInfo(date) {
  if (SUMMIT[date]) return { ...SUMMIT[date], date, summit: true, week: 16 };
  if (date < CAMPAIGN.start || date > CAMPAIGN.trainingEnd) return null;
  const day = dateFromISO(date).getDay();
  const info = SESSION_DAYS[day];
  if (!info) return null;
  return { ...info, date, summit: false, week: weekForDate(date) };
}

export function sessionInfoForDate(date, state = null) {
  const moves = state?.scheduleMoves || {};
  const movedFrom = Object.entries(moves).find(([, target]) => target === date)?.[0] || null;
  if (moves[date] && !movedFrom) return null;
  const originDate = movedFrom || date;
  const info = baseSessionInfo(originDate);
  return info ? { ...info, date, originDate, movedFrom } : null;
}

export function generateSession(date, state, forceMode = undefined) {
  const info = sessionInfoForDate(date, state);
  if (!info) return null;
  const baseExercises = info.summit ? createSummitExercises(info.originDate) : createNormalExercises(info.key, info.week, state);
  const exercises = applyEdits(baseExercises, info.key, date, state);
  const session = {
    id: `${date}:${info.key}`,
    date,
    week: info.week,
    key: info.key,
    name: info.name,
    code: info.code,
    focus: info.focus,
    duration: info.duration,
    originDate: info.originDate,
    movedFrom: info.movedFrom,
    summit: info.summit,
    status: "planned",
    startedAt: null,
    completedAt: null,
    postPain: null,
    nextDayPain: null,
    exercises,
    readinessMode: null,
    directive: null,
    approvedModified: false,
    backoffTriggered: false,
    backoffObeyed: false,
  };
  const mode = forceMode === undefined ? readinessMode(state.readiness?.[date]) : forceMode;
  return adaptSession(session, mode);
}

export function applyFailedTopSet(session, exerciseId) {
  const copy = structuredClone(session);
  const failed = copy.exercises.find((item) => item.id === exerciseId);
  if (!failed) return copy;
  failed.lockedAfterMiss = true;
  failed.setsPlan = failed.setsPlan.map((set) => set.status === "pending" ? { ...set, status: "skipped", actual: { note: "Automatic no-retry protocol", loggedAt: new Date().toISOString() } } : set);
  copy.backoffTriggered = true;
  copy.directive = "MISS PROTOCOL: no retry. Load reduced 7.5–10%; complete no more than two clean backoff sets.";
  let adjusted = false;
  copy.exercises = copy.exercises.map((item) => {
    if (adjusted || item.kind !== "backoff" || item.goalId !== failed.goalId) return item;
    adjusted = true;
    const next = { ...item, sets: Math.min(2, item.sets), load: Number.isFinite(item.load) ? roundLoad(item.load * 0.925) : item.load, rpe: Math.min(7.5, item.rpe) };
    next.setsPlan = setPlan(next.id, next.sets, { load: next.load, reps: next.reps, rpe: next.rpe, rest: next.rest });
    return next;
  });
  return copy;
}

export function scheduledDatesForWeek(week, state = null) {
  return weekDates(week).filter((date) => Boolean(sessionInfoForDate(date, state)));
}

export function moveWorkoutDate(inputState, from, to) {
  const state = normalizeState(structuredClone(inputState));
  const info = sessionInfoForDate(from, state);
  if (!info) throw new Error("No scheduled workout exists on the source date.");
  if (info.summit) throw new Error("Summit test dates are fixed to preserve the taper and attempt order.");
  if (from === to) return state;
  if (weekForDate(from) !== weekForDate(to) || weekForDate(to) < 1 || weekForDate(to) > 16) {
    throw new Error("A workout can only move within its current campaign week.");
  }
  if (state.weeklyReviews?.[info.week]?.sealedAt) throw new Error("Reopen the sealed week before moving a workout.");
  if (state.workouts?.[from]?.status === "complete") throw new Error("Reopen the completed workout before moving it.");
  if (sessionInfoForDate(to, state) || state.workouts?.[to]) throw new Error("That date already contains a workout.");

  const origin = info.originDate || from;
  state.scheduleMoves[origin] = to;
  if (state.workouts[from]) {
    const moved = structuredClone(state.workouts[from]);
    moved.date = to;
    moved.id = `${to}:${moved.key}`;
    moved.originDate = origin;
    moved.movedFrom = origin;
    state.workouts[to] = moved;
    delete state.workouts[from];
  }
  if (state.readiness[from]) {
    state.readiness[to] = state.readiness[from];
    delete state.readiness[from];
  }
  auditEvent(state, "workout-moved", { from, to, sessionKey: info.key });
  return state;
}

export function resetRecommendedPlan(inputState, date) {
  const state = normalizeState(structuredClone(inputState));
  const info = sessionInfoForDate(date, state);
  if (!info) throw new Error("No scheduled workout exists on this date.");
  if (state.weeklyReviews?.[info.week]?.sealedAt) throw new Error("Reopen the sealed week before resetting its plan.");
  Object.keys(state.templateEdits).forEach((key) => {
    if (key.startsWith(`${info.key}:`)) delete state.templateEdits[key];
  });
  state.futureEdits = state.futureEdits.filter((edit) => edit.sessionKey !== info.key);
  Object.entries(state.workouts).forEach(([workoutDate, workout]) => {
    if (workoutDate >= date && workout?.key === info.key && workout.status !== "complete") delete state.workouts[workoutDate];
  });
  auditEvent(state, "recommended-plan-reset", { from: date, sessionKey: info.key });
  return state;
}

export function restTimerRemaining(timer, now = Date.now()) {
  if (!timer) return 0;
  return timer.running ? Math.max(0, Number(timer.endAt) - now) : Math.max(0, Number(timer.remaining));
}

export function serializeBackup(state) {
  return JSON.stringify(normalizeState(state), null, 2);
}

export function restoreBackup(text) {
  const parsed = typeof text === "string" ? JSON.parse(text) : text;
  if (!parsed || typeof parsed !== "object" || !parsed.schemaVersion || !parsed.settings || !parsed.workouts) {
    throw new Error("Invalid IRON LEDGER backup structure");
  }
  return normalizeState(parsed);
}

function completedOutcome(workout) {
  return workout?.status === "complete" && (workout.approvedModified || workout.exercises?.some((exercise) => exercise.setsPlan?.some((set) => set.status === "complete")));
}

function mainWorkLogged(workout) {
  if (!workout || workout.status !== "complete") return false;
  const completeEvidence = (set) => set.status === "complete" && set.actual && Number.isFinite(Number(set.actual.load)) && Number.isFinite(Number(set.actual.reps)) && Number.isFinite(Number(set.actual.rpe)) && Number.isFinite(Number(set.actual.pain)) && typeof set.actual.clean === "boolean";
  if (workout.approvedModified) return workout.exercises?.some((exercise) => exercise.kind === "recovery" && exercise.setsPlan?.some(completeEvidence));
  return workout.exercises?.some((exercise) => ["top", "test", "density"].includes(exercise.kind) && exercise.setsPlan?.some(completeEvidence));
}

export function weeklyGate(week, state) {
  const dates = weekDates(week);
  const scheduled = scheduledDatesForWeek(week, state);
  const completed = scheduled.filter((date) => completedOutcome(state.workouts?.[date])).length;
  const proteinValues = dates.map((date) => Number(state.daily?.[date]?.protein)).filter((value) => Number.isFinite(value) && value >= 0);
  const proteinAverage = proteinValues.length ? Math.round(proteinValues.reduce((sum, value) => sum + value, 0) / proteinValues.length) : 0;
  const weighIns = dates.map((date) => Number(state.daily?.[date]?.weight)).filter((value) => Number.isFinite(value) && value > 0);
  const mainLogs = scheduled.filter((date) => mainWorkLogged(state.workouts?.[date])).length;
  const review = state.weeklyReviews?.[week] || {};
  const checks = [
    { id: "workouts", label: "4 scheduled outcomes", value: `${completed}/4`, pass: completed >= 4 },
    { id: "protein-days", label: "7 protein entries", value: `${proteinValues.length}/7`, pass: proteinValues.length >= 7 },
    { id: "protein-average", label: `Average ≥ ${state.settings.proteinTarget} g protein`, value: `${proteinAverage} g`, pass: proteinAverage >= Number(state.settings.proteinTarget) },
    { id: "weigh-ins", label: "3 standardized weigh-ins", value: `${weighIns.length}/3`, pass: weighIns.length >= 3 },
    { id: "main-logs", label: "Main work logged", value: `${mainLogs}/4`, pass: mainLogs >= 4 },
    { id: "backoff", label: "Backoff rule honored", value: review.backoffConfirmed ? "Confirmed" : "Open", pass: Boolean(review.backoffConfirmed) },
  ];
  const eligibleToSeal = checks.every((check) => check.pass);
  const sealed = Boolean(review.sealedAt);
  return {
    week,
    dates,
    scheduled,
    completed,
    proteinValues,
    proteinAverage,
    weighIns,
    weightAverage: weighIns.length ? weighIns.reduce((sum, value) => sum + value, 0) / weighIns.length : 0,
    mainLogs,
    checks,
    eligibleToSeal,
    sealed,
    complete: eligibleToSeal && sealed,
  };
}

export function readinessCounts(week, state) {
  return scheduledDatesForWeek(week, state).reduce((counts, date) => {
    const mode = state.workouts?.[date]?.readinessMode || readinessMode(state.readiness?.[date]);
    if (mode) counts[mode] += 1;
    return counts;
  }, { green: 0, yellow: 0, red: 0 });
}

export function reviewPayload(week, state) {
  const gate = weeklyGate(week, state);
  const counts = readinessCounts(week, state);
  const weights = gate.dates.map((date) => ({ date, weight: state.daily?.[date]?.weight })).filter((entry) => Number(entry.weight) > 0);
  const priorGate = week > 1 ? weeklyGate(week - 1, state) : null;
  const weightTrend = gate.weightAverage && priorGate?.weightAverage ? gate.weightAverage - priorGate.weightAverage : null;
  const sessions = gate.scheduled.map((date) => {
    const workout = state.workouts?.[date];
    const info = sessionInfoForDate(date, state);
    const completed = completedOutcome(workout);
    const modified = Boolean(workout?.approvedModified || workout?.userModified || workout?.exercises?.some((exercise) => exercise.userModified));
    return {
      date,
      name: workout?.name || info?.name || "Scheduled workout",
      planned: true,
      outcome: completed ? (modified ? "modified" : "full") : date < todayISO() ? "missed" : "planned",
      readiness: workout?.readinessMode || readinessMode(state.readiness?.[date]),
      postPain: workout?.postPain ?? null,
      nextDayPain: workout?.nextDayPain ?? null,
    };
  });
  const topSets = gate.scheduled.flatMap((date) => {
    const workout = state.workouts?.[date];
    return (workout?.exercises || []).filter((exercise) => ["top", "test", "density"].includes(exercise.kind)).flatMap((exercise) =>
      (exercise.setsPlan || []).filter((set) => set.status === "complete" && set.actual).map((set) => {
        const estimateLoad = exercise.goalId === "chin" ? Number(set.actual.load) + Number(state.daily?.[date]?.weight || state.settings.bodyweight || 0) : Number(set.actual.load);
        return {
          date,
          goalId: exercise.goalId,
          exercise: exercise.name,
          planned: set.planned,
          actual: set.actual,
          e1rm: exercise.kind === "density" ? null : Math.round(estimatedOneRepMax(estimateLoad, set.actual.reps, set.actual.rpe)),
          e1rmBasis: exercise.goalId === "chin" ? "system load" : "bar load",
          duration: set.actual.duration ?? exercise.duration ?? null,
        };
      })
    );
  });
  const pullSets = topSets.filter((set) => set.goalId === "pullups");
  const pullup = pullSets.length ? {
    total: Math.max(...pullSets.map((set) => Number(set.actual.reps || 0))),
    longestProvenMinutes: Math.max(...pullSets.map((set) => Number(set.duration || 0))),
    bestPace: Math.max(...pullSets.map((set) => Number(set.duration) > 0 ? Number(set.actual.reps || 0) / Number(set.duration) : 0)),
  } : { total: 0, longestProvenMinutes: 0, bestPace: 0 };
  const progress = GOALS.map((goal) => {
    const status = goalProgress(goal, state);
    return { id: goal.id, name: goal.name, target: goal.targetText, percent: status.percent, remaining: status.remaining };
  });
  const nextWeek = Math.min(16, week + 1);
  const nextIntent = WEEK_INTENT[nextWeek - 1];
  const successful = gate.complete;
  const earnedThisWeek = earnedBadges(state).filter((badge) => badge.earned && badge.earnedAt && weekForDate(badge.earnedAt) === week).map((badge) => badge.name);
  const cache = state.caches?.[week] || {};
  const narrative = [
    `${CAMPAIGN.name} · Week ${week} ${successful ? "sealed" : "in progress"}.`,
    `${gate.completed}/4 training outcomes completed; main work logged ${gate.mainLogs}/4.`,
    `${gate.proteinValues.length}/7 protein entries averaged ${gate.proteinAverage} g/day against a ${state.settings.proteinTarget} g target.`,
    `${gate.weighIns.length} standardized weigh-ins${gate.weighIns.length ? ` averaged ${gate.weightAverage.toFixed(1)} lb${weightTrend === null ? "" : ` (${weightTrend >= 0 ? "+" : ""}${weightTrend.toFixed(1)} lb vs prior week)`}` : " recorded"}.`,
    `Readiness: ${counts.green} green, ${counts.yellow} yellow, ${counts.red} red.`,
    `Pull-up proof: ${pullup.total} reps across ${pullup.longestProvenMinutes} min at best ${pullup.bestPace.toFixed(1)} reps/min.`,
    `Next: Week ${nextWeek} — ${nextIntent.label}.`,
  ].join(" ");
  return {
    schema: "project52.iron-ledger.weekly-review.v1",
    generatedAt: new Date().toISOString(),
    campaign: CAMPAIGN.name,
    week,
    period: { start: gate.dates[0], end: gate.dates[6] },
    status: successful ? "sealed" : "open",
    compliance: {
      workouts: { completed: gate.completed, required: 4 },
      mainLogs: { completed: gate.mainLogs, required: 4 },
      protein: { days: gate.proteinValues.length, average: gate.proteinAverage, target: state.settings.proteinTarget },
      weighIns: { count: gate.weighIns.length, required: 3, values: weights },
      weightTrend,
      readiness: counts,
      backoffConfirmed: Boolean(state.weeklyReviews?.[week]?.backoffConfirmed),
    },
    goalProgress: progress,
    sessions,
    topSets,
    pullup,
    phase: { current: phaseForWeek(week).name, next: phaseForWeek(nextWeek).name, nextIntent: nextIntent.label },
    rewards: { badgesEarned: earnedThisWeek, cache: { unlocked: Boolean(cache.unlockedAt), status: cache.status || "locked" } },
    audit: (state.audit || []).filter((entry) => entry.week === week || (entry.date && weekForDate(entry.date) === week) || (entry.from && weekForDate(entry.from) === week)),
    reflection: {
      win: state.weeklyReviews?.[week]?.win || "",
      lesson: state.weeklyReviews?.[week]?.lesson || "",
      nextAction: state.weeklyReviews?.[week]?.nextAction || "",
    },
    nextWeek: { week: nextWeek, intent: nextIntent.label, phase: phaseForWeek(nextWeek).name },
    narrative,
  };
}

export function decodedCache(week) {
  const row = CACHE_VAULT.find(([number]) => number === Number(week));
  if (!row) return null;
  const decode = (value) => {
    try { return decodeURIComponent(escape(atob(value))); } catch { return atob(value); }
  };
  return { week: row[0], value: row[1], title: decode(row[2]), reason: decode(row[3]) };
}

export function earnedBadges(state) {
  const earned = new Map();
  const completedWorkouts = Object.values(state.workouts).filter(completedOutcome);
  if (completedWorkouts.length) earned.set("first-workout", completedWorkouts.sort((a, b) => a.date.localeCompare(b.date))[0].date);
  if (completedWorkouts.some((workout) => workout.readinessMode === "green")) earned.set("green-session", completedWorkouts.find((workout) => workout.readinessMode === "green")?.date);
  if (completedWorkouts.some((workout) => workout.readinessMode === "yellow")) earned.set("yellow-discipline", completedWorkouts.find((workout) => workout.readinessMode === "yellow")?.date);
  if (completedWorkouts.some((workout) => workout.readinessMode === "red" && workout.approvedModified)) earned.set("red-discipline", completedWorkouts.find((workout) => workout.readinessMode === "red")?.date);
  if (completedWorkouts.some((workout) => workout.backoffTriggered && workout.backoffObeyed)) earned.set("backoff", completedWorkouts.find((workout) => workout.backoffTriggered && workout.backoffObeyed)?.date);
  if (state.baselines?.squat) earned.set("baseline-bound", state.baselines.squat.date);

  let currentStreak = 0;
  let maxStreak = 0;
  for (let week = 1; week <= 16; week += 1) {
    const gate = weeklyGate(week, state);
    if (gate.complete) {
      earned.set("review-sealed", state.weeklyReviews?.[week]?.sealedAt?.slice(0, 10) || gate.dates[6]);
      earned.set("clean-week", gate.dates[6]);
      earned.set("protein-week", gate.dates[6]);
      earned.set("weight-week", gate.dates[6]);
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }
  [2, 4, 8, 12, 16].forEach((length) => {
    if (maxStreak >= length) earned.set(`streak-${length}`, new Date().toISOString().slice(0, 10));
  });

  const pullEvidence = collectEvidence(state, "pullups");
  const maxAny = Math.max(0, ...pullEvidence.map((item) => Number(item.total || 0)));
  if (maxAny >= 100) earned.set("pull-100", pullEvidence.find((item) => Number(item.total) >= 100)?.date);
  if (maxAny >= 200) earned.set("pull-200", pullEvidence.find((item) => Number(item.total) >= 200)?.date);
  if (pullEvidence.some((item) => Number(item.total) >= 300 && Number(item.duration) >= 60)) earned.set("pull-300", pullEvidence.find((item) => Number(item.total) >= 300 && Number(item.duration) >= 60)?.date);
  if (pullEvidence.some((item) => Number(item.total) >= 400 && Number(item.duration) >= 60)) earned.set("pull-400", pullEvidence.find((item) => Number(item.total) >= 400 && Number(item.duration) >= 60)?.date);
  if (pullEvidence.some((item) => Number(item.total) >= 500 && Number(item.duration) >= 60)) earned.set("pull-500", pullEvidence.find((item) => Number(item.total) >= 500 && Number(item.duration) >= 60)?.date);

  GOALS.forEach((goal) => {
    medalStatus(goal, state).forEach((medal) => {
      if (medal.earned) earned.set(`${goal.id}-${medal.tier.toLowerCase()}`, medal.earnedAt);
    });
  });

  return BADGES.map((badge) => ({ ...badge, earned: earned.has(badge.id), earnedAt: earned.get(badge.id) || null }));
}

export function averageGoalProgress(state) {
  return Math.round(GOALS.reduce((sum, goal) => sum + goalProgress(goal, state).percent, 0) / GOALS.length);
}

export function monthGrid(monthISO) {
  const [year, month] = monthISO.split("-").map(Number);
  const first = new Date(year, month - 1, 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date: isoFromDate(date), inMonth: date.getMonth() === month - 1 };
  });
}

export function shiftMonth(monthISO, amount) {
  const [year, month] = monthISO.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthISO) {
  const [year, month] = monthISO.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1, 12));
}
