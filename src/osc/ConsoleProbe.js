import { Buffer } from 'buffer';

class ConsoleProbe {
  constructor(session, options = {}) {
    this.session = session;
    this.wingOscPort = Number(options.wingOscPort || 2223);
    this.wingDiscoveryPort = Number(options.wingDiscoveryPort || 2222);
    this.x32OscPort = Number(options.x32OscPort || 10023);
  }

  getTargetPorts() {
    return Array.from(new Set([
      this.session.wingPort,
      this.wingOscPort,
      this.x32OscPort,
    ])).filter((port) => Number.isInteger(Number(port)) && Number(port) > 0);
  }

  sendIdentityProbes() {
    this.getTargetPorts().forEach((port) => {
      this.session.sendOscMessageToPort(Number(port), '/xinfo');
      this.session.sendOscMessageToPort(Number(port), '/info');
    });
  }

  sendWingDiscoveryPing() {
    const discoveryPing = typeof Buffer !== 'undefined'
      ? Buffer.from('WING?', 'ascii')
      : new Uint8Array([87, 73, 78, 71, 63]);
    this.session.sendRawBytesToPort(
      this.wingDiscoveryPort,
      discoveryPing,
      `[Tx DISC] -> ${this.wingDiscoveryPort} : WING?`,
    );
  }
}

export default ConsoleProbe;
