import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export type VideoSource = { kind: 'live'; stream: MediaStream | null } | { kind: 'file'; url: string };

export interface VideoStageHandle {
  video: HTMLVideoElement | null;
  overlay: HTMLCanvasElement | null;
  /** Draw the current video frame + overlay into one canvas (used for evidence snapshots). */
  composite(): HTMLCanvasElement | null;
}

interface Props {
  source: VideoSource;
  mirror?: boolean;
  /** Called for every new video frame while `running` is true. */
  onFrame?: (video: HTMLVideoElement, overlay: HTMLCanvasElement) => void;
  running?: boolean;
  badge?: React.ReactNode;
  onOverlayClick?: (x: number, y: number) => void;
  onFileError?: (msg: string) => void;
  onEnded?: () => void;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Shared camera/recording surface used by all three games. The overlay canvas uses the
 * video's native pixel size, so drawings line up with what the AI analysed.
 */
export const VideoStage = forwardRef<VideoStageHandle, Props>(function VideoStage(
  { source, mirror = false, onFrame, running = true, badge, onOverlayClick, onFileError, onEnded, children, className = '' }, ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cb = useRef(onFrame);
  cb.current = onFrame;
  const [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    get video() { return videoRef.current; },
    get overlay() { return canvasRef.current; },
    composite() {
      const v = videoRef.current, o = canvasRef.current;
      if (!v || !o || !v.videoWidth) return null;
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      const g = c.getContext('2d')!;
      if (mirror) { g.translate(c.width, 0); g.scale(-1, 1); }
      g.drawImage(v, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (mirror) { g.translate(c.width, 0); g.scale(-1, 1); }
      g.drawImage(o, 0, 0);
      return c;
    },
  }), [mirror]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setReady(false);
    if (source.kind === 'live') {
      v.srcObject = source.stream;
      v.removeAttribute('src');
      if (source.stream) v.play().catch(() => undefined);
    } else {
      v.srcObject = null;
      v.src = source.url;
    }
  }, [source]);

  useEffect(() => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || !running) return;
    let stop = false, handle = 0;
    const vfc = 'requestVideoFrameCallback' in v;
    const tick = () => {
      if (stop) return;
      if (v.videoWidth && (c.width !== v.videoWidth || c.height !== v.videoHeight)) { c.width = v.videoWidth; c.height = v.videoHeight; }
      if (v.readyState >= 2 && v.videoWidth) cb.current?.(v, c);
      // A paused file produces no new frames, so keep the overlay (calibration marks) alive at ~5 fps.
      if (v.paused && !v.srcObject) { mode = 'timeout'; handle = window.setTimeout(tick, 200); return; }
      mode = vfc ? 'vfc' : 'raf';
      handle = vfc ? (v as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): number }).requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    let mode: 'vfc' | 'raf' | 'timeout' = 'raf';
    const onPlay = () => { if (mode === 'timeout') { clearTimeout(handle); tick(); } };
    v.addEventListener('play', onPlay);
    tick();
    return () => {
      stop = true;
      v.removeEventListener('play', onPlay);
      if (mode === 'timeout') clearTimeout(handle);
      else if (mode === 'vfc') (v as HTMLVideoElement & { cancelVideoFrameCallback(h: number): void }).cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
    };
  }, [running, ready]);

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-ink-600 bg-black ${className}`}>
      <video
        ref={videoRef} playsInline muted autoPlay={source.kind === 'live'}
        className={`block h-full w-full object-contain ${mirror ? 'mirror' : ''}`}
        onLoadedData={() => setReady(true)}
        onError={() => source.kind === 'file' && onFileError?.('This video could not be opened. It may be an unsupported format — try MP4 (H.264) or WebM.')}
        onEnded={onEnded}
      />
      <canvas
        ref={canvasRef}
        className={`pointer-events-auto absolute inset-0 h-full w-full object-contain ${mirror ? 'mirror' : ''} ${onOverlayClick ? 'cursor-crosshair' : ''}`}
        onClick={(e) => {
          if (!onOverlayClick || !canvasRef.current || !videoRef.current?.videoWidth) return;
          // map click to video pixel coords, accounting for object-contain letterboxing and mirroring
          const r = canvasRef.current.getBoundingClientRect();
          const vw = videoRef.current.videoWidth, vh = videoRef.current.videoHeight;
          const s = Math.min(r.width / vw, r.height / vh);
          const ox = (r.width - vw * s) / 2, oy = (r.height - vh * s) / 2;
          let x = (e.clientX - r.left - ox) / s;
          const y = (e.clientY - r.top - oy) / s;
          if (mirror) x = vw - x;
          if (x >= 0 && y >= 0 && x <= vw && y <= vh) onOverlayClick(x, y);
        }}
      />
      {badge && <div className="pointer-events-none absolute start-3 top-3">{badge}</div>}
      {children}
    </div>
  );
});

export function LiveBadge({ label = 'Camera on · analysing on this device', recording = false }: { label?: string; recording?: boolean }) {
  return (
    <span className="chip bg-black/70 px-3 py-1 text-white">
      <span className={recording ? 'rec-dot' : 'inline-block h-2.5 w-2.5 rounded-full bg-uae-green'} />
      {recording ? 'Recording · ' : ''}{label}
    </span>
  );
}
