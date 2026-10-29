import { levenshtein } from '../../lib/math';
import type { ActionSpec } from './actions';

/**
 * Deterministic guess checking: normalise, drop filler words, reduce simple word endings,
 * then a guess is correct if every word of at least one accepted phrase appears in it
 * (allowing one typo in words of 5+ letters).
 */
const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'he', 'she', 'they', 'you', 'your', 'his', 'her', 'their', 'my', 'like', 'pretend',
  'pretending', 'to', 'of', 'on', 'in', 'at', 'with', 'some', 'someone', 'somebody', 'person', 'doing', 'it', 'its', 'im', 'i', 'think', 'maybe', 'up', 'for']);

export function stem(w: string): string {
  let s = w;
  if (s.length > 5 && s.endsWith('ing')) {
    s = s.slice(0, -3);
    if (s.length > 2 && s[s.length - 1] === s[s.length - 2] && !'aeiou'.includes(s[s.length - 1])) s = s.slice(0, -1);
  } else if (s.length > 4 && s.endsWith('es') && /(sh|ch|x|s)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

export function normalise(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s-]/g, ' ').replace(/-/g, ' ')
    .split(/\s+/).filter((w) => w && !STOP.has(w)).map(stem);
}

const wordMatch = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && levenshtein(a, b) <= 1);

export function isCorrectGuess(guess: string, action: ActionSpec): { correct: boolean; matched?: string } {
  const g = normalise(guess);
  if (!g.length || guess.length > 80) return { correct: false };
  const joined = g.join('');
  for (const ans of action.acceptedAnswers) {
    const a = normalise(ans);
    if (!a.length) continue;
    if (a.every((w) => g.some((x) => wordMatch(x, w)))) return { correct: true, matched: ans };
    if (a.length > 1 && joined.includes(a.join(''))) return { correct: true, matched: ans }; // "toothbrush" vs "tooth brush"
  }
  return { correct: false };
}
