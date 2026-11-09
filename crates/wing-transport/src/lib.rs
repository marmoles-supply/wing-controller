//! Native transport primitives for the macOS desktop runtime.
//!
//! This crate is intentionally small: it proves the socket contracts that will
//! replace the Android `WingOscModule.kt` bridge before Tauri IPC is added.

use std::io::{self, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream, ToSocketAddrs, UdpSocket};
use std::time::Duration;
use socket2::{Domain, Socket, Type};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalIpv4Interface {
    pub name: String,
    pub address: Ipv4Addr,
    pub netmask: Ipv4Addr,
    pub broadcast: Ipv4Addr,
}

pub struct UdpHub {
    socket: UdpSocket,
}

impl UdpHub {
    pub fn bind(port: u16) -> io::Result<Self> {
        let socket = UdpSocket::bind(("0.0.0.0", port))?;
        socket.set_broadcast(true)?;
        Ok(Self { socket })
    }

    /// Only the transport tests bind the loopback directly; the runtime always uses
    /// `bind`/`bind_ipv4` so a console on another host can answer.
    #[cfg(test)]
    pub fn bind_loopback(port: u16) -> io::Result<Self> {
        let socket = UdpSocket::bind(("127.0.0.1", port))?;
        Ok(Self { socket })
    }

    pub fn bind_ipv4(address: Ipv4Addr, port: u16) -> io::Result<Self> {
        let socket = UdpSocket::bind((address, port))?;
        socket.set_broadcast(true)?;
        Ok(Self { socket })
    }

    pub fn local_addr(&self) -> io::Result<SocketAddr> {
        self.socket.local_addr()
    }

    pub fn send_to(&self, bytes: &[u8], address: impl ToSocketAddrs) -> io::Result<usize> {
        self.socket.send_to(bytes, address)
    }

    pub fn recv_once(
        &self,
        buffer: &mut [u8],
        timeout: Duration,
    ) -> io::Result<(usize, SocketAddr)> {
        self.socket.set_read_timeout(Some(timeout))?;
        self.socket.recv_from(buffer)
    }
}

pub struct NativeMeterTcp {
    stream: TcpStream,
}

impl NativeMeterTcp {
    pub fn connect(address: impl ToSocketAddrs, timeout: Duration) -> io::Result<Self> {
        let mut last_error = None;
        for socket_addr in address.to_socket_addrs()? {
            match TcpStream::connect_timeout(&socket_addr, timeout) {
                Ok(stream) => {
                    stream.set_nodelay(true)?;
                    stream.set_write_timeout(Some(timeout))?;
                    return Ok(Self { stream });
                }
                Err(error) => last_error = Some(error),
            }
        }
        Err(last_error.unwrap_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "no socket address resolved")
        }))
    }

    pub fn from_stream(stream: TcpStream, timeout: Duration) -> io::Result<Self> {
        stream.set_nodelay(true)?;
        stream.set_write_timeout(Some(timeout))?;
        Ok(Self { stream })
    }

    pub fn connect_from(
        local_ip: Ipv4Addr,
        remote: SocketAddrV4,
        timeout: Duration,
    ) -> io::Result<Self> {
        let socket = Socket::new(Domain::IPV4, Type::STREAM, None)?;
        socket.bind(&SocketAddr::new(IpAddr::V4(local_ip), 0).into())?;
        socket.connect_timeout(&SocketAddr::V4(remote).into(), timeout)?;
        Self::from_stream(socket.into(), timeout)
    }

    pub fn send_native_meter_payload(&mut self, payload: &[u8]) -> io::Result<()> {
        let frame = wing_core::meters::native_frame(payload);
        self.stream.write_all(&frame)?;
        self.stream.flush()
    }
}

