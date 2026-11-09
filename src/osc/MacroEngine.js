import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import OscManager from './OscManager';
import { readJsonTextWithBackup, safeWriteJson } from '../storage/safeJsonStorage';

const MACROS_FILE = `${FileSystem.documentDirectory}custom_macros.json`;
const MACRO_SCHEMA_VERSION = 3;
const FADER_DB_MIN = -144.0;
const MACRO_ID_PREFIX = 'macro';
const MAX_MACROS = 250;
const MAX_MACRO_CONDITIONS = 64;
const MAX_MACRO_ACTIONS = 128;
const MAX_TARGET_IDS = 256;
const MAX_DISCRETE_ACTION_TARGETS = 128;
const MAX_RAMP_ACTION_TARGETS = 64;
const MAX_RAMP_COMMANDS_PER_SECOND = 200;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const DEFAULT_METER_TRIGGER_MODE = 'level';
const DEFAULT_METER_TRIGGER_COOLDOWN_MS = 120;
const DEFAULT_METER_TRIGGER_REARM_DB = 3;
const DEFAULT_METER_TRIGGER_DWELL_MS = 0;
const DEFAULT_METER_TRIGGER_STALE_AFTER_MS = 1500;
const DEFAULT_MACRO_OVERLAP_STRATEGY = 'drop';
const DEFAULT_MACRO_MAX_QUEUE_DEPTH = 1;
const DEFAULT_MACRO_ON_DISCONNECT = 'abort';
const MACRO_EXECUTION_OVERLAP_STRATEGIES = new Set(['drop', 'restart', 'queue_one', 'queue_many', 'concurrent']);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isMacroPayloadStructureValid = (payload) => {
  const items = Array.isArray(payload) ? payload : payload?.items;
  return Array.isArray(items)
    && items.length <= MAX_MACROS
    && items.every((macro) =>
      macro
      && typeof macro === 'object'
      && !Array.isArray(macro)
      && (!('conditions' in macro) || Array.isArray(macro.conditions))
      && (!('actions' in macro) || Array.isArray(macro.actions))
    );
};

const createMacroId = () => {
  const randomChunk = Math.random().toString(36).slice(2, 8);
  return `${MACRO_ID_PREFIX}_${Date.now().toString(36)}_${randomChunk}`;
};

const faderFloatToDb = (f) => {
  if (f >= 0.5) return f * 40.0 - 30.0;
  if (f >= 0.25) return f * 80.0 - 50.0;
  if (f >= 0.0625) return f * 160.0 - 70.0;
  if (f > 0.0) return f * 480.0 - 90.0;
  return -144.0;
};

const legacyNormalizedMeterToDb = (value) => {
  return Number((-120 + (value * 130)).toFixed(1));
};

const normalizeMeterTriggerValue = (target, value, scale) => {
  if (!target || !String(target.parameter || '').startsWith('meter')) return value;
  if (scale === 'db') return value;
  const numericValue = Number(value);
  if (!Number.isNaN(numericValue) && numericValue >= 0 && numericValue <= 1) {
    return legacyNormalizedMeterToDb(numericValue);
  }
  return value;
};

const isFaderLikeAddress = (address) => {
  return Boolean(
    address &&
    (
      address.endsWith('/fdr') ||
      address.endsWith('/lvl') ||
      address.endsWith('/level') ||
      address.endsWith('/trim')
    )
  );
};

const isMeterAddress = (address) => String(address || '').startsWith('/meters/');

const clampNumber = (value, min, max, fallback) => {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
};

const normalizeMeterTriggerMode = (value) => {
  return value === 'transient' ? 'transient' : DEFAULT_METER_TRIGGER_MODE;
};

const normalizeMeterTriggerCooldownMs = (value) => {
  return Math.round(clampNumber(value, 0, 2000, DEFAULT_METER_TRIGGER_COOLDOWN_MS));
};

const normalizeMeterTriggerRearmDb = (value) => {
  return clampNumber(value, 0.1, 24, DEFAULT_METER_TRIGGER_REARM_DB);
};

const normalizeMeterTriggerDwellMs = (value) => {
  return Math.round(clampNumber(value, 0, 1000, DEFAULT_METER_TRIGGER_DWELL_MS));
};

const normalizeMeterTriggerStaleAfterMs = (value) => {
  return Math.round(clampNumber(value, 250, 10000, DEFAULT_METER_TRIGGER_STALE_AFTER_MS));
};

const normalizeExecutionPolicy = (policy = {}, options = {}) => {
  const isMeterTrigger = options.isMeterTrigger === true;
  const overlapCandidate = String(policy?.overlapStrategy || policy?.overlap || '').trim();
  const overlapStrategy = MACRO_EXECUTION_OVERLAP_STRATEGIES.has(overlapCandidate)
    ? overlapCandidate
    : DEFAULT_MACRO_OVERLAP_STRATEGY;
  const maxQueueDepth = overlapStrategy === 'queue_many'
    ? Math.round(clampNumber(policy?.maxQueueDepth, 1, 16, DEFAULT_MACRO_MAX_QUEUE_DEPTH))
    : 1;
  const cooldownFallback = isMeterTrigger ? DEFAULT_METER_TRIGGER_COOLDOWN_MS : 0;

  return {
    cooldownMs: Math.round(clampNumber(policy?.cooldownMs, 0, 60000, cooldownFallback)),
    overlapStrategy,
    maxQueueDepth,
    // The show-safe runtime currently supports one honest policy: abort all pending work.
    onDisconnect: DEFAULT_MACRO_ON_DISCONNECT,
  };
};

const normalizeFaderDomainValue = (value) => {
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return FADER_DB_MIN;
  if (numericValue >= 0.0 && numericValue <= 1.0) {
    return faderFloatToDb(numericValue);
  }
  return numericValue;
};

const smoothStep = (t) => {
  return t * t * (3 - 2 * t);
};

const easeProgress = (t, curve = 'linear') => {
  const clamped = Math.max(0, Math.min(1, Number(t) || 0));
  if (curve === 'smooth') return smoothStep(clamped);
  if (curve === 'ease_in') return clamped * clamped;
  if (curve === 'ease_out') return 1 - ((1 - clamped) * (1 - clamped));
  return clamped;
};

function compareValues(address, current, target, op) {
  const isFader = isFaderLikeAddress(address);
  let curNum = parseFloat(current);
  let tarNum = parseFloat(target);

  if (isFader && !isNaN(curNum) && !isNaN(tarNum)) {
    // Keep comparisons in dB domain to match WING /fdr semantics.
    if (tarNum >= 0.0 && tarNum <= 1.0) tarNum = faderFloatToDb(tarNum);
    if (curNum >= 0.0 && curNum <= 1.0) curNum = faderFloatToDb(curNum);
  }

  if (!isNaN(curNum) && !isNaN(tarNum)) {
    const epsilon = isFader ? 0.1 : (isMeterAddress(address) ? 0.1 : 0.001);
    if (op === '==') return Math.abs(curNum - tarNum) < epsilon;
    if (op === '!=') return Math.abs(curNum - tarNum) >= epsilon;
    if (op === '>') return curNum > tarNum;
    if (op === '<') return curNum < tarNum;
  }

  const curStr = String(current).trim();
  const tarStr = String(target).trim();
  if (op === '==') return curStr === tarStr;
  if (op === '!=') return curStr !== tarStr;
  return false;
}

class MacroEngine {
  constructor() {
    this.macros = [];
    this.listeners = []; // To notify React UI of changes
    this.lastTriggerStates = new Map(); // macro.id -> boolean (edge detection for meters and states)
    this.mutationQueue = Promise.resolve();
    this.loaded = false;
    this.persistenceBlocked = false;
    this.executionGeneration = 0;
    this.activeExecutionTimers = new Set();
    this.automationActionHandler = null;
    this.meterTriggerRuntime = new Map();
    this.activeMacroRuns = new Map();
    this.triggerAddressIndex = new Map();
    this.uncoveredTriggerAddresses = [];
    this.nextExecutionId = 1;
    this.consoleOnline = OscManager?.getRuntimeStatus?.().wingOnline === true;
    this.runtimeSuspended = false;

    // Listen for live state changes reported by the console.
    OscManager.on('wing_state', (data) => {
      if (!data || typeof data.address !== 'string' || !Array.isArray(data.args)) return;
      this.evaluateWingStateTrigger(data.address, data.args);
    });
    OscManager.on('wing_online_status', (online) => {
      this.handleConsoleOnlineStatus(online === true);
    });
    OscManager.on('meter_request_coverage', (coverage) => {
      this.handleMeterRequestCoverage(coverage);
    });

    // Initial asynchronous load
    this.loadPromise = this.loadMacros();
  }

