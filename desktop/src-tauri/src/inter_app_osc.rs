//! OSC between applications — Phase C, step 1 of `docs/OSC_INTER_APP_PLAN.md`.
//!
//! This step **only looks and counts**, exactly like the MIDI module's first step: it binds a socket on
//! loopback, decodes OSC 1.0 messages and bundles with the spec's own rules, and keeps counters of what
//! arrived, what was malformed and who sent it. **Nothing triggers, nothing is sent, and no macro can use any
//! of it.** The listener opens only while the operator has switched the feature on.
//!
//! The decoder follows the specification rather than a convenient reading of it, because the specification
//! settles three things that a hand-rolled parser gets wrong:
//!
//! * a message whose type-tag string contains an **unrecognised** tag must be **discarded**
//!   ([OSC 1.0](https://opensoundcontrol.stanford.edu/spec-1_0.html)), not half-read;
//! * a message with **no** type-tag string at all must be tolerated — "implementations should be robust in the
//!   case of a missing OSC Type Tag String" — and is treated as argument-less;
//! * strings are null-terminated and padded to four bytes, so a parser that does not check the terminator reads
//!   past the end of a hostile packet.
//!
//! It lives in its own file for the same reason the MIDI module does: the pure parts are tested without a
//! socket, and the socket is tested against itself once.

use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// The port the listener binds by default. Chosen because it is memorable, unassigned in this rig, and not one
/// of the ports the applications in the interoperability table use.
pub const DEFAULT_LISTENER_PORT: u16 = 9100;

/// How deep nested bundles may go, and how many messages one packet may carry. A malicious or broken peer must
/// not be able to make this allocate without bound.
const MAX_BUNDLE_DEPTH: usize = 8;
const MAX_MESSAGES_PER_PACKET: usize = 256;

/// A value, as OSC 1.0 defines the ones this build understands.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum OscValue {
    Int(i32),
    Float(f32),
    Str(String),
    Blob(usize),
    Long(i64),
    Double(f64),
    TimeTag(u64),
    Bool(bool),
    Nil,
    Impulse,
}

impl OscValue {
    /// The value **without** its type tag, for the sentences that compare it against what the operator asked for:
    /// "argument 2 is f 0.2, which is not > 0.5" reads; "…which is not > f 0.5" does not.
    pub fn contents(&self) -> String {
        match self {
            OscValue::Int(value) => value.to_string(),
            OscValue::Float(value) => value.to_string(),
            OscValue::Str(value) => format!("\"{value}\""),
            OscValue::Blob(size) => format!("{size} bytes"),
            OscValue::Long(value) => value.to_string(),
            OscValue::Double(value) => value.to_string(),
            OscValue::TimeTag(value) => value.to_string(),
            OscValue::Bool(value) => if *value { "T" } else { "F" }.to_string(),
            OscValue::Nil => "N".to_string(),
            OscValue::Impulse => "I".to_string(),
        }
    }

    /// The value as a monitor prints it: type and content, so an operator can tell a float from a string.
    pub fn describe(&self) -> String {
        match self {
            OscValue::Int(value) => format!("i {value}"),
            OscValue::Float(value) => format!("f {value}"),
            OscValue::Str(value) => format!("s \"{value}\""),
            OscValue::Blob(size) => format!("b {size} bytes"),
            OscValue::Long(value) => format!("h {value}"),
            OscValue::Double(value) => format!("d {value}"),
            OscValue::TimeTag(value) => format!("t {value}"),
            OscValue::Bool(value) => format!("{}", if *value { "T" } else { "F" }),
            OscValue::Nil => "N".to_string(),
            OscValue::Impulse => "I".to_string(),
        }
    }
}

/// One decoded message.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct OscMessage {
    pub address: String,
    pub args: Vec<OscValue>,
}

impl OscMessage {
    pub fn describe_args(&self) -> String {
        if self.args.is_empty() {
            return "no arguments".to_string();
        }
        self.args.iter().map(OscValue::describe).collect::<Vec<_>>().join(" · ")
    }
}

/// Why a packet could not be read. Every one of these is counted, and the message says which it was: a monitor
/// that only says "something was wrong" is not something an operator can act on.
#[derive(Clone, Debug, PartialEq)]
pub enum OscDecodeError {
    Empty,
    NotAnAddress(String),
    UnterminatedString,
    Truncated,
    UnknownTypeTag(char),
    TooDeep,
    TooManyMessages,
    /// A bundle whose timetag is in the future: OSC 1.0 says it must be held until then, and this build does not keep
    /// a schedule. Running it now would fire a cue early, which is worse than not firing it.
    UnsupportedFutureTimetag,
}

impl OscDecodeError {
    pub fn describe(&self) -> String {
        match self {
            OscDecodeError::Empty => "an empty packet".to_string(),
            OscDecodeError::NotAnAddress(address) => format!("'{address}' is not an OSC address"),
            OscDecodeError::UnterminatedString => "a string with no terminator".to_string(),
            OscDecodeError::Truncated => "a packet that ends in the middle of a value".to_string(),
            OscDecodeError::UnknownTypeTag(tag) => format!("an unknown type tag '{tag}'"),
            OscDecodeError::TooDeep => "bundles nested deeper than this build allows".to_string(),
            OscDecodeError::TooManyMessages => "more messages in one packet than this build allows".to_string(),
            OscDecodeError::UnsupportedFutureTimetag => {
                "a bundle scheduled for a future time, which this build does not keep: it was refused rather than run \
                 early"
                    .to_string()
            }
        }
    }
}

/// Read one OSC string: null-terminated, padded to four bytes.
fn read_string(bytes: &[u8], at: &mut usize) -> Result<String, OscDecodeError> {
    let start = *at;
    let Some(end) = bytes[start..].iter().position(|byte| *byte == 0) else {
        return Err(OscDecodeError::UnterminatedString);
    };
    let value = String::from_utf8_lossy(&bytes[start..start + end]).into_owned();
    // The padding is part of the encoding, not slack: the next value starts on a four-byte boundary.
    let padded = (end + 1 + 3) & !3;
    *at = start + padded;
    if *at > bytes.len() {
        return Err(OscDecodeError::Truncated);
    }
    Ok(value)
}

fn read_i32(bytes: &[u8], at: &mut usize) -> Result<i32, OscDecodeError> {
    if *at + 4 > bytes.len() {
        return Err(OscDecodeError::Truncated);
    }
    let value = i32::from_be_bytes([bytes[*at], bytes[*at + 1], bytes[*at + 2], bytes[*at + 3]]);
    *at += 4;
    Ok(value)
}

fn read_u64(bytes: &[u8], at: &mut usize) -> Result<u64, OscDecodeError> {
    if *at + 8 > bytes.len() {
        return Err(OscDecodeError::Truncated);
    }
    let mut raw = [0_u8; 8];
    raw.copy_from_slice(&bytes[*at..*at + 8]);
    *at += 8;
    Ok(u64::from_be_bytes(raw))
}

/// Decode one message from `bytes` starting at `at`. The address and the type-tag string are read here; the
/// arguments follow the tags exactly.
fn read_message(bytes: &[u8], at: &mut usize) -> Result<OscMessage, OscDecodeError> {
    let address = read_string(bytes, at)?;
    if !address.starts_with('/') {
        return Err(OscDecodeError::NotAnAddress(address));
    }
    // A message with no type-tag string is tolerated, as the specification asks: it becomes a message with no
    // arguments rather than a refusal to read.
    if *at >= bytes.len() || bytes[*at] != b',' {
        return Ok(OscMessage { address, args: Vec::new() });
    }
    let tags = read_string(bytes, at)?;
    let mut args = Vec::new();
    for tag in tags.chars().skip(1) {
        match tag {
            'i' => args.push(OscValue::Int(read_i32(bytes, at)?)),
            'f' => {
                let raw = read_i32(bytes, at)?;
                args.push(OscValue::Float(f32::from_bits(raw as u32)));
            }
            's' => args.push(OscValue::Str(read_string(bytes, at)?)),
            'b' => {
                let size = read_i32(bytes, at)?;
                if size < 0 {
                    return Err(OscDecodeError::Truncated);
                }
                let padded = (size as usize + 3) & !3;
                if *at + padded > bytes.len() {
                    return Err(OscDecodeError::Truncated);
                }
                *at += padded;
                args.push(OscValue::Blob(size as usize));
            }
            'h' => args.push(OscValue::Long(read_u64(bytes, at)? as i64)),
            't' => args.push(OscValue::TimeTag(read_u64(bytes, at)?)),
            'd' => {
                let raw = read_u64(bytes, at)?;
                args.push(OscValue::Double(f64::from_bits(raw)));
            }
            'T' => args.push(OscValue::Bool(true)),
            'F' => args.push(OscValue::Bool(false)),
            'N' => args.push(OscValue::Nil),
            'I' => args.push(OscValue::Impulse),
            // The specification is explicit: a message with an unrecognised tag is discarded, whole. Half a
            // message is worse than none, because the arguments after the unknown tag would be read at the
            // wrong offsets and become values nobody sent.
            other => return Err(OscDecodeError::UnknownTypeTag(other)),
        }
    }
    Ok(OscMessage { address, args })
}

/// Now, as the NTP seconds an OSC timetag counts: the NTP epoch is 1900, thirty years before Unix's.
fn ntp_now() -> u64 {
    const NTP_UNIX_OFFSET: u64 = 2_208_988_800;
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_secs() + NTP_UNIX_OFFSET)
        .unwrap_or(NTP_UNIX_OFFSET)
}

