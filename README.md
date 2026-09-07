# IRON LEDGER // SIXFOLD

A standalone, mobile-first progressive web app for a sixteen-week strength campaign running September 7 through December 31, 2026. SIXFOLD is the campaign name; IRON LEDGER remains the product family.

## Six Gold missions

- 30° incline bench: 250 lb × 8
- Strict seated overhead press: 185 lb × 5
- Weighted chin-up: +130 lb × 6
- Strict pull-ups: 500 in 60 minutes
- Wall-strict EZ curl: 135 lb × 5
- Pain-controlled squat: 200 lb × 10

All progress starts at 0% and measures only the baseline-to-Gold gap closed after the campaign begins. Medals require verified standards; estimated performance can move a dial but cannot award a medal.

## Run locally

```bash
npm run serve
```

Open `http://localhost:4173`. The app has no runtime dependencies or build step.

On workout screens, `04:00` is explicitly labeled as **rest after a heavy set**. The full session estimate appears separately at the top (for example, `70–90 min`).

## Data and deployment

The app stores workouts, readiness, nutrition, weigh-ins, reviews, badges, and reward decisions in browser `localStorage`. Use Settings → Backup before clearing site data or moving devices.

The `dist/` directory is deployable as a static site on GitHub Pages, Cloudflare Pages, Netlify, or any basic web host. A service worker provides the cached app shell for offline use after the first successful load.

The Project 52 connection is intentionally one-way: Review → Export JSON creates a weekly upload file without coupling this app's storage to Project 52.

## Safety

IRON LEDGER organizes training; it does not provide medical diagnosis or treatment. Clinician guidance and the configured pain ceiling override every squat prescription, goal, badge, and reward.
