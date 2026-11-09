use std::env;
use std::io::Read;
use std::net::{TcpListener, UdpSocket};
use std::process;
use std::thread;
use std::time::Duration;
use std::time::Instant;

use wing_core::meters::{
    decode_report, native_frame, renew_payload, request_payload, MeterDescriptor,
    SOURCE_USB_DEVICE_ID,
};
use wing_core::targets::{
    model_leaf_for_parameter, resolve_basic_addresses, target_categories,
    target_parameters_for_category, trigger_parameters_for_category, BasicTargetSpec,
};
use wing_runtime::{
    run_usb_meter_stress, MeterAddress, MeterStressOptions, MeterTrigger, MeterTriggerPolicy,
    MeterTriggerRuntime, TriggerDirection,
};
use wing_transport::{NativeMeterTcp, UdpHub};

const DEFAULT_DISCOVERY_PORT: u16 = 2222;
const DEFAULT_NATIVE_METER_PORT: u16 = 2222;
const DEFAULT_LISTEN_PORT: u16 = 23_456;
const DEFAULT_REPORT_ID: u32 = 1;
const DEFAULT_METER_DURATION_SECS: u64 = 10;

fn main() {
    if let Err(error) = run(env::args().skip(1).collect()) {
        eprintln!("{error}");
        process::exit(1);
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    match args.first().map(String::as_str) {
        None | Some("help") | Some("--help") | Some("-h") => {
            print_help();
            Ok(())
        }
        Some("frame-demo") => {
            print_frame_demo();
            Ok(())
        }
        Some("discover") => {
            let target = args
                .get(1)
                .cloned()
                .unwrap_or_else(|| format!("255.255.255.255:{DEFAULT_DISCOVERY_PORT}"));
            discover(&target)
        }
        Some("meter-usb") => {
            let ip = args
                .get(1)
                .ok_or_else(|| "usage: wing-probe meter-usb <wing-ip> [seconds]".to_string())?;
            let seconds = args
                .get(2)
                .map(|value| {
                    value
                        .parse::<u64>()
                        .map_err(|_| format!("invalid seconds: {value}"))
                })
                .transpose()?
                .unwrap_or(DEFAULT_METER_DURATION_SECS);
            meter_usb(ip, DEFAULT_NATIVE_METER_PORT, seconds)
        }
        Some("mock-usb") => {
            let seconds = args
                .get(1)
                .map(|value| {
                    value
                        .parse::<u64>()
                        .map_err(|_| format!("invalid seconds: {value}"))
                })
                .transpose()?
                .unwrap_or(3);
            mock_usb(seconds)
        }
        Some("stress-usb") => {
            let frames = parse_optional_usize(args.get(1), 1000, "frames")?;
            let frame_interval_ms = parse_optional_u64(args.get(2), 1, "frame_interval_ms")?;
            let visual_interval_ms = parse_optional_u64(args.get(3), 66, "visual_interval_ms")?;
            stress_usb(frames, frame_interval_ms, visual_interval_ms);
            Ok(())
        }
        Some("paths") => {
            print_resolved_paths();
            Ok(())
        }
        Some("paths-full") => {
            print_resolved_paths_full();
            Ok(())
        }
        Some(other) => Err(format!("unknown command: {other}")),
    }
}

/// Dumps every OSC address the target catalogue can resolve, one
/// `category<TAB>parameter<TAB>address` row per line. Used by
/// `scripts/wing-maillot-path-audit.mjs` to cross-check the resolver against the
/// Maillot reference, which is how the footnote-suffix defect (`thr23`, `lg24`)
/// was found. Id 1 and send id 1 are enough: the shape of the path is what is
/// under audit.
///
/// Both views of the catalogue are walked. A category carries a parameter in one
/// view or the other — `show`'s two writable keys are never in a trigger list and
/// `showstate`'s five read-only keys are never in a target list — so walking only
/// the target view would leave addresses the catalogue can resolve unaudited.
fn print_resolved_paths() {
    for category in target_categories() {
        let mut parameters = target_parameters_for_category(category.key);
        for parameter in trigger_parameters_for_category(category.key) {
            if !parameters.iter().any(|listed| listed.key == parameter.key) {
                parameters.push(parameter);
            }
        }
        for parameter in parameters {
            let target = BasicTargetSpec {
                category: category.key.to_string(),
                ids: "1".to_string(),
                parameter: parameter.key.to_string(),
                send_id: Some(1),
                custom_address: None,
            };
            for address in resolve_basic_addresses(&target) {
                println!("{}\t{}\t{}", category.key, parameter.key, address);
            }
        }
    }
}

/// Like [`print_resolved_paths`], with the three fields a live audit needs on every row: `arg_kind`
/// (what the app puts on the wire: `float`, `int`, `string` or `none`), whether the console reports
/// the leaf back (`can_trigger`) and whether the key is in the category's target list (`writable`).
/// One `category<TAB>parameter<TAB>address<TAB>arg_kind<TAB>can_trigger<TAB>writable` row per line.
///
/// `paths` keeps its three columns on purpose: `scripts/wing-maillot-path-audit.mjs` parses that
/// output, and a new column there would be a silent contract change.
fn print_resolved_paths_full() {
    for category in target_categories() {
        let targets = target_parameters_for_category(category.key);
        let mut parameters = targets.clone();
        for parameter in trigger_parameters_for_category(category.key) {
            if !parameters.iter().any(|listed| listed.key == parameter.key) {
                parameters.push(parameter);
            }
        }
        for parameter in parameters {
            let writable = targets
                .iter()
                .any(|listed| listed.key == parameter.key)
                .to_string();
            let target = BasicTargetSpec {
                category: category.key.to_string(),
                ids: "1".to_string(),
                parameter: parameter.key.to_string(),
                send_id: Some(1),
                custom_address: None,
            };
            for address in resolve_basic_addresses(&target) {
                println!(
                    "{}\t{}\t{}\t{}\t{}\t{}\t{}",
                    category.key,
                    parameter.key,
                    address,
                    parameter.arg_kind,
                    parameter.can_trigger,
                    writable,
                    model_leaf_for_parameter(category.key, parameter.key).is_some()
                );
            }
        }
    }
}

fn print_help() {
    println!("wing-probe");
    println!();
    println!("Commands:");
    println!("  frame-demo              Print Maillot native meter request/renew hex for USB source meters");
    println!(
        "  discover [ip:port]      Send WING? discovery UDP packet and wait briefly for one reply"
    );
    println!(
        "  meter-usb <ip> [sec]    Subscribe to WING source USB meters and print decoded values"
    );
    println!(
        "  mock-usb [sec]          Run local mock WING USB meter stream through the same probe"
    );
    println!("  stress-usb [frames] [frame_ms] [visual_ms]  Stress USB trigger path without WING");
    println!("  paths                   every generated path, three columns (device, path, kind)");
    println!("  paths-full              paths plus arg_kind, can_trigger and writable, for the live audit");
    println!("                          (`scripts/wing-maillot-path-audit.mjs` parses `paths`)");
}

fn print_frame_demo() {
    let descriptors = vec![MeterDescriptor::source(SOURCE_USB_DEVICE_ID)];
    let request = request_payload(DEFAULT_LISTEN_PORT, DEFAULT_REPORT_ID, &descriptors);
    let renew = renew_payload(DEFAULT_REPORT_ID);

    println!("usb_source_request_payload={}", hex(&request));
    println!("usb_source_request_frame={}", hex(&native_frame(&request)));
    println!("renew_payload={}", hex(&renew));
    println!("renew_frame={}", hex(&native_frame(&renew)));
}

fn discover(target: &str) -> Result<(), String> {
    let hub = UdpHub::bind(0).map_err(|error| format!("udp bind failed: {error}"))?;
    hub.send_to(b"WING?", target)
        .map_err(|error| format!("udp send to {target} failed: {error}"))?;

    let mut buffer = [0_u8; 4096];
    let (len, source) = hub
        .recv_once(&mut buffer, Duration::from_millis(750))
        .map_err(|error| format!("no discovery reply from {target}: {error}"))?;

    println!("reply_from={source}");
    println!("reply_hex={}", hex(&buffer[..len]));
    println!(
        "reply_text_lossy={}",
        String::from_utf8_lossy(&buffer[..len])
    );
    Ok(())
}

fn meter_usb(ip: &str, native_port: u16, seconds: u64) -> Result<(), String> {
    meter_usb_with_endpoint(ip, native_port, seconds, DEFAULT_REPORT_ID)
}

fn meter_usb_with_endpoint(
    ip: &str,
    native_port: u16,
    seconds: u64,
    report_id: u32,
) -> Result<(), String> {
    let udp = UdpHub::bind(0).map_err(|error| format!("udp bind failed: {error}"))?;
    let listen_port = udp
        .local_addr()
        .map_err(|error| format!("udp local addr failed: {error}"))?
        .port();
    let mut tcp = NativeMeterTcp::connect((ip, native_port), Duration::from_millis(3000))
        .map_err(|error| format!("native meter TCP connect {ip}:{native_port} failed: {error}"))?;

    let descriptors = vec![MeterDescriptor::source(SOURCE_USB_DEVICE_ID)];
    let request = request_payload(listen_port, report_id, &descriptors);
    let renew = renew_payload(report_id);
    let mut trigger_runtime = MeterTriggerRuntime::new();
    trigger_runtime.replace_triggers(vec![MeterTrigger {
        id: "usb1-rising-demo".to_string(),
        address: MeterAddress {
            family: "source",
            device_id: Some(SOURCE_USB_DEVICE_ID),
            index: 1,
            value_slot: 0,
        },
        threshold: 12.0,
        direction: TriggerDirection::Rising,
        policy: MeterTriggerPolicy::fast_transient(),
    }]);

    tcp.send_native_meter_payload(&request)
        .map_err(|error| format!("meter request send failed: {error}"))?;

    println!("meter_usb_state=started");
    println!("wing_ip={ip}");
    println!("native_tcp_port={native_port}");
    println!("udp_listen_port={listen_port}");
    println!("request_frame={}", hex(&native_frame(&request)));

    let start = Instant::now();
    let deadline = start + Duration::from_secs(seconds);
    let mut next_renew = start + Duration::from_secs(2);
    let mut packets = 0_u64;
    let mut events = 0_u64;
    let mut last_print = Instant::now();

    while Instant::now() < deadline {
        if Instant::now() >= next_renew {
            tcp.send_native_meter_payload(&renew)
                .map_err(|error| format!("meter renew send failed: {error}"))?;
            next_renew += Duration::from_secs(2);
        }

        let mut buffer = [0_u8; 8192];
        match udp.recv_once(&mut buffer, Duration::from_millis(250)) {
            Ok((len, source)) => {
                packets += 1;
                let decoded = decode_report(report_id, &descriptors, &buffer[..len])
                    .map_err(|error| format!("meter decode failed: {error}"))?;
                if decoded.is_empty() {
                    println!("packet_from={source} bytes={len} decoded=0");
                    continue;
                }

                events += decoded.len() as u64;
                let hits = decoded
                    .iter()
                    .flat_map(|event| trigger_runtime.process_meter_event(event))
                    .collect::<Vec<_>>();
                let summary = decoded
                    .iter()
                    .take(8)
                    .map(|event| format!("usb{}={:.2}", event.index, event.values[0]))
                    .collect::<Vec<_>>()
                    .join(" ");
                println!(
                    "packet_from={source} bytes={len} decoded={} {summary}",
                    decoded.len()
                );
                for hit in hits {
                    println!(
                        "trigger_hit={} family={} index={} previous={:.2} value={:.2}",
                        hit.trigger_id,
                        hit.address.family,
                        hit.address.index,
                        hit.previous_value,
                        hit.value,
                    );
                }
                last_print = Instant::now();
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                if last_print.elapsed() >= Duration::from_secs(1) {
                    println!("meter_usb_waiting packets={packets} decoded_events={events}");
                    last_print = Instant::now();
                }
            }
            Err(error) => return Err(format!("udp receive failed: {error}")),
        }

        thread::sleep(Duration::from_millis(1));
    }

    println!("meter_usb_state=finished packets={packets} decoded_events={events}");
    Ok(())
}

fn mock_usb(seconds: u64) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("mock TCP bind failed: {error}"))?;
    let native_port = listener
        .local_addr()
        .map_err(|error| format!("mock TCP local addr failed: {error}"))?
        .port();
    let report_id = 0x0a0b_0c0d;
    let mock_duration = Duration::from_secs(seconds + 1);

    let mock = thread::spawn(move || run_mock_usb_server(listener, report_id, mock_duration));
    println!("mock_usb_native_tcp_port={native_port}");

    let probe_result = meter_usb_with_endpoint("127.0.0.1", native_port, seconds, report_id);
    match mock.join() {
        Ok(Ok(())) => probe_result,
        Ok(Err(error)) => Err(error),
        Err(_) => Err("mock server thread panicked".to_string()),
    }
}

