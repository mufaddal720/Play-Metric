import { Card, SectionTitle } from '../ui/kit';
import { POSES } from '../games/freeze/poses';
import { PoseFigure } from '../games/freeze/PoseFigure';
import { ACTIONS } from '../games/action/actions';

export function HowToPlay() {
  return (
    <div className="space-y-6">
      <SectionTitle sub="Every point the AI gives comes from a published rule. Here are the rules.">How to play & how the AI judges</SectionTitle>
      <Card>
        <h3 className="text-xl font-bold">🧊 Freeze & Fool</h3>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-ink-200">
          <li>Stand where the camera sees everyone from head to toe, in the left-to-right order shown.</li>
          <li>The round runs READY → PREPARE (5 s) → COPY (8 s) → FREEZE (3 s) → ANALYSE → VERDICT. Timings can be changed in setup.</li>
          <li>Copy the figure like a mirror: the figure’s left side (red dot on the shoulder) is <i>your</i> left.</li>
          <li>When you hear the FREEZE tone, hold perfectly still until the verdict.</li>
        </ol>
        <h4 className="mt-4 font-semibold">Scoring (100 points per round)</h4>
        <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-ink-200">
          <li><b>Pose similarity — 60:</b> the direction of each body segment (upper arm, forearm, thigh, lower leg, torso) is compared with the target. Full credit within the pose’s tolerance (easy 25°, medium 20°, hard 18°), falling to zero 35° beyond it. Directions ignore height and limb length, so every body shape is judged fairly.</li>
          <li><b>Required positions — 25:</b> each pose lists checks such as “hands above head”. A check counts if it holds for at least 60% of the freeze.</li>
          <li><b>Freeze stability — 15:</b> how much your joints moved during the freeze, measured in torso lengths. Movement below 0.035 (breathing and camera noise) is free; 0.15 or more scores zero. You must match at least half of the pose to earn full stability points.</li>
          <li><b>Teams:</b> average of members’ valid scores, plus a 5-point unity bonus when every member scores 60+, capped at 100. Bigger teams get no advantage.</li>
          <li>If someone is out of frame or hidden, the AI gives <b>no score</b> and asks for a retake or host review.</li>
        </ul>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {POSES.map((p) => (
            <figure key={p.id} className="rounded-xl bg-ink-900 p-1 text-center">
              <PoseFigure angles={p.angles} size={90} />
              <figcaption className="text-xs">{p.name}<br /><span className="text-ink-300">{p.difficulty}</span></figcaption>
            </figure>
          ))}
        </div>
      </Card>
      <Card>
        <h3 className="text-xl font-bold">⚽ AI Football</h3>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-ink-200">
          <li>Mark a small pitch and place two small goals. Use a brightly coloured ball.</li>
          <li>Put the camera high on a stand to the side, so the pitch and both goal mouths are in view.</li>
          <li>In setup, tap the pitch corners, each goal’s posts and a point inside it, then tap the ball. A 4-second tracking test checks the setup.</li>
          <li>Press Kick-off. The scoreboard changes only when the AI confirms a goal.</li>
        </ol>
        <h4 className="mt-4 font-semibold">When is a goal a goal?</h4>
        <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-ink-200">
          <li>The ball must be tracked approaching (2+ positions), cross the line <b>between the posts</b> in the scoring direction, and be seen inside the goal (2+ positions).</li>
          <li>If the ball was hidden at the moment it crossed, the event is marked <b>uncertain</b> and the host decides. Host decisions are labelled “Host reviewed”.</li>
          <li>After a goal, scoring is locked until play restarts — so one goal can never be counted twice.</li>
          <li>The AI does <b>not</b> judge fouls, offside or handballs. Those are for the players and host.</li>
        </ul>
      </Card>
      <Card>
        <h3 className="text-xl font-bold">🕵️ Action Detective</h3>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-ink-200">
          <li>Pass the device to the performer. Everyone else looks away while the performer holds the card to see the secret action.</li>
          <li>The performer acts it out silently. Guessers pick their name and type (or speak) their guesses.</li>
          <li>The AI tracks the performer’s movement over time: rhythm, where the hands are, whether arms move together or take turns, and more.</li>
        </ol>
        <h4 className="mt-4 font-semibold">Scoring (100-point framework per turn)</h4>
        <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-ink-200">
          <li><b>Performer — AI action match, up to 60:</b> how strongly the movement matches the secret action compared with all {ACTIONS.length} actions in the library.</li>
          <li><b>Performer — movement cues, up to 25:</b> share of the action’s listed cues the camera saw.</li>
          <li><b>Guesser — correct answer, 15:</b> to the first player whose guess matches within the time limit. In team mode only the performer’s teammates guess.</li>
          <li>If the AI cannot recognise the movement confidently, it gives <b>no</b> AI points — the host can review or the performer can try again.</li>
        </ul>
      </Card>
    </div>
  );
}
