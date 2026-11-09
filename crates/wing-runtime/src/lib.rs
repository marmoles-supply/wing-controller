//! Runtime primitives for the macOS backend.
//!
//! This crate owns logic that must not depend on UI render cadence. The first
//! contract is meter-trigger edge detection for fast source USB transients.

use std::collections::HashMap;
use std::time::Instant;

use wing_core::meters::{decode_report, DecodedMeterEvent, MeterDescriptor, SOURCE_USB_DEVICE_ID};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TriggerDirection {
    Rising,
    Falling,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MeterTriggerMode {
    Level,
    Transient,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MeterTriggerPolicy {
    pub mode: MeterTriggerMode,
    pub cooldown_ms: u64,
    pub rearm_db: f32,
    pub dwell_ms: u64,
    pub stale_after_ms: u64,
}

impl MeterTriggerPolicy {
    pub fn level() -> Self {
        Self {
            mode: MeterTriggerMode::Level,
            cooldown_ms: 0,
            rearm_db: 3.0,
            dwell_ms: 0,
            stale_after_ms: 1500,
        }
    }

    pub fn fast_transient() -> Self {
        Self {
            mode: MeterTriggerMode::Transient,
            cooldown_ms: 0,
            rearm_db: 3.0,
            dwell_ms: 0,
            stale_after_ms: 1500,
        }
    }
}

impl Default for MeterTriggerPolicy {
    fn default() -> Self {
        Self::level()
    }
}

#[derive(Clone, Debug)]
pub struct MeterTrigger {
    pub id: String,
    pub address: MeterAddress,
    pub threshold: f32,
    pub direction: TriggerDirection,
    pub policy: MeterTriggerPolicy,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct MeterAddress {
    pub family: &'static str,
    pub device_id: Option<u8>,
    pub index: u8,
    pub value_slot: usize,
}

#[derive(Clone, Debug)]
pub struct TriggerHit {
    pub trigger_id: String,
    pub address: MeterAddress,
    pub previous_value: f32,
    pub value: f32,
    pub observed_at: Instant,
}

#[derive(Default)]
pub struct MeterTriggerRuntime {
    triggers: Vec<MeterTrigger>,
    states: HashMap<String, MeterTriggerState>,
}

#[derive(Clone, Copy, Debug)]
struct MeterTriggerState {
    last_value: f32,
    last_packet_at: Instant,
    last_fire_at: Option<Instant>,
    recent_min: f32,
    was_hot: bool,
    first_hot_at: Option<Instant>,
}

impl MeterTriggerRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn replace_triggers(&mut self, triggers: Vec<MeterTrigger>) {
        self.triggers = triggers;
        self.states.clear();
    }

    pub fn process_meter_event(&mut self, event: &DecodedMeterEvent) -> Vec<TriggerHit> {
        let now = Instant::now();
        self.triggers
            .iter()
            .filter(|trigger| {
                trigger.address.family == event.family.address_family()
                    && trigger.address.device_id == event.device_id
                    && trigger.address.index == event.index
            })
            .filter_map(|trigger| {
                let value = event.values.get(trigger.address.value_slot).copied()?;
                let state =
                    self.states
                        .entry(trigger.id.clone())
                        .or_insert_with(|| MeterTriggerState {
                            last_value: value,
                            last_packet_at: now,
                            last_fire_at: None,
                            recent_min: value,
                            was_hot: threshold_hot(value, trigger.threshold, trigger.direction),
                            first_hot_at: None,
                        });
                let previous_value = state.last_value;
                let should_fire =
                    process_trigger_policy(trigger, state, previous_value, value, now);
                should_fire.then(|| TriggerHit {
                    trigger_id: trigger.id.clone(),
                    address: trigger.address.clone(),
                    previous_value,
                    value,
                    observed_at: now,
                })
            })
            .collect()
    }
}

#[derive(Clone, Debug)]
pub struct MeterStressOptions {
    pub frames: usize,
    pub frame_interval_ms: u64,
    pub visual_interval_ms: u64,
    pub threshold: f32,
}

impl Default for MeterStressOptions {
    fn default() -> Self {
        Self {
            frames: 1000,
            frame_interval_ms: 1,
            visual_interval_ms: 66,
            threshold: 12.0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct MeterStressReport {
    pub frames: usize,
    pub decoded_events: usize,
    pub trigger_hits: usize,
    pub visual_frames: usize,
    pub simulated_duration_ms: u64,
    pub average_decode_micros: u128,
    pub max_decode_micros: u128,
    pub trigger_to_visual_independent: bool,
}

pub fn run_usb_meter_stress(options: MeterStressOptions) -> MeterStressReport {
    let descriptors = [MeterDescriptor::source(SOURCE_USB_DEVICE_ID)];
    let mut runtime = MeterTriggerRuntime::new();
    runtime.replace_triggers(vec![MeterTrigger {
        id: "usb1-stress-rising".to_string(),
        address: MeterAddress {
            family: "source",
            device_id: Some(SOURCE_USB_DEVICE_ID),
            index: 1,
            value_slot: 0,
        },
        threshold: options.threshold,
        direction: TriggerDirection::Rising,
        policy: MeterTriggerPolicy::fast_transient(),
    }]);

    let mut decoded_events = 0_usize;
    let mut trigger_hits = 0_usize;
    let mut visual_frames = 0_usize;
    let mut simulated_elapsed_ms = 0_u64;
    let mut last_visual_emit_ms = 0_u64;
    let mut total_decode_micros = 0_u128;
    let mut max_decode_micros = 0_u128;

    for frame_index in 0..options.frames {
        let packet = aggressive_usb_packet(1, frame_index, options.threshold);
        let decode_started_at = Instant::now();
        let decoded = decode_report(1, &descriptors, &packet).unwrap_or_default();
        let decode_micros = decode_started_at.elapsed().as_micros();
        total_decode_micros += decode_micros;
        max_decode_micros = max_decode_micros.max(decode_micros);

        decoded_events += decoded.len();
        trigger_hits += decoded
            .iter()
            .flat_map(|event| runtime.process_meter_event(event))
            .count();

        simulated_elapsed_ms += options.frame_interval_ms;
        if options.visual_interval_ms == 0
            || simulated_elapsed_ms.saturating_sub(last_visual_emit_ms)
                >= options.visual_interval_ms
        {
            visual_frames += 1;
            last_visual_emit_ms = simulated_elapsed_ms;
        }
    }

    MeterStressReport {
        frames: options.frames,
        decoded_events,
        trigger_hits,
        visual_frames,
        simulated_duration_ms: simulated_elapsed_ms,
        average_decode_micros: if options.frames == 0 {
            0
        } else {
            total_decode_micros / options.frames as u128
        },
        max_decode_micros,
        trigger_to_visual_independent: trigger_hits > visual_frames,
    }
}

fn aggressive_usb_packet(report_id: u32, frame_index: usize, threshold: f32) -> Vec<u8> {
    let mut packet = Vec::with_capacity(4 + 48 * 2);
    packet.extend_from_slice(&report_id.to_be_bytes());
    let usb1 = match frame_index % 4 {
        0 => threshold - 6.0,
        1 => threshold + 1.0,
        2 => threshold - 5.0,
        _ => threshold + 2.0,
    };
    for index in 0..48_usize {
        let db = if index == 0 {
            usb1
        } else {
            ((index % 16) as f32) - 24.0
        };
        let raw = (db * 256.0).round().clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        packet.extend_from_slice(&raw.to_be_bytes());
    }
    packet
}

fn crossed(previous: f32, current: f32, threshold: f32, direction: TriggerDirection) -> bool {
    match direction {
        TriggerDirection::Rising => previous < threshold && current >= threshold,
        TriggerDirection::Falling => previous > threshold && current <= threshold,
    }
}

fn process_trigger_policy(
    trigger: &MeterTrigger,
    state: &mut MeterTriggerState,
    previous_value: f32,
    value: f32,
    now: Instant,
) -> bool {
    let stale = now
        .checked_duration_since(state.last_packet_at)
        .map(|gap| gap.as_millis() as u64 > trigger.policy.stale_after_ms)
        .unwrap_or(false);

    if stale {
        state.last_value = value;
        state.last_packet_at = now;
        state.recent_min = value;
        state.was_hot = threshold_hot(value, trigger.threshold, trigger.direction);
        state.first_hot_at = None;
        return false;
    }

    match trigger.policy.mode {
        MeterTriggerMode::Level => process_level_policy(trigger, state, previous_value, value, now),
        MeterTriggerMode::Transient if trigger.direction == TriggerDirection::Rising => {
            process_rising_transient_policy(trigger, state, value, now)
        }
        MeterTriggerMode::Transient => {
            process_level_policy(trigger, state, previous_value, value, now)
        }
    }
}

fn process_level_policy(
    trigger: &MeterTrigger,
    state: &mut MeterTriggerState,
    previous_value: f32,
    value: f32,
    now: Instant,
) -> bool {
    let should_fire = cooldown_elapsed(state.last_fire_at, trigger.policy.cooldown_ms, now)
        && crossed(previous_value, value, trigger.threshold, trigger.direction);
    state.last_value = value;
    state.last_packet_at = now;
    state.was_hot = threshold_hot(value, trigger.threshold, trigger.direction);
    if should_fire {
        state.last_fire_at = Some(now);
    }
    should_fire
}

fn process_rising_transient_policy(
    trigger: &MeterTrigger,
    state: &mut MeterTriggerState,
    value: f32,
    now: Instant,
) -> bool {
    let hot = value >= trigger.threshold;
    let rising_edge = !state.was_hot && hot;
    let recent_min = state.recent_min.min(value);
    let first_hot_at = if hot {
        Some(state.first_hot_at.unwrap_or(now))
    } else {
        None
    };
    let dwell_elapsed = !hot
        || trigger.policy.dwell_ms == 0
        || first_hot_at
            .and_then(|started| now.checked_duration_since(started))
            .map(|elapsed| elapsed.as_millis() as u64 >= trigger.policy.dwell_ms)
            .unwrap_or(false);
    let cooldown_elapsed = cooldown_elapsed(state.last_fire_at, trigger.policy.cooldown_ms, now);
    let rose_from_recent_min = (value - recent_min) >= trigger.policy.rearm_db;
    let dwell_pending = hot && trigger.policy.dwell_ms > 0 && !dwell_elapsed;
    let should_fire =
        hot && !dwell_pending && cooldown_elapsed && (rising_edge || rose_from_recent_min);

    state.last_value = value;
    state.last_packet_at = now;
    state.first_hot_at = first_hot_at;
    state.was_hot = if dwell_pending { false } else { hot };
    state.recent_min = if should_fire { value } else { recent_min };
    if should_fire {
        state.last_fire_at = Some(now);
    }

    should_fire
}

fn threshold_hot(value: f32, threshold: f32, direction: TriggerDirection) -> bool {
    match direction {
        TriggerDirection::Rising => value >= threshold,
        TriggerDirection::Falling => value <= threshold,
    }
}

fn cooldown_elapsed(last_fire_at: Option<Instant>, cooldown_ms: u64, now: Instant) -> bool {
    last_fire_at
        .and_then(|last_fire_at| now.checked_duration_since(last_fire_at))
        .map(|elapsed| elapsed.as_millis() as u64 >= cooldown_ms)
        .unwrap_or(true)
}

trait MeterFamilyAddress {
    fn address_family(self) -> &'static str;
}

impl MeterFamilyAddress for wing_core::meters::MeterFamily {
    fn address_family(self) -> &'static str {
        match self {
            wing_core::meters::MeterFamily::Source => "source",
            wing_core::meters::MeterFamily::Output => "output",
            wing_core::meters::MeterFamily::Ch => "ch",
            wing_core::meters::MeterFamily::Aux => "aux",
            wing_core::meters::MeterFamily::Bus => "bus",
            wing_core::meters::MeterFamily::Main => "main",
            wing_core::meters::MeterFamily::Matrix => "matrix",
            wing_core::meters::MeterFamily::Dca => "dca",
            wing_core::meters::MeterFamily::Fx => "fx",
            wing_core::meters::MeterFamily::Monitor => "monitor",
            wing_core::meters::MeterFamily::Rta => "rta",
            wing_core::meters::MeterFamily::ChV2 => "chv2",
            wing_core::meters::MeterFamily::AuxV2 => "auxv2",
            wing_core::meters::MeterFamily::BusV2 => "busv2",
            wing_core::meters::MeterFamily::MainV2 => "mainv2",
            wing_core::meters::MeterFamily::MatrixV2 => "matrixv2",
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use wing_core::meters::{decode_report, MeterDescriptor, SOURCE_USB_DEVICE_ID};

    use super::*;

    fn policy_trigger() -> MeterTrigger {
        MeterTrigger {
            id: "policy-boundary".to_string(),
            address: MeterAddress { family: "source", device_id: Some(SOURCE_USB_DEVICE_ID), index: 1, value_slot: 0 },
            threshold: 1.0,
            direction: TriggerDirection::Rising,
            policy: MeterTriggerPolicy { rearm_db: 0.1, stale_after_ms: 10_000, ..MeterTriggerPolicy::fast_transient() },
        }
    }

    fn policy_state(at: Instant) -> MeterTriggerState {
        MeterTriggerState { last_value: 0.0, last_packet_at: at, last_fire_at: None,
            recent_min: 0.0, was_hot: false, first_hot_at: None }
    }

    fn tick(trigger: &MeterTrigger, state: &mut MeterTriggerState, value: f32, at: Instant) -> bool {
        process_trigger_policy(trigger, state, state.last_value, value, at)
    }

    #[test]
    fn transient_dwell_fires_at_its_boundary_and_not_before() {
        let base = Instant::now();
        let mut trigger = policy_trigger();
        trigger.policy.dwell_ms = 50;
        let mut state = policy_state(base);
        assert!(!tick(&trigger, &mut state, 2.0, base + Duration::from_millis(10)), "the first hot sample starts dwell");
        assert!(!tick(&trigger, &mut state, 2.0, base + Duration::from_millis(59)), "49 ms hot is too short");
        assert!(tick(&trigger, &mut state, 2.0, base + Duration::from_millis(60)), "50 ms completes dwell");
        assert!(!tick(&trigger, &mut state, 2.0, base + Duration::from_millis(61)), "a steady level must not repeat");
    }

    #[test]
    fn a_cold_sample_resets_transient_dwell() {
        let base = Instant::now();
        let mut trigger = policy_trigger();
        trigger.policy.dwell_ms = 50;
        let mut state = policy_state(base);
        for (ms, value) in [(10, 2.0), (30, 0.0), (40, 2.0), (89, 2.0)] {
            assert!(!tick(&trigger, &mut state, value, base + Duration::from_millis(ms)), "dwell incomplete at {ms} ms");
        }
        assert!(tick(&trigger, &mut state, 2.0, base + Duration::from_millis(90)), "only the new hot interval counts");
    }

    #[test]
    fn transient_cooldown_expires_at_its_exact_boundary() {
        let base = Instant::now();
        let mut trigger = policy_trigger();
        trigger.policy.cooldown_ms = 1_000;
        let mut state = policy_state(base);
        state.last_fire_at = Some(base);
        assert!(!tick(&trigger, &mut state, 2.0, base + Duration::from_millis(999)), "cooldown still active");
        assert!(tick(&trigger, &mut state, 2.0, base + Duration::from_millis(1_000)), "cooldown expiry is inclusive");
        assert!(!tick(&trigger, &mut state, 2.0, base + Duration::from_millis(1_001)), "the next cooldown has started");
    }

    #[test]
    fn stale_gap_boundary_suppresses_only_the_first_sample_after_expiry() {
        let base = Instant::now();
        let mut trigger = policy_trigger();
        trigger.policy.stale_after_ms = 50;
        let initial = policy_state(base);
        let mut at_boundary = initial;
        assert!(tick(&trigger, &mut at_boundary, 2.0, base + Duration::from_millis(50)), "equal to limit is fresh");
        let mut after_boundary = initial;
        assert!(!tick(&trigger, &mut after_boundary, 2.0, base + Duration::from_millis(51)), "stale hot sample only establishes baseline");
        assert!(!tick(&trigger, &mut after_boundary, 0.0, base + Duration::from_millis(52)));
        assert!(tick(&trigger, &mut after_boundary, 2.0, base + Duration::from_millis(53)), "a fresh crossing works again");
    }

    #[test]
    fn fires_rapid_consecutive_usb_meter_rising_edges() {
        let request = [MeterDescriptor::source_with_indices(
            SOURCE_USB_DEVICE_ID,
            vec![1],
        )];
        let mut runtime = MeterTriggerRuntime::new();
        runtime.replace_triggers(vec![MeterTrigger {
            id: "usb1-hit".to_string(),
            address: MeterAddress {
                family: "source",
                device_id: Some(SOURCE_USB_DEVICE_ID),
                index: 1,
                value_slot: 0,
            },
            threshold: 1.0,
            direction: TriggerDirection::Rising,
            policy: MeterTriggerPolicy::fast_transient(),
        }]);

        let packets = [
            [0, 0, 0, 1, 0, 0],
            [0, 0, 0, 1, 1, 64],
            [0, 0, 0, 1, 0, 0],
            [0, 0, 0, 1, 1, 128],
        ];

        let hits = packets
            .iter()
            .flat_map(|packet| decode_report(1, &request, packet).expect("decode"))
            .flat_map(|event| runtime.process_meter_event(&event))
            .collect::<Vec<_>>();

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].previous_value, 0.0);
        assert_eq!(hits[0].value, 1.25);
        assert_eq!(hits[1].previous_value, 0.0);
        assert_eq!(hits[1].value, 1.5);
    }

    #[test]
    fn falling_edges_are_independent_from_visual_cadence() {
        let request = [MeterDescriptor::source_with_indices(
            SOURCE_USB_DEVICE_ID,
            vec![1],
        )];
        let mut runtime = MeterTriggerRuntime::new();
        runtime.replace_triggers(vec![MeterTrigger {
            id: "usb1-release".to_string(),
            address: MeterAddress {
                family: "source",
                device_id: Some(SOURCE_USB_DEVICE_ID),
                index: 1,
                value_slot: 0,
            },
            threshold: 1.0,
            direction: TriggerDirection::Falling,
            policy: MeterTriggerPolicy::level(),
        }]);

        let packets = [
            [0, 0, 0, 1, 2, 0],
            [0, 0, 0, 1, 0, 128],
            [0, 0, 0, 1, 2, 0],
            [0, 0, 0, 1, 0, 0],
        ];

        let hits = packets
            .iter()
            .flat_map(|packet| decode_report(1, &request, packet).expect("decode"))
            .flat_map(|event| runtime.process_meter_event(&event))
            .collect::<Vec<_>>();

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].value, 0.5);
        assert_eq!(hits[1].value, 0.0);
    }

    #[test]
    fn stress_detects_fast_usb_hits_independent_from_slow_visual_rate() {
        let report = run_usb_meter_stress(MeterStressOptions {
            frames: 120,
            frame_interval_ms: 1,
            visual_interval_ms: 66,
            threshold: 12.0,
        });

        assert_eq!(report.frames, 120);
        assert_eq!(report.decoded_events, 120 * 48);
        assert_eq!(report.trigger_hits, 60);
        assert_eq!(report.visual_frames, 1);
        assert!(report.trigger_to_visual_independent);
    }

    #[test]
    fn transient_policy_can_refire_on_fast_rearm_pulse_while_hot() {
        let request = [MeterDescriptor::source_with_indices(
            SOURCE_USB_DEVICE_ID,
            vec![1],
        )];
        let mut runtime = MeterTriggerRuntime::new();
        runtime.replace_triggers(vec![MeterTrigger {
            id: "usb1-transient".to_string(),
            address: MeterAddress {
                family: "source",
                device_id: Some(SOURCE_USB_DEVICE_ID),
                index: 1,
                value_slot: 0,
            },
            threshold: 1.0,
            direction: TriggerDirection::Rising,
            policy: MeterTriggerPolicy {
                mode: MeterTriggerMode::Transient,
                cooldown_ms: 0,
                rearm_db: 3.0,
                dwell_ms: 0,
                stale_after_ms: 1500,
            },
        }]);
        let packets = [
            [0, 0, 0, 1, 0, 0],
            [0, 0, 0, 1, 2, 0],
            [0, 0, 0, 1, 1, 128],
            [0, 0, 0, 1, 5, 64],
        ];

        let hits = packets
            .iter()
            .flat_map(|packet| decode_report(1, &request, packet).expect("decode"))
            .flat_map(|event| runtime.process_meter_event(&event))
            .collect::<Vec<_>>();

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].value, 2.0);
        assert_eq!(hits[1].value, 5.25);
    }

    #[test]
    fn transient_policy_respects_cooldown() {
        let request = [MeterDescriptor::source_with_indices(
            SOURCE_USB_DEVICE_ID,
            vec![1],
        )];
        let mut runtime = MeterTriggerRuntime::new();
        runtime.replace_triggers(vec![MeterTrigger {
            id: "usb1-cooldown".to_string(),
            address: MeterAddress {
                family: "source",
                device_id: Some(SOURCE_USB_DEVICE_ID),
                index: 1,
                value_slot: 0,
            },
            threshold: 1.0,
            direction: TriggerDirection::Rising,
            policy: MeterTriggerPolicy {
                mode: MeterTriggerMode::Transient,
                cooldown_ms: 1000,
                rearm_db: 0.1,
                dwell_ms: 0,
                stale_after_ms: 1500,
            },
        }]);
        let packets = [
            [0, 0, 0, 1, 0, 0],
            [0, 0, 0, 1, 2, 0],
            [0, 0, 0, 1, 0, 0],
            [0, 0, 0, 1, 2, 0],
        ];

        let hits = packets
            .iter()
            .flat_map(|packet| decode_report(1, &request, packet).expect("decode"))
            .flat_map(|event| runtime.process_meter_event(&event))
            .collect::<Vec<_>>();

        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn transient_policy_suppresses_first_hot_value_after_stale_gap() {
        let request = [MeterDescriptor::source_with_indices(
            SOURCE_USB_DEVICE_ID,
            vec![1],
        )];
        let mut runtime = MeterTriggerRuntime::new();
        runtime.replace_triggers(vec![MeterTrigger {
            id: "usb1-stale".to_string(),
            address: MeterAddress {
                family: "source",
                device_id: Some(SOURCE_USB_DEVICE_ID),
                index: 1,
                value_slot: 0,
            },
            threshold: 1.0,
            direction: TriggerDirection::Rising,
            policy: MeterTriggerPolicy {
                mode: MeterTriggerMode::Transient,
                cooldown_ms: 0,
                rearm_db: 0.1,
                dwell_ms: 0,
                stale_after_ms: 10_000,
            },
        }]);

        let cold = decode_report(1, &request, &[0, 0, 0, 1, 0, 0]).expect("decode");
        assert!(runtime.process_meter_event(&cold[0]).is_empty());
        // Age the recorded packet instead of depending on a 2 ms scheduler delay. The exact
        // boundary is covered separately above with explicit Instants.
        runtime.states.get_mut("usb1-stale").expect("cold packet state").last_packet_at =
            Instant::now() - Duration::from_millis(10_001);
        let stale_hot = decode_report(1, &request, &[0, 0, 0, 1, 2, 0]).expect("decode");
        assert!(runtime.process_meter_event(&stale_hot[0]).is_empty());
        let cold = decode_report(1, &request, &[0, 0, 0, 1, 0, 0]).expect("decode");
        assert!(runtime.process_meter_event(&cold[0]).is_empty());
        let fresh_hot = decode_report(1, &request, &[0, 0, 0, 1, 2, 0]).expect("decode");
        let hits = runtime.process_meter_event(&fresh_hot[0]);

        assert_eq!(hits.len(), 1);
    }
}
