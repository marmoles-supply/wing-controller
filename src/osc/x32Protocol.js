const FADER_DB_MIN = -144.0;
const FADER_DB_OFF_THRESHOLD = -143.5;

const faderFloatToDb = (value) => {
  const f = Number(value);
  if (!Number.isFinite(f) || f <= 0.0) return FADER_DB_MIN;
  if (f >= 0.5) return f * 40.0 - 30.0;
  if (f >= 0.25) return f * 80.0 - 50.0;
  if (f >= 0.0625) return f * 160.0 - 70.0;
  return f * 480.0 - 90.0;
};

const dbToFaderFloat = (value) => {
  const d = Number(value);
  if (!Number.isFinite(d) || d <= FADER_DB_MIN) return 0.0;
  if (d >= -10.0) return (d + 30.0) / 40.0;
  if (d >= -30.0) return (d + 50.0) / 80.0;
  if (d >= -60.0) return (d + 70.0) / 160.0;
  return Math.max(0.0, (d + 90.0) / 480.0);
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toTwoDigitIndex = (index) => String(Number(index)).padStart(2, '0');

const parseBooleanNumber = (value, fallback = 0) => {
  if (value === true) return 1;
  if (value === false) return 0;
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) return numeric >= 0.5 ? 1 : 0;
  const text = String(value || '').trim().toLowerCase();
  if (['on', 'true', 'yes'].includes(text)) return 1;
  if (['off', 'false', 'no'].includes(text)) return 0;
  return fallback;
};

const baseFamilies = {
  ch: {
    nativePrefix: (index) => `/ch/${toTwoDigitIndex(index)}`,
    nativePrefixRegex: /^\/ch\/(\d{2})/,
    canonicalPrefix: (index) => `/ch/${Number(index)}`,
    supportsPan: true,
    supportsSends: true,
    supportsConfig: true,
  },
  bus: {
    nativePrefix: (index) => `/bus/${toTwoDigitIndex(index)}`,
    nativePrefixRegex: /^\/bus\/(\d{2})/,
    canonicalPrefix: (index) => `/bus/${Number(index)}`,
    supportsPan: true,
    supportsSends: true,
    supportsConfig: true,
  },
  aux: {
    nativePrefix: (index) => `/auxin/${toTwoDigitIndex(index)}`,
    nativePrefixRegex: /^\/auxin\/(\d{2})/,
    canonicalPrefix: (index) => `/aux/${Number(index)}`,
    supportsPan: true,
    supportsSends: true,
    supportsConfig: true,
  },
  matrix: {
    nativePrefix: (index) => `/mtx/${toTwoDigitIndex(index)}`,
    nativePrefixRegex: /^\/mtx\/(\d{2})/,
    canonicalPrefix: (index) => `/matrix/${Number(index)}`,
    supportsPan: true,
    supportsSends: false,
    supportsConfig: true,
  },
};

const mainFamily = {
  nativePrefix: () => '/main/st',
  nativePrefixRegex: /^\/main\/st/,
  canonicalPrefix: () => '/main/1',
  supportsPan: true,
  supportsSends: false,
  supportsConfig: true,
};

