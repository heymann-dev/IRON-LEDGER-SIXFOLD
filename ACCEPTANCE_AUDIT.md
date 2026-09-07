# IRON LEDGER // SIXFOLD — Build-Brief Acceptance Audit

Authoritative source audited: `IRON_LEDGER_16_WEEK_BUILD_BRIEF.docx` (10 pages).  
Campaign: September 7–December 31, 2026.  
Automated result: **94 assertions passed across all 12 acceptance areas.**

| # | Required outcome | Result | Evidence in this build |
|---|---|---|---|
| 1 | Standalone app, separate from Project 52 | PASS | Independent manifest, icon, service worker, local storage, navigation, and deploy shell. Project 52 appears only as an explicit weekly JSON export. |
| 2 | Six locked Gold missions; progress starts at 0% | PASS | All six baseline-to-Gold dials initialize at 0%. Each ticker shows `% CLOSED` and exact work remaining. Baselines award no medals. |
| 3 | Correct 16-week training architecture | PASS | Foundation, deloads in Weeks 4/8/12, strength, specificity, realization, taper, and fixed Dec 28–31 Summit tests are encoded. |
| 4 | Fixed four-day rhythm and clickable calendar | PASS | Mon heavy press + medium squat; Tue heavy pull; Thu heavy squat + medium press; Sat medium pull + density. Every programmed calendar cell opens its workout. |
| 5 | Guided workout, not a static checklist | PASS | Readiness → Start Set → Log Set → persistent rest → finish. Load, reps, RPE, pain, technique, notes, per-set rest, skip, edit, add, delete, and reorder are supported. |
| 6 | Nonnegotiable autoregulation and pain rules | PASS | Yellow applies −5%, removes a backoff, and caps RPE. Red removes heavy goal loading. Failed top sets cannot add retries and trigger −7.5% to −10% / maximum-two-backoff logic. Squat same-day and next-day pain govern valid evidence. |
| 7 | True pull-up endurance console | PASS | A continuous timestamp-based clock, current-minute target, strict-rep tally, rotating grip cue, stop rule, and 20–60 clickable minute ledger are present. Only proven elapsed duration is saved; no 10-minute result is extrapolated to an hour medal. |
| 8 | Workout editing with history preservation | PASS | Today-only, future-from-date, and full uncompleted-template scopes; approved substitutions; exercise reorder; same-week workout move; reopen; and Reset to Recommended Plan are implemented. Completed history and medal definitions remain separate. |
| 9 | Protein, bodyweight, compliance, and weekly gate | PASS | Seven editable protein entries with ≥170 g weekly average, three standardized weigh-ins, four outcomes, headline logging, and backoff confirmation are required before sealing. Approved Yellow/Red work counts; medical care is never gated. |
| 10 | Auto-generated weekly review and Project 52 handoff | PASS | Planned/full/modified/missed outcomes, protein, weight trend, top sets/e1RM, pain/RPE/technique, pull-up pace/duration, goal gaps, phase/next-week intent, badges, cache state, narrative, and compact JSON are generated. Sealed snapshots archive on reopen. |
| 11 | Badges and 16 hidden caches | PASS | Every badge and cache begins locked. Values total exactly $1,000: one $150, seven $25, five $50, two $100, and one $225. Claim, bank, equal-value swap, missed-week recovery, reveal-only illustrations, unlock-time links/checks, and the Altra Experience Wild 3 Week-1 shortlist are present. |
| 12 | Installability, offline routing, privacy, and recovery | PASS | Standalone PWA manifest, versioned offline app-shell fallback, timestamp-rest recovery, vibration control, validated full backup/restore, local-only data, and the static-source reward-secrecy caveat are present. |

## Mobile clarification fixed

The former `4 min rest` wording could look like a four-minute workout on a narrow screen. It now appears as **`REST AFTER SET 04:00`**, while the workout header separately displays **`FULL SESSION ESTIMATE 70–90 min`** (or the correct estimate for that session).

## Verification command

```bash
node ./scripts/verify.mjs
```

Expected result:

```text
SIXFOLD acceptance verification passed: 94 assertions across all 12 brief criteria.
```