#[cfg(unix)]
pub fn local_ipv4_interfaces() -> Vec<LocalIpv4Interface> {
    let mut interfaces = Vec::new();
    let mut ifap: *mut libc::ifaddrs = std::ptr::null_mut();
    unsafe {
        if libc::getifaddrs(&mut ifap) != 0 || ifap.is_null() {
            return interfaces;
        }
        let mut cur = ifap;
        while !cur.is_null() {
            let ifa = &*cur;
            let flags = ifa.ifa_flags as i32;
            let is_up = (flags & libc::IFF_UP) != 0;
            let is_loopback = (flags & libc::IFF_LOOPBACK) != 0;
            if is_up && !is_loopback && !ifa.ifa_addr.is_null() {
                if (*ifa.ifa_addr).sa_family as i32 == libc::AF_INET {
                    let addr = &*(ifa.ifa_addr as *const libc::sockaddr_in);
                    let ip_u32 = u32::from_be(addr.sin_addr.s_addr);
                    if !ifa.ifa_netmask.is_null() {
                        let mask_addr = &*(ifa.ifa_netmask as *const libc::sockaddr_in);
                        let mask = u32::from_be(mask_addr.sin_addr.s_addr);
                        let bcast = (ip_u32 & mask) | (!mask);
                        interfaces.push(LocalIpv4Interface {
                            name: std::ffi::CStr::from_ptr(ifa.ifa_name).to_string_lossy().into_owned(),
                            address: Ipv4Addr::from(ip_u32),
                            netmask: Ipv4Addr::from(mask),
                            broadcast: Ipv4Addr::from(bcast),
                        });
                    }
                }
            }
            cur = ifa.ifa_next;
        }
        libc::freeifaddrs(ifap);
    }
    interfaces.sort_by(|a, b| a.address.cmp(&b.address).then_with(|| a.name.cmp(&b.name)));
    interfaces.dedup_by(|a, b| a.address == b.address && a.name == b.name);
    interfaces
}

#[cfg(not(unix))]
pub fn local_ipv4_interfaces() -> Vec<LocalIpv4Interface> {
    Vec::new()
}

/// Used by the interface test below; the runtime derives its broadcast targets from
/// `local_ipv4_interfaces` through the discovery path.
#[cfg(test)]
pub fn local_ipv4_broadcast_addresses() -> Vec<Ipv4Addr> {
    let mut broadcasts = local_ipv4_interfaces()
        .into_iter()
        .map(|interface| interface.broadcast)
        .collect::<Vec<_>>();
    broadcasts.sort();
    broadcasts.dedup();
    broadcasts
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn udp_hub_sends_and_receives_loopback_packets() {
        let receiver = UdpHub::bind_loopback(0).expect("bind receiver");
        let sender = UdpHub::bind_loopback(0).expect("bind sender");
        let receiver_addr = receiver.local_addr().expect("receiver addr");
        let sent = sender.send_to(b"WING?", receiver_addr).expect("send");
        assert_eq!(sent, 5);

        let mut buffer = [0; 16];
        let (len, source) = receiver
            .recv_once(&mut buffer, Duration::from_millis(250))
            .expect("receive");

        assert_eq!(&buffer[..len], b"WING?");
        assert_eq!(source.ip().to_string(), "127.0.0.1");
    }

    #[test]
    fn udp_hub_binds_specific_ipv4_source() {
        let receiver = UdpHub::bind_loopback(0).expect("bind receiver");
        let sender = UdpHub::bind_ipv4(Ipv4Addr::LOCALHOST, 0).expect("bind sender");
        sender.send_to(b"WING?", receiver.local_addr().expect("receiver addr")).expect("send");
        let mut buffer = [0; 16];
        let (len, source) = receiver.recv_once(&mut buffer, Duration::from_millis(250)).expect("receive");
        assert_eq!(&buffer[..len], b"WING?");
        assert_eq!(source.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
    }

    #[test]
    fn native_meter_tcp_sends_maillot_framed_payload() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind listener");
        let address = listener.local_addr().expect("listener addr");

        let reader = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buffer = [0; 16];
            let len = stream.read(&mut buffer).expect("read");
            buffer[..len].to_vec()
        });

        let stream = TcpStream::connect(address).expect("connect");
        let mut tcp =
            NativeMeterTcp::from_stream(stream, Duration::from_millis(250)).expect("wrap tcp");
        tcp.send_native_meter_payload(&[0xd4, 0x01, 0x02, 0x03, 0x04])
            .expect("send payload");

        assert_eq!(
            reader.join().expect("reader"),
            vec![0xdf, 0xd3, 0xd4, 0x01, 0x02, 0x03, 0x04],
        );
    }

    #[test]
    fn native_meter_tcp_connects_from_specific_ipv4_source() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind listener");
        let remote = match listener.local_addr().expect("listener addr") {
            SocketAddr::V4(address) => address,
            _ => unreachable!(),
        };
        let tcp = NativeMeterTcp::connect_from(Ipv4Addr::LOCALHOST, remote, Duration::from_secs(1)).expect("connect");
        let (_peer, source) = listener.accept().expect("accept");
        assert_eq!(source.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
        drop(tcp);
    }

    #[test]
    fn local_ipv4_broadcast_addresses_finds_active_interfaces() {
        let broadcasts = local_ipv4_broadcast_addresses();
        println!("detected broadcasts: {:?}", broadcasts);
        #[cfg(unix)]
        assert!(!broadcasts.is_empty(), "expected at least one broadcast address on active system");
    }
}
