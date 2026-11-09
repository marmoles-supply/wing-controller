const TRIM_MIN = -18.0;
const TRIM_MAX = 18.0;
const TRIM_STEP = 0.1;
const VALUE_TOLERANCE = 0.11;
const COMMAND_WINDOW_MS = 1500;

const getStepPrecision = (step) => {
  const raw = String(step ?? '');
  if (!raw.includes('.')) return 0;
  return raw.split('.')[1].replace(/0+$/, '').length;
};

const getToleranceForStep = (step = TRIM_STEP) => {
  const numeric = Number(step);
  if (!Number.isFinite(numeric) || numeric <= 0) return VALUE_TOLERANCE;
  return Number(Math.max(VALUE_TOLERANCE, numeric / 2 + 0.01).toFixed(3));
};

const roundToStep = (value, step = TRIM_STEP) => {
  if (!Number.isFinite(Number(value))) return 0;
  const numeric = Number(value);
  const rounded = Math.round(numeric / step) * step;
  return Number(rounded.toFixed(Math.max(1, getStepPrecision(step))));
};

const clampTrim = (value, min = TRIM_MIN, max = TRIM_MAX, step = TRIM_STEP) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const precision = Math.max(1, getStepPrecision(step));
  return Number(Math.min(max, Math.max(min, numeric)).toFixed(precision));
};

const computeGainDelta = (ownerGainBaseline, currentOwnerGain) => {
  const baseline = Number(ownerGainBaseline);
  const current = Number(currentOwnerGain);
  if (!Number.isFinite(baseline) || !Number.isFinite(current)) return null;
  return Number((current - baseline).toFixed(3));
};

const computeDesiredTrim = (followerTrimBaseline, ownerGainDelta) => {
  const baseline = Number(followerTrimBaseline);
  const delta = Number(ownerGainDelta);
  if (!Number.isFinite(baseline) || !Number.isFinite(delta)) return null;
  return Number((baseline - delta).toFixed(3));
};

const computeCompensation = ({
  ownerGainBaseline,
  currentOwnerGain,
  followerTrimBaseline,
  trimMin = TRIM_MIN,
  trimMax = TRIM_MAX,
  trimStep = TRIM_STEP,
  tolerance = getToleranceForStep(trimStep),
}) => {
  const delta = computeGainDelta(ownerGainBaseline, currentOwnerGain);
  if (!Number.isFinite(Number(delta))) {
    return null;
  }

  const rawDesiredTrim = computeDesiredTrim(followerTrimBaseline, delta);
  if (!Number.isFinite(Number(rawDesiredTrim))) {
    return null;
  }

  const precision = Math.max(1, getStepPrecision(trimStep));
  const roundedDesiredTrim = roundToStep(rawDesiredTrim, trimStep);
  const clampedTrim = clampTrim(roundedDesiredTrim, trimMin, trimMax, trimStep);
  const overshoot = Number(Math.abs(roundedDesiredTrim - clampedTrim).toFixed(precision));

  return {
    delta,
    rawDesiredTrim,
    roundedDesiredTrim,
    desiredTrim: clampedTrim,
    overshoot,
    saturated: overshoot > tolerance,
  };
};

const adoptManualTrimBaseline = (currentFollowerTrim, ownerGainDelta, trimStep = TRIM_STEP) => {
  const currentTrim = Number(currentFollowerTrim);
  const delta = Number(ownerGainDelta);
  if (!Number.isFinite(currentTrim) || !Number.isFinite(delta)) return null;
  return roundToStep(currentTrim + delta, trimStep);
};

const isLikelyCommandEcho = ({
  currentValue,
  commandValue,
  commandAt,
  now = Date.now(),
  tolerance = VALUE_TOLERANCE,
  maxAgeMs = COMMAND_WINDOW_MS,
}) => {
  const current = Number(currentValue);
  const command = Number(commandValue);
  const age = Number(now) - Number(commandAt || 0);
  if (!Number.isFinite(current) || !Number.isFinite(command) || !Number.isFinite(age)) {
    return false;
  }
  if (age < 0 || age > maxAgeMs) {
    return false;
  }
  return Math.abs(current - command) <= tolerance;
};

const summarizeSaturation = (saturationByTarget) => {
  const entries = Object.entries(saturationByTarget || {})
    .filter(([, payload]) => Number(payload?.overshoot || 0) > Number(payload?.tolerance || VALUE_TOLERANCE))
    .sort((a, b) => Number(b[1]?.overshoot || 0) - Number(a[1]?.overshoot || 0));

  if (entries.length === 0) {
    return { saturated: false, maxOvershoot: 0, targets: [] };
  }

  return {
    saturated: true,
    maxOvershoot: Number(entries[0]?.[1]?.overshoot || 0),
    targets: entries.map(([targetKey, payload]) => ({
      targetKey,
      overshoot: Number(payload?.overshoot || 0),
      desiredTrim: Number(payload?.desiredTrim || 0),
      tolerance: Number(payload?.tolerance || VALUE_TOLERANCE),
    })),
  };
};

module.exports = {
  TRIM_MIN,
  TRIM_MAX,
  TRIM_STEP,
  VALUE_TOLERANCE,
  COMMAND_WINDOW_MS,
  getToleranceForStep,
  roundToStep,
  clampTrim,
  computeGainDelta,
  computeDesiredTrim,
  computeCompensation,
  adoptManualTrimBaseline,
  isLikelyCommandEcho,
  summarizeSaturation,
};
