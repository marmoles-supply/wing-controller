//! MIDI ports for the inter-application feature — Phase B, step 1 of
//! `docs/INTER_APP_PLAN_REVIEW_2026-10-02.md`.
//!
//! This step **only looks and counts**. It enumerates the ports the system reports, opens our own two virtual
//! ports when — and only when — the operator has switched the feature on, and keeps counters of what arrives
//! on ours. **Nothing is sent and nothing can trigger a macro.** CoreMIDI delivers on its own thread and the
//! callback below only increments a counter and remembers a summary of the last message, so there is no work
//! per frame and none at all while the switch is off.
//!
//! It lives in its own file because it is the first subsystem in this crate that talks to hardware: the pure
//! parts (`summarise_midi_message`, `is_our_port_name`, `ensure_enabled`) are tested without a MIDI device,
//! which is what lets the gate cover them.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::timecode::TimecodeState;
#[cfg(test)]
use super::timecode::TimecodePosition;
#[cfg(test)]
use super::timecode;

// `create_virtual` is not an inherent method: it lives in these two traits, which is why importing them is
// what makes the virtual ports exist at all. They are Unix-only by midir's own documentation ("implemented…
// on every platform but Windows"), and this application is macOS-only.
#[cfg(unix)]
use midir::os::unix::{VirtualInput, VirtualOutput};

/// The names of our virtual ports. Constants on purpose: another application is configured against them once,
/// and they must not drift between versions.
pub const VIRTUAL_IN_NAME: &str = "WING CONTROLLER In";
pub const VIRTUAL_OUT_NAME: &str = "WING CONTROLLER Out";

/// Both ports carry this prefix, which is also how the interface recognises them as ours.
const OUR_PREFIX: &str = "WING CONTROLLER";

/// Which way a port faces, from this application's point of view.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MidiPortDirection {
    /// Something we could listen to (another application's output, a hardware controller).
    In,
    /// Something we could send to (another application's input, a device).
    Out,
}

/// One port as the interface shows it.
#[derive(Clone, Debug, serde::Serialize)]
pub struct MidiPortInfo {
    pub name: String,
    pub direction: MidiPortDirection,
    /// True for the ports this application owns, so the interface can say "ours" instead of listing them as
    /// peers to connect to.
    pub ours: bool,
}

/// The last message seen on one of our ports, as a sentence a monitor can print.
#[derive(Clone, Debug, serde::Serialize)]
pub struct LastMidiMessage {
    pub port: String,
    pub summary: String,
    pub at_ms: u64,
}

/// Counters and the last message. Nothing here is actionable: this step cannot trigger anything.
/// A condition on a value the other application sends: "only fire if this is true".
///
/// It is a **separate address** from the trigger's own: the trigger says *what happened* (a button was pressed)
/// and the condition says *what must also be true* (a fader is up). Both are needed, and conflating them would
/// lose the case that matters most — a button that only works when something else is ready.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct MidiConditionSpec {
    pub kind: MidiMessageKind,
    /// 0 means any channel.
    pub channel: u8,
    /// 255 means any number.
    pub number: u8,
    pub operator: MidiValueOperator,
    pub value: u8,
    /// How long a value stays good for. `0` means it never goes stale, which is a choice the operator makes
    /// deliberately: a condition that never expires can be met by a number from an hour ago.
    #[serde(default)]
    pub stale_ms: u64,
}

/// What a condition decided, and why. The reason is not decoration: "never received" and "received and false"
/// are two different sentences, and an operator debugging a macro needs to know which one they are looking at.
#[derive(Clone, Debug, Serialize)]
pub struct MidiConditionVerdict {
    pub met: bool,
    pub reason: String,
}

impl MidiConditionSpec {
    /// Decide, from the last value tracked for this address and the current time.
    pub fn evaluate(&self, tracked: Option<(u8, u64)>, now_ms: u64) -> MidiConditionVerdict {
        let Some((value, at_ms)) = tracked else {
            return MidiConditionVerdict {
                met: false,
                reason: format!("no value has arrived for {} yet", self.describe()),
            };
        };
        if self.stale_ms > 0 && now_ms.saturating_sub(at_ms) > self.stale_ms {
            return MidiConditionVerdict {
                met: false,
                reason: format!(
                    "{} last arrived {:.1} s ago (stale after {:.1} s)",
                    self.describe(),
                    now_ms.saturating_sub(at_ms) as f64 / 1000.0,
                    self.stale_ms as f64 / 1000.0
                ),
            };
        }
        let met = self.operator.compare(value, self.value);
        MidiConditionVerdict {
            met,
            reason: if met {
                format!("{} is {value}", self.describe())
            } else {
                format!("{} is {value}, which is not what the condition asks for", self.describe())
            },
        }
    }

    pub fn describe(&self) -> String {
        let kind = match self.kind {
            MidiMessageKind::NoteOn => "note on",
            MidiMessageKind::NoteOff => "note off",
            MidiMessageKind::ControlChange => "control change",
            MidiMessageKind::ProgramChange => "program change",
            MidiMessageKind::PitchBend => "pitch bend",
        };
        let channel = if self.channel == 0 {
            "any channel".to_string()
        } else {
            format!("channel {}", self.channel)
        };
        let number = if self.number == ANY_NUMBER {
            "any number".to_string()
        } else {
            format!("number {}", self.number)
        };
        let operator = match self.operator {
            MidiValueOperator::Equal => "=",
            MidiValueOperator::NotEqual => "≠",
            MidiValueOperator::Greater => ">",
            MidiValueOperator::GreaterOrEqual => "≥",
            MidiValueOperator::Less => "<",
            MidiValueOperator::LessOrEqual => "≤",
        };
        format!("{kind} · {channel} · {number} {operator} {}", self.value)
    }
}

/// The last value seen for one watched address.
#[derive(Clone, Copy, Debug)]
struct TrackedValue {
    kind: MidiMessageKind,
    channel: u8,
    number: u8,
    last: Option<(u8, u64)>,
}

/// A trigger and the condition that must also hold for it, as the window configured it.
///
/// The pairing lives here because the **evaluation has to happen where the message arrives**: the condition is
/// about the value of another address at the moment the trigger fires, and asking for that later would be asking
/// about a different moment.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MidiRule {
    pub spec: MidiTriggerSpec,
    pub require: Option<MidiConditionSpec>,
}

/// One configured trigger matching one message, handed from CoreMIDI's thread to the application.
///
/// It is a **message to the window**, not a macro run: the macro library lives in the window, and so do the
/// guards, the Stop button and the overlap policy that a fired macro must go through. Running one from this
/// process would mean a second firing path with a second set of rules, which is exactly how two paths drift.
#[derive(Clone, Debug, Serialize)]
pub struct MidiTriggerEvent {
    pub trigger_id: String,
    pub description: String,
    pub at_ms: u64,
    /// `None` when the binding has no condition. When it does, this says whether it held **and why not**, so the
    /// window can refuse to fire and give the operator the sentence that explains it.
    pub condition: Option<MidiConditionVerdict>,
}

/// How many matches may wait to be handed over. A concert's worth of button presses fits many times over; a
/// feedback loop does not, and it is dropped and counted instead of growing.
pub const TRIGGER_QUEUE_CAPACITY: usize = 256;

/// The last trigger that matched, for the monitor and the log.
#[derive(Clone, Debug, Serialize)]
pub struct LastMidiMatch {
    pub trigger_id: String,
    pub description: String,
    pub at_ms: u64,
}

#[derive(Debug, Default)]
pub struct MidiMonitor {
    received: AtomicU64,
    dropped: AtomicU64,
    matches: AtomicU64,
    matches_dropped: AtomicU64,
    last: Mutex<Option<LastMidiMessage>>,
    last_match: Mutex<Option<LastMidiMatch>>,
    /// The last message in its decoded form: what **Learn** builds a trigger from. A summary string is enough
    /// to show an operator and not enough to match on, which is why both are kept.
    last_decoded: Mutex<Option<MidiMessage>>,
}

/// What the window is shown about the monitor.
#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct MidiMonitorSnapshot {
    pub received: u64,
    pub dropped: u64,
    pub matches: u64,
    pub matches_dropped: u64,
    pub last: Option<LastMidiMessage>,
    pub last_match: Option<LastMidiMatch>,
}

impl MidiMonitor {
    pub fn snapshot(&self) -> MidiMonitorSnapshot {
        MidiMonitorSnapshot {
            received: self.received.load(Ordering::Relaxed),
            dropped: self.dropped.load(Ordering::Relaxed),
            matches: self.matches.load(Ordering::Relaxed),
            matches_dropped: self.matches_dropped.load(Ordering::Relaxed),
            last: self.last.lock().ok().and_then(|guard| guard.clone()),
            last_match: self.last_match.lock().ok().and_then(|guard| guard.clone()),
        }
    }

    /// Record one arriving message. Called from CoreMIDI's own thread, so it does the least possible work:
    /// two atomic writes and, at most, one small string.
    pub fn record(&self, port: &str, bytes: &[u8], at_ms: u64) {
        self.received.fetch_add(1, Ordering::Relaxed);
        if let Some(message) = decode_midi_message(bytes) {
            if let Ok(mut guard) = self.last_decoded.lock() {
                *guard = Some(message);
            }
        }
        let summary = match summarise_midi_message(bytes) {
            Some(summary) => summary,
            None => {
                // A message too short to be MIDI at all is counted as dropped rather than summarised into
                // something an operator would believe.
                self.dropped.fetch_add(1, Ordering::Relaxed);
                return;
            }
        };
        if let Ok(mut guard) = self.last.lock() {
            *guard = Some(LastMidiMessage {
                port: port.to_string(),
                summary,
                at_ms,
            });
        }
    }
}

impl MidiMonitor {
    /// Note that a configured trigger matched. Called from CoreMIDI's thread, like `record`.
    /// A match that could not be handed over because the queue was full. Counted, never queued: a flood has
    /// to cost a number, not a backlog and not a freeze.
    pub fn record_match_dropped(&self) {
        self.matches_dropped.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_match(&self, trigger_id: &str, description: &str, at_ms: u64) {
        self.matches.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut guard) = self.last_match.lock() {
            *guard = Some(LastMidiMatch {
                trigger_id: trigger_id.to_string(),
                description: description.to_string(),
                at_ms,
            });
        }
    }
}

