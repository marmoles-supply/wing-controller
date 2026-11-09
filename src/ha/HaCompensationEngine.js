import * as FileSystem from 'expo-file-system/legacy';
import OscManager from '../osc/OscManager';
import HaMath from './haMath';
import { readJsonTextWithBackup, safeWriteJson } from '../storage/safeJsonStorage';

const HA_PAIRS_FILE = `${FileSystem.documentDirectory}ha_compensation_pairs.json`;
const HA_SCHEMA_VERSION = 1;
const DEFAULT_OSC_PORT = 2223;
const SESSION_SCOPE_PREFIX = 'ha_pair';
const MAX_HA_PAIRS = 32;
const MAX_HA_MAPPINGS = 256;
const MAX_HA_TARGETS_PER_ENDPOINT = 64;
const isHaPayloadStructureValid = (payload) =>
  Boolean(
    payload
    && Array.isArray(payload.items)
    && payload.items.length <= MAX_HA_PAIRS
    && payload.items.every((pair) =>
      pair
      && typeof pair === 'object'
      && !Array.isArray(pair)
      && (!('mappings' in pair) || Array.isArray(pair.mappings))
    )
  );

const createHaId = (prefix) =>
  `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

const isValidIpv4 = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const numeric = Number(part);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
  });
};

const getFollowerEndpointId = (ownerId) => (ownerId === 'b' ? 'a' : 'b');

const getEndpointSessionKey = (pairId, endpointId) => `${pairId}:${endpointId}`;

const getTargetKey = (target) => `${target.family}:${target.index}`;

const describeTarget = (target) => {
  if (!target) return 'Unknown target';
  return `${target.family === 'aux' ? 'AUX' : 'CH'} ${target.index}`;
};

const SUPPORTED_HA_FAMILIES = new Set(['wing', 'x32-family']);

const isHaCompatibleFamily = (family) => SUPPORTED_HA_FAMILIES.has(String(family || '').trim());

const normalizeHaFamily = (family) => (isHaCompatibleFamily(family) ? String(family).trim() : 'unknown');

const formatX32HeadampIndex = (index) => String(Number(index)).padStart(3, '0');

const getHaSourceMax = (family, ownerFamily = 'unknown') => {
  const normalizedFamily = String(family || '').trim();
  const normalizedOwnerFamily = normalizeHaFamily(ownerFamily);
  if (normalizedOwnerFamily === 'x32-family') {
    if (normalizedFamily === 'local') return 32;
    if (normalizedFamily === 'aes50a' || normalizedFamily === 'aes50b') return 48;
    return 0;
  }
  if (normalizedFamily === 'local') return normalizedOwnerFamily === 'unknown' ? 32 : 24;
  if (normalizedFamily === 'aes50a' || normalizedFamily === 'aes50b' || normalizedFamily === 'aes50c') return 48;
  return 0;
};

const getHaTargetMax = (family, followerFamily = 'unknown') => {
  const normalizedFamily = String(family || '').trim();
  if (normalizedFamily === 'aux') return 8;
  if (normalizedFamily !== 'ch') return 0;
  return normalizeHaFamily(followerFamily) === 'x32-family' ? 32 : 40;
};

const getX32HeadampIndex = (source) => {
  const index = Number(source?.index || 0);
  if (!Number.isInteger(index) || index < 1) return null;
  if (source?.family === 'local' && index <= 32) return index - 1;
  if (source?.family === 'aes50a' && index <= 48) return 31 + index;
  if (source?.family === 'aes50b' && index <= 48) return 79 + index;
  return null;
};

const getHaGainAddress = (source, ownerFamily = 'wing') => {
  const index = Number(source?.index || 0);
  if (!Number.isInteger(index) || index < 1) return null;
  const normalizedOwnerFamily = normalizeHaFamily(ownerFamily);
  if (normalizedOwnerFamily === 'x32-family') {
    const headampIndex = getX32HeadampIndex(source);
    return Number.isInteger(headampIndex) ? `/headamp/${formatX32HeadampIndex(headampIndex)}/gain` : null;
  }
  if (source?.family === 'local' && index <= 24) return `/io/in/LCL/${index}/g`;
  if (source?.family === 'aes50a' && index <= 48) return `/io/in/A/${index}/g`;
  if (source?.family === 'aes50b' && index <= 48) return `/io/in/B/${index}/g`;
  if (source?.family === 'aes50c' && index <= 48) return `/io/in/C/${index}/g`;
  return null;
};

const getHaRemoteWarningAddress = (source, ownerFamily = 'wing') => {
  if (normalizeHaFamily(ownerFamily) !== 'wing') return null;
  if (source?.family === 'aes50a') return '/$globals/harmt/a';
  if (source?.family === 'aes50b') return '/$globals/harmt/b';
  if (source?.family === 'aes50c') return '/$globals/harmt/c';
  return null;
};

const getTrimSpec = (target, followerFamily = 'wing') => {
  const index = Number(target?.index || 0);
  if (!Number.isInteger(index) || index < 1) return null;
  const normalizedFollowerFamily = normalizeHaFamily(followerFamily);
  if (normalizedFollowerFamily === 'x32-family') {
    if (target?.family === 'ch' && index <= 32) {
      const step = 0.25;
      return {
        address: `/ch/${index}/in/set/$g`,
        min: -12.0,
        max: 12.0,
        step,
        tolerance: HaMath.getToleranceForStep(step),
      };
    }
    if (target?.family === 'aux' && index <= 8) {
      const step = 0.25;
      return {
        address: `/aux/${index}/in/set/$g`,
        min: -12.0,
        max: 12.0,
        step,
        tolerance: HaMath.getToleranceForStep(step),
      };
    }
    return null;
  }
  if (target?.family === 'ch' && index <= 40) {
    const step = 0.1;
    return {
      address: `/ch/${index}/in/set/trim`,
      min: -18.0,
      max: 18.0,
      step,
      tolerance: HaMath.getToleranceForStep(step),
    };
  }
  if (target?.family === 'aux' && index <= 8) {
    const step = 0.1;
    return {
      address: `/aux/${index}/in/set/trim`,
      min: -18.0,
      max: 18.0,
      step,
      tolerance: HaMath.getToleranceForStep(step),
    };
  }
  return null;
};

const getTrimAddress = (target, followerFamily = 'wing') => getTrimSpec(target, followerFamily)?.address || null;

const getPrecisionForStep = (step) => {
  const normalized = Number(step);
  if (!Number.isFinite(normalized) || normalized <= 0) return 1;
  const raw = String(normalized);
  if (!raw.includes('.')) return 0;
  return Math.max(0, raw.split('.')[1].replace(/0+$/, '').length);
};

const buildFollowerTargetCollisions = (pair, followerId) => {
  const targetMap = new Map();
  (pair?.mappings || []).forEach((mapping, mappingIndex) => {
    if (mapping?.enabled === false) return;
    const targets = mapping?.targetsByEndpoint?.[followerId] || [];
    targets.forEach((target) => {
      const targetKey = getTargetKey(target);
      const existing = targetMap.get(targetKey) || [];
      existing.push({
        mappingId: mapping.id,
        mappingName: mapping.name || `HA Link ${mappingIndex + 1}`,
        mappingIndex,
        target,
      });
      targetMap.set(targetKey, existing);
    });
  });

  return Array.from(targetMap.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([targetKey, entries]) => ({
      targetKey,
      target: entries[0]?.target || null,
      mappingIds: entries.map((entry) => entry.mappingId),
      mappingNames: entries.map((entry) => entry.mappingName),
    }));
};

const extractOscScalar = (value) => {
  if (Array.isArray(value)) {
    if (value.length >= 3) return value[2];
    if (value.length >= 1) return value[0];
    return null;
  }
  if (value && typeof value === 'object' && Array.isArray(value.args)) {
    return extractOscScalar(value.args);
  }
  return value ?? null;
};

const extractNumericState = (value) => {
  const scalar = extractOscScalar(value);
  const numeric = Number(scalar);
  return Number.isFinite(numeric) ? numeric : null;
};

const sanitizeEndpoint = (raw, endpointId) => {
  const parsedPort = Number(raw?.oscPort);
  return {
    id: endpointId,
    label: typeof raw?.label === 'string' && raw.label.trim() ? raw.label.trim() : endpointId.toUpperCase(),
    ip: typeof raw?.ip === 'string' ? raw.ip.trim() : '',
    oscPort: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_OSC_PORT,
  };
};

const sanitizeSource = (raw) => {
  const family = ['local', 'aes50a', 'aes50b', 'aes50c'].includes(String(raw?.family || '').trim())
    ? String(raw.family).trim()
    : 'aes50a';
  const parsedIndex = Number(raw?.index);
  const maxIndex = getHaSourceMax(family, 'unknown');
  return {
    family,
    index: Number.isInteger(parsedIndex) ? Math.min(maxIndex, Math.max(1, parsedIndex)) : 1,
  };
};

const sanitizeTarget = (raw) => {
  const family = String(raw?.family || '').trim() === 'aux' ? 'aux' : 'ch';
  const parsedIndex = Number(raw?.index);
  const maxIndex = getHaTargetMax(family, 'unknown');
  return {
    family,
    index: Number.isInteger(parsedIndex) ? Math.min(maxIndex, Math.max(1, parsedIndex)) : 1,
  };
};

const createDefaultMapping = (indexHint = 1) => ({
  id: createHaId('ha_map'),
  name: `HA Link ${indexHint}`,
  enabled: true,
  source: sanitizeSource({ family: 'aes50a', index: indexHint }),
  targetsByEndpoint: {
    a: [sanitizeTarget({ family: 'ch', index: indexHint })],
    b: [sanitizeTarget({ family: 'ch', index: indexHint })],
  },
});

const sanitizeMapping = (raw, indexHint = 1) => {
  const normalizeTargetList = (input) => {
    const seenTargets = new Set();
    if (!Array.isArray(input) || input.length === 0) return [];
    return input
      .slice(0, MAX_HA_TARGETS_PER_ENDPOINT)
      .map((item) => sanitizeTarget(item))
      .filter((item) => {
        const key = getTargetKey(item);
        if (seenTargets.has(key)) return false;
        seenTargets.add(key);
        return true;
      });
  };

  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : createHaId('ha_map'),
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : `HA Link ${indexHint}`,
    enabled: raw?.enabled !== false,
    source: sanitizeSource(raw?.source),
    targetsByEndpoint: {
      a: normalizeTargetList(raw?.targetsByEndpoint?.a),
      b: normalizeTargetList(raw?.targetsByEndpoint?.b),
    },
  };
};

const sanitizePair = (raw, indexHint = 1) => {
  const seenMappingIds = new Set();
  const mappings = (Array.isArray(raw?.mappings) && raw.mappings.length > 0
    ? raw.mappings.slice(0, MAX_HA_MAPPINGS).map((mapping, idx) => sanitizeMapping(mapping, idx + 1))
    : [createDefaultMapping(indexHint)]).map((mapping) => {
      let id = mapping.id;
      while (seenMappingIds.has(id)) id = createHaId('ha_map');
      seenMappingIds.add(id);
      return id === mapping.id ? mapping : { ...mapping, id };
    });

  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : createHaId('ha_pair'),
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : `HA Pair ${indexHint}`,
    enabled: raw?.enabled !== false,
    haOwner: raw?.haOwner === 'b' ? 'b' : 'a',
    endpoints: {
      a: sanitizeEndpoint(raw?.endpoints?.a, 'a'),
      b: sanitizeEndpoint(raw?.endpoints?.b, 'b'),
    },
    mappings,
  };
};

const sanitizePairs = (items) => {
  const seenPairIds = new Set();
  return (Array.isArray(items) ? items : []).slice(0, MAX_HA_PAIRS).map((item, index) => {
    const pair = sanitizePair(item, index + 1);
    let id = pair.id;
    while (seenPairIds.has(id)) id = createHaId('ha_pair');
    seenPairIds.add(id);
    return id === pair.id ? pair : { ...pair, id };
  });
};

const parsePairsPayload = (content) => {
  try {
    const parsed = JSON.parse(content);
    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
    return sanitizePairs(rawItems);
  } catch (error) {
    console.warn('[HA Compensation] Failed to parse saved pairs payload.', error);
    return [];
  }
};

class HaCompensationEngine {
  constructor() {
    this.pairs = [];
    this.listeners = [];
    this.runtimeByPairId = new Map();
    this.sessionBindings = new Map();
    this.activePairId = null;
    this.focusedPairId = null;
    this.loaded = false;
    this.saveTimer = null;
    this.persistedPairs = [];
    this.persistenceRevision = 0;
    this.lastPersistenceError = null;
    this.persistenceBlocked = false;

    this.loadPairs();
  }

  createDefaultRuntime(pair) {
    return {
      pairId: pair.id,
      pairState: 'offline',
      monitoring: false,
      armed: false,
      activeOwner: pair.haOwner,
      mappings: {},
      eventLog: [],
      lastError: null,
      lastArmAt: 0,
      lastResyncAt: 0,
      endpoints: {
        a: {
          id: 'a',
          label: pair.endpoints.a.label,
          ip: pair.endpoints.a.ip,
          oscPort: pair.endpoints.a.oscPort,
          preferredOscPort: pair.endpoints.a.oscPort,
          activeOscPort: pair.endpoints.a.oscPort,
          lastConsoleReplyPort: null,
          routeConfigured: false,
          sessionConnected: false,
          localSocketBound: false,
          driverMode: 'unsupported',
          subscriptionMode: null,
          online: false,
          consoleFamily: 'unknown',
          consoleModel: null,
          consoleDisplayName: null,
          consoleSupportLevel: 'unknown',
          consoleModelSource: null,
          haRemoteByBank: { a: null, b: null, c: null },
          lastSeenAt: 0,
        },
        b: {
          id: 'b',
          label: pair.endpoints.b.label,
          ip: pair.endpoints.b.ip,
          oscPort: pair.endpoints.b.oscPort,
          preferredOscPort: pair.endpoints.b.oscPort,
          activeOscPort: pair.endpoints.b.oscPort,
          lastConsoleReplyPort: null,
          routeConfigured: false,
          sessionConnected: false,
          localSocketBound: false,
          driverMode: 'unsupported',
          subscriptionMode: null,
          online: false,
          consoleFamily: 'unknown',
          consoleModel: null,
          consoleDisplayName: null,
          consoleSupportLevel: 'unknown',
          consoleModelSource: null,
          haRemoteByBank: { a: null, b: null, c: null },
          lastSeenAt: 0,
        },
      },
    };
  }

  ensureRuntime(pair) {
    if (!this.runtimeByPairId.has(pair.id)) {
      this.runtimeByPairId.set(pair.id, this.createDefaultRuntime(pair));
    }
    const runtime = this.runtimeByPairId.get(pair.id);
    if (!Array.isArray(runtime?.eventLog)) {
      runtime.eventLog = [];
    }
    return runtime;
  }

  appendRuntimeEvent(runtime, level, message, meta = {}) {
    if (!runtime) return;
    const nextEvent = {
      id: createHaId('ha_evt'),
      at: Date.now(),
      level: String(level || 'info').trim() || 'info',
      message: String(message || '').trim(),
      ...meta,
    };
    if (!nextEvent.message) return;
    const existing = Array.isArray(runtime.eventLog) ? runtime.eventLog : [];
    const previous = existing[0];
    if (
      previous
      && previous.message === nextEvent.message
      && previous.level === nextEvent.level
      && Math.abs(Number(previous.at || 0) - nextEvent.at) < 1200
    ) {
      runtime.eventLog = [nextEvent, ...existing.slice(1)].slice(0, 30);
      return;
    }
    runtime.eventLog = [nextEvent, ...existing].slice(0, 30);
  }

  clearEventLog(id) {
    const pair = this.pairs.find((item) => item.id === id);
    if (!pair) return;
    const runtime = this.ensureRuntime(pair);
    runtime.eventLog = [];
    this.notifyListeners();
  }

  resolveEndpointConsoleFamily(pairId, endpointId, runtime = null) {
    const session = this.getEndpointSession(pairId, endpointId);
    const sessionFamily = session?.getRuntimeStatus?.()?.consoleFamily;
    if (isHaCompatibleFamily(sessionFamily)) {
      return String(sessionFamily).trim();
    }
    const runtimeFamily = runtime?.endpoints?.[endpointId]?.consoleFamily;
    return normalizeHaFamily(runtimeFamily);
  }

  getSnapshot() {
    const runtimes = {};
    this.pairs.forEach((pair) => {
      runtimes[pair.id] = this.buildRuntimeView(pair);
    });
    return {
      loaded: this.loaded,
      activePairId: this.activePairId,
      focusedPairId: this.focusedPairId,
      pairs: this.pairs.map((pair) => ({ ...pair })),
      runtimes,
      lastPersistenceError: this.lastPersistenceError,
      persistenceBlocked: this.persistenceBlocked,
    };
  }

  onChange(callback) {
    this.listeners.push(callback);
    try {
      callback(this.getSnapshot());
    } catch (error) {
      console.error('[HA Compensation] Initial change listener failed.', error);
    }
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  notifyListeners() {
    const snapshot = this.getSnapshot();
    [...this.listeners].forEach((cb) => {
      try {
        cb(snapshot);
      } catch (error) {
        console.error('[HA Compensation] Change listener failed.', error);
      }
    });
  }

  setFocusedPair(id) {
    const nextId = this.pairs.some((pair) => pair.id === id && pair.enabled !== false) ? id : null;
    if (this.focusedPairId === nextId) return;
    this.focusedPairId = nextId;
    this.reconcileSessions();
    this.notifyListeners();
  }

  scheduleSave() {
    this.persistenceRevision += 1;
    const scheduledRevision = this.persistenceRevision;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(async () => {
      const saved = await this.savePairs();
      if (!saved && scheduledRevision === this.persistenceRevision) {
        this.lastPersistenceError = {
          at: Date.now(),
          message: 'HA changes could not be verified on disk. The previous verified HA list was restored and disarmed.',
        };
        this.pairs = sanitizePairs(this.persistedPairs);
        this.runtimeByPairId.clear();
        this.activePairId = null;
        this.reconcileSessions();
        this.notifyListeners();
      }
    }, 220);
  }

  async savePairs(options = {}) {
    if (this.persistenceBlocked && options.allowRecovery !== true) {
      console.warn('[HA Compensation] Save blocked because HA storage did not hydrate safely.');
      return false;
    }
    try {
      const pairsToSave = JSON.parse(JSON.stringify(this.pairs));
      const payload = {
        schemaVersion: HA_SCHEMA_VERSION,
        items: pairsToSave,
      };
      await safeWriteJson(HA_PAIRS_FILE, payload);
      this.persistedPairs = pairsToSave;
      this.lastPersistenceError = null;
      this.persistenceBlocked = false;
      return true;
    } catch (error) {
      console.warn('[HA Compensation] Failed to save pairs file.', error);
      return false;
    }
  }

  async replacePairs(items = []) {
    const previousPairs = this.pairs;
    this.pairs.forEach((pair) => this.disarmPair(pair.id));
    this.pairs = sanitizePairs(items);
    this.runtimeByPairId.clear();
    this.activePairId = null;
    this.focusedPairId = null;
    this.reconcileSessions();
    if (!await this.savePairs({ allowRecovery: true })) {
      this.pairs = previousPairs;
      this.runtimeByPairId.clear();
      this.reconcileSessions();
      this.notifyListeners();
      throw new Error('Failed to persist replacement HA setup list.');
    }
    this.notifyListeners();
    return this.pairs.length;
  }

  async loadPairs() {
    try {
      const content = await readJsonTextWithBackup(
        HA_PAIRS_FILE,
        isHaPayloadStructureValid,
      );
      if (content === null) {
        this.loaded = true;
        this.notifyListeners();
        return;
      }

      this.pairs = parsePairsPayload(content);
      this.persistedPairs = JSON.parse(JSON.stringify(this.pairs));
      this.reconcileSessions();
      this.loaded = true;
      this.notifyListeners();
    } catch (error) {
      console.warn('[HA Compensation] Failed to load pairs file.', error);
      this.persistenceBlocked = true;
      this.loaded = true;
      this.notifyListeners();
    }
  }

  createPair(seed = {}) {
    if (this.persistenceBlocked || this.pairs.length >= MAX_HA_PAIRS) return null;
    const pair = sanitizePair(
      {
        name: typeof seed?.name === 'string' && seed.name.trim() ? seed.name.trim() : `HA Pair ${this.pairs.length + 1}`,
        endpoints: {
          a: {
            label: 'PA',
            ip: '',
            oscPort: DEFAULT_OSC_PORT,
            ...(seed?.endpoints?.a || {}),
          },
          b: {
            label: 'MON',
            ip: '',
            oscPort: DEFAULT_OSC_PORT,
            ...(seed?.endpoints?.b || {}),
          },
        },
        haOwner: seed?.haOwner === 'b' ? 'b' : 'a',
        mappings: Array.isArray(seed?.mappings) && seed.mappings.length > 0 ? seed.mappings : [createDefaultMapping(1)],
      },
      this.pairs.length + 1,
    );
    this.pairs = [pair, ...this.pairs];
    this.reconcileSessions();
    this.scheduleSave();
    this.notifyListeners();
    return pair.id;
  }

  updatePair(id, patchOrUpdater) {
    if (this.persistenceBlocked) return false;
    let ownerChanged = false;
    let runtimeConfigChanged = false;
    let disabledWhileActive = false;
    this.pairs = this.pairs.map((pair, index) => {
      if (pair.id !== id) return pair;
      const nextRaw = typeof patchOrUpdater === 'function'
        ? patchOrUpdater(pair)
        : { ...pair, ...patchOrUpdater };
      const nextPair = sanitizePair(nextRaw, index + 1);
      ownerChanged = nextPair.haOwner !== pair.haOwner;
      runtimeConfigChanged = JSON.stringify({
        endpoints: pair.endpoints,
        mappings: pair.mappings,
      }) !== JSON.stringify({
        endpoints: nextPair.endpoints,
        mappings: nextPair.mappings,
      });
      disabledWhileActive = pair.enabled !== false && nextPair.enabled === false && this.activePairId === id;
      return nextPair;
    });

    this.reconcileSessions();
    this.scheduleSave();

    if (disabledWhileActive) {
      this.disarmPair(id);
      return true;
    }

    if (ownerChanged) {
      this.markPairNeedsResync(id, 'HA owner changed. Re-arm required.');
      return true;
    }

    if (runtimeConfigChanged && this.activePairId === id) {
      this.markPairNeedsResync(id, 'HA pair configuration changed. Re-arm required.');
      return true;
    }

    this.notifyListeners();
    return true;
  }

  deletePair(id) {
    if (this.persistenceBlocked) return false;
    if (this.activePairId === id) {
      this.disarmPair(id);
    }
    this.pairs = this.pairs.filter((pair) => pair.id !== id);
    if (this.focusedPairId === id) this.focusedPairId = null;
    this.runtimeByPairId.delete(id);
    ['a', 'b'].forEach((endpointId) => this.destroyEndpointSession(id, endpointId));
    this.scheduleSave();
    this.notifyListeners();
    return true;
  }

  setOwner(id, owner) {
    this.updatePair(id, (pair) => ({
      ...pair,
      haOwner: owner === 'b' ? 'b' : 'a',
    }));
  }

  async armPair(id) {
    const pair = this.pairs.find((item) => item.id === id);
    if (!pair) return false;

    if (this.focusedPairId !== id) {
      this.focusedPairId = id;
      this.reconcileSessions();
    }

    if (this.activePairId && this.activePairId !== id) {
      this.disarmPair(this.activePairId);
    }

    const runtime = this.ensureRuntime(pair);
    const diagnostics = this.buildPairDiagnostics(pair, runtime);
    if (diagnostics.errors.length > 0) {
      runtime.armed = false;
      runtime.pairState = 'needs_config';
      runtime.lastError = diagnostics.errors[0];
      this.appendRuntimeEvent(runtime, 'error', `Arm blocked: ${diagnostics.errors[0]}`);
      this.notifyListeners();
      return false;
    }

    const ownerId = pair.haOwner;
    const followerId = getFollowerEndpointId(ownerId);
    const ownerSession = this.getEndpointSession(pair.id, ownerId);
    const followerSession = this.getEndpointSession(pair.id, followerId);
    const ownerFamily = this.resolveEndpointConsoleFamily(pair.id, ownerId, runtime);
    const followerFamily = this.resolveEndpointConsoleFamily(pair.id, followerId, runtime);
    const ownerRuntime = runtime?.endpoints?.[ownerId] || null;
    const followerRuntime = runtime?.endpoints?.[followerId] || null;
    if (!ownerSession || !followerSession) {
      runtime.armed = false;
      runtime.pairState = 'needs_resync';
      runtime.lastError = 'Missing endpoint session.';
      this.appendRuntimeEvent(runtime, 'error', 'Arm failed: missing endpoint session.');
      this.notifyListeners();
      return false;
    }
    if (!ownerRuntime?.online || !followerRuntime?.online) {
      const ownerLabel = pair?.endpoints?.[ownerId]?.label || ownerId.toUpperCase();
      const followerLabel = pair?.endpoints?.[followerId]?.label || followerId.toUpperCase();
      runtime.armed = false;
      runtime.pairState = 'offline';
      runtime.lastError = !ownerRuntime?.online && !followerRuntime?.online
        ? `${ownerLabel} and ${followerLabel} must both be online before arming.`
        : !ownerRuntime?.online
          ? `${ownerLabel} must be online before arming.`
          : `${followerLabel} must be online before arming.`;
      this.appendRuntimeEvent(runtime, 'warn', `Arm blocked: ${runtime.lastError}`);
      this.notifyListeners();
      return false;
    }

    const ownerSourceAddresses = pair.mappings
      .filter((mapping) => mapping.enabled !== false)
      .map((mapping) => getHaGainAddress(mapping.source, ownerFamily))
      .filter(Boolean);
    const followerTrimAddresses = pair.mappings
      .filter((mapping) => mapping.enabled !== false)
      .flatMap((mapping) => (
        mapping.targetsByEndpoint[followerId] || []
      ).map((target) => getTrimAddress(target, followerFamily)).filter(Boolean));

    await this.primeAddresses(ownerSession, ownerSourceAddresses);
    await this.primeAddresses(followerSession, followerTrimAddresses);
    this.refreshEndpointRuntime(pair.id, ownerId);
    this.refreshEndpointRuntime(pair.id, followerId);

    const nextMappingRuntime = {};
    for (const mapping of pair.mappings) {
      if (mapping.enabled === false) continue;
      const sourceAddress = getHaGainAddress(mapping.source, ownerFamily);
      const sourceValue = extractNumericState(ownerSession.getFreshState(sourceAddress, 5000));
      if (!Number.isFinite(sourceValue)) {
        runtime.armed = false;
        runtime.pairState = 'needs_resync';
        runtime.lastError = `Missing owner gain state for ${mapping.name}.`;
        this.appendRuntimeEvent(runtime, 'error', runtime.lastError);
        this.notifyListeners();
        return false;
      }

      const followerTargets = mapping.targetsByEndpoint[followerId] || [];
      const followerTrimBaselineByTarget = {};
      followerTargets.forEach((target) => {
        const targetKey = getTargetKey(target);
        const trimSpec = getTrimSpec(target, followerFamily);
        const trimValue = extractNumericState(followerSession.getFreshState(trimSpec?.address, 5000));
        if (Number.isFinite(trimValue)) {
          followerTrimBaselineByTarget[targetKey] = HaMath.roundToStep(trimValue, trimSpec?.step);
        }
      });

      if (Object.keys(followerTrimBaselineByTarget).length !== followerTargets.length) {
        runtime.armed = false;
        runtime.pairState = 'needs_resync';
        runtime.lastError = `Missing follower trim state for ${mapping.name}.`;
        this.appendRuntimeEvent(runtime, 'error', runtime.lastError);
        this.notifyListeners();
        return false;
      }

      nextMappingRuntime[mapping.id] = {
        state: 'tracking',
        ownerGainBaseline: HaMath.roundToStep(sourceValue),
        currentOwnerGain: HaMath.roundToStep(sourceValue),
        followerTrimBaselineByTarget,
        lastCommandedTrimByTarget: {},
        saturationByTarget: {},
      };
    }

    runtime.mappings = nextMappingRuntime;
    runtime.armed = true;
    runtime.activeOwner = ownerId;
    runtime.pairState = 'tracking';
    runtime.lastError = null;
    runtime.lastArmAt = Date.now();
    runtime.lastResyncAt = runtime.lastArmAt;
    this.activePairId = id;
    this.appendRuntimeEvent(
      runtime,
      'success',
      `Tracking armed. Owner ${pair.endpoints[ownerId].label} -> follower ${pair.endpoints[followerId].label}.`,
      { ownerId, followerId },
    );
    this.recalculatePairState(pair, runtime);
    this.notifyListeners();
    return true;
  }

  disarmPair(id) {
    const pair = this.pairs.find((item) => item.id === id);
    if (!pair) return;
    const runtime = this.ensureRuntime(pair);
    runtime.armed = false;
    runtime.mappings = {};
    runtime.activeOwner = pair.haOwner;
    runtime.pairState = 'disarmed';
    runtime.lastError = null;
    this.appendRuntimeEvent(runtime, 'info', 'Tracking disarmed.');
    if (this.activePairId === id) {
      this.activePairId = null;
    }
    this.recalculatePairState(pair, runtime);
    this.reconcileSessions();
    this.notifyListeners();
  }

  async resyncPair(id) {
    const pair = this.pairs.find((item) => item.id === id);
    if (pair) {
      const runtime = this.ensureRuntime(pair);
      this.appendRuntimeEvent(runtime, 'info', 'Resync requested.');
    }
    this.disarmPair(id);
    return this.armPair(id);
  }

  async captureCurrentBaseline(id) {
    const pair = this.pairs.find((item) => item.id === id);
    if (!pair) return false;
    const runtime = this.ensureRuntime(pair);
    if (!runtime.armed || this.activePairId !== id) {
      runtime.lastError = 'Capture baseline requires an armed HA setup.';
      this.appendRuntimeEvent(runtime, 'warn', runtime.lastError);
      this.notifyListeners();
      return false;
    }

    const ownerId = runtime.activeOwner || pair.haOwner;
    const followerId = getFollowerEndpointId(ownerId);
    const ownerSession = this.getEndpointSession(pair.id, ownerId);
    const followerSession = this.getEndpointSession(pair.id, followerId);
    const ownerFamily = this.resolveEndpointConsoleFamily(pair.id, ownerId, runtime);
    const followerFamily = this.resolveEndpointConsoleFamily(pair.id, followerId, runtime);
    if (!ownerSession || !followerSession) {
      runtime.lastError = 'Capture baseline failed: missing endpoint session.';
      this.appendRuntimeEvent(runtime, 'error', runtime.lastError);
      this.notifyListeners();
      return false;
    }

    const ownerSourceAddresses = pair.mappings
      .filter((mapping) => mapping.enabled !== false)
      .map((mapping) => getHaGainAddress(mapping.source, ownerFamily))
      .filter(Boolean);
    const followerTrimAddresses = pair.mappings
      .filter((mapping) => mapping.enabled !== false)
      .flatMap((mapping) => (
        mapping.targetsByEndpoint[followerId] || []
      ).map((target) => getTrimAddress(target, followerFamily)).filter(Boolean));

    await this.primeAddresses(ownerSession, ownerSourceAddresses);
    await this.primeAddresses(followerSession, followerTrimAddresses);

    for (const mapping of pair.mappings) {
      if (mapping.enabled === false) continue;
      const mappingRuntime = runtime.mappings[mapping.id];
      if (!mappingRuntime) continue;
      const sourceAddress = getHaGainAddress(mapping.source, ownerFamily);
      const sourceValue = extractNumericState(ownerSession.getFreshState(sourceAddress, 5000));
      if (!Number.isFinite(sourceValue)) {
        runtime.lastError = `Capture baseline failed: missing owner gain state for ${mapping.name}.`;
        this.appendRuntimeEvent(runtime, 'error', runtime.lastError);
        this.notifyListeners();
        return false;
      }
      mappingRuntime.ownerGainBaseline = HaMath.roundToStep(sourceValue);
      mappingRuntime.currentOwnerGain = HaMath.roundToStep(sourceValue);
      mappingRuntime.lastCommandedTrimByTarget = {};
      mappingRuntime.saturationByTarget = {};

      const nextBaselineByTarget = {};
      for (const target of mapping.targetsByEndpoint[followerId] || []) {
        const targetKey = getTargetKey(target);
        const trimSpec = getTrimSpec(target, followerFamily);
        const trimValue = extractNumericState(followerSession.getFreshState(trimSpec?.address, 5000));
        if (!Number.isFinite(trimValue)) {
          runtime.lastError = `Capture baseline failed: missing follower trim state for ${mapping.name} / ${describeTarget(target)}.`;
          this.appendRuntimeEvent(runtime, 'error', runtime.lastError);
          this.notifyListeners();
          return false;
        }
        nextBaselineByTarget[targetKey] = HaMath.roundToStep(trimValue, trimSpec?.step);
      }
      mappingRuntime.followerTrimBaselineByTarget = nextBaselineByTarget;
    }

    runtime.lastError = null;
    runtime.lastResyncAt = Date.now();
    this.recalculatePairState(pair, runtime);
    this.appendRuntimeEvent(runtime, 'success', 'Current gain and trims captured as new baseline.');
    this.notifyListeners();
    return true;
  }

  getRuntime(id) {
    const pair = this.pairs.find((item) => item.id === id);
    return pair ? this.buildRuntimeView(pair) : null;
  }

  reconcileSessions() {
    const validKeys = new Set();

    this.pairs.forEach((pair) => {
      const runtime = this.ensureRuntime(pair);
      const shouldMonitor = pair.enabled !== false
        && (pair.id === this.focusedPairId || pair.id === this.activePairId);
      runtime.monitoring = shouldMonitor;
      if (!shouldMonitor) {
        ['a', 'b'].forEach((endpointId) => {
          this.destroyEndpointSession(pair.id, endpointId);
          this.refreshEndpointRuntime(pair.id, endpointId);
        });
        if (!runtime.armed && runtime.pairState !== 'needs_resync' && runtime.pairState !== 'needs_config') {
          runtime.pairState = pair.enabled === false ? 'disarmed' : 'idle';
        }
        return;
      }
      ['a', 'b'].forEach((endpointId) => {
        const endpoint = pair.endpoints[endpointId];
        const sessionKey = getEndpointSessionKey(pair.id, endpointId);
        validKeys.add(sessionKey);

        if (!endpoint.ip || !isValidIpv4(endpoint.ip)) {
          this.destroyEndpointSession(pair.id, endpointId);
          this.refreshEndpointRuntime(pair.id, endpointId);
          return;
        }

        let binding = this.sessionBindings.get(sessionKey);
        if (!binding) {
          const session = OscManager.createSession({
            sessionId: `ha_${sessionKey}`,
            ip: endpoint.ip,
            port: endpoint.oscPort,
            enableNativeMeters: false,
            autoConnect: false,
          });
          const offState = session.on('wing_state', (evt) => this.handleSessionState(pair.id, endpointId, evt));
          const offOnline = session.on('wing_online_status', (online) => this.handleSessionOnline(pair.id, endpointId, online));
          const offIdentity = session.on('console_identity', () => this.handleSessionIdentity(pair.id, endpointId));
          binding = {
            session,
            offState,
            offOnline,
            offIdentity,
            endpointHash: '',
          };
          this.sessionBindings.set(sessionKey, binding);
        }

        const endpointHash = `${endpoint.ip}:${endpoint.oscPort}`;
        if (binding.endpointHash !== endpointHash) {
          binding.endpointHash = endpointHash;
          binding.session.connect(endpoint.ip, endpoint.oscPort);
        }

        const watchedAddresses = this.getWatchedAddressesForEndpoint(pair, endpointId);
        binding.session.setWatchedAddresses(watchedAddresses, `${SESSION_SCOPE_PREFIX}_${pair.id}`);
        this.primeAddresses(binding.session, watchedAddresses.filter((address) => !String(address).startsWith('/meters/')));
        this.refreshEndpointRuntime(pair.id, endpointId);
      });
    });

    Array.from(this.sessionBindings.keys()).forEach((sessionKey) => {
      if (validKeys.has(sessionKey)) return;
      const [pairId, endpointId] = sessionKey.split(':');
      this.destroyEndpointSession(pairId, endpointId);
      this.refreshEndpointRuntime(pairId, endpointId);
    });
  }

  destroyEndpointSession(pairId, endpointId) {
    const sessionKey = getEndpointSessionKey(pairId, endpointId);
    const binding = this.sessionBindings.get(sessionKey);
    if (!binding) return;
    if (typeof binding.offState === 'function') binding.offState();
    if (typeof binding.offOnline === 'function') binding.offOnline();
    if (typeof binding.offIdentity === 'function') binding.offIdentity();
    OscManager.destroySession(binding.session);
    this.sessionBindings.delete(sessionKey);
  }

  getEndpointSession(pairId, endpointId) {
    return this.sessionBindings.get(getEndpointSessionKey(pairId, endpointId))?.session || null;
  }

  getWatchedAddressesForEndpoint(pair, endpointId) {
    const watched = new Set();
    const endpointFamily = this.resolveEndpointConsoleFamily(pair.id, endpointId, this.ensureRuntime(pair));
    pair.mappings.filter((mapping) => mapping.enabled !== false).forEach((mapping) => {
      const gainAddress = getHaGainAddress(mapping.source, endpointFamily === 'unknown' ? 'wing' : endpointFamily);
      if (gainAddress) watched.add(gainAddress);
      const warningAddress = getHaRemoteWarningAddress(mapping.source, endpointFamily);
      if (warningAddress) watched.add(warningAddress);
      const targets = mapping.targetsByEndpoint[endpointId] || [];
      targets.forEach((target) => {
        const trimAddress = getTrimAddress(target, endpointFamily === 'unknown' ? 'wing' : endpointFamily);
        if (trimAddress) watched.add(trimAddress);
      });
    });
    return Array.from(watched);
  }

  async primeAddresses(session, addresses) {
    const uniqueAddresses = Array.from(new Set((addresses || []).filter(Boolean)));
    if (!session || uniqueAddresses.length === 0) return;

    uniqueAddresses.forEach((address) => {
      session.sendToWing(address);
    });

    await new Promise((resolve) => {
      const startedAt = Date.now();
      let unsubscribe = null;
      const checkReady = () => uniqueAddresses.every(
        (address) => session.getFreshState(address, 5000) !== undefined,
      );
      if (checkReady()) {
        resolve();
        return;
      }

      const finish = () => {
        if (unsubscribe) unsubscribe();
        resolve();
      };

      unsubscribe = session.on('wing_state', () => {
        if (checkReady()) {
          finish();
        } else if (Date.now() - startedAt > 850) {
          finish();
        }
      });

      setTimeout(finish, 850);
    });
  }

  refreshEndpointRuntime(pairId, endpointId) {
    const pair = this.pairs.find((item) => item.id === pairId);
    if (!pair) return;
    const runtime = this.ensureRuntime(pair);
    const endpointRuntime = runtime.endpoints[endpointId];
    const endpoint = pair.endpoints[endpointId];
    endpointRuntime.label = endpoint.label;
    endpointRuntime.ip = endpoint.ip;
    endpointRuntime.oscPort = endpoint.oscPort;
    endpointRuntime.preferredOscPort = endpoint.oscPort;

    const session = this.getEndpointSession(pairId, endpointId);
    if (!session) {
      endpointRuntime.online = false;
      endpointRuntime.activeOscPort = endpoint.oscPort;
      endpointRuntime.lastConsoleReplyPort = null;
      endpointRuntime.routeConfigured = Boolean(String(endpoint?.ip || '').trim());
      endpointRuntime.sessionConnected = false;
      endpointRuntime.localSocketBound = false;
      endpointRuntime.driverMode = 'unsupported';
      endpointRuntime.subscriptionMode = null;
      endpointRuntime.consoleFamily = 'unknown';
      endpointRuntime.consoleModel = null;
      endpointRuntime.consoleDisplayName = null;
      endpointRuntime.consoleSupportLevel = 'unknown';
      endpointRuntime.consoleModelSource = null;
      endpointRuntime.haRemoteByBank = { a: null, b: null, c: null };
      return;
    }

    const status = session.getRuntimeStatus();
    endpointRuntime.routeConfigured = Boolean(
      status?.routeConfigured || String(endpoint?.ip || '').trim(),
    );
    endpointRuntime.sessionConnected = Boolean(status?.connected);
    endpointRuntime.localSocketBound = Boolean(
      status?.localSocketBound || Number(status?.nativeListenPort || 0) > 0,
    );
    endpointRuntime.driverMode = status?.driverMode || 'unsupported';
    endpointRuntime.subscriptionMode = status?.subscriptionMode || null;
    endpointRuntime.online = Boolean(status?.wingOnline);
    endpointRuntime.activeOscPort = Number(status?.wingPort || endpoint.oscPort || DEFAULT_OSC_PORT);
    endpointRuntime.lastConsoleReplyPort = Number.isInteger(Number(status?.lastConsoleReplyPort))
      ? Number(status.lastConsoleReplyPort)
      : null;
    endpointRuntime.consoleFamily = status?.consoleFamily || 'unknown';
    endpointRuntime.consoleModel = status?.consoleModel || null;
    endpointRuntime.consoleDisplayName = status?.consoleDisplayName || status?.consoleModel || null;
    endpointRuntime.consoleSupportLevel = status?.consoleSupportLevel || 'unknown';
    endpointRuntime.consoleModelSource = status?.consoleModelSource || null;
    if (endpointRuntime.online) {
      endpointRuntime.lastSeenAt = Date.now();
    }
    endpointRuntime.haRemoteByBank = {
      a: extractNumericState(session.getState('/$globals/harmt/a')),
      b: extractNumericState(session.getState('/$globals/harmt/b')),
      c: extractNumericState(session.getState('/$globals/harmt/c')),
    };
  }

  handleSessionOnline(pairId, endpointId, online) {
    const pair = this.pairs.find((item) => item.id === pairId);
    if (!pair) return;
    this.refreshEndpointRuntime(pairId, endpointId);
    const runtime = this.ensureRuntime(pair);
    if (runtime.armed && !online) {
      const role = runtime.activeOwner === endpointId ? 'owner' : 'follower';
      this.markPairNeedsResync(pairId, `${role.toUpperCase()} console went offline.`);
      return;
    }
    this.recalculatePairState(pair, runtime);
    this.notifyListeners();
  }

  handleSessionIdentity(pairId, endpointId) {
    const pair = this.pairs.find((item) => item.id === pairId);
    if (!pair) return;

    const binding = this.sessionBindings.get(getEndpointSessionKey(pairId, endpointId));
    if (binding?.session) {
      const watchedAddresses = this.getWatchedAddressesForEndpoint(pair, endpointId);
      binding.session.setWatchedAddresses(watchedAddresses, `${SESSION_SCOPE_PREFIX}_${pair.id}`);
      this.primeAddresses(binding.session, watchedAddresses.filter((address) => !String(address).startsWith('/meters/')));
    }

    this.refreshEndpointRuntime(pairId, endpointId);
    const runtime = this.ensureRuntime(pair);

    if (runtime.armed) {
      const diagnostics = this.buildPairDiagnostics(pair, runtime);
      if (diagnostics.errors.length > 0) {
        this.markPairNeedsResync(pairId, diagnostics.errors[0]);
        return;
      }
    }

    this.recalculatePairState(pair, runtime);
    this.notifyListeners();
  }

  handleSessionState(pairId, endpointId, evt) {
    const pair = this.pairs.find((item) => item.id === pairId);
    if (!pair) return;
    const watchedAddresses = this.getWatchedAddressesForEndpoint(pair, endpointId);
    if (!watchedAddresses.includes(evt?.address)) return;
    this.refreshEndpointRuntime(pairId, endpointId);

    const runtime = this.ensureRuntime(pair);
    if (!runtime.armed || this.activePairId !== pairId) {
      this.recalculatePairState(pair, runtime);
      this.notifyListeners();
      return;
    }

    const ownerId = runtime.activeOwner || pair.haOwner;
    const followerId = getFollowerEndpointId(ownerId);
    const ownerFamily = this.resolveEndpointConsoleFamily(pair.id, ownerId, runtime);
    const followerFamily = this.resolveEndpointConsoleFamily(pair.id, followerId, runtime);
    let changed = false;

    pair.mappings.forEach((mapping) => {
      const mappingRuntime = runtime.mappings[mapping.id];
      if (!mappingRuntime) return;

      const sourceAddress = getHaGainAddress(mapping.source, ownerFamily);
      if (endpointId === ownerId && evt?.address === sourceAddress) {
        const ownerGain = extractNumericState(evt?.args);
        if (Number.isFinite(ownerGain)) {
          mappingRuntime.currentOwnerGain = HaMath.roundToStep(ownerGain);
          this.applyCompensationForMapping(pair, runtime, mapping, ownerId, followerId, ownerFamily, followerFamily);
          changed = true;
        }
      }

      if (endpointId === followerId) {
        (mapping.targetsByEndpoint[followerId] || []).forEach((target) => {
          const trimSpec = getTrimSpec(target, followerFamily);
          const trimAddress = trimSpec?.address;
          if (evt?.address !== trimAddress) return;
          const targetKey = getTargetKey(target);
          const currentTrim = extractNumericState(evt?.args);
          if (!Number.isFinite(currentTrim)) return;

          const lastCommand = mappingRuntime.lastCommandedTrimByTarget[targetKey];
          if (lastCommand && HaMath.isLikelyCommandEcho({
            currentValue: currentTrim,
            commandValue: lastCommand.value,
            commandAt: lastCommand.at,
            tolerance: trimSpec?.tolerance,
          })) {
            return;
          }

          const delta = HaMath.computeGainDelta(
            mappingRuntime.ownerGainBaseline,
            mappingRuntime.currentOwnerGain,
          );
          const newBaseline = HaMath.adoptManualTrimBaseline(currentTrim, delta, trimSpec?.step);
          if (Number.isFinite(newBaseline)) {
            mappingRuntime.followerTrimBaselineByTarget[targetKey] = newBaseline;
            delete mappingRuntime.saturationByTarget[targetKey];
            this.appendRuntimeEvent(
              runtime,
              'info',
              `${mapping.name}: manual follower trim adopted on ${describeTarget(target)}.`,
              { mappingId: mapping.id, targetKey },
            );
            this.applyCompensationForMapping(pair, runtime, mapping, ownerId, followerId, ownerFamily, followerFamily);
            changed = true;
          }
        });
      }
    });

    if (changed) {
      this.recalculatePairState(pair, runtime);
    }
    this.notifyListeners();
  }

  applyCompensationForMapping(pair, runtime, mapping, ownerId, followerId, ownerFamily = null, followerFamily = null) {
    const mappingRuntime = runtime.mappings[mapping.id];
    const followerSession = this.getEndpointSession(pair.id, followerId);
    if (!mappingRuntime || !followerSession) return;
    const resolvedFollowerFamily = followerFamily || this.resolveEndpointConsoleFamily(pair.id, followerId, runtime);
    const previousSaturation = { ...(mappingRuntime.saturationByTarget || {}) };

    const nextSaturation = {};
    for (const target of mapping.targetsByEndpoint[followerId] || []) {
      const targetKey = getTargetKey(target);
      const baseline = mappingRuntime.followerTrimBaselineByTarget[targetKey];
      const trimSpec = getTrimSpec(target, resolvedFollowerFamily);
      if (!trimSpec?.address) continue;
      const result = HaMath.computeCompensation({
        ownerGainBaseline: mappingRuntime.ownerGainBaseline,
        currentOwnerGain: mappingRuntime.currentOwnerGain,
        followerTrimBaseline: baseline,
        trimMin: trimSpec.min,
        trimMax: trimSpec.max,
        trimStep: trimSpec.step,
        tolerance: trimSpec.tolerance,
      });
      if (!result) continue;

      if (result.saturated) {
        nextSaturation[targetKey] = {
          overshoot: result.overshoot,
          desiredTrim: result.desiredTrim,
          tolerance: trimSpec.tolerance,
        };
        if (!previousSaturation[targetKey]) {
          const precision = getPrecisionForStep(trimSpec.step);
          this.appendRuntimeEvent(
            runtime,
            'warn',
            `${mapping.name}: ${describeTarget(target)} saturated by +${Number(result.overshoot || 0).toFixed(precision)} dB.`,
            { mappingId: mapping.id, targetKey },
          );
        }
      }

      const trimAddress = trimSpec.address;
      const currentTrim = extractNumericState(followerSession.getFreshState(trimAddress, 5000));
      if (Number.isFinite(currentTrim) && Math.abs(currentTrim - result.desiredTrim) <= trimSpec.tolerance) {
        continue;
      }

      const sent = followerSession.sendToWing(trimAddress, [result.desiredTrim]);
      if (sent !== true) {
        this.markPairNeedsResync(
          pair.id,
          `${mapping.name}: follower write rejected for ${describeTarget(target)}.`,
        );
        return;
      }
      mappingRuntime.lastCommandedTrimByTarget[targetKey] = {
        value: result.desiredTrim,
        at: Date.now(),
      };
    }

    mappingRuntime.saturationByTarget = nextSaturation;
    Object.keys(previousSaturation).forEach((targetKey) => {
      if (!nextSaturation[targetKey]) {
        this.appendRuntimeEvent(
          runtime,
          'success',
          `${mapping.name}: ${targetKey.toUpperCase()} returned inside trim range.`,
          { mappingId: mapping.id, targetKey },
        );
      }
    });
  }

  markPairNeedsResync(pairId, reason) {
    const pair = this.pairs.find((item) => item.id === pairId);
    if (!pair) return;
    const runtime = this.ensureRuntime(pair);
    runtime.armed = false;
    runtime.mappings = {};
    runtime.activeOwner = pair.haOwner;
    runtime.pairState = 'needs_resync';
    runtime.lastError = reason || 'Resync required.';
    this.appendRuntimeEvent(runtime, 'warn', runtime.lastError);
    if (this.activePairId === pairId) {
      this.activePairId = null;
    }
    this.reconcileSessions();
    this.notifyListeners();
  }

  recalculatePairState(pair, runtime) {
    const endpointsOnline = runtime.endpoints.a.online && runtime.endpoints.b.online;
    if (runtime.pairState === 'needs_resync' || runtime.pairState === 'needs_config') {
      return;
    }
    if (runtime.armed) {
      const summary = Object.values(runtime.mappings)
        .map((mappingRuntime) => HaMath.summarizeSaturation(mappingRuntime?.saturationByTarget))
        .filter((item) => item?.saturated);
      runtime.pairState = summary.length > 0 ? 'saturated' : 'tracking';
      return;
    }
    runtime.pairState = endpointsOnline ? 'disarmed' : 'offline';
  }

  buildPairDiagnostics(pair, runtime) {
    const errors = [];
    const warnings = [];
    const endpointAIp = String(pair?.endpoints?.a?.ip || '').trim();
    const endpointBIp = String(pair?.endpoints?.b?.ip || '').trim();
    const ownerId = pair.haOwner;
    const followerId = getFollowerEndpointId(ownerId);
    const ownerFamily = this.resolveEndpointConsoleFamily(pair.id, ownerId, runtime);
    const followerFamily = this.resolveEndpointConsoleFamily(pair.id, followerId, runtime);
    if (!pair.name.trim()) {
      errors.push('Pair name is required.');
    }
    if (!endpointAIp) {
      errors.push('Console A IP address is required.');
    } else if (!isValidIpv4(endpointAIp)) {
      errors.push('Console A IP address is invalid.');
    }
    if (!endpointBIp) {
      errors.push('Console B IP address is required.');
    } else if (!isValidIpv4(endpointBIp)) {
      errors.push('Console B IP address is invalid.');
    }
    if (endpointAIp && endpointBIp && endpointAIp === endpointBIp) {
      errors.push('Console A and B cannot share the same IP.');
    }
    if (!Array.isArray(pair.mappings) || pair.mappings.length === 0) {
      errors.push('At least one HA mapping is required.');
    }

    const endpointARuntime = runtime?.endpoints?.a;
    const endpointBRuntime = runtime?.endpoints?.b;
    if (endpointARuntime?.online && endpointARuntime?.consoleFamily && !isHaCompatibleFamily(endpointARuntime.consoleFamily)) {
      errors.push(`Console A is detected as ${endpointARuntime.consoleDisplayName || endpointARuntime.consoleFamily}. This family is not supported for HA compensation.`);
    }
    if (endpointBRuntime?.online && endpointBRuntime?.consoleFamily && !isHaCompatibleFamily(endpointBRuntime.consoleFamily)) {
      errors.push(`Console B is detected as ${endpointBRuntime.consoleDisplayName || endpointBRuntime.consoleFamily}. This family is not supported for HA compensation.`);
    }
    if (
      endpointARuntime?.sessionConnected
      && !endpointARuntime?.online
      && endpointAIp
      && isValidIpv4(endpointAIp)
    ) {
      warnings.push('Console A route is armed but still waiting for OSC replies.');
    }
    if (
      endpointBRuntime?.sessionConnected
      && !endpointBRuntime?.online
      && endpointBIp
      && isValidIpv4(endpointBIp)
    ) {
      warnings.push('Console B route is armed but still waiting for OSC replies.');
    }

    const collisions = buildFollowerTargetCollisions(pair, followerId);
    pair.mappings.forEach((mapping, index) => {
      const ownerSourceMax = getHaSourceMax(mapping.source.family, ownerFamily);
      if (ownerFamily !== 'unknown' && ownerSourceMax <= 0) {
        errors.push(`Mapping #${index + 1}: ${mapping.source.family.toUpperCase()} is not valid on the current owner console family.`);
      } else if (ownerFamily !== 'unknown' && mapping.source.index > ownerSourceMax) {
        errors.push(`Mapping #${index + 1}: source index ${mapping.source.index} exceeds the ${ownerSourceMax}-input limit on the current owner console.`);
      }

      const sourceAddress = getHaGainAddress(mapping.source, ownerFamily === 'unknown' ? 'wing' : ownerFamily);
      if (!sourceAddress && ownerFamily !== 'unknown') {
        errors.push(`Mapping #${index + 1}: source gain path is invalid for the current owner console.`);
      }
      const followerTargets = mapping.targetsByEndpoint[followerId] || [];
      let needsX32ChannelTrimWarning = false;
      if (mapping.enabled !== false && followerTargets.length === 0) {
        errors.push(`Mapping #${index + 1}: current follower side has no target trims.`);
      }
      if (mapping.source.family === 'local') {
        warnings.push(`Mapping #${index + 1}: LOCAL source is advanced and not guaranteed to represent a shared stagebox.`);
      }
      followerTargets.forEach((target) => {
        const targetMax = getHaTargetMax(target.family, followerFamily);
        if (followerFamily !== 'unknown' && target.index > targetMax) {
          errors.push(`Mapping #${index + 1}: follower ${describeTarget(target)} exceeds the ${targetMax}-target limit on the current follower console.`);
        }
        const trimSpec = getTrimSpec(target, followerFamily === 'unknown' ? 'wing' : followerFamily);
        if (!trimSpec && followerFamily !== 'unknown') {
          errors.push(`Mapping #${index + 1}: follower ${describeTarget(target)} has no valid trim path on the current follower console.`);
        }
        if (followerFamily === 'x32-family' && target.family === 'ch') {
          needsX32ChannelTrimWarning = true;
        }
      });
      if (needsX32ChannelTrimWarning) {
        warnings.push(`Mapping #${index + 1}: X32/M32 CH trim is documented for digital sources only. Verify follower channel source routing.`);
      }

      const bankKey = ownerFamily === 'wing'
        ? mapping.source.family === 'aes50a'
          ? 'a'
          : mapping.source.family === 'aes50b'
            ? 'b'
            : mapping.source.family === 'aes50c'
              ? 'c'
              : null
        : null;
      if (bankKey && ownerFamily === 'wing') {
        const ownerRuntime = runtime?.endpoints?.[pair.haOwner];
        if (ownerRuntime?.online) {
          const enabled = Number(ownerRuntime?.haRemoteByBank?.[bankKey]);
          if (enabled !== 1) {
            warnings.push(`Mapping #${index + 1}: HA Remote for AES-${bankKey.toUpperCase()} is not confirmed on the current owner console.`);
          }
        } else if (endpointAIp && endpointBIp) {
          warnings.push(`Mapping #${index + 1}: HA Remote for AES-${bankKey.toUpperCase()} is not confirmed on the current owner console.`);
        }
      }
    });

    collisions.forEach((collision) => {
      const followerLabel = pair?.endpoints?.[followerId]?.label || followerId.toUpperCase();
      errors.push(
        `Follower trim collision on ${followerLabel}: ${describeTarget(collision.target)} is targeted by ${collision.mappingNames.join(', ')}.`,
      );
    });

    return { errors, warnings, collisions };
  }

  buildMappingRuntimeViews(pair, runtime, diagnostics) {
    const ownerId = runtime.armed ? (runtime.activeOwner || pair.haOwner) : pair.haOwner;
    const followerId = getFollowerEndpointId(ownerId);
    const ownerFamily = this.resolveEndpointConsoleFamily(pair.id, ownerId, runtime);
    const followerFamily = this.resolveEndpointConsoleFamily(pair.id, followerId, runtime);
    const ownerSession = this.getEndpointSession(pair.id, ownerId);
    const followerSession = this.getEndpointSession(pair.id, followerId);
    const collisionKeySet = new Set((diagnostics?.collisions || []).map((item) => item.targetKey));

    return (pair.mappings || []).map((mapping) => {
      const mappingRuntime = runtime.mappings[mapping.id] || null;
      const sourceAddress = getHaGainAddress(mapping.source, ownerFamily);
      const liveOwnerGain = sourceAddress && ownerSession ? extractNumericState(ownerSession.getState(sourceAddress)) : null;
      const currentOwnerGain = Number.isFinite(Number(mappingRuntime?.currentOwnerGain))
        ? Number(mappingRuntime.currentOwnerGain)
        : (Number.isFinite(liveOwnerGain) ? HaMath.roundToStep(liveOwnerGain) : null);
      const ownerGainBaseline = Number.isFinite(Number(mappingRuntime?.ownerGainBaseline))
        ? Number(mappingRuntime.ownerGainBaseline)
        : null;
      const delta = Number.isFinite(ownerGainBaseline) && Number.isFinite(currentOwnerGain)
        ? HaMath.computeGainDelta(ownerGainBaseline, currentOwnerGain)
        : null;

      const targetRows = (mapping.targetsByEndpoint[followerId] || []).map((target) => {
        const targetKey = getTargetKey(target);
        const trimSpec = getTrimSpec(target, followerFamily);
        const trimAddress = trimSpec?.address || null;
        const liveTrim = trimAddress && followerSession ? extractNumericState(followerSession.getState(trimAddress)) : null;
        const currentTrim = Number.isFinite(liveTrim) ? HaMath.roundToStep(liveTrim, trimSpec?.step) : null;
        const baselineTrim = Number.isFinite(Number(mappingRuntime?.followerTrimBaselineByTarget?.[targetKey]))
          ? Number(mappingRuntime.followerTrimBaselineByTarget[targetKey])
          : null;
        const compensation = Number.isFinite(ownerGainBaseline)
          && Number.isFinite(currentOwnerGain)
          && Number.isFinite(baselineTrim)
          && trimSpec
          ? HaMath.computeCompensation({
            ownerGainBaseline,
            currentOwnerGain,
            followerTrimBaseline: baselineTrim,
            trimMin: trimSpec.min,
            trimMax: trimSpec.max,
            trimStep: trimSpec.step,
            tolerance: trimSpec.tolerance,
          })
          : null;
        const desiredTrim = Number.isFinite(Number(compensation?.desiredTrim))
          ? Number(compensation?.desiredTrim)
          : null;
        const overshoot = Number(
          mappingRuntime?.saturationByTarget?.[targetKey]?.overshoot
          ?? compensation?.overshoot
          ?? 0,
        );
        const trimPrecision = Math.max(1, String(trimSpec?.step ?? 0.1).split('.')[1]?.replace(/0+$/, '').length || 0);
        const headroomUp = Number.isFinite(desiredTrim) && trimSpec
          ? Number((desiredTrim - trimSpec.min).toFixed(trimPrecision))
          : (Number.isFinite(currentTrim) && trimSpec ? Number((currentTrim - trimSpec.min).toFixed(trimPrecision)) : null);
        const headroomDown = Number.isFinite(desiredTrim) && trimSpec
          ? Number((trimSpec.max - desiredTrim).toFixed(trimPrecision))
          : (Number.isFinite(currentTrim) && trimSpec ? Number((trimSpec.max - currentTrim).toFixed(trimPrecision)) : null);
        const lastCommand = mappingRuntime?.lastCommandedTrimByTarget?.[targetKey] || null;

        return {
          targetKey,
          targetLabel: describeTarget(target),
          target,
          trimAddress,
          baselineTrim,
          currentTrim,
          desiredTrim,
          rawDesiredTrim: Number.isFinite(Number(compensation?.rawDesiredTrim)) ? Number(compensation.rawDesiredTrim) : null,
          overshoot,
          saturated: Boolean(mappingRuntime?.saturationByTarget?.[targetKey] || compensation?.saturated),
          headroomUp,
          headroomDown,
          trimMin: trimSpec?.min ?? null,
          trimMax: trimSpec?.max ?? null,
          trimStep: trimSpec?.step ?? null,
          lastCommandedTrim: Number.isFinite(Number(lastCommand?.value)) ? Number(lastCommand.value) : null,
          lastCommandedAt: Number(lastCommand?.at || 0),
          collision: collisionKeySet.has(targetKey),
        };
      });

      return {
        id: mapping.id,
        name: mapping.name,
        enabled: mapping.enabled !== false,
        ownerEndpointId: ownerId,
        ownerEndpointLabel: pair?.endpoints?.[ownerId]?.label || ownerId.toUpperCase(),
        followerEndpointId: followerId,
        followerEndpointLabel: pair?.endpoints?.[followerId]?.label || followerId.toUpperCase(),
        source: mapping.source,
        sourceAddress,
        state: mappingRuntime?.state || (mapping.enabled === false ? 'disabled' : 'idle'),
        ownerGainBaseline,
        currentOwnerGain,
        delta,
        targetRows,
        hasCollision: targetRows.some((row) => row.collision),
        saturation: HaMath.summarizeSaturation(mappingRuntime?.saturationByTarget),
      };
    });
  }

  buildRuntimeView(pair) {
    const runtime = this.ensureRuntime(pair);
    this.refreshEndpointRuntime(pair.id, 'a');
    this.refreshEndpointRuntime(pair.id, 'b');
    const diagnostics = this.buildPairDiagnostics(pair, runtime);

    if (!runtime.armed && runtime.pairState !== 'needs_resync') {
      if (diagnostics.errors.length > 0) {
        runtime.pairState = 'needs_config';
        runtime.lastError = diagnostics.errors[0] || null;
      } else {
        if (runtime.pairState === 'needs_config') {
          runtime.pairState = 'offline';
          runtime.lastError = null;
        }
        this.recalculatePairState(pair, runtime);
      }
    } else {
      this.recalculatePairState(pair, runtime);
    }

    return {
      ...runtime,
      activeOwner: runtime.armed ? (runtime.activeOwner || pair.haOwner) : pair.haOwner,
      activeFollower: getFollowerEndpointId(runtime.armed ? (runtime.activeOwner || pair.haOwner) : pair.haOwner),
      diagnostics,
      mappingViews: this.buildMappingRuntimeViews(pair, runtime, diagnostics),
    };
  }
}

export default new HaCompensationEngine();
