# Testing

## 1. Automated unit tests: `npm test` (72 tests, all passing)

| Area (brief §30) | Where | What is checked |
|---|---|---|
| Pose score boundaries | `games/freeze/freeze.test.ts` | Perfect copy = 100 (60/25/15). Wrong pose < 30 similarity and 0 positions. Monotonic partial credit. Always 0–100 |
| Required-position scoring | same | Every one of the 12 reference skeletons passes its own checks (self-consistency) |
| Stability boundaries | same | Breathing-level jitter keeps 15/15. Wobble < 15. Large movement = 0 |
| Fairness | same | Identical scores for very different body sizes and limb proportions |
| Team score | same | Average + unity bonus, cap 100, no advantage for bigger teams, uncertain if < half valid |
| Mirroring | same | Opposite side accepted only for `mirrorAllowed` poses. `mirrorPose` is an involution |
| Goal validation | `games/football/football.test.ts` | Clean shot confirmed. Ball resting near the line, passing wide, or leaving the goal never scores |
| Duplicate-goal prevention | same | A ball bouncing in the net 20 times = 1 goal. Auto re-arm and host Kick-off modes |
| Occlusion | same | Ball hidden at the line → uncertain. Appears inside without approach → uncertain |
| Ball tracker | same | Learns colour from one tap, finds the ball, handles a white ball, rejects a tap on the grass |
| Action recognition | `games/action/action.test.ts` | 12 synthetic movement sequences each recognised as the top action. Brushing teeth vs combing hair told apart. Standing still → no AI score. Lost tracking / too short → uncertain. Deterministic |
| Action-answer matching | same | Variants, typos and stems accepted. "brushing hair" ≠ "brushing teeth"; "throw" ≠ "row" |
| Timer transitions | `core/core.test.ts` | READY→…→VERDICT, next round vs COMPLETE, default 5/8/3, validation, reproducible chaos schedule |
| Match completion / ties | same | Shared ranks (1, 1, 3), draw vs winner, team crediting |
| Invalid / uncertain observations | same | Unknown subject, negative, NaN, over-max, inactive match. Host review needs a note, cannot be repeated, keeps the original |
| Score persistence | same | Awards saved to storage, survive a reload, and a re-submitted round adds nothing |
| UAE time | same | Asia/Dubai formatting independent of the device time zone |

## 2. End-to-end tests: `npm run test:e2e` (8 scenarios, all passing)

These run in real Chromium (headless) with the **real MediaPipe models**, a **fake camera** fed from fixture videos, and the **production security headers** (CSP, Permissions-Policy), via `scripts/serve-dist.mjs`. Build the fixtures first with `python3 -I scripts/make_fixtures.py test-artifacts/fixtures`.

Results from the build session (headless Chromium, software rendering, CPU inference):

| Scenario | Input | Result |
|---|---|---|
| `freeze-warrior` | Real photo of a person in a yoga warrior pose (arms horizontal, legs in a lunge), target *Airplane Wings* | **90.1–90.2 / 100** (similarity 50.1/60: arms matched within 1–2°, legs correctly reported as different; positions 25/25; stability 15/15) |
| `freeze-standing` | Real photo of a person standing normally, target *Airplane Wings* | **31.8–31.9 / 100** (positions 0/25, "hands not at shoulder height" explained, stability reduced because the pose did not match) |
| `freeze-empty` | Empty room | **No score**, "player tracked in only 0 of ~46 freeze frames", offered retake/host review |
| `football` | Synthetic 640×360 pitch: shot into goal 1, shot wide of the post, shot into goal 2, looping | Ball found in 100% of test frames; analysis 15–16 frames/s; **2–2 after 40 s (≈2.3 loops), every goal confirmed automatically with 12–13 tracked positions before the line, the wide shot never counted, no duplicates** |
| `action-static` | Real photo (person not moving), secret action from the deck | Secret hidden except while held. Wrong guess rejected. Correct guess +15 to the guesser. Performer's AI score low and fully explained (the AI said the still arms-out pose looked like "Flying an aeroplane") |
| `football-recorded` | The same pitch video uploaded as a WebM file (recorded-video judging) | **1–1 at the end of the clip**: exactly one goal per goal mouth, the wide shot ignored, goals timestamped in video time (e.g. 00:15), nothing sent to review |
| `freeze-recorded` | The warrior clip uploaded as a file, freeze start set to 2 s | **90.2 / 100**, same as live judging |
| `ui` | 390 px mobile viewport | No horizontal overflow on Home/Setup/How to play/Settings. Header clock = Asia/Dubai time. RTL preview sets `dir=rtl` |