/// Remember a message's value for every condition that watches its address.
///
/// Free functions rather than methods so that the CoreMIDI closure — which cannot borrow the runtime while it
/// holds its locks — and the runtime's own accessors share one implementation instead of two that drift.
fn track(watched: &Arc<Mutex<Vec<TrackedValue>>>, message: &MidiMessage, at_ms: u64) {
    if let Ok(mut guard) = watched.lock() {
        for tracked in guard.iter_mut() {
            if tracked.kind == message.kind
                && (tracked.channel == 0 || tracked.channel == message.channel)
                && (tracked.number == ANY_NUMBER || tracked.number == message.number)
            {
                tracked.last = Some((message.value, at_ms));
            }
        }
    }
}

/// The last value tracked for one condition's address, or nothing if it has never arrived.
fn tracked_value(
    watched: &Arc<Mutex<Vec<TrackedValue>>>,
    condition: &MidiConditionSpec,
) -> Option<(u8, u64)> {
    watched.lock().ok().and_then(|guard| {
        guard
            .iter()
            .find(|tracked| {
                tracked.kind == condition.kind
                    && tracked.channel == condition.channel
                    && tracked.number == condition.number
            })
            .and_then(|tracked| tracked.last)
    })
}

/// True when a port name is one of ours.
pub fn is_our_port_name(name: &str) -> bool {
    name.starts_with(OUR_PREFIX)
}

/// The refusal that keeps this feature out of a show it is not wanted in.
///
/// The switch is the master gate, and this is the one place that decides: with it off, opening a port is an
/// error that names the switch, not a silent nothing (which would look like a broken port) and not a port
/// opened anyway (which is what the operator switched off).
pub fn ensure_enabled(enabled: bool) -> Result<(), String> {
    if enabled {
        Ok(())
    } else {
        Err("talking to other applications is switched off (Settings → MIDI, Inter-app OSC): no MIDI port is \
             opened while it is off"
            .to_string())
    }
}

/// A raw MIDI message as a monitor prints it. Pure, so the gate can test it without a MIDI device.
///
/// It summarises and never interprets: turning a message into a *trigger* or a *condition* is a later phase,
/// and until then the honest thing for the interface to show is what arrived, byte for byte in words.
pub fn summarise_midi_message(bytes: &[u8]) -> Option<String> {
    let status = *bytes.first()?;
    if status < 0x80 {
        // Running status without a stored status byte: not something this monitor may guess at.
        return None;
    }
    let kind = status & 0xF0;
    let channel = (status & 0x0F) + 1;
    let data = |index: usize| bytes.get(index + 1).copied();
    match kind {
        0x80 => Some(format!(
            "note off · channel {channel} · note {} · velocity {}",
            data(0)?,
            data(1)?
        )),
        0x90 => {
            let (note, velocity) = (data(0)?, data(1)?);
            // Velocity 0 is the running-status way of writing note off, and saying so is the difference
            // between a monitor an operator trusts and one they argue with.
            if velocity == 0 {
                Some(format!("note off · channel {channel} · note {note} · velocity 0"))
            } else {
                Some(format!("note on · channel {channel} · note {note} · velocity {velocity}"))
            }
        }
        0xA0 => Some(format!(
            "aftertouch · channel {channel} · note {} · pressure {}",
            data(0)?,
            data(1)?
        )),
        0xB0 => Some(format!(
            "control change · channel {channel} · controller {} · value {}",
            data(0)?,
            data(1)?
        )),
        0xC0 => Some(format!("program change · channel {channel} · program {}", data(0)?)),
        0xD0 => Some(format!("channel pressure · channel {channel} · pressure {}", data(0)?)),
        0xE0 => {
            let value = ((data(1)? as u16) << 7) | data(0)? as u16;
            Some(format!("pitch bend · channel {channel} · value {value}"))
        }
        _ => Some(format!("system message · status 0x{status:02X}")),
    }
}

/// One incoming MIDI message, decoded. This is what a trigger is matched against and what Learn captures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MidiMessage {
    pub kind: MidiMessageKind,
    /// 1…16, as printed on every device.
    pub channel: u8,
    pub number: u8,
    pub value: u8,
}

/// Decode a message into the things a trigger cares about, or refuse it.
///
/// The one rule worth stating: a **note on with velocity 0 is a note off**. Every keyboard and every
/// application that sends running status relies on it, so a trigger configured for "note off" must catch it —
/// and a trigger for "note on" must not fire on the release of a key.
pub fn decode_midi_message(bytes: &[u8]) -> Option<MidiMessage> {
    let status = *bytes.first()?;
    if status < 0x80 || status >= 0xF0 {
        // System messages are not triggers: they carry no channel and no note to match on.
        return None;
    }
    let channel = (status & 0x0F) + 1;
    let number = |index: usize| bytes.get(index + 1).copied();
    let value = |index: usize| bytes.get(index + 2).copied();
    match status & 0xF0 {
        0x80 => Some(MidiMessage {
            kind: MidiMessageKind::NoteOff,
            channel,
            number: number(0)?,
            value: value(0)?,
        }),
        0x90 => {
            let (note, velocity) = (number(0)?, value(0)?);
            Some(MidiMessage {
                kind: if velocity == 0 {
                    MidiMessageKind::NoteOff
                } else {
                    MidiMessageKind::NoteOn
                },
                channel,
                number: note,
                value: velocity,
            })
        }
        0xB0 => Some(MidiMessage {
            kind: MidiMessageKind::ControlChange,
            channel,
            number: number(0)?,
            value: value(0)?,
        }),
        0xC0 => Some(MidiMessage {
            kind: MidiMessageKind::ProgramChange,
            channel,
            number: number(0)?,
            value: 0,
        }),
        0xE0 => {
            let (low, high) = (number(0)?, value(0)?);
            Some(MidiMessage {
                kind: MidiMessageKind::PitchBend,
                channel,
                number: low,
                value: high,
            })
        }
        _ => None,
    }
}

/// How the value of an incoming message is compared.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MidiValueOperator {
    Equal,
    NotEqual,
    Greater,
    GreaterOrEqual,
    Less,
    LessOrEqual,
}

impl MidiValueOperator {
    fn compare(self, received: u8, wanted: u8) -> bool {
        match self {
            MidiValueOperator::Equal => received == wanted,
            MidiValueOperator::NotEqual => received != wanted,
            MidiValueOperator::Greater => received > wanted,
            MidiValueOperator::GreaterOrEqual => received >= wanted,
            MidiValueOperator::Less => received < wanted,
            MidiValueOperator::LessOrEqual => received <= wanted,
        }
    }
}

/// What a MIDI trigger listens for.
///
/// "Any" is written as a value a real message cannot carry — channel 0 and number 255 — rather than as an
/// `Option`, so that the stored shape an operator sees in a backup is one thing and not two. The value
/// comparison is optional because "the button was pressed" is a legitimate trigger on its own, whatever
/// velocity the application happened to send.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MidiTriggerSpec {
    /// The macro library's name for this trigger, so a match can say which one fired.
    pub trigger_id: String,
    pub kind: MidiMessageKind,
    pub channel: u8,
    pub number: u8,
    pub operator: Option<MidiValueOperator>,
    pub value: u8,
}

impl MidiTriggerSpec {
    /// True when this trigger is about that message.
    pub fn matches(&self, message: &MidiMessage) -> bool {
        if self.kind != message.kind {
            return false;
        }
        if self.channel != 0 && self.channel != message.channel {
            return false;
        }
        if self.number != ANY_NUMBER && self.number != message.number {
            return false;
        }
        match self.operator {
            None => true,
            Some(operator) => operator.compare(message.value, self.value),
        }
    }

    /// What Learn does: build a trigger from the message that just arrived.
    ///
    /// It captures the **kind, the channel and the number** — what the operator physically did — and leaves
    /// the value open. Learning a threshold from a single press would be inventing one, and the operator can
    /// add it deliberately in the editor. The learned trigger always matches the message it came from, which
    /// is the property the test asserts.
    pub fn from_learned(trigger_id: String, message: &MidiMessage) -> Self {
        MidiTriggerSpec {
            trigger_id,
            kind: message.kind,
            channel: message.channel,
            number: message.number,
            operator: None,
            value: 0,
        }
    }

    /// How the editor and the log describe it.
    pub fn describe(&self) -> String {
        let channel = if self.channel == 0 {
            "any channel".to_string()
        } else {
            format!("channel {}", self.channel)
        };
        let number = if self.number == ANY_NUMBER {
            "any".to_string()
        } else {
            self.number.to_string()
        };
        let kind = match self.kind {
            MidiMessageKind::NoteOn => "note on",
            MidiMessageKind::NoteOff => "note off",
            MidiMessageKind::ControlChange => "control change",
            MidiMessageKind::ProgramChange => "program change",
            MidiMessageKind::PitchBend => "pitch bend",
        };
        match self.operator {
            None => format!("{kind} · {channel} · number {number} · any value"),
            Some(operator) => format!(
                "{kind} · {channel} · number {number} · value {} {}",
                match operator {
                    MidiValueOperator::Equal => "=",
                    MidiValueOperator::NotEqual => "≠",
                    MidiValueOperator::Greater => ">",
                    MidiValueOperator::GreaterOrEqual => "≥",
                    MidiValueOperator::Less => "<",
                    MidiValueOperator::LessOrEqual => "≤",
                },
                self.value
            ),
        }
    }
}

/// The number that means "any number" in a trigger. Notes and controllers stop at 127.
pub const ANY_NUMBER: u8 = 255;

/// The application-lifetime forwarding worker shares the runtime's output lock.
/// Closing ports invalidates the output epoch; it does not join that worker.
#[derive(Clone)]
pub struct MtcSender {
    runtime: std::sync::Arc<MidiRuntime>,
}

impl MtcSender {
    pub fn state(&self) -> (u64, bool) {
        (self.runtime.output_epoch.load(Ordering::SeqCst), self.runtime.mtc_forwarding() && self.runtime.is_open())
    }
    pub fn send(&self, epoch: u64, source_epoch: u64, message: &[u8]) -> Result<(), String> {
        self.runtime.send_timecode_message(epoch, source_epoch, message)
    }
    pub fn report(&self, error: Option<String>) { self.runtime.timecode.set_forwarding_error(error); }
}