/// Decode a whole packet: a message, or a bundle of them.
pub fn decode_packet(bytes: &[u8]) -> Result<Vec<OscMessage>, OscDecodeError> {
    if bytes.is_empty() {
        return Err(OscDecodeError::Empty);
    }
    let mut messages = Vec::new();
    let mut at = 0;
    read_element(bytes, &mut at, 0, &mut messages)?;
    Ok(messages)
}

fn read_element(
    bytes: &[u8],
    at: &mut usize,
    depth: usize,
    messages: &mut Vec<OscMessage>,
) -> Result<(), OscDecodeError> {
    if depth > MAX_BUNDLE_DEPTH {
        return Err(OscDecodeError::TooDeep);
    }
    if bytes[*at..].starts_with(b"#bundle\0") {
        *at += 8;
        // The timetag says **when** the bundle's messages are meant to be invoked. `1` is "immediately", and `0` is
        // what several implementations send meaning the same; anything already in the past should have run, so running
        // it now is right. A **future** timetag is a schedule this build does not keep: executing it now would fire a
        // cue early, so it is refused and counted rather than brought forward in silence.
        // A timetag is 64-bit fixed point — 32 bits of seconds, then 32 of fraction — so the moment to compare
        // against has to be built the same way, or every timestamp looks like the far future.
        let timetag = read_u64(bytes, at)?;
        if timetag > 1 && timetag > (ntp_now() << 32) {
            return Err(OscDecodeError::UnsupportedFutureTimetag);
        }
        while *at < bytes.len() {
            let size = read_i32(bytes, at)?;
            if size < 0 || *at + size as usize > bytes.len() {
                return Err(OscDecodeError::Truncated);
            }
            let end = *at + size as usize;
            let mut inner = *at;
            // Parsed **inside the bounds the bundle declares**. Handing the parser a sub-slice is what makes that true
            // for every reader at once — addresses, type tags, argument values and nested bundles — instead of each of
            // them having to remember the limit. Without it, a message cut short in one element was completed by the
            // bytes of the element after it: the parser read outside the structure it was told to parse, and reported
            // an error about the wrong element.
            read_element(&bytes[..end], &mut inner, depth + 1, messages)?;
            *at = end;
            if messages.len() > MAX_MESSAGES_PER_PACKET {
                return Err(OscDecodeError::TooManyMessages);
            }
        }
        return Ok(());
    }
    let message = read_message(bytes, at)?;
    messages.push(message);
    Ok(())
}

/// The refusal that keeps this feature out of a show it is not wanted in, with the same wording the MIDI half
/// uses — one switch, two protocols, one sentence.
pub fn ensure_enabled(enabled: bool) -> Result<(), String> {
    if enabled {
        Ok(())
    } else {
        Err("talking to other applications is switched off (Settings → MIDI, Inter-app OSC): no listener is \
             opened while it is off"
            .to_string())
    }
}

/// How an argument of the arriving message is compared.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OscCompare {
    Equal,
    NotEqual,
    Greater,
    GreaterOrEqual,
    Less,
    LessOrEqual,
}

/// What a trigger asks of one argument.
///
/// For OSC the condition is an argument of the **same** message rather than a value from another address: a peer
/// sends `/cue/1/start` or `/fader 0.5` as one message, and asking about a different address would be a question
/// about a different moment. A condition on another address is what the MIDI half already does, and if the need
/// appears here it will be built the same way — not pretended at now.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct OscArgCondition {
    #[serde(default)]
    pub index: usize,
    pub compare: OscCompare,
    pub value: OscArg,
}

/// The same shape the MIDI conditions use, so the window's own `conditionHolds` reads both without knowing which
/// protocol produced it.
#[derive(Clone, Debug, Serialize)]
pub struct OscConditionVerdict {
    pub met: bool,
    pub reason: String,
}

fn numeric(value: &OscValue) -> Option<f64> {
    match value {
        OscValue::Int(value) => Some(*value as f64),
        OscValue::Float(value) => Some(*value as f64),
        _ => None,
    }
}

impl OscArgCondition {
    /// Decide, from the arguments that arrived.
    pub fn holds(&self, args: &[OscValue]) -> OscConditionVerdict {
        let Some(received) = args.get(self.index) else {
            return OscConditionVerdict {
                met: false,
                reason: format!(
                    "the message has {} argument(s) and the trigger asks about argument {}",
                    args.len(),
                    self.index + 1
                ),
            };
        };
        let wanted = match &self.value {
            OscArg::Int(value) => OscValue::Int(*value),
            OscArg::Float(value) => OscValue::Float(*value),
            OscArg::Str(value) => OscValue::Str(value.clone()),
            // The argument-less tags have nothing to compare, so they are only ever equal to themselves.
            OscArg::Bool(value) => OscValue::Bool(*value),
            OscArg::Nil => OscValue::Nil,
            OscArg::Impulse => OscValue::Impulse,
        };
        let symbol = match self.compare {
            OscCompare::Equal => "=",
            OscCompare::NotEqual => "≠",
            OscCompare::Greater => ">",
            OscCompare::GreaterOrEqual => "≥",
            OscCompare::Less => "<",
            OscCompare::LessOrEqual => "≤",
        };
        // Numbers compare with numbers, strings with strings and only for equality: a string has no "greater
        // than", and inventing an ordering for text is how a comparison nobody can explain reaches a show.
        let outcome = match (numeric(received), numeric(&wanted)) {
            (Some(left), Some(right)) => Some(match self.compare {
                OscCompare::Equal => left == right,
                OscCompare::NotEqual => left != right,
                OscCompare::Greater => left > right,
                OscCompare::GreaterOrEqual => left >= right,
                OscCompare::Less => left < right,
                OscCompare::LessOrEqual => left <= right,
            }),
            _ => match self.compare {
                OscCompare::Equal => Some(received == &wanted),
                OscCompare::NotEqual => Some(received != &wanted),
                _ => None,
            },
        };
        match outcome {
            Some(met) => OscConditionVerdict {
                met,
                reason: if met {
                    format!("argument {} is {}", self.index + 1, received.describe())
                } else {
                    format!(
                        "argument {} is {}, which is not {symbol} {}",
                        self.index + 1,
                        received.describe(),
                        wanted.contents()
                    )
                },
            },
            None => OscConditionVerdict {
                met: false,
                reason: format!(
                    "argument {} is {} and that cannot be compared with {symbol} to {}",
                    self.index + 1,
                    received.describe(),
                    wanted.contents()
                ),
            },
        }
    }
}

/// What a trigger listens for.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct OscTriggerSpec {
    pub trigger_id: String,
    /// The address pattern, with the specification's wildcards. Compiled when the rules are configured, and
    /// refused there if it cannot be.
    pub pattern: String,
    #[serde(default)]
    pub require: Option<OscArgCondition>,
}

/// A compiled rule: the pattern is compiled **once**, when the window configures it, so matching a message is a
/// few comparisons and never a compile.
#[derive(Clone, Debug)]
pub struct OscRule {
    pub trigger_id: String,
    pub pattern: OscPattern,
    pub require: Option<OscArgCondition>,
}

impl OscRule {
    pub fn compile(spec: &OscTriggerSpec) -> Result<Self, String> {
        Ok(OscRule {
            trigger_id: spec.trigger_id.clone(),
            pattern: OscPattern::compile(&spec.pattern)?,
            require: spec.require.clone(),
        })
    }

    /// The verdict for one message, or nothing when the pattern does not match it at all.
    pub fn evaluate(&self, message: &OscMessage) -> Option<OscConditionVerdict> {
        if !self.pattern.matches(&message.address) {
            return None;
        }
        Some(match &self.require {
            None => OscConditionVerdict {
                met: true,
                reason: format!("{} matched", message.address),
            },
            Some(condition) => condition.holds(&message.args),
        })
    }
}

/// Where the listener may be reached from.
///
/// This is a **decision about risk**, not a preference: on loopback, only something already running on this machine
/// can reach the port, while on the network **any device on that network** can send an address that fires a macro —
/// at the wrong moment, in a show. That is why the network is opt-in, why it is refused without an allow-list, and
/// why the page says both things where the switch is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OscBind {
    /// This machine only: the default, and what every build starts with.
    ThisMac,
    /// Every interface, for an application on another device (a tablet running TouchOSC, a laptop running QLab).
    Network,
}

impl OscBind {
    pub fn address(self) -> Ipv4Addr {
        match self {
            OscBind::ThisMac => Ipv4Addr::LOCALHOST,
            OscBind::Network => Ipv4Addr::UNSPECIFIED,
        }
    }

    pub fn describe(self) -> &'static str {
        match self {
            OscBind::ThisMac => "this machine only",
            OscBind::Network => "the network",
        }
    }
}

/// One configured trigger matching one message, handed to the application.
#[derive(Clone, Debug, Serialize)]
pub struct OscTriggerEvent {
    pub trigger_id: String,
    pub description: String,
    pub at_ms: u64,
    pub condition: Option<OscConditionVerdict>,
}

