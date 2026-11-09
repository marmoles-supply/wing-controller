import { Buffer } from 'buffer';
import { NativeModules, NativeEventEmitter } from 'react-native';

class WingUdpHub {
  constructor() {
    const { WingOscModule } = NativeModules;
    this.WingOscModule = WingOscModule || null;
    this.wingOscEmitter = this.WingOscModule ? new NativeEventEmitter(WingOscModule) : null;

    this.boundPort = 0;
    this.isBound = false;
    this.bindingRequested = false;
    this.nativeOwnerSession = null;
    this.nativeOwnerRequestId = 0;

    this.activeSessions = new Set();
    this.sessionsByIp = new Map();
    this.packetListeners = new Set();

    this.boundSubscription = null;
    this.packetSubscription = null;
    this.nativeConnectSubscription = null;
    this.transportErrorSubscription = null;

    if (!this.WingOscModule) {
      console.warn('WingOscModule is NOT available. Make sure to rebuild the Android project.');
    }
  }

  ensureEventSubscriptions() {
    if (!this.WingOscModule || !this.wingOscEmitter) return;

    if (!this.boundSubscription) this.boundSubscription = this.wingOscEmitter.addListener('WingOscSocketBound', (event) => {
      this.boundPort = event?.port || 0;
      this.isBound = this.boundPort > 0;
      this.bindingRequested = false;
      this.activeSessions.forEach((session) => {
        if (typeof session.handleHubBound !== 'function') return;
        try {
          session.handleHubBound(this.boundPort);
        } catch (error) {
          console.error('[WingUdpHub] Session failed while handling UDP bind.', error);
        }
      });
    });

    if (!this.packetSubscription) this.packetSubscription = this.wingOscEmitter.addListener('WingOscPacketReceived', (event) => {
      const sourceIp = event?.address;
      const buffer = typeof Buffer !== 'undefined' ? Buffer.from(String(event?.data || ''), 'base64') : null;
      if (!buffer) return;
      this.packetListeners.forEach((callback) => {
        try {
          callback({
            buffer,
            sourceIp,
            sourcePort: event?.port || 0,
          });
        } catch (error) {
          console.error('[WingUdpHub] Packet observer failed.', error);
        }
      });
      const sessions = sourceIp ? this.sessionsByIp.get(sourceIp) : null;
      if (!sessions || sessions.size === 0) return;
      sessions.forEach((session) => {
        if (typeof session.handleUdpPacket === 'function') {
          try {
            session.handleUdpPacket(buffer, sourceIp, event?.port || 0);
          } catch (error) {
            console.error(`[WingUdpHub] Session failed while handling packet from ${sourceIp}.`, error);
          }
        }
      });
    });

    if (!this.nativeConnectSubscription) this.nativeConnectSubscription = this.wingOscEmitter.addListener('WingNativeSocketConnected', (event) => {
      const owner = this.nativeOwnerSession;
      const requestId = Number(event?.requestId || 0);
      if (!owner || typeof owner.handleNativeSocketConnected !== 'function') return;
      if (requestId > 0 && this.nativeOwnerRequestId > 0 && requestId !== this.nativeOwnerRequestId) return;
      if (event?.ip && String(event.ip) !== String(owner.wingIp || '')) return;
      try {
        owner.handleNativeSocketConnected(event || {});
      } catch (error) {
        console.error('[WingUdpHub] Session failed while handling native TCP connect.', error);
      }
    });

    if (!this.transportErrorSubscription) this.transportErrorSubscription = this.wingOscEmitter.addListener('WingOscTransportError', (event) => {
      const type = String(event?.type || 'transport');
      const message = String(event?.message || 'Unknown native transport error');
      const route = event?.ip ? ` ${event.ip}:${event?.port || '--'}` : '';
      const isNativeError = type.startsWith('tcp_');
      const eventRequestId = Number(event?.requestId || 0);
      const nativeOwnerMatches = !eventRequestId
        || !this.nativeOwnerRequestId
        || eventRequestId === this.nativeOwnerRequestId;
      const affectedSessions = event?.ip && this.sessionsByIp.has(String(event.ip))
        ? this.sessionsByIp.get(String(event.ip))
        : (isNativeError && this.nativeOwnerSession ? new Set([this.nativeOwnerSession]) : this.activeSessions);

      affectedSessions.forEach((session) => {
        if (typeof session.notifyListeners === 'function') {
          session.notifyListeners('diagnostic_log', `[Transport Error] ${type}${route}: ${message}`);
        }
      });
      if (
        isNativeError
        && nativeOwnerMatches
        && this.nativeOwnerSession
        && typeof this.nativeOwnerSession.handleNativeTransportError === 'function'
      ) {
        try {
          this.nativeOwnerSession.handleNativeTransportError(event || {});
        } catch (error) {
          console.error('[WingUdpHub] Session failed while handling native TCP error.', error);
        }
      }
    });
  }

