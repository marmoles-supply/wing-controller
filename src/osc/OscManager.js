import { Buffer } from 'buffer';
import OSC from 'osc-js';
import WingSession from './WingSession';
import WingUdpHub from './WingUdpHub';

class OscManagerFacade {
  constructor() {
    this.defaultSession = new WingSession({
      sessionId: 'default',
      enableNativeMeters: true,
      maxMeterRequestValueBudget: 256,
      maxVisualMeterRequestValueBudget: 96,
      meterVisualPublishIntervalMs: 16,
      ip: '192.168.1.10',
      port: 2223,
    });
    this.secondarySessions = new Set();
  }

  get stateCache() {
    return this.defaultSession.stateCache;
  }

  get selectedChannel() {
    return this.defaultSession.selectedChannel;
  }

  get wingIp() {
    return this.defaultSession.wingIp;
  }

  get wingPort() {
    return this.defaultSession.wingPort;
  }

  get wingOnline() {
    return this.defaultSession.wingOnline;
  }

  connect(ip, port = this.defaultSession.WING_OSC_PORT) {
    this.defaultSession.connect(ip, port);
  }

  disconnect() {
    this.defaultSession.disconnect();
  }

  configureRoute(ip, port = this.defaultSession.WING_OSC_PORT) {
    return this.defaultSession.configureRoute(ip, port);
  }

  async discoverConsoles(subnetPrefix, timeoutMs = 2400) {
    const prefix = String(subnetPrefix || '').trim().replace(/\.$/, '');
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(prefix)) {
      throw new Error('Invalid /24 subnet prefix');
    }

    const found = new Map();
    const unsubscribe = WingUdpHub.onPacket(({ buffer, sourceIp, sourcePort }) => {
      if (!sourceIp || !buffer) return;
      const ascii = buffer.toString('ascii').replace(/\0/g, '').trim();
      if (!ascii.startsWith('WING,')) return;
      const fields = ascii.split(',');
      found.set(sourceIp, {
        ip: sourceIp,
        port: 2223,
        replyPort: Number(sourcePort || 2222),
        model: String(fields[3] || 'WING').trim() || 'WING',
      });
    });

    try {
      const discoveryPing = Buffer.from('WING?', 'ascii');
      // Maillot token `WING?`: discovery replies are sent by the console on UDP 2222.
      // Search stays discovery-only; OSC control remains on 2223 after selection.
      for (let host = 1; host <= 254; host += 1) {
        WingUdpHub.send(`${prefix}.${host}`, 2222, discoveryPing.toString('base64'));
        if (host % 32 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 12));
        }
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(600, Number(timeoutMs) || 2400)));
      return Array.from(found.values()).sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    } finally {
      unsubscribe();
    }
  }

  on(address, callback) {
    return this.defaultSession.on(address, callback);
  }

  off(address, callback) {
    return this.defaultSession.off(address, callback);
  }

  setWatchedAddresses(addresses, scope = 'default') {
    this.defaultSession.setWatchedAddresses(addresses, scope);
  }

  setMeterVisualPublishIntervalMs(intervalMs) {
    this.defaultSession.setMeterVisualPublishIntervalMs(intervalMs);
  }

  getSelectedStripContext() {
    return this.defaultSession.getSelectedStripContext();
  }

  sendToWing(address, args = []) {
    return this.defaultSession.sendToWing(address, args);
  }

  getState(address) {
    return this.defaultSession.getState(address);
  }

  getFreshState(address, maxAgeMs = 10000) {
    return this.defaultSession.getFreshState(address, maxAgeMs);
  }

  getStateMetadata(address) {
    return this.defaultSession.getStateMetadata(address);
  }

  getRuntimeStatus() {
    return this.defaultSession.getRuntimeStatus();
  }

  createSession(options = {}) {
    const session = new WingSession({
      sessionId: options.sessionId,
      enableNativeMeters: options.enableNativeMeters === true,
      ip: options.ip || '192.168.1.10',
      port: options.port || 2223,
    });
    this.secondarySessions.add(session);
    if (options.autoConnect !== false && options.ip) {
      session.connect(options.ip, options.port || 2223);
    }
    return session;
  }

  destroySession(session) {
    if (!session) return;
    session.disconnect();
    this.secondarySessions.delete(session);
  }

  sendRawDiagnostic(ip, port, payloadStr, isAscii = false) {
    try {
      let buf;
      if (isAscii) {
        buf = Buffer.from(payloadStr, 'ascii');
      } else {
        const message = new OSC.Message(payloadStr);
        buf = message.pack();
      }
      WingUdpHub.send(ip, port, Buffer.from(buf).toString('base64'));
      this.defaultSession.notifyListeners('diagnostic_log', `[Tx RAW] -> ${port} : ${payloadStr}`);
    } catch (error) {
      this.defaultSession.notifyListeners('diagnostic_log', `[Tx Error] ${error.message}`);
    }
  }

  sendPerfectHex(ip, port, hexStr) {
    try {
      const buf = Buffer.from(hexStr, 'hex');
      WingUdpHub.send(ip, port, buf.toString('base64'));
      this.defaultSession.notifyListeners('diagnostic_log', `[Tx HEX] -> ${port} : ${hexStr}`);
    } catch (error) {
      this.defaultSession.notifyListeners('diagnostic_log', `[Tx Error] ${error.message}`);
    }
  }

  rebindNativeSocket(port) {
    WingUdpHub.rebind(port);
    this.defaultSession.notifyListeners('diagnostic_log', `[Socket] Rebound to port ${port}`);
  }

}

export default new OscManagerFacade();