const canonicalToNative = (canonicalAddress, args = []) => {
  const address = String(canonicalAddress || '').trim();
  if (!address) return null;

  if (address.startsWith('/meters/')) {
    return { unsupported: true, reason: 'metering' };
  }

  const mixMatch = address.match(/^\/(ch|bus|aux|matrix)\/(\d+)\/(.+)$/);
  if (mixMatch) {
    const [, family, indexRaw, suffixRaw] = mixMatch;
    const config = baseFamilies[family];
    const index = Number(indexRaw);
    if (!config || !Number.isFinite(index) || index <= 0) return null;
    const nativeBase = config.nativePrefix(index);
    const suffix = `/${String(suffixRaw || '').replace(/^\/+/, '')}`;

    if (suffix === '/mute') {
      const muted = parseBooleanNumber(args[0], 0);
      return { address: `${nativeBase}/mix/on`, args: [muted ? 0 : 1] };
    }
    if (suffix === '/fdr') {
      return { address: `${nativeBase}/mix/fader`, args: [dbToFaderFloat(args[0])] };
    }
    if (suffix === '/pan' && config.supportsPan) {
      const pan = clamp(Number(args[0]) / 100, -1, 1);
      return { address: `${nativeBase}/mix/pan`, args: [Number.isFinite(pan) ? pan : 0] };
    }
    if ((suffix === '/gain' || suffix === '/in/set/$g') && (family === 'ch' || family === 'aux')) {
      return { address: `${nativeBase}/preamp/trim`, args: [clamp(Number(args[0]), -12, 12)] };
    }
    if (suffix === '/name' && config.supportsConfig) {
      return { address: `${nativeBase}/config/name`, args };
    }
    if (suffix === '/col' && config.supportsConfig) {
      return { address: `${nativeBase}/config/color`, args };
    }
    const sendLevelMatch = suffix.match(/^\/send\/(\d+)\/lvl$/);
    if (sendLevelMatch && config.supportsSends) {
      return {
        address: `${nativeBase}/mix/${toTwoDigitIndex(sendLevelMatch[1])}/level`,
        args: [dbToFaderFloat(args[0])],
      };
    }
    const sendOnMatch = suffix.match(/^\/send\/(\d+)\/on$/);
    if (sendOnMatch && config.supportsSends) {
      return {
        address: `${nativeBase}/mix/${toTwoDigitIndex(sendOnMatch[1])}/on`,
        args: [parseBooleanNumber(args[0], 0)],
      };
    }
    return null;
  }

  const mainMatch = address.match(/^\/main\/(\d+)\/(.+)$/);
  if (mainMatch) {
    const [, indexRaw, suffixRaw] = mainMatch;
    if (Number(indexRaw) !== 1) return null;
    const nativeBase = mainFamily.nativePrefix();
    const suffix = `/${String(suffixRaw || '').replace(/^\/+/, '')}`;
    if (suffix === '/mute') {
      const muted = parseBooleanNumber(args[0], 0);
      return { address: `${nativeBase}/mix/on`, args: [muted ? 0 : 1] };
    }
    if (suffix === '/fdr') {
      return { address: `${nativeBase}/mix/fader`, args: [dbToFaderFloat(args[0])] };
    }
    if (suffix === '/pan') {
      const pan = clamp(Number(args[0]) / 100, -1, 1);
      return { address: `${nativeBase}/mix/pan`, args: [Number.isFinite(pan) ? pan : 0] };
    }
    if (suffix === '/name') {
      return { address: `${nativeBase}/config/name`, args };
    }
    if (suffix === '/col') {
      return { address: `${nativeBase}/config/color`, args };
    }
    return null;
  }

  const dcaMatch = address.match(/^\/dca\/(\d+)\/(.+)$/);
  if (dcaMatch) {
    const [, indexRaw, suffixRaw] = dcaMatch;
    const index = Number(indexRaw);
    if (!Number.isFinite(index) || index <= 0) return null;
    const suffix = `/${String(suffixRaw || '').replace(/^\/+/, '')}`;
    if (suffix === '/mute') {
      const muted = parseBooleanNumber(args[0], 0);
      return { address: `/dca/${index}/on`, args: [muted ? 0 : 1] };
    }
    if (suffix === '/fdr') {
      return { address: `/dca/${index}/fader`, args: [dbToFaderFloat(args[0])] };
    }
    if (suffix === '/name') {
      return { address: `/dca/${index}/config/name`, args };
    }
    if (suffix === '/col') {
      return { address: `/dca/${index}/config/color`, args };
    }
    return null;
  }

  return null;
};

