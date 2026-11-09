import { Buffer } from 'buffer';
import { canonicalToNative, nativeToCanonical } from '../x32Protocol';

const looksManagedCanonicalAddress = (address) => /^\/(ch|bus|aux|main|matrix|dca|io|mgrp|fx|usersig|userctrl)\//.test(String(address || '').trim());

class X32ConsoleDriver {
  constructor(session, probe) {
    this.session = session;
    this.probe = probe;
    this.id = 'x32';
  }

  handleIdentityApplied() {
    this.session.nativeBinaryReady = false;
    this.session.closeNativeTransport();
    this.session.subscriptionMode = 'xremote_state_only';
    this.sendXremoteKeepalive();
    this.primeWatchedAddresses();
  }

  startHandshake() {
    this.probe.sendIdentityProbes();
    this.sendXremoteKeepalive();
    this.primeWatchedAddresses();
    this.session.startKeepAliveLoop();
  }

  runKeepAliveTick() {
    if (this.session.wingOnline && Date.now() - this.session.lastWingPingTime > 8000) {
      console.log('[OSC] X32/M32 connection timed out (Offline)');
      this.session.markConsoleOffline('X32/M32 telemetry timeout');
    }
    this.probe.sendIdentityProbes();
    this.sendXremoteKeepalive();
    this.primeWatchedAddresses();
  }

  handleNativeSocketConnected() {
    this.handleIdentityApplied();
  }

  handleWatchedAddressesChanged() {
    this.primeWatchedAddresses();
  }

  sendXremoteKeepalive() {
    const payload = typeof Buffer !== 'undefined'
      ? Buffer.from('/xremote\0\0\0\0,\0\0\0', 'binary')
      : new Uint8Array([0x2f, 0x78, 0x72, 0x65, 0x6d, 0x6f, 0x74, 0x65, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00]);
    this.session.sendRawBytesToPort(
      this.session.wingPort,
      payload,
      `[Tx RAW] -> ${this.session.wingPort} : /xremote`,
    );
  }

  primeWatchedAddresses() {
    const watched = Array.from(this.session.watchedAddressScopes.values()).flat();
    watched.forEach((address) => {
      if (!address || typeof address !== 'string') return;
      if (address.startsWith('/meters/')) return;
      const translated = canonicalToNative(address, []);
      if (translated?.unsupported) return;
      if (!translated?.address && looksManagedCanonicalAddress(address)) return;
      const nativeAddress = translated?.address || address;
      this.session.sendOscMessageToPort(this.session.wingPort, nativeAddress);
    });
  }

  sendControlMessage(address, args = []) {
    const translated = canonicalToNative(address, args);
    if (translated?.unsupported) {
      this.session.notifyListeners('diagnostic_log', `[Tx blocked] ${address} (unsupported on X32/M32 driver)`);
      return false;
    }
    if (translated?.address) {
      return this.session.sendOscMessageToPort(this.session.wingPort, translated.address, translated.args || []);
    }
    if (looksManagedCanonicalAddress(address)) {
      this.session.notifyListeners('diagnostic_log', `[Tx blocked] ${address} (not mapped by X32/M32 compatibility driver)`);
      return false;
    }
    return this.session.sendOscMessageToPort(this.session.wingPort, address, args);
  }

  sendRawSubscription(path) {
    if (path === '/*S') {
      this.sendXremoteKeepalive();
      return true;
    }
    return this.session.sendRawBytesToPort(
      this.session.wingPort,
      typeof Buffer !== 'undefined' ? Buffer.from(path, 'utf8') : new TextEncoder().encode(path),
      `[Tx RAW] -> ${this.session.wingPort} : ${path}`,
    );
  }

  transformIncomingState(address, args = []) {
    const translated = nativeToCanonical(address, args);
    if (translated?.address) {
      return translated;
    }
    return { address, args };
  }
}

export default X32ConsoleDriver;
