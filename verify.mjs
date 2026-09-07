import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CACHE_LINKS, CAMPAIGN, GOALS, PULLUP_DENSITY, SESSION_DAYS } from "../dist/data.js";
import {
  applyFailedTopSet,
  averageGoalProgress,
  decodedCache,
  defaultState,
  generateSession,
  goalProgress,
  medalStatus,
  moveWorkoutDate,
  readinessMode,
  resetRecommendedPlan,
  restTimerRemaining,
  restoreBackup,
  reviewPayload,
  scheduledDatesForWeek,
  serializeBackup,
  sessionInfoForDate,
  trainingMaxMultiplier,
  weekDates,
  weekForDate,
  weeklyGate,
} from "../dist/core.js";

const root = resolve(import.meta.dirname, "..");
const state = defaultState();
let checks = 0;
const verify = (condition, message) => { assert.ok(condition, message); checks += 1; };

// 1. Standalone campaign shell and immutable six-mission contract.
assert.equal(GOALS.length, 6); checks += 1;
assert.equal(GOALS.every((goal) => goal.medals.length === 3), true); checks += 1;
assert.equal(CAMPAIGN.name, "IRON LEDGER // SIXFOLD"); checks += 1;
assert.equal(GOALS.find((goal) => goal.id === "squat").target.reps, 10); checks += 1;
assert.equal(averageGoalProgress(state), 0); checks += 1;
GOALS.forEach((goal) => {
  assert.equal(goalProgress(goal, state).percent, 0); checks += 1;
  assert.equal(medalStatus(goal, state).some((medal) => medal.earned), false); checks += 1;
});

// 2. Calendar, four-day skeleton, phases, and fixed Summit dates.
assert.equal(weekForDate(CAMPAIGN.start), 1); checks += 1;
assert.equal(weekForDate("2026-12-27"), 16); checks += 1;
[["2026-09-07", "heavy-press"], ["2026-09-08", "heavy-pull"], ["2026-09-10", "heavy-squat"], ["2026-09-12", "medium-pull"], ["2026-12-31", "summit-hour"]].forEach(([date, key]) => {
  assert.equal(sessionInfoForDate(date).key, key); checks += 1;
});
assert.deepEqual(Object.keys(SESSION_DAYS).map(Number), [1, 2, 4, 6]); checks += 1;
assert.equal(PULLUP_DENSITY.length, 16); checks += 1;

// 3. Green / Yellow / Red readiness and exact Red stop signals.
assert.equal(readinessMode({ sleep: 5, energy: 4, recovery: 4, pain: 1 }), "green"); checks += 1;
assert.equal(readinessMode({ sleep: 3, energy: 3, recovery: 3, pain: 3 }), "yellow"); checks += 1;
for (const redSignal of [{ pain: 5 }, { swelling: true }, { gaitChange: true }, { instability: true }, { neurologic: true }, { nextDayWorsening: true }]) {
  assert.equal(readinessMode({ sleep: 5, energy: 5, recovery: 5, pain: 0, ...redSignal }), "red"); checks += 1;
}

// 4. Recommended programming, Yellow reduction, Red substitution, and miss protocol.
const green = generateSession("2026-09-07", state, "green");
verify(green.exercises.some((exercise) => exercise.goalId === "incline"), "Monday must train incline");
verify(green.exercises.some((exercise) => exercise.goalId === "squat"), "Monday must include medium squat");
const yellow = generateSession("2026-09-07", state, "yellow");
verify(yellow.exercises.find((exercise) => exercise.id === "incline-top").load < green.exercises.find((exercise) => exercise.id === "incline-top").load, "Yellow must reduce load");
verify(yellow.exercises.find((exercise) => exercise.id === "incline-backoff").sets < green.exercises.find((exercise) => exercise.id === "incline-backoff").sets, "Yellow must remove a backoff");
const red = generateSession("2026-09-07", state, "red");
assert.equal(red.approvedModified, true); checks += 1;
assert.equal(red.exercises.some((exercise) => exercise.goalId), false); checks += 1;
const missed = applyFailedTopSet(green, "incline-top");
assert.equal(missed.backoffTriggered, true); checks += 1;
verify(missed.exercises.find((exercise) => exercise.id === "incline-backoff").sets <= 2, "Miss protocol caps backoffs at two");
verify(missed.exercises.find((exercise) => exercise.id === "incline-backoff").load < green.exercises.find((exercise) => exercise.id === "incline-backoff").load, "Miss protocol reduces backoff load");