fn stress_usb(frames: usize, frame_interval_ms: u64, visual_interval_ms: u64) {
    let report = run_usb_meter_stress(MeterStressOptions {
        frames,
        frame_interval_ms,
        visual_interval_ms,
        threshold: 12.0,
    });

    println!("stress_usb_state=finished");
    println!("frames={}", report.frames);
    println!("decoded_events={}", report.decoded_events);
    println!("trigger_hits={}", report.trigger_hits);
    println!("visual_frames={}", report.visual_frames);
    println!("simulated_duration_ms={}", report.simulated_duration_ms);
    println!("average_decode_micros={}", report.average_decode_micros);
    println!("max_decode_micros={}", report.max_decode_micros);
    println!(
        "trigger_to_visual_independent={}",
        report.trigger_to_visual_independent
    );
}

fn parse_optional_usize(
    value: Option<&String>,
    fallback: usize,
    label: &str,
) -> Result<usize, String> {
    value
        .map(|raw| {
            raw.parse::<usize>()
                .map_err(|_| format!("invalid {label}: {raw}"))
        })
        .transpose()
        .map(|parsed| parsed.unwrap_or(fallback))
}

fn parse_optional_u64(value: Option<&String>, fallback: u64, label: &str) -> Result<u64, String> {
    value
        .map(|raw| {
            raw.parse::<u64>()
                .map_err(|_| format!("invalid {label}: {raw}"))
        })
        .transpose()
        .map(|parsed| parsed.unwrap_or(fallback))
}

