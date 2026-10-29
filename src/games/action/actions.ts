import type { Difficulty } from '../../core/types';
import { ramp } from '../../lib/math';
import type { ActionFeatures as F, Hand, Osc } from './features';

/**
 * Action Detective library. Each action is defined by movement cues measured over time from
 * body landmarks (never from faces or appearance). A cue returns a degree from 0 to 1.
 * Only actions whose cues can be measured from a front-facing camera are included.
 */
export interface Cue { id: string; label: string; required: boolean; eval: (f: F) => number }
export interface ActionSpec {
  id: string;
  name: string;
  emoji: string;
  secretPrompt: string;
  difficulty: Difficulty;
  timeLimit: number;            // seconds
  acceptedAnswers: string[];    // key phrases; every word of one phrase must appear in a guess
  cues: Cue[];
  safety: string;
}

// ---- membership helpers -----------------------------------------------------------------
const atLeast = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? ramp(v, lo, hi) : 0);
const atMost = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? 1 - ramp(v, lo, hi) : 0);
const between = (v: number, a: number, b: number, c: number, d: number) => Math.min(atLeast(v, a, b), atMost(v, c, d));
const periodic = (o: Osc) => atLeast(o.periodicity, 0.2, 0.45);
const rhythm = (o: Osc, lo: number, hi: number) => Math.min(periodic(o), atLeast(o.amp, lo, hi));
const fastRhythm = (o: Osc) => Math.min(periodic(o), atLeast(o.freq, 1.3, 2.2));
const both = (f: F, fn: (h: Hand) => number) => Math.min(fn(f.L), fn(f.R));
const either = (f: F, fn: (h: Hand) => number) => Math.max(fn(f.L), fn(f.R));
const handAmp = (h: Hand) => Math.max(h.oscX.amp, h.oscY.amp);
const bestAxis = (h: Hand) => (h.oscX.amp * h.oscX.periodicity >= h.oscY.amp * h.oscY.periodicity ? h.oscX : h.oscY);
const anklesMove = (f: F) => Math.max(f.ankles.L.amp, f.ankles.R.amp);

const TIME: Record<Difficulty, number> = { easy: 60, medium: 45, hard: 40 };
const SAFE = 'Keep a clear space around you and move at your own pace. Any comfortable version of the movement is fine.';