  normalizeMacroConfig(macro) {
    if (!macro || typeof macro !== 'object' || Array.isArray(macro)) return null;

    const normalizeCategoryKey = (category) => {
      const key = String(category || '').trim();
      const aliasMap = {
        preamp_expansion: 'preamp_card',
        preamp_wlive: 'preamp_card',
        output_stagea: 'output_aes50a',
        output_stageb: 'output_aes50b',
        output_stagec: 'output_aes50c',
        preamp_stagea: 'preamp_aes50a',
        preamp_stageb: 'preamp_aes50b',
        preamp_stagec: 'preamp_aes50c',
      };
      return aliasMap[key] || key;
    };

    const normalizeTarget = (target) => {
      if (!target || typeof target === 'string') return target;
      if (target.type === 'selected') {
        // Legacy selected-target migration; the old behavior depended on Maillot path /$ctl/$stat/selidx.
        // The user-facing feature was removed; migrate conservatively to a fixed CH 1 target.
        return {
          type: 'fixed',
          category: 'ch',
          ids: '1',
          parameter: target.parameter || 'mute',
          customAddress: '',
          ...(target.sendId ? { sendId: target.sendId } : {}),
        };
      }
      return {
        ...target,
        category: normalizeCategoryKey(target.category),
      };
    };

    const normalizedTriggerValue = normalizeMeterTriggerValue(
      normalizeTarget(macro.triggerTarget),
      macro.triggerValue,
      macro.triggerValueScale
    );
    const normalizedTriggerTarget = normalizeTarget(macro.triggerTarget);
    const isMeterTrigger = String(normalizedTriggerTarget?.parameter || '').startsWith('meter');

    const normalizedId = isNonEmptyString(macro.id) ? macro.id.trim() : createMacroId();

    const legacyExternalTrigger = macro.triggerType === 'ms' || (!macro.triggerType && macro.triggerAddress && !macro.triggerTarget);
    const normalizedExecutionPolicy = normalizeExecutionPolicy(macro.executionPolicy, { isMeterTrigger });
    return {
      ...macro,
      id: normalizedId,
      schemaVersion: MACRO_SCHEMA_VERSION,
      enabled: legacyExternalTrigger ? false : macro.enabled === true,
      triggerType: 'console',
      triggerAddress: undefined,
      triggerTarget: normalizedTriggerTarget || {
        type: 'fixed',
        category: 'ch',
        ids: '1',
        parameter: 'mute',
        customAddress: '',
      },
      conditions: Array.isArray(macro.conditions)
        ? macro.conditions.slice(0, MAX_MACRO_CONDITIONS).map((cond) => ({ ...cond, target: normalizeTarget(cond?.target) }))
        : macro.conditions,
      actions: Array.isArray(macro.actions)
        ? macro.actions.slice(0, MAX_MACRO_ACTIONS).map((action) => ({ ...action, target: normalizeTarget(action?.target) }))
        : macro.actions,
      triggerValue: normalizedTriggerValue,
      triggerValueScale: String(macro.triggerTarget?.parameter || '').startsWith('meter') ? 'db' : macro.triggerValueScale,
      triggerMeterMode: normalizeMeterTriggerMode(macro.triggerMeterMode),
      triggerMeterCooldownMs: normalizeMeterTriggerCooldownMs(macro.triggerMeterCooldownMs),
      triggerMeterRearmDb: normalizeMeterTriggerRearmDb(macro.triggerMeterRearmDb),
      triggerMeterDwellMs: normalizeMeterTriggerDwellMs(macro.triggerMeterDwellMs),
      triggerMeterStaleAfterMs: normalizeMeterTriggerStaleAfterMs(macro.triggerMeterStaleAfterMs),
      executionPolicy: normalizedExecutionPolicy,
    };
  }

