# UAE Family AI Game Day
### Freeze & Fool, Football & Action Detective

A single web app with three family games for the **Family AI Game Day competition (United Arab Emirates, Cycle 3, Grades 9–12)**. The AI watches real gameplay through the camera, extracts measurements, and a deterministic rules engine turns them into points. Every verdict shows its evidence and explanation.

| Game | What the AI measures | How points are decided |
|---|---|---|
| 🧊 **Freeze & Fool** (original) | Multi-person body pose (MediaPipe Pose Landmarker), segment directions, joint positions, movement during the freeze | Similarity 60 + required positions 25 + stability 15 |
| ⚽ **AI Football** (mandatory) | Ball position every frame (colour tracker + EfficientDet "sports ball" detector), trajectory vs. calibrated goal lines, players | 1 point per **confirmed** goal (tracked approach → crossing between the posts → ball seen inside) |
| 🕵️ **Action Detective** (original) | Body-landmark *sequences*: rhythm, amplitude, hand zones, left/right coordination, steps, sway | Performer: AI match 60 + movement cues 25 · first correct guesser: 15 |

All AI inference runs **in the browser on the player's device**. Video is never uploaded. There are no API keys and no backend.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173  (camera works on localhost)
```

Requirements: Node 18+ (20 recommended) and a recent Chrome, Edge, Safari or Firefox. The MediaPipe WASM runtime is copied from `node_modules` into `public/mediapipe/` automatically (`npm run prepare-assets`). The two model files are committed in `public/models/`.

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm test` | 72 unit tests (Vitest): scoring boundaries, goal validation, duplicates, answer matching, timers, ties, uncertainty, persistence, UAE time |
| `npm run build` | Type-check and build the production site into `dist/` |
| `node scripts/serve-dist.mjs 4173` | Serve `dist/` with the **production security headers** |
| `python3 -I scripts/make_fixtures.py test-artifacts/fixtures` | Build fake-camera test videos (real photos + synthetic pitch) |
| `npm run test:e2e` | 8 end-to-end scenarios in real Chromium with the real models, a fake camera and recorded-video uploads |

## Deployment

The build is a static site (`dist/`). Any HTTPS static host works. A GitHub Pages workflow is included (`.github/workflows/deploy-pages.yml`), as well as `vercel.json`, `netlify.toml` and `public/_headers` (Cloudflare Pages / Netlify). See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the UAE hosting evaluation, step-by-step instructions, connecting a `.ae` domain, and the post-deployment checklist.

> **Status:** not yet deployed. Creating the public hosting repository needs the project owner's action (see DEPLOYMENT.md, "Fastest path"). No live URL is claimed until one has been tested.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): technical architecture summary for the competition report
- [docs/SCORING.md](docs/SCORING.md): every formula and rule the judge uses
- [docs/TESTING.md](docs/TESTING.md): automated test results, measured model behaviour, manual and real-world test checklists
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md): known limitations and honest performance findings
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md): a 5-minute demonstration script for judges
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): hosting and the `.ae` domain

## Project structure

```
src/
  core/            types (shared evidence format), rules engine, store (persistence), match operations, achievements
  perception/      MediaPipe runtime, body geometry, person tracker, colour ball tracker, overlay drawing
  camera/          camera permissions & errors, shared VideoStage (live or recorded), optional recorder
  games/freeze/    pose library (12 poses), kinematics/illustration, evaluator, round state machine, game UI
  games/football/  geometry, goal-verification pipeline, calibration + match UI
  games/action/    action library (22 actions), temporal features, evaluator, answer matching, game UI
  screens/         Home, Setup (players/teams/rules), Match, Results, History, Settings, Privacy, How to play
  i18n/            English dictionary + RTL-ready structure for a reviewed Arabic translation
  ui/              Layout (UAE branding, UAE clock), shared components, evidence card with host review
scripts/           e2e tests, fixture generator, production-header static server, WASM copy
```

## Privacy in one paragraph

The camera turns on only on a game screen and shows a badge while on. Analysis happens on the device. Names, results and small evidence snapshots stay in the browser (localStorage / IndexedDB). Recordings are off by default. Settings has one-click deletion of recordings and history. The app does no face recognition and builds no biometric profile. Footage is never used for training. Full notice: in the app, under Privacy.

## Credits & licences

Pose and object detection: [MediaPipe Tasks](https://developers.google.com/mediapipe) (Apache-2.0) with the Pose Landmarker (lite) and EfficientDet-Lite0 (COCO) models. All poses, actions, rules, illustrations and code in this repository are original to this project.