fn run_mock_usb_server(
    listener: TcpListener,
    report_id: u32,
    duration: Duration,
) -> Result<(), String> {
    let (mut stream, source) = listener
        .accept()
        .map_err(|error| format!("mock TCP accept failed: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| format!("mock TCP timeout failed: {error}"))?;

    let mut request_buffer = [0_u8; 128];
    let request_len = stream
        .read(&mut request_buffer)
        .map_err(|error| format!("mock TCP read failed: {error}"))?;
    let request = &request_buffer[..request_len];
    let listen_port = parse_listen_port_from_native_request(request).ok_or_else(|| {
        format!(
            "mock could not parse listen port from request: {}",
            hex(request)
        )
    })?;

    println!("mock_tcp_client={source}");
    println!("mock_received_request={}", hex(request));
    println!("mock_udp_target=127.0.0.1:{listen_port}");

    let udp = UdpSocket::bind(("127.0.0.1", 0))
        .map_err(|error| format!("mock UDP bind failed: {error}"))?;
    let start = Instant::now();
    let mut tick = 0_i16;
    while start.elapsed() < duration {
        let packet = mock_usb_packet(report_id, tick);
        udp.send_to(&packet, ("127.0.0.1", listen_port))
            .map_err(|error| format!("mock UDP send failed: {error}"))?;
        tick = (tick + 1) % 32;
        thread::sleep(Duration::from_millis(50));
    }

    Ok(())
}

fn parse_listen_port_from_native_request(frame: &[u8]) -> Option<u16> {
    if frame.len() < 5 {
        return None;
    }
    if frame[0] != 0xdf || frame[1] != 0xd3 || frame[2] != 0xd3 {
        return None;
    }
    Some(u16::from_be_bytes([frame[3], frame[4]]))
}

fn mock_usb_packet(report_id: u32, tick: i16) -> Vec<u8> {
    let mut packet = Vec::with_capacity(4 + 48 * 2);
    packet.extend_from_slice(&report_id.to_be_bytes());
    for index in 0..48_i16 {
        let raw = if index == 0 {
            (tick + 1) * 256
        } else {
            ((index % 8) + 1) * 128
        };
        packet.extend_from_slice(&raw.to_be_bytes());
    }
    packet
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use wing_core::meters::MeterFamily;

    #[test]
    fn frame_demo_uses_usb_source_token() {
        let request = request_payload(
            DEFAULT_LISTEN_PORT,
            DEFAULT_REPORT_ID,
            &[MeterDescriptor::source(SOURCE_USB_DEVICE_ID)],
        );

        assert_eq!(
            hex(&request),
            "d35ba0d400000001dca706de",
            "Maillot Channel 3 request uses token 0xa7 and zero-based USB device byte 0x06",
        );
    }

    #[test]
    fn keeps_meter_family_import_live_for_future_probe_expansion() {
        assert_eq!(MeterFamily::Source.token(), 0xa7);
    }

    #[test]
    fn parses_listen_port_from_native_request_frame() {
        let request = native_frame(&request_payload(
            23_456,
            DEFAULT_REPORT_ID,
            &[MeterDescriptor::source(SOURCE_USB_DEVICE_ID)],
        ));

        assert_eq!(
            parse_listen_port_from_native_request(&request),
            Some(23_456)
        );
    }

    #[test]
    fn mock_usb_packet_decodes_as_full_source_group() {
        let request = [MeterDescriptor::source(SOURCE_USB_DEVICE_ID)];
        let packet = mock_usb_packet(0x0a0b_0c0d, 2);
        let events = decode_report(0x0a0b_0c0d, &request, &packet).expect("decode");

        assert_eq!(events.len(), 48);
        assert_eq!(events[0].index, 1);
        assert_eq!(events[0].values[0], 3.0);
    }
}