// 5. Progress scoring and medals require post-baseline, criterion-valid evidence.
const scoring = defaultState();
scoring.evidence.push({ id: "incline-improvement", goalId: "incline", date: "2026-09-14", load: 225, reps: 8, rpe: 9, pain: 0, clean: true });
verify(goalProgress(GOALS[0], scoring).percent > 0, "Verified improvement must move the dial");
assert.equal(medalStatus(GOALS[0], scoring).find((medal) => medal.tier === "Bronze").earned, true); checks += 1;
scoring.evidence.push({ id: "short-500", goalId: "pullups", date: "2026-09-15", total: 500, duration: 10, clean: true });
assert.equal(medalStatus(GOALS.find((goal) => goal.id === "pullups"), scoring).some((medal) => medal.earned), false); checks += 1;
const squatState = defaultState();
squatState.baselines.squat = { evidenceId: "sq-base", load: 135, reps: 10, rpe: 8, pain: 1, nextDayPain: 1, clean: true, date: CAMPAIGN.start };
squatState.evidence.push({ id: "sq-base", goalId: "squat", load: 135, reps: 10, rpe: 8, pain: 1, nextDayPain: 1, clean: true, date: CAMPAIGN.start });
squatState.evidence.push({ id: "bad-next-day", goalId: "squat", load: 200, reps: 10, rpe: 9, pain: 1, nextDayPain: 4, clean: true, date: "2026-12-20" });
assert.equal(medalStatus(GOALS.find((goal) => goal.id === "squat"), squatState).find((medal) => medal.tier === "Gold").earned, false); checks += 1;

// 6. Workout edits, date moves, history preservation, and recommended reset.
const editable = defaultState();
editable.templateEdits["heavy-press:incline-top"] = { load: 222.5, rest: 300 };
assert.equal(generateSession("2026-09-07", editable, "green").exercises.find((exercise) => exercise.id === "incline-top").load, 222.5); checks += 1;
const reset = resetRecommendedPlan(editable, "2026-09-07");
assert.equal(generateSession("2026-09-07", reset, "green").exercises.find((exercise) => exercise.id === "incline-top").load, 215); checks += 1;
const moveSeed = defaultState();
moveSeed.readiness["2026-09-07"] = { sleep: 5, energy: 5, recovery: 5, pain: 0 };
moveSeed.workouts["2026-09-07"] = generateSession("2026-09-07", moveSeed, "green");
const moved = moveWorkoutDate(moveSeed, "2026-09-07", "2026-09-09");
assert.equal(sessionInfoForDate("2026-09-07", moved), null); checks += 1;
assert.equal(sessionInfoForDate("2026-09-09", moved).key, "heavy-press"); checks += 1;
assert.equal(moved.workouts["2026-09-09"].originDate, "2026-09-07"); checks += 1;
assert.equal(Boolean(moved.workouts["2026-09-07"]), false); checks += 1;

// 7. Persistent rest timing and validated backup / restore.
assert.equal(restTimerRemaining({ running: true, endAt: 10_000, remaining: 99_000 }, 7_500), 2_500); checks += 1;
assert.equal(restTimerRemaining({ running: false, endAt: 10_000, remaining: 4_000 }, 7_500), 4_000); checks += 1;
const roundTrip = restoreBackup(serializeBackup(moved));
assert.equal(roundTrip.scheduleMoves["2026-09-07"], "2026-09-09"); checks += 1;
assert.throws(() => restoreBackup("{}"), /Invalid IRON LEDGER/); checks += 1;

