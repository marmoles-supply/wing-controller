const UNKNOWN_CAPABILITIES = Object.freeze({
  macros: false,
  automizations: false,
  selectedStripTracking: false,
  nativeMetersV3: false,
  haCompensation: false,
});

const FAMILY_PRESETS = {
  unknown: {
    family: 'unknown',
    familyLabel: 'Unknown',
    supportLevel: 'unknown',
    brand: null,
    capabilities: UNKNOWN_CAPABILITIES,
  },
  wing: {
    family: 'wing',
    familyLabel: 'WING',
    supportLevel: 'full',
    brand: 'behringer',
    capabilities: Object.freeze({
      macros: true,
      automizations: true,
      selectedStripTracking: true,
      nativeMetersV3: true,
      haCompensation: true,
    }),
  },
  'x32-family': {
    family: 'x32-family',
    familyLabel: 'X32/M32-family',
    supportLevel: 'partial',
    brand: null,
      capabilities: Object.freeze({
        macros: true,
        automizations: true,
        selectedStripTracking: false,
        nativeMetersV3: false,
        haCompensation: true,
      }),
    },
  };

const WING_MODEL_RULES = [
  { match: ['wing-rack'], model: 'wing-rack', displayName: 'WING Rack' },
  { match: ['wing-compact'], model: 'wing-compact', displayName: 'WING Compact' },
  { match: ['ngc-full', 'wing-bk'], model: 'wing', displayName: 'WING' },
  { match: ['wing'], model: 'wing', displayName: 'WING' },
];

const X32_MODEL_RULES = [
  { match: ['m32r live', 'm32r'], model: 'm32r', displayName: 'Midas M32R', brand: 'midas' },
  { match: ['m32c'], model: 'm32c', displayName: 'Midas M32C', brand: 'midas' },
  { match: ['m32'], model: 'm32', displayName: 'Midas M32', brand: 'midas' },
  { match: ['x32 rack', 'x32rack'], model: 'x32-rack', displayName: 'Behringer X32 Rack', brand: 'behringer' },
  { match: ['x32 compact', 'x32compact'], model: 'x32-compact', displayName: 'Behringer X32 Compact', brand: 'behringer' },
  { match: ['x32 producer', 'x32producer'], model: 'x32-producer', displayName: 'Behringer X32 Producer', brand: 'behringer' },
  { match: ['x32 core', 'x32core'], model: 'x32-core', displayName: 'Behringer X32 Core', brand: 'behringer' },
  { match: ['x32'], model: 'x32', displayName: 'Behringer X32', brand: 'behringer' },
];

const normalizeCandidateText = (candidate) => {
  if (candidate === null || candidate === undefined) return '';
  if (Array.isArray(candidate)) {
    return candidate
      .map((item) => normalizeCandidateText(item))
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  if (typeof candidate === 'object') {
    if (Array.isArray(candidate.args)) {
      return normalizeCandidateText(candidate.args);
    }
    return Object.values(candidate)
      .map((item) => normalizeCandidateText(item))
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return String(candidate).trim();
};

const buildIdentity = (presetKey, model, displayName, extras = {}) => {
  const preset = FAMILY_PRESETS[presetKey] || FAMILY_PRESETS.unknown;
  return {
    family: preset.family,
    familyLabel: preset.familyLabel,
    supportLevel: preset.supportLevel,
    brand: extras.brand || preset.brand || null,
    model: model || preset.family,
    displayName: displayName || preset.familyLabel,
    capabilities: preset.capabilities,
    rawText: extras.rawText || '',
    source: extras.source || 'unknown',
    sourcePort: Number.isInteger(Number(extras.sourcePort)) ? Number(extras.sourcePort) : null,
    inferred: extras.inferred === true,
  };
};

const detectByRules = (normalizedText, rules, familyKey) => {
  for (const rule of rules) {
    if (rule.match.some((token) => normalizedText.includes(token))) {
      return buildIdentity(
        familyKey,
        rule.model,
        rule.displayName,
        { brand: rule.brand, rawText: normalizedText },
      );
    }
  }
  return null;
};

const getConsoleCapabilities = (family) => {
  const preset = FAMILY_PRESETS[family] || FAMILY_PRESETS.unknown;
  return preset.capabilities;
};

const isWingConsoleFamily = (familyOrIdentity) => {
  if (!familyOrIdentity) return false;
  if (typeof familyOrIdentity === 'string') return familyOrIdentity === 'wing';
  return familyOrIdentity.family === 'wing';
};

const detectConsoleIdentity = (candidate, options = {}) => {
  const normalizedText = normalizeCandidateText(candidate).toLowerCase();
  if (!normalizedText) return null;

  const wingIdentity = detectByRules(normalizedText, WING_MODEL_RULES, 'wing');
  if (wingIdentity) {
    return {
      ...wingIdentity,
      source: options.source || 'unknown',
      sourcePort: Number.isInteger(Number(options.sourcePort)) ? Number(options.sourcePort) : null,
    };
  }

  const x32Identity = detectByRules(normalizedText, X32_MODEL_RULES, 'x32-family');
  if (x32Identity) {
    return {
      ...x32Identity,
      source: options.source || 'unknown',
      sourcePort: Number.isInteger(Number(options.sourcePort)) ? Number(options.sourcePort) : null,
    };
  }

  if (options.address === '/info' && Number(options.sourcePort) === 10023) {
    return buildIdentity('x32-family', 'x32-family', 'X32/M32-family', {
      rawText: normalizedText,
      source: options.source || 'unknown',
      sourcePort: 10023,
      inferred: true,
    });
  }

  return null;
};

export {
  detectConsoleIdentity,
  getConsoleCapabilities,
  isWingConsoleFamily,
};

export default {
  detectConsoleIdentity,
  getConsoleCapabilities,
  isWingConsoleFamily,
};
