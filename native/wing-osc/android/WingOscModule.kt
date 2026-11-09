package com.usuario.wingcontroller

import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class WingOscModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    @Volatile private var socket: DatagramSocket? = null
    @Volatile private var isListening = false
    @Volatile private var socketGeneration = 0
    private var nativeSocket: Socket? = null
    private var nativeOutput: OutputStream? = null
    private var nativeConnectionRequestId = 0
    private var nativeConnectedIp: String? = null
    private var nativeConnectedPort: Int? = null
    private val TAG = "WingOscModule"
    private val udpLock = Any()
    private val nativeLock = Any()
    private val udpSendExecutor = ThreadPoolExecutor(
        1,
        1,
        0L,
        TimeUnit.MILLISECONDS,
        ArrayBlockingQueue(128),
    )
    private val nativeExecutor = Executors.newSingleThreadExecutor()

    override fun getName(): String {
        return "WingOscModule"
    }

    @ReactMethod
    fun bind(port: Int) {
        try {
            val nextSocket = DatagramSocket(null)
            nextSocket.reuseAddress = true
            nextSocket.broadcast = true
            nextSocket.bind(InetSocketAddress("0.0.0.0", port))
            val generation = synchronized(udpLock) {
                socket?.close()
                socket = nextSocket
                socketGeneration += 1
                socketGeneration
            }
            isListening = true
            val boundPort = nextSocket.localPort
            Log.d(TAG, "Successfully bound UDP socket to port $boundPort")
            val eventMap: WritableMap = Arguments.createMap()
            eventMap.putInt("port", boundPort)
            sendEvent("WingOscSocketBound", eventMap)

            thread(start = true) {
                listenForPackets(nextSocket, generation)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error binding UDP socket to port $port", e)
            emitTransportError("udp_bind", e.message ?: "Unknown UDP bind error", null, port)
        }
    }

    private fun listenForPackets(boundSocket: DatagramSocket, generation: Int) {
        val buffer = ByteArray(4096)
        while (isListening && socketGeneration == generation && !boundSocket.isClosed) {
            try {
                val packet = DatagramPacket(buffer, buffer.size)
                boundSocket.receive(packet)

                val data = packet.data.copyOfRange(0, packet.length)
                val base64Data = Base64.encodeToString(data, Base64.NO_WRAP)
                val sourceIp = packet.address.hostAddress
                val sourcePort = packet.port

                val eventMap: WritableMap = Arguments.createMap()
                eventMap.putString("data", base64Data)
                eventMap.putString("address", sourceIp)
                eventMap.putInt("port", sourcePort)
                sendEvent("WingOscPacketReceived", eventMap)
            } catch (e: Exception) {
                if (isListening) {
                    Log.e(TAG, "Error receiving UDP packet", e)
                }
            }
        }
    }

    @ReactMethod
    fun send(ip: String, port: Int, base64Data: String) {
        try {
            udpSendExecutor.execute {
                try {
                    val data = Base64.decode(base64Data, Base64.DEFAULT)
                    val address = InetAddress.getByName(ip)
                    val packet = DatagramPacket(data, data.size, address, port)
                    synchronized(udpLock) {
                        val activeSocket = socket
                        if (activeSocket == null || activeSocket.isClosed) {
                            throw IllegalStateException("UDP socket is not bound")
                        }
                        activeSocket.send(packet)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error sending UDP packet to $ip:$port", e)
                    emitTransportError("udp_send", e.message ?: "Unknown UDP send error", ip, port)
                }
            }
        } catch (e: RejectedExecutionException) {
            Log.e(TAG, "UDP send queue full for $ip:$port", e)
            emitTransportError("udp_queue_full", "UDP send queue reached its 128-packet safety limit", ip, port)
        }
    }

    @ReactMethod
    fun connectNative(ip: String, port: Int, requestId: Int) {
        nativeExecutor.execute {
            var pendingSocket: Socket? = null
            try {
                closeNativeSocket()
                val tcpSocket = Socket()
                pendingSocket = tcpSocket
                tcpSocket.reuseAddress = true
                tcpSocket.keepAlive = true
                tcpSocket.connect(InetSocketAddress(ip, port), 3000)
                synchronized(nativeLock) {
                    nativeSocket = tcpSocket
                    nativeOutput = tcpSocket.getOutputStream()
                    nativeConnectionRequestId = requestId
                    nativeConnectedIp = ip
                    nativeConnectedPort = port
                }
                pendingSocket = null

                Log.d(TAG, "Connected native TCP socket to $ip:$port")
                val eventMap: WritableMap = Arguments.createMap()
                eventMap.putString("ip", ip)
                eventMap.putInt("port", port)
                eventMap.putInt("requestId", requestId)
                sendEvent("WingNativeSocketConnected", eventMap)
            } catch (e: Exception) {
                try { pendingSocket?.close() } catch (_: Exception) {}
                Log.e(TAG, "Error connecting native TCP socket to $ip:$port", e)
                emitTransportError("tcp_connect", e.message ?: "Unknown TCP connect error", ip, port, requestId)
            }
        }
    }

    @ReactMethod
    fun sendNative(base64Data: String) {
        nativeExecutor.execute {
            try {
                val data = Base64.decode(base64Data, Base64.DEFAULT)
                synchronized(nativeLock) {
                    val output = nativeOutput
                    val tcpSocket = nativeSocket
                    if (output == null || tcpSocket == null || tcpSocket.isClosed) {
                        throw IllegalStateException("TCP socket is not connected")
                    }
                    output.write(data)
                    output.flush()
                }
            } catch (e: Exception) {
                val failedConnection = synchronized(nativeLock) {
                    Triple(nativeConnectedIp, nativeConnectedPort, nativeConnectionRequestId)
                }
                closeNativeSocket()
                Log.e(TAG, "Error sending native TCP packet", e)
                emitTransportError(
                    "tcp_send",
                    e.message ?: "Unknown TCP send error",
                    failedConnection.first,
                    failedConnection.second,
                    failedConnection.third,
                )
            }
        }
    }

    @ReactMethod
    fun closeNative(requestId: Int) {
        nativeExecutor.execute { closeNativeSocket(requestId) }
    }

    @ReactMethod
    fun close() {
        isListening = false
        synchronized(udpLock) {
            socketGeneration += 1
            socket?.close()
            socket = null
        }
        nativeExecutor.execute { closeNativeSocket() }
    }

    private fun closeNativeSocket(expectedRequestId: Int? = null) {
        synchronized(nativeLock) {
            if (
                expectedRequestId != null
                && expectedRequestId > 0
                && nativeConnectionRequestId > 0
                && nativeConnectionRequestId != expectedRequestId
            ) {
                return
            }
            try {
                nativeOutput?.close()
            } catch (_: Exception) {}
            nativeOutput = null

            try {
                nativeSocket?.close()
            } catch (_: Exception) {}
            nativeSocket = null
            nativeConnectionRequestId = 0
            nativeConnectedIp = null
            nativeConnectedPort = null
        }
    }

    private fun emitTransportError(type: String, message: String, ip: String?, port: Int?, requestId: Int? = null) {
        val eventMap: WritableMap = Arguments.createMap()
        eventMap.putString("type", type)
        eventMap.putString("message", message)
        if (ip != null) eventMap.putString("ip", ip)
        if (port != null) eventMap.putInt("port", port)
        if (requestId != null) eventMap.putInt("requestId", requestId)
        sendEvent("WingOscTransportError", eventMap)
    }

    override fun invalidate() {
        isListening = false
        synchronized(udpLock) {
            socketGeneration += 1
            try { socket?.close() } catch (_: Exception) {}
            socket = null
        }
        closeNativeSocket()
        udpSendExecutor.shutdownNow()
        nativeExecutor.shutdownNow()
        super.invalidate()
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by React Native's NativeEventEmitter contract.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required by React Native's NativeEventEmitter contract.
    }
}