#[cfg(test)]
pub fn mtc_messages(position: &TimecodePosition) -> Vec<Vec<u8>> {
    let mut messages=vec![super::mtc_forward::full_frame(*position)];
    messages.extend((0..8).map(|piece| super::mtc_forward::quarter_frame(*position,piece)));
    messages
}

/// A MIDI message this application can send. The list is deliberately closed: what is not here cannot be sent.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MidiMessageKind {
    NoteOn,
    NoteOff,
    ControlChange,
    ProgramChange,
    /// 14-bit pitch bend; `value` is 0…16383 and `number` is unused.
    PitchBend,
}

/// One message, described the way an operator thinks about it and validated before anything is sent.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct MidiMessageSpec {
    pub kind: MidiMessageKind,
    /// 1…16, as it is printed on every device.
    pub channel: u8,
    /// Note number, controller number or program number, depending on `kind`. 0…127.
    pub number: u8,
    /// 0…127, except pitch bend where it is 0…16383.
    pub value: u8,
}

impl MidiMessageSpec {
    /// The bytes, or the reason they cannot be built.
    ///
    /// Every range is checked **here** and refuses: a value of 200 is a mistake to be told about, never a 72
    /// to be sent quietly. That rule is the whole reason this function returns a `Result`.
    pub fn bytes(&self) -> Result<Vec<u8>, String> {
        if !(1..=16).contains(&self.channel) {
            return Err(format!(
                "MIDI channels run from 1 to 16; {} is not a channel",
                self.channel
            ));
        }
        // The channel is the **low** nibble and the message kind supplies the high one. Writing this the other
        // way round turns a note on into a system message (0x90 became 0xF0) that every application ignores
        // without complaining — the silent nothing this project refuses to ship. The encoding test caught it.
        let channel_nibble = self.channel - 1;
        match self.kind {
            MidiMessageKind::NoteOn | MidiMessageKind::NoteOff => {
                if self.number > 127 {
                    return Err(format!("note numbers run from 0 to 127; {} is not one", self.number));
                }
                if self.value > 127 {
                    return Err(format!("velocity runs from 0 to 127; {} is not one", self.value));
                }
                let kind = if self.kind == MidiMessageKind::NoteOn { 0x90 } else { 0x80 };
                Ok(vec![kind | channel_nibble, self.number, self.value])
            }
            MidiMessageKind::ControlChange => {
                if self.number > 127 {
                    return Err(format!("controller numbers run from 0 to 127; {} is not one", self.number));
                }
                if self.value > 127 {
                    return Err(format!("controller values run from 0 to 127; {} is not one", self.value));
                }
                Ok(vec![0xB0 | channel_nibble, self.number, self.value])
            }
            MidiMessageKind::ProgramChange => {
                if self.number > 127 {
                    return Err(format!("program numbers run from 0 to 127; {} is not one", self.number));
                }
                Ok(vec![0xC0 | channel_nibble, self.number])
            }
            MidiMessageKind::PitchBend => {
                if self.value > 127 {
                    return Err(
                        "pitch bend is sent as two 7-bit halves in this build: give the high half (0…127) and \
                         the low half in the controller field"
                            .to_string(),
                    );
                }
                if self.number > 127 {
                    return Err(format!("the low half of a pitch bend runs from 0 to 127; {} is not one", self.number));
                }
                Ok(vec![0xE0 | channel_nibble, self.number, self.value])
            }
        }
    }

    /// What the result line says: the message in words, so the operator sees what left rather than "ok".
    pub fn describe(&self) -> String {
        let channel = self.channel;
        match self.kind {
            MidiMessageKind::NoteOn => {
                format!("sent note on · channel {channel} · note {} · velocity {}", self.number, self.value)
            }
            MidiMessageKind::NoteOff => {
                format!("sent note off · channel {channel} · note {} · velocity {}", self.number, self.value)
            }
            MidiMessageKind::ControlChange => format!(
                "sent control change · channel {channel} · controller {} · value {}",
                self.number, self.value
            ),
            MidiMessageKind::ProgramChange => {
                format!("sent program change · channel {channel} · program {}", self.number)
            }
            MidiMessageKind::PitchBend => {
                format!("sent pitch bend · channel {channel} · high {} · low {}", self.value, self.number)
            }
        }
    }
}

/// What PANIC STOP sends on the MIDI output: **All Sound Off** and **All Notes Off** on every channel.
///
/// This is the one MIDI behaviour that belongs to the emergency path. A stuck note that outlives the panic
/// that stopped everything else is exactly the sort of thing an operator never forgives, and MIDI has no way
/// to ask "is anything sounding?" — so the answer is to say it to all sixteen channels.
pub fn panic_messages() -> Vec<Vec<u8>> {
    (0u8..16)
        .flat_map(|channel| {
            vec![
                vec![0xB0 | channel, 120, 0], // All Sound Off
                vec![0xB0 | channel, 123, 0], // All Notes Off
            ]
        })
        .collect()
}

/// The runtime: whether our ports are open, and the monitor behind them.
///
/// The connections are held here so dropping this value closes them — the same discipline as the meter
/// streams, where a connection that outlives its owner is what leaves a session talking to nothing.
#[derive(Default)]
pub struct MidiRuntime {
    lifecycle: Mutex<()>,
    input_generation: AtomicU64,
    enabled: AtomicBool,
    /// Whether what arrives is passed on as MTC. See `set_mtc_forwarding` — it is a setting the consumer reads, and
    /// **not** the presence of a sink, which is what it used to be (D9).
    mtc_forwarding: AtomicBool,
    output_epoch: AtomicU64,
    monitor: Arc<MidiMonitor>,
    sent: AtomicU64,
    /// What the window has configured this application to listen for, each with the condition that must also
    /// hold. Empty by default, and read on CoreMIDI's own thread: a handful of comparisons per message, nothing
    /// per frame.
    rules: Arc<Mutex<Vec<MidiRule>>>,
    /// The last value of every address some condition watches. **Bounded by the configured conditions**, never by
    /// what a sender chooses to send: a stream of a million different controllers cannot make this grow.
    watched: Arc<Mutex<Vec<TrackedValue>>>,
    /// The timecode the system messages on this stream are making.
    ///
    /// MTC is a MIDI message, so it arrives on a port this application already has open — no second listener, no
    /// second device, which is exactly why the timecode plan puts MTC first. The state ignores everything that is
    /// not MTC, so a clock tick on the same port costs a comparison.
    timecode: Arc<TimecodeState>,
    /// Where matches are handed over, when the application asked for them. `None` means "count them and say
    /// nothing", which is what the tests and the monitor-only case use.
    sink: Arc<Mutex<Option<std::sync::mpsc::SyncSender<MidiTriggerEvent>>>>,
    input: Mutex<Option<midir::MidiInputConnection<()>>>,
    output: Mutex<Option<midir::MidiOutputConnection>>,
}