const nativeToCanonical = (nativeAddress, args = []) => {
  const address = String(nativeAddress || '').trim();
  if (!address) return null;

  const mapMixFamily = (family, indexRaw, suffix) => {
    const config = baseFamilies[family];
    if (!config) return null;
    const canonicalBase = config.canonicalPrefix(indexRaw);

    if (suffix === '/mix/on') {
      return { address: `${canonicalBase}/mute`, args: [parseBooleanNumber(args[0], 1) ? 0 : 1] };
    }
    if (suffix === '/mix/fader') {
      return { address: `${canonicalBase}/fdr`, args: [Number(faderFloatToDb(args[0]).toFixed(1))] };
    }
    if (suffix === '/mix/pan') {
      const pan = clamp(Number(args[0]), -1, 1);
      return { address: `${canonicalBase}/pan`, args: [Math.round(pan * 100)] };
    }
    if (suffix === '/preamp/trim' && (family === 'ch' || family === 'aux')) {
      return { address: `${canonicalBase}/in/set/$g`, args: [Number(clamp(Number(args[0]), -12, 12).toFixed(2))] };
    }
    if (suffix === '/config/name') {
      return { address: `${canonicalBase}/name`, args };
    }
    if (suffix === '/config/color') {
      return { address: `${canonicalBase}/col`, args };
    }

    const sendLevelMatch = suffix.match(/^\/mix\/(\d{2})\/level$/);
    if (sendLevelMatch) {
      return {
        address: `${canonicalBase}/send/${Number(sendLevelMatch[1])}/lvl`,
        args: [Number(faderFloatToDb(args[0]).toFixed(1))],
      };
    }
    const sendOnMatch = suffix.match(/^\/mix\/(\d{2})\/on$/);
    if (sendOnMatch) {
      return {
        address: `${canonicalBase}/send/${Number(sendOnMatch[1])}/on`,
        args: [parseBooleanNumber(args[0], 0)],
      };
    }
    return null;
  };

  for (const [family, config] of Object.entries(baseFamilies)) {
    const match = address.match(config.nativePrefixRegex);
    if (!match) continue;
    const indexRaw = Number(match[1]);
    const suffix = address.slice(match[0].length);
    return mapMixFamily(family, indexRaw, suffix);
  }

  if (address.startsWith('/main/st')) {
    const suffix = address.slice('/main/st'.length);
    if (suffix === '/mix/on') return { address: '/main/1/mute', args: [parseBooleanNumber(args[0], 1) ? 0 : 1] };
    if (suffix === '/mix/fader') return { address: '/main/1/fdr', args: [Number(faderFloatToDb(args[0]).toFixed(1))] };
    if (suffix === '/mix/pan') {
      const pan = clamp(Number(args[0]), -1, 1);
      return { address: '/main/1/pan', args: [Math.round(pan * 100)] };
    }
    if (suffix === '/config/name') return { address: '/main/1/name', args };
    if (suffix === '/config/color') return { address: '/main/1/col', args };
  }

  const dcaMatch = address.match(/^\/dca\/(\d+)\/(.+)$/);
  if (dcaMatch) {
    const [, indexRaw, suffixRaw] = dcaMatch;
    const base = `/dca/${Number(indexRaw)}`;
    const suffix = `/${String(suffixRaw || '').replace(/^\/+/, '')}`;
    if (suffix === '/on') return { address: `${base}/mute`, args: [parseBooleanNumber(args[0], 1) ? 0 : 1] };
    if (suffix === '/fader') return { address: `${base}/fdr`, args: [Number(faderFloatToDb(args[0]).toFixed(1))] };
    if (suffix === '/config/name') return { address: `${base}/name`, args };
    if (suffix === '/config/color') return { address: `${base}/col`, args };
  }

  return null;
};

const isCanonicalX32Supported = (canonicalAddress) => {
  const result = canonicalToNative(canonicalAddress, []);
  return Boolean(result && !result.unsupported);
};

export {
  canonicalToNative,
  nativeToCanonical,
  isCanonicalX32Supported,
  faderFloatToDb,
  dbToFaderFloat,
  FADER_DB_OFF_THRESHOLD,
};

export default {
  canonicalToNative,
  nativeToCanonical,
  isCanonicalX32Supported,
  faderFloatToDb,
  dbToFaderFloat,
  FADER_DB_OFF_THRESHOLD,
};