export const ACTIONS: ActionSpec[] = [
  // ---------------------------------------------------------------- EASY
  {
    id: 'waving', name: 'Waving goodbye', emoji: '👋', difficulty: 'easy', timeLimit: TIME.easy, safety: SAFE,
    secretPrompt: 'Wave goodbye to a friend who is leaving.',
    acceptedAnswers: ['wave', 'waving', 'goodbye', 'bye', 'hello', 'hi'],
    cues: [
      { id: 'hand-up', label: 'One hand raised above the shoulder', required: true, eval: (f) => atMost(f.dom.meanY, -1.15, -0.9) },
      { id: 'side-to-side', label: 'Hand moves side to side repeatedly', required: true, eval: (f) => rhythm(f.dom.oscX, 0.12, 0.3) },
      { id: 'mostly-sideways', label: 'Movement is mostly sideways (not up-down)', required: true, eval: (f) => atLeast(f.dom.oscX.amp / (f.dom.oscY.amp + 0.05), 1.0, 1.8) },
      { id: 'other-still', label: 'Other hand stays relaxed', required: false, eval: (f) => atMost(handAmp(f.other), 0.25, 0.6) },
    ],
  },
  {
    id: 'clapping', name: 'Clapping', emoji: '👏', difficulty: 'easy', timeLimit: TIME.easy, safety: SAFE,
    secretPrompt: 'Clap for an amazing performance.',
    acceptedAnswers: ['clap', 'clapping', 'applause', 'applaud'],
    cues: [
      { id: 'hands-meet', label: 'Hands come together in front of the body', required: true, eval: (f) => atMost(f.wristDist.min, 0.25, 0.5) },
      { id: 'open-close', label: 'Hands open and close repeatedly', required: true, eval: (f) => rhythm(f.wristDist.osc, 0.15, 0.4) },
      { id: 'chest', label: 'Hands at chest height', required: false, eval: (f) => both(f, (h) => between(h.meanY, -1.7, -1.3, -0.4, -0.1)) },
      { id: 'symmetric', label: 'Both hands move towards each other', required: false, eval: (f) => atLeast(f.corrX, 0.2, 0.6) },
    ],
  },
  {
    id: 'jumping-jacks', name: 'Jumping jacks', emoji: '🤸', difficulty: 'easy', timeLimit: TIME.easy, safety: 'Small, gentle jumps are fine — or step side to side instead of jumping.',
    secretPrompt: 'Do jumping jacks (star jumps) — arms up and down, feet in and out.',
    acceptedAnswers: ['jumping jack', 'star jump', 'jumping', 'exercise', 'workout'],
    cues: [
      { id: 'arms-together', label: 'Both arms swing up and down together', required: true, eval: (f) => Math.min(atLeast(f.corrY, 0.2, 0.6), both(f, (h) => atLeast(h.oscY.amp, 0.6, 1.2))) },
      { id: 'above-head', label: 'Hands reach above the head', required: true, eval: (f) => both(f, (h) => atLeast(h.aboveHead, 0.05, 0.2)) },
      { id: 'feet', label: 'Feet open and close', required: true, eval: (f) => rhythm(f.ankles.dist, 0.2, 0.45) },
      { id: 'bounce', label: 'Body bounces', required: false, eval: (f) => atLeast(f.hipY.amp, 0.06, 0.15) },
    ],
  },
  {
    id: 'swimming', name: 'Swimming', emoji: '🏊', difficulty: 'easy', timeLimit: TIME.easy, safety: SAFE,
    secretPrompt: 'Swim front crawl across a big pool.',
    acceptedAnswers: ['swim', 'swimming', 'front crawl', 'freestyle', 'crawl'],
    cues: [
      { id: 'alternate', label: 'Arms move alternately', required: true, eval: (f) => atLeast(-f.corrY, 0.2, 0.55) },
      { id: 'big-arms', label: 'Large arm strokes', required: true, eval: (f) => both(f, (h) => atLeast(h.oscY.amp, 0.6, 1.2)) },
      { id: 'overhead', label: 'Hands reach over the head', required: true, eval: (f) => either(f, (h) => atLeast(h.aboveHead, 0.08, 0.2)) },
      { id: 'legs-quiet', label: 'Legs are not stepping like climbing', required: false, eval: (f) => atMost(anklesMove(f), 0.15, 0.35) },
    ],
  },
  {
    id: 'aeroplane', name: 'Flying an aeroplane', emoji: '✈️', difficulty: 'easy', timeLimit: TIME.easy, safety: 'Watch out for furniture while you fly around.',
    secretPrompt: 'Pretend to be an aeroplane flying and turning in the sky.',
    acceptedAnswers: ['aeroplane', 'airplane', 'plane', 'fly', 'flying', 'jet', 'pilot', 'bird'],
    cues: [
      { id: 'wings', label: 'Arms stretched out wide', required: true, eval: (f) => atLeast(f.wristDist.mean, 1.8, 2.4) },
      { id: 'shoulder-height', label: 'Hands near shoulder height', required: true, eval: (f) => both(f, (h) => atMost(Math.abs(h.meanY + 1), 0.25, 0.55)) },
      { id: 'banking', label: 'Body tilts to turn (banking)', required: false, eval: (f) => atLeast(f.shoulderTilt.amp, 8, 20) },
      { id: 'travel', label: 'Moves around the space', required: false, eval: (f) => atLeast(f.hipX.amp, 0.3, 1.0) },
    ],
  },
  {
    id: 'brushing-teeth', name: 'Brushing teeth', emoji: '🪥', difficulty: 'easy', timeLimit: TIME.easy, safety: SAFE,
    secretPrompt: 'Brush your teeth before bed.',
    acceptedAnswers: ['brush teeth', 'brush tooth', 'toothbrush', 'brushing teeth', 'clean teeth'],
    cues: [
      { id: 'at-mouth', label: 'One hand held at the mouth', required: true, eval: (f) => atMost(f.dom.distNose, 0.35, 0.6) },
      { id: 'mouth-level', label: 'Hand at mouth level, not on top of the head', required: true, eval: (f) => atLeast(f.dom.meanY, -1.6, -1.45) },
      { id: 'quick-strokes', label: 'Quick, small back-and-forth strokes', required: true, eval: (f) => fastRhythm(bestAxis(f.dom)) },
      { id: 'other-low', label: 'Other hand stays lower', required: false, eval: (f) => atLeast(f.other.meanY - f.dom.meanY, 0.3, 0.7) },
    ],
  },
  {
    id: 'drumming', name: 'Playing the drums', emoji: '🥁', difficulty: 'easy', timeLimit: TIME.easy, safety: SAFE,
    secretPrompt: 'Play a fast beat on a drum kit.',
    acceptedAnswers: ['drum', 'drums', 'drumming', 'drummer', 'percussion'],
    cues: [
      { id: 'front', label: 'Both hands in front at waist-to-chest height', required: true, eval: (f) => both(f, (h) => between(h.meanY, -1.3, -1.0, -0.25, 0.1)) },
      { id: 'beats', label: 'Fast up-and-down hits with both hands', required: true, eval: (f) => both(f, (h) => fastRhythm(h.oscY)) },
      { id: 'alternate', label: 'Hands take turns', required: false, eval: (f) => atLeast(-f.corrY, 0.1, 0.5) },
      { id: 'size', label: 'Short, controlled strokes', required: false, eval: (f) => both(f, (h) => between(h.oscY.amp, 0.08, 0.15, 0.6, 0.9)) },
    ],
  },
  {
    id: 'skipping', name: 'Skipping rope', emoji: '🪢', difficulty: 'easy', timeLimit: TIME.easy, safety: 'Little hops only — or just bounce on your toes.',
    secretPrompt: 'Skip with an imaginary jump rope.',
    acceptedAnswers: ['skip', 'skipping', 'jump rope', 'skipping rope', 'rope'],
    cues: [
      { id: 'hops', label: 'Small rhythmic hops', required: true, eval: (f) => rhythm(f.hipY, 0.05, 0.14) },
      { id: 'hands-side', label: 'Hands low at the sides', required: true, eval: (f) => Math.min(both(f, (h) => between(h.meanY, -0.9, -0.6, 0.2, 0.45)), atLeast(f.wristDist.mean, 0.9, 1.3)) },
      { id: 'hands-together', label: 'Hands turn the rope together', required: false, eval: (f) => atLeast(f.corrY, 0.2, 0.6) },
      { id: 'feet-together', label: 'Feet jump together', required: false, eval: (f) => atLeast(f.ankles.corrY, 0.2, 0.6) },
    ],
  },
  // ---------------------------------------------------------------- MEDIUM
  {
    id: 'rowing', name: 'Rowing a boat', emoji: '🚣', difficulty: 'medium', timeLimit: TIME.medium, safety: 'Sit or stand — both work.',
    secretPrompt: 'Row a boat across a calm lake.',
    acceptedAnswers: ['row', 'rowing', 'boat', 'canoe', 'kayak', 'paddle', 'paddling', 'oar'],
    cues: [
      { id: 'front', label: 'Both hands in front at chest-to-waist height', required: true, eval: (f) => both(f, (h) => between(h.meanY, -1.3, -1.0, -0.2, 0.1)) },
      { id: 'together', label: 'Both arms pull together', required: true, eval: (f) => atLeast(f.elbow.corr, 0.3, 0.7) },
      { id: 'strokes', label: 'Repeated pulling strokes (elbows bend and straighten)', required: true, eval: (f) => Math.min(periodic(f.elbow.L), periodic(f.elbow.R), atLeast(Math.min(f.elbow.L.amp, f.elbow.R.amp), 20, 45)) },
      { id: 'lean', label: 'Body leans forward and back', required: false, eval: (f) => Math.max(atLeast(f.torsoApparent.osc.amp, 0.05, 0.12), atLeast(f.torsoTilt.osc.amp, 4, 10)) },
    ],
  },
  {
    id: 'sweeping', name: 'Sweeping the floor', emoji: '🧹', difficulty: 'medium', timeLimit: TIME.medium, safety: SAFE,
    secretPrompt: 'Sweep the floor with a big broom.',
    acceptedAnswers: ['sweep', 'sweeping', 'broom', 'cleaning floor', 'clean floor', 'mop', 'mopping'],
    cues: [
      { id: 'grip', label: 'Hands close together (holding a handle)', required: true, eval: (f) => atMost(f.wristDist.mean, 0.5, 0.9) },
      { id: 'low', label: 'Hands low, around the waist', required: true, eval: (f) => atLeast((f.L.meanY + f.R.meanY) / 2, -0.7, -0.35) },
      { id: 'strokes', label: 'Side-to-side strokes with both hands together', required: true, eval: (f) => Math.min(both(f, (h) => rhythm(h.oscX, 0.15, 0.4)), atLeast(-f.corrX, 0.2, 0.6)) },
      { id: 'body', label: 'Body moves with the strokes', required: false, eval: (f) => atLeast(f.torsoTilt.osc.amp, 3, 8) },
    ],
  },
  {
    id: 'guitar', name: 'Playing an imaginary guitar', emoji: '🎸', difficulty: 'medium', timeLimit: TIME.medium, safety: SAFE,
    secretPrompt: 'Rock out on an imaginary guitar.',
    acceptedAnswers: ['guitar', 'air guitar', 'guitarist', 'rock star', 'ukulele', 'banjo'],
    cues: [
      { id: 'strum-hand', label: 'Strumming hand at the waist', required: true, eval: (f) => between(f.dom.meanY, -1.0, -0.8, 0.0, 0.2) },
      { id: 'strumming', label: 'Fast strumming movement', required: true, eval: (f) => fastRhythm(f.dom.oscY) },
      { id: 'fret-hand', label: 'Other hand held out at chest height, fairly still', required: true, eval: (f) => Math.min(between(f.other.meanY, -1.5, -1.25, -0.6, -0.3), atLeast(f.other.extension, 0.6, 0.9), atMost(handAmp(f.other), 0.25, 0.5)) },
      { id: 'apart', label: 'Hands apart along the guitar neck', required: false, eval: (f) => atLeast(f.wristDist.mean, 0.7, 1.1) },
    ],
  },
  {
    id: 'washing-car', name: 'Washing a car', emoji: '🚗', difficulty: 'medium', timeLimit: TIME.medium, safety: SAFE,
    secretPrompt: 'Wash a dusty car with a big sponge.',
    acceptedAnswers: ['wash car', 'washing car', 'car wash', 'clean car', 'polish car', 'wipe', 'wiping', 'clean window', 'wash window'],
    cues: [
      { id: 'circles', label: 'One hand makes circles', required: true, eval: (f) => atLeast(f.dom.circ, 0.3, 0.6) },
      { id: 'height', label: 'At chest-to-shoulder height', required: true, eval: (f) => between(f.dom.meanY, -1.7, -1.35, -0.5, -0.2) },
      { id: 'reach', label: 'Arm reaches out', required: false, eval: (f) => atLeast(f.dom.extension, 0.6, 0.9) },
      { id: 'size', label: 'Big wiping circles', required: false, eval: (f) => atLeast(Math.min(f.dom.oscX.amp, f.dom.oscY.amp), 0.12, 0.3) },
    ],
  },
  {
    id: 'penguin', name: 'Walking like a penguin', emoji: '🐧', difficulty: 'medium', timeLimit: TIME.medium, safety: 'Take tiny steps and keep your balance.',
    secretPrompt: 'Waddle like a penguin with your arms by your sides.',
    acceptedAnswers: ['penguin', 'waddle', 'waddling', 'duck'],
    cues: [
      { id: 'arms-down', label: 'Arms held down by the sides', required: true, eval: (f) => both(f, (h) => atLeast(h.meanY, -0.5, -0.15)) },
      { id: 'waddle', label: 'Body sways side to side', required: true, eval: (f) => Math.max(rhythm(f.shoulderTilt, 5, 12), rhythm(f.hipX, 0.06, 0.15)) },
      { id: 'steps', label: 'Small alternating steps', required: true, eval: (f) => Math.min(atLeast(-f.ankles.corrY, 0.1, 0.5), atLeast(anklesMove(f), 0.04, 0.1)) },
      { id: 'flared', label: 'Hands flared out from the hips', required: false, eval: (f) => atLeast(f.wristDist.mean, 0.8, 1.1) },
    ],
  },
  {
    id: 'boxing', name: 'Boxing', emoji: '🥊', difficulty: 'medium', timeLimit: TIME.medium, safety: 'Punch the air only — never towards anyone.',
    secretPrompt: 'Throw quick punches like a boxer.',
    acceptedAnswers: ['box', 'boxing', 'boxer', 'punch', 'punching', 'fight', 'karate', 'martial art'],
    cues: [
      { id: 'guard', label: 'Fists up near the face', required: true, eval: (f) => both(f, (h) => between(h.meanY, -1.75, -1.5, -0.9, -0.6)) },
      { id: 'punches', label: 'Arms extend and retract repeatedly', required: true, eval: (f) => Math.max(rhythm(f.elbow.L, 25, 55), rhythm(f.elbow.R, 25, 55)) },
      { id: 'alternate', label: 'Punches alternate between hands', required: false, eval: (f) => atLeast(-f.elbow.corr, 0.1, 0.5) },
      { id: 'quick', label: 'Quick rhythm', required: false, eval: (f) => atLeast(Math.max(f.elbow.L.freq, f.elbow.R.freq), 1.0, 2.0) },
    ],
  },
  {
    id: 'cycling', name: 'Riding a bicycle', emoji: '🚲', difficulty: 'medium', timeLimit: TIME.medium, safety: 'Lift your knees gently, or march on the spot.',
    secretPrompt: 'Ride a bicycle up a hill.',
    acceptedAnswers: ['bike', 'bicycle', 'cycle', 'cycling', 'biking', 'ride bike', 'pedal'],
    cues: [
      { id: 'pedals', label: 'Knees lift alternately', required: true, eval: (f) => Math.min(atLeast(-f.ankles.corrY, 0.2, 0.6), atLeast(anklesMove(f), 0.2, 0.45)) },
      { id: 'rhythm', label: 'Steady pedalling rhythm', required: true, eval: (f) => Math.max(periodic(f.ankles.L), periodic(f.ankles.R)) },
      { id: 'handlebars', label: 'Hands held still in front (handlebars)', required: true, eval: (f) => Math.min(both(f, (h) => between(h.meanY, -1.4, -1.1, -0.4, -0.1)), both(f, (h) => atMost(handAmp(h), 0.2, 0.45))) },
    ],
  },
  {
    id: 'stirring', name: 'Stirring a big pot', emoji: '🍲', difficulty: 'medium', timeLimit: TIME.medium, safety: SAFE,
    secretPrompt: 'Stir a huge pot of soup with a long spoon.',
    acceptedAnswers: ['stir', 'stirring', 'cook', 'cooking', 'soup', 'pot', 'mix', 'mixing', 'chef'],
    cues: [
      { id: 'together', label: 'Both hands together on the spoon', required: true, eval: (f) => atMost(f.wristDist.mean, 0.45, 0.8) },
      { id: 'waist', label: 'Hands at waist height', required: true, eval: (f) => between((f.L.meanY + f.R.meanY) / 2, -1.1, -0.85, -0.1, 0.2) },
      { id: 'circles', label: 'Circular stirring motion', required: true, eval: (f) => atLeast((f.L.circ + f.R.circ) / 2, 0.3, 0.6) },
    ],
  },
  // ---------------------------------------------------------------- HARD
  {
    id: 'heavy-door', name: 'Opening a heavy door', emoji: '🚪', difficulty: 'hard', timeLimit: TIME.hard, safety: 'Pretend only — do not lean on real furniture or doors.',
    secretPrompt: 'Struggle to pull open a very heavy door.',
    acceptedAnswers: ['door', 'open door', 'heavy door', 'gate', 'pull', 'pulling', 'push', 'pushing'],
    cues: [
      { id: 'grip', label: 'Hand grips at chest height', required: true, eval: (f) => between(f.dom.meanY, -1.5, -1.25, -0.6, -0.35) },
      { id: 'big-slow', label: 'Slow, large pulling movement (not a quick rhythm)', required: true, eval: (f) => Math.min(atLeast(f.dom.oscX.amp, 0.35, 0.7), atMost(f.dom.oscX.freq || 0, 0.9, 1.4)) },
      { id: 'strain', label: 'Body leans and strains', required: true, eval: (f) => Math.max(atLeast(f.torsoTilt.osc.amp, 5, 12), atLeast(f.torsoTilt.mean, 6, 14)) },
      { id: 'turn', label: 'Body turns while pulling', required: false, eval: (f) => atLeast(f.shoulderWidth.amp, 0.1, 0.25) },
    ],
  },
  {
    id: 'searching', name: 'Searching for a lost object', emoji: '🔎', difficulty: 'hard', timeLimit: TIME.hard, safety: SAFE,
    secretPrompt: 'Search everywhere for your lost keys.',
    acceptedAnswers: ['search', 'searching', 'looking', 'look for', 'lost', 'find', 'finding', 'hunt', 'keys'],
    cues: [
      { id: 'look-around', label: 'Head turns to look around', required: true, eval: (f) => atLeast(f.headTurn.amp, 0.2, 0.45) },
      { id: 'bend', label: 'Bends down to look low', required: true, eval: (f) => Math.max(atMost(f.torsoApparent.min, 0.7, 0.88), atLeast(f.hipY.amp, 0.2, 0.4)) },
      { id: 'reach-low', label: 'Hands reach low', required: false, eval: (f) => either(f, (h) => atLeast(h.meanY, -0.6, -0.2)) },
      { id: 'wander', label: 'Moves around the space', required: false, eval: (f) => atLeast(f.hipX.amp, 0.3, 0.9) },
    ],
  },
  {
    id: 'climbing', name: 'Climbing a ladder', emoji: '🪜', difficulty: 'hard', timeLimit: TIME.hard, safety: 'March on the spot — no real climbing.',
    secretPrompt: 'Climb up a tall ladder, one rung at a time.',
    acceptedAnswers: ['climb', 'climbing', 'ladder', 'stairs', 'rock climbing', 'wall'],
    cues: [
      { id: 'hands-alt', label: 'Hands reach up alternately', required: true, eval: (f) => Math.min(atLeast(-f.corrY, 0.2, 0.55), either(f, (h) => atLeast(h.aboveHead, 0.08, 0.2))) },
      { id: 'knees-alt', label: 'Knees lift alternately', required: true, eval: (f) => Math.min(atLeast(-f.ankles.corrY, 0.2, 0.55), atLeast(anklesMove(f), 0.15, 0.35)) },
      { id: 'steady', label: 'Slow, steady rhythm', required: false, eval: (f) => atMost(Math.max(f.L.oscY.freq, f.R.oscY.freq), 1.0, 1.6) },
      { id: 'in-front', label: 'Hands stay in front of the body', required: false, eval: (f) => atMost(f.wristDist.mean, 1.1, 1.6) },
    ],
  },
  {
    id: 'combing-hair', name: 'Combing hair', emoji: '💇', difficulty: 'hard', timeLimit: TIME.hard, safety: SAFE,
    secretPrompt: 'Comb your hair neatly in front of a mirror.',
    acceptedAnswers: ['comb', 'combing', 'comb hair', 'brush hair', 'hairbrush', 'hair'],
    cues: [
      { id: 'on-head', label: 'Hand on top or side of the head', required: true, eval: (f) => atMost(f.dom.meanY, -1.6, -1.45) },
      { id: 'strokes', label: 'Repeated downward strokes', required: true, eval: (f) => rhythm(f.dom.oscY, 0.12, 0.3) },
      { id: 'slower', label: 'Slower strokes than tooth-brushing', required: false, eval: (f) => atMost(f.dom.oscY.freq || 0, 1.5, 2.3) },
    ],
  },
  {
    id: 'hula-hoop', name: 'Hula hoop', emoji: '⭕', difficulty: 'hard', timeLimit: TIME.hard, safety: SAFE,
    secretPrompt: 'Keep an imaginary hula hoop spinning around your waist.',
    acceptedAnswers: ['hula', 'hula hoop', 'hoop', 'hooping'],
    cues: [
      { id: 'hips', label: 'Hips swing in a steady rhythm', required: true, eval: (f) => rhythm(f.hipX, 0.06, 0.15) },
      { id: 'arms-away', label: 'Arms held up or out, away from the hips', required: true, eval: (f) => Math.max(both(f, (h) => atMost(h.meanY, -1.0, -0.7)), atLeast(f.wristDist.mean, 1.6, 2.2)) },
      { id: 'planted', label: 'Feet stay planted', required: false, eval: (f) => atMost(anklesMove(f), 0.08, 0.2) },
    ],
  },
  {
    id: 'throwing', name: 'Throwing a ball', emoji: '⚾', difficulty: 'hard', timeLimit: TIME.hard, safety: 'Throw an imaginary ball only, away from people.',
    secretPrompt: 'Throw a ball as far as you can, again and again.',
    acceptedAnswers: ['throw', 'throwing', 'pitch', 'pitching', 'baseball', 'cricket', 'bowl', 'bowling', 'ball'],
    cues: [
      { id: 'overarm', label: 'Throwing arm swings from above the head', required: true, eval: (f) => Math.min(atLeast(f.dom.oscY.amp, 0.7, 1.2), atLeast(f.dom.aboveHead, 0.05, 0.15)) },
      { id: 'one-arm', label: 'One arm much more active than the other', required: true, eval: (f) => atLeast(f.dom.travel / (f.other.travel + 0.05), 1.6, 2.5) },
      { id: 'rotate', label: 'Body turns with the throw', required: false, eval: (f) => atLeast(f.shoulderWidth.amp, 0.1, 0.25) },
    ],
  },
];

export const actionById = (id: string) => ACTIONS.find((a) => a.id === id);
export const actionsFor = (d: Difficulty) => ACTIONS.filter((a) => a.difficulty === d);
