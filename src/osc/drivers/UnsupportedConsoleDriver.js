class UnsupportedConsoleDriver {
  constructor(session, probe) {
    this.session = session;
    this.probe = probe;
    this.id = 'unsupported';
  }

  handleIdentityApplied() {
    this.session.nativeBinaryReady = false;
    if (this.session.enableNativeMeters) {
      this.session.closeNativeTransport();
    }
    this.session.subscriptionMode = this.session.consoleFamily === 'unknown'
      ? 'probe_only_unknown_family'
      : 'unsupported_console_family';
  }

  startHandshake() {
    this.probe.sendIdentityProbes();
    this.probe.sendWingDiscoveryPing();
    this.session.startKeepAliveLoop();
  }

  runKeepAliveTick() {
    if (this.session.wingOnline && Date.now() - this.session.lastWingPingTime > 8000) {
      const timeoutTag = this.session.consoleFamily === 'unknown'
        ? 'Unknown family / probe-only'
        : 'Unsupported family';
      console.log(`[OSC] Console connection timed out (${timeoutTag})`);
      this.session.markConsoleOffline(`${timeoutTag} telemetry timeout`);
    }
    this.probe.sendIdentityProbes();
    this.probe.sendWingDiscoveryPing();
  }

  handleNativeSocketConnected() {
    this.handleIdentityApplied();
  }

  handleWatchedAddressesChanged() {}

  sendControlMessage(address) {
    this.session.notifyListeners(
      'diagnostic_log',
      `[Tx blocked] ${address} (probe-only mode: ${this.session.consoleDisplayName || this.session.consoleFamily})`,
    );
    return false;
  }

  sendRawSubscription(path) {
    this.session.notifyListeners(
      'diagnostic_log',
      `[Tx blocked] ${path} (probe-only mode: ${this.session.consoleDisplayName || this.session.consoleFamily})`,
    );
    return false;
  }
}

export default UnsupportedConsoleDriver;
