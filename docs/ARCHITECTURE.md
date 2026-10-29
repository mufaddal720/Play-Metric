# Technical architecture (competition report summary)

## Design principles
1. **AI observes, rules decide.** Neural networks only produce observations (joint coordinates, ball positions). Deterministic, unit-tested evaluators convert them into points with published formulas ([SCORING.md](SCORING.md)).
2. **Honest uncertainty.** When observations are insufficient, the system produces *no score* and asks for a retake or host review. Host decisions never overwrite the AI record silently.
3. **Privacy by design.** All inference runs on the device in the browser. There is no backend and no upload. Data stays in the browser, recordings are off by default, and there is no face or identity recognition.
4. **One app, three evaluators.** Shared navigation, players/teams, camera, evidence model, rules engine and results. Each game has its own evaluator, because the gameplay is fundamentally different.

## Stack
React 18 + TypeScript + Vite · Tailwind CSS · Zustand (persisted state) · IndexedDB (idb-keyval) for evidence images and clips · MediaPipe Tasks Vision 0.10.14 (WASM + WebGL, bundled locally) · Vitest · Playwright (end-to-end).

## Module map (§4 of the brief)

| # | Module | Files |
|---|---|---|
| 1 | Shared UI & navigation | `ui/Layout.tsx`, `ui/kit.tsx`, `lib/router.ts`, `screens/*` |
| 2 | Player & team management | `core/store.ts`, `screens/Setup.tsx` |
| 3 | Camera & recording manager | `camera/useCamera.ts`, `camera/VideoStage.tsx`, `camera/recorder.ts`, `camera/CameraControls.tsx` |
| 4 | AI perception & evidence extraction | `perception/visionRuntime.ts`, `perception/body.ts`, `perception/personTracker.ts`, `perception/colorBall.ts` |
| 5 | Freeze & Fool evaluator | `games/freeze/evaluator.ts`, `poses.ts`, `roundMachine.ts`, `kinematics.ts` |
| 6 | Football evaluator | `games/football/goalDetector.ts`, `geometry.ts` |
| 7 | Action Detective evaluator | `games/action/features.ts`, `actions.ts`, `evaluator.ts`, `answerMatch.ts` |
| 8 | Shared scoring infrastructure | `core/ruleEngine.ts`, `core/matchOps.ts`, `core/types.ts` |
| 9 | Match controller | `games/*/…Game.tsx`, `screens/MatchScreen.tsx` |
| 10 | Results & history | `screens/Results.tsx`, `screens/History.tsx`, `core/achievements.ts`, `ui/EvidenceCard.tsx` |
| 11 | Deployment config | `vite.config.ts`, `public/_headers`, `vercel.json`, `netlify.toml`, `.github/workflows/deploy-pages.yml` |

## Data flow

```
 camera / video file
        │  frames (requestVideoFrameCallback)
        ▼
 ┌───────────────────────── perception (on device) ─────────────────────────┐
 │ Pose Landmarker lite (≤4 people, 33 landmarks)   EfficientDet-Lite0 (COCO) │
 │ → mirror-view, aspect-corrected body coordinates   + HSV colour ball tracker│
 │ → PersonTracker (left-to-right slots, nearest-neighbour, swap detection)   │
 └──────────────────────────────────────────────────────────────────────────┘
        │ observations (timestamped)
        ▼
 ┌──────────── game evaluators (pure, deterministic, unit-tested) ────────────┐
 │ Freeze: segment directions, checks, stability → 60/25/15                   │
 │ Football: GoalDetector state machine → confirmed | uncertain               │
 │ Action: temporal features → cue degrees → S for 22 actions → 60/25 (+15)   │
 └──────────────────────────────────────────────────────────────────────────┘
        │ Evidence[] + Award[] (idempotent ids)
        ▼
 rules engine: validate → reject duplicates → append ScoreEvent → totals/standings (derived)
        ▼
 persisted MatchRecord (localStorage) + snapshots/clips (IndexedDB) → Verdict, Results, History
```

## Shared evidence format (§22)
`core/types.ts → Evidence`: matchId, gameId, roundId, subjectId/type, timestamp (ISO; shown in Asia/Dubai), mediaTimeSec, evidenceType, observation, measurements, confidence, uncertain + reason, rule, scoreComponent, scoreAwarded (null = no score), maxScore, explanation, status (`automatic | host_reviewed | pending_review | not_scored`), snapshotKey, clipKey, hostReview {originalScore, originalStatus, decision, newScore, note, at}.

## Reliability safeguards
- **Duplicate prevention at three levels:** per-round "committed" guards in each controller, the goal detector's lock-until-restart, and the rules engine rejecting repeated ScoreEvent ids.
- **Refresh / interruption.** The round in progress is persisted as `inFlight`. After a reload it is recorded as *interrupted, not scored*. A camera disconnect cancels the attempt, and pausing during a freeze discards it.
- **Speed awareness.** The football screen measures the analysis frame rate and warns below 10 frames/s. The neural ball detector runs only when colour tracking loses the ball (plus a 1 s cross-check). Software-only WebGL is detected, and the faster WASM CPU path is used instead.
- **Strict production CSP:** `script-src 'self' 'wasm-unsafe-eval'`, no third-party origins at runtime, and `Permissions-Policy: camera=(self)`. The end-to-end tests run under these exact headers.

## Localisation & UAE specifics
English by default. The `i18n/` dictionaries are keyed so a reviewed Arabic translation can be dropped in. The layout uses logical CSS properties and has an RTL preview switch (verified in tests). The time zone is fixed to Asia/Dubai (GST, UTC+4) for every displayed date and time, the location is shown as the United Arab Emirates, and the branding uses the UAE flag colours.
