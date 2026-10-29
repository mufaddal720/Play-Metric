# Known limitations & model-performance findings

These are stated plainly so judges and families know what the AI can and cannot do. **The app does not claim perfect accuracy.**

## Perception models
- **Pose Landmarker (lite)** is a fast model tuned for one to a few people facing the camera. Accuracy drops with people far away (< ~120 px tall), heavy occlusion, people lying down, unusual camera angles, very loose clothing and dim or backlit scenes. In those cases the visibility checks usually make the result *uncertain* rather than wrong, but not always.
- **2-D only.** Movements toward or away from the camera (e.g. a knee raised straight forward, punches straight at the camera) shorten in the image and are measured less reliably. Poses were designed to be readable from the front, and rowing and boxing rely on elbow angles and torso changes rather than depth.
- **Multi-person identity** uses positions only, with no faces. If players cross or swap places during a freeze, the round is marked uncertain. Up to 4 people per frame.
- **EfficientDet-Lite0 "sports ball"** is a general COCO detector. It often misses small or motion-blurred balls, which is why a calibrated **colour tracker** is the primary ball sensor. The colour tracker can be confused by clothing or objects of the same colour as the ball. Choose a ball colour that nothing else on the pitch has. The calibration rejects a colour that covers > 3% of the frame.

## Freeze & Fool
- Tolerances (±18–25°) and the breathing allowance (0.035 torso lengths) were chosen by design and checked on two real photos and on synthetic data. They should be tuned after the real-world tests in TESTING.md.
- Stability is measured from 2-D joint positions, so a player could hold still while slowly leaning toward the camera without being noticed.

## AI Football
- Only **goals** are judged. Fouls, offside, handball, out of play and possession are **not** detected.
- Goal verification needs a dense ball track: the analysis must run at ≥ 10 frames/s (shown on screen). A very hard shot can cross the line between two analysed frames. The pipeline then marks it *uncertain* and asks the host, instead of guessing.
- The goal line is a 2-D line in the image. With a low camera, a ball passing *in front of* the goal can look like it crossed the line. Mount the camera high, to the side, looking down at both goal mouths.
- Tested only on a synthetic pitch video in the build environment (see TESTING.md). Real-world accuracy has **not** been measured yet.

## Action Detective
- Recognition uses hand-designed movement cues over time, not a trained action-recognition network. The 22 actions were chosen because their cues can be measured from a front camera. On synthetic sequences each one is recognised, but **performance on real performers has not been measured yet**.
- Different people act the same action very differently. The cue thresholds are deliberately soft, and the score depends on how the assigned action compares with all others, but some genuine performances will be under-scored. The host can review any result.
- Similar actions can be confused (e.g. swimming vs climbing, drums vs clapping). The verdict warns when two actions score within 8% of each other.
- A still performer in a recognisable static pose (e.g. arms out) may match a static-cue action such as "Flying an aeroplane". The resulting low score is measured, not invented, and is explained.
- Voice guesses rely on the browser's speech service (not available in all browsers. In Chrome, audio is processed by Google), so they are off by default.
- The microphone is not used to police "no talking": guessers' voices would make such a check unreliable.

## Platform
- Needs a modern browser with WebAssembly and `getUserMedia` over HTTPS. Older iOS versions may not support every feature (e.g. `requestVideoFrameCallback`; the app falls back to animation frames).
- Data is stored per browser. Clearing site data deletes history, and history does not sync between devices (deliberately, for privacy).
- Arabic text is not included yet. The layout is RTL-ready, and Arabic will be added only as a reviewed human translation.