/// A compiled OSC address pattern.
///
/// The specification's rules are what make this worth writing rather than approximating with a regex:
///
/// * a pattern matches an address only when the two have **the same number of parts**;
/// * `*` matches any sequence of characters **inside one part** — it does **not** cross a `/`;
/// * `?` matches exactly one character, again inside a part;
/// * `[a-z]` is a character class, and `[!a-z]` is its negation;
/// * `{foo,bar}` matches any of the strings in the list, inside a part.
///
/// An address with no wildcard at all is just a pattern with nothing to match loosely, which is why there is one
/// type and not two.
#[derive(Clone, Debug)]
pub struct OscPattern {
    parts: Vec<Vec<Vec<Token>>>,
}

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Literal(char),
    AnyChar,
    AnyRun,
    Class { negated: bool, ranges: Vec<(char, char)> },
}

impl OscPattern {
    /// Compile a pattern, or say what is wrong with it: an unbalanced `[` or `{` is refused at the field, like
    /// every other address this build accepts.
    pub fn compile(pattern: &str) -> Result<Self, String> {
        let pattern = pattern.trim();
        if pattern.is_empty() {
            return Err("the pattern is empty".to_string());
        }
        if !pattern.starts_with('/') {
            return Err(format!("'{pattern}' is not an OSC pattern: it must start with '/'"));
        }
        let mut parts = Vec::new();
        for (position, part) in pattern.split('/').enumerate().skip(1) {
            if part.is_empty() {
                return Err(format!("part {position} of '{pattern}' is empty"));
            }
            parts.push(compile_part(part).map_err(|error| format!("'{pattern}': {error}"))?);
        }
        Ok(OscPattern { parts })
    }

    /// True when this pattern matches that address.
    pub fn matches(&self, address: &str) -> bool {
        let parts: Vec<&str> = address.split('/').skip(1).collect();
        // The part count is part of the match: `/a/*` does not match `/a/b/c`, and the specification says so.
        if parts.len() != self.parts.len() || !address.starts_with('/') {
            return false;
        }
        self.parts
            .iter()
            .zip(parts)
            .all(|(alternatives, part)| {
                // A part may be several alternatives (`{foo,bar}`), and matching any one of them is enough.
                alternatives.iter().any(|tokens| match_tokens(tokens, part))
            })
    }
}

/// One part compiles to one or more token sequences: `{a,b}` becomes two, so matching needs no backtracking
/// between alternatives — only inside a sequence, where `*` needs it.
fn compile_part(part: &str) -> Result<Vec<Vec<Token>>, String> {
    let mut alternatives: Vec<Vec<Token>> = vec![Vec::new()];
    let characters: Vec<char> = part.chars().collect();
    let mut index = 0;
    while index < characters.len() {
        match characters[index] {
            '*' => {
                for alternative in alternatives.iter_mut() {
                    alternative.push(Token::AnyRun);
                }
                index += 1;
            }
            '?' => {
                for alternative in alternatives.iter_mut() {
                    alternative.push(Token::AnyChar);
                }
                index += 1;
            }
            '[' => {
                let Some(close) = characters[index..].iter().position(|character| *character == ']') else {
                    return Err("a '[' with no matching ']'".to_string());
                };
                let close = index + close;
                let mut body = &characters[index + 1..close];
                let negated = body.first() == Some(&'!');
                if negated {
                    body = &body[1..];
                }
                let mut ranges = Vec::new();
                let mut at = 0;
                while at < body.len() {
                    if at + 2 < body.len() && body[at + 1] == '-' {
                        ranges.push((body[at], body[at + 2]));
                        at += 3;
                    } else {
                        ranges.push((body[at], body[at]));
                        at += 1;
                    }
                }
                if ranges.is_empty() {
                    return Err("an empty character class".to_string());
                }
                for alternative in alternatives.iter_mut() {
                    alternative.push(Token::Class {
                        negated,
                        ranges: ranges.clone(),
                    });
                }
                index = close + 1;
            }
            '{' => {
                let Some(close) = characters[index..].iter().position(|character| *character == '}') else {
                    return Err("a '{' with no matching '}'".to_string());
                };
                let close = index + close;
                let body: String = characters[index + 1..close].iter().collect();
                let choices: Vec<&str> = body.split(',').collect();
                if choices.iter().any(|choice| choice.is_empty()) {
                    return Err("an empty alternative in '{}'".to_string());
                }
                // Each alternative is appended to every branch built so far: `{a,b}c` gives `ac` and `bc`.
                let mut expanded = Vec::new();
                for alternative in &alternatives {
                    for choice in &choices {
                        let mut branch = alternative.clone();
                        for character in choice.chars() {
                            branch.push(Token::Literal(character));
                        }
                        expanded.push(branch);
                    }
                }
                alternatives = expanded;
                index = close + 1;
            }
            character => {
                for alternative in alternatives.iter_mut() {
                    alternative.push(Token::Literal(character));
                }
                index += 1;
            }
        }
    }
    Ok(alternatives)
}

/// Match a token sequence against a part, with `*` allowed to take any run **inside** the part.
fn match_tokens(tokens: &[Token], text: &str) -> bool {
    let characters: Vec<char> = text.chars().collect();
    match_from(tokens, &characters, 0)
}

fn match_from(tokens: &[Token], text: &[char], at: usize) -> bool {
    match tokens.split_first() {
        None => at == text.len(),
        Some((Token::AnyRun, rest)) => {
            // Any run, including none: try every length, because a later token may need the characters.
            (at..=text.len()).any(|next| match_from(rest, text, next))
        }
        Some((Token::AnyChar, rest)) => at < text.len() && match_from(rest, text, at + 1),
        Some((Token::Literal(wanted), rest)) => {
            at < text.len() && text[at] == *wanted && match_from(rest, text, at + 1)
        }
        Some((Token::Class { negated, ranges }, rest)) => {
            if at >= text.len() {
                return false;
            }
            let inside = ranges.iter().any(|(low, high)| text[at] >= *low && text[at] <= *high);
            inside != *negated && match_from(rest, text, at + 1)
        }
    }
}

/// One argument to send. The types this build can encode: what is not here cannot be sent, which is the same rule
/// the MIDI half follows.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum OscArg {
    Int(i32),
    Float(f32),
    Str(String),
    Bool(bool),
    Nil,
    Impulse,
}

impl OscArg {
    fn tag(&self) -> char {
        match self {
            OscArg::Int(_) => 'i',
            OscArg::Float(_) => 'f',
            OscArg::Str(_) => 's',
            OscArg::Bool(true) => 'T',
            OscArg::Bool(false) => 'F',
            OscArg::Nil => 'N',
            OscArg::Impulse => 'I',
        }
    }

    /// Write the argument, padded to four bytes, the way the specification defines it.
    fn write(&self, bytes: &mut Vec<u8>) -> Result<(), String> {
        match self {
            OscArg::Int(value) => bytes.extend_from_slice(&value.to_be_bytes()),
            OscArg::Float(value) => bytes.extend_from_slice(&value.to_bits().to_be_bytes()),
            OscArg::Str(value) => write_osc_string(bytes, value)?,
            // The three argument-less tags carry no data at all.
            OscArg::Bool(_) | OscArg::Nil | OscArg::Impulse => {}
        }
        Ok(())
    }

    pub fn describe(&self) -> String {
        match self {
            OscArg::Int(value) => format!("i {value}"),
            OscArg::Float(value) => format!("f {value}"),
            OscArg::Str(value) => format!("s \"{value}\""),
            OscArg::Bool(value) => if *value { "T" } else { "F" }.to_string(),
            OscArg::Nil => "N".to_string(),
            OscArg::Impulse => "I".to_string(),
        }
    }
}

/// Write an OSC string: the text, a null, and padding to the next four-byte boundary.
///
/// An interior null is refused rather than written: the peer would read the string as ending there and every
/// value after it would land at the wrong offset — a packet that decodes to something nobody sent.
fn write_osc_string(bytes: &mut Vec<u8>, value: &str) -> Result<(), String> {
    if value.contains('\0') {
        return Err("a string cannot contain a null character: the peer would read it as the end".to_string());
    }
    bytes.extend_from_slice(value.as_bytes());
    bytes.push(0);
    while bytes.len() % 4 != 0 {
        bytes.push(0);
    }
    Ok(())
}

/// A message to send, validated before anything leaves.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct OscSendSpec {
    pub address: String,
    #[serde(default)]
    pub args: Vec<OscArg>,
}

impl OscSendSpec {
    /// The bytes, or the reason they cannot be built.
    ///
    /// The address rule is narrower than "refuse the pattern characters", and the difference is the whole point:
    /// the specification forbids certain characters **in a method name**, while QLab documents sending patterns in
    /// the address to match several of its methods at once (`/cue/*/armed 0`). So a pattern character is allowed —
    /// the peer decides what it matches — and the characters that would corrupt the encoding or the name itself are
    /// refused: a space inside a part, a comma (it starts the type tags), and an empty part.
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        let address = self.address.trim();
        if address.is_empty() {
            return Err("the address is empty".to_string());
        }
        if !address.starts_with('/') {
            return Err(format!("'{address}' is not an OSC address: it must start with '/'"));
        }
        for (position, part) in address.split('/').enumerate().skip(1) {
            if part.is_empty() {
                return Err(format!("part {position} of '{address}' is empty"));
            }
            if let Some(bad) = part.chars().find(|character| match character {
                ' ' | '\0' => true,
                // A comma is forbidden in a method name, but it is exactly what an alternation pattern uses:
                // `{foo,bar}` is how OSC matches one of several names, so a comma is allowed inside braces and
                // refused outside them. The first version of this rule refused every comma, which would have made
                // a documented pattern unsendable — and the test said so.
                ',' => !(part.contains('{') && part.contains('}')),
                _ => false,
            }) {
                return Err(format!(
                    "'{bad}' cannot appear in a part of '{address}': a space, a stray comma or a null would make \\
                     the peer read the name or its arguments wrongly"
                ));
            }
        }
        let mut bytes = Vec::new();
        write_osc_string(&mut bytes, address)?;
        let tags: String = std::iter::once(',').chain(self.args.iter().map(OscArg::tag)).collect();
        write_osc_string(&mut bytes, &tags)?;
        for arg in &self.args {
            arg.write(&mut bytes)?;
        }
        Ok(bytes)
    }

    /// What the result line says: the message in words, so the operator reads what left rather than "ok".
    pub fn describe(&self) -> String {
        if self.args.is_empty() {
            return format!("sent {} with no arguments", self.address);
        }
        let args = self.args.iter().map(OscArg::describe).collect::<Vec<_>>().join(" · ");
        format!("sent {} · {args}", self.address)
    }
}

