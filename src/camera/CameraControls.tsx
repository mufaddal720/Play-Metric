import { CAMERA_HELP, type CameraErrorCode, type CameraStatus } from './useCamera';
import { Notice } from '../ui/kit';

export function CameraControls({ status, error, devices, deviceId, onDevice, onRetry }: {
  status: CameraStatus; error: CameraErrorCode | null; devices: MediaDeviceInfo[]; deviceId?: string;
  onDevice: (id: string | undefined) => void; onRetry: () => void;
}) {
  return (
    <div className="space-y-3">
      {status === 'requesting' && <Notice>Asking for camera permission… Please choose “Allow” in your browser.</Notice>}
      {status === 'error' && error && (
        <Notice kind="error" title="Camera problem">
          <p>{CAMERA_HELP[error]}</p>
          <button className="btn-light mt-3" onClick={onRetry}>Try again</button>
        </Notice>
      )}
      {status === 'disconnected' && (
        <Notice kind="error" title="Camera disconnected">
          <p>The camera stopped sending video. The game has been paused and nothing was scored from the interrupted moment.</p>
          <button className="btn-light mt-3" onClick={onRetry}>Reconnect camera</button>
        </Notice>
      )}
      {devices.length > 1 && (
        <div>
          <label className="label" htmlFor="cam-select">Camera</label>
          <select id="cam-select" className="input" value={deviceId ?? ''} onChange={(e) => onDevice(e.target.value || undefined)}>
            <option value="">Default camera</option>
            {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
