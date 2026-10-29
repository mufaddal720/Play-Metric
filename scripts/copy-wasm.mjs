// Copies the MediaPipe WASM runtime into public/ so the app never depends on a third-party CDN at runtime.
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('public/mediapipe/wasm', { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm', { recursive: true });
console.log('Copied MediaPipe WASM runtime to public/mediapipe/wasm');