/// What a sender looks like in the monitor, so an operator can recognise it and add it deliberately.
#[derive(Clone, Debug, Serialize)]
pub struct OscSeen {
    pub from: String,
    pub address: String,
    pub args: String,
    pub at_ms: u64,
}

/// Counters. Nothing here is actionable: this phase cannot trigger anything.
#[derive(Debug, Default)]
pub struct OscMonitor {
    received: AtomicU64,
    messages: AtomicU64,
    malformed: AtomicU64,
    unknown_senders: AtomicU64,
    dropped_flood: AtomicU64,
    sent: AtomicU64,
    matches: AtomicU64,
    matches_dropped: AtomicU64,
    last: Mutex<Option<OscSeen>>,
    last_problem: Mutex<Option<String>>,
    unknown_sender_sample: Mutex<Option<String>>,
    /// Where it was told to listen, for the readout: an operator has to see whether the port is reachable from the
    /// network without going back to the setting that decided it.
    bind: Mutex<Option<String>>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct OscMonitorSnapshot {
    pub received: u64,
    pub messages: u64,
    pub malformed: u64,
    pub unknown_senders: u64,
    pub dropped_flood: u64,
    pub sent: u64,
    pub matches: u64,
    pub matches_dropped: u64,
    pub last: Option<OscSeen>,
    pub last_problem: Option<String>,
    /// "this machine only" or "the network" while it is listening, and nothing when it is not.
    pub bind: Option<String>,
    pub unknown_sender_sample: Option<String>,
}

impl OscMonitor {
    fn set_bind(&self, bind: Option<String>) {
        if let Ok(mut guard) = self.bind.lock() {
            *guard = bind;
        }
    }

    pub fn snapshot(&self) -> OscMonitorSnapshot {
        OscMonitorSnapshot {
            received: self.received.load(Ordering::Relaxed),
            messages: self.messages.load(Ordering::Relaxed),
            malformed: self.malformed.load(Ordering::Relaxed),
            unknown_senders: self.unknown_senders.load(Ordering::Relaxed),
            dropped_flood: self.dropped_flood.load(Ordering::Relaxed),
            sent: self.sent.load(Ordering::Relaxed),
            matches: self.matches.load(Ordering::Relaxed),
            matches_dropped: self.matches_dropped.load(Ordering::Relaxed),
            last: self.last.lock().ok().and_then(|guard| guard.clone()),
            last_problem: self.last_problem.lock().ok().and_then(|guard| guard.clone()),
            bind: self.bind.lock().ok().and_then(|guard| guard.clone()),
            unknown_sender_sample: self
                .unknown_sender_sample
                .lock()
                .ok()
                .and_then(|guard| guard.clone()),
        }
    }

    fn record_packet(&self, from: &str, messages: &[OscMessage], at_ms: u64) {
        self.received.fetch_add(1, Ordering::Relaxed);
        self.messages.fetch_add(messages.len() as u64, Ordering::Relaxed);
        if let Some(message) = messages.first() {
            if let Ok(mut guard) = self.last.lock() {
                *guard = Some(OscSeen {
                    from: from.to_string(),
                    address: message.address.clone(),
                    args: message.describe_args(),
                    at_ms,
                });
            }
        }
    }

    fn record_malformed(&self, error: &OscDecodeError) {
        self.malformed.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut guard) = self.last_problem.lock() {
            *guard = Some(error.describe());
        }
    }

    fn record_unknown_sender(&self, from: &str) {
        self.unknown_senders.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut guard) = self.unknown_sender_sample.lock() {
            *guard = Some(from.to_string());
        }
    }

    fn record_flood_drop(&self) {
        self.dropped_flood.fetch_add(1, Ordering::Relaxed);
    }

    fn record_sent(&self) {
        self.sent.fetch_add(1, Ordering::Relaxed);
    }

    fn record_match(&self) {
        self.matches.fetch_add(1, Ordering::Relaxed);
    }

    fn record_match_dropped(&self) {
        self.matches_dropped.fetch_add(1, Ordering::Relaxed);
    }
}

/// Everything the receive thread needs. It is one shared object because the thread cannot borrow the listener:
/// a flag it could not see is a thread that never stops, which is how this was written first.
struct OscShared {
    monitor: Arc<OscMonitor>,
    /// The addresses allowed to be heard. Empty means "observe anyone", which is how an operator finds out who
    /// is out there; as soon as one OSC peer is configured, only that peer is heard. Loopback is always welcome.
    allowed: Mutex<Vec<String>>,
    /// The flood window: packets seen since `at`, and how many are allowed per second.
    flood: Mutex<(Option<Instant>, u64)>,
    flood_per_second: u64,
    running: AtomicBool,
    origin: Instant,
    /// The compiled rules, compiled **once** when the window configures them: a matching message costs a few
    /// comparisons, and a bad pattern is refused at the field rather than at the moment a cue should fire.
    rules: Mutex<Vec<OscRule>>,
    /// Where matches are handed over, when the application asked for them.
    sink: Mutex<Option<std::sync::mpsc::SyncSender<OscTriggerEvent>>>,
}

/// How many matches may wait to be handed over. A concert's worth of cues fits many times over; a loop does not,
/// and it is dropped and counted instead of growing.
pub const TRIGGER_QUEUE_CAPACITY: usize = 256;

impl OscShared {
    /// True when this packet may be read. A storm costs a counter, never a backlog.
    fn flood_allows(&self, now: Instant) -> bool {
        let mut window = match self.flood.lock() {
            Ok(window) => window,
            Err(_) => return true,
        };
        match window.0 {
            Some(at) if now.duration_since(at) < Duration::from_secs(1) => {
                window.1 += 1;
                window.1 <= self.flood_per_second
            }
            _ => {
                window.0 = Some(now);
                window.1 = 1;
                true
            }
        }
    }

    fn sender_is_allowed(&self, from: &SocketAddr) -> bool {
        if from.ip().is_loopback() {
            return true;
        }
        self.allowed
            .lock()
            .map(|guard| guard.is_empty() || guard.iter().any(|entry| entry == &from.ip().to_string()))
            .unwrap_or(false)
    }

    fn read_one(&self, buffer: &[u8], from: &SocketAddr) {
        let at_ms = self.origin.elapsed().as_millis() as u64;
        let messages = match decode_packet(buffer) {
            Ok(messages) => messages,
            Err(error) => {
                self.monitor.record_malformed(&error);
                return;
            }
        };
        self.monitor.record_packet(&from.ip().to_string(), &messages, at_ms);
        // Every message in the packet is matched, because a bundle can carry several and the specification
        // dispatches each of them to everything that matches.
        let rules = match self.rules.lock() {
            Ok(rules) => rules.clone(),
            Err(_) => return,
        };
        for message in &messages {
            for rule in &rules {
                let Some(verdict) = rule.evaluate(message) else {
                    continue;
                };
                self.monitor.record_match();
                let event = OscTriggerEvent {
                    trigger_id: rule.trigger_id.clone(),
                    description: format!("{} · {}", message.address, message.describe_args()),
                    at_ms,
                    condition: if rule.require.is_some() { Some(verdict) } else { None },
                };
                // `try_send`, never `send`: this is the socket's thread, and waiting here would be waiting inside
                // the receive loop. A full queue is a counted drop.
                let handed_over = self
                    .sink
                    .lock()
                    .ok()
                    .and_then(|guard| guard.as_ref().map(|sender| sender.try_send(event)))
                    .map(|result| result.is_ok())
                    .unwrap_or(false);
                if !handed_over {
                    self.monitor.record_match_dropped();
                }
            }
        }
    }
}

/// The listener: one socket on loopback, one receive thread that ends when the listener is closed, and nothing
/// that runs on a timer except the socket's own read timeout.
pub struct OscListener {
    shared: Arc<OscShared>,
    /// A clone kept only so that closing the listener drops it; the thread owns the original.
    socket: Mutex<Option<UdpSocket>>,
    port: AtomicU64,
}

impl Default for OscListener {
    fn default() -> Self {
        Self::new()
    }
}

impl OscListener {
    pub fn new() -> Self {
        Self::with_flood_guard(2_000)
    }

    /// A listener with a chosen flood limit, so a test can reach the guard without sending two thousand packets.
    pub fn with_flood_guard(per_second: u64) -> Self {
        Self {
            shared: Arc::new(OscShared {
                monitor: Arc::new(OscMonitor::default()),
                allowed: Mutex::new(Vec::new()),
                flood: Mutex::new((None, 0)),
                flood_per_second: per_second,
                running: AtomicBool::new(false),
                origin: Instant::now(),
                rules: Mutex::new(Vec::new()),
                sink: Mutex::new(None),
            }),
            socket: Mutex::new(None),
            port: AtomicU64::new(0),
        }
    }