// 8. Weekly gates, recovery entries, sealing prerequisites, and review payload.
const compliant = defaultState();
for (const date of scheduledDatesForWeek(1, compliant)) {
  const workout = generateSession(date, compliant, "green");
  const main = workout.exercises.find((exercise) => ["top", "density"].includes(exercise.kind));
  main.setsPlan[0].status = "complete";
  main.setsPlan[0].actual = { load: main.load || 0, reps: main.reps, duration: main.duration || null, rpe: 8, pain: 0, clean: true };
  workout.status = "complete";
  compliant.workouts[date] = workout;
}
weekDates(1).forEach((date, index) => { compliant.daily[date] = { protein: 180, ...(index < 3 ? { weight: 205 - index * 0.2 } : {}) }; });
compliant.weeklyReviews[1] = { backoffConfirmed: true };
assert.equal(weeklyGate(1, compliant).eligibleToSeal, true); checks += 1;
compliant.weeklyReviews[1].sealedAt = new Date().toISOString();
assert.equal(weeklyGate(1, compliant).complete, true); checks += 1;
const review = reviewPayload(1, compliant);
assert.equal(review.sessions.length, 4); checks += 1;
assert.equal(review.compliance.protein.days, 7); checks += 1;
verify(Array.isArray(review.topSets), "Review must contain headline set detail");
verify(review.goalProgress.every((goal) => "remaining" in goal), "Review must include remaining work for all goals");

// 9. All sixteen caches begin locked, total exactly $1,000, and each has an unlock-time link/check.
assert.equal(Object.keys(state.caches).length, 0); checks += 1;
const cacheTotal = Array.from({ length: 16 }, (_, index) => decodedCache(index + 1).value).reduce((sum, value) => sum + value, 0);
assert.equal(cacheTotal, 1000); checks += 1;
assert.deepEqual(Array.from({ length: 16 }, (_, index) => decodedCache(index + 1).value).reduce((counts, value) => ({ ...counts, [value]: (counts[value] || 0) + 1 }), {}), { 25: 7, 50: 5, 100: 2, 150: 1, 225: 1 }); checks += 1;
assert.equal(Object.keys(CACHE_LINKS).length, 16); checks += 1;
verify(Object.values(CACHE_LINKS).every((entry) => entry.url.startsWith("https://") && entry.check), "Each reward needs a current-link check");

// 10. Static PWA shell, offline fallback, mobile timing clarity, and guided density controls.
const files = {};
for (const file of ["index.html", "styles.css", "app.js", "core.js", "data.js", "manifest.webmanifest", "service-worker.js", "icon.svg"]) {
  files[file] = await readFile(resolve(root, "dist", file), "utf8");
  verify(files[file].length > 20, `${file} should not be empty`);
}
const manifest = JSON.parse(files["manifest.webmanifest"]);
assert.equal(manifest.display, "standalone"); checks += 1;
assert.equal(manifest.short_name, "SIXFOLD"); checks += 1;
verify(files["service-worker.js"].includes('caches.match("./index.html")'), "Service worker needs an offline route fallback");
verify(files["app.js"].includes("FULL SESSION ESTIMATE") && files["app.js"].includes("REST AFTER SET"), "Mobile timing must distinguish session duration from rest");
verify(!files["app.js"].includes("year: true"), "Workout routes must use valid Intl.DateTimeFormat year options");
for (const control of ["data-start-set", "data-log-set", "data-density-clock", "data-density-minute", "data-density-finish"]) verify(files["app.js"].includes(control), `Missing guided control: ${control}`);

// 11. Clickable calendar, collapsible columns, review reopening, and reward recalculation hooks.
verify(files["app.js"].includes("data-open-workout"), "Calendar days must open workouts");
verify(files["app.js"].includes("data-collapse-key"), "Mission and exercise columns must be collapsible");
verify(files["app.js"].includes("data-reopen-week") && files["app.js"].includes("unlockValid: false"), "Reopening must invalidate and recalculate the cache");
verify(files["app.js"].includes("data-reset-recommended") && files["app.js"].includes("data-move-workout"), "Workout reset and movement controls are required");

// 12. Standalone privacy boundary: no Project 52 UI coupling; export is one-way and explicit.
assert.equal(/NORTHSTAR/i.test(files["index.html"] + files["app.js"]), false); checks += 1;
assert.equal(/Project 52/i.test(files["index.html"]), false); checks += 1;
verify(files["app.js"].includes("project52.json"), "Project 52 must remain available only as a review export");
verify(files["app.js"].includes("localStorage.setItem(STORAGE_KEY"), "User data must stay in local browser storage");
assert.equal(trainingMaxMultiplier("incline", state), 1); checks += 1;

console.log(`SIXFOLD acceptance verification passed: ${checks} assertions across all 12 brief criteria.`);