Screenshots and the text report are written to `test-artifacts/e2e/`.

**Finding fixed during testing:** with software-only WebGL, the GPU delegate made the ball detector take ~750 ms per frame. The football analysis rate fell to 3–4 frames/s and goals were (correctly) sent to host review. The app now detects software rendering and uses the WASM CPU path, runs the neural detector only when colour tracking loses the ball, and shows the analysis speed to the host. Result: 15–16 frames/s and automatic confirmation.

## 3. What has NOT been tested yet (must be done by the team)
The build environment had no physical camera and no real people moving. The following therefore remain **untested on real footage**:
- Action Detective on real people performing actions (only synthetic landmark sequences and a static real photo were used).
- Football with a real ball, real goals and real players (only a synthetic pitch video was used).
- Freeze & Fool with several real people in frame at once (multi-person tracking), overlapping players, and changing lighting.
- Speed on the actual demo devices (phones/tablets/laptops with real GPUs should be faster than the headless test machine).

## 4. Real-world test protocol (fill in and attach to the competition report)
Run each condition **10 times**, write the counts down honestly, and keep the videos (with the families' consent) as evidence.

| # | Game | Condition | Expected | Correct | Uncertain → review | Wrong |
|---|---|---|---|---|---|---|
| 1 | Freeze | 1 player, good light, 3 m | high score when copying, low when not | | | |
| 2 | Freeze | 2–4 players side by side | each tracked in their own slot | | | |
| 3 | Freeze | players overlapping / crossing | uncertain, not a wrong score | | | |
| 4 | Freeze | dim light / backlit window | | | | |
| 5 | Freeze | adult vs child doing the same pose | similar scores | | | |
| 6 | Freeze | loose vs tight clothing | similar scores | | | |
| 7 | Football | slow roll into goal | confirmed | | | |
| 8 | Football | hard shot into goal | confirmed or uncertain (never wrong) | | | |
| 9 | Football | shot wide / hits post | no goal | | | |
| 10 | Football | player blocks the view at the line | uncertain → review | | | |
| 11 | Football | ball rests on the line | no goal | | | |
| 12 | Action | 3 different performers × 5 easy actions | assigned action ranks first | | | |
| 13 | Action | brushing teeth vs combing hair | told apart | | | |
| 14 | Action | performer half out of frame | uncertain | | | |

Report accuracy as *correct / (correct + wrong)* and the review rate as *uncertain / total*. Do not round up, and do not drop failed trials.

## 5. Manual checklist (brief §33)
- [ ] All three games can be selected (Home cards and the Setup tabs).
- [ ] Every game can start and finish (End match is always available; results page reached).
- [ ] Players can be added, renamed and removed; teams renamed, added and removed, with players assigned.
- [ ] Camera permission prompt appears; deny → help and Try again; unplug → "Camera disconnected" and safe pause.
- [ ] Real video is analysed (skeleton / ball overlay visible while playing).
- [ ] Scores follow the right game's rules (compare with SCORING.md).
- [ ] Uncertain results show "Needs review" with a reason and no points.
- [ ] One event never scores twice (bounce the ball in the net; double-click buttons).
- [ ] The leaderboard only shows confirmed scores; host reviews are labelled.
- [ ] Works on a phone (portrait setup, landscape play) and on a desktop.
- [ ] The public link opens without any developer login (after deployment).
