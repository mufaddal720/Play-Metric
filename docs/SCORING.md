# Scoring rules (what the AI judge does)

The AI never invents points. Perception models produce **observations** such as joint positions and ball positions. Each game's **evaluator** turns observations into measurements with a fixed formula. The shared **rules engine** validates each award, rejects duplicates (every award has an idempotency id) and derives totals from the stored awards. Explanations are generated *from the measurements* and can never change a score.

If the measurements are not reliable, no score is produced. The result is labelled **Needs review**, and the host can retake it or review it. A host review keeps the original AI result alongside the host's decision and note, and is labelled **Host reviewed** everywhere.

Source of truth: `src/games/*/evaluator.ts`, `src/games/football/goalDetector.ts`, `src/core/ruleEngine.ts`.

---

## 🧊 Freeze & Fool (100 points per round)

Round states: `READY → PREPARE (5 s) → COPY (8 s) → FREEZE (3 s) → ANALYSE → VERDICT → next round | COMPLETE`. Timings are configurable (prepare 2–15 s, copy 3–20 s, freeze 2–8 s).

**Reference skeleton.** Each pose stores the direction of 9 body segments (torso, upper arms, forearms, thighs, lower legs) in *mirror view*: the player's left side appears on the left of the screen, and the illustration marks the left shoulder with a red dot. Directions do not depend on height or limb length.

| Component | Formula |
|---|---|
| **Pose similarity (60)** | For each segment: measured direction = circular mean over the freeze frames. Error e = angle difference. Credit s = 1 if e ≤ tol, falling linearly to 0 at tol + 35°. Weight 1.0 for required limbs, 0.3 torso, 0.4 optional limbs. **60 × Σ w·s / Σ w**. Tolerance: easy poses 25°, medium 20°, hard 18°, multiplied by the match difficulty (easy ×1.3, medium ×1, hard ×0.8). |
| **Required positions (25)** | Each pose has 3–4 checks (e.g. "left hand above head", "knees bent 60–160°"), with distances measured in torso lengths. A check passes if it holds in ≥ 60% of freeze frames. **25 × passed / total**. |
| **Freeze stability (15)** | m = mean positional standard deviation of the tracked joints over the freeze (3-frame median filtered), in torso lengths. **15 × (1 − ramp(m, 0.035, 0.15)) × min(1, similarity ratio / 0.5)**. Movement below 0.035 (breathing, model noise) costs nothing. Freezing in the wrong pose cannot earn full stability. |

- **Mirroring.** Poses marked `mirrorAllowed` accept either side, and the better orientation is used and reported. *Mirror Champion* deliberately does not. In **Mirror Match** the right-hand player must perform the left/right-swapped target.
- **Uncertain (no score).** This happens if the player is tracked in < 40% of expected freeze frames, a required segment is visible in < 60% of frames, the feet are out of frame for a full-body pose, or players swap left/right order during the freeze.
- **Team Freeze.** Average of the members' valid scores, plus a **5-point unity bonus** if every member scored ≥ 60, capped at 100. The team score is uncertain if fewer than half the members are valid. Team size gives no advantage.
- **Chaos mode.** Prepare 3 s and copy 6 s. The target may change 1–2 times during COPY. The target showing when FREEZE starts is the one judged. The schedule is seeded by the round id, so it is reproducible.

## ⚽ AI Football (1 point per confirmed goal)

A goal is **confirmed automatically** only when all of these hold (`goalDetector.ts`):
1. **Approach.** At least 2 ball observations on the field side within 0.8 s before the line.
2. **Crossing.** Consecutive observations cross the calibrated goal line from outside to inside, and the crossing point lies between the posts (±10% of the goal width).
3. **Continuity.** The ball was not unobserved for more than 0.35 s at the line.
4. **Inside.** At least 2 observations inside the goal area within 1 s.
5. **Armed.** After any goal event, scoring is locked until restart: either the ball is back in play (≥ 0.75 goal-widths from both lines for 1.5 s), or the host presses Kick-off, depending on the setting.

If 2 holds but 1, 3 or 4 cannot be verified (occlusion, a ball appearing inside), the event is **uncertain**. It goes to host review and does **not** change the scoreboard unless the host counts it. That decision is then labelled "manually reviewed". A ball that is near the goal, bounces off the line or leaves the goal never scores. Duplicate events are impossible: the detector locks, and the rules engine rejects a repeated id.

Not judged: fouls, offside, handball, out of bounds.

## 🕵️ Action Detective (100-point framework per turn)

The performer is the largest (closest) person in view. Landmark sequences are resampled to 15 Hz and turned into temporal features (`features.ts`):
- per-hand mean position (body-relative, in torso lengths), distance to the nose, time above the head
- rhythm: autocorrelation periodicity, frequency and amplitude of hand, elbow, hip, ankle and head-turn signals
- left/right coordination (correlation), circular motion, wrist-distance changes, torso tilt and apparent torso length

Each of the 22 actions lists required and optional **movement cues**. Each cue returns a degree from 0 to 1.

| Component | Who | Formula |
|---|---|---|
| Action score S (per library action) | — | S = (Σ w·d / Σ w) × (0.5 + 0.5 × min required d); w = 1 required, 0.5 optional |
| **AI action match (60)** | performer | 60 × S_assigned × D, where D = 1 if the assigned action ranks first among all 22, else max(0.5, 1 − 2 × (S_top − S_assigned)) |
| **Movement cues (25)** | performer | 25 × (assigned cues with d ≥ 0.6) / cues |
| **Correct guess (15)** | first correct guesser | 15 if the guess matches an accepted answer within the time limit (easy 60 s, medium 45 s, hard 40 s). Team mode: only the performer's teammates guess |

- **Uncertain (no AI points).** This happens if the performance lasted < 3 s, the performer was tracked in < 60% of frames, or no library action reached S ≥ 0.40 (no recognisable movement). The host can review, or the performer retries with a new action.
- **Answer matching** is deterministic. Text is lower-cased, punctuation and filler words are dropped, and simple endings are stemmed (rowing → row, swimming → swim). A guess is correct if every word of one accepted phrase appears in it, allowing one typo in words of 5+ letters. "brushing hair" does not match "brush teeth".
- The performer's points and the guesser's points are separate awards to separate people.

## Achievements (computed from recorded results only)
Pose Master (avg ≥ 85 over ≥ 3 rounds) · Perfect Freeze (15/15 stability with similarity ≥ 50) · Golden Goal (the goal after which the winners never lost the lead) · Sharp Shooter (≥ 3 automatically verified goals) · Master Actor (AI match ≥ 50/60) · Quick Guess (correct within the first 25% of the time) · Teamwork Champion (unity bonus in ≥ 2 rounds, or ≥ 3 correct team guesses).

Scores from different games are never combined into one ranking.
