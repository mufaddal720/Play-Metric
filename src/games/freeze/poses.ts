import type { Difficulty } from '../../core/types';
import type { LmName, SegmentId } from '../../perception/body';

/**
 * Original target-pose library. Every pose is defined by a machine-readable reference skeleton:
 * the direction of each body segment in mirror view (degrees; 0 = screen-right, 90 = down,
 * 180 = screen-left, -90 = up). Directions are independent of height and limb length, so
 * players of every size are judged against the same reference. The on-screen illustration is
 * drawn from these exact numbers, and the animation always ends on this reference (the
 * judging frame is the final pose, never an in-between animation frame).
 */
export type PositionCheck =
  | { kind: 'above' | 'below'; a: LmName; b: LmName; margin: number; label: string }
  | { kind: 'near'; a: LmName; b: LmName; max: number; label: string }
  | { kind: 'apart'; a: LmName; b: LmName; min: number; label: string }
  | { kind: 'level'; a: LmName; b: LmName; max: number; label: string }
  | { kind: 'sideOf'; a: LmName; b: LmName; side: 'left' | 'right'; margin: number; label: string }
  | { kind: 'joint'; a: LmName; b: LmName; c: LmName; min: number; max: number; label: string };

export interface PoseSpec {
  id: string;
  name: string;
  emoji: string;
  instructions: string;
  difficulty: Difficulty;
  angles: Record<SegmentId, number>;
  /** Segments that must be visible and carry full weight in the similarity score. */
  required: SegmentId[];
  /** Segments that count at reduced weight when visible. */
  optional: SegmentId[];
  /** Full-credit angular tolerance in degrees (per segment); credit falls to 0 at tolerance + 45°. */
  tolerance: number;
  checks: PositionCheck[];
  /** If true, the left-right swapped version of the pose is also accepted (best orientation is used). */
  mirrorAllowed: boolean;
  /** Whole body (including ankles) must be in frame. */
  needsFullBody: boolean;
  /** Freeze stability: movement below `deadzone` torso-lengths is free (breathing, model noise); 0 points at `limit`. */
  stability: { deadzone: number; limit: number };
}

const ARMS: SegmentId[] = ['lUpperArm', 'lForearm', 'rUpperArm', 'rForearm'];
const LEGS: SegmentId[] = ['lThigh', 'lShin', 'rThigh', 'rShin'];
const NEUTRAL_LEGS = { lThigh: 95, lShin: 92, rThigh: 85, rShin: 88 };
const STAB = { deadzone: 0.035, limit: 0.15 };
const TOL: Record<Difficulty, number> = { easy: 25, medium: 20, hard: 18 };