  onChange(callback) {
    this.listeners.push(callback);
    try {
      callback(this.macros, this.getEngineStateSnapshot());
    } catch (error) {
      console.error('[MacroEngine] Initial change listener failed.', error);
    }
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  getMacroRuntimeSnapshot() {
    const snapshot = {};
    this.activeMacroRuns.forEach((runtime, macroKey) => {
      snapshot[macroKey] = {
        activeCount: runtime.runs.size,
        queuedCount: runtime.queue.length,
        started: runtime.started,
        completed: runtime.completed,
        dropped: runtime.dropped,
        aborted: runtime.aborted,
        failed: runtime.failed,
        restarted: runtime.restarted,
        queued: runtime.queued,
        lastStartedAt: runtime.lastStartedAt || 0,
        lastCompletedAt: runtime.lastCompletedAt || 0,
        lastDropReason: runtime.lastDropReason || '',
        lastAbortReason: runtime.lastAbortReason || '',
        lastFailureReason: runtime.lastFailureReason || '',
      };
    });
    return snapshot;
  }

  getEngineStateSnapshot() {
    return {
      loaded: this.loaded,
      persistenceBlocked: this.persistenceBlocked,
      consoleOnline: this.consoleOnline,
      runtimeSuspended: this.runtimeSuspended,
      uncoveredTriggerAddresses: [...this.uncoveredTriggerAddresses],
      macroRuntime: this.getMacroRuntimeSnapshot(),
    };
  }

  notifyListeners(options = {}) {
    if (options.updateWatchedAddresses !== false && OscManager && typeof OscManager.setWatchedAddresses === 'function') {
      this.rebuildTriggerAddressIndex();
      OscManager.setWatchedAddresses(this.getAllWatchedAddresses(), 'engine');
    }
    const state = this.getEngineStateSnapshot();
    [...this.listeners].forEach((cb) => {
      try {
        cb([...this.macros], state);
      } catch (error) {
        console.error('[MacroEngine] Change listener failed.', error);
      }
    });
  }

  notifyRuntimeListeners() {
    this.notifyListeners({ updateWatchedAddresses: false });
  }

  setAutomationActionHandler(handler) {
    this.automationActionHandler = typeof handler === 'function' ? handler : null;
  }

  rebuildTriggerAddressIndex() {
    const nextIndex = new Map();
    this.macros.forEach((macro) => {
      if (macro?.enabled !== true || macro?.triggerType !== 'console') return;
      this.resolveAddresses(macro.triggerTarget || macro.triggerAddress).forEach((address) => {
        if (!nextIndex.has(address)) nextIndex.set(address, []);
        nextIndex.get(address).push(macro);
      });
    });
    this.triggerAddressIndex = nextIndex;
  }

  handleConsoleOnlineStatus(online) {
    const nextOnline = online === true;
    if (this.consoleOnline === nextOnline) return;
    this.consoleOnline = nextOnline;
    this.lastTriggerStates.clear();
    this.meterTriggerRuntime.clear();
    if (!nextOnline) {
      this.stopAllExecutions('console offline');
    }
    this.notifyListeners();
  }

  handleMeterRequestCoverage(coverage = {}) {
    const dropped = new Set(Array.isArray(coverage?.droppedAddresses) ? coverage.droppedAddresses : []);
    const nextUncovered = Array.from(this.triggerAddressIndex.keys()).filter((address) => dropped.has(address));
    if (
      nextUncovered.length === this.uncoveredTriggerAddresses.length
      && nextUncovered.every((address, index) => address === this.uncoveredTriggerAddresses[index])
    ) return;
    this.uncoveredTriggerAddresses = nextUncovered;
    if (nextUncovered.length > 0) {
      console.error(`[MacroEngine] ${nextUncovered.length} enabled trigger address(es) are outside the meter request budget.`);
    }
    this.notifyRuntimeListeners();
  }

  setRuntimeSuspended(suspended, reason = 'app backgrounded') {
    const nextSuspended = suspended === true;
    if (this.runtimeSuspended === nextSuspended) return;
    this.runtimeSuspended = nextSuspended;
    this.lastTriggerStates.clear();
    this.meterTriggerRuntime.clear();
    if (nextSuspended) {
      this.stopAllExecutions(reason);
    }
    this.notifyListeners();
  }

  extractMacroItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.items)) return payload.items;
    return [];
  }

  findMacroIndex(idOrName) {
    const lookup = String(idOrName || '').trim();
    if (!lookup) return -1;
    const byId = this.macros.findIndex((macro) => macro.id === lookup);
    if (byId !== -1) return byId;
    return this.macros.findIndex((macro) => macro.name === lookup);
  }

  getMacroStateKey(macro) {
    if (!macro) return '';
    if (isNonEmptyString(macro.id)) return macro.id.trim();
    if (isNonEmptyString(macro.name)) return macro.name.trim();
    return '';
  }

  getTriggerStateKey(macro, address) {
    const macroKey = this.getMacroStateKey(macro);
    if (!macroKey) return '';
    return isMeterAddress(address) ? `${macroKey}|${String(address)}` : macroKey;
  }

  clearMacroRuntimeState(macro) {
    const keys = new Set();
    const stateKey = this.getMacroStateKey(macro);
    if (stateKey) keys.add(stateKey);
    if (isNonEmptyString(macro?.name)) keys.add(macro.name.trim());

    keys.forEach((key) => {
      this.lastTriggerStates.delete(key);
      Array.from(this.lastTriggerStates.keys()).forEach((runtimeKey) => {
        if (String(runtimeKey).startsWith(`${key}|`)) this.lastTriggerStates.delete(runtimeKey);
      });
      Array.from(this.meterTriggerRuntime.keys()).forEach((runtimeKey) => {
        if (String(runtimeKey).startsWith(`${key}|`)) this.meterTriggerRuntime.delete(runtimeKey);
      });
      this.cancelMacroExecutionsByKey(key, 'macro runtime reset');
    });
  }

  async saveMacros(options = {}) {
    if (this.persistenceBlocked && options.allowRecovery !== true) {
      console.error('[MacroEngine] Save blocked because macro storage did not hydrate safely.');
      return false;
    }
    try {
      const payload = {
        schemaVersion: MACRO_SCHEMA_VERSION,
        items: this.macros,
      };
      await safeWriteJson(MACROS_FILE, payload);
      this.persistenceBlocked = false;
      console.log(`[MacroEngine] ${this.macros.length} macros saved successfully.`);
      this.notifyListeners();
      return true;
    } catch (e) {
      console.error("[MacroEngine] Error saving macros:", e);
      return false;
    }
  }

  cloneMacroList() {
    return JSON.parse(JSON.stringify(this.macros));
  }

  async persistMacroMutation(previousMacros, message) {
    if (await this.saveMacros()) return true;
    this.macros = previousMacros;
    this.notifyListeners();
    throw new Error(message);
  }

  async withMutationLock(work) {
    const next = this.mutationQueue.catch(() => undefined).then(work);
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }

  async replaceMacros(items = []) {
    return this.withMutationLock(() => this.replaceMacrosUnlocked(items));
  }

  async replaceMacrosUnlocked(items = []) {
    this.stopAllExecutions('macro list replaced');
    const seenIds = new Set();
    const previousMacros = this.macros;
    this.macros = (Array.isArray(items) ? items : [])
      .slice(0, MAX_MACROS)
      .map((macro) => this.normalizeMacroConfig(macro))
      .filter(Boolean)
      .map((macro) => {
        let nextId = macro.id;
        while (seenIds.has(nextId)) nextId = createMacroId();
        seenIds.add(nextId);
        return nextId === macro.id ? macro : { ...macro, id: nextId };
      });
    this.lastTriggerStates.clear();
    this.meterTriggerRuntime.clear();
    if (!await this.saveMacros({ allowRecovery: true })) {
      this.macros = previousMacros;
      this.notifyListeners();
      throw new Error('Failed to persist replacement macro list.');
    }
    return this.macros.length;
  }

  async loadMacros() {
    try {
      const content = await readJsonTextWithBackup(
        MACROS_FILE,
        isMacroPayloadStructureValid,
      );
      if (content !== null) {
        const parsed = JSON.parse(content);
        const items = this.extractMacroItems(parsed);
        const isWrappedPayload = Boolean(parsed && !Array.isArray(parsed) && Array.isArray(parsed.items));
        const parsedSchemaVersion = Number(parsed?.schemaVersion || 0);
        const requiresMigration = !isWrappedPayload
          || parsedSchemaVersion < MACRO_SCHEMA_VERSION
          || items.some((macro) => !isNonEmptyString(macro?.id));
        const seenMacroIds = new Set();
        this.macros = items
          .slice(0, MAX_MACROS)
          .map((macro) => this.normalizeMacroConfig(macro))
          .filter(Boolean)
          .map((macro) => {
            let nextId = macro.id;
            while (seenMacroIds.has(nextId)) {
              nextId = createMacroId();
            }
            seenMacroIds.add(nextId);
            if (nextId === macro.id) return macro;
            return { ...macro, id: nextId };
          });
        console.log(`[MacroEngine] Loaded ${this.macros.length} macros from disk.`);
        if (requiresMigration) {
          await this.saveMacros();
        }
      } else {
        // Fresh installs must never contain an armed example capable of writing to a live console.
        this.macros = [];
        await this.saveMacros();
      }
    } catch (e) {
      console.error("[MacroEngine] Error loading macros:", e);
      this.persistenceBlocked = true;
    } finally {
      this.loaded = true;
      this.notifyListeners();
    }
  }

  whenLoaded() {
    return this.loadPromise || Promise.resolve();
  }

  async registerMacro(macroConfig) {
    return this.withMutationLock(() => this.registerMacroUnlocked(macroConfig));
  }

  async registerMacroUnlocked(macroConfig) {
    const previousMacros = this.cloneMacroList();
    const inputId = isNonEmptyString(macroConfig?.id) ? macroConfig.id.trim() : '';
    const inputName = isNonEmptyString(macroConfig?.name) ? macroConfig.name.trim() : '';
    const index = inputId
      ? this.macros.findIndex((macro) => macro.id === inputId)
      : this.macros.findIndex((macro) => macro.name === inputName);
    if (index === -1 && this.macros.length >= MAX_MACROS) {
      throw new Error(`Macro limit reached (${MAX_MACROS}). Delete or replace a macro before creating another.`);
    }
    const oldEnabled = index !== -1 ? this.macros[index].enabled : false;
    
    const macroWithDefaults = {
      enabled: oldEnabled,
      triggerType: macroConfig?.triggerTarget ? 'console' : 'ms',
      ...macroConfig
    };
    if (!isNonEmptyString(macroWithDefaults.id) && index !== -1 && isNonEmptyString(this.macros[index]?.id)) {
      macroWithDefaults.id = this.macros[index].id;
    }
    const normalizedMacro = this.normalizeMacroConfig(macroWithDefaults);

    if (index !== -1) {
      this.clearMacroRuntimeState(this.macros[index]);
      this.macros[index] = normalizedMacro;
    } else {
      this.macros.push(normalizedMacro);
    }
    console.log(`[MacroEngine] Registrado macro: ${normalizedMacro.name}`);
    await this.persistMacroMutation(previousMacros, `Failed to persist macro "${normalizedMacro.name}".`);
    return normalizedMacro;
  }

  async toggleMacro(idOrName, enabled) {
    return this.withMutationLock(() => this.toggleMacroUnlocked(idOrName, enabled));
  }

  async toggleMacroUnlocked(idOrName, enabled) {
    const index = this.findMacroIndex(idOrName);
    if (index !== -1) {
      const previousMacros = this.cloneMacroList();
      this.macros[index].enabled = enabled;
      if (!enabled) {
        const macroKey = this.getMacroStateKey(this.macros[index]);
        if (macroKey) this.cancelMacroExecutionsByKey(macroKey, `macro "${this.macros[index].name}" disabled`);
        this.clearMacroRuntimeState(this.macros[index]);
      }
      console.log(`[MacroEngine] Macro "${this.macros[index].name}" cambiado a enabled: ${enabled}`);
      await this.persistMacroMutation(previousMacros, `Failed to persist macro enabled state for "${this.macros[index].name}".`);
    }
  }

  parseIds(ids) {
    let idArray = [];
    if (Array.isArray(ids)) {
      idArray = ids.slice(0, MAX_TARGET_IDS);
    } else if (typeof ids === 'string') {
      const cleanIdsStr = ids.trim();
      if (cleanIdsStr.includes('-')) {
        const parts = cleanIdsStr.split('-');
        const start = Number.parseInt(parts[0], 10);
        const end = Number.parseInt(parts[1], 10);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return [];
        for (let i = start; i <= end && idArray.length < MAX_TARGET_IDS; i++) {
          idArray.push(i);
        }
      } else {
        idArray = cleanIdsStr
          .split(',')
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isInteger(value) && value > 0)
          .slice(0, MAX_TARGET_IDS);
      }
    } else if (typeof ids === 'number') {
      idArray = [ids];
    }
    return idArray.filter((id) => Number.isFinite(Number(id)) && Number(id) > 0).map(Number);
  }

  // Resolves a Target Builder Object into an array of physical OSC addresses per deep WING specification
  resolveAddresses(target) {
    if (!target) return [];
    
    if (typeof target === 'string') {
      const address = target.trim();
      return address.startsWith('/') ? [address] : [];
    }
    
    if (target.type === 'custom') {
      const customAddress = String(target.customAddress || '').trim();
      return customAddress.startsWith('/') ? [customAddress] : [];
    }

    if (target.parameter === 'load_snapshot') {
      return ['/show/load'];
    }
    if (target.parameter === 'load_preset') {
      return ['/library/load'];
    }

    const normalizeCategory = (rawCategory) => {
      const category = String(rawCategory || '').trim();
      const aliasMap = {
        preamp_expansion: 'preamp_card',
        preamp_wlive: 'preamp_card',
        preamp_stagea: 'preamp_aes50a',
        preamp_stageb: 'preamp_aes50b',
        preamp_stagec: 'preamp_aes50c',
        output_stagea: 'output_aes50a',
        output_stageb: 'output_aes50b',
        output_stagec: 'output_aes50c',
      };
      return aliasMap[category] || category;
    };

    if (target.type === 'selected') return [];

    const category = normalizeCategory(target.category);
    const idArray = this.parseIds(target.ids);

    const meterSourceBases = {
      usb: '/meters/usb',
      usersig: '/meters/usersig',
      preamp_local: '/meters/preamp/local',
      preamp_aux: '/meters/preamp/aux',
      preamp_aes50a: '/meters/preamp/stagea',
      preamp_aes50b: '/meters/preamp/stageb',
      preamp_aes50c: '/meters/preamp/stagec',
      preamp_stageconnect: '/meters/preamp/stageconnect',
      preamp_card: '/meters/preamp/card',
      preamp_module: '/meters/preamp/module',
      preamp_usbplayer: '/meters/preamp/usbplayer',
      preamp_aesebu: '/meters/preamp/aesebu',
      preamp_oscillator: '/meters/preamp/oscillator',
      preamp_bus: '/meters/preamp/bus',
      preamp_main: '/meters/preamp/main',
      preamp_matrix: '/meters/preamp/matrix',
    };
    const meterOutputBases = {
      output_local: '/meters/output/local',
      output_aux: '/meters/output/aux',
      output_aes50a: '/meters/output/stagea',
      output_aes50b: '/meters/output/stageb',
      output_aes50c: '/meters/output/stagec',
      output_stageconnect: '/meters/output/stageconnect',
      output_usb: '/meters/output/usb',
      output_card: '/meters/output/card',
      output_module: '/meters/output/module',
      output_usbrec: '/meters/output/usbrec',
      output_aesebu: '/meters/output/aesebu',
    };
    const meterFamilyPrefix = {
      ch: 'ch',
      bus: 'bus',
      aux: 'aux',
      main: 'main',
      matrix: 'matrix',
      dca: 'dca',
      fx: 'fx'
    };

    if (target.parameter === 'meter') {
      if (meterSourceBases[category]) {
        return idArray.map(id => `${meterSourceBases[category]}/${String(id)}`);
      }
      if (meterOutputBases[category]) {
        return idArray.map(id => `${meterOutputBases[category]}/${String(id)}`);
      }
      if (meterFamilyPrefix[category]) {
        return idArray.map(id => `/meters/${meterFamilyPrefix[category]}/${String(id)}`);
      }
      return [];
    }

    if (target.parameter === 'meter_monitor') {
      if (category !== 'monitor') return [];
      const monitorLabelByIndex = {
        1: 'solo_l',
        2: 'solo_r',
        3: 'mon1_l',
        4: 'mon1_r',
        5: 'mon2_l',
        6: 'mon2_r',
      };
      return idArray.flatMap((id) => (
        monitorLabelByIndex[id] ? [`/meters/monitor/${monitorLabelByIndex[id]}`] : []
      ));
    }

    if (target.parameter === 'meter_rta_band') {
      if (category !== 'rta') return [];
      return idArray
        .filter((id) => Number.isFinite(id) && id >= 1 && id <= 120)
        .map((id) => `/meters/rta/${String(id)}`);
    }

    if (['meter_v2_gate_led', 'meter_v2_dyn_state', 'meter_v2_automix'].includes(target.parameter)) {
      const v2Family = {
        ch: 'chv2',
        aux: 'auxv2',
        bus: 'busv2',
        main: 'mainv2',
        matrix: 'matrixv2',
      }[category];
      if (!v2Family) return [];
      const v2Field = {
        meter_v2_gate_led: 'gate_led',
        meter_v2_dyn_state: 'dyn_state',
        meter_v2_automix: 'automix_gain',
      }[target.parameter];
      return idArray.map((id) => `/meters/${v2Family}/${String(id)}/${v2Field}`);
    }

    if (!isNonEmptyString(target.parameter)) return [];

    let prefix = category === 'ch' ? '/ch' : null;
    if (category === 'bus') prefix = '/bus';
    else if (category === 'aux') prefix = '/aux';
    else if (category === 'main') prefix = '/main';
    else if (category === 'matrix') prefix = '/matrix';
    else if (category === 'usb') prefix = '/io/in/USB';
    else if (category === 'fx') prefix = '/fx';
    else if (category === 'dca') prefix = '/dca';
    else if (category === 'mutegroup') prefix = '/mgrp';
    else if (category === 'usersig') prefix = '/io/in/USR';
    else if (category === 'userctrl') prefix = '/$ctl/user/1';
    else if (category === 'preamp_local') prefix = '/io/in/LCL';
    else if (category === 'preamp_aux') prefix = '/io/in/AUX';
    else if (category === 'preamp_aes50a') prefix = '/io/in/A';
    else if (category === 'preamp_aes50b') prefix = '/io/in/B';
    else if (category === 'preamp_aes50c') prefix = '/io/in/C';
    else if (category === 'preamp_stageconnect') prefix = '/io/in/SC';
    else if (category === 'preamp_card') prefix = '/io/in/CRD';
    else if (category === 'preamp_module') prefix = '/io/in/MOD';
    else if (category === 'preamp_usbplayer') prefix = '/io/in/PLAY';
    else if (category === 'preamp_aesebu') prefix = '/io/in/AES';
    else if (category === 'preamp_oscillator') prefix = '/io/in/OSC';
    if (!prefix || idArray.length === 0) return [];

    // Maillot-aligned path mappings for source and channel controls.
    let param = null;
    const isPreamp = category.startsWith('preamp_') || category === 'usb';
    
    if (category === 'dca') {
      if (target.parameter === 'mute') param = '/mute';
      else if (target.parameter === 'fdr' || target.parameter === 'fader') param = '/fdr';
    } else if (category === 'mutegroup') {
      if (target.parameter === 'mute') param = '/mute';
    } else if (category === 'usersig') {
      if (target.parameter === 'mute') param = '/mute';
      else if (target.parameter === 'phase') param = '/pol';
      else if (target.parameter === 'name') param = '/name';
      else if (target.parameter === 'color') param = '/col';
    } else if (category === 'userctrl') {
      if (target.parameter === 'user_btn') param = '/bu';
    } else if (isPreamp) {
      if (target.parameter === 'gain') param = '/g';
      else if (target.parameter === 'phantom_48v') param = '/vph';
      else if (target.parameter === 'mute') param = '/mute';
      else if (target.parameter === 'phase') param = '/pol';
      else if (target.parameter === 'name') param = '/name';
      else if (target.parameter === 'color') param = '/col';
      else if (target.parameter === 'icon') param = '/icon';
    } else {
      if (target.parameter === 'mute') param = '/mute';
      else if (target.parameter === 'fdr' || target.parameter === 'fader') param = '/fdr';
      else if (target.parameter === 'pan') param = '/pan';
      else if (target.parameter === 'gain') param = '/in/set/$g';
      else if (target.parameter === 'phantom_48v') param = '/in/set/$vph';
      else if (target.parameter === 'phase') param = '/in/set/inv';
      else if (target.parameter === 'hpf_on') param = '/flt/lc';
      else if (target.parameter === 'hpf_freq') param = '/flt/lcf';
      else if (target.parameter === 'lpf_on') param = '/flt/hc';
      else if (target.parameter === 'lpf_freq') param = '/flt/hcf';
      else if (target.parameter === 'eq_on') param = '/eq/on';
      else if (target.parameter.startsWith('eq_') && target.parameter.endsWith('_gain')) {
        const band = target.parameter.split('_')[1];
        param = `/eq/${band}g`;
      } else if (target.parameter.startsWith('eq_') && target.parameter.endsWith('_freq')) {
        const band = target.parameter.split('_')[1];
        param = `/eq/${band}f`;
      } else if (target.parameter.startsWith('eq_') && target.parameter.endsWith('_q')) {
        const band = target.parameter.split('_')[1];
        param = `/eq/${band}q`;
      } else if (target.parameter === 'gate_on') param = '/gate/on';
      else if (target.parameter === 'gate_thr') param = '/gate/thr24';
      else if (target.parameter === 'gate_range') param = '/gate/range';
      else if (target.parameter === 'gate_attack') param = '/gate/att';
      else if (target.parameter === 'gate_release') param = '/gate/rel';
      else if (target.parameter === 'gate_type') param = '/gate/mdl';
      else if (target.parameter === 'comp_on') param = '/dyn/on';
      else if (target.parameter === 'comp_thr') param = '/dyn/thr27';
      else if (target.parameter === 'comp_ratio') param = '/dyn/ratio';
      else if (target.parameter === 'comp_attack') param = '/dyn/att';
      else if (target.parameter === 'comp_release') param = '/dyn/rel';
      else if (target.parameter === 'comp_knee') param = '/dyn/knee';
      else if (target.parameter === 'comp_makeup') param = '/dyn/gain';
      else if (target.parameter === 'comp_type') param = '/dyn/mdl';
      else if (target.parameter === 'insert_on') param = '/preins/on';
      else if (target.parameter === 'fx_mix') param = '/fxmix';
      else if (target.parameter === 'send_level') {
        const busId = String(target.sendId || 1);
        param = `/send/${busId}/lvl`;
      } else if (target.parameter === 'send_on') {
        const busId = String(target.sendId || 1);
        param = `/send/${busId}/on`;
      }
    }

    if (!param) return [];
    const resolvedPrefix = prefix;
    const resolvedParam = param;

    return idArray.map(id => {
      const idStr = String(id);
      return `${resolvedPrefix}/${idStr}${resolvedParam}`;
    });
  }

  async deleteMacro(idOrName) {
    return this.withMutationLock(() => this.deleteMacroUnlocked(idOrName));
  }

  async deleteMacroUnlocked(idOrName) {
    const index = this.findMacroIndex(idOrName);
    if (index === -1) return;
    const previousMacros = this.cloneMacroList();
    const removed = this.macros[index];
    const macroKey = this.getMacroStateKey(removed);
    if (macroKey) this.cancelMacroExecutionsByKey(macroKey, `macro "${removed?.name || idOrName}" deleted`);
    this.macros.splice(index, 1);
    this.clearMacroRuntimeState(removed);
    console.log(`[MacroEngine] Deleted macro: ${removed?.name || idOrName}`);
    await this.persistMacroMutation(previousMacros, `Failed to persist deletion of "${removed?.name || idOrName}".`);
  }

  async duplicateMacro(idOrName) {
    return this.withMutationLock(() => this.duplicateMacroUnlocked(idOrName));
  }

  async duplicateMacroUnlocked(idOrName) {
    const index = this.findMacroIndex(idOrName);
    if (index === -1) return;
    const previousMacros = this.cloneMacroList();
    const source = this.macros[index];
    if (!source) return;
    if (this.macros.length >= MAX_MACROS) {
      throw new Error(`Macro limit reached (${MAX_MACROS}). Delete a macro before duplicating another.`);
    }
    const copy = JSON.parse(JSON.stringify(source));
    let candidateName = `${source.name} (Copy)`;
    let suffix = 2;
    while (this.macros.some((macro) => macro.name === candidateName)) {
      candidateName = `${source.name} (Copy ${suffix})`;
      suffix += 1;
    }
    copy.id = createMacroId();
    copy.name = candidateName;
    copy.enabled = false; // Disabled by default so it doesn't trigger automatically
    this.macros.push(copy);
    console.log(`[MacroEngine] Duplicated macro: ${copy.name}`);
    await this.persistMacroMutation(previousMacros, `Failed to persist duplicate "${copy.name}".`);
    return copy;
  }

  async moveMacro(idOrName, direction) {
    return this.withMutationLock(() => this.moveMacroUnlocked(idOrName, direction));
  }

  async moveMacroUnlocked(idOrName, direction) {
    const index = this.findMacroIndex(idOrName);
    if (index === -1) return;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= this.macros.length) return;
    const previousMacros = this.cloneMacroList();
    const temp = this.macros[newIndex];
    this.macros[newIndex] = this.macros[index];
    this.macros[index] = temp;
    console.log(`[MacroEngine] Moved macro "${this.macros[newIndex]?.name || idOrName}" ${direction}`);
    await this.persistMacroMutation(previousMacros, `Failed to persist macro order change.`);
  }

  async exportMacros() {
    try {
      const exportPath = `${FileSystem.cacheDirectory}wing_macros_export.json`;
      const payload = {
        schemaVersion: MACRO_SCHEMA_VERSION,
        items: this.macros,
      };
      await FileSystem.writeAsStringAsync(exportPath, JSON.stringify(payload, null, 2));
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(exportPath, {
          mimeType: 'application/json',
          dialogTitle: 'Export WING Macros',
          UTI: 'public.json'
        });
        console.log('[MacroEngine] Macros exported successfully.');
      } else {
        console.warn('[MacroEngine] Sharing not available on this device.');
      }
    } catch (e) {
      console.error('[MacroEngine] Error exporting macros:', e);
    }
  }

  async importMacros() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true
      });
      if (result.canceled) return;
      const uri = result.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(uri);
      if (content.length > MAX_IMPORT_BYTES) throw new Error('File exceeds safe limit of 2 MB.');
      const importedPayload = JSON.parse(content);
      const isKnownFormat = isMacroPayloadStructureValid(importedPayload);
      const imported = this.extractMacroItems(importedPayload).slice(0, MAX_MACROS);
      if (!isKnownFormat) throw new Error('Invalid format');
      // Merge: do not overwrite existing macros with the same name
      const nextMacros = [...this.macros];
      let added = 0;
      for (const macro of imported) {
        const normalizedMacro = this.normalizeMacroConfig(macro);
        if (
          normalizedMacro
          && isNonEmptyString(normalizedMacro.name)
          && !nextMacros.find(m => m.id === normalizedMacro.id || m.name === normalizedMacro.name)
        ) {
          nextMacros.push({ ...normalizedMacro, enabled: false });
          added++;
        }
      }
      const previousMacros = this.macros;
      this.macros = nextMacros;
      console.log(`[MacroEngine] Imported ${added} new macros.`);
      if (!await this.saveMacros({ allowRecovery: true })) {
        this.macros = previousMacros;
        this.notifyListeners();
        throw new Error('Failed to save import.');
      }
      return added;
    } catch (e) {
      console.error('[MacroEngine] Error importing macros:', e);
      return 0;
    }
  }

  getAllWatchedAddresses() {
    if (this.runtimeSuspended || !this.consoleOnline) return [];
    const addresses = new Set();
    this.macros.filter((macro) => macro.enabled === true).forEach(macro => {
      // Trigger
      if (macro.triggerTarget) {
        this.resolveAddresses(macro.triggerTarget).forEach(a => addresses.add(a));
      }
      // Conditions
      if (macro.conditions) {
        macro.conditions.forEach(cond => {
          this.resolveAddresses(cond.target).forEach(a => addresses.add(a));
        });
      }
    });
    return Array.from(addresses);
  }

  evaluateWingStateTrigger(address, args) {
    if (this.runtimeSuspended || !this.consoleOnline) return;
    const matchingMacros = this.triggerAddressIndex.get(address) || [];

    for (let macro of matchingMacros) {
        // WING returns triplets for manual polls, single tags for events
        const currentValue = args.length >= 3 ? args[2] : args[0];
        let shouldTrigger = false;

        const triggerOp = macro.triggerOperator || '==';
        const targetVal = macro.triggerValue;
        const triggerEdgeMode = macro.triggerEdgeMode || 'on';

        shouldTrigger = compareValues(address, currentValue, targetVal, triggerOp);

        if (!this.lastTriggerStates) {
          this.lastTriggerStates = new Map();
        }

        const isMeterTrigger = isMeterAddress(address);
        const macroStateKey = this.getTriggerStateKey(macro, address);
        const hasPreviousTriggerState = this.lastTriggerStates.has(macroStateKey);
        const wasTriggered = this.lastTriggerStates.get(macroStateKey) || false;
        let baselineOnly = !hasPreviousTriggerState;
        const risingEdge = !wasTriggered && shouldTrigger;
        const fallingEdge = wasTriggered && !shouldTrigger;
        let transientPulse = false;
        let meterDwellPending = false;

        if (isMeterTrigger && macro.triggerMeterMode === 'transient' && triggerOp === '>') {
          const currentNum = Number(currentValue);
          const targetNum = Number(targetVal);
          if (!Number.isNaN(currentNum) && !Number.isNaN(targetNum)) {
            const now = Date.now();
            const runtimeKey = `${macroStateKey}|transient`;
            const previousRuntime = this.meterTriggerRuntime.get(runtimeKey) || {};
            const staleAfterMs = normalizeMeterTriggerStaleAfterMs(macro.triggerMeterStaleAfterMs);
            const lastPacketAt = Number(previousRuntime.lastPacketAt || 0);
            const packetGapMs = lastPacketAt > 0 ? now - lastPacketAt : 0;
            if (lastPacketAt <= 0 || packetGapMs > staleAfterMs) {
              baselineOnly = true;
            }
            const previousMin = typeof previousRuntime.recentMin === 'number'
              ? previousRuntime.recentMin
              : currentNum;
            const recentMin = Math.min(previousMin, currentNum);
            const lastFireAt = Number(previousRuntime.lastFireAt || 0);
            const cooldownMs = normalizeMeterTriggerCooldownMs(macro.triggerMeterCooldownMs);
            const rearmDb = normalizeMeterTriggerRearmDb(macro.triggerMeterRearmDb);
            const dwellMs = normalizeMeterTriggerDwellMs(macro.triggerMeterDwellMs);
            const firstHotAt = shouldTrigger
              ? Number(previousRuntime.firstHotAt || now)
              : 0;
            const cooldownElapsed = lastFireAt <= 0 || (now - lastFireAt) >= cooldownMs;
            const dwellElapsed = !shouldTrigger || dwellMs <= 0 || (now - firstHotAt) >= dwellMs;
            const roseFromRecentMin = (currentNum - recentMin) >= rearmDb;

            meterDwellPending = !baselineOnly && shouldTrigger && dwellMs > 0 && !dwellElapsed;
            transientPulse = !baselineOnly && shouldTrigger && !risingEdge && cooldownElapsed && dwellElapsed && roseFromRecentMin;
            const acceptedFire = !baselineOnly && !meterDwellPending && (risingEdge || transientPulse);
            this.meterTriggerRuntime.set(runtimeKey, {
              recentMin: acceptedFire ? currentNum : recentMin,
              lastFireAt: acceptedFire ? now : lastFireAt,
              firstHotAt,
              lastValue: currentNum,
              lastPacketAt: now,
              staleAfterMs,
              target: targetNum,
            });
          }
        }

        if (macroStateKey) {
          this.lastTriggerStates.set(macroStateKey, meterDwellPending ? false : shouldTrigger);
        }

        if (baselineOnly) {
          if (shouldTrigger) {
            console.log(`[MacroEngine] Baseline established for "${macro.name}" at ${address}; trigger suppressed until a new edge.`);
          }
          continue;
        }

        if (meterDwellPending) {
          continue;
        }

        if (
          (triggerEdgeMode === 'on' && risingEdge) ||
          (triggerEdgeMode === 'off' && fallingEdge) ||
          (triggerEdgeMode === 'on_off' && (risingEdge || fallingEdge)) ||
          ((triggerEdgeMode === 'on' || triggerEdgeMode === 'on_off') && transientPulse)
        ) {
          // Maillot Channel 3 meter payloads (tokens 0xa7 request / 0xa8 response) are decoded upstream
          // as 1/256 dB; FAST mode only changes macro edge detection and does not rescale meter values.
          console.log(`[MacroEngine] Console Trigger detected for "${macro.name}" (${triggerEdgeMode})! Executing...`);
          this.executeMacro(macro, { source: 'trigger' });
        }
    }
  }

  stopAllExecutions(reason = 'safety stop') {
    this.executionGeneration += 1;
    this.activeExecutionTimers.forEach((timer) => {
      clearTimeout(timer);
      clearInterval(timer);
    });
    const stoppedCount = this.activeExecutionTimers.size;
    this.activeExecutionTimers.clear();
    let abortedCount = 0;
    this.activeMacroRuns.forEach((runtime) => {
      const affected = runtime.runs.size + runtime.queue.length;
      abortedCount += affected;
      runtime.runs.forEach((context) => {
        context.cancelled = true;
        context.timers.clear();
      });
      runtime.runs.clear();
      runtime.queue = [];
      runtime.aborted = Number(runtime.aborted || 0) + affected;
      if (affected > 0) runtime.lastAbortReason = reason;
    });
    if (stoppedCount > 0 || abortedCount > 0) {
      console.warn(`[MacroEngine] Aborted ${abortedCount} run(s) and stopped ${stoppedCount} timer(s): ${reason}.`);
    }
    this.notifyRuntimeListeners();
    return Math.max(stoppedCount, abortedCount);
  }

  getOrCreateMacroRuntime(macroKey) {
    if (!this.activeMacroRuns.has(macroKey)) {
      this.activeMacroRuns.set(macroKey, {
        runs: new Map(),
        queue: [],
        started: 0,
        completed: 0,
        dropped: 0,
        aborted: 0,
        failed: 0,
        restarted: 0,
        queued: 0,
        lastStartedAt: 0,
        lastDropReason: '',
        lastAbortReason: '',
        lastFailureReason: '',
      });
    }
    return this.activeMacroRuns.get(macroKey);
  }

  cancelMacroExecutionsByKey(macroKey, reason = 'macro cancelled') {
    const runtime = this.activeMacroRuns.get(macroKey);
    if (!runtime) return 0;
    let cancelled = 0;
    const affected = runtime.runs.size + runtime.queue.length;
    runtime.runs.forEach((context) => {
      context.cancelled = true;
      context.timers.forEach((timer) => {
        clearTimeout(timer);
        clearInterval(timer);
        this.activeExecutionTimers.delete(timer);
        cancelled += 1;
      });
      context.timers.clear();
    });
    runtime.runs.clear();
    runtime.queue = [];
    runtime.aborted = Number(runtime.aborted || 0) + affected;
    if (affected > 0) runtime.lastAbortReason = reason;
    if (cancelled > 0) {
      console.warn(`[MacroEngine] Cancelled ${cancelled} timer(s) for macro ${macroKey}: ${reason}.`);
    }
    this.notifyRuntimeListeners();
    return cancelled;
  }

  failMacroExecution(context, reason = 'command rejected') {
    if (!context || context.cancelled) return;
    context.cancelled = true;
    context.timers.forEach((timer) => {
      clearTimeout(timer);
      clearInterval(timer);
      this.activeExecutionTimers.delete(timer);
    });
    context.timers.clear();
    const runtime = this.activeMacroRuns.get(context.macroKey);
    if (runtime) {
      runtime.runs.delete(context.runId);
      runtime.failed = Number(runtime.failed || 0) + 1;
      runtime.lastFailureReason = reason;
      if (runtime.queue.length > 0) {
        runtime.aborted = Number(runtime.aborted || 0) + runtime.queue.length;
        runtime.lastAbortReason = reason;
        runtime.queue = [];
      }
    }
    console.error(`[MacroEngine] Run ${context.runId} failed: ${reason}.`);
    this.notifyRuntimeListeners();
  }

  maybeFinishExecution(context) {
    if (!context || context.cancelled || !context.sequenceDone || context.timers.size > 0) return;
    const runtime = this.activeMacroRuns.get(context.macroKey);
    if (!runtime) return;
    if (!runtime.runs.has(context.runId)) return;
    runtime.runs.delete(context.runId);
    runtime.completed += 1;
    if (runtime.queue.length > 0) {
      const next = runtime.queue.shift();
      console.log(`[MacroEngine] Starting queued macro "${next.macro.name}".`);
      this.startMacroRun(next.macro, next.policy, next.source || 'queued');
    }
    if (runtime.runs.size === 0 && runtime.queue.length === 0) {
      runtime.lastCompletedAt = Date.now();
    }
    this.notifyRuntimeListeners();
  }

  admitMacroExecution(macro, policy, source = 'trigger') {
    const macroKey = this.getMacroStateKey(macro);
    if (!macroKey) return { admitted: false, reason: 'missing macro key' };
    const runtime = this.getOrCreateMacroRuntime(macroKey);
    const now = Date.now();
    const cooldownMs = Math.max(0, Number(policy.cooldownMs) || 0);
    if (cooldownMs > 0 && runtime.lastStartedAt > 0 && (now - runtime.lastStartedAt) < cooldownMs) {
      runtime.dropped += 1;
      runtime.lastDropReason = 'cooldown';
      this.notifyRuntimeListeners();
      return { admitted: false, reason: `cooldown ${cooldownMs}ms` };
    }

    if (runtime.runs.size > 0) {
      if (policy.overlapStrategy === 'drop') {
        runtime.dropped += 1;
        runtime.lastDropReason = 'already running';
        this.notifyRuntimeListeners();
        return { admitted: false, reason: 'already running' };
      }
      if (policy.overlapStrategy === 'restart') {
        runtime.restarted += 1;
        this.cancelMacroExecutionsByKey(macroKey, 'restart overlap policy');
      } else if (policy.overlapStrategy === 'queue_one' || policy.overlapStrategy === 'queue_many') {
        const maxDepth = policy.overlapStrategy === 'queue_many'
          ? Math.max(1, Number(policy.maxQueueDepth) || DEFAULT_MACRO_MAX_QUEUE_DEPTH)
          : 1;
        if (runtime.queue.length >= maxDepth) {
          runtime.dropped += 1;
          runtime.lastDropReason = 'queue full';
          this.notifyRuntimeListeners();
          return { admitted: false, reason: 'queue full' };
        }
        runtime.queue.push({ macro, policy, source });
        runtime.queued += 1;
        this.notifyRuntimeListeners();
        return { admitted: false, queued: true, reason: 'queued' };
      }
    }

    return { admitted: true, context: this.startMacroRun(macro, policy, source) };
  }

  startMacroRun(macro, policy, source = 'trigger') {
    const macroKey = this.getMacroStateKey(macro);
    const runtime = this.getOrCreateMacroRuntime(macroKey);
    const runId = `${macroKey}:${this.nextExecutionId++}`;
    const context = {
      macroKey,
      runId,
      generation: this.executionGeneration,
      source,
      policy,
      timers: new Set(),
      sequenceDone: false,
      cancelled: false,
      startedAt: Date.now(),
    };
    runtime.runs.set(runId, context);
    runtime.started += 1;
    runtime.lastStartedAt = context.startedAt;
    console.log(`[MacroEngine] Starting macro "${macro.name}" run ${runId} (${source}, overlap=${policy.overlapStrategy}).`);
    this.runActions(macro.actions, 0, context.generation, context);
    this.notifyRuntimeListeners();
    return context;
  }

  scheduleExecution(callback, delayMs, generation, context = null) {
    const timer = setTimeout(() => {
      this.activeExecutionTimers.delete(timer);
      if (context) context.timers.delete(timer);
      if (generation !== this.executionGeneration) return;
      if (context?.cancelled) return;
      callback();
      this.maybeFinishExecution(context);
    }, Math.max(0, Number(delayMs) || 0));
    this.activeExecutionTimers.add(timer);
    if (context) context.timers.add(timer);
    return timer;
  }

  executeFade(address, endVal, durationMs, generation = this.executionGeneration, context = null, intervalMs = undefined) {
    return this.executeAutomationCue(address, {
      endVal,
      durationMs,
      curve: 'legacy',
      intervalMs,
    }, generation, context);
  }

  executeAutomationCue(address, cue = {}, generation = this.executionGeneration, context = null) {
    const isFaderFade = isFaderLikeAddress(address);
    const durationMs = Math.max(10, Number(cue.durationMs) || 1000);
    const minimumIntervalMs = Math.max(10, Math.min(2000, Number(cue.intervalMs) || (isFaderFade ? 20 : 33)));
    const totalSteps = Math.max(1, Math.floor(durationMs / minimumIntervalMs));
    const intervalMs = durationMs / totalSteps;
    let currentStep = 0;
    
    const currentState = typeof OscManager.getFreshState === 'function'
      ? OscManager.getFreshState(address, 10000)
      : OscManager.getState(address);
    const requestedStartMode = cue.startMode === 'fixed' ? 'fixed' : 'current';
    const hasExplicitStart = cue.startVal !== undefined
      && cue.startVal !== null
      && Number.isFinite(Number(cue.startVal));
    if (requestedStartMode === 'current' && !currentState && !hasExplicitStart) {
      console.warn(`[Automation Cue] Fresh start value unavailable for ${address}.`);
      if (context) this.failMacroExecution(context, `fresh start value unavailable for ${address}`);
      return false;
    }
    let startVal = requestedStartMode === 'fixed'
      ? cue.startVal
      : (currentState ? currentState[0] : cue.startVal);
    
    if (address.includes('/flt/hcf') && startVal === 0) {
      startVal = 20000;
    }
    if (address.includes('/flt/lcf') && startVal === 0) {
      startVal = 20;
    }

    const startDomainValue = isFaderFade ? normalizeFaderDomainValue(startVal) : Number(startVal);
    const endDomainValue = isFaderFade ? normalizeFaderDomainValue(cue.endVal) : Number(cue.endVal);

    if (Number.isNaN(startDomainValue) || Number.isNaN(endDomainValue)) {
      console.warn(`[Automation Cue] Invalid ramp values for ${address}. start=${startVal} end=${cue.endVal}`);
      if (context) this.failMacroExecution(context, `invalid ramp values for ${address}`);
      return false;
    }

    console.log(
      `[Automation Cue] Ramping ${address} from ${startDomainValue}${isFaderFade ? ' dB' : ''} to ${endDomainValue}${isFaderFade ? ' dB' : ''} over ${durationMs}ms (${cue.curve || 'linear'})`
    );

    const timer = setInterval(() => {
      if (generation !== this.executionGeneration) {
        clearInterval(timer);
        this.activeExecutionTimers.delete(timer);
        if (context) {
          context.timers.delete(timer);
          this.maybeFinishExecution(context);
        }
        return;
      }
      if (context?.cancelled) {
        clearInterval(timer);
        this.activeExecutionTimers.delete(timer);
        context.timers.delete(timer);
        this.maybeFinishExecution(context);
        return;
      }
      currentStep++;
      const progress = Math.min(currentStep / totalSteps, 1);
      const curve = cue.curve === 'legacy'
        ? (isFaderFade ? 'smooth' : 'linear')
        : (cue.curve || 'linear');
      const easedProgress = easeProgress(progress, curve);
      const currentDomainValue = startDomainValue + ((endDomainValue - startDomainValue) * easedProgress);
      const currentValue = currentDomainValue;
      
      const queued = OscManager.sendToWing(address, [currentValue]);
      if (queued !== true) {
        clearInterval(timer);
        this.activeExecutionTimers.delete(timer);
        if (context) {
          context.timers.delete(timer);
          this.failMacroExecution(context, `send rejected for ${address}`);
        }
        return;
      }

      if (currentStep >= totalSteps) {
        clearInterval(timer);
        this.activeExecutionTimers.delete(timer);
        if (context) {
          context.timers.delete(timer);
          this.maybeFinishExecution(context);
        }
      }
    }, intervalMs);
    this.activeExecutionTimers.add(timer);
    if (context) context.timers.add(timer);
    return true;
  }

  executeMacro(macro, options = {}) {
    if (macro.enabled !== true) {
      console.log(`[MacroEngine] Cancelling: Macro "${macro.name}" is disabled.`);
      return false;
    }
    if (options.allowOffline !== true && (this.runtimeSuspended || !this.consoleOnline)) {
      const macroKey = this.getMacroStateKey(macro);
      if (macroKey) {
        const runtime = this.getOrCreateMacroRuntime(macroKey);
        runtime.dropped += 1;
        runtime.lastDropReason = this.runtimeSuspended ? 'runtime suspended' : 'console offline';
        this.notifyRuntimeListeners();
      }
      console.warn(`[MacroEngine] Macro "${macro.name}" blocked while runtime is unavailable.`);
      return false;
    }
    console.log(`[MacroEngine] Evaluating conditions for: ${macro.name}`);
    
    let conditionsMet = true;
    
    if (macro.conditions && macro.conditions.length > 0) {
      const logicalOp = macro.logicalOperator || 'AND';
      
      let results = [];
      for (let cond of macro.conditions) {
        const condAddresses = this.resolveAddresses(cond.target || cond.address);
        let condResults = [];
        
        for (let addr of condAddresses) {
          let isMet = true;
          const maxAgeMs = isMeterAddress(addr) ? 2000 : 10000;
          const currentState = typeof OscManager.getFreshState === 'function'
            ? OscManager.getFreshState(addr, maxAgeMs)
            : OscManager.getState(addr);
          
          if (!currentState) {
            console.warn(`[MacroEngine] Unknown state for ${addr}, assuming false.`);
            isMet = false;
          } else {
            const value = currentState.length >= 3 ? currentState[2] : currentState[0];
            const targetVal = cond.value;
            isMet = compareValues(addr, value, targetVal, cond.operator);
          }
          condResults.push(isMet);
        }
        
        const rowMet = condResults.length > 0 ? condResults.every(r => r === true) : false;
        results.push(rowMet);
      }

      if (logicalOp === 'AND') {
        conditionsMet = results.every(res => res === true);
      } else if (logicalOp === 'OR') {
        conditionsMet = results.some(res => res === true);
      }
    }

    if (!conditionsMet) {
      console.log(`[MacroEngine] Conditions NOT met for ${macro.name}. Cancelling.`);
      return false;
    }

    console.log(`[MacroEngine] Conditions met. Executing actions...`);
    const triggerAddresses = this.resolveAddresses(macro.triggerTarget || macro.triggerAddress);
    const isMeterTrigger = triggerAddresses.some((addr) => isMeterAddress(addr));
    const policy = normalizeExecutionPolicy(macro.executionPolicy, { isMeterTrigger });
    const admission = this.admitMacroExecution(macro, policy, options.source || 'manual');
    if (!admission.admitted && !admission.queued) {
      console.warn(`[MacroEngine] Macro "${macro.name}" skipped by execution policy: ${admission.reason}.`);
      return false;
    }
    if (admission.queued) {
      console.log(`[MacroEngine] Macro "${macro.name}" queued by execution policy.`);
    }
    return true;
  }

  runActions(actions, index = 0, generation = this.executionGeneration, context = null) {
    if (generation !== this.executionGeneration || context?.cancelled) return;
    if (!Array.isArray(actions) || index >= actions.length) {
      if (context) {
        context.sequenceDone = true;
        this.maybeFinishExecution(context);
      }
      return;
    }
    
    const action = actions[index];
    if (!action || typeof action !== 'object') {
      this.failMacroExecution(context, `invalid action at index ${index}`);
      return;
    }
    
    if (action.type === 'delay') {
      const delayMs = Number(action.ms);
      if (!Number.isFinite(delayMs) || delayMs < 1) {
        this.failMacroExecution(context, `invalid delay at index ${index}`);
        return;
      }
      this.scheduleExecution(() => {
        this.runActions(actions, index + 1, generation, context);
      }, delayMs, generation, context);
    } else if (action.type === 'osc') {
      const resolvedAddresses = this.resolveAddresses(action.target || action.address);
      const args = action.args || [action.valStr !== undefined ? (isNaN(Number(action.valStr)) ? action.valStr : Number(action.valStr)) : 0];
      if (resolvedAddresses.length === 0) {
        this.failMacroExecution(context, 'OSC action resolved no valid address');
        return;
      }
      if (resolvedAddresses.length > MAX_DISCRETE_ACTION_TARGETS) {
        this.failMacroExecution(context, `OSC action exceeds ${MAX_DISCRETE_ACTION_TARGETS} targets`);
        return;
      }
      const allQueued = resolvedAddresses.every((addr) => OscManager.sendToWing(addr, args) === true);
      if (!allQueued) {
        this.failMacroExecution(context, 'OSC action send rejected');
        return;
      }
      
      // 10ms breath for network stack to avoid UDP packet saturation in live setups
      this.scheduleExecution(() => {
        this.runActions(actions, index + 1, generation, context);
      }, 10, generation, context);
    } else if (action.type === 'fade') {
      const resolvedAddresses = this.resolveAddresses(action.target);
      if (resolvedAddresses.length === 0) {
        this.failMacroExecution(context, 'fade action resolved no valid address');
        return;
      }
      if (resolvedAddresses.length > MAX_RAMP_ACTION_TARGETS) {
        this.failMacroExecution(context, `fade action exceeds ${MAX_RAMP_ACTION_TARGETS} targets`);
        return;
      }
      const endVal = Number(action.endVal);
      const durationSeconds = Number(action.durationSec);
      if (!Number.isFinite(endVal) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        this.failMacroExecution(context, `invalid fade values at index ${index}`);
        return;
      }
      const durationMs = durationSeconds * 1000;
      const intervalMs = Math.max(33, Math.ceil((resolvedAddresses.length * 1000) / MAX_RAMP_COMMANDS_PER_SECOND));

      const allStarted = resolvedAddresses.every((addr) => (
        this.executeFade(addr, endVal, durationMs, generation, context, intervalMs) === true
      ));
      if (!allStarted || context?.cancelled) return;

      // 10ms breath
      this.scheduleExecution(() => {
        this.runActions(actions, index + 1, generation, context);
      }, 10, generation, context);
    } else if (action.type === 'automation_cue') {
      // Uses resolveAddresses() above; no new OSC path grammar is introduced here.
      // Existing target paths remain under the Maillot-aligned mapping section (for example /eq/{band}f).
      const resolvedAddresses = this.resolveAddresses(action.target);
      if (resolvedAddresses.length === 0) {
        this.failMacroExecution(context, 'automation cue resolved no valid address');
        return;
      }
      if (resolvedAddresses.length > MAX_RAMP_ACTION_TARGETS) {
        this.failMacroExecution(context, `automation cue exceeds ${MAX_RAMP_ACTION_TARGETS} targets`);
        return;
      }
      const explicitDurationMs = Number(action.durationMs);
      const durationSeconds = Number(action.durationSec);
      const durationMs = Number.isFinite(explicitDurationMs) && explicitDurationMs > 0
        ? explicitDurationMs
        : durationSeconds * 1000;
      if (!Number.isFinite(durationMs) || durationMs < 10) {
        this.failMacroExecution(context, `invalid automation cue duration at index ${index}`);
        return;
      }
      const intervalMs = Math.max(
        33,
        Number(action.intervalMs) || 0,
        Math.ceil((resolvedAddresses.length * 1000) / MAX_RAMP_COMMANDS_PER_SECOND),
      );
      const cue = {
        startMode: action.startMode === 'fixed' ? 'fixed' : 'current',
        startVal: action.startVal,
        endVal: action.endVal,
        durationMs,
        curve: action.curve || 'linear',
        intervalMs,
      };

      const allStarted = resolvedAddresses.every((addr) => (
        this.executeAutomationCue(addr, cue, generation, context) === true
      ));
      if (!allStarted || context?.cancelled) return;

      this.scheduleExecution(() => {
        this.runActions(actions, index + 1, generation, context);
      }, 10, generation, context);
    } else if (action.type === 'automization_control') {
      if (this.automationActionHandler) {
        try {
          this.automationActionHandler({
            automizationId: action.automizationId,
            mode: action.mode || 'toggle',
          });
        } catch (error) {
          console.error('[MacroEngine] Automation action handler failed.', error);
          this.failMacroExecution(context, 'automation action handler failed');
          return;
        }
      } else {
        console.warn('[MacroEngine] No automation action handler registered.');
        this.failMacroExecution(context, 'automation action handler unavailable');
        return;
      }
      this.scheduleExecution(() => {
        this.runActions(actions, index + 1, generation, context);
      }, 10, generation, context);
    } else {
      this.failMacroExecution(context, `unsupported action type: ${String(action?.type || 'missing')}`);
    }
  }
}

export default new MacroEngine();
