import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'requesting' | 'live' | 'error' | 'disconnected';
export type CameraErrorCode = 'denied' | 'notfound' | 'inuse' | 'insecure' | 'unsupported' | 'unknown';

export const CAMERA_HELP: Record<CameraErrorCode, string> = {
  denied: 'Camera permission was blocked. Click the camera icon in your browser’s address bar, choose “Allow”, then press Try again.',
  notfound: 'No camera was found. Connect a camera (or use a phone/tablet), then press Try again.',
  inuse: 'The camera is being used by another app or tab. Close the other app, then press Try again.',
  insecure: 'Camera access needs a secure (https://) connection. Open the app from its https link.',
  unsupported: 'This browser cannot use the camera. Please use a recent version of Chrome, Edge, Safari or Firefox.',
  unknown: 'The camera could not start. Press Try again, or pick a different camera.',
};

/** Camera access is requested only when a game needs it, and released as soon as the screen closes. */
export function useCamera(opts: { enabled: boolean; facingMode?: 'user' | 'environment'; deviceId?: string }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<CameraErrorCode | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [attempt, setAttempt] = useState(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  useEffect(() => {
    if (!opts.enabled) { stop(); setStatus('idle'); return; }
    let cancelled = false;
    (async () => {
      if (!window.isSecureContext) { setStatus('error'); setError('insecure'); return; }
      if (!navigator.mediaDevices?.getUserMedia) { setStatus('error'); setError('unsupported'); return; }
      setStatus('requesting'); setError(null);
      const video: MediaTrackConstraints = {
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
        ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : { facingMode: opts.facingMode ?? 'user' }),
      };
      try {
        let s: MediaStream;
        try {
          s = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        } catch (e) {
          if ((e as DOMException).name === 'OverconstrainedError') s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          else throw e;
        }
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stop();
        streamRef.current = s;
        s.getVideoTracks()[0]?.addEventListener('ended', () => setStatus('disconnected'));
        setStream(s);
        setStatus('live');
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === 'videoinput'));
      } catch (e) {
        if (cancelled) return;
        const name = (e as DOMException).name;
        setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
          : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'notfound'
          : name === 'NotReadableError' || name === 'AbortError' ? 'inuse' : 'unknown');
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [opts.enabled, opts.deviceId, opts.facingMode, attempt, stop]);

  useEffect(() => () => stop(), [stop]);

  return { stream, status, error, devices, retry: () => setAttempt((a) => a + 1), stop };
}

/** Upload validation for recorded-video judging. Files are only read locally in the browser. */
export const MAX_VIDEO_MB = 300;
const OK_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'];
export function validateVideoFile(f: File): string | null {
  const okExt = /\.(mp4|webm|mov|m4v)$/i.test(f.name);
  if (!OK_TYPES.includes(f.type) && !okExt) return 'Unsupported video format. Please use MP4, WebM or MOV.';
  if (f.size > MAX_VIDEO_MB * 1024 * 1024) return `This video is ${(f.size / 1048576).toFixed(0)} MB. The limit is ${MAX_VIDEO_MB} MB — please trim it.`;
  if (f.size === 0) return 'This file is empty.';
  return null;
}