export const POSES: PoseSpec[] = [
  {
    id: 'star-shape', name: 'Star Shape', emoji: '⭐', difficulty: 'easy',
    instructions: 'Stretch both arms up and out diagonally and stand with your feet wide apart, like a big star.',
    angles: { torso: -90, lUpperArm: -145, lForearm: -145, rUpperArm: -35, rForearm: -35, lThigh: 120, lShin: 120, rThigh: 60, rShin: 60 },
    required: ['torso', ...ARMS, ...LEGS], optional: [], tolerance: TOL.easy, mirrorAllowed: false, needsFullBody: true, stability: STAB,
    checks: [
      { kind: 'above', a: 'lWrist', b: 'nose', margin: 0, label: 'Left hand above head height' },
      { kind: 'above', a: 'rWrist', b: 'nose', margin: 0, label: 'Right hand above head height' },
      { kind: 'apart', a: 'lAnkle', b: 'rAnkle', min: 1.1, label: 'Feet wide apart' },
    ],
  },
  {
    id: 'airplane-wings', name: 'Airplane Wings', emoji: '✈️', difficulty: 'easy',
    instructions: 'Hold both arms straight out to the sides at shoulder height, like aeroplane wings.',
    angles: { torso: -90, lUpperArm: 180, lForearm: 180, rUpperArm: 0, rForearm: 0, ...NEUTRAL_LEGS },
    required: ['torso', ...ARMS], optional: LEGS, tolerance: TOL.easy, mirrorAllowed: false, needsFullBody: false, stability: STAB,
    checks: [
      { kind: 'level', a: 'lWrist', b: 'lShoulder', max: 0.3, label: 'Left hand at shoulder height' },
      { kind: 'level', a: 'rWrist', b: 'rShoulder', max: 0.3, label: 'Right hand at shoulder height' },
      { kind: 'apart', a: 'lWrist', b: 'rWrist', min: 2.4, label: 'Arms fully stretched' },
    ],
  },
  {
    id: 'robot-pose', name: 'Robot Pose', emoji: '🤖', difficulty: 'easy',
    instructions: 'Lift your elbows out to shoulder height and point both forearms straight up. Square corners only!',
    angles: { torso: -90, lUpperArm: 180, lForearm: -90, rUpperArm: 0, rForearm: -90, ...NEUTRAL_LEGS },
    required: ['torso', ...ARMS], optional: LEGS, tolerance: TOL.easy, mirrorAllowed: false, needsFullBody: false, stability: STAB,
    checks: [
      { kind: 'joint', a: 'lShoulder', b: 'lElbow', c: 'lWrist', min: 65, max: 115, label: 'Left elbow at a right angle' },
      { kind: 'joint', a: 'rShoulder', b: 'rElbow', c: 'rWrist', min: 65, max: 115, label: 'Right elbow at a right angle' },
      { kind: 'above', a: 'lWrist', b: 'lElbow', margin: 0.3, label: 'Left hand above left elbow' },
      { kind: 'above', a: 'rWrist', b: 'rElbow', margin: 0.3, label: 'Right hand above right elbow' },
    ],
  },
  {
    id: 'strong-hero', name: 'Strong Hero', emoji: '💪', difficulty: 'easy',
    instructions: 'Stand with feet apart and flex both arms: elbows out to the sides, fists curled in towards your head.',
    angles: { torso: -90, lUpperArm: 170, lForearm: -55, rUpperArm: 10, rForearm: -125, lThigh: 105, lShin: 95, rThigh: 75, rShin: 85 },
    required: ['torso', ...ARMS], optional: LEGS, tolerance: TOL.easy, mirrorAllowed: false, needsFullBody: false, stability: STAB,
    checks: [
      { kind: 'joint', a: 'lShoulder', b: 'lElbow', c: 'lWrist', min: 25, max: 90, label: 'Left arm tightly flexed' },
      { kind: 'joint', a: 'rShoulder', b: 'rElbow', c: 'rWrist', min: 25, max: 90, label: 'Right arm tightly flexed' },
      { kind: 'above', a: 'lWrist', b: 'lShoulder', margin: 0.15, label: 'Left fist above shoulder' },
      { kind: 'above', a: 'rWrist', b: 'rShoulder', margin: 0.15, label: 'Right fist above shoulder' },
    ],
  },
  {
    id: 'flamingo-balance', name: 'Flamingo Balance', emoji: '🦩', difficulty: 'medium',
    instructions: 'Balance on one leg. Lift the other knee out to the side with the foot tucked in, and spread your arms like wings.',
    angles: { torso: -90, lUpperArm: 165, lForearm: 165, rUpperArm: 15, rForearm: 15, lThigh: 170, lShin: 60, rThigh: 88, rShin: 90 },
    required: ['torso', ...ARMS, ...LEGS], optional: [], tolerance: TOL.medium, mirrorAllowed: true, needsFullBody: true, stability: STAB,
    checks: [
      { kind: 'above', a: 'lAnkle', b: 'rAnkle', margin: 0.5, label: 'Lifted foot clearly off the floor' },
      { kind: 'joint', a: 'lHip', b: 'lKnee', c: 'lAnkle', min: 30, max: 130, label: 'Lifted knee bent' },
      { kind: 'apart', a: 'lWrist', b: 'rWrist', min: 2.0, label: 'Arms spread like wings' },
    ],
  },
  {
    id: 'goal-celebration', name: 'Goal Celebration', emoji: '🙌', difficulty: 'medium',
    instructions: 'Throw both arms up high in a V shape with your feet apart — you just scored the winning goal!',
    angles: { torso: -90, lUpperArm: -115, lForearm: -110, rUpperArm: -65, rForearm: -70, lThigh: 110, lShin: 100, rThigh: 70, rShin: 80 },
    required: ['torso', ...ARMS], optional: LEGS, tolerance: TOL.medium, mirrorAllowed: false, needsFullBody: false, stability: STAB,
    checks: [
      { kind: 'above', a: 'lWrist', b: 'nose', margin: 0.3, label: 'Left hand high above head' },
      { kind: 'above', a: 'rWrist', b: 'nose', margin: 0.3, label: 'Right hand high above head' },
      { kind: 'apart', a: 'lWrist', b: 'rWrist', min: 1.0, label: 'Arms open in a V' },
    ],
  },
  {
    id: 'curious-detective', name: 'Curious Detective', emoji: '🔍', difficulty: 'medium',
    instructions: 'Put one hand on your hip and bring the other hand up to your chin, as if thinking hard about a clue.',
    angles: { torso: -95, lUpperArm: 135, lForearm: 45, rUpperArm: 110, rForearm: -105, ...NEUTRAL_LEGS },
    required: ['torso', ...ARMS], optional: LEGS, tolerance: TOL.medium, mirrorAllowed: true, needsFullBody: false, stability: STAB,
    checks: [
      { kind: 'near', a: 'rWrist', b: 'nose', max: 0.7, label: 'Thinking hand at the chin' },
      { kind: 'near', a: 'lWrist', b: 'lHip', max: 0.55, label: 'Other hand on the hip' },
      { kind: 'joint', a: 'lShoulder', b: 'lElbow', c: 'lWrist', min: 50, max: 130, label: 'Hip-hand elbow bent outwards' },
    ],
  },
  {
    id: 'tiny-dinosaur', name: 'Tiny Dinosaur', emoji: '🦖', difficulty: 'medium',
    instructions: 'Bend your knees, tuck your elbows into your sides and hold your hands up in front of your chest like tiny T-rex arms.',
    angles: { torso: -90, lUpperArm: 95, lForearm: 10, rUpperArm: 85, rForearm: 170, lThigh: 120, lShin: 75, rThigh: 60, rShin: 105 },
    required: ['torso', ...ARMS, ...LEGS], optional: [], tolerance: TOL.medium, mirrorAllowed: false, needsFullBody: true, stability: STAB,
    checks: [
      { kind: 'below', a: 'lWrist', b: 'lShoulder', margin: 0.2, label: 'Left hand below shoulder' },
      { kind: 'above', a: 'lWrist', b: 'hipMid', margin: 0.15, label: 'Left hand above hips' },
      { kind: 'joint', a: 'lShoulder', b: 'lElbow', c: 'lWrist', min: 45, max: 130, label: 'Elbows bent' },
      { kind: 'joint', a: 'lHip', b: 'lKnee', c: 'lAnkle', min: 60, max: 160, label: 'Knees bent' },
    ],
  },
  {
    id: 'invisible-wall', name: 'Invisible Wall', emoji: '🧱', difficulty: 'medium',
    instructions: 'An invisible wall is beside you! Lean into it and push with both palms on the same side, one leg stepped back.',
    angles: { torso: -75, lUpperArm: 5, lForearm: 0, rUpperArm: 20, rForearm: -20, lThigh: 120, lShin: 110, rThigh: 70, rShin: 95 },
    required: ['torso', ...ARMS], optional: LEGS, tolerance: TOL.medium, mirrorAllowed: true, needsFullBody: false, stability: STAB,
    checks: [
      { kind: 'sideOf', a: 'lWrist', b: 'rShoulder', side: 'right', margin: 0.15, label: 'Far hand reaches across to the wall' },
      { kind: 'sideOf', a: 'rWrist', b: 'rShoulder', side: 'right', margin: 0.4, label: 'Near hand pressed on the wall' },
      { kind: 'level', a: 'lWrist', b: 'lShoulder', max: 0.45, label: 'Hands at shoulder height' },
    ],
  },
  {
    id: 'sneaky-spy', name: 'Sneaky Spy', emoji: '🕵️', difficulty: 'hard',
    instructions: 'Crouch low with knees wide and clasp your hands together under your chin, pointing up like a secret agent.',
    angles: { torso: -90, lUpperArm: 60, lForearm: -75, rUpperArm: 120, rForearm: -105, lThigh: 150, lShin: 85, rThigh: 30, rShin: 95 },
    required: ['torso', ...ARMS, ...LEGS], optional: [], tolerance: TOL.hard, mirrorAllowed: false, needsFullBody: true, stability: STAB,
    checks: [
      { kind: 'near', a: 'lWrist', b: 'rWrist', max: 0.45, label: 'Hands clasped together' },
      { kind: 'above', a: 'lWrist', b: 'lElbow', margin: 0.2, label: 'Hands pointing up' },
      { kind: 'joint', a: 'lHip', b: 'lKnee', c: 'lAnkle', min: 60, max: 140, label: 'Left knee deeply bent' },
      { kind: 'apart', a: 'lKnee', b: 'rKnee', min: 1.3, label: 'Knees wide' },
    ],
  },
  {
    id: 'superhero-landing', name: 'Superhero Landing', emoji: '🦸', difficulty: 'hard',
    instructions: 'Drop into a wide, low squat. Push one fist down towards the floor and stretch the other arm up and out behind you.',
    angles: { torso: -80, lUpperArm: -150, lForearm: -155, rUpperArm: 80, rForearm: 85, lThigh: 150, lShin: 95, rThigh: 30, rShin: 85 },
    required: ['torso', ...ARMS, ...LEGS], optional: [], tolerance: TOL.hard, mirrorAllowed: true, needsFullBody: true, stability: STAB,
    checks: [
      { kind: 'below', a: 'rWrist', b: 'hipMid', margin: 0.1, label: 'Landing fist below the hips' },
      { kind: 'above', a: 'lWrist', b: 'lShoulder', margin: 0.3, label: 'Other arm stretched up' },
      { kind: 'apart', a: 'lKnee', b: 'rKnee', min: 1.3, label: 'Wide squat' },
      { kind: 'joint', a: 'rHip', b: 'rKnee', c: 'rAnkle', min: 60, max: 145, label: 'Knees bent' },
    ],
  },
  {
    id: 'mirror-champion', name: 'Mirror Champion', emoji: '🪞', difficulty: 'hard',
    instructions: 'Left arm straight UP, right arm straight OUT to the side, and lift your RIGHT leg out sideways. Sides matter!',
    angles: { torso: -90, lUpperArm: -90, lForearm: -90, rUpperArm: 0, rForearm: 0, lThigh: 92, lShin: 90, rThigh: 35, rShin: 40 },
    required: ['torso', ...ARMS, ...LEGS], optional: [], tolerance: TOL.hard, mirrorAllowed: false, needsFullBody: true, stability: STAB,
    checks: [
      { kind: 'above', a: 'lWrist', b: 'nose', margin: 0.3, label: 'Left hand straight up' },
      { kind: 'level', a: 'rWrist', b: 'rShoulder', max: 0.3, label: 'Right hand at shoulder height' },
      { kind: 'above', a: 'rAnkle', b: 'lAnkle', margin: 0.35, label: 'Right foot lifted' },
    ],
  },
];

export const NEUTRAL_POSE: Record<SegmentId, number> = {
  torso: -90, lUpperArm: 100, lForearm: 95, rUpperArm: 80, rForearm: 85, ...NEUTRAL_LEGS,
};

export const poseById = (id: string) => POSES.find((p) => p.id === id);
