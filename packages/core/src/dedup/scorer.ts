export interface ScorerInput {
  activityType: string;
  startedAt: Date | number;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

export interface ScoreBreakdown {
  type: number;
  time: number;
  duration: number;
  distance: number;
}

export type DedupOutcome = "merged" | "pending" | "no_match";

export interface DedupReasoningFactor {
  dimension: "activityType" | "startTime" | "duration" | "distance";
  label: string;
  earned: number;
  max: number;
  passed: boolean;
  detail: string;
}

export interface DedupReasoning {
  confidence: number;
  outcome: DedupOutcome;
  factors: DedupReasoningFactor[];
}

export interface ScoreResult {
  confidence: number;
  breakdown: ScoreBreakdown;
  factors: DedupReasoningFactor[];
}

const WEIGHT_TYPE = 30;
const WEIGHT_TIME = 30;
const WEIGHT_DURATION = 25;
const WEIGHT_DISTANCE = 15;
const MAX_SCORE = WEIGHT_TYPE + WEIGHT_TIME + WEIGHT_DURATION + WEIGHT_DISTANCE;

const TIME_WINDOW_MS = 5 * 60 * 1000; // ±5 minutes
const DURATION_TOLERANCE = 0.1; // ±10%
const DISTANCE_TOLERANCE = 0.05; // ±5%

function toMs(v: Date | number): number {
  return v instanceof Date ? v.getTime() : v;
}

function fmtTimeDelta(ms: number): string {
  const totalSecs = Math.round(ms / 1000);
  if (totalSecs < 60) return `${totalSecs} sec`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return secs > 0 ? `${mins} min ${secs} sec` : `${mins} min`;
}

function fmtPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function scoreDedup(candidate: ScorerInput, existing: ScorerInput): ScoreResult {
  const breakdown: ScoreBreakdown = { type: 0, time: 0, duration: 0, distance: 0 };
  const factors: DedupReasoningFactor[] = [];

  // Activity type match (exact)
  const typeMatch = candidate.activityType === existing.activityType;
  breakdown.type = typeMatch ? WEIGHT_TYPE : 0;
  factors.push({
    dimension: "activityType",
    label: "Activity type",
    earned: breakdown.type,
    max: WEIGHT_TYPE,
    passed: typeMatch,
    detail: typeMatch
      ? `Both are '${candidate.activityType}' activities`
      : `Activity types differ ('${candidate.activityType}' vs '${existing.activityType}')`,
  });

  // Start time within ±5 minutes
  const timeDelta = Math.abs(toMs(candidate.startedAt) - toMs(existing.startedAt));
  const timeMatch = timeDelta <= TIME_WINDOW_MS;
  breakdown.time = timeMatch ? WEIGHT_TIME : 0;
  factors.push({
    dimension: "startTime",
    label: "Start time proximity",
    earned: breakdown.time,
    max: WEIGHT_TIME,
    passed: timeMatch,
    detail: timeMatch
      ? `Started ${fmtTimeDelta(timeDelta)} apart (within ±5 min window)`
      : `Started ${fmtTimeDelta(timeDelta)} apart (exceeds ±5 min window)`,
  });

  // Duration within ±10%
  const cDur = candidate.durationSeconds;
  const eDur = existing.durationSeconds;
  let durationMatch = false;
  let durationDetail: string;
  if (cDur === null || eDur === null || cDur <= 0 || eDur <= 0) {
    durationDetail = "Duration not available — dimension scored 0";
  } else {
    const denom = Math.max(cDur, eDur);
    const ratio = Math.abs(cDur - eDur) / denom;
    durationMatch = ratio <= DURATION_TOLERANCE;
    durationDetail = durationMatch
      ? ratio === 0
        ? "Durations are identical"
        : `Duration differs by ${fmtPct(ratio)} (within ±10% tolerance)`
      : `Duration differs by ${fmtPct(ratio)} (exceeds ±10% tolerance)`;
  }
  breakdown.duration = durationMatch ? WEIGHT_DURATION : 0;
  factors.push({
    dimension: "duration",
    label: "Duration similarity",
    earned: breakdown.duration,
    max: WEIGHT_DURATION,
    passed: durationMatch,
    detail: durationDetail,
  });

  // Distance within ±5%
  const cDist = candidate.distanceMeters;
  const eDist = existing.distanceMeters;
  let distanceMatch = false;
  let distanceDetail: string;
  if (cDist === null || eDist === null || cDist <= 0 || eDist <= 0) {
    distanceDetail = "Distance not available — dimension scored 0";
  } else {
    const denom = Math.max(cDist, eDist);
    const ratio = Math.abs(cDist - eDist) / denom;
    distanceMatch = ratio <= DISTANCE_TOLERANCE;
    distanceDetail = distanceMatch
      ? ratio === 0
        ? "Distances are identical"
        : `Distance differs by ${fmtPct(ratio)} (within ±5% tolerance)`
      : `Distance differs by ${fmtPct(ratio)} (exceeds ±5% tolerance)`;
  }
  breakdown.distance = distanceMatch ? WEIGHT_DISTANCE : 0;
  factors.push({
    dimension: "distance",
    label: "Distance similarity",
    earned: breakdown.distance,
    max: WEIGHT_DISTANCE,
    passed: distanceMatch,
    detail: distanceDetail,
  });

  const raw = breakdown.type + breakdown.time + breakdown.duration + breakdown.distance;
  const confidence = raw / MAX_SCORE;

  return { confidence, breakdown, factors };
}
