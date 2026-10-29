/** Optional round recordings (off by default, see Settings). Saved only in this browser. */
export class RoundRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  static supported() { return typeof MediaRecorder !== 'undefined'; }

  start(stream: MediaStream) {
    if (!RoundRecorder.supported()) return;
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    try {
      this.chunks = [];
      this.rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 1_000_000 } : undefined);
      this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.rec.start(500);
    } catch { this.rec = null; }
  }

  stop(): Promise<Blob | null> {
    const rec = this.rec;
    this.rec = null;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => resolve(this.chunks.length ? new Blob(this.chunks, { type: rec.mimeType }) : null);
      rec.stop();
    });
  }
}
