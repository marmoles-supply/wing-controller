import { Buffer } from 'buffer';
import OSC from 'osc-js';
import WingUdpHub from './WingUdpHub';
import ConsoleProbe from './ConsoleProbe';
import WingConsoleDriver from './drivers/WingConsoleDriver';
import X32ConsoleDriver from './drivers/X32ConsoleDriver';
import UnsupportedConsoleDriver from './drivers/UnsupportedConsoleDriver';
import { detectConsoleIdentity, getConsoleCapabilities, isWingConsoleFamily } from './consoleIdentity';

class WingSession {
  constructor(options = {}) {
    this.WING_OSC_PORT = 2223;
    this.WING_NATIVE_PORT = 2222;
    this.WING_DISCOVERY_PORT = 2222;
    this.X32_OSC_PORT = 10023;
    this.LOCAL_MS_BRIDGE_PORT = 10024;

    this.sessionId = options.sessionId || `wing_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    this.enableNativeMeters = options.enableNativeMeters !== false;
    this.maxMeterRequestValueBudget = Number(options.maxMeterRequestValueBudget || 256);
    this.maxVisualMeterRequestValueBudget = Math.max(
      0,
      Math.min(
        this.maxMeterRequestValueBudget,
        Number(options.maxVisualMeterRequestValueBudget || 96),
      ),
    );
    this.maxStateCacheEntries = Math.max(256, Number(options.maxStateCacheEntries || 4096));
    this.maxControlCommandsPerSecond = Math.max(50, Number(options.maxControlCommandsPerSecond || 300));
    this.controlCommandBurst = Math.max(16, Number(options.controlCommandBurst || 128));
    this.controlCommandTokens = this.controlCommandBurst;
    this.lastControlTokenRefillAt = Date.now();

    this.wingIp = options.ip || '192.168.1.10';
    this.wingPort = Number(options.port || this.WING_OSC_PORT);
    this.wingOnline = false;
    this.lastWingPingTime = 0;
    this.nativeListenPort = 0;
    this.connected = false;
    this.handshakeStarted = false;
    this.routeWasConfigured = false;
    this.connectionGeneration = 0;
    this.commandStats = {
      admitted: 0,
      rejected: 0,
      rateLimited: 0,
      lastAddress: null,
      lastResult: null,
      lastReason: null,
      lastAt: 0,
    };

    this.stateCache = new Map();
    this.stateUpdatedAt = new Map();
    this.listeners = new Map();
    this.selectedChannel = null;

    this.debugLog = [];
    this.watchedAddressScopes = new Map();
    this.activeMeterRequest = null;
    this.activeMeterRequestLimited = false;
    this.activeMeterValueCount = 0;
    this.activeVisualMeterValueCount = 0;
    this.watchedMeterAddressSet = new Set();
    this.activeMeterAddressSet = new Set();
    this.droppedMeterAddresses = [];
    this.meterSpecPriorityMap = new Map();
    this.meterAddressPriorityMap = new Map();
    this.meterVisualPublishIntervalMs = Math.max(16, Number(options.meterVisualPublishIntervalMs || 33));
    this.pendingVisualMeterEvents = new Map();
    this.visualMeterPublishTimer = null;
    this.lastVisualMeterPublishAt = 0;
    this.lastMeterLimitLogAt = 0;
    this.meterReportId = 1;
    this.nativeBinaryReady = false;
    this.nativeConnectInFlight = false;
    this.nativeReconnectTimer = null;
    this.nativeReconnectAttempt = 0;
    this.nativeReconnectDelaysMs = [500, 1000, 2000, 4000, 8000];
    this.lastBinaryRxLogAt = 0;
    this.lastOscRxLogAt = 0;
    this.lastStateDebugLogAt = 0;
    this.lastSourceMeterRxAt = 0;
    this.lastSourceMeterWatchAt = 0;
    this.lastMeterRxAt = 0;
    this.lastMeterRenewAt = 0;
    this.prevMeterRenewAt = 0;
    this.meterRenewJitterMs = 0;
    this.watchedStateRefreshIntervalMs = Math.max(10, Number(options.watchedStateRefreshIntervalMs || 20));
    this.maxWatchedStateRefreshPerCycle = Math.max(16, Number(options.maxWatchedStateRefreshPerCycle || 128));
    this.watchedStateRefreshTimer = null;
    this.watchedStateRefreshQueue = [];
    this.watchedStateRefreshCursor = 0;
    this.watchedStateRefreshTotalAddressCount = 0;
    this.resetNetworkTrafficStats();
    this.sourceDeviceIndexMode = 'zero_based';
    this.sourceIndexModeFallbackApplied = false;
    this.subscriptionMode = 'disconnected';
    this.consoleFamily = 'unknown';
    this.consoleModel = null;
    this.consoleDisplayName = null;
    this.consoleSupportLevel = 'unknown';
    this.consoleBrand = null;
    this.consoleCapabilities = getConsoleCapabilities('unknown');
    this.consoleModelSource = null;
    this.consoleConfigRaw = null;
    this.discoveryModelRaw = null;
    this.lastConsoleReplyPort = null;
    this.selectedStrip = this.createUnresolvedSelectedStrip(null);
    this.keepAliveInterval = null;
    this.consoleProbe = new ConsoleProbe(this, {
      wingOscPort: this.WING_OSC_PORT,
      wingDiscoveryPort: this.WING_DISCOVERY_PORT,
      x32OscPort: this.X32_OSC_PORT,
    });
    this.wingDriver = new WingConsoleDriver(this, this.consoleProbe);
    this.x32Driver = new X32ConsoleDriver(this, this.consoleProbe);
    this.unsupportedDriver = new UnsupportedConsoleDriver(this, this.consoleProbe);

    this.sourceDeviceIds = {
      local: 1,
      aux: 2,
      stagea: 3,
      stageb: 4,
      stagec: 5,
      stageconnect: 6,
      usb: 7,
      card: 8,
      module: 9,
      usbplayer: 10,
      aesebu: 11,
      usersig: 12,
      oscillator: 13,
      bus: 14,
      main: 15,
      matrix: 16,
    };
    this.outputDeviceIds = {
      local: 1,
      aux: 2,
      stagea: 3,
      stageb: 4,
      stagec: 5,
      stageconnect: 6,
      usb: 7,
      card: 8,
      module: 9,
      usbrec: 10,
      aesebu: 11,
    };
  }

  normalizeSourceDeviceKey(deviceKey) {
    const raw = String(deviceKey || '').trim().toLowerCase();
    const aliasMap = {
      aes50a: 'stagea',
      aes50b: 'stageb',
      aes50c: 'stagec',
      a: 'stagea',
      b: 'stageb',
      c: 'stagec',
      card: 'card',
      crd: 'card',
      wlive: 'card',
      expansion: 'card',
      module: 'module',
      mod: 'module',
      play: 'usbplayer',
      usbplay: 'usbplayer',
      usbplayer: 'usbplayer',
      rec: 'usbrec',
      mtx: 'matrix',
      matrix: 'matrix',
      osc: 'oscillator',
      oscillator: 'oscillator',
    };
    return aliasMap[raw] || raw;
  }

  createUnresolvedSelectedStrip(raw = null) {
    return { raw, valid: false, family: null, index: null, address: null };
  }

  resolveSelectedStrip(selidx) {
    const stripId = Number(selidx);
    if (!Number.isFinite(stripId)) {
      return this.createUnresolvedSelectedStrip(selidx);
    }
    if (stripId >= 1 && stripId <= 40) return { raw: stripId, valid: true, family: 'ch', index: stripId, address: `/ch/${stripId}` };
    if (stripId >= 41 && stripId <= 48) return { raw: stripId, valid: true, family: 'aux', index: stripId - 40, address: `/aux/${stripId - 40}` };
    if (stripId >= 49 && stripId <= 64) return { raw: stripId, valid: true, family: 'bus', index: stripId - 48, address: `/bus/${stripId - 48}` };
    if (stripId >= 65 && stripId <= 68) return { raw: stripId, valid: true, family: 'main', index: stripId - 64, address: `/main/${stripId - 64}` };
    if (stripId >= 69 && stripId <= 76) return { raw: stripId, valid: true, family: 'matrix', index: stripId - 68, address: `/matrix/${stripId - 68}` };
    return this.createUnresolvedSelectedStrip(stripId);
  }

  getSelectedStripContext() {
    return this.selectedStrip || this.resolveSelectedStrip(1);
  }

  on(address, callback) {
    if (!this.listeners.has(address)) {
      this.listeners.set(address, []);
    }
    this.listeners.get(address).push(callback);
    return () => this.off(address, callback);
  }

  off(address, callback) {
    if (!this.listeners.has(address)) return;
    const current = this.listeners.get(address).filter((cb) => cb !== callback);
    if (current.length === 0) {
      this.listeners.delete(address);
      return;
    }
    this.listeners.set(address, current);
  }

  notifyListeners(address, args) {
    if (this.listeners.has(address)) {
      [...this.listeners.get(address)].forEach((cb) => {
        try {
          cb(args);
        } catch (error) {
          console.error(`[WingSession] Listener failed for ${address}.`, error);
        }
      });
    }
  }

  connect(ip, port = this.WING_OSC_PORT) {
    const nextIp = String(ip || '').trim();
    if (!nextIp) return;

    if (this.connected) {
      this.disconnect();
    }

    this.clearNativeReconnectTimer();
    this.connectionGeneration += 1;

    this.wingIp = nextIp;
    this.wingPort = Number(port || this.WING_OSC_PORT);
    this.wingOnline = false;
    this.lastWingPingTime = 0;
    this.lastSourceMeterRxAt = 0;
    this.lastSourceMeterWatchAt = 0;
    this.lastMeterRxAt = 0;
    this.lastMeterRenewAt = 0;
    this.prevMeterRenewAt = 0;
    this.meterRenewJitterMs = 0;
    this.sourceDeviceIndexMode = 'zero_based';
    this.sourceIndexModeFallbackApplied = false;
    this.subscriptionMode = 'probe_only_unknown_family';
    this.consoleFamily = 'unknown';
    this.consoleModel = null;
    this.consoleDisplayName = null;
    this.consoleSupportLevel = 'unknown';
    this.consoleBrand = null;
    this.consoleCapabilities = getConsoleCapabilities('unknown');
    this.consoleModelSource = null;
    this.consoleConfigRaw = null;
    this.discoveryModelRaw = null;
    this.lastConsoleReplyPort = null;
    this.selectedStrip = this.createUnresolvedSelectedStrip(null);
    this.selectedChannel = null;
    this.stateCache = new Map();
    this.stateUpdatedAt = new Map();
    this.debugLog = [];
    this.nativeBinaryReady = false;
    this.nativeConnectInFlight = false;
    this.nativeReconnectAttempt = 0;
    this.activeMeterRequest = null;
    this.activeMeterRequestLimited = false;
    this.activeMeterValueCount = 0;
    this.activeVisualMeterValueCount = 0;
    this.handshakeStarted = false;
    this.connected = true;
    this.routeWasConfigured = true;
    this.commandStats = {
      admitted: 0,
      rejected: 0,
      rateLimited: 0,
      lastAddress: null,
      lastResult: null,
      lastReason: null,
      lastAt: 0,
    };
    this.controlCommandTokens = this.controlCommandBurst;
    this.lastControlTokenRefillAt = Date.now();
    this.cancelWatchedStateRefresh();
    this.resetNetworkTrafficStats();

    WingUdpHub.registerSession(this);
  }

  configureRoute(ip, port = this.WING_OSC_PORT) {
    if (this.connected) return false;
    const nextIp = String(ip || '').trim();
    const nextPort = Number(port || this.WING_OSC_PORT);
    if (!nextIp || !Number.isInteger(nextPort) || nextPort <= 0) return false;
    this.wingIp = nextIp;
    this.wingPort = nextPort;
    this.routeWasConfigured = true;
    this.notifyListeners('route_configured', this.getRuntimeStatus());
    return true;
  }

  disconnect() {
    const wasConnected = this.connected;
    this.clearNativeReconnectTimer();
    this.cancelWatchedStateRefresh();
    this.connectionGeneration += 1;
    this.connected = false;
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    if (this.enableNativeMeters) {
      WingUdpHub.closeNative(this);
    }

    if (wasConnected) {
      WingUdpHub.unregisterSession(this);
    }

    this.handshakeStarted = false;
    this.nativeBinaryReady = false;
    this.nativeConnectInFlight = false;
    this.nativeReconnectAttempt = 0;
    this.activeMeterRequest = null;
    this.activeMeterRequestLimited = false;
    this.activeMeterValueCount = 0;
    this.activeVisualMeterValueCount = 0;
    this.watchedMeterAddressSet.clear();
    this.activeMeterAddressSet.clear();
    this.droppedMeterAddresses = [];
    this.meterSpecPriorityMap.clear();
    this.meterAddressPriorityMap.clear();
    this.cancelVisualMeterPublish();
    this.lastMeterRxAt = 0;
    this.lastMeterRenewAt = 0;
    this.prevMeterRenewAt = 0;
    this.meterRenewJitterMs = 0;
    this.stateCache.clear();
    this.stateUpdatedAt.clear();
    this.subscriptionMode = 'disconnected';
    this.wingOnline = false;
    this.notifyListeners('wing_online_status', false);
  }

  handleHubBound(port) {
    this.nativeListenPort = Number(port || 0);
    if (!this.connected || this.handshakeStarted) return;
    this.handshakeStarted = true;
    console.log(`[OSC] UDP hub ready on port ${this.nativeListenPort} for ${this.wingIp}:${this.wingPort}`);
    this.startWingHandshake();
  }

  handleNativeSocketConnected(event = {}) {
    const requestId = Number(event?.requestId || 0);
    if (!this.connected || !this.isWingConsole()) return;
    if (requestId > 0 && requestId !== this.connectionGeneration) return;
    if (event?.ip && String(event.ip) !== String(this.wingIp)) return;
    this.clearNativeReconnectTimer();
    this.nativeConnectInFlight = false;
    this.nativeReconnectAttempt = 0;
    this.getActiveDriver().handleNativeSocketConnected();
  }

  handleNativeTransportError(event = {}) {
    const requestId = Number(event?.requestId || 0);
    if (!this.connected || !this.isWingConsole()) return;
    if (requestId > 0 && requestId !== this.connectionGeneration) return;
    this.nativeBinaryReady = false;
    this.nativeConnectInFlight = false;
    this.activeMeterRequest = null;
    this.activeMeterValueCount = 0;
    this.activeVisualMeterValueCount = 0;
    this.activeMeterAddressSet.clear();
    this.droppedMeterAddresses = Array.from(this.watchedMeterAddressSet);
    this.cancelVisualMeterPublish();
    this.lastMeterRxAt = 0;
    this.lastMeterRenewAt = 0;
    this.prevMeterRenewAt = 0;
    this.meterRenewJitterMs = 0;
    this.notifyListeners('meter_request_coverage', {
      activeAddresses: [],
      droppedAddresses: [...this.droppedMeterAddresses],
      limited: this.droppedMeterAddresses.length > 0,
    });
    this.subscriptionMode = 'native_meter_recovering';
    this.scheduleNativeReconnect(String(event?.type || 'native transport error'));
  }

  handleUdpPacket(buffer, _sourceIp = null, sourcePort = 0) {
    if (!buffer) return;
    this.parseIncomingMessage(buffer, 'wing', sourcePort);
  }

  setWatchedAddresses(addresses, scope = 'default') {
    const normalized = Array.from(new Set(
      (addresses || []).filter((addr) => typeof addr === 'string' && addr.length > 0),
    ));
    const previous = this.watchedAddressScopes.get(scope) || [];
    if (previous.length === normalized.length && previous.every((address, index) => address === normalized[index])) {
      return;
    }
    this.watchedAddressScopes.set(scope, normalized);
    this.cancelWatchedStateRefresh();
    this.getActiveDriver().handleWatchedAddressesChanged();
  }

  getEffectiveMeterAddresses() {
    const mergedAddresses = Array.from(this.watchedAddressScopes.values()).flat();
    const explicitMeterAddresses = mergedAddresses.filter((addr) => typeof addr === 'string' && addr.startsWith('/meters/'));
    // Maillot Channel 3 reports are requested explicitly. With no consumer,
    // omit the report instead of keeping an invisible fallback meter alive.
    return explicitMeterAddresses;
  }

  getMeterScopePriority(scope) {
    const normalized = String(scope || '').toLowerCase();
    if (normalized === 'engine') return 0;
    if (normalized === 'automization') return 1;
    if (normalized === 'meters_workspace') return 2;
    if (normalized === 'ui_preview') return 3;
    if (normalized.includes('selector') || normalized.includes('target')) return 4;
    return 5;
  }

  getMeterSpecKey(spec) {
    if (!spec) return '';
    if (spec.family === 'source' || spec.family === 'output') {
      return `${spec.family}:${spec.deviceKey}:${spec.index}`;
    }
    return `${spec.family}:${spec.index}`;
  }

  buildMeterSpecPriorityMap() {
    const priorities = new Map();
    this.watchedAddressScopes.forEach((addresses, scope) => {
      const priority = this.getMeterScopePriority(scope);
      (addresses || []).forEach((address) => {
        const specKey = this.getMeterSpecKey(this.parseMeterAddress(address));
        if (!specKey) return;
        const previous = priorities.get(specKey);
        if (previous === undefined || priority < previous) priorities.set(specKey, priority);
      });
    });
    return priorities;
  }

  buildMeterAddressPriorityMap() {
    const priorities = new Map();
    this.watchedAddressScopes.forEach((addresses, scope) => {
      const priority = this.getMeterScopePriority(scope);
      (addresses || []).forEach((address) => {
        if (typeof address !== 'string' || !address.startsWith('/meters/')) return;
        const previous = priorities.get(address);
        if (previous === undefined || priority < previous) priorities.set(address, priority);
      });
    });
    return priorities;
  }

  getMeterAddressPriority(address) {
    return this.meterAddressPriorityMap.get(address) ?? 99;
  }

  isRuntimeCriticalMeterAddress(address) {
    return this.getMeterAddressPriority(address) <= 1;
  }

  getMeterDescriptorPriority(family, indices, deviceKey = null) {
    const indexPriorities = {};
    (indices || []).forEach((index) => {
      const specKey = deviceKey
        ? `${family}:${deviceKey}:${index}`
        : `${family}:${index}`;
      indexPriorities[index] = this.meterSpecPriorityMap.get(specKey) ?? 99;
    });
    const priorityValues = Object.values(indexPriorities);
    return {
      indexPriorities,
      priority: priorityValues.length > 0 ? Math.min(...priorityValues) : 99,
    };
  }

  subscribeToMeters(watchedAddresses) {
    if (!this.enableNativeMeters || !watchedAddresses || !this.isWingConsole()) return;
    this.watchedMeterAddressSet = new Set(
      watchedAddresses.filter((address) => typeof address === 'string' && address.startsWith('/meters/')),
    );
    this.meterSpecPriorityMap = this.buildMeterSpecPriorityMap();
    this.meterAddressPriorityMap = this.buildMeterAddressPriorityMap();

    const grouped = {
      ch: new Set(),
      aux: new Set(),
      bus: new Set(),
      main: new Set(),
      matrix: new Set(),
      dca: new Set(),
      fx: new Set(),
      chv2: new Set(),
      auxv2: new Set(),
      busv2: new Set(),
      mainv2: new Set(),
      matrixv2: new Set(),
      monitor: new Set(),
      rta: new Set(),
      source: new Map(),
      output: new Map(),
    };

    watchedAddresses.forEach((addr) => {
      const spec = this.parseMeterAddress(addr);
      if (!spec) return;

      if (spec.family === 'source') {
        if (!grouped.source.has(spec.deviceKey)) {
          grouped.source.set(spec.deviceKey, new Set());
        }
        grouped.source.get(spec.deviceKey).add(spec.index);
        return;
      }

      if (spec.family === 'output') {
        if (!grouped.output.has(spec.deviceKey)) {
          grouped.output.set(spec.deviceKey, new Set());
        }
        grouped.output.get(spec.deviceKey).add(spec.index);
        return;
      }

      if (grouped[spec.family] instanceof Set) {
        grouped[spec.family].add(spec.index);
      }
    });

    const requestDescriptors = [];
    [
      ['ch', 0xa0],
      ['aux', 0xa1],
      ['bus', 0xa2],
      ['main', 0xa3],
      ['matrix', 0xa4],
      ['dca', 0xa5],
      ['fx', 0xa6],
      ['chv2', 0xab],
      ['auxv2', 0xac],
      ['busv2', 0xad],
      ['mainv2', 0xae],
      ['matrixv2', 0xaf],
    ].forEach(([family, token]) => {
      const indices = Array.from(grouped[family]).sort((a, b) => a - b);
      if (indices.length > 0) {
        requestDescriptors.push({
          family,
          token,
          indices,
          encodedIndices: indices.map((index) => Math.max(0, index - 1)),
          ...this.getMeterDescriptorPriority(family, indices),
        });
      }
    });

    if (grouped.monitor.size > 0) {
      const monitorIndices = Array.from(grouped.monitor).sort((a, b) => a - b);
      requestDescriptors.push({
        family: 'monitor',
        token: 0xa9,
        indices: monitorIndices.length > 0 ? monitorIndices : [1, 2, 3, 4, 5, 6],
        encodedIndices: [],
        tokenNoIndex: true,
        ...this.getMeterDescriptorPriority('monitor', monitorIndices.length > 0 ? monitorIndices : [1, 2, 3, 4, 5, 6]),
      });
    }

    if (grouped.rta.size > 0) {
      requestDescriptors.push({
        family: 'rta',
        token: 0xaa,
        indices: Array.from({ length: 120 }, (_, i) => i + 1),
        encodedIndices: [],
        tokenNoIndex: true,
        ...this.getMeterDescriptorPriority('rta', Array.from(grouped.rta)),
      });
    }

    Array.from(grouped.source.entries())
      .sort(([a], [b]) => (this.sourceDeviceIds[a] || 999) - (this.sourceDeviceIds[b] || 999))
      .forEach(([deviceKey, indexSet]) => {
        const normalizedDeviceKey = this.normalizeSourceDeviceKey(deviceKey);
        const deviceId = this.sourceDeviceIds[normalizedDeviceKey];
        const indices = Array.from(indexSet).sort((a, b) => a - b);
        if (!deviceId || indices.length === 0) return;
        requestDescriptors.push({
          family: 'source',
          token: 0xa7,
          deviceId,
          deviceKey: normalizedDeviceKey,
          indices,
          encodedIndices: indices.map((index) => Math.max(0, index - 1)),
          ...this.getMeterDescriptorPriority('source', indices, normalizedDeviceKey),
        });
      });

    Array.from(grouped.output.entries())
      .sort(([a], [b]) => (this.outputDeviceIds[a] || 999) - (this.outputDeviceIds[b] || 999))
      .forEach(([deviceKey, indexSet]) => {
        const deviceId = this.outputDeviceIds[deviceKey];
        const indices = Array.from(indexSet).sort((a, b) => a - b);
        if (!deviceId || indices.length === 0) return;
        requestDescriptors.push({
          family: 'output',
          token: 0xa8,
          deviceId,
          deviceKey,
          indices,
          encodedIndices: indices.map((index) => Math.max(0, index - 1)),
          ...this.getMeterDescriptorPriority('output', indices, deviceKey),
        });
      });

    if (requestDescriptors.length === 0) {
      this.activeMeterRequest = null;
      this.activeMeterRequestLimited = false;
      this.activeMeterValueCount = 0;
      this.activeVisualMeterValueCount = 0;
      this.updateMeterRequestCoverage([]);
      this.cancelVisualMeterPublish();
      return;
    }

    const constrainedRequestDescriptors = this.constrainMeterRequestDescriptors(requestDescriptors);
    if (constrainedRequestDescriptors.length === 0) {
      this.activeMeterRequest = null;
      this.activeMeterValueCount = 0;
      this.activeVisualMeterValueCount = 0;
      this.updateMeterRequestCoverage([]);
      this.cancelVisualMeterPublish();
      return;
    }

    const payload = [];
    payload.push(0xd3, (this.nativeListenPort >> 8) & 0xff, this.nativeListenPort & 0xff);
    payload.push(
      0xd4,
      (this.meterReportId >> 24) & 0xff,
      (this.meterReportId >> 16) & 0xff,
      (this.meterReportId >> 8) & 0xff,
      this.meterReportId & 0xff,
    );
    payload.push(0xdc);

    let sourceTokenAdded = false;
    let outputTokenAdded = false;
    constrainedRequestDescriptors.forEach((descriptor) => {
      if (descriptor.family === 'source') {
        if (!sourceTokenAdded) {
          payload.push(0xa7);
          sourceTokenAdded = true;
        }
        payload.push(this.encodeSourceDeviceId(descriptor.deviceId));
        return;
      }

      if (descriptor.family === 'output') {
        if (!outputTokenAdded) {
          payload.push(0xa8);
          outputTokenAdded = true;
        }
        payload.push(this.encodeSourceDeviceId(descriptor.deviceId));
        return;
      }

      if (descriptor.tokenNoIndex) {
        payload.push(descriptor.token);
        return;
      }

      payload.push(descriptor.token);
      descriptor.encodedIndices.forEach((index) => payload.push(index));
    });

    payload.push(0xde);
    const sent = this.sendNativeMeterPayload(payload);
    if (!sent) {
      this.activeMeterRequest = null;
      this.activeMeterValueCount = 0;
      this.activeVisualMeterValueCount = 0;
      this.updateMeterRequestCoverage([]);
      this.cancelVisualMeterPublish();
      return;
    }

    this.activeMeterRequest = constrainedRequestDescriptors;
    this.updateMeterRequestCoverage(constrainedRequestDescriptors);
    if (constrainedRequestDescriptors.some((descriptor) => descriptor.family === 'source')) {
      this.lastSourceMeterWatchAt = Date.now();
    }
  }

  estimateMeterDescriptorValueCount(descriptor) {
    if (!descriptor) return 0;
    if (descriptor.family === 'source') {
      return this.getSourceMeterCount(descriptor.deviceKey) || Math.max(1, descriptor.indices?.length || 1);
    }
    if (descriptor.family === 'output') {
      return this.getOutputMeterCount(descriptor.deviceKey) || Math.max(1, descriptor.indices?.length || 1);
    }
    if (descriptor.family === 'monitor') return 6;
    if (descriptor.family === 'rta') return 120;
    return (descriptor.indices?.length || 0) * this.getMeterValueCount(descriptor.family);
  }

  updateMeterRequestCoverage(descriptors) {
    const isCovered = (address) => {
      const spec = this.parseMeterAddress(address);
      if (!spec) return false;
      return descriptors.some((descriptor) => {
        if (descriptor.family !== spec.family) return false;
        if (
          (spec.family === 'source' || spec.family === 'output')
          && descriptor.deviceKey !== spec.deviceKey
        ) return false;
        return descriptor.tokenNoIndex || descriptor.indices.includes(spec.index);
      });
    };
    this.activeMeterAddressSet = new Set(
      Array.from(this.watchedMeterAddressSet).filter((address) => isCovered(address)),
    );
    this.droppedMeterAddresses = Array.from(this.watchedMeterAddressSet)
      .filter((address) => !this.activeMeterAddressSet.has(address));
    this.notifyListeners('meter_request_coverage', {
      activeAddresses: Array.from(this.activeMeterAddressSet),
      droppedAddresses: [...this.droppedMeterAddresses],
      limited: this.activeMeterRequestLimited,
    });
  }

  constrainMeterRequestDescriptors(requestDescriptors) {
    const budget = Math.max(1, Number(this.maxMeterRequestValueBudget) || 256);
    const visualBudget = Math.max(
      0,
      Math.min(budget, Number(this.maxVisualMeterRequestValueBudget) || 0),
    );
    const totalRequested = requestDescriptors.reduce(
      (sum, descriptor) => sum + this.estimateMeterDescriptorValueCount(descriptor),
      0,
    );

    const budgetUnits = [];
    requestDescriptors.forEach((descriptor, descriptorIndex) => {
      const isWholeDescriptor = descriptor.family === 'source'
        || descriptor.family === 'output'
        || descriptor.tokenNoIndex;
      if (isWholeDescriptor) {
        budgetUnits.push({
          descriptorIndex,
          index: null,
          cost: this.estimateMeterDescriptorValueCount(descriptor),
          priority: Number(descriptor.priority ?? 99),
        });
        return;
      }
      const cost = this.getMeterValueCount(descriptor.family);
      descriptor.indices.forEach((index) => {
        budgetUnits.push({
          descriptorIndex,
          index,
          cost,
          priority: Number(descriptor.indexPriorities?.[index] ?? descriptor.priority ?? 99),
        });
      });
    });
    budgetUnits.sort((left, right) => (
      left.priority - right.priority
      || left.descriptorIndex - right.descriptorIndex
      || Number(left.index || 0) - Number(right.index || 0)
    ));
    const totalVisualRequested = budgetUnits.reduce(
      (sum, unit) => sum + (unit.priority >= 2 ? unit.cost : 0),
      0,
    );
    if (totalRequested <= budget && totalVisualRequested <= visualBudget) {
      this.activeMeterRequestLimited = false;
      this.activeMeterValueCount = totalRequested;
      this.activeVisualMeterValueCount = totalVisualRequested;
      return requestDescriptors;
    }

    const selectedByDescriptor = new Map();
    let usedBudget = 0;
    let usedVisualBudget = 0;
    budgetUnits.forEach((unit) => {
      const isVisual = unit.priority >= 2;
      if (usedBudget + unit.cost > budget) return;
      if (isVisual && usedVisualBudget + unit.cost > visualBudget) return;
      if (!selectedByDescriptor.has(unit.descriptorIndex)) {
        selectedByDescriptor.set(unit.descriptorIndex, new Set());
      }
      selectedByDescriptor.get(unit.descriptorIndex).add(unit.index);
      usedBudget += unit.cost;
      if (isVisual) usedVisualBudget += unit.cost;
    });

    // Preserve Maillot Channel 3 token/value ordering after priority allocation.
    const constrained = requestDescriptors.flatMap((descriptor, descriptorIndex) => {
      const selected = selectedByDescriptor.get(descriptorIndex);
      if (!selected) return [];
      if (selected.has(null)) return [descriptor];
      const indices = descriptor.indices.filter((index) => selected.has(index));
      if (indices.length === 0) return [];
      return [{
        ...descriptor,
        indices,
        encodedIndices: indices.map((index) => Math.max(0, index - 1)),
      }];
    });

    this.activeMeterRequestLimited = true;
    this.activeMeterValueCount = usedBudget;
    this.activeVisualMeterValueCount = usedVisualBudget;

    const now = Date.now();
    if (now - this.lastMeterLimitLogAt > 4000) {
      this.lastMeterLimitLogAt = now;
      // Maillot Channel 3 metering uses ordered request tokens (`0xa0..0xaf`,
      // including source/output `0xa7`/`0xa8`) followed by equally ordered
      // values. Keep that order intact and only trim the request volume.
      this.notifyListeners(
        'diagnostic_log',
        `[Meters Safety] Requested ${totalRequested} meter values; capped to ${usedBudget} total / ${usedVisualBudget} visual.`,
      );
      console.warn(`[Meters Safety] Requested ${totalRequested} meter values; capped to ${usedBudget} total / ${usedVisualBudget} visual.`);
    }

    return constrained;
  }

  renewMeters() {
    if (!this.enableNativeMeters || !this.activeMeterRequest || this.activeMeterRequest.length === 0 || !this.isWingConsole()) return;
    this.prevMeterRenewAt = this.lastMeterRenewAt;
    this.lastMeterRenewAt = Date.now();
    if (this.prevMeterRenewAt > 0) {
      this.meterRenewJitterMs = this.lastMeterRenewAt - this.prevMeterRenewAt;
    }
    const payload = [
      0xd4,
      (this.meterReportId >> 24) & 0xff,
      (this.meterReportId >> 16) & 0xff,
      (this.meterReportId >> 8) & 0xff,
      this.meterReportId & 0xff,
    ];
    this.sendNativeMeterPayload(payload);
  }

  sendNativeMeterPayload(payload) {
    if (!this.enableNativeMeters || !WingUdpHub.WingOscModule || !this.nativeListenPort || !this.nativeBinaryReady || !this.isWingConsole()) return false;

    const frame = [0xdf, 0xd3, ...payload];
    const binary = typeof Buffer !== 'undefined' ? Buffer.from(frame) : new Uint8Array(frame);
    const queued = WingUdpHub.sendNative(this, binary.toString('base64'));
    if (!queued) {
      this.handleNativeTransportError({
        type: 'tcp_send_queue',
        requestId: this.connectionGeneration,
      });
      return false;
    }
    this.recordNetworkTraffic('tx', binary.length);
    console.log(`[Meters Tx] -> WING native TCP (${this.wingIp}:${this.WING_NATIVE_PORT}) | req=${this.meterReportId} | len=${frame.length} | hex=${Buffer.from(frame).toString('hex')}`);
    this.notifyListeners('diagnostic_log', `[Meters Tx] req=${this.meterReportId} bytes=${frame.length}`);
    return true;
  }

  parseMeterAddress(address) {
    if (typeof address !== 'string' || !address.startsWith('/meters/')) return null;
    const parts = address.split('/').filter(Boolean);
    if (parts.length < 3) return null;

    const family = parts[1];
    const index = parseInt(parts[2] || parts[3], 10);

    if (['ch', 'aux', 'bus', 'main', 'matrix', 'dca', 'fx', 'chv2', 'auxv2', 'busv2', 'mainv2', 'matrixv2', 'rta'].includes(family) && !Number.isNaN(index)) {
      return { family, index };
    }

    if (family === 'monitor') {
      const monitorIndexByLabel = {
        solo_l: 1,
        solo_r: 2,
        mon1_l: 3,
        mon1_r: 4,
        mon2_l: 5,
        mon2_r: 6,
      };
      const raw = String(parts[2] || '').toLowerCase();
      const mappedIndex = monitorIndexByLabel[raw] || parseInt(parts[2], 10);
      if (!Number.isNaN(mappedIndex)) {
        return { family: 'monitor', index: mappedIndex };
      }
    }

    if (family === 'preamp' && parts.length >= 4) {
      const deviceKey = this.normalizeSourceDeviceKey(parts[2]);
      const sourceIndex = parseInt(parts[3], 10);
      if (this.sourceDeviceIds[deviceKey] && !Number.isNaN(sourceIndex)) {
        return { family: 'source', deviceKey, index: sourceIndex };
      }
    }

    if (family === 'usb' && !Number.isNaN(index)) {
      return { family: 'source', deviceKey: 'usb', index };
    }

    if (family === 'usersig' && !Number.isNaN(index)) {
      return { family: 'source', deviceKey: 'usersig', index };
    }

    if (family === 'output' && parts.length >= 4) {
      const deviceKey = parts[2];
      const outputIndex = parseInt(parts[3], 10);
      if (this.outputDeviceIds[deviceKey] && !Number.isNaN(outputIndex)) {
        return { family: 'output', deviceKey, index: outputIndex };
      }
    }

    return null;
  }

  encodeSourceDeviceId(deviceId) {
    if (this.sourceDeviceIndexMode === 'zero_based') {
      return Math.max(0, deviceId - 1);
    }
    return deviceId;
  }

  applyDetectedConsolePort(port, reason = 'probe') {
    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort <= 0 || this.wingPort === numericPort) return;
    // Maillot: WING's OSC control server replies on UDP 2223 ("OSC Remote Protocol",
    // p19-20). Port 2222 is the separate discovery / native-metering responder, so
    // the WING discovery reply (WING?) legitimately comes FROM 2222 — but adopting
    // that as the control route sends all OSC control AND the /*S~ subscription to a
    // port the OSC server does not listen on, silently breaking send/receive.
    // Never route OSC control to the discovery/native port; keep it on 2223.
    if (numericPort === this.WING_DISCOVERY_PORT || numericPort === this.WING_NATIVE_PORT) {
      this.lastConsoleReplyPort = numericPort;
      return;
    }
    this.wingPort = numericPort;
    this.notifyListeners('diagnostic_log', `[Probe] Adopted console port ${numericPort} via ${reason}`);
  }

  isWingConsole() {
    return isWingConsoleFamily(this.consoleFamily);
  }

  getActiveDriver() {
    if (this.consoleFamily === 'x32-family') {
      return this.x32Driver;
    }
    if (this.consoleFamily === 'unknown') {
      return this.unsupportedDriver;
    }
    if (!this.isWingConsole()) {
      return this.unsupportedDriver;
    }
    return this.wingDriver;
  }

  startKeepAliveLoop() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
    this.keepAliveInterval = setInterval(() => {
      this.getActiveDriver().runKeepAliveTick();
    }, 4000);
  }

  clearNativeReconnectTimer() {
    if (!this.nativeReconnectTimer) return;
    clearTimeout(this.nativeReconnectTimer);
    this.nativeReconnectTimer = null;
  }

  scheduleNativeReconnect(reason = 'native transport unavailable') {
    if (
      this.nativeReconnectTimer
      || !this.connected
      || !this.enableNativeMeters
      || !this.isWingConsole()
      || this.nativeBinaryReady
    ) return;

    const attemptIndex = Math.min(this.nativeReconnectAttempt, this.nativeReconnectDelaysMs.length - 1);
    const delayMs = this.nativeReconnectDelaysMs[attemptIndex];
    const generation = this.connectionGeneration;
    this.nativeReconnectAttempt += 1;
    this.notifyListeners(
      'diagnostic_log',
      `[Meters Recovery] Retry ${this.nativeReconnectAttempt} in ${delayMs}ms (${reason}).`,
    );
    this.nativeReconnectTimer = setTimeout(() => {
      this.nativeReconnectTimer = null;
      if (generation !== this.connectionGeneration) return;
      this.ensureNativeTransportConnected();
    }, delayMs);
  }

  closeNativeTransport() {
    this.clearNativeReconnectTimer();
    this.nativeConnectInFlight = false;
    this.nativeBinaryReady = false;
    WingUdpHub.closeNative(this);
  }

  ensureNativeTransportConnected() {
    if (
      !this.connected
      || !this.enableNativeMeters
      || !this.isWingConsole()
      || this.nativeBinaryReady
      || this.nativeConnectInFlight
    ) return false;

    this.clearNativeReconnectTimer();
    this.nativeConnectInFlight = true;
    this.subscriptionMode = 'native_meter_connecting';
    const queued = WingUdpHub.connectNative(
      this,
      this.wingIp,
      this.WING_NATIVE_PORT,
      this.connectionGeneration,
    );
    if (!queued) {
      this.nativeConnectInFlight = false;
      this.subscriptionMode = 'native_meter_recovering';
      this.scheduleNativeReconnect('connect request rejected');
    }
    return queued;
  }

  markConsoleOnline() {
    this.lastWingPingTime = Date.now();
    if (this.wingOnline) return;
    this.wingOnline = true;
    this.notifyListeners('wing_online_status', true);
    if (this.isWingConsole() && !this.nativeBinaryReady) {
      this.ensureNativeTransportConnected();
    }
  }

  markConsoleOffline(reason = 'console timeout') {
    if (!this.connected || !this.wingOnline) return;
    this.cancelWatchedStateRefresh();
    this.wingOnline = false;
    this.connectionGeneration += 1;
    this.stateCache.clear();
    this.stateUpdatedAt.clear();
    this.notifyListeners('wing_online_status', false);
    this.notifyListeners('diagnostic_log', `[Connection] Offline: ${reason}. Cached state invalidated.`);

    if (this.enableNativeMeters && this.isWingConsole()) {
      this.nativeBinaryReady = false;
      this.nativeConnectInFlight = false;
      this.activeMeterRequest = null;
      this.activeMeterValueCount = 0;
      this.activeVisualMeterValueCount = 0;
      this.activeMeterAddressSet.clear();
      this.droppedMeterAddresses = [];
      this.cancelVisualMeterPublish();
      this.lastMeterRxAt = 0;
      this.lastMeterRenewAt = 0;
      this.prevMeterRenewAt = 0;
      this.meterRenewJitterMs = 0;
      this.notifyListeners('meter_request_coverage', {
        activeAddresses: [],
        droppedAddresses: [],
        limited: false,
      });
      this.subscriptionMode = 'native_meter_recovering';
      WingUdpHub.closeNative(this);
      this.scheduleNativeReconnect(reason);
    }
  }

  applyConsoleModelCandidate(rawModel, source = 'unknown', metadata = {}) {
    const identity = detectConsoleIdentity(rawModel, {
      source,
      sourcePort: metadata?.sourcePort,
      address: metadata?.address,
    });
    if (!identity) return;

    const familyChanged = this.consoleFamily !== identity.family;
    const modelChanged = this.consoleModel !== identity.model;
    const sourceChanged = this.consoleModelSource !== source;

    this.consoleFamily = identity.family;
    this.consoleModel = identity.model;
    this.consoleDisplayName = identity.displayName || identity.model;
    this.consoleSupportLevel = identity.supportLevel;
    this.consoleBrand = identity.brand || null;
    this.consoleCapabilities = identity.capabilities || getConsoleCapabilities(identity.family);
    this.consoleModelSource = source;

    if (Number.isInteger(identity.sourcePort) && identity.sourcePort > 0) {
      this.lastConsoleReplyPort = identity.sourcePort;
      this.applyDetectedConsolePort(identity.sourcePort, source);
    }

    this.getActiveDriver().handleIdentityApplied(identity);
    if (familyChanged) {
      this.getActiveDriver().startHandshake();
    }

    if (familyChanged || modelChanged || sourceChanged) {
      console.log(`[OSC] Console identity detected: ${identity.displayName} (family=${identity.family}, source=${source}, raw=${rawModel})`);
      const supportTag = identity.supportLevel === 'full'
        ? 'supported'
        : identity.supportLevel === 'partial'
          ? 'partial'
          : (identity.supportLevel === 'unsupported' ? 'unsupported' : 'unknown');
      this.notifyListeners('diagnostic_log', `[Model] ${identity.displayName} via ${source} (${supportTag})`);
      this.notifyListeners('console_identity', this.getRuntimeStatus());
    }
  }

  resetNetworkTrafficStats() {
    this.networkTraffic = {
      sampleStartedAt: Date.now(),
      window: {
        meterRxFrames: 0,
        meterRxBytes: 0,
        controlRxPackets: 0,
        controlRxBytes: 0,
        txPackets: 0,
        txBytes: 0,
      },
      rates: {
        meterRxFramesPerSecond: 0,
        meterRxBytesPerSecond: 0,
        controlRxPacketsPerSecond: 0,
        controlRxBytesPerSecond: 0,
        txPacketsPerSecond: 0,
        txBytesPerSecond: 0,
      },
      totals: {
        meterRxFrames: 0,
        meterRxBytes: 0,
        controlRxPackets: 0,
        controlRxBytes: 0,
        txPackets: 0,
        txBytes: 0,
      },
    };
  }

  refreshNetworkTrafficRates(now = Date.now()) {
    if (!this.networkTraffic) this.resetNetworkTrafficStats();
    const elapsedMs = Math.max(1, now - this.networkTraffic.sampleStartedAt);
    if (elapsedMs < 1000) return;
    const scale = 1000 / elapsedMs;
    const { window } = this.networkTraffic;
    this.networkTraffic.rates = {
      meterRxFramesPerSecond: Number((window.meterRxFrames * scale).toFixed(1)),
      meterRxBytesPerSecond: Math.round(window.meterRxBytes * scale),
      controlRxPacketsPerSecond: Number((window.controlRxPackets * scale).toFixed(1)),
      controlRxBytesPerSecond: Math.round(window.controlRxBytes * scale),
      txPacketsPerSecond: Number((window.txPackets * scale).toFixed(1)),
      txBytesPerSecond: Math.round(window.txBytes * scale),
    };
    Object.keys(window).forEach((key) => {
      window[key] = 0;
    });
    this.networkTraffic.sampleStartedAt = now;
  }

  recordNetworkTraffic(kind, byteLength) {
    if (!this.networkTraffic) this.resetNetworkTrafficStats();
    const bytes = Math.max(0, Number(byteLength) || 0);
    if (kind === 'meter_rx') {
      this.networkTraffic.window.meterRxFrames += 1;
      this.networkTraffic.window.meterRxBytes += bytes;
      this.networkTraffic.totals.meterRxFrames += 1;
      this.networkTraffic.totals.meterRxBytes += bytes;
    } else if (kind === 'control_rx') {
      this.networkTraffic.window.controlRxPackets += 1;
      this.networkTraffic.window.controlRxBytes += bytes;
      this.networkTraffic.totals.controlRxPackets += 1;
      this.networkTraffic.totals.controlRxBytes += bytes;
    } else if (kind === 'tx') {
      this.networkTraffic.window.txPackets += 1;
      this.networkTraffic.window.txBytes += bytes;
      this.networkTraffic.totals.txPackets += 1;
      this.networkTraffic.totals.txBytes += bytes;
    }
    this.refreshNetworkTrafficRates();
  }

  sendOscMessageToPort(port, address, args = []) {
    try {
      const message = new OSC.Message(address, ...args);
      const binary = message.pack();
      const buffer = typeof Buffer !== 'undefined' ? Buffer.from(binary) : binary;
      const queued = WingUdpHub.send(this.wingIp, port, buffer.toString('base64'));
      if (!queued) {
        this.notifyListeners('diagnostic_log', `[Tx Rejected] ${address} -> ${port}`);
        return false;
      }
      this.recordNetworkTraffic('tx', buffer.length);
      this.notifyListeners('diagnostic_log', `[Tx] -> ${port} : ${address}`);
      return true;
    } catch (error) {
      console.error(`[OSC] Error packing message for ${address} on port ${port}:`, error);
      this.notifyListeners('diagnostic_log', `[Tx Error] ${address} -> ${port} : ${error.message}`);
      return false;
    }
  }

  sendRawBytesToPort(port, raw, diagnosticLabel = null) {
    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort <= 0) return false;
    try {
      const buffer = typeof Buffer !== 'undefined' ? Buffer.from(raw) : raw;
      const queued = WingUdpHub.send(this.wingIp, numericPort, buffer.toString('base64'));
      if (!queued) {
        this.notifyListeners('diagnostic_log', `[Tx Rejected] raw -> ${numericPort}`);
        return false;
      }
      this.recordNetworkTraffic('tx', buffer.length);
      if (diagnosticLabel) {
        this.notifyListeners('diagnostic_log', diagnosticLabel);
      }
      return true;
    } catch (error) {
      console.error(`[OSC] Error sending raw payload to ${numericPort}:`, error);
      this.notifyListeners('diagnostic_log', `[Tx Error] raw -> ${numericPort} : ${error.message}`);
      return false;
    }
  }

  sendConsoleIdentityProbes() {
    this.consoleProbe.sendIdentityProbes();
  }

  startWingHandshake() {
    this.getActiveDriver().startHandshake();
  }

  sendRawSubscription(path) {
    return this.getActiveDriver().sendRawSubscription(path);
  }

  parseIncomingMessage(buffer, source, sourcePort = 0) {
    if (source === 'wing') {
      const asciiPreview = this.sanitizeAsciiPreview(buffer, 48);
      const isDiscoveryReply = asciiPreview.startsWith('WING,');
      const looksOscPacket = buffer.length > 0 && buffer[0] === 0x2f;

      if (isDiscoveryReply) {
        this.recordNetworkTraffic('control_rx', buffer.length);
        const discoveryRaw = buffer.toString('ascii').replace(/\0/g, '').trim();
        console.log(`[OSC Rx] Discovery reply: ${asciiPreview}`);
        this.notifyListeners('diagnostic_log', `[Rx DISC] ${asciiPreview}`);
        const fields = discoveryRaw.split(',');
        if (fields.length >= 4) {
          this.discoveryModelRaw = fields[3];
          this.applyConsoleModelCandidate(fields[3], 'discovery', { sourcePort });
        }
        this.markConsoleOnline();
        return;
      }

      if (looksOscPacket) {
        this.recordNetworkTraffic('control_rx', buffer.length);
        const now = Date.now();
        if (now - this.lastOscRxLogAt > 500) {
          this.lastOscRxLogAt = now;
          this.notifyListeners('diagnostic_log', `[Rx OSC] len=${buffer.length} ${asciiPreview}`);
        }
      } else {
        const now = Date.now();
        if (now - this.lastBinaryRxLogAt > 1500) {
          this.lastBinaryRxLogAt = now;
          const hexPreview = buffer.toString('hex', 0, Math.min(8, buffer.length));
          this.notifyListeners('diagnostic_log', `[Rx BIN] len=${buffer.length} hex=${hexPreview}`);
        }
      }
    }

    try {
      if (source === 'wing') {
        this.markConsoleOnline();
      }

      const decodedManually = source === 'wing' ? this.manualOscUnpack(buffer) : null;
      if (decodedManually && decodedManually.args) {
        const address = decodedManually.address;
        const args = decodedManually.args;

        if (source === 'wing') {
          if (Number.isInteger(Number(sourcePort)) && Number(sourcePort) > 0) {
            this.lastConsoleReplyPort = Number(sourcePort);
          }

          if (address === '/$ctl/$stat/selidx' && args.length > 0) {
            const val = parseInt(args[0], 10);
            this.selectedStrip = this.resolveSelectedStrip(val);
            this.selectedChannel = this.selectedStrip.valid ? this.selectedStrip.address : null;
            if (this.isWingConsole()) {
              this.subscribeToMeters(this.getEffectiveMeterAddresses());
            }
          }

          if (address === '/$syscfg/$cnscfg' && args.length > 0) {
            this.consoleConfigRaw = String(args[0] || '');
            this.applyConsoleModelCandidate(args[0], '$cnscfg', { sourcePort, address });
          }

          if (address === '/$syscfg/$cnsmdl' && args.length > 0) {
            this.applyConsoleModelCandidate(args[0], '$cnsmdl', { sourcePort, address });
          }

          if ((address === '/xinfo' || address === '/info') && args.length > 0) {
            this.applyConsoleModelCandidate(args, address.slice(1), { sourcePort, address });
          }

          const transformed = this.getActiveDriver().transformIncomingState
            ? this.getActiveDriver().transformIncomingState(address, args)
            : { address, args };
          const stateAddress = transformed?.address || address;
          const stateArgs = Array.isArray(transformed?.args) ? transformed.args : args;

          this.storeState(stateAddress, stateArgs, 'console');
          this.notifyListeners(stateAddress, stateArgs);
          this.notifyListeners('wing_state', { address: stateAddress, args: stateArgs });

          const now = Date.now();
          if (now - this.lastStateDebugLogAt > 100) {
            this.lastStateDebugLogAt = now;
            const logStr = `${stateAddress} ${stateArgs.length > 0 ? '=' : ''} ${stateArgs.join(', ')}`;
            this.debugLog.unshift(logStr);
            if (this.debugLog.length > 10) this.debugLog.pop();
            this.notifyListeners('wing_debug_log', this.debugLog);
          }
        }
      } else if (source === 'wing' && this.enableNativeMeters) {
        this.decodeMeterBlob(buffer);
      }
    } catch (error) {
      console.log('[PARSE ERROR]', error.message);
    }
  }

  sanitizeAsciiPreview(buffer, maxLen = 48) {
    try {
      const preview = buffer.toString('latin1', 0, Math.min(buffer.length, maxLen));
      return preview.replace(/[^\x20-\x7E]/g, '.').trim();
    } catch (_err) {
      return '';
    }
  }

  manualOscUnpack(buffer) {
    try {
      let offset = 0;
      while (offset < buffer.length && buffer[offset] !== 0) offset++;
      if (offset >= buffer.length) return null;
      const address = buffer.toString('utf8', 0, offset);
      offset = (offset + 4) & ~3;
      if (offset >= buffer.length) return null;
      if (buffer[offset] !== 0x2c) return null;
      let typeEnd = offset;
      while (typeEnd < buffer.length && buffer[typeEnd] !== 0) typeEnd++;
      const typeStr = buffer.toString('utf8', offset + 1, typeEnd);
      offset = (typeEnd + 4) & ~3;
      const args = [];
      const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      for (let i = 0; i < typeStr.length; i += 1) {
        const type = typeStr[i];
        if (offset + 4 > buffer.length && type !== 's') break;
        if (type === 'f') {
          args.push(dv.getFloat32(offset, false));
          offset += 4;
        } else if (type === 'i') {
          args.push(dv.getInt32(offset, false));
          offset += 4;
        } else if (type === 's') {
          let end = offset;
          while (end < buffer.length && buffer[end] !== 0) end++;
          args.push(buffer.toString('utf8', offset, end));
          offset = (end + 4) & ~3;
        }
      }
      return { address, args };
    } catch (err) {
      console.log('[MANUAL UNPACK ERROR]', err.message);
      return null;
    }
  }

  decodeMeterBlob(buffer) {
    try {
      if (!buffer || buffer.length < 4) return;

      const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      let id = 0;
      try {
        id = dv.getUint32(0, false);
      } catch {}

      if (id === this.meterReportId && this.activeMeterRequest) {
        this.recordNetworkTraffic('meter_rx', buffer.length);
        this.lastMeterRxAt = Date.now();
        let offset = 4;
        this.activeMeterRequest.forEach((descriptor, descriptorIndex) => {
          const valueCount = this.getMeterValueCount(descriptor.family);
          const decodeIndices = descriptor.family === 'source'
            ? this.resolveSourceDecodeIndices(descriptor, descriptorIndex, offset, buffer.length)
            : descriptor.family === 'output'
              ? this.resolveOutputDecodeIndices(descriptor, descriptorIndex, offset, buffer.length)
              : descriptor.indices;

          decodeIndices.forEach((index) => {
            if (offset + valueCount * 2 > buffer.length) {
              return;
            }

            const values = [];
            for (let i = 0; i < valueCount; i += 1) {
              values.push(dv.getInt16(offset, false));
              offset += 2;
            }

            this.publishDecodedMeter(descriptor, index, values);
          });

          if ((descriptor.family === 'source' || descriptor.family === 'output') && decodeIndices.length > 0) {
            this.lastSourceMeterRxAt = Date.now();
          }
        });
      }
    } catch (error) {
      console.log('[METER DECODE ERROR]', error.message);
    }
  }

  getDescriptorWordCountMinimum(descriptor) {
    if (!descriptor) return 0;
    if (descriptor.family === 'source' || descriptor.family === 'output') {
      return Math.max(1, Array.isArray(descriptor.indices) ? descriptor.indices.length : 1);
    }
    if (descriptor.family === 'monitor' || descriptor.family === 'rta') {
      return Array.isArray(descriptor.indices) ? descriptor.indices.length : 0;
    }
    const count = Array.isArray(descriptor.indices) ? descriptor.indices.length : 0;
    return count * this.getMeterValueCount(descriptor.family);
  }

  resolveSourceDecodeIndices(descriptor, descriptorIndex, offset, packetLength) {
    const requested = (descriptor?.indices || []).filter((value) => Number.isFinite(value) && value > 0);
    const requestedFallback = requested.length > 0 ? requested : [1];
    const fullCount = this.getSourceMeterCount(descriptor?.deviceKey);
    const wordsRemaining = Math.max(0, Math.floor((packetLength - offset) / 2));
    const minWordsForRest = this.activeMeterRequest
      .slice(descriptorIndex + 1)
      .reduce((sum, nextDescriptor) => sum + this.getDescriptorWordCountMinimum(nextDescriptor), 0);
    const wordsForCurrent = Math.max(0, wordsRemaining - minWordsForRest);
    const isLastDescriptor = descriptorIndex === this.activeMeterRequest.length - 1;

    if (fullCount > 0 && wordsForCurrent >= fullCount) {
      return Array.from({ length: fullCount }, (_, i) => i + 1);
    }
    if (isLastDescriptor && wordsForCurrent > requestedFallback.length) {
      return Array.from({ length: wordsForCurrent }, (_, i) => i + 1);
    }

    const indexedCount = Math.min(wordsForCurrent, requestedFallback.length);
    if (indexedCount > 0) {
      return requestedFallback.slice(0, indexedCount);
    }

    if (wordsForCurrent > 0) {
      const fallbackCount = fullCount > 0 ? Math.min(fullCount, wordsForCurrent) : wordsForCurrent;
      return Array.from({ length: fallbackCount }, (_, i) => i + 1);
    }

    return [];
  }

  resolveOutputDecodeIndices(descriptor, descriptorIndex, offset, packetLength) {
    const requested = (descriptor?.indices || []).filter((value) => Number.isFinite(value) && value > 0);
    const requestedFallback = requested.length > 0 ? requested : [1];
    const fullCount = this.getOutputMeterCount(descriptor?.deviceKey);
    const wordsRemaining = Math.max(0, Math.floor((packetLength - offset) / 2));
    const minWordsForRest = this.activeMeterRequest
      .slice(descriptorIndex + 1)
      .reduce((sum, nextDescriptor) => sum + this.getDescriptorWordCountMinimum(nextDescriptor), 0);
    const wordsForCurrent = Math.max(0, wordsRemaining - minWordsForRest);
    const isLastDescriptor = descriptorIndex === this.activeMeterRequest.length - 1;

    if (fullCount > 0 && wordsForCurrent >= fullCount) {
      return Array.from({ length: fullCount }, (_, i) => i + 1);
    }
    if (isLastDescriptor && wordsForCurrent > requestedFallback.length) {
      return Array.from({ length: wordsForCurrent }, (_, i) => i + 1);
    }

    const indexedCount = Math.min(wordsForCurrent, requestedFallback.length);
    if (indexedCount > 0) {
      return requestedFallback.slice(0, indexedCount);
    }

    if (wordsForCurrent > 0) {
      const fallbackCount = fullCount > 0 ? Math.min(fullCount, wordsForCurrent) : wordsForCurrent;
      return Array.from({ length: fallbackCount }, (_, i) => i + 1);
    }

    return [];
  }

  getMeterValueCount(family) {
    if (['ch', 'aux', 'bus', 'main', 'matrix'].includes(family)) return 8;
    if (['chv2', 'auxv2', 'busv2', 'mainv2', 'matrixv2'].includes(family)) return 11;
    if (family === 'dca') return 4;
    if (family === 'fx') return 10;
    return 1;
  }

  normalizeMeterValue(rawValue, family, slotIndex) {
    if (family === 'fx') {
      if (slotIndex < 4) {
        return Number(((rawValue * 6.0) / 2048.0).toFixed(2));
      }
      return rawValue;
    }
    return Number((rawValue / 256.0).toFixed(2));
  }

  storeState(address, args, source = 'console') {
    const observedAt = Date.now();
    if (!this.stateCache.has(address) && this.stateCache.size >= this.maxStateCacheEntries) {
      const oldestAddress = this.stateCache.keys().next().value;
      if (oldestAddress !== undefined) {
        this.stateCache.delete(oldestAddress);
        this.stateUpdatedAt.delete(oldestAddress);
      }
    }
    this.stateCache.set(address, args);
    this.stateUpdatedAt.set(address, {
      observedAt,
      source,
      generation: this.connectionGeneration,
    });
  }

  cancelVisualMeterPublish() {
    if (this.visualMeterPublishTimer) {
      clearTimeout(this.visualMeterPublishTimer);
      this.visualMeterPublishTimer = null;
    }
    this.pendingVisualMeterEvents.clear();
  }

  setMeterVisualPublishIntervalMs(intervalMs) {
    const nextInterval = Math.max(16, Math.min(250, Number(intervalMs) || 33));
    if (this.meterVisualPublishIntervalMs === nextInterval) return;
    this.meterVisualPublishIntervalMs = nextInterval;
    if (this.visualMeterPublishTimer) {
      clearTimeout(this.visualMeterPublishTimer);
      this.visualMeterPublishTimer = setTimeout(() => this.flushVisualMeterEvents(), nextInterval);
    }
  }

  flushVisualMeterEvents() {
    this.visualMeterPublishTimer = null;
    this.lastVisualMeterPublishAt = Date.now();
    const events = Array.from(this.pendingVisualMeterEvents.values());
    this.pendingVisualMeterEvents.clear();
    events.forEach((event) => {
      if (!this.watchedMeterAddressSet.has(event.address)) return;
      if (this.isRuntimeCriticalMeterAddress(event.address)) return;
      this.notifyListeners(event.address, event.args);
      this.notifyListeners('wing_state', event);
    });
  }

  queueVisualMeterEvent(address, args) {
    this.pendingVisualMeterEvents.set(address, { address, args });
    if (this.visualMeterPublishTimer) return;

    const now = Date.now();
    const elapsedMs = now - this.lastVisualMeterPublishAt;
    const delayMs = Math.max(0, this.meterVisualPublishIntervalMs - elapsedMs);
    this.visualMeterPublishTimer = setTimeout(() => this.flushVisualMeterEvents(), delayMs);
  }

  publishMeterAddress(address, value) {
    // Maillot Channel 3 still consumes every requested value in 0xA7/0xA8 wire order
    // and keeps the documented 1/256 dB scale. JS fan-out is filtered and only
    // visual-only meters are coalesced; engine/automization triggers stay immediate.
    if (!this.watchedMeterAddressSet.has(address)) return;
    const args = [value];
    this.storeState(address, args, 'meter');
    if (this.isRuntimeCriticalMeterAddress(address)) {
      this.notifyListeners(address, args);
      this.notifyListeners('wing_state', { address, args });
      return;
    }
    this.queueVisualMeterEvent(address, args);
  }

  publishDecodedMeter(descriptor, index, rawValues) {
    if (descriptor.family === 'source') {
      const address = this.getSourceMeterAddress(descriptor.deviceKey, index);
      if (!address) return;
      const value = this.normalizeMeterValue(rawValues[0], 'source', 0);
      this.publishMeterAddress(address, value);
      return;
    }

    if (descriptor.family === 'output') {
      const address = this.getOutputMeterAddress(descriptor.deviceKey, index);
      if (!address) return;
      const value = this.normalizeMeterValue(rawValues[0], 'output', 0);
      this.publishMeterAddress(address, value);
      return;
    }

    if (descriptor.family === 'monitor') {
      const labelByIndex = {
        1: 'solo_l',
        2: 'solo_r',
        3: 'mon1_l',
        4: 'mon1_r',
        5: 'mon2_l',
        6: 'mon2_r',
      };
      const label = labelByIndex[index];
      if (!label) return;
      const value = this.normalizeMeterValue(rawValues[0], 'monitor', 0);
      this.publishMeterAddress(`/meters/monitor/${label}`, value);
      return;
    }

    if (descriptor.family === 'rta') {
      const value = this.normalizeMeterValue(rawValues[0], 'rta', 0);
      this.publishMeterAddress(`/meters/rta/${index}`, value);
      return;
    }

    const labelsByFamily = {
      ch: ['in_l', 'in_r', 'out_l', 'out_r', 'gate_key', 'gate_gain', 'dyn_key', 'dyn_gain'],
      aux: ['in_l', 'in_r', 'out_l', 'out_r', 'gate_key', 'gate_gain', 'dyn_key', 'dyn_gain'],
      bus: ['in_l', 'in_r', 'out_l', 'out_r', 'gate_key', 'gate_gain', 'dyn_key', 'dyn_gain'],
      main: ['in_l', 'in_r', 'out_l', 'out_r', 'gate_key', 'gate_gain', 'dyn_key', 'dyn_gain'],
      matrix: ['in_l', 'in_r', 'out_l', 'out_r', 'gate_key', 'gate_gain', 'dyn_key', 'dyn_gain'],
      chv2: ['in_l', 'in_r', 'out_l', 'out_r', 'gate_key', 'gate_gain', 'gate_led', 'dyn_key', 'dyn_gain', 'dyn_state', 'automix_gain'],
      auxv2: ['in_l', 'in_r', 'out_l', 'out_r', 'gate_key', 'gate_gain', 'gate_led', 'dyn_key', 'dyn_gain', 'dyn_state', 'automix_gain'],
      busv2: ['in_l', 'in_r', 'out_l', 'out_r', 'gate_key', 'gate_gain', 'gate_led', 'dyn_key', 'dyn_gain', 'dyn_state', 'automix_gain'],
      mainv2: ['in_l', 'in_r', 'out_l', 'out_r', 'gate_key', 'gate_gain', 'gate_led', 'dyn_key', 'dyn_gain', 'dyn_state', 'automix_gain'],
      matrixv2: ['in_l', 'in_r', 'out_l', 'out_r', 'gate_key', 'gate_gain', 'gate_led', 'dyn_key', 'dyn_gain', 'dyn_state', 'automix_gain'],
      dca: ['pre_l', 'pre_r', 'post_l', 'post_r'],
      fx: ['in_l', 'in_r', 'out_l', 'out_r', 'state_1', 'state_2', 'state_3', 'state_4', 'state_5', 'state_6'],
    };

    const labels = labelsByFamily[descriptor.family] || [];
    const baseAddress = `/meters/${descriptor.family}/${index}`;
    const normalizedValues = rawValues.map((rawValue, slotIndex) => this.normalizeMeterValue(rawValue, descriptor.family, slotIndex));

    normalizedValues.forEach((value, slotIndex) => {
      const label = labels[slotIndex];
      if (label) {
        this.publishMeterAddress(`${baseAddress}/${label}`, value);
      }
    });

    let summaryValue = normalizedValues[0];
    if (descriptor.family === 'fx') {
      summaryValue = Math.max(...normalizedValues.slice(0, 4));
    } else if (['ch', 'aux', 'bus', 'main', 'matrix', 'chv2', 'auxv2', 'busv2', 'mainv2', 'matrixv2'].includes(descriptor.family) && normalizedValues.length >= 2) {
      summaryValue = Math.max(...normalizedValues.slice(0, 2));
    } else if (descriptor.family === 'dca' && normalizedValues.length >= 2) {
      summaryValue = Math.max(...normalizedValues.slice(0, 2));
    } else if (normalizedValues.length > 1) {
      summaryValue = Math.max(...normalizedValues);
    }

    this.publishMeterAddress(baseAddress, summaryValue);
  }

  getSourceMeterAddress(deviceKey, index) {
    const baseByDevice = {
      local: '/meters/preamp/local',
      aux: '/meters/preamp/aux',
      aesebu: '/meters/preamp/aesebu',
      stagea: '/meters/preamp/stagea',
      stageb: '/meters/preamp/stageb',
      stagec: '/meters/preamp/stagec',
      stageconnect: '/meters/preamp/stageconnect',
      usb: '/meters/usb',
      card: '/meters/preamp/card',
      module: '/meters/preamp/module',
      usbplayer: '/meters/preamp/usbplayer',
      usersig: '/meters/usersig',
      oscillator: '/meters/preamp/oscillator',
      bus: '/meters/preamp/bus',
      main: '/meters/preamp/main',
      matrix: '/meters/preamp/matrix',
    };
    const normalizedKey = this.normalizeSourceDeviceKey(deviceKey);
    const base = baseByDevice[normalizedKey];
    return base ? `${base}/${index}` : null;
  }

  getSourceMeterCount(deviceKey) {
    const counts = {
      local: 24,
      aux: 8,
      aesebu: 2,
      stagea: 48,
      stageb: 48,
      stagec: 48,
      stageconnect: 32,
      usb: 48,
      card: 64,
      module: 64,
      usbplayer: 4,
      usersig: 48,
      oscillator: 2,
      bus: 32,
      main: 8,
      matrix: 16,
    };
    const normalizedKey = this.normalizeSourceDeviceKey(deviceKey);
    return counts[normalizedKey] || 0;
  }

  getOutputMeterAddress(deviceKey, index) {
    const baseByDevice = {
      local: '/meters/output/local',
      aux: '/meters/output/aux',
      aesebu: '/meters/output/aesebu',
      stagea: '/meters/output/stagea',
      stageb: '/meters/output/stageb',
      stagec: '/meters/output/stagec',
      stageconnect: '/meters/output/stageconnect',
      usb: '/meters/output/usb',
      card: '/meters/output/card',
      module: '/meters/output/module',
      usbrec: '/meters/output/usbrec',
    };
    const base = baseByDevice[deviceKey];
    return base ? `${base}/${index}` : null;
  }

  getOutputMeterCount(deviceKey) {
    const counts = {
      local: 8,
      aux: 8,
      aesebu: 2,
      stagea: 48,
      stageb: 48,
      stagec: 48,
      stageconnect: 32,
      usb: 48,
      card: 64,
      module: 64,
      usbrec: 4,
    };
    return counts[deviceKey] || 0;
  }

  cancelWatchedStateRefresh() {
    if (this.watchedStateRefreshTimer) {
      clearTimeout(this.watchedStateRefreshTimer);
      this.watchedStateRefreshTimer = null;
    }
    this.watchedStateRefreshQueue = [];
    this.watchedStateRefreshTotalAddressCount = 0;
  }

  scheduleWatchedStateRefresh(addresses) {
    if (!this.connected || !this.wingOnline) {
      this.cancelWatchedStateRefresh();
      return false;
    }
    if (this.watchedStateRefreshTimer || this.watchedStateRefreshQueue.length > 0) {
      return false;
    }

    const normalized = Array.from(new Set(
      (Array.isArray(addresses) ? addresses : [])
        .filter((address) => typeof address === 'string' && address.length > 0 && !address.startsWith('/meters/')),
    ));
    this.watchedStateRefreshTotalAddressCount = normalized.length;
    if (normalized.length === 0) {
      this.watchedStateRefreshCursor = 0;
      return false;
    }

    const cycleSize = Math.min(this.maxWatchedStateRefreshPerCycle, normalized.length);
    const startIndex = this.watchedStateRefreshCursor % normalized.length;
    this.watchedStateRefreshQueue = Array.from({ length: cycleSize }, (_, offset) => (
      normalized[(startIndex + offset) % normalized.length]
    ));
    this.watchedStateRefreshCursor = (startIndex + cycleSize) % normalized.length;
    const generation = this.connectionGeneration;

    const sendNext = () => {
      this.watchedStateRefreshTimer = null;
      if (!this.connected || !this.wingOnline || generation !== this.connectionGeneration) {
        this.cancelWatchedStateRefresh();
        return;
      }
      const address = this.watchedStateRefreshQueue.shift();
      if (!address) return;
      this.sendToWing(address);
      if (this.watchedStateRefreshQueue.length > 0) {
        this.watchedStateRefreshTimer = setTimeout(sendNext, this.watchedStateRefreshIntervalMs);
      }
    };

    sendNext();
    return true;
  }

  sendToWing(address, args = []) {
    if (!this.connected || !this.wingOnline) {
      this.notifyListeners('diagnostic_log', `[Tx blocked] ${address} (console offline)`);
      this.recordCommandResult(address, false, 'console_offline');
      return false;
    }
    if (!this.consumeControlCommandToken()) {
      this.notifyListeners('diagnostic_log', `[Tx blocked] ${address} (control rate limit)`);
      this.recordCommandResult(address, false, 'rate_limited');
      return false;
    }
    const admitted = this.getActiveDriver().sendControlMessage(address, args) === true;
    this.recordCommandResult(address, admitted, admitted ? 'queued' : 'transport_rejected');
    return admitted;
  }

  consumeControlCommandToken() {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - this.lastControlTokenRefillAt);
    this.lastControlTokenRefillAt = now;
    this.controlCommandTokens = Math.min(
      this.controlCommandBurst,
      this.controlCommandTokens + ((elapsedMs * this.maxControlCommandsPerSecond) / 1000),
    );
    if (this.controlCommandTokens < 1) return false;
    this.controlCommandTokens -= 1;
    return true;
  }

  recordCommandResult(address, admitted, reason = null) {
    const accepted = admitted === true;
    this.commandStats[accepted ? 'admitted' : 'rejected'] += 1;
    if (!accepted && reason === 'rate_limited') this.commandStats.rateLimited += 1;
    this.commandStats.lastAddress = String(address || '');
    this.commandStats.lastResult = accepted ? 'admitted' : 'rejected';
    this.commandStats.lastReason = reason;
    this.commandStats.lastAt = Date.now();
  }

  getState(address) {
    return this.stateCache.get(address);
  }

  getStateMetadata(address) {
    return this.stateUpdatedAt.get(address) || null;
  }

  getFreshState(address, maxAgeMs = 10000) {
    const state = this.stateCache.get(address);
    const metadata = this.stateUpdatedAt.get(address);
    if (!state || !metadata || !this.wingOnline) return undefined;
    if (metadata.generation !== this.connectionGeneration) return undefined;
    const ageMs = Date.now() - Number(metadata.observedAt || 0);
    if (ageMs < 0 || ageMs > Math.max(0, Number(maxAgeMs) || 0)) return undefined;
    return state;
  }

  getRuntimeStatus() {
    this.refreshNetworkTrafficRates();
    const watchedMeterAddressCount = this.connected ? this.watchedMeterAddressSet.size : 0;
    return {
      sessionId: this.sessionId,
      wingIp: this.wingIp,
      wingPort: this.wingPort,
      wingOnline: this.wingOnline,
      routeConfigured: this.routeWasConfigured,
      localSocketBound: Number(this.nativeListenPort || 0) > 0,
      nativeListenPort: this.nativeListenPort,
      nativeBinaryReady: this.nativeBinaryReady,
      nativeConnectInFlight: this.nativeConnectInFlight,
      nativeReconnectAttempt: this.nativeReconnectAttempt,
      connectionGeneration: this.connectionGeneration,
      stateObservationCount: this.stateCache.size,
      commandStats: { ...this.commandStats },
      maxControlCommandsPerSecond: this.maxControlCommandsPerSecond,
      watchedMeterAddressCount,
      activeMeterAddressCount: this.activeMeterAddressSet.size,
      droppedMeterAddressCount: this.droppedMeterAddresses.length,
      droppedMeterAddresses: [...this.droppedMeterAddresses],
      meterRequestLimited: this.activeMeterRequestLimited,
      meterRequestValueBudget: this.maxMeterRequestValueBudget,
      visualMeterRequestValueBudget: this.maxVisualMeterRequestValueBudget,
      activeMeterValueCount: this.activeMeterValueCount,
      activeVisualMeterValueCount: this.activeVisualMeterValueCount,
      activeMeterGroupCount: this.activeMeterRequest ? this.activeMeterRequest.length : 0,
      visualMeterPublishIntervalMs: this.meterVisualPublishIntervalMs,
      pendingVisualMeterPublishCount: this.pendingVisualMeterEvents.size,
      watchedRefreshPendingCount: this.watchedStateRefreshQueue.length,
      watchedRefreshTotalAddressCount: this.watchedStateRefreshTotalAddressCount,
      watchedRefreshIntervalMs: this.watchedStateRefreshIntervalMs,
      networkTraffic: {
        ...this.networkTraffic.rates,
        totals: { ...this.networkTraffic.totals },
      },
      sourceDeviceIndexMode: this.sourceDeviceIndexMode,
      selectedStrip: this.getSelectedStripContext(),
      subscriptionMode: this.subscriptionMode,
      activeReportIds: this.enableNativeMeters ? [this.meterReportId] : [],
      lastMeterRxAt: this.lastMeterRxAt,
      lastMeterRenewAt: this.lastMeterRenewAt,
      renewJitterMs: this.meterRenewJitterMs,
      consoleFamily: this.consoleFamily,
      consoleDisplayName: this.consoleDisplayName || this.consoleModel,
      consoleSupportLevel: this.consoleSupportLevel,
      consoleBrand: this.consoleBrand,
      consoleCapabilities: this.consoleCapabilities,
      consoleModel: this.consoleModel,
      consoleModelSource: this.consoleModelSource,
      consoleConfigRaw: this.consoleConfigRaw,
      discoveryModelRaw: this.discoveryModelRaw,
      lastConsoleReplyPort: this.lastConsoleReplyPort,
      driverMode: this.getActiveDriver().id,
      connected: this.connected,
    };
  }
}

export default WingSession;
