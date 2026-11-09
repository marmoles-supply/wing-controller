/**
 * Pure value-scale and value-formatting helpers shared across the app.
 *
 * Extracted verbatim from src/app/index.tsx (Domain Extraction session) with no
 * behavior change. These are pure functions/constants with no React or Expo
 * dependency, so they can be unit-tested and reused outside the UI layer.
 *
 * NOTE (follow-up): `faderFloatToDb` / `dbToFaderFloat` / `FADER_DB_MIN` are also
 * defined independently in src/osc/MacroEngine.js and src/osc/x32Protocol.js
 * (CommonJS). Unifying those across the ESM/CJS boundary is a separate,
 * higher-risk change and is intentionally NOT done here.
 */

export const FADER_DB_MIN = -144.0;
export const FADER_DB_MAX = 10.0;
export const METER_DB_MIN = -128.0;
export const METER_DB_MAX = 12.0;
export const FADER_DB_OFF_THRESHOLD = -143.5;
export const FADER_SCALE_OFF_DB_MAX = -90.0;
export const FADER_SCALE_OFF_SLIDER_MAX = 0.06;
export const PAN_MIN = -100;
export const PAN_MAX = 100;

export const faderFloatToDb = (f: number): number => {
  if (f >= 0.5) return f * 40.0 - 30.0;
  if (f >= 0.25) return f * 80.0 - 50.0;
  if (f >= 0.0625) return f * 160.0 - 70.0;
  if (f > 0.0) return f * 480.0 - 90.0;
  return -144.0;
};

export const dbToFaderFloat = (d: number): number => {
  if (d <= FADER_DB_MIN) return 0.0;
  if (d >= -10.0) return (d + 30.0) / 40.0;
  if (d >= -30.0) return (d + 50.0) / 80.0;
  if (d >= -60.0) return (d + 70.0) / 160.0;
  return Math.max(0.0, (d + 90.0) / 480.0);
};

export const formatDbValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  if (value <= METER_DB_MIN) return '-oo dB';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
};

export const formatFaderDbValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  if (value <= FADER_DB_OFF_THRESHOLD) return '-oo dB';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
};

export const clampNumber = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const mapRange = (
  value: number,
  inputMin: number,
  inputMax: number,
  outputMin: number,
  outputMax: number,
): number => {
  if (inputMax === inputMin) return outputMax;
  const normalized = (value - inputMin) / (inputMax - inputMin);
  return outputMin + normalized * (outputMax - outputMin);
};

const METER_SCALE_SEGMENTS = [
  { dbMin: -90, dbMax: -60, outMin: 0.0, outMax: 0.08 },
  { dbMin: -60, dbMax: -40, outMin: 0.08, outMax: 0.24 },
  { dbMin: -40, dbMax: -20, outMin: 0.24, outMax: 0.50 },
  { dbMin: -20, dbMax: -10, outMin: 0.50, outMax: 0.68 },
  { dbMin: -10, dbMax: 0, outMin: 0.68, outMax: 0.84 },
  { dbMin: 0, dbMax: 6, outMin: 0.84, outMax: 0.93 },
  { dbMin: 6, dbMax: METER_DB_MAX, outMin: 0.93, outMax: 1.0 },
];

export const mapDbToScaledMeter = (db: number): number => {
  const value = clampNumber(db, METER_DB_MIN, METER_DB_MAX);
  if (value <= -90) return 0;
  for (const segment of METER_SCALE_SEGMENTS) {
    if (value <= segment.dbMax) {
      return mapRange(value, segment.dbMin, segment.dbMax, segment.outMin, segment.outMax);
    }
  }
  return 1;
};

export const mapScaledMeterToDb = (scaled: number): number => {
  const value = clampNumber(scaled, 0, 1);
  if (value <= 0) return -90;
  for (const segment of METER_SCALE_SEGMENTS) {
    if (value <= segment.outMax) {
      return mapRange(value, segment.outMin, segment.outMax, segment.dbMin, segment.dbMax);
    }
  }
  return METER_DB_MAX;
};

export const mapDbToScaledFader = (db: number): number => {
  const value = clampNumber(db, FADER_DB_MIN, FADER_DB_MAX);
  if (value <= FADER_SCALE_OFF_DB_MAX) {
    return mapRange(value, FADER_DB_MIN, FADER_SCALE_OFF_DB_MAX, 0, FADER_SCALE_OFF_SLIDER_MAX);
  }

  const meterMin = mapDbToScaledMeter(FADER_SCALE_OFF_DB_MAX);
  const meterMax = mapDbToScaledMeter(FADER_DB_MAX);
  const meterScaled = mapDbToScaledMeter(value);
  return clampNumber(
    mapRange(meterScaled, meterMin, meterMax, FADER_SCALE_OFF_SLIDER_MAX, 1),
    0,
    1,
  );
};

export const mapScaledFaderToDb = (scaled: number): number => {
  const value = clampNumber(scaled, 0, 1);
  if (value <= FADER_SCALE_OFF_SLIDER_MAX) {
    return clampNumber(
      mapRange(value, 0, FADER_SCALE_OFF_SLIDER_MAX, FADER_DB_MIN, FADER_SCALE_OFF_DB_MAX),
      FADER_DB_MIN,
      FADER_DB_MAX,
    );
  }

  const meterMin = mapDbToScaledMeter(FADER_SCALE_OFF_DB_MAX);
  const meterMax = mapDbToScaledMeter(FADER_DB_MAX);
  const meterScaled = mapRange(value, FADER_SCALE_OFF_SLIDER_MAX, 1, meterMin, meterMax);
  return clampNumber(mapScaledMeterToDb(meterScaled), FADER_DB_MIN, FADER_DB_MAX);
};

export const meterDbToFillPercent = (db: number | null | undefined): number => {
  if (db === null || db === undefined || Number.isNaN(db)) return 0;
  return mapDbToScaledMeter(db) * 100;
};

export const formatFrequencyValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz`;
  return `${value.toFixed(value < 100 ? 1 : 0)} Hz`;
};

export const formatMillisecondsValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
};

export const formatPercentValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${value.toFixed(0)}%`;
};

export const formatRatioValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${value.toFixed(1)}:1`;
};

export const formatQValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `Q ${value.toFixed(2)}`;
};

export const frequencyToSliderValue = (frequency: number, min = 20, max = 20000): number => {
  const clamped = clampNumber(frequency, min, max);
  return (Math.log10(clamped) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
};

export const sliderValueToFrequency = (value: number, min = 20, max = 20000): number => {
  const exponent = Math.log10(min) + value * (Math.log10(max) - Math.log10(min));
  return Math.pow(10, exponent);
};