  ensureBound() {
    if (!this.WingOscModule) return;
    this.ensureEventSubscriptions();
    if (this.isBound || this.bindingRequested) return;
    this.bindingRequested = true;
    try {
      this.WingOscModule.bind(0);
    } catch (error) {
      this.bindingRequested = false;
      console.error('[WingUdpHub] Failed to bind UDP socket:', error);
    }
  }

  onPacket(callback) {
    this.ensureEventSubscriptions();
    this.ensureBound();
    this.packetListeners.add(callback);
    return () => {
      this.packetListeners.delete(callback);
    };
  }

  registerSession(session) {
    if (!session) return;
    this.activeSessions.add(session);
    const routeIp = String(session.wingIp || '').trim();
    if (routeIp) {
      if (!this.sessionsByIp.has(routeIp)) {
        this.sessionsByIp.set(routeIp, new Set());
      }
      this.sessionsByIp.get(routeIp).add(session);
    }
    this.ensureBound();
    if (this.isBound && typeof session.handleHubBound === 'function') {
      try {
        session.handleHubBound(this.boundPort);
      } catch (error) {
        console.error('[WingUdpHub] Session failed while registering on bound hub.', error);
      }
    }
  }

  updateSessionRoute(session, previousIp, nextIp) {
    const oldKey = String(previousIp || '').trim();
    const newKey = String(nextIp || '').trim();
    if (oldKey && this.sessionsByIp.has(oldKey)) {
      const bucket = this.sessionsByIp.get(oldKey);
      bucket.delete(session);
      if (bucket.size === 0) {
        this.sessionsByIp.delete(oldKey);
      }
    }
    if (newKey) {
      if (!this.sessionsByIp.has(newKey)) {
        this.sessionsByIp.set(newKey, new Set());
      }
      this.sessionsByIp.get(newKey).add(session);
    }
  }

  unregisterSession(session) {
    if (!session) return;
    this.activeSessions.delete(session);
    const routeIp = String(session.wingIp || '').trim();
    if (routeIp && this.sessionsByIp.has(routeIp)) {
      const bucket = this.sessionsByIp.get(routeIp);
      bucket.delete(session);
      if (bucket.size === 0) {
        this.sessionsByIp.delete(routeIp);
      }
    }

    if (this.nativeOwnerSession === session) {
      this.closeNative(session);
    }

    this.teardownIfIdle();
  }

  send(ip, port, base64Data) {
    if (!this.WingOscModule) return false;
    this.ensureBound();
    try {
      this.WingOscModule.send(ip, port, base64Data);
      return true;
    } catch (error) {
      console.error(`[WingUdpHub] Failed to send UDP packet to ${ip}:${port}`, error);
      return false;
    }
  }

  connectNative(session, ip, port, requestId = 0) {
    if (!this.WingOscModule) return false;
    this.ensureEventSubscriptions();
    this.nativeOwnerSession = session || null;
    this.nativeOwnerRequestId = Number(requestId || 0);
    try {
      this.WingOscModule.connectNative(ip, port, this.nativeOwnerRequestId);
      return true;
    } catch (error) {
      console.error(`[WingUdpHub] Failed to connect native TCP socket to ${ip}:${port}`, error);
      if (this.nativeOwnerSession === session) {
        this.nativeOwnerSession = null;
        this.nativeOwnerRequestId = 0;
      }
      return false;
    }
  }

  sendNative(session, base64Data) {
    if (!this.WingOscModule || this.nativeOwnerSession !== session) return false;
    try {
      this.WingOscModule.sendNative(base64Data);
      return true;
    } catch (error) {
      console.error('[WingUdpHub] Failed to queue native TCP payload.', error);
      return false;
    }
  }

  closeNative(session = null) {
    if (!this.WingOscModule) return;
    if (session && this.nativeOwnerSession && this.nativeOwnerSession !== session) return;
    const requestId = this.nativeOwnerRequestId;
    try {
      this.WingOscModule.closeNative(requestId);
    } catch (error) {
      console.error('[WingUdpHub] Failed to close native TCP socket:', error);
    } finally {
      this.nativeOwnerSession = null;
      this.nativeOwnerRequestId = 0;
    }
  }

  rebind(port) {
    if (!this.WingOscModule) return;
    try {
      this.WingOscModule.close();
    } catch (error) {
      console.error('[WingUdpHub] Failed to close socket before rebind:', error);
    }
    this.boundPort = 0;
    this.isBound = false;
    this.bindingRequested = true;
    this.WingOscModule.bind(port);
  }

  teardownIfIdle() {
    if (!this.WingOscModule) return;
    if (this.activeSessions.size > 0) return;

    try {
      this.WingOscModule.close();
    } catch (error) {
      console.error('[WingUdpHub] Failed to close sockets while idling:', error);
    }

    this.boundPort = 0;
    this.isBound = false;
    this.bindingRequested = false;
    this.nativeOwnerSession = null;
    this.nativeOwnerRequestId = 0;
  }
}

export default new WingUdpHub();
