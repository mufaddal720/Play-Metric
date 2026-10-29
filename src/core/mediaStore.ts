import { createStore, get, set, del, keys } from 'idb-keyval';

/**
 * Evidence snapshots and optional round recordings stay in this browser (IndexedDB).
 * Nothing here is uploaded anywhere.
 */
const store = typeof indexedDB !== 'undefined' ? createStore('uae-ai-gameday-media', 'media') : undefined;

export async function saveMedia(key: string, blob: Blob): Promise<void> {
  if (store) await set(key, blob, store);
}
export async function loadMedia(key: string): Promise<Blob | undefined> {
  return store ? get<Blob>(key, store) : undefined;
}
export async function deleteMedia(key: string): Promise<void> {
  if (store) await del(key, store);
}
export async function listMediaKeys(): Promise<string[]> {
  return store ? ((await keys(store)) as string[]) : [];
}
export async function deleteMediaWithPrefix(prefix: string): Promise<number> {
  const ks = (await listMediaKeys()).filter((k) => k.startsWith(prefix));
  await Promise.all(ks.map((k) => deleteMedia(k)));
  return ks.length;
}

/** Downscaled JPEG of a canvas, used as the visual evidence for a verdict. */
export async function snapshotCanvas(canvas: HTMLCanvasElement, key: string, maxWidth = 360): Promise<string | undefined> {
  try {
    const scale = Math.min(1, maxWidth / canvas.width);
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * scale);
    c.height = Math.round(canvas.height * scale);
    c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.7));
    if (!blob) return undefined;
    await saveMedia(key, blob);
    return key;
  } catch {
    return undefined;
  }
}