impl MidiRuntime {
    pub fn is_open(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// Whether what this application receives is **passed on** as MTC on our virtual output.
    ///
    /// **A flag here rather than the presence of a subscribed sink**, and that is D9: the position sink has to exist
    /// whenever the application runs. Its consumer paces the outgoing clock; a separate worker persists the
    /// as-run record even when positions stop. So "forward or not" stops being expressed by installing
    /// and removing the sink, and becomes what it always was: a setting the consumer reads before it sends.
    ///
    /// It lives on the runtime for the same reason `enabled` does: it is what the sender consults, the sender already
    /// holds this, and a second home would be a second answer to "are we forwarding".
    pub fn set_mtc_forwarding(&self, on: bool) {
        let _output = self.output.lock().unwrap_or_else(|e| e.into_inner());
        if self.mtc_forwarding.swap(on, Ordering::SeqCst) != on { self.output_epoch.fetch_add(1, Ordering::SeqCst); }
        self.timecode.set_forwarding_error(None);
    }

    pub fn mtc_forwarding(&self) -> bool {
        self.mtc_forwarding.load(Ordering::Relaxed)
    }

    pub fn snapshot(&self) -> MidiMonitorSnapshot {
        self.monitor.snapshot()
    }

    /// Replace the configured triggers. Allowed whatever the switch says: this is configuration, and it only
    /// has an effect while the ports are open.
    pub fn configure(&self, rules: Vec<MidiRule>) {
        // The watched addresses are derived from the rules here, so a condition can never be evaluated against a
        // value nobody was tracking: the two lists cannot drift apart because one is built from the other.
        let watched = rules
            .iter()
            .filter_map(|rule| rule.require)
            .map(|condition| TrackedValue {
                kind: condition.kind,
                channel: condition.channel,
                number: condition.number,
                last: None,
            })
            .collect();
        if let Ok(mut guard) = self.rules.lock() {
            *guard = rules;
        }
        if let Ok(mut guard) = self.watched.lock() {
            *guard = watched;
        }
    }

    /// How many conditions are configured, for the counters the operator reads.
    pub fn condition_count(&self) -> usize {
        self.watched.lock().map(|guard| guard.len()).unwrap_or(0)
    }

    /// Remember this message's value if any condition watches its address. Called **before** the rules are
    /// evaluated, so a message that is both a condition and a trigger counts as satisfied: the order is the whole
    /// point, and there is a test for it.
    /// Learn: build a trigger from the **last message that arrived**, which is what the operator just did in
    /// the other application.
    ///
    /// It refuses when nothing has arrived, and says what to do about it: a learned trigger with no message
    /// would be one that matches everything, which is the opposite of what Learn is for.
    pub fn learn(&self, trigger_id: &str) -> Result<MidiTriggerSpec, String> {
        let message = self
            .monitor
            .last_decoded
            .lock()
            .ok()
            .and_then(|guard| *guard)
            .ok_or_else(|| {
                "nothing has arrived yet: press the button or move the control in the other application, \
                 then press Learn"
                    .to_string()
            })?;
        Ok(MidiTriggerSpec::from_learned(trigger_id.to_string(), &message))
    }

    /// Shared runtime access for the one forwarding worker, whose epoch is retired on close.
    pub fn mtc_sender(runtime: &std::sync::Arc<MidiRuntime>) -> MtcSender {
        MtcSender {
            runtime: std::sync::Arc::clone(runtime),
        }
    }

    /// Only the paced worker sends timecode. Epoch/setting/connection are checked
    /// under the output lock: closing/reopening cannot inherit a partial cycle.
    fn send_timecode_message(&self, epoch: u64, source_epoch: u64, message: &[u8]) -> Result<(), String> {
        let mut guard = self.output.lock().map_err(|_| "The MIDI output is unavailable".to_string())?;
        if !self.mtc_forwarding() || self.output_epoch.load(Ordering::SeqCst) != epoch || self.timecode.source_epoch() != source_epoch {
            return Err("MTC forwarding changed before the message was sent".into());
        }
        let connection=guard.as_mut().ok_or_else(|| "Our MIDI ports are not open".to_string())?;
        connection.send(message).map_err(|error| format!("The MTC message could not be sent: {error}"))?;
        self.sent.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    /// The timecode this stream is feeding, for the readout and for the cue engine to come.
    pub fn timecode(&self) -> Arc<TimecodeState> {
        Arc::clone(&self.timecode)
    }

    /// How many triggers are configured, for the counters the operator reads.
    pub fn trigger_count(&self) -> usize {
        self.rules.lock().map(|guard| guard.len()).unwrap_or(0)
    }

    /// How many messages have left, for the counters the operator reads.
    pub fn sent(&self) -> u64 {
        self.sent.load(Ordering::Relaxed)
    }

    /// Open our two virtual ports. Refuses when the operator's switch is off, closes what was open before, and
    /// is safe to call twice.
    ///
    /// The switch is **passed in** rather than read from this object: the object's own flag records whether
    /// the ports are open, so consulting it here would be circular — the first call would always refuse
    /// because nothing had been opened yet. That is not a hypothetical: it was written that way first.
    pub fn open(
        &self,
        enabled: bool,
        sink: Option<std::sync::mpsc::SyncSender<MidiTriggerEvent>>,
    ) -> Result<Vec<MidiPortInfo>, String> {
        ensure_enabled(enabled)?;
        // Close first, install the sink **after**: `close` clears it (that is how the previous consumer is
        // ended), so installing it before would leave this open with no way to hand anything over. Written the
        // wrong way round first, and the order is the whole point.
        let _operation = self.lifecycle.lock().map_err(|_| "The MIDI ports are unavailable".to_string())?;
        self.close_inner();
        let generation = self.input_generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut guard) = self.sink.lock() {
            *guard = sink;
        }
        let monitor = Arc::clone(&self.monitor);
        let rules = Arc::clone(&self.rules);
        let watched = Arc::clone(&self.watched);
        let timecode = Arc::clone(&self.timecode);
        let sink = Arc::clone(&self.sink);
        let input = midir::MidiInput::new("WING CONTROLLER (input)")
            .map_err(|error| format!("CoreMIDI could not be reached: {error}"))?;
        let connection = input
            .create_virtual(
                VIRTUAL_IN_NAME,
                move |at, bytes, _| {
                    // CoreMIDI's thread: counters, and a comparison per configured trigger. The timestamp
                    // midir hands over is microseconds, so this is milliseconds. Nothing is fired from here:
                    // running a macro on this thread would put a show's work in a driver callback, so the
                    // next step hands matches to the application through a queue instead.
                    let at_ms = at / 1000;
                    monitor.record(VIRTUAL_IN_NAME, bytes, at_ms);
                    // Timecode first, because it is only ever system messages and the trigger path below ignores
                    // them: feeding it here is what makes MTC work with no second listener at all.
                    timecode.feed_mtc_generation(generation, bytes, std::time::Instant::now());
                    // Persistence belongs to its own periodic worker. This driver callback never writes a file.
                    if let Some(message) = decode_midi_message(bytes) {
                        // The value is remembered **before** the rules run, so a message that is both the
                        // condition and the trigger counts as satisfied when it arrives. The order is the whole
                        // point and there is a test for it.
                        track(&watched, &message, at_ms);
                        if let Ok(guards) = rules.lock() {
                            for rule in guards.iter().filter(|rule| rule.spec.matches(&message)) {
                                let description = rule.spec.describe();
                                monitor.record_match(&rule.spec.trigger_id, &description, at_ms);
                                let condition = rule.require.map(|condition| {
                                    condition.evaluate(tracked_value(&watched, &condition), at_ms)
                                });
                                let event = MidiTriggerEvent {
                                    trigger_id: rule.spec.trigger_id.clone(),
                                    description,
                                    at_ms,
                                    condition,
                                };
                                // `try_send`, never `send`: this is a driver thread, and waiting here would be
                                // waiting inside CoreMIDI. A full queue is a counted drop.
                                let handed_over = sink
                                    .lock()
                                    .ok()
                                    .and_then(|guard| guard.as_ref().map(|sender| sender.try_send(event)))
                                    .map(|result| result.is_ok())
                                    .unwrap_or(false);
                                if !handed_over {
                                    monitor.record_match_dropped();
                                }
                            }
                        }
                    }
                },
                (),
            )
            .map_err(|error| format!("the virtual MIDI input could not be created: {error}"))?;
        let output = midir::MidiOutput::new("WING CONTROLLER (output)")
            .map_err(|error| format!("CoreMIDI could not be reached: {error}"))?;
        let output_connection = output
            .create_virtual(VIRTUAL_OUT_NAME)
            .map_err(|error| format!("the virtual MIDI output could not be created: {error}"))?;
        if let Ok(mut guard) = self.input.lock() {
            *guard = Some(connection);
        }
        if let Ok(mut guard) = self.output.lock() {
            self.output_epoch.fetch_add(1, Ordering::SeqCst);
            *guard = Some(output_connection);
        }
        self.timecode.activate_midi_input(generation);
        self.enabled.store(true, Ordering::Relaxed);
        Ok(self.ports()?)
    }

    /// Close our ports. Idempotent, and never fails: a port that cannot be closed must not keep the switch on.
    pub fn close(&self) {
        let _operation = self.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        self.close_inner();
    }
    fn close_inner(&self) {
        let generation = self.input_generation.fetch_add(1, Ordering::SeqCst);
        self.timecode.retire_midi_input(generation);
        // Dropping the sink ends the consumer's `recv()`, which is how its thread exits: no polling, no
        // shutdown flag, nothing to forget.
        if let Ok(mut guard) = self.sink.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.input.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.output.lock() {
            self.output_epoch.fetch_add(1, Ordering::SeqCst);
            *guard = None;
        }
        self.enabled.store(false, Ordering::Relaxed);
    }

    /// Send one message on our virtual output.
    ///
    /// `sent` is the only thing this can honestly report: MIDI has no acknowledgement, and this application
    /// does not invent one. The sentence that comes back says what left, not "ok".
    pub fn send(&self, spec: &MidiMessageSpec) -> Result<String, String> { self.send_when(spec, || true) }
    pub fn send_when(&self, spec: &MidiMessageSpec, allowed: impl Fn() -> bool) -> Result<String, String> {
        // Validated first: a message that is wrong is refused whether or not a port happens to be open, so the
        // operator's mistake is what they are told about.
        let bytes = spec.bytes()?;
        let mut guard = self
            .output
            .lock()
            .map_err(|_| "the MIDI output is unavailable".to_string())?;
        if !allowed() { return Err("MIDI action cancelled before sending".into()); }
        let connection = guard.as_mut().ok_or_else(|| {
            "our MIDI ports are not open (Settings → MIDI, Inter-app OSC → Open our ports)".to_string()
        })?;
        connection
            .send(&bytes)
            .map_err(|error| format!("the message could not be sent: {error}"))?;
        self.sent.fetch_add(1, Ordering::Relaxed);
        Ok(spec.describe())
    }

    /// PANIC STOP's MIDI half. Best effort and never fatal: if our ports are closed, or a message cannot
    /// leave, the console stop must still have happened. Returns what it managed, for the session log.
    pub fn panic(&self) -> Vec<String> {
        let mut outcomes = Vec::new();
        if !self.is_open() {
            return outcomes;
        }
        for bytes in panic_messages() {
            let mut guard = match self.output.lock() {
                Ok(guard) => guard,
                Err(_) => {
                    outcomes.push("the MIDI panic could not run: the output is unavailable".to_string());
                    break;
                }
            };
            match guard.as_mut() {
                Some(connection) => {
                    if let Err(error) = connection.send(&bytes) {
                        outcomes.push(format!("a MIDI panic message could not be sent: {error}"));
                        break;
                    }
                    self.sent.fetch_add(1, Ordering::Relaxed);
                }
                None => break,
            }
        }
        if outcomes.is_empty() {
            outcomes.push(format!(
                "MIDI panic sent (All Sound Off and All Notes Off on 16 channels, {} messages)",
                panic_messages().len()
            ));
        }
        outcomes
    }

    /// What the system reports, with our own ports marked. Enumerating is what the interface does when the
    /// operator opens the page; it creates nothing.
    pub fn ports(&self) -> Result<Vec<MidiPortInfo>, String> {
        let mut ports = Vec::new();
        let input = midir::MidiInput::new("WING CONTROLLER (enumeration)")
            .map_err(|error| format!("CoreMIDI could not be reached: {error}"))?;
        for port in input.ports() {
            let name = input.port_name(&port).unwrap_or_else(|_| "(unnamed)".to_string());
            ports.push(MidiPortInfo {
                ours: is_our_port_name(&name),
                name,
                direction: MidiPortDirection::In,
            });
        }
        let output = midir::MidiOutput::new("WING CONTROLLER (enumeration)")
            .map_err(|error| format!("CoreMIDI could not be reached: {error}"))?;
        for port in output.ports() {
            let name = output.port_name(&port).unwrap_or_else(|_| "(unnamed)".to_string());
            ports.push(MidiPortInfo {
                ours: is_our_port_name(&name),
                name,
                direction: MidiPortDirection::Out,
            });
        }
        Ok(ports)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_is_checked_inside_the_output_lock_before_port_access() {
        let runtime = MidiRuntime::default();
        let error = runtime.send_when(&MidiMessageSpec { kind: MidiMessageKind::NoteOn, channel: 1, number: 60, value: 100 }, || {
            assert!(runtime.output.try_lock().is_err(), "a check before the lock leaves a waiting sender live");
            false
        }).unwrap_err();
        assert!(error.contains("cancelled"), "{error}");
        assert_eq!(runtime.sent(), 0);
    }


    /// The in-process half of the claim below. It was the **whole** guard once, and that was the bug: a
    /// `Mutex` orders the threads of one test binary and is blind to the process next to it.
    static MIDI_NAMESPACE: Mutex<()> = Mutex::new(());

    /// A claim on CoreMIDI's port namespace, which belongs to the **machine** (the user's MIDI session), not to
    /// this process.
    ///
    /// `ports()` enumerates every client the CoreMIDI server knows about, so a **second process** running these
    /// same tests creates endpoints with these same two names — `VIRTUAL_IN_NAME`/`VIRTUAL_OUT_NAME` are the
    /// application's published interface and the tests must exercise them, not copies — and then:
    ///
    /// * "nothing of ours may exist before we open anything" reads the other run's ports as pre-existing and
    ///   fails with the two names, although this process has opened nothing;
    /// * a sender that looks our input up **by name** connects to the other run's endpoint, so our own runtime
    ///   receives nothing and the test times out.
    ///
    /// Measured on 2026-10-05 with `target/debug/deps/wing_controller_desktop-22777eb63b7a2f02`: two test
    /// processes started together failed **6 of 6 times** (three pairs) at exactly the two sites the gate had
    /// failed at 09:35 (`nothing of ours may exist before we open anything: [WING CONTROLLER Out, WING
    /// CONTROLLER In]` and a `recv_timeout` with no match), while the same suite run **solo passed 20 of 20
    /// times**. Two `cargo test` processes side by side are not exotic here: on that morning four gate runs
    /// were writing their logs to `/tmp` within four minutes. The application running is the other holder of
    /// these names (§6b of `docs/INTER_APP_HANDOFF_2026-10-04.md`); that case is a genuine conflict and the
    /// failure message says so, which is why the names are not made unique for tests — that would stop testing
    /// the names another application is configured against.
    ///
    /// So the claim is a **file** lock as well as a `Mutex`: the `Mutex` orders the threads of one test binary,
    /// the file orders the processes of one user. `flock` is released by the kernel when the process dies, so a
    /// killed sibling cannot wedge the suite for ever.
    struct MidiPortNamespace {
        /// The in-process half, held for as long as the claim is.
        _local: std::sync::MutexGuard<'static, ()>,
        /// The cross-process half, through an advisory lock on a file every run of these tests opens.
        file: std::fs::File,
    }

    impl MidiPortNamespace {
        /// How long a run waits for another one to let go of the names. Bounded on purpose: the gate has no
        /// timeout on its Rust step, so a hung sibling must fail this suite with a sentence, not hang the gate.
        const WAIT_LIMIT: std::time::Duration = std::time::Duration::from_secs(120);

        /// Take the claim, or say what stopped it.
        fn claim() -> Self {
            let local = MIDI_NAMESPACE.lock().unwrap_or_else(|error| error.into_inner());
            // `temp_dir()` is per user, which is the scope CoreMIDI's namespace has: the user's MIDI session.
            let path = std::env::temp_dir().join("wing-controller-midi-port-namespace.lock");
            let file = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .open(&path)
                .unwrap_or_else(|error| {
                    panic!("the MIDI port-namespace lock {path:?} could not be opened: {error}")
                });
            let deadline = std::time::Instant::now() + Self::WAIT_LIMIT;
            loop {
                match file.try_lock() {
                    Ok(()) => break,
                    Err(std::fs::TryLockError::WouldBlock) => {
                        if std::time::Instant::now() >= deadline {
                            panic!(
                                "another run of these tests has held the MIDI port names for {:?}: is a second \
                                 `cargo test` running beside this one? These tests create the application's own \
                                 virtual ports and CoreMIDI's namespace is shared by every client, so they cannot \
                                 run twice at once",
                                Self::WAIT_LIMIT
                            );
                        }
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                    Err(std::fs::TryLockError::Error(error)) => {
                        panic!("the MIDI port-namespace lock {path:?} could not be taken: {error}");
                    }
                }
            }
            MidiPortNamespace { _local: local, file }
        }
    }

    impl Drop for MidiPortNamespace {
        fn drop(&mut self) {
            // Closing the file releases the advisory lock; unlocking explicitly keeps the pairing with the
            // `try_lock` above in sight.
            let _ = std::fs::File::unlock(&self.file);
        }
    }

    /// What the system reports once the namespace has **stopped changing**.
    ///
    /// Another run of these tests releases its endpoints when it closes them, and CoreMIDI tells the other
    /// clients about a removal on its own schedule: a snapshot taken the instant after a sibling let go can
    /// still list theirs. This waits, with a deadline, for a namespace free of our names — and it does not
    /// weaken the assertions that follow it: the ports of an application that is running, or of a runtime that
    /// never closes them, stay there and the assertions still fail on the last snapshot.
    fn ports_once_the_namespace_is_quiet(runtime: &MidiRuntime) -> Vec<MidiPortInfo> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        let mut ports = runtime.ports().expect("CoreMIDI must be reachable");
        while ports.iter().any(|port| port.ours) && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
            ports = runtime.ports().expect("CoreMIDI must be reachable");
        }
        ports
    }

    /// The switch is the gate, and it is asserted here because this is the function every future caller uses.
    #[test]
    fn nothing_opens_while_the_feature_is_switched_off() {
        let error = ensure_enabled(false).expect_err("off must refuse");
        assert!(
            error.contains("Settings → MIDI, Inter-app OSC"),
            "the refusal says where the switch is: {error}"
        );
        assert!(ensure_enabled(true).is_ok(), "on must be allowed");
    }

    /// The gate holds on the call that matters: with the switch off, opening is refused **before** CoreMIDI is
    /// touched at all.
    #[test]
    fn opening_our_ports_is_refused_before_anything_is_created() {
        let _namespace = MidiPortNamespace::claim();
        let runtime = MidiRuntime::default();
        let error = runtime.open(false, None).expect_err("off must refuse");
        assert!(error.contains("Settings → MIDI, Inter-app OSC"), "{error}");
        assert!(!runtime.is_open(), "a refused open must leave the runtime closed");
    }

    /// The acceptance criterion of this step, on the real system: CoreMIDI is reachable, our two virtual ports
    /// exist **while open** and not before, and closing removes them again.
    ///
    /// If this machine ever refuses to create virtual ports in a test process, this is the test that says so —
    /// and the honest answer then is to mark it `#[ignore]` with the measurement, not to delete it.
    #[test]
    fn our_virtual_ports_exist_while_open_and_not_before() {
        let _namespace = MidiPortNamespace::claim();
        let runtime = MidiRuntime::default();
        // Taken through the settling helper: a sibling run that has just let go of the names may still be
        // visible for a moment, and this snapshot is the one the assertion judges.
        let before = ports_once_the_namespace_is_quiet(&runtime);
        assert!(
            !before.iter().any(|port| port.ours),
            "nothing of ours may exist before we open anything: {before:?}"
        );

        let after = runtime.open(true, None).expect("opening our ports");
        assert!(runtime.is_open());
        assert!(
            after.iter().any(|port| port.ours && port.name == VIRTUAL_IN_NAME),
            "our virtual input must appear in the list: {after:?}"
        );
        assert!(
            after.iter().any(|port| port.ours && port.name == VIRTUAL_OUT_NAME),
            "our virtual output must appear in the list: {after:?}"
        );

        runtime.close();
        assert!(!runtime.is_open());
        let closed = ports_once_the_namespace_is_quiet(&runtime);
        assert!(
            !closed.iter().any(|port| port.ours),
            "closing must remove them again: {closed:?}"
        );
    }

    /// Every message is encoded to the bytes MIDI defines, and the ranges are checked before anything leaves.
    #[test]
    fn a_message_is_encoded_for_the_wire_and_ranges_are_refused_not_truncated() {
        let spec = |kind, channel, number, value| MidiMessageSpec { kind, channel, number, value };
        assert_eq!(
            spec(MidiMessageKind::NoteOn, 1, 60, 100).bytes().unwrap(),
            vec![0x90, 60, 100]
        );
        assert_eq!(
            spec(MidiMessageKind::NoteOff, 16, 60, 0).bytes().unwrap(),
            vec![0x8F, 60, 0],
            "channel 16 is the low nibble 15"
        );
        assert_eq!(
            spec(MidiMessageKind::ControlChange, 6, 7, 127).bytes().unwrap(),
            vec![0xB5, 7, 127]
        );
        assert_eq!(
            spec(MidiMessageKind::ProgramChange, 3, 12, 0).bytes().unwrap(),
            vec![0xC2, 12],
            "program change carries one data byte, not two"
        );
        assert_eq!(
            spec(MidiMessageKind::PitchBend, 1, 0x00, 0x40).bytes().unwrap(),
            vec![0xE0, 0x00, 0x40],
            "pitch bend is least significant byte first"
        );

        // Refusals. Each names the range it knows, because a silent truncation is how a show plays the wrong
        // note and nobody can say why.
        let channel_zero = spec(MidiMessageKind::NoteOn, 0, 60, 100).bytes().unwrap_err();
        assert!(channel_zero.contains("1 to 16"), "{channel_zero}");
        let channel_seventeen = spec(MidiMessageKind::NoteOn, 17, 60, 100).bytes().unwrap_err();
        assert!(channel_seventeen.contains("1 to 16"), "{channel_seventeen}");
        let note_too_high = spec(MidiMessageKind::NoteOn, 1, 128, 100).bytes().unwrap_err();
        assert!(note_too_high.contains("0 to 127"), "{note_too_high}");
        let velocity_too_high = spec(MidiMessageKind::NoteOn, 1, 60, 200).bytes().unwrap_err();
        assert!(velocity_too_high.contains("velocity"), "{velocity_too_high}");
        let bend_too_high = spec(MidiMessageKind::PitchBend, 1, 0, 200).bytes().unwrap_err();
        assert!(bend_too_high.contains("two 7-bit halves"), "{bend_too_high}");

        // And the sentence the operator is shown says what left.
        let described = spec(MidiMessageKind::ControlChange, 6, 7, 127).describe();
        assert!(described.starts_with("sent control change"), "{described}");
        assert!(described.contains("channel 6"), "{described}");
    }

    /// PANIC STOP's MIDI half covers every channel with both messages.
    #[test]
    fn the_panic_covers_sixteen_channels_with_both_messages() {
        let messages = panic_messages();
        assert_eq!(messages.len(), 32, "two messages for each of sixteen channels");
        assert_eq!(messages[0], vec![0xB0, 120, 0], "All Sound Off on channel 1 first");
        assert_eq!(messages[1], vec![0xB0, 123, 0], "then All Notes Off");
        assert!(messages.iter().all(|message| message.len() == 3));
        assert!(
            messages.contains(&vec![0xBF, 120, 0]) && messages.contains(&vec![0xBF, 123, 0]),
            "channel 16 is covered too"
        );
    }

    /// Sending is refused while our ports are closed, and works once they are open — on the real system, with
    /// MIDI's own honest vocabulary: the answer says what was sent, never that it arrived.
    #[test]
    fn sending_needs_our_ports_open_and_reports_what_left() {
        let _namespace = MidiPortNamespace::claim();
        let runtime = MidiRuntime::default();
        let spec = MidiMessageSpec {
            kind: MidiMessageKind::ControlChange,
            channel: 1,
            number: 7,
            value: 100,
        };

        let refused = runtime.send(&spec).expect_err("closed ports must refuse");
        assert!(refused.contains("Settings"), "{refused}");
        assert_eq!(runtime.sent(), 0, "nothing may be counted as sent when nothing left");

        // A validation failure is reported the same way whether or not the ports are open.
        let bad = MidiMessageSpec { channel: 0, ..spec };
        assert!(runtime.send(&bad).is_err(), "a bad message is refused while closed");
        runtime.open(true, None).expect("opening our ports");
        let bad_while_open = runtime.send(&bad).expect_err("and while open");
        assert!(bad_while_open.contains("1 to 16"), "{bad_while_open}");
        assert_eq!(runtime.sent(), 0);

        let described = runtime.send(&spec).expect("sending on an open port");
        assert!(described.starts_with("sent control change"), "{described}");
        assert_eq!(runtime.sent(), 1, "one message left");

        // The panic on an open runtime sends its 32 messages and says so in one line.
        let outcomes = runtime.panic();
        assert_eq!(outcomes.len(), 1, "{outcomes:?}");
        assert!(outcomes[0].contains("16 channels"), "{:?}", outcomes[0]);
        assert_eq!(runtime.sent(), 33, "32 panic messages after the one test message");

        runtime.close();
        assert!(runtime.send(&spec).is_err(), "closing stops sending again");
        assert!(runtime.panic().is_empty(), "and a closed runtime says nothing at all");
    }

    /// Decoding turns bytes into what a trigger matches on, and the velocity-0 rule is the one that decides
    /// whether a key release looks like a press.
    #[test]
    fn a_message_decodes_and_velocity_zero_is_a_note_off() {
        let on = decode_midi_message(&[0x90, 60, 100]).expect("note on");
        assert_eq!(on.kind, MidiMessageKind::NoteOn);
        assert_eq!((on.channel, on.number, on.value), (1, 60, 100));

        let released = decode_midi_message(&[0x90, 60, 0]).expect("note on with velocity 0");
        assert_eq!(
            released.kind,
            MidiMessageKind::NoteOff,
            "velocity 0 is how running status writes a note off, and a trigger for note off must catch it"
        );

        let off = decode_midi_message(&[0x8F, 60, 64]).expect("note off");
        assert_eq!((off.kind, off.channel), (MidiMessageKind::NoteOff, 16));

        let cc = decode_midi_message(&[0xB5, 7, 127]).expect("control change");
        assert_eq!((cc.kind, cc.channel, cc.number, cc.value), (MidiMessageKind::ControlChange, 6, 7, 127));

        let program = decode_midi_message(&[0xC0, 12]).expect("program change");
        assert_eq!((program.kind, program.number, program.value), (MidiMessageKind::ProgramChange, 12, 0));

        let bend = decode_midi_message(&[0xE0, 0x00, 0x40]).expect("pitch bend");
        assert_eq!((bend.kind, bend.number, bend.value), (MidiMessageKind::PitchBend, 0, 0x40));

        // Refusals: system messages carry no channel and no note to match on, and an incomplete message is not
        // something to guess at.
        assert_eq!(decode_midi_message(&[0xF8]), None, "a clock tick is not a trigger");
        assert_eq!(decode_midi_message(&[0x90, 60]), None, "note on without velocity");
        assert_eq!(decode_midi_message(&[]), None, "nothing at all");
        assert_eq!(decode_midi_message(&[0x40, 0x7F]), None, "data without a status byte");
    }

    /// A trigger matches by kind, channel, number and value — with "any" expressed as a value a real message
    /// cannot carry, so a stored trigger is one shape and not two.
    #[test]
    fn a_trigger_matches_only_what_it_names() {
        let spec = |kind, channel, number, operator, value| MidiTriggerSpec {
            trigger_id: "t".to_string(),
            kind,
            channel,
            number,
            operator,
            value,
        };
        let button = decode_midi_message(&[0x90, 60, 100]).unwrap();
        let other = decode_midi_message(&[0x90, 61, 100]).unwrap();
        let cc = decode_midi_message(&[0xB0, 7, 100]).unwrap();

        assert!(spec(MidiMessageKind::NoteOn, 1, 60, None, 0).matches(&button), "exact match");
        assert!(spec(MidiMessageKind::NoteOn, 0, 60, None, 0).matches(&button), "any channel");
        assert!(spec(MidiMessageKind::NoteOn, 1, ANY_NUMBER, None, 0).matches(&button), "any number");
        let softer = decode_midi_message(&[0x90, 60, 5]).unwrap();
        assert!(
            spec(MidiMessageKind::NoteOn, 1, 60, None, 0).matches(&softer),
            "with no operator, any velocity of that note fires it"
        );
        assert!(
            !spec(MidiMessageKind::NoteOn, 1, 60, None, 0).matches(&other),
            "but the number is still part of what the trigger names: a different note is a different button"
        );
        assert!(
            spec(MidiMessageKind::NoteOn, 1, ANY_NUMBER, Some(MidiValueOperator::Greater), 50).matches(&button),
            "a velocity above the threshold"
        );
        assert!(
            !spec(MidiMessageKind::NoteOn, 1, ANY_NUMBER, Some(MidiValueOperator::Less), 50).matches(&button),
            "and not below it"
        );
        assert!(spec(MidiMessageKind::NoteOn, 1, ANY_NUMBER, Some(MidiValueOperator::Equal), 100).matches(&button));
        assert!(spec(MidiMessageKind::NoteOn, 1, ANY_NUMBER, Some(MidiValueOperator::NotEqual), 99).matches(&button));

        // The negatives matter as much: a trigger that fires on everything is worse than none.
        assert!(!spec(MidiMessageKind::NoteOff, 1, 60, None, 0).matches(&button), "wrong kind");
        assert!(!spec(MidiMessageKind::NoteOn, 2, 60, None, 0).matches(&button), "wrong channel");
        assert!(!spec(MidiMessageKind::NoteOn, 1, 61, None, 0).matches(&button), "wrong number");
        assert!(!spec(MidiMessageKind::NoteOn, 1, 60, None, 0).matches(&cc), "another kind of message entirely");
    }

    /// Learn captures what the operator did and leaves the value open — and the trigger it builds matches the
    /// message it was learned from, which is the property that makes the button trustworthy.
    #[test]
    fn learn_captures_the_gesture_and_matches_it_back() {
        let pressed = decode_midi_message(&[0x95, 42, 127]).unwrap();
        let learned = MidiTriggerSpec::from_learned("macro-3".to_string(), &pressed);
        assert_eq!(learned.kind, MidiMessageKind::NoteOn);
        assert_eq!(learned.channel, 6, "the channel the operator actually used");
        assert_eq!(learned.number, 42, "the note the operator actually used");
        assert_eq!(learned.operator, None, "no threshold is invented from one press");
        assert!(learned.matches(&pressed), "the learned trigger must match what it was learned from");
        assert!(
            learned.matches(&decode_midi_message(&[0x95, 42, 1]).unwrap()),
            "and the same button pressed more gently"
        );
        assert!(learned.describe().contains("any value"), "{}", learned.describe());
        assert!(learned.describe().contains("channel 6"), "{}", learned.describe());

        // A release learned as a release: velocity 0 decodes as note off, so the learned trigger is a note off
        // and a real press will not fire it.
        let release = decode_midi_message(&[0x90, 60, 0]).unwrap();
        let learned_release = MidiTriggerSpec::from_learned("macro-4".to_string(), &release);
        assert_eq!(learned_release.kind, MidiMessageKind::NoteOff);
        assert!(
            !learned_release.matches(&decode_midi_message(&[0x90, 60, 100]).unwrap()),
            "learning a release must not make a press fire it"
        );
    }

    /// The runtime's Learn: nothing arrived is a refusal that says what to do, and afterwards the learned
    /// trigger matches; configuring triggers is configuration, allowed whatever the switch says.
    #[test]
    fn the_runtime_learns_from_what_arrived_and_refuses_when_nothing_has() {
        let runtime = MidiRuntime::default();
        let empty = runtime.learn("macro-1").expect_err("nothing has arrived yet");
        assert!(empty.contains("press the button"), "{empty}");

        runtime.monitor.record(VIRTUAL_IN_NAME, &[0xB0, 20, 64], 500);
        let learned = runtime.learn("macro-1").expect("learned from what arrived");
        assert_eq!(learned.trigger_id, "macro-1");
        assert_eq!((learned.kind, learned.channel, learned.number), (MidiMessageKind::ControlChange, 1, 20));
        assert!(learned.matches(&decode_midi_message(&[0xB0, 20, 3]).unwrap()));

        // Configuration is allowed with the switch off: it only has an effect once the ports are open.
        assert_eq!(runtime.trigger_count(), 0);
        runtime.configure(vec![MidiRule { spec: learned, require: None }]);
        assert_eq!(runtime.trigger_count(), 1);

        // And a match is counted, with the last one remembered for the monitor.
        runtime.monitor.record_match("macro-1", "control change · channel 1 · number 20 · any value", 501);
        let snapshot = runtime.snapshot();
        assert_eq!(snapshot.matches, 1);
        let last = snapshot.last_match.expect("the last match is kept");
        assert_eq!(last.trigger_id, "macro-1");
        assert!(last.description.contains("control change"), "{}", last.description);
    }

    /// The whole listening path on the real system: a message sent to our virtual input is decoded, matched
    /// against the configured trigger, counted, and handed to the application through the queue.
    ///
    /// This is the "a button in the other application fires our macro" half, proven at the transport level with
    /// no third-party application involved: the test plays the part of the application by connecting to our own
    /// virtual input and sending one note.
    #[test]
    fn a_message_sent_to_our_virtual_input_matches_and_is_handed_over() {
        let _namespace = MidiPortNamespace::claim();
        let runtime = MidiRuntime::default();
        let (sender, receiver) = std::sync::mpsc::sync_channel(8);
        runtime.open(true, Some(sender)).expect("opening our ports");
        runtime.configure(vec![MidiRule { spec: MidiTriggerSpec {
            trigger_id: "macro-7".to_string(),
            kind: MidiMessageKind::NoteOn,
            channel: 1,
            number: 60,
            operator: None,
            value: 0,
        }, require: None }]);

        // A second CoreMIDI client plays the other application: it finds our virtual input and sends to it.
        let output = midir::MidiOutput::new("WING CONTROLLER (test sender)").expect("a MIDI output");
        let target = output
            .ports()
            .into_iter()
            .find(|port| output.port_name(port).map(|name| name == VIRTUAL_IN_NAME).unwrap_or(false))
            .expect("our virtual input must be visible as something to send to");
        let mut connection = output
            .connect(&target, "WING CONTROLLER (test sender)")
            .expect("connecting to our own virtual input");
        connection.send(&[0x90, 60, 100]).expect("sending one note");

        let event = receiver
            .recv_timeout(std::time::Duration::from_secs(3))
            .unwrap_or_else(|error| panic!(
                "no match arrived ({error}). If the WING CONTROLLER application is running it holds virtual ports \
                 with these very names, so these tests cannot see their own: quit it and run the suite again"
            ));
        assert_eq!(event.trigger_id, "macro-7");
        assert!(event.description.contains("note on"), "{}", event.description);
        let snapshot = runtime.snapshot();
        assert_eq!(snapshot.matches, 1);
        assert_eq!(snapshot.matches_dropped, 0);
        assert_eq!(snapshot.received, 1, "and the monitor saw it too");
        assert!(snapshot.last_match.is_some());

        runtime.close();
    }

    /// A match nobody asked to hear is counted and dropped, never queued: with no sink, the queue is not a
    /// backlog and the counter is the whole story.
    #[test]
    fn matches_with_nowhere_to_go_are_counted_as_dropped() {
        let runtime = MidiRuntime::default();
        assert_eq!(runtime.snapshot().matches_dropped, 0);
        runtime.monitor.record_match_dropped();
        runtime.monitor.record_match_dropped();
        assert_eq!(runtime.snapshot().matches_dropped, 2);
        assert_eq!(runtime.snapshot().matches, 0, "a dropped match is not a match that happened");
    }

    /// A condition says whether it held **and why not**: "never received" and "received and false" are different
    /// sentences, and a stale value is a third.
    #[test]
    fn a_condition_explains_itself_including_when_it_is_stale() {
        let condition = MidiConditionSpec {
            kind: MidiMessageKind::ControlChange,
            channel: 1,
            number: 20,
            operator: MidiValueOperator::Greater,
            value: 64,
            stale_ms: 2_000,
        };

        let never = condition.evaluate(None, 10_000);
        assert!(!never.met);
        assert!(never.reason.contains("no value has arrived"), "{}", never.reason);
        assert!(never.reason.contains("control change"), "{}", never.reason);

        let stale = condition.evaluate(Some((100, 1_000)), 10_000);
        assert!(!stale.met, "a value from nine seconds ago is not what the condition asks about");
        assert!(stale.reason.contains("stale after 2.0 s"), "{}", stale.reason);

        let met = condition.evaluate(Some((100, 9_500)), 10_000);
        assert!(met.met);
        assert!(met.reason.contains("is 100"), "{}", met.reason);

        let unmet = condition.evaluate(Some((10, 9_500)), 10_000);
        assert!(!unmet.met);
        assert!(unmet.reason.contains("not what the condition asks for"), "{}", unmet.reason);

        // Zero means "never stale", which is a choice the operator makes deliberately.
        let forever = MidiConditionSpec { stale_ms: 0, ..condition };
        assert!(forever.evaluate(Some((100, 1_000)), 10_000_000).met);
    }

    /// The condition is evaluated where the message arrives, on the real system: the value is remembered when it
    /// arrives and the trigger's event carries the verdict.
    #[test]
    fn a_condition_is_decided_from_the_last_value_that_arrived() {
        let _namespace = MidiPortNamespace::claim();
        let runtime = MidiRuntime::default();
        let (sender, receiver) = std::sync::mpsc::sync_channel(8);
        runtime.open(true, Some(sender)).expect("opening our ports");
        let condition = MidiConditionSpec {
            kind: MidiMessageKind::ControlChange,
            channel: 1,
            number: 20,
            operator: MidiValueOperator::Greater,
            value: 64,
            stale_ms: 0,
        };
        runtime.configure(vec![MidiRule {
            spec: MidiTriggerSpec {
                trigger_id: "macro-9".to_string(),
                kind: MidiMessageKind::NoteOn,
                channel: 1,
                number: 60,
                operator: None,
                value: 0,
            },
            require: Some(condition),
        }]);
        assert_eq!(runtime.condition_count(), 1);

        let output = midir::MidiOutput::new("WING CONTROLLER (test sender)").expect("a MIDI output");
        let target = output
            .ports()
            .into_iter()
            .find(|port| output.port_name(port).map(|name| name == VIRTUAL_IN_NAME).unwrap_or(false))
            .expect("our virtual input must be visible");
        let mut connection = output.connect(&target, "test sender").expect("connecting");

        // Nothing sent for the condition yet: the trigger says so rather than quietly firing.
        connection.send(&[0x90, 60, 100]).expect("the note");
        let first = receiver.recv_timeout(std::time::Duration::from_secs(3)).unwrap_or_else(|error| panic!(
                "no match arrived ({error}). If the WING CONTROLLER application is running it holds virtual ports \
                 with these very names, so these tests cannot see their own: quit it and run the suite again"
            ));
        let verdict = first.condition.expect("the binding has a condition");
        assert!(!verdict.met, "{}", verdict.reason);
        assert!(verdict.reason.contains("no value has arrived"), "{}", verdict.reason);

        // A value that does not satisfy it, then one that does.
        connection.send(&[0xB0, 20, 10]).expect("a low value");
        connection.send(&[0x90, 60, 100]).expect("the note again");
        let second = receiver.recv_timeout(std::time::Duration::from_secs(3)).unwrap_or_else(|error| panic!(
                "no match arrived ({error}). If the WING CONTROLLER application is running it holds virtual ports \
                 with these very names, so these tests cannot see their own: quit it and run the suite again"
            ));
        let verdict = second.condition.expect("still conditioned");
        assert!(!verdict.met);
        assert!(verdict.reason.contains("is 10"), "{}", verdict.reason);

        connection.send(&[0xB0, 20, 100]).expect("a high value");
        connection.send(&[0x90, 60, 100]).expect("the note once more");
        let third = receiver.recv_timeout(std::time::Duration::from_secs(3)).unwrap_or_else(|error| panic!(
                "no match arrived ({error}). If the WING CONTROLLER application is running it holds virtual ports \
                 with these very names, so these tests cannot see their own: quit it and run the suite again"
            ));
        let verdict = third.condition.expect("still conditioned");
        assert!(verdict.met, "{}", verdict.reason);
        assert!(verdict.reason.contains("is 100"), "{}", verdict.reason);

        // And a rule with no condition says nothing about conditions, rather than claiming one held.
        runtime.configure(vec![MidiRule {
            spec: MidiTriggerSpec {
                trigger_id: "macro-10".to_string(),
                kind: MidiMessageKind::NoteOn,
                channel: 1,
                number: 61,
                operator: None,
                value: 0,
            },
            require: None,
        }]);
        connection.send(&[0x90, 61, 100]).expect("a note with no condition");
        let fourth = receiver.recv_timeout(std::time::Duration::from_secs(3)).unwrap_or_else(|error| panic!(
                "no match arrived ({error}). If the WING CONTROLLER application is running it holds virtual ports \
                 with these very names, so these tests cannot see their own: quit it and run the suite again"
            ));
        assert!(fourth.condition.is_none());
        assert_eq!(runtime.condition_count(), 0, "the watched list follows the rules");

        runtime.close();
    }

    /// The whole MTC path on the real system: another CoreMIDI client sends quarter frames to our virtual input,
    /// and the position appears in the timecode the application is reading.
    ///
    /// This is the owner's "MTC from another application, from a MIDI port" — proven without either, because the
    /// test plays the part of the sender.
    #[test]
    fn mtc_arriving_on_our_port_becomes_a_position() {
        let _namespace = MidiPortNamespace::claim();
        let runtime = MidiRuntime::default();
        runtime.open(true, None).expect("opening our ports");
        let timecode = runtime.timecode();
        assert_eq!(timecode.snapshot().state, "nothing", "nothing has arrived yet");

        let output = midir::MidiOutput::new("WING CONTROLLER (test sender)").expect("a MIDI output");
        let target = output
            .ports()
            .into_iter()
            .find(|port| output.port_name(port).map(|name| name == VIRTUAL_IN_NAME).unwrap_or(false))
            .expect("our virtual input must be visible");
        let mut connection = output.connect(&target, "test sender").expect("connecting");

        // 01:00:12:15 at 25 fps, one quarter frame at a time, exactly as a playback machine sends it.
        for byte in [0x0Du8, 0x10, 0x2C, 0x30, 0x40, 0x50, 0x61, 0x72] {
            connection.send(&[0xF1, byte]).expect("sending a quarter frame");
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while timecode.snapshot().position.is_none() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let snapshot = timecode.snapshot();
        assert_eq!(snapshot.position.as_deref(), Some("01:00:12:15"), "{snapshot:?}");
        assert_eq!(snapshot.state, "running");
        assert_eq!(snapshot.rate.as_deref(), Some("25"));
        assert_eq!(snapshot.positions, 1);
        assert_eq!(snapshot.source, "MTC");

        // A clock tick on the same port is somebody else's message: it must not disturb the position.
        connection.send(&[0xF8]).expect("a clock tick");
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(timecode.snapshot().positions, 1, "a clock tick is not timecode");
        assert_eq!(timecode.snapshot().position.as_deref(), Some("01:00:12:15"));

        // And the MIDI monitor counts them as system messages, which is what the operator sees in the trace.
        let snapshot = runtime.snapshot();
        assert!(snapshot.received >= 9, "the monitor saw the messages: {snapshot:?}");
        runtime.close();
    }

    #[test]
    fn mtc_encoding_matches_the_independent_mma_wire_example() {
        let position = timecode::TimecodePosition::new(1,37,52,16,timecode::TimecodeRate::Fps30,false).unwrap();
        let messages = mtc_messages(&position);
        assert_eq!(messages[0], [0xF0,0x7F,0x7F,1,1,0x61,0x25,0x34,0x10,0xF7]);
        assert_eq!(messages[1..].iter().map(|m| m[1]).collect::<Vec<_>>(),
            [0x00,0x11,0x24,0x33,0x45,0x52,0x61,0x76]);
    }

    /// A round trip is an additional check, not an independent protocol oracle.
    #[test]
    fn the_mtc_we_send_is_the_position_our_own_decoder_reads_back() {
        let position = super::timecode::TimecodePosition::new(
            1,
            23,
            45,
            12,
            super::timecode::TimecodeRate::Fps25,
            false,
        )
        .expect("a position");
        let messages = mtc_messages(&position);
        assert_eq!(messages.len(), 9, "a full frame and eight quarter frames");
        assert_eq!(messages[0][0], 0xF0, "the full frame is a SysEx");
        assert_eq!(*messages[0].last().expect("an end"), 0xF7);

        // The full frame alone is enough for a receiver to know where we are.
        let mut assembler = super::timecode::MtcAssembler::default();
        assert_eq!(
            assembler.push_full_frame(&messages[0]),
            Some(position),
            "the full frame carries the whole position"
        );

        // And the quarter frames assemble to the same position, which is how a receiver follows from there.
        let mut assembler = super::timecode::MtcAssembler::default();
        let mut decoded = None;
        for message in &messages[1..] {
            // Through the same reader the MIDI callback uses, so this checks the bytes as they arrive rather than the
            // structure this test already knows about.
            let frame = super::timecode::QuarterFrame::from_message(message).expect("a quarter frame");
            if let Some(assembled) = assembler.push(frame) {
                decoded = Some(assembled);
            }
        }
        assert_eq!(decoded, Some(timecode::TimecodePosition::from_frames(position.to_frames() + 2, position.rate, position.drop_frame)), "quarter frames compensate the two-frame transmission delay");
    }

    /// The whole cue path on the real system: MTC arrives on our port, the position crosses a cue, and the cue
    /// event is handed over for the window to fire.
    ///
    /// The test plays the part of the playback machine: it sends the full-frame message for an arming position and
    /// then for the cue's own position, exactly as a machine does when it starts and when it plays into a cue.
    #[test]
    fn mtc_crossing_a_cue_fires_it_through_the_queue() {
        let _namespace = MidiPortNamespace::claim();
        let runtime = MidiRuntime::default();
        runtime.open(true, None).expect("opening our ports");
        let timecode = runtime.timecode();

        // A cue at 00:00:12:15, firing macro 3.
        let (sender, receiver) = std::sync::mpsc::sync_channel(8);
        let installed = timecode.configure_cues(
            vec![timecode::TimecodeCue {
                macro_id: None,
                macro_hash: None,
                id: "cue-1".to_string(),
                // The struct grew a number and a group (the cue-number work); this literal is only here because
                // Rust wants every field, not because this test has anything to say about them.
                number: String::new(),
                group: String::new(),
                at: timecode::TimecodePosition::new(0, 0, 12, 15, timecode::TimecodeRate::Fps25, false)
                    .expect("a position"),
                macro_index: Some(3),
                duration_ms: None,
                repeat: None,
                repeats: false,
                enabled: true,
                label: String::new(),
                note: "the announcement".to_string(),
            }],
            Some(sender),
        );
        assert_eq!(installed, 1);

        let output = midir::MidiOutput::new("WING CONTROLLER (test sender)").expect("a MIDI output");
        let target = output
            .ports()
            .into_iter()
            .find(|port| output.port_name(port).map(|name| name == VIRTUAL_IN_NAME).unwrap_or(false))
            .expect("our virtual input must be visible");
        let mut connection = output.connect(&target, "test sender").expect("connecting");

        // A full frame is `F0 7F 7F 01 01 hr mn se fr F7`, with binary fields and the rate in the top bits.
        let full_frame = |hours: u8, minutes: u8, seconds: u8, frames: u8| {
            vec![0xF0, 0x7F, 0x7F, 0x01, 0x01, (0b01 << 5) | hours, minutes, seconds, frames, 0xF7]
        };

        // The first position only arms, even though it is before the cue.
        connection.send(&full_frame(0x00, 0x00, 12, 0)).expect("arming");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while timecode.snapshot().position.is_none() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(
            receiver.recv_timeout(std::time::Duration::from_millis(300)).is_err(),
            "the first position must arm the engine, not fire the cues before it"
        );

        // And playing into the cue fires it. The channel only rings, so the event itself is read from the ledger —
        // which is the point: the ring may be refused, the ledger is the record.
        connection.send(&full_frame(0x00, 0x00, 12, 15)).expect("the cue position");
        assert!(
            receiver.recv_timeout(std::time::Duration::from_secs(3)).is_ok(),
            "the cue must ring the doorbell"
        );
        let pending = timecode.pending_cues();
        let delivery = pending.first().expect("the fired cue is in the ledger");
        assert!(delivery.seq > 0, "a fired cue is recorded with its receipt: {delivery:?}");
        match &delivery.event {
            timecode::CueEvent::Fired { id, at, macro_id, macro_index } => {
                assert_eq!(id, "cue-1");
                assert_eq!(at, "00:00:12:15");
                assert!(macro_id.is_none(), "a cue that names its macro by position carries no key");
                assert_eq!(*macro_index, Some(3), "the macro the cue names, not the first in the library");
            }
            other => panic!("expected a fired cue, got {other:?}"),
        }
        // The window answers for it: the ledger empties and the order is counted as delivered.
        assert_eq!(timecode.confirm_cues(&[(delivery.seq, timecode::CueOutcome::Delivered)]), 1);
        assert!(timecode.pending_cues().is_empty(), "a confirmed order is not pending any more");
        assert_eq!(timecode.snapshot().cues_delivered, 1);

        // The clock's own line now shows the next cue, which is the one after this one — and there is none.
        let snapshot = timecode.snapshot();
        assert_eq!(snapshot.cues, 1);
        assert!(snapshot.next_cue.is_none(), "the only cue has fired: {snapshot:?}");

        runtime.close();
    }

    /// Our ports are recognised by name, and nothing else is claimed as ours.
    #[test]
    fn our_ports_are_recognised_and_no_other_port_is() {
        assert!(is_our_port_name(VIRTUAL_IN_NAME));
        assert!(is_our_port_name(VIRTUAL_OUT_NAME));
        assert!(!is_our_port_name("IAC Driver Bus 1"));
        assert!(!is_our_port_name("Mixing Station"));
        assert!(!is_our_port_name(""));
    }

    /// The monitor's summary is a sentence about what arrived, and a message too short to be MIDI is refused
    /// rather than described.
    #[test]
    fn a_midi_message_is_summarised_without_being_interpreted() {
        assert_eq!(
            summarise_midi_message(&[0x90, 60, 100]).as_deref(),
            Some("note on · channel 1 · note 60 · velocity 100")
        );
        assert_eq!(
            summarise_midi_message(&[0x90, 60, 0]).as_deref(),
            Some("note off · channel 1 · note 60 · velocity 0"),
            "velocity 0 is how running status writes a note off, and the monitor says so"
        );
        assert_eq!(
            summarise_midi_message(&[0xB5, 7, 127]).as_deref(),
            Some("control change · channel 6 · controller 7 · value 127")
        );
        assert_eq!(
            summarise_midi_message(&[0xC0, 12]).as_deref(),
            Some("program change · channel 1 · program 12")
        );
        assert_eq!(
            summarise_midi_message(&[0xE0, 0x00, 0x40]).as_deref(),
            Some("pitch bend · channel 1 · value 8192"),
            "pitch bend is 14 bits, least significant byte first"
        );
        assert_eq!(
            summarise_midi_message(&[0xF8]).as_deref(),
            Some("system message · status 0xF8")
        );

        // Refusals: no status byte, or a status byte with its data missing.
        assert_eq!(summarise_midi_message(&[]), None, "an empty message is not a message");
        assert_eq!(
            summarise_midi_message(&[0x40, 0x7F]),
            None,
            "data without a status byte is not something to guess at"
        );
        assert_eq!(
            summarise_midi_message(&[0x90, 60]),
            None,
            "a note on with no velocity is incomplete, not zero"
        );
    }

    /// The monitor counts what arrives, drops what it cannot read, and remembers the last good one.
    #[test]
    fn the_monitor_counts_drops_separately_and_remembers_the_last_message() {
        let monitor = MidiMonitor::default();
        monitor.record(VIRTUAL_IN_NAME, &[0x90, 64, 90], 1_000);
        monitor.record(VIRTUAL_IN_NAME, &[0x90], 1_001);
        let snapshot = monitor.snapshot();
        assert_eq!(snapshot.received, 2, "both messages arrived");
        assert_eq!(snapshot.dropped, 1, "only the unreadable one was dropped");
        let last = snapshot.last.expect("the last readable message is kept");
        assert_eq!(last.at_ms, 1_000, "the dropped message did not replace it");
        assert!(last.summary.starts_with("note on"), "{}", last.summary);
        assert_eq!(last.port, VIRTUAL_IN_NAME);

        // A runtime that was never opened reports closed, and its monitor is empty.
        let runtime = MidiRuntime::default();
        assert!(!runtime.is_open());
        assert_eq!(runtime.snapshot().received, 0);
    }
}