    pub fn is_open(&self) -> bool {
        self.shared.running.load(Ordering::Relaxed)
    }

    pub fn port(&self) -> u16 {
        self.port.load(Ordering::Relaxed) as u16
    }

    pub fn snapshot(&self) -> OscMonitorSnapshot {
        self.shared.monitor.snapshot()
    }

    /// Replace the compiled rules. Configuration only: it takes effect on the next packet, and a rule that cannot
    /// be compiled is refused by the caller rather than silently ignored here.
    pub fn configure(&self, rules: Vec<OscRule>) {
        if let Ok(mut guard) = self.shared.rules.lock() {
            *guard = rules;
        }
    }

    /// How many triggers are configured, for the counters the operator reads.
    pub fn trigger_count(&self) -> usize {
        self.shared.rules.lock().map(|guard| guard.len()).unwrap_or(0)
    }

    /// Replace the allow-list. Configuration only: it takes effect on the next packet.
    pub fn set_allowed(&self, allowed: Vec<String>) {
        if let Ok(mut guard) = self.shared.allowed.lock() {
            *guard = allowed;
        }
    }

    /// Bind and listen. Refused while the feature is switched off, and refused when the port is taken — with the
    /// reason, because "it did not listen" is not something an operator can act on.
    pub fn open(
        &self,
        enabled: bool,
        port: u16,
        bind: OscBind,
        allowed: Vec<String>,
        sink: Option<std::sync::mpsc::SyncSender<OscTriggerEvent>>,
    ) -> Result<(), String> {
        ensure_enabled(enabled)?;
        // The rule that keeps an open port from being a way into a show: a listener on the network with nobody
        // allow-listed would act on an address from **any** device on that network. Refused here, before a socket
        // exists, so the refusal cannot half-open anything.
        if bind == OscBind::Network && allowed.iter().all(|host| host.trim().is_empty()) {
            return Err(
                "listening on the network needs at least one application listed: without one, any device on that \
                 network could fire a macro. Add the application's address, or listen on this machine only"
                    .to_string(),
            );
        }
        // Closing first stops a previous thread; the sink is installed after, because closing clears it.
        self.close();
        if let Ok(mut guard) = self.shared.sink.lock() {
            *guard = sink;
        }
        self.set_allowed(allowed);
        self.shared.monitor.set_bind(Some(bind.describe().to_string()));
        let address = SocketAddrV4::new(bind.address(), port);
        let socket = UdpSocket::bind(address)
            .map_err(|error| format!("the OSC listener could not bind {address}: {error}"))?;
        socket
            .set_read_timeout(Some(Duration::from_millis(250)))
            .map_err(|error| format!("the OSC listener could not be configured: {error}"))?;
        // The port that was actually bound, which is what a caller needs when it asked for an ephemeral one, and
        // what the window shows so the operator can point the other application at it.
        let bound_port = socket.local_addr().map(|address| address.port()).unwrap_or(port);
        if let Ok(mut guard) = self.socket.lock() {
            *guard = Some(socket.try_clone().map_err(|error| error.to_string())?);
        }
        let shared = Arc::clone(&self.shared);
        shared.running.store(true, Ordering::Relaxed);
        std::thread::spawn(move || {
            let mut buffer = [0_u8; 65_536];
            while shared.running.load(Ordering::Relaxed) {
                let (size, from) = match socket.recv_from(&mut buffer) {
                    Ok(received) => received,
                    // The read timeout is what lets the loop notice that it has been asked to stop; a
                    // `WouldBlock` or a timeout is simply the next turn of the loop.
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) =>
                    {
                        continue
                    }
                    Err(_) => break,
                };
                if !shared.sender_is_allowed(&from) {
                    shared.monitor.record_unknown_sender(&from.ip().to_string());
                    continue;
                }
                if !shared.flood_allows(Instant::now()) {
                    shared.monitor.record_flood_drop();
                    continue;
                }
                shared.read_one(&buffer[..size], &from);
            }
        });
        self.port.store(bound_port as u64, Ordering::Relaxed);
        Ok(())
    }

    /// Send one message.
    ///
    /// It leaves from the **listener's socket**, and that is not an implementation detail: QLab replies "to the IP
    /// address from which the original message was received" and LiveProfessor answers to its own output port, so a
    /// message sent from an ephemeral socket gets its answer delivered to a port nobody reads. Sending from the
    /// listening socket is what makes a reply arrive.
    ///
    /// What comes back is a sentence about what left, never that it arrived: UDP does not know.
    pub fn send(&self, spec: &OscSendSpec, host: &str, port: u16) -> Result<String, String> {
        self.send_when(spec, host, port, || true)
    }
    pub fn send_when(&self, spec: &OscSendSpec, host: &str, port: u16, allowed: impl Fn() -> bool) -> Result<String, String> {
        let bytes = spec.encode()?;
        let host = host.trim();
        if host.is_empty() {
            return Err("the target address is empty".to_string());
        }
        if port == 0 {
            return Err("the target port is not set".to_string());
        }
        let target = format!("{host}:{port}");
        // Resolve before taking the socket and recheck cancellation afterwards.
        let resolved: Vec<_> = std::net::ToSocketAddrs::to_socket_addrs(&(host, port))
            .map_err(|error| format!("The OSC destination could not be resolved: {error}"))?.collect();
        let socket = self
            .socket
            .lock()
            .map_err(|_| "the OSC socket is unavailable".to_string())?;
        if !allowed() { return Err("OSC action cancelled before sending".into()); }
        let socket = socket.as_ref().ok_or_else(|| {
            "the OSC listener is not open (Settings → MIDI, Inter-app OSC → Start listening): a reply would have \
             nowhere to arrive"
                .to_string()
        })?;
        let local = socket.local_addr().map_err(|error| error.to_string())?;
        let resolved = resolved.into_iter().find(|address| address.is_ipv4() == local.is_ipv4())
            .ok_or_else(|| "The OSC destination has no address compatible with the listener".to_string())?;
        if !allowed() { return Err("OSC action cancelled before sending".into()); }
        socket
            .send_to(&bytes, resolved)
            .map_err(|error| format!("the message could not be sent to {target}: {error}"))?;
        self.shared.monitor.record_sent();
        Ok(format!("{} to {target}", spec.describe()))
    }

    /// Close the listener. Idempotent, and never fails: switching off must be able to switch off.
    pub fn close(&self) {
        self.shared.running.store(false, Ordering::Relaxed);
        self.shared.monitor.set_bind(None);
        // Dropping the sink ends the consumer's `recv()`, which is how its thread exits: no polling, no shutdown
        // flag to forget.
        if let Ok(mut guard) = self.shared.sink.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.socket.lock() {
            *guard = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_is_checked_inside_the_socket_lock_and_sends_nothing() {
        let listener = OscListener::new();
        let receiver = UdpSocket::bind("127.0.0.1:0").unwrap();
        receiver.set_nonblocking(true).unwrap();
        *listener.socket.lock().unwrap() = Some(UdpSocket::bind("127.0.0.1:0").unwrap());
        let error = listener.send_when(&OscSendSpec { address: "/audit".into(), args: vec![] },
            "127.0.0.1", receiver.local_addr().unwrap().port(), || {
                assert!(listener.socket.try_lock().is_err(), "cancellation must be checked after the socket lock");
                false
            }).unwrap_err();
        assert!(error.contains("cancelled"), "{error}");
        assert_eq!(receiver.recv_from(&mut [0; 64]).unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
        assert_eq!(listener.snapshot().sent, 0);
    }


    /// Build an OSC message the way a peer does: address, type tags, arguments, all padded to four bytes.
    fn message(address: &str, tags: &str, args: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for text in [address, tags] {
            bytes.extend_from_slice(text.as_bytes());
            bytes.push(0);
            while bytes.len() % 4 != 0 {
                bytes.push(0);
            }
        }
        bytes.extend_from_slice(args);
        bytes
    }

    /// The decoder reads the spec's encoding, padding included.
    #[test]
    fn a_message_decodes_with_the_specs_padding() {
        let packet = message("/mixer/fader", ",if", &[0, 0, 0, 3, 0x3F, 0x00, 0x00, 0x00]);
        let messages = decode_packet(&packet).expect("a readable message");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].address, "/mixer/fader");
        assert_eq!(messages[0].args, vec![OscValue::Int(3), OscValue::Float(0.5)]);
        assert_eq!(messages[0].describe_args(), "i 3 · f 0.5");

        // Strings and blobs carry their own lengths, and the next value starts on a four-byte boundary.
        let mut string_args = Vec::new();
        // "cue" plus its terminator **is** the four-byte padding: a second null here would shift every value
        // after it, which is exactly the mistake this assertion caught.
        string_args.extend_from_slice(b"cue\0");
        string_args.extend_from_slice(&7_i32.to_be_bytes());
        string_args.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 0]);
        let packet = message("/go", ",sb", &string_args);
        let messages = decode_packet(&packet).expect("a readable message");
        assert_eq!(
            messages[0].args,
            vec![OscValue::Str("cue".to_string()), OscValue::Blob(7)]
        );
    }

    /// The specification asks for robustness where peers omit the type tags, and for a whole message to be thrown
    /// away when one tag is unknown — half a message is worse than none, because the arguments after the unknown
    /// tag would be read at the wrong offsets and become values nobody sent.
    #[test]
    fn a_missing_type_tag_is_tolerated_and_an_unknown_one_discards_the_message() {
        let packet = message("/no/args", "", &[]);
        let messages = decode_packet(&packet).expect("a message with no type tags is still a message");
        assert_eq!(messages[0].address, "/no/args");
        assert!(messages[0].args.is_empty());

        let packet = message("/odd", ",iX", &[0, 0, 0, 1, 0, 0, 0, 2]);
        assert_eq!(
            decode_packet(&packet).expect_err("an unknown tag discards the message"),
            OscDecodeError::UnknownTypeTag('X')
        );
        assert!(OscDecodeError::UnknownTypeTag('X').describe().contains("unknown type tag 'X'"));
    }

    /// Malformed packets are refused with a reason, and never panic: a hostile packet on a stage network is a
    /// certainty, not a hypothetical.
    #[test]
    fn malformed_packets_are_refused_with_a_reason() {
        assert_eq!(decode_packet(&[]).expect_err("nothing"), OscDecodeError::Empty);
        assert!(matches!(
            decode_packet(b"not-an-address\0\0").expect_err("no leading slash"),
            OscDecodeError::NotAnAddress(_)
        ));
        // A string with no terminator inside the packet: the parser must not read past the end.
        assert_eq!(
            decode_packet(b"/unterminated").expect_err("no terminator"),
            OscDecodeError::UnterminatedString
        );
        // A declared argument that is not there.
        assert_eq!(
            decode_packet(&message("/truncated", ",i", &[])).expect_err("no argument"),
            OscDecodeError::Truncated
        );
        // A blob that claims to be enormous.
        let mut args = Vec::new();
        args.extend_from_slice(&i32::MAX.to_be_bytes());
        assert_eq!(
            decode_packet(&message("/blob", ",b", &args)).expect_err("an absurd blob"),
            OscDecodeError::Truncated
        );
    }

    /// Bundles decode, and their limits hold: depth and message count are what keep a broken or hostile peer from
    /// making the application allocate without bound.
    #[test]
    fn bundles_decode_and_their_limits_hold() {
        let bundle = |elements: &[Vec<u8>]| {
            let mut bytes = Vec::new();
            bytes.extend_from_slice(b"#bundle\0");
            bytes.extend_from_slice(&1_u64.to_be_bytes()); // immediately
            for element in elements {
                bytes.extend_from_slice(&(element.len() as i32).to_be_bytes());
                bytes.extend_from_slice(element);
            }
            bytes
        };
        let first = message("/one", ",i", &[0, 0, 0, 1]);
        let second = message("/two", ",f", &[0x40, 0x00, 0x00, 0x00]);
        let messages = decode_packet(&bundle(&[first.clone(), second.clone()])).expect("a bundle");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].address, "/two");
        assert_eq!(messages[1].args, vec![OscValue::Float(2.0)]);

        // Nesting beyond the cap is refused rather than followed.
        let mut nested = first.clone();
        for _ in 0..(MAX_BUNDLE_DEPTH + 2) {
            nested = bundle(&[nested]);
        }
        assert_eq!(
            decode_packet(&nested).expect_err("too deep"),
            OscDecodeError::TooDeep
        );

        // More messages than one packet may carry is refused too.
        let many = bundle(&vec![first; MAX_MESSAGES_PER_PACKET + 2]);
        assert_eq!(
            decode_packet(&many).expect_err("too many"),
            OscDecodeError::TooManyMessages
        );
    }

    /// An element cannot complete itself from the bytes of the element after it.
    ///
    /// Element one declares three bytes: an address with no terminator. Bounded, the failure is the honest one about
    /// that element (`UnterminatedString`). Handed the whole packet — which is what the parser used to get — the same
    /// element reads on into the element after it and reports `NotAnAddress("")` instead: an error about bytes nobody
    /// sent, from a message that does not exist. Verified by mutation, because a test of a bound is worth nothing until
    /// removing the bound breaks it: with the bound removed this test fails with exactly that error.
    #[test]
    fn an_element_cannot_read_the_bytes_of_the_next_one() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"#bundle\0");
        bytes.extend_from_slice(&1_u64.to_be_bytes());
        // Element one: an address cut before its terminator, declaring only what it wrote.
        let head = b"/ab";
        bytes.extend_from_slice(&(head.len() as i32).to_be_bytes());
        bytes.extend_from_slice(head);
        // The terminator, and a whole message after it, as the next element.
        bytes.extend_from_slice(b"\0\0\0\0");
        let second = message("/two", ",i", &[0, 0, 0, 7]);
        bytes.extend_from_slice(&(second.len() as i32).to_be_bytes());
        bytes.extend_from_slice(&second);

        assert_eq!(
            decode_packet(&bytes).expect_err("a cut address cannot borrow the next element's terminator"),
            OscDecodeError::UnterminatedString
        );
    }

    /// A bundle scheduled for the future is refused rather than run early: in a show, a cue that fires early is worse
    /// than one that does not fire. The past and the immediate cases still run, because they are meant to have happened.
    #[test]
    fn a_bundle_scheduled_for_the_future_is_refused_rather_than_run_early() {
        let bundle_at = |timetag: u64| {
            let mut bytes = Vec::new();
            bytes.extend_from_slice(b"#bundle\0");
            bytes.extend_from_slice(&timetag.to_be_bytes());
            let element = message("/one", ",i", &[0, 0, 0, 1]);
            bytes.extend_from_slice(&(element.len() as i32).to_be_bytes());
            bytes.extend_from_slice(&element);
            bytes
        };
        // Immediate, and the zero several implementations send for it.
        assert!(decode_packet(&bundle_at(1)).is_ok(), "the immediate timetag runs");
        assert!(decode_packet(&bundle_at(0)).is_ok(), "and so does zero");
        // 1970: meant to have run already, so running it now is the right reading.
        assert!(decode_packet(&bundle_at(0x83AA_7E80_0000_0000)).is_ok(), "the past is not refused");
        // 2036 and beyond: a schedule this build does not keep.
        assert_eq!(
            decode_packet(&bundle_at(0xFFFF_0000_0000_0000)).expect_err("a future schedule"),
            OscDecodeError::UnsupportedFutureTimetag
        );
        // And an hour from now is still the future, which is the case that matters in practice.
        // Built the same way the wire carries it: seconds in the high half, fraction in the low half.
        let an_hour_ahead = (ntp_now() + 3_600) << 32;
        assert_eq!(
            decode_packet(&bundle_at(an_hour_ahead)).expect_err("a schedule an hour ahead"),
            OscDecodeError::UnsupportedFutureTimetag
        );
    }

    /// The listener itself, on the real system: a packet sent to it over UDP is decoded and counted, and the
    /// monitor remembers who sent it and what it said.
    #[test]
    fn the_listener_counts_what_a_real_socket_sends() {
        let listener = OscListener::with_flood_guard(1_000);
        listener
            .open(true, 0, OscBind::ThisMac, Vec::new(), None)
            .expect("the listener binds an ephemeral port");
        assert!(listener.is_open());
        let port = listener.port();
        assert_ne!(port, 0, "the bound port is the one to send to");

        let sender = UdpSocket::bind("127.0.0.1:0").expect("a sending socket");
        sender
            .send_to(&message("/video/playing", ",i", &[0, 0, 0, 1]), ("127.0.0.1", port))
            .expect("sending one message");

        // The receive thread is what reads it: poll briefly rather than assume the timing of a thread.
        let deadline = Instant::now() + Duration::from_secs(3);
        while listener.snapshot().received == 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        let snapshot = listener.snapshot();
        assert_eq!(snapshot.received, 1, "one packet");
        assert_eq!(snapshot.messages, 1, "carrying one message");
        assert_eq!(snapshot.malformed, 0);
        let last = snapshot.last.expect("the monitor remembers it");
        assert_eq!(last.address, "/video/playing");
        assert!(last.args.contains("i 1"), "{}", last.args);
        assert_eq!(last.from, "127.0.0.1");
        assert_eq!(snapshot.unknown_senders, 0, "loopback is always welcome");

        listener.close();
        assert!(!listener.is_open());
        // And it can be closed and opened again without leaving a thread behind.
        listener.open(true, 0, OscBind::ThisMac, Vec::new(), None).expect("reopening");
        listener.close();
    }

    /// The flood guard: beyond the limit, packets cost a counter instead of a backlog.
    #[test]
    fn a_flood_is_counted_and_dropped() {
        let listener = OscListener::with_flood_guard(1);
        listener.open(true, 0, OscBind::ThisMac, Vec::new(), None).expect("binding");
        let port = listener.port();
        let sender = UdpSocket::bind("127.0.0.1:0").expect("a sending socket");
        for index in 0..3_i32 {
            sender
                .send_to(&message("/flood", ",i", &index.to_be_bytes()), ("127.0.0.1", port))
                .expect("sending");
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while listener.snapshot().dropped_flood == 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        let snapshot = listener.snapshot();
        assert!(snapshot.dropped_flood >= 1, "{snapshot:?}");
        assert!(snapshot.received >= 1, "the first one was read");
        listener.close();
    }

    /// Who may be heard: loopback always, an allow-list when one is configured, and everyone while it is empty so
    /// the operator can see who is out there before fencing the network off.
    /// The rule that makes listening on a network a decision rather than an accident: the network is refused without
    /// an allow-list, and refused **before** a socket exists.
    #[test]
    fn listening_on_the_network_needs_at_least_one_allowed_application() {
        let listener = OscListener::default();
        let refused = listener
            .open(true, 0, OscBind::Network, Vec::new(), None)
            .expect_err("the network without an allow-list must be refused");
        assert!(refused.contains("at least one application"), "{refused}");
        assert!(refused.contains("fire a macro"), "{refused}");
        // Blank entries are the same as none: an address that is only spaces allow-lists nobody.
        assert!(listener
            .open(true, 0, OscBind::Network, vec!["   ".to_string()], None)
            .is_err());
        assert!(listener.snapshot().bind.is_none(), "a refused open leaves nothing listening");
        // The two scopes are the two addresses, and this machine is the safe one.
        assert_eq!(OscBind::ThisMac.address(), Ipv4Addr::LOCALHOST);
        assert_eq!(OscBind::Network.address(), Ipv4Addr::UNSPECIFIED);
        assert_eq!(OscBind::ThisMac.describe(), "this machine only");
        assert_eq!(OscBind::Network.describe(), "the network");
    }

    #[test]
    fn the_allow_list_fences_the_network_but_never_loopback() {
        let shared = |allowed: Vec<&str>| OscShared {
            monitor: Arc::new(OscMonitor::default()),
            allowed: Mutex::new(allowed.into_iter().map(|entry| entry.to_string()).collect()),
            flood: Mutex::new((None, 0)),
            flood_per_second: 1_000,
            running: AtomicBool::new(false),
            origin: Instant::now(),
            rules: Mutex::new(Vec::new()),
            sink: Mutex::new(None),
        };
        let local: SocketAddr = "127.0.0.1:9000".parse().unwrap();
        let known: SocketAddr = "192.168.1.50:9000".parse().unwrap();
        let stranger: SocketAddr = "192.168.1.99:9000".parse().unwrap();

        let fenced = shared(vec!["192.168.1.50"]);
        assert!(fenced.sender_is_allowed(&local), "this machine is always welcome");
        assert!(fenced.sender_is_allowed(&known), "a configured peer is");
        assert!(!fenced.sender_is_allowed(&stranger), "anyone else is not");

        let observing = shared(Vec::new());
        assert!(
            observing.sender_is_allowed(&stranger),
            "with nothing configured the listener observes, which is how an operator learns who is sending"
        );
    }

    /// The pattern rules, one assertion per rule the specification states — because each of them is a way a
    /// matcher can be subtly wrong in a way nobody notices until a cue does not fire.
    #[test]
    fn a_pattern_matches_by_the_specifications_rules() {
        let matches = |pattern: &str, address: &str| {
            OscPattern::compile(pattern)
                .unwrap_or_else(|error| panic!("{pattern}: {error}"))
                .matches(address)
        };

        // Exactly what it says, and nothing else.
        assert!(matches("/mixer/fader", "/mixer/fader"));
        assert!(!matches("/mixer/fader", "/mixer/faders"));
        assert!(!matches("/mixer/fader", "/mixer"));

        // The part count is part of the match: `*` never crosses a `/`, which is the mistake the first version of
        // the plan made and the reason this test exists.
        assert!(!matches("/mixer/*", "/mixer/fader/level"), "* must not cross a slash");
        assert!(matches("/mixer/*", "/mixer/fader"));
        assert!(matches("/mixer/*", "/mixer/"));
        assert!(!matches("/a/b", "/a/b/c"));

        // `?` is one character, inside a part.
        assert!(matches("/wing/?", "/wing/1"));
        assert!(!matches("/wing/?", "/wing/12"));
        assert!(matches("/w?ng/macro", "/wing/macro"));

        // `*` takes any run inside the part, including an empty one.
        assert!(matches("/cue/*/start", "/cue/selected/start"));
        assert!(matches("/cue/1/start", "/cue/1/start"));
        assert!(matches("/composition/layers/*/clips/*/connect", "/composition/layers/2/clips/4/connect"));
        assert!(matches("/a*b", "/ab"));
        assert!(matches("/a*b", "/axxxb"));

        // Classes, with ranges, lists and negation.
        assert!(matches("/ch/[1-4]/mute", "/ch/3/mute"));
        assert!(!matches("/ch/[1-4]/mute", "/ch/7/mute"));
        assert!(matches("/[abc]x", "/bx"));
        assert!(matches("/[!abc]x", "/dx"));
        assert!(!matches("/[!abc]x", "/ax"));

        // Alternation, whole strings inside a part.
        assert!(matches("/{foo,bar}/go", "/foo/go"));
        assert!(matches("/{foo,bar}/go", "/bar/go"));
        assert!(!matches("/{foo,bar}/go", "/baz/go"));

        // And a pattern with no wildcard is a legitimate pattern that matches only itself.
        assert!(matches("/exact", "/exact"));

        // The refusals: an address this build cannot compile is refused at the field, with the reason.
        for (pattern, why) in [
            ("", "empty"),
            ("no/slash", "no leading slash"),
            ("/a//b", "an empty part"),
            ("/a[1-4", "an unclosed class"),
            ("/a{foo,bar", "an unclosed alternation"),
            ("/{,a}", "an empty alternative"),
            ("/[]", "an empty class"),
        ] {
            let error = OscPattern::compile(pattern).expect_err(&format!("{pattern} must be refused: {why}"));
            assert!(!error.is_empty(), "{pattern}: the refusal says why");
        }
    }

    /// The address of an arriving message is matched against every configured pattern, and the ones that match are
    /// the ones that fire — in the order they were configured, so a test can say which.
    #[test]
    fn one_message_can_match_several_patterns() {
        let patterns = ["/cue/*/start", "/cue/1/*", "/other/*"];
        let matched: Vec<&str> = patterns
            .iter()
            .filter(|pattern| OscPattern::compile(pattern).expect("valid").matches("/cue/1/start"))
            .copied()
            .collect();
        assert_eq!(
            matched,
            vec!["/cue/*/start", "/cue/1/*"],
            "every pattern that matches fires: the specification dispatches to all of them"
        );
    }

    /// What a trigger asks of an argument, and what it says when the answer is no: the same three sentences the
    /// MIDI conditions produce, because an operator should not have to learn two vocabularies.
    #[test]
    fn an_argument_condition_explains_itself() {
        let condition = OscArgCondition {
            index: 1,
            compare: OscCompare::Greater,
            value: OscArg::Float(0.5),
        };
        let met = condition.holds(&[OscValue::Str("x".to_string()), OscValue::Float(0.8)]);
        assert!(met.met, "{}", met.reason);
        assert!(met.reason.contains("argument 2"), "{}", met.reason);

        let unmet = condition.holds(&[OscValue::Str("x".to_string()), OscValue::Float(0.2)]);
        assert!(!unmet.met);
        assert!(unmet.reason.contains("not > 0.5"), "{}", unmet.reason);

        // An argument that is not there is a different sentence from an argument that is wrong.
        let missing = condition.holds(&[OscValue::Str("x".to_string())]);
        assert!(!missing.met);
        assert!(missing.reason.contains("1 argument(s)"), "{}", missing.reason);

        // And a comparison that cannot be made is refused rather than guessed: a string has no ordering here.
        let incomparable = condition.holds(&[OscValue::Str("x".to_string()), OscValue::Str("y".to_string())]);
        assert!(!incomparable.met);
        assert!(incomparable.reason.contains("cannot be compared"), "{}", incomparable.reason);

        // Equality on strings works, and integers compare with floats.
        let text = OscArgCondition {
            index: 0,
            compare: OscCompare::Equal,
            value: OscArg::Str("cue".to_string()),
        };
        assert!(text.holds(&[OscValue::Str("cue".to_string())]).met);
        assert!(!text.holds(&[OscValue::Str("other".to_string())]).met);
        let numbers = OscArgCondition {
            index: 0,
            compare: OscCompare::GreaterOrEqual,
            value: OscArg::Float(3.0),
        };
        assert!(numbers.holds(&[OscValue::Int(3)]).met, "an int and a float compare as numbers");
        assert!(!numbers.holds(&[OscValue::Int(2)]).met);
    }

    /// The whole listening path on the real system: a UDP message to the listener is decoded, matched against the
    /// configured pattern, its argument condition evaluated, and the match handed to the application.
    #[test]
    fn a_message_sent_over_udp_matches_and_is_handed_over() {
        let listener = OscListener::with_flood_guard(1_000);
        let (sender, receiver) = std::sync::mpsc::sync_channel(8);
        listener
            .open(true, 0, OscBind::ThisMac, Vec::new(), Some(sender))
            .expect("the listener binds");
        listener.configure(vec![
            OscRule::compile(&OscTriggerSpec {
                trigger_id: "osc-1".to_string(),
                pattern: "/cue/*/start".to_string(),
                require: Some(OscArgCondition {
                    index: 0,
                    compare: OscCompare::Equal,
                    value: OscArg::Int(1),
                }),
            })
            .expect("a valid pattern"),
            OscRule::compile(&OscTriggerSpec {
                trigger_id: "osc-2".to_string(),
                pattern: "/other/*".to_string(),
                require: None,
            })
            .expect("a valid pattern"),
        ]);
        assert_eq!(listener.trigger_count(), 2);
        let port = listener.port();

        let sender_socket = UdpSocket::bind("127.0.0.1:0").expect("a sending socket");
        // The first message matches the pattern but not its condition: it is still handed over, with the reason,
        // because the window is what decides and it must be able to say why nothing fired.
        sender_socket
            .send_to(
                &OscSendSpec {
                    address: "/cue/selected/start".to_string(),
                    args: vec![OscArg::Int(2)],
                }
                .encode()
                .expect("encoded"),
                ("127.0.0.1", port),
            )
            .expect("sending");
        let event = receiver
            .recv_timeout(Duration::from_secs(3))
            .expect("the match must be handed over");
        assert_eq!(event.trigger_id, "osc-1");
        assert!(event.description.contains("/cue/selected/start"), "{}", event.description);
        let verdict = event.condition.expect("this trigger has a condition");
        assert!(!verdict.met, "{}", verdict.reason);
        assert!(verdict.reason.contains("not = 1"), "{}", verdict.reason);

        // The same address with the argument the condition asks for: met this time.
        sender_socket
            .send_to(
                &OscSendSpec {
                    address: "/cue/selected/start".to_string(),
                    args: vec![OscArg::Int(1)],
                }
                .encode()
                .expect("encoded"),
                ("127.0.0.1", port),
            )
            .expect("sending");
        let event = receiver.recv_timeout(Duration::from_secs(3)).expect("the second match");
        assert!(event.condition.expect("a condition").met);

        // And a message no pattern matches is counted as received and never handed over. The channel is what the
        // test can see: nothing arrives.
        sender_socket
            .send_to(
                &OscSendSpec { address: "/nothing/here".to_string(), args: Vec::new() }
                    .encode()
                    .expect("encoded"),
                ("127.0.0.1", port),
            )
            .expect("sending");
        assert!(
            receiver.recv_timeout(Duration::from_millis(300)).is_err(),
            "nothing may be handed over for a message no trigger matches"
        );
        let snapshot = listener.snapshot();
        assert_eq!(snapshot.received, 3, "all three packets were read");
        assert_eq!(snapshot.matches, 2, "two of them matched a trigger");
        assert_eq!(snapshot.matches_dropped, 0);

        listener.close();
        // Closing drops the sink, which is how the consumer's thread ends.
        assert!(receiver.recv_timeout(Duration::from_secs(2)).is_err());
    }

    /// The shape the window writes for an argument, pinned here: the editor builds this JSON and Rust has to read
    /// it, so the encoding of the argument-less tags is a contract and not a guess.
    #[test]
    fn the_arguments_the_window_writes_are_the_ones_this_reads() {
        let cases = [
            (r#"{"type":"int","value":3}"#, OscArg::Int(3)),
            (r#"{"type":"float","value":0.5}"#, OscArg::Float(0.5)),
            (r#"{"type":"str","value":"cue"}"#, OscArg::Str("cue".to_string())),
            (r#"{"type":"bool","value":true}"#, OscArg::Bool(true)),
            (r#"{"type":"bool","value":false}"#, OscArg::Bool(false)),
            // The three argument-less tags carry no `value` at all, which is what the editor writes for them.
            (r#"{"type":"nil"}"#, OscArg::Nil),
            (r#"{"type":"impulse"}"#, OscArg::Impulse),
        ];
        for (json, expected) in cases {
            let arg: OscArg = serde_json::from_str(json).unwrap_or_else(|error| panic!("{json}: {error}"));
            assert_eq!(arg, expected, "{json}");
        }
    }

    /// What is encoded is what the decoder reads back: the test goes out and comes home through the same rules.
    #[test]
    fn a_message_is_encoded_the_way_the_decoder_expects() {
        let spec = OscSendSpec {
            address: "/mixer/fader".to_string(),
            args: vec![OscArg::Int(3), OscArg::Float(0.5), OscArg::Str("cue".to_string())],
        };
        let bytes = spec.encode().expect("a valid message");
        // The framing, byte for byte: address, tags, then the arguments, each on a four-byte boundary.
        assert_eq!(&bytes[0..12], b"/mixer/fader");
        assert_eq!(&bytes[12..16], b"\0\0\0\0", "the address is padded to sixteen bytes");
        assert_eq!(&bytes[16..20], b",ifs", "the tags follow, on the next four-byte boundary");
        let messages = decode_packet(&bytes).expect("and it decodes");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].address, "/mixer/fader");
        assert_eq!(
            messages[0].args,
            vec![OscValue::Int(3), OscValue::Float(0.5), OscValue::Str("cue".to_string())]
        );

        // The argument-less tags carry no data and still round trip.
        let spec = OscSendSpec {
            address: "/go".to_string(),
            args: vec![OscArg::Bool(true), OscArg::Nil, OscArg::Impulse],
        };
        let messages = decode_packet(&spec.encode().expect("valid")).expect("decodes");
        assert_eq!(
            messages[0].args,
            vec![OscValue::Bool(true), OscValue::Nil, OscValue::Impulse]
        );

        // And the sentence the operator is shown says what left.
        let described = OscSendSpec {
            address: "/video/playing".to_string(),
            args: vec![OscArg::Int(1)],
        }
        .describe();
        assert!(described.starts_with("sent /video/playing"), "{described}");
        assert!(described.contains("i 1"), "{described}");
    }

    /// The address rule is narrower than "refuse the pattern characters", and the difference is the whole point:
    /// the specification forbids those characters **in a method name**, while QLab documents sending them to match
    /// several of its methods at once. A pattern is therefore allowed — the peer decides what it matches — and what
    /// would corrupt the encoding is refused.
    #[test]
    fn patterns_are_allowed_and_what_would_corrupt_the_encoding_is_not() {
        // Allowed: a pattern, which a peer like QLab documents (`/cue/*/armed 0` disarms every cue).
        for address in ["/cue/*/armed", "/comp?/name", "/[a-z]x/y", "/{a,b}/go"] {
            let spec = OscSendSpec { address: address.to_string(), args: vec![OscArg::Int(0)] };
            assert!(spec.encode().is_ok(), "{address} is a legitimate pattern");
        }

        // Refused: what would make the peer read the name or its arguments wrongly.
        let cases = [
            ("", "empty"),
            ("mixer/fader", "no leading slash"),
            ("/a//b", "an empty part"),
            ("/mixer fader", "a space"),
            ("/mixer,fader", "a comma"),
            ("/mixer\0fader", "a null"),
        ];
        for (address, why) in cases {
            let spec = OscSendSpec { address: address.to_string(), args: Vec::new() };
            let error = spec.encode().expect_err(&format!("{address} must be refused: {why}"));
            assert!(!error.is_empty(), "{address}: the refusal says why");
        }
        // A string with an interior null would end early for the peer, so it never leaves.
        let spec = OscSendSpec {
            address: "/name".to_string(),
            args: vec![OscArg::Str("a\0b".to_string())],
        };
        let error = spec.encode().expect_err("a null inside a string");
        assert!(error.contains("null"), "{error}");
    }

    /// Sending needs the listener: a message from an ephemeral socket would get its answer delivered to a port
    /// nobody reads, so it is refused with the sentence that says what to do.
    #[test]
    fn sending_needs_the_listener_and_reports_what_left() {
        let listener = OscListener::with_flood_guard(1_000);
        let spec = OscSendSpec {
            address: "/video/playing".to_string(),
            args: vec![OscArg::Int(1)],
        };
        let refused = listener
            .send(&spec, "127.0.0.1", 9100)
            .expect_err("nothing is listening");
        assert!(refused.contains("Start listening"), "{refused}");

        // A bad address is refused before the socket is even consulted, so the operator's mistake is what they are
        // told about.
        listener.open(true, 0, OscBind::ThisMac, Vec::new(), None).expect("binding");
        let bad = OscSendSpec { address: "nope".to_string(), args: Vec::new() };
        let error = listener.send(&bad, "127.0.0.1", 9100).expect_err("a bad address");
        assert!(error.contains("must start with '/'"), "{error}");
        assert_eq!(listener.snapshot().sent, 0, "nothing may be counted as sent when nothing left");

        // And the real round trip: our own sender to our own listener, over UDP, through the encoder and the
        // decoder. This is the whole sending path with no third-party application involved.
        let port = listener.port();
        let described = listener.send(&spec, "127.0.0.1", port).expect("sending to ourselves");
        assert!(described.starts_with("sent /video/playing"), "{described}");
        assert!(described.contains(&format!("to 127.0.0.1:{port}")), "{described}");

        let deadline = Instant::now() + Duration::from_secs(3);
        while listener.snapshot().received == 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        let snapshot = listener.snapshot();
        assert_eq!(snapshot.received, 1, "it arrived");
        assert_eq!(snapshot.sent, 1, "and it was counted as sent");
        let last = snapshot.last.expect("the monitor remembers it");
        assert_eq!(last.address, "/video/playing");
        assert!(last.args.contains("i 1"), "{}", last.args);

        // A target that does not exist is an error, not a silent nothing.
        let error = listener.send(&spec, "127.0.0.1", 0).expect_err("no port");
        assert!(error.contains("not set"), "{error}");
        listener.close();
    }

    /// The switch is the gate, and opening with it off touches no socket at all.
    #[test]
    fn nothing_is_bound_while_the_feature_is_switched_off() {
        let listener = OscListener::new();
        let error = listener.open(false, 0, OscBind::ThisMac, Vec::new(), None).expect_err("off must refuse");
        assert!(error.contains("Settings → MIDI, Inter-app OSC"), "{error}");
        assert!(!listener.is_open());
        assert_eq!(listener.snapshot().received, 0);

        let error = ensure_enabled(false).expect_err("and the predicate says the same");
        assert!(error.contains("no listener is opened"), "{error}");
    }
}
