import { Card, SectionTitle } from '../ui/kit';

export function Privacy() {
  return (
    <div className="space-y-4">
      <SectionTitle>Privacy notice</SectionTitle>
      <Card>
        <ul className="list-inside list-disc space-y-2 text-ink-200">
          <li><b>All AI analysis runs on your device.</b> Pose detection and ball detection (MediaPipe models bundled with the app) run inside your browser. Camera video is never uploaded to a server by this app.</li>
          <li><b>Camera only when needed.</b> The camera turns on only on a game screen and turns off when you leave it. A badge shows whenever the camera is on. The microphone is never used.</li>
          <li><b>No face recognition, no identity profiles.</b> Players are told apart only by where they stand. The AI uses body joint positions, not faces, skin, clothing or appearance.</li>
          <li><b>What is stored, and where.</b> Player names, match results and small evidence snapshots are stored only in this browser (local storage and IndexedDB). Round recordings are <i>off by default</i>; if turned on in Settings they are also kept only in this browser.</li>
          <li><b>Voice guesses (optional, off by default).</b> If enabled, your browser’s speech service converts speech to text. In Chrome this audio is processed by Google. Only the recognised text is kept.</li>
          <li><b>Deleting data.</b> Settings → “Delete all recordings and snapshots” and “Delete match history” remove everything stored by the app on this device.</li>
          <li><b>No training.</b> Family footage is never used to train any model.</li>
          <li><b>Use first names or nicknames</b> — the app does not need any other personal information.</li>
        </ul>
      </Card>
    </div>
  );
}
