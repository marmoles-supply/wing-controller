import { Buffer } from 'buffer';

class WingConsoleDriver {
  constructor(session, probe) {
    this.session = session;
    this.probe = probe;
    this.id = 'wing';
  }

  canUseWingTransport() {
    return this.session.isWingConsole() || this.session.consoleFamily === 'unknown';
  }

  handleIdentityApplied() {
    if (!this.session.enableNativeMeters) {
      this.session.subscriptionMode = 'udp_state_only';
      return;
    }
    if (!this.session.nativeBinaryReady) {
      this.session.ensureNativeTransportConnected();
    }
    this.session.subscriptionMode = this.session.nativeBinaryReady
      ? 'native_v3_single_report'
      : 'udp_state_only';
  }

  startHandshake() {
    this.probe.sendIdentityProbes();
    this.bootstrapWingTelemetry();
    this.probe.sendWingDiscoveryPing();
    this.session.startKeepAliveLoop();
  }

  bootstrapWingTelemetry() {
    this.sendControlMessage('/ch/1/mute');
    this.sendControlMessage('/ch/2/mute');
    this.sendControlMessage('/$ctl/$stat/selidx');
    this.sendControlMessage('/$syscfg/$cnscfg');
    this.sendControlMessage('/$syscfg/$cnsmdl');
    this.sendRawSubscription('/*S');
    if (this.canUseWingTransport()) {
      this.session.subscribeToMeters(this.session.getEffectiveMeterAddresses());
    }
  }

  runKeepAliveTick() {
    if (this.session.wingOnline && Date.now() - this.session.lastWingPingTime > 8000) {
      console.log('[OSC] WING connection timed out (Offline)');
      this.session.markConsoleOffline('WING telemetry timeout');
    }

    this.probe.sendIdentityProbes();

    if (!this.canUseWingTransport()) {
      return;
    }

    this.sendRawSubscription('/*S');
    this.sendControlMessage('/$ctl/$stat/selidx');
    if (!this.session.consoleModel) {
      this.sendControlMessage('/$syscfg/$cnscfg');
      this.sendControlMessage('/$syscfg/$cnsmdl');
    }

    const mergedAddresses = Array.from(this.session.watchedAddressScopes.values()).flat();
    this.session.scheduleWatchedStateRefresh(mergedAddresses);

    this.session.renewMeters();
  }

  handleNativeSocketConnected() {
    if (!this.session.enableNativeMeters || !this.canUseWingTransport()) return;
    this.session.nativeBinaryReady = true;
    this.session.nativeConnectInFlight = false;
    this.session.subscriptionMode = 'native_v3_single_report';
    console.log(`[OSC] Native TCP metering socket connected to ${this.session.wingIp}:${this.session.WING_NATIVE_PORT}`);
    this.session.subscribeToMeters(this.session.getEffectiveMeterAddresses());
  }

  handleWatchedAddressesChanged() {
    if (!this.session.enableNativeMeters || !this.canUseWingTransport()) return;
    this.session.subscribeToMeters(this.session.getEffectiveMeterAddresses());
  }

  sendControlMessage(address, args = []) {
    return this.session.sendOscMessageToPort(this.session.wingPort, address, args);
  }

  sendRawSubscription(path) {
    const raw = typeof Buffer !== 'undefined'
      ? Buffer.from([0x2f, 0x2a, path === '/*S' ? 0x53 : 0x73, 0x00])
      : new Uint8Array([0x2f, 0x2a, path === '/*S' ? 0x53 : 0x73, 0x00]);
    const sent = this.session.sendRawBytesToPort(
      this.session.wingPort,
      raw,
      `[Tx RAW] -> ${this.session.wingPort} : ${path}`,
    );
    if (sent) {
      console.log(`[OSC Tx] App -> WING (${this.session.wingIp}:${this.session.wingPort}) | Raw Subscription: ${path}`);
    }
    return sent;
  }
}

export default WingConsoleDriver;
