//! LTC — Linear (Longitudinal) Time Code, the timecode carried by an **audio** signal.
//!
//! Phase T3 of `docs/TIMECODE_PLAN.md`: the codec, and nothing that touches an audio device yet. The decoder is
//! proved by **generating LTC in the tests** — the only way to demonstrate a codec on this machine without hardware,
//! and the reason the plan puts the file before the device.
//!
//! What that proves and what it does not, because the difference matters: it proves the encoder and the decoder agree,
//! that the bit stream survives inversion, a join, a splice and noise, and that the WAV reader is honest. It does
//! **not** prove interoperability — that a third-party decoder reads what this generates, or that this reads what a
//! real generator produces. No third-party LTC tool is installed on this machine (`ltcdump`/`libltc` are absent, and
//! ffmpeg carries no LTC decoder), so that check has not been made and must not be claimed.
//!
//! LTC is an 80-bit frame per video frame, biphase-mark encoded, at 24, 25 or 30 frames per second. It does **not**
//! carry its own frame rate: the rate has to be known, which is why every source in this application declares one.
//! That is not a limitation of this implementation but of the format, and it is worth saying where an operator will
//! read it.
//!
//! The decoder is deliberately the simple, honest one for a **file**: the sample clock is exact, so the bit clock is
//! derived from the declared rate and aligned on the signal's own transitions, and every frame is accepted only when
//! its **sync word** is where the format says it is. A frame that does not validate is skipped rather than decoded
//! into a position nobody sent — the rule this project applies to every value that arrives from outside.

use serde::Serialize;

use super::timecode::{TimecodePosition, TimecodeRate};

/// The 80-bit frame's layout, in the words of the format: two BCD digits for each field, a drop-frame flag, the
/// biphase-mark correction bit, and a fixed sync word at the end.
const BITS_PER_FRAME: usize = 80;
/// The sync word every frame ends with: `0011 1111 1111 1101`.
const SYNC_WORD: [bool; 16] = [
    false, false, true, true, true, true, true, true, true, true, true, true, true, true, false, true,
];

/// Where each field sits in a frame, as bit indices.
const FRAME_UNITS: std::ops::Range<usize> = 0..4;
const DROP_FRAME_BIT: usize = 10;
const FRAME_TENS: std::ops::Range<usize> = 8..10;
const SECONDS_UNITS: std::ops::Range<usize> = 16..20;
const SECONDS_TENS: std::ops::Range<usize> = 24..27;
const MINUTES_UNITS: std::ops::Range<usize> = 32..36;
const MINUTES_TENS: std::ops::Range<usize> = 40..43;
const HOURS_UNITS: std::ops::Range<usize> = 48..52;
const HOURS_TENS: std::ops::Range<usize> = 56..58;

/// What decoding a file produced.
#[derive(Clone, Debug, Default, Serialize)]
pub struct LtcReading {
    /// Frames whose sync word was found and whose fields made a position that can exist.
    pub frames: u64,
    /// Runs of bits that looked like a frame but did not validate: a dropout, a splice, or a rate that is wrong.
    pub rejected: u64,
    pub first: Option<String>,
    pub last: Option<String>,
    pub rate: Option<String>,
    pub drop_frame: bool,
    /// What the signal's **own bit timing** says the frame rate is, once enough of it has been measured — `None` for a
    /// buffer too short to mean anything. See [`LtcDecoder::measured_fps`].
    pub measured_fps: Option<f32>,
    /// The frames read, in order, when the caller asked to keep them. Bounded by the caller.
    pub positions: Vec<TimecodePosition>,
}

fn digit(bits: &[bool], range: std::ops::Range<usize>) -> Option<u32> {
    let mut value = 0_u32;
    // The index comes from the range, not from the offset within it: reading `bits.get(offset)` would take every
    // field from the first bits of the frame, which decodes to positions nobody sent — and the test caught exactly
    // that, by being told 0b1010 was a decimal digit.
    for (offset, index) in range.enumerate() {
        if *bits.get(index)? {
            value |= 1 << offset;
        }
    }
    if value > 9 {
        return None;
    }
    Some(value)
}

fn field(bits: &[bool], units: std::ops::Range<usize>, tens: std::ops::Range<usize>) -> Option<u32> {
    Some(digit(bits, units)? + 10 * digit(bits, tens)?)
}

/// Turn one 80-bit frame into a position, or refuse it.
///
/// Refusing is the point: the fields are BCD, so a nibble above nine means the frame is not one this decoder may
/// believe — and a position invented from a corrupt frame is a cue in the wrong place.
pub fn position_from_frame(bits: &[bool], rate: TimecodeRate) -> Option<TimecodePosition> {
    if bits.len() < BITS_PER_FRAME || bits[64..80] != SYNC_WORD {
        return None;
    }
    let drop_frame = bits[DROP_FRAME_BIT] && rate.supports_drop_frame();
    TimecodePosition::new(
        field(bits, HOURS_UNITS, HOURS_TENS)?,
        field(bits, MINUTES_UNITS, MINUTES_TENS)?,
        field(bits, SECONDS_UNITS, SECONDS_TENS)?,
        field(bits, FRAME_UNITS, FRAME_TENS)?,
        rate,
        drop_frame,
    )
    .ok()
}

/// The refusal that keeps the audio input out of a session nobody asked it for.
///
/// It is separate from the codec's own work on purpose: the codec decodes samples, and *this* is the application's
/// policy about when it is allowed to open a microphone. The message names the switch, because "it did not open" is
/// not something an operator can act on.
pub fn ensure_audio_allowed(enabled: bool) -> Result<(), String> {
    if enabled {
        Ok(())
    } else {
        Err("the LTC audio input is switched off (Settings → Timecode (MTC, LTC, SMPTE) → listen to a device): no microphone is \
             opened while it is off"
            .to_string())
    }
}

/// A decoder for one stream of samples.
///
/// It consumes samples and produces positions. The bit clock comes from the **declared** rate — LTC does not carry
/// one — and every bit is decided by the interval between the signal's own transitions, which is what biphase mark
/// encodes: a transition in the middle of a bit is a one, and only the boundary is a zero.
pub struct LtcDecoder {
    /// Samples per bit, from the sample rate and the **declared** frame rate: LTC carries no rate of its own.
    samples_per_bit: f64,
    /// The sample rate the block is being read at. Kept because the signal's own bit timing can only be turned back
    /// into a frame rate with it — `frames = sample_rate / (80 × bit period)`.
    sample_rate: f64,
    /// The last sample's polarity, and where the last transition was.
    last_positive: Option<bool>,
    last_transition: Option<f64>,
    /// The sample index being consumed.
    ///
    /// `f64`, and not the `f32` it was: an `f32` stops counting **exactly** at 2^24 = 16 777 216 samples, which is 5.8
    /// minutes at 48 kHz, and after that the intervals between transitions quantise — so the measurement below would
    /// drift on exactly the long streams it is meant to judge. Found while designing that measurement, which is the
    /// only reason anybody looked at this counter's precision.
    at: f64,
    /// Bits read since the last accepted frame.
    bits: Vec<bool>,
    /// True when the next transition ends the second half of a one. Biphase mark puts **two** intervals inside a one
    /// bit (boundary→middle and middle→boundary), and counting both would turn every one into two, shifting the whole
    /// frame — the mistake this flag exists to prevent.
    second_half_of_a_one: bool,
    rejected: u64,
    frames: u64,
    /// The **bit periods** the signal has shown, summed, and how many were counted.
    ///
    /// LTC carries no frame rate, so the only thing that can be said about the signal's own timing is what is measured
    /// from it: the decoder already times every transition — it has to, to decide each bit — and it used to throw the
    /// measurement away. A one's two halves are two intervals that sum to exactly one bit period, so what is
    /// accumulated here is a bit period per bit; the mean is therefore exact rather than approximate.
    ///
    /// This is the measurement that escapes the declaration. A count-derived estimate (`frames / elapsed`) does not:
    /// the decoder accepts only frame numbers that are valid at the **declared** rate, so a 30 fps signal read as
    /// declared 25 decodes 25 numbers a second and reports 25.0 — the declaration confirming itself.
    bit_periods_sum: f64,
    bit_periods: u64,
}

/// How many bit periods are measured before the signal's own rate is worth stating.
///
/// 2 000 bits is 25 frames, which is 1000 ms at 25 fps (833 at 30, 1043 at 24). The per-interval error is at most one
/// sample — 4.2 % of a bit at 48 kHz and 25 fps — and it is zero-mean across transitions, so the mean of 2 000 of them
/// is within about 0.1 %: far below the smallest real gap between the rates this application supports, which is
/// 24 against 25 at 4.17 %.
const MIN_BITS_FOR_A_MEASUREMENT: u64 = 2_000;

impl LtcDecoder {
    pub fn new(sample_rate: f32, rate: TimecodeRate) -> Self {
        let sample_rate = sample_rate as f64;
        let samples_per_bit = sample_rate / (rate.frames_per_second() as f64 * BITS_PER_FRAME as f64);
        Self {
            samples_per_bit,
            sample_rate,
            last_positive: None,
            last_transition: None,
            at: 0.0,
            bits: Vec::new(),
            second_half_of_a_one: false,
            rejected: 0,
            frames: 0,
            bit_periods_sum: 0.0,
            bit_periods: 0,
        }
    }

    /// What the signal's **own** bit timing says the frame rate is, or `None` until enough of it has been measured to
    /// mean anything.
    ///
    /// It answers a question the declaration cannot: whether the rate the operator chose is the rate that is arriving.
    /// What it measures is the signal's playback speed **at the sample rate the device claims**, so varispeed,
    /// pull-up/down or a device running on another clock moves it exactly as a different frame rate would — which is why
    /// nothing that reads this may say the rate was *detected*.
    pub fn measured_fps(&self) -> Option<f32> {
        if self.bit_periods < MIN_BITS_FOR_A_MEASUREMENT {
            return None;
        }
        let mean = self.bit_periods_sum / self.bit_periods as f64;
        if !(mean > 0.0) {
            return None;
        }
        let fps = self.sample_rate / (BITS_PER_FRAME as f64 * mean);
        fps.is_finite().then_some(fps as f32)
    }

    /// Feed a block of samples, and take whatever positions it completed.
    pub fn feed(&mut self, samples: &[f32], rate: TimecodeRate) -> Vec<TimecodePosition> {
        let mut positions = Vec::new();
        self.feed_into(samples, rate, &mut positions);
        positions
    }

    /// The same, into a buffer the caller owns and can reuse.
    ///
    /// It exists for the audio callback, which runs on a high-priority thread and must not allocate a fresh vector for
    /// every block it is handed: the buffer is cleared and filled with what **this** block completed.
    pub fn feed_into(&mut self, samples: &[f32], rate: TimecodeRate, positions: &mut Vec<TimecodePosition>) {
        positions.clear();
        // A signal this quiet is silence, not timecode: reading transitions out of noise is how a decoder invents
        // positions. The threshold is far below any real LTC level and far above a noise floor.
        const QUIET: f32 = 1e-4;
        for sample in samples {
            self.at += 1.0;
            if sample.abs() < QUIET {
                continue;
            }
            let positive = *sample > 0.0;
            let Some(previous) = self.last_positive.replace(positive) else {
                self.last_transition = Some(self.at);
                continue;
            };
            if previous == positive {
                continue;
            }
            let Some(previous_transition) = self.last_transition.replace(self.at) else {
                continue;
            };
            let interval = self.at - previous_transition;
            // A meaningful interval is between half a bit and a bit and a half; anything else is a glitch, a splice
            // or noise, and it resets the bit clock rather than being read as data.
            if interval < self.samples_per_bit * 0.25 || interval > self.samples_per_bit * 1.75 {
                // A gap, a splice or a glitch: the bit stream cannot be trusted from here, and neither can the note
                // that we were halfway through a one. Resetting only the bits leaves the decoder one interval out of
                // phase for the rest of the file — which is exactly what this line was missing.
                self.bits.clear();
                self.second_half_of_a_one = false;
                continue;
            }
            // The interval that ends a one's second half is not a bit of its own: it is the rest of the one that was
            // already counted.
            if self.second_half_of_a_one {
                self.second_half_of_a_one = false;
                continue;
            }
            // The bit this transition decided, and the period it took, counted as **one bit period**: a half-bit
            // interval is half of one, so doubling it keeps the mean a mean of bit periods rather than of intervals —
            // and the one's second half, skipped above, is the other half.
            let half = interval < self.samples_per_bit * 0.75;
            self.bit_periods_sum += if half { interval * 2.0 } else { interval };
            self.bit_periods += 1;
            // Half a bit means the transition in the middle of a one; a whole bit means a zero.
            if half {
                self.bits.push(true);
                self.second_half_of_a_one = true;
            } else {
                self.bits.push(false);
            }
            if let Some(position) = self.take_frame(rate) {
                positions.push(position);
            }
        }
    }

    /// Look for a complete, valid frame in the bits read so far.
    ///
    /// The search is what makes the decoder self-aligning: a frame is accepted only where the sync word actually is,
    /// so a stream joined mid-frame simply produces its first position a frame later instead of a wrong one.
    fn take_frame(&mut self, rate: TimecodeRate) -> Option<TimecodePosition> {
        while self.bits.len() >= BITS_PER_FRAME {
            // Only look where a frame could end, and only at whole frames from the current window.
            let window = &self.bits[..BITS_PER_FRAME];
            match position_from_frame(window, rate) {
                Some(position) => {
                    self.bits.drain(..BITS_PER_FRAME);
                    self.frames += 1;
                    return Some(position);
                }
                None => {
                    // Not aligned yet, or corrupted: drop one bit and look again, which is how the decoder finds the
                    // sync without being told where the stream begins.
                    self.bits.remove(0);
                    self.rejected += 1;
                }
            }
        }
        None
    }

    pub fn stats(&self) -> (u64, u64) {
        (self.frames, self.rejected)
    }
}

/// Decode a whole buffer of samples, keeping up to `keep` positions.
pub fn decode_samples(
    samples: &[f32],
    sample_rate: f32,
    rate: TimecodeRate,
    keep: usize,
) -> LtcReading {
    let mut decoder = LtcDecoder::new(sample_rate, rate);
    let positions = decoder.feed(samples, rate);
    let (frames, rejected) = decoder.stats();
    let first = positions.first().map(|position| position.describe());
    let last = positions.last().map(|position| position.describe());
    LtcReading {
        frames,
        rejected,
        first,
        last,
        rate: Some(rate.label().to_string()),
        drop_frame: positions.first().map(|position| position.drop_frame).unwrap_or(false),
        // The file path measures the signal's own rate for free, which is how a stored recording can be checked against
        // the rate it is being read as — the same question the live input answers, asked of a file.
        measured_fps: decoder.measured_fps(),
        positions: positions.into_iter().take(keep).collect(),
    }
}


/// What a WAV file gave us: its sample rate, how many channels it has, and the samples interleaved.
///
/// Deliberately narrow: 16-bit PCM and 32-bit float, which is what every recording of timecode is, and a refusal
/// with a reason for anything else. A reader that guesses at a format it does not understand reads a show's
/// timecode wrong.
#[derive(Debug)]
pub struct WavAudio {
    pub sample_rate: u32,
    pub channels: u16,
    pub samples: Vec<f32>,
}

/// Read a WAV file, or say why it cannot be read.
///
/// The bounds are part of the job: a file is external input, so every length in it is treated as a claim and clamped
/// to the bytes that are actually there. A header claiming four gigabytes must not make this allocate four gigabytes.
pub fn read_wav(bytes: &[u8]) -> Result<WavAudio, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("this is not a WAV file: it has no RIFF/WAVE header".to_string());
    }
    let mut at = 12_usize;
    let mut format: Option<(u16, u16, u32, u16)> = None;
    let mut samples: Vec<f32> = Vec::new();
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = u32::from_le_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]]) as usize;
        let body = at + 8;
        let end = body.saturating_add(size).min(bytes.len());
        match id {
            b"fmt " if end.saturating_sub(body) >= 16 => {
                let code = u16::from_le_bytes([bytes[body], bytes[body + 1]]);
                let channels = u16::from_le_bytes([bytes[body + 2], bytes[body + 3]]);
                let rate = u32::from_le_bytes([bytes[body + 4], bytes[body + 5], bytes[body + 6], bytes[body + 7]]);
                let bits = u16::from_le_bytes([bytes[body + 14], bytes[body + 15]]);
                format = Some((code, channels, rate, bits));
            }
            b"data" => {
                let Some((code, channels, _rate, bits)) = format else {
                    return Err("the WAV file has samples before it says what format they are in".to_string());
                };
                let body = &bytes[body..end];
                samples = match (code, bits) {
                    (1, 16) => body
                        .chunks_exact(2)
                        .map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32_768.0)
                        .collect(),
                    (3, 32) => body
                        .chunks_exact(4)
                        .map(|word| f32::from_le_bytes([word[0], word[1], word[2], word[3]]))
                        .collect(),
                    (1, 8) => body.iter().map(|byte| (*byte as f32 - 128.0) / 128.0).collect(),
                    // 24-bit PCM is three bytes per sample, little-endian and signed, and it is the most common depth
                    // for a recording of LTC - which is why refusing it was a hole rather than a limit. The sign has to
                    // be extended before scaling: putting the top byte at bit 31 and shifting back arithmetically is what
                    // makes samples above half scale read as positive instead of as large negatives.
                    (1, 24) => body
                        .chunks_exact(3)
                        .map(|triple| {
                            let raw = ((triple[2] as i32) << 24 | (triple[1] as i32) << 16 | (triple[0] as i32) << 8) >> 8;
                            raw as f32 / 8_388_608.0
                        })
                        .collect(),
                    (code, bits) => {
                        return Err(format!(
                            "this WAV file holds {} with {} bits per sample; this build reads 16-bit PCM, 24-bit PCM, 8-bit PCM and 32-bit float",
                            if code == 1 { "PCM" } else { "a compressed or float format" },
                            bits
                        ))
                    }
                };
                if channels == 0 {
                    return Err("the WAV file says it has no channels".to_string());
                }
                // Truncate to whole frames, so a file whose data chunk ends mid-sample is not read as if it did not.
                let per_frame = channels as usize;
                let whole = samples.len() - samples.len() % per_frame;
                samples.truncate(whole);
            }
            _ => {}
        }
        // Chunks are word-aligned: an odd size is followed by a pad byte.
        at = body + size + (size & 1);
        if size == 0 && end <= body {
            // A zero-length chunk that does not advance would loop for ever: a malformed file must not hang the app.
            break;
        }
    }
    let Some((_code, channels, sample_rate, _bits)) = format else {
        return Err("the WAV file does not say what its samples are".to_string());
    };
    if sample_rate == 0 {
        return Err("the WAV file says its sample rate is zero".to_string());
    }
    if samples.is_empty() {
        return Err("the WAV file has no samples".to_string());
    }
    Ok(WavAudio {
        sample_rate,
        channels,
        samples,
    })
}

impl WavAudio {
    /// One channel's samples, which is what a decoder wants: timecode is on one channel of a recording, and mixing
    /// channels could cancel a signal that is inverted between them.
    pub fn channel(&self, index: u16) -> Vec<f32> {
        let channels = self.channels.max(1) as usize;
        let index = index as usize;
        if index >= channels {
            return Vec::new();
        }
        self.samples.iter().skip(index).step_by(channels).copied().collect()
    }
}

/// The **test generator**: LTC for a sequence of positions, as samples.
///
/// It exists so the decoder can be proved on this machine without a timecode generator, a cable or an interface, and
/// it is kept beside the decoder for the same reason the MIDI module keeps its port names as constants: the two
/// halves of a codec have to agree about the format, and the cheapest place to enforce that is one file.
#[cfg(test)]
pub fn generate(positions: &[TimecodePosition], sample_rate: f32) -> Vec<f32> {
    let mut samples = Vec::new();
    let mut phase = true;
    for position in positions {
        let bits = frame_bits(position);
        let samples_per_bit = sample_rate / (position.rate.frames_per_second() as f32 * BITS_PER_FRAME as f32);
        // Whole samples per bit, split in the middle: a floating half-emission rounds down twice per bit and loses a
        // sample each time, which drifts the bit clock until nothing aligns. The decoder derives its clock from the
        // same formula, so both halves of the codec count the same way.
        let per_bit = samples_per_bit.round().max(2.0) as usize;
        let half = per_bit / 2;
        for bit in bits {
            // Biphase mark, built the way the format describes it: the level **changes at the start of every bit**,
            // and changes again in the middle **only when the bit is a one**. The first version of this generator
            // flipped in the middle of every bit instead, which is the same waveform shifted half a bit — a decoder
            // cannot tell that from a different message, and the test is what said so.
            phase = !phase;
            for _ in 0..half {
                samples.push(if phase { 0.8 } else { -0.8 });
            }
            if bit {
                phase = !phase;
            }
            for _ in half..per_bit {
                samples.push(if phase { 0.8 } else { -0.8 });
            }
        }
    }
    samples
}

/// The 80 bits of one frame, in the format's order.
#[cfg(test)]
fn frame_bits(position: &TimecodePosition) -> Vec<bool> {
    let mut bits = vec![false; BITS_PER_FRAME];
    let put = |range: std::ops::Range<usize>, value: u32, bits: &mut Vec<bool>| {
        for (offset, index) in range.enumerate() {
            bits[index] = (value >> offset) & 1 == 1;
        }
    };
    put(FRAME_UNITS, position.frames % 10, &mut bits);
    put(FRAME_TENS, position.frames / 10, &mut bits);
    bits[DROP_FRAME_BIT] = position.drop_frame;
    put(SECONDS_UNITS, position.seconds % 10, &mut bits);
    put(SECONDS_TENS, position.seconds / 10, &mut bits);
    put(MINUTES_UNITS, position.minutes % 10, &mut bits);
    put(MINUTES_TENS, position.minutes / 10, &mut bits);
    put(HOURS_UNITS, position.hours % 10, &mut bits);
    put(HOURS_TENS, position.hours / 10, &mut bits);
    // The biphase-mark correction bit is set so the frame's zeros come out even, which is how a real generator keeps
    // the polarity honest. This decoder ignores it, and a faithful generator still writes it.
    let zeros = bits[..64].iter().filter(|bit| !**bit).count();
    bits[27] = zeros % 2 == 1;
    bits[64..80].copy_from_slice(&SYNC_WORD);
    bits
}

#[cfg(test)]
mod tests {
    use super::*;

    fn position(seconds: u32, frames: u32, rate: TimecodeRate) -> TimecodePosition {
        TimecodePosition::new(1, 0, seconds, frames, rate, false).expect("a position")
    }

    /// A minimal WAV writer, in the tests only: the point of this file is that the decoder can be proved without a
    /// recorder, a cable or a timecode generator, and a reader with no writer to test it is a reader nobody proved.
    fn write_wav(samples: &[f32], sample_rate: u32, channels: u16) -> Vec<u8> {
        let data: Vec<u8> = samples
            .iter()
            .flat_map(|sample| ((sample.clamp(-1.0, 1.0) * 32_767.0) as i16).to_le_bytes())
            .collect();
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16_u32.to_le_bytes());
        out.extend_from_slice(&1_u16.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&sample_rate.to_le_bytes());
        out.extend_from_slice(&(sample_rate * channels as u32 * 2).to_le_bytes());
        out.extend_from_slice(&(channels * 2).to_le_bytes());
        out.extend_from_slice(&16_u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        out
    }

    /// The same file in 24-bit PCM: three bytes per sample, little-endian and signed. The scaling is the depth's own
    /// (2^23), so a round trip through the reader is the contract, and a sign that was not extended shows up here as a
    /// positive number where a negative one was written.
    fn write_wav_24(samples: &[f32], sample_rate: u32, channels: u16) -> Vec<u8> {
        let data: Vec<u8> = samples
            .iter()
            .flat_map(|sample| {
                let scaled = (sample.clamp(-1.0, 1.0) * 8_388_607.0) as i32;
                let bytes = scaled.to_le_bytes();
                [bytes[0], bytes[1], bytes[2]]
            })
            .collect();
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16_u32.to_le_bytes());
        out.extend_from_slice(&1_u16.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&sample_rate.to_le_bytes());
        out.extend_from_slice(&(sample_rate * channels as u32 * 3).to_le_bytes());
        out.extend_from_slice(&(channels * 3).to_le_bytes());
        out.extend_from_slice(&24_u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        out
    }

    /// 24-bit PCM used to be refused, and a test **pinned the refusal** - the one shape of contract this project
    /// forbids, because an assertion that a hole exists outlives the hole. It is read now, and this is what says so:
    /// the samples survive to within one step of the depth, and a negative sample comes back negative.
    #[test]
    fn a_24_bit_wav_is_read_with_its_sign_intact() {
        let wrote = [0.5_f32, -0.5, 0.25, -1.0, 0.0, 0.999_9, -0.999_9];
        let audio = read_wav(&write_wav_24(&wrote, 48_000, 1)).expect("a readable 24-bit WAV");
        assert_eq!(audio.samples.len(), wrote.len(), "every sample is read, not every other one");
        let step = 1.0 / 8_388_608.0;
        for (index, (read, original)) in audio.samples.iter().zip(wrote.iter()).enumerate() {
            assert!(
                (read - original).abs() <= step,
                "sample {index} came back as {read} instead of {original}"
            );
            assert_eq!(
                read.is_sign_negative(),
                original.is_sign_negative(),
                "sample {index} lost its sign, which is what an unextended sign does to everything above half scale"
            );
        }
    }

    /// The whole file path: LTC is generated, written as a WAV with the timecode on **channel two**, read back,
    /// and decoded from the channel that carries it.
    #[test]
    fn a_wav_file_is_read_and_its_timecode_decoded_from_the_right_channel() {
        let positions: Vec<TimecodePosition> = (0..8)
            .map(|step| position(45, step, TimecodeRate::Fps25))
            .collect();
        let mono = generate(&positions, 48_000.0);

        // Interleave silence on channel one and the timecode on channel two.
        let stereo: Vec<f32> = mono.iter().flat_map(|sample| [0.0_f32, *sample]).collect();
        let bytes = write_wav(&stereo, 48_000, 2);

        let audio = read_wav(&bytes).expect("a readable WAV");
        assert_eq!(audio.sample_rate, 48_000);
        assert_eq!(audio.channels, 2);
        assert_eq!(audio.samples.len(), stereo.len());

        // Channel one is silence: it must produce no positions rather than a guess.
        let silent = decode_samples(&audio.channel(0), 48_000.0, TimecodeRate::Fps25, 16);
        assert_eq!(silent.frames, 0, "silence is not timecode: {silent:?}");

        // Channel two carries it, and every position comes back.
        let reading = decode_samples(&audio.channel(1), 48_000.0, TimecodeRate::Fps25, 16);
        assert_eq!(reading.frames, positions.len() as u64, "{reading:?}");
        let decoded: Vec<String> = reading.positions.iter().map(|p| p.describe()).collect();
        let expected: Vec<String> = positions.iter().map(|p| p.describe()).collect();
        assert_eq!(decoded, expected);
    }

    /// A WAV that is not one, or is one this build cannot read, is refused with the reason — a file is external
    /// input, and every length in it is a claim to be clamped rather than trusted.
    #[test]
    fn a_wav_is_refused_with_its_reason_and_its_lengths_are_clamped() {
        assert!(read_wav(b"not a wav at all").is_err());
        assert!(read_wav(b"RIFF\x00\x00\x00\x00WAVE").is_err(), "a header with no chunks");
        assert!(read_wav(&[]).is_err());

        // A depth this reader genuinely does not know is still refused, and the refusal says what it found instead of
        // guessing. The offsets are written out rather than searched for: the header is 12 bytes, the fmt chunk is
        // 8 + 16, and the bits-per-sample field is the last two bytes of its body — searching for `[16, 0]` finds the
        // first pair that happens to match, which is a different field on a different day.
        let mut header = write_wav(&[0.5, -0.5], 48_000, 1);
        const BITS_AT: usize = 12 + 8 + 14;
        assert_eq!(&header[BITS_AT..BITS_AT + 2], &16_u16.to_le_bytes(), "the writer writes 16-bit");
        // 32-bit **PCM** (code 1), which is not the same thing as the 32-bit float this reader does read.
        header[BITS_AT..BITS_AT + 2].copy_from_slice(&32_u16.to_le_bytes());
        let error = read_wav(&header).expect_err("32-bit PCM is not read");
        assert!(error.contains("32 bits"), "{error}");

        // A data chunk that claims more than the file holds is clamped to what is there: the header's size is a
        // claim, not a promise, and believing it is how a malformed file makes an application allocate.
        let mut overstated = write_wav(&[0.5; 64], 48_000, 1);
        // The data chunk starts after the 12-byte header and the 8 + 16-byte fmt chunk; its size is its fifth byte.
        const DATA_SIZE_AT: usize = 12 + 8 + 16 + 4;
        assert_eq!(&overstated[12 + 8 + 16..12 + 8 + 20], b"data", "the writer writes a data chunk");
        overstated[DATA_SIZE_AT..DATA_SIZE_AT + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        let audio = read_wav(&overstated).expect("read to what is actually there");
        assert_eq!(audio.samples.len(), 64, "the samples that exist are the samples read");
    }

    /// **The measurement that escapes the declaration.** A 25 fps signal, read as declared 30, must come back saying the
    /// signal's own bit timing is 25 — and the estimate the app could have used instead cannot do this. A count-derived
    /// rate (`frames / elapsed`) is biased towards the declaration, because the decoder accepts only frame numbers that
    /// are valid at the declared rate: a 30 fps signal declared 25 decodes 25 numbers a second and reports exactly 25.0.
    #[test]
    fn a_signal_at_another_rate_measures_its_own_rate_and_not_the_declared_one() {
        let positions: Vec<TimecodePosition> = (0..30)
            .map(|step| position(12, step % 25, TimecodeRate::Fps25))
            .collect();
        let samples = generate(&positions, 48_000.0);

        // Read as declared 30: the frames still decode (every number 0-24 is valid at 30 too), and the measurement says
        // what the signal actually is.
        let reading = decode_samples(&samples, 48_000.0, TimecodeRate::Fps30, 0);
        assert_eq!(reading.frames, positions.len() as u64, "the frames decode at the wrong declaration too");
        let measured = reading.measured_fps.expect("30 frames of signal is well past the measurement threshold");
        assert!(
            (measured - 25.0).abs() < 0.25,
            "the signal measures its own rate and not the declared one: {measured}"
        );
        assert!(
            crate::timecode::rate_disagrees(TimecodeRate::Fps30, measured),
            "and that is a disagreement the operator has to be told about: {measured}"
        );

        // Declared correctly, the same signal measures itself and there is nothing to report — the other half of the
        // contract, and the one that keeps a correct setup quiet.
        let reading = decode_samples(&samples, 48_000.0, TimecodeRate::Fps25, 0);
        let measured = reading.measured_fps.expect("the same signal, declared correctly");
        assert!((measured - 25.0).abs() < 0.25, "{measured}");
        assert!(!crate::timecode::rate_disagrees(TimecodeRate::Fps25, measured), "and a correct declaration is never reported");
    }

    /// The codec's first property: what the generator writes, the decoder reads — the whole reason the generator
    /// exists, and the only way to prove a codec without hardware.
    #[test]
    fn what_the_generator_writes_the_decoder_reads() {
        for rate in [TimecodeRate::Fps24, TimecodeRate::Fps25, TimecodeRate::Fps30] {
            let positions: Vec<TimecodePosition> = (0..12).map(|step| position(12, step, rate)).collect();
            let samples = generate(&positions, 48_000.0);
            let reading = decode_samples(&samples, 48_000.0, rate, 64);
            assert_eq!(
                reading.frames,
                positions.len() as u64,
                "every frame must come back at {} fps (rejected {})",
                rate.label(),
                reading.rejected
            );
            let decoded: Vec<String> = reading.positions.iter().map(|p| p.describe()).collect();
            let expected: Vec<String> = positions.iter().map(|p| p.describe()).collect();
            assert_eq!(decoded, expected, "at {} fps", rate.label());
            assert_eq!(reading.first.as_deref(), Some("01:00:12:00"));
            assert_eq!(reading.last.as_deref(), Some(&format!("01:00:12:{:02}", positions.len() - 1) as &str));
        }
    }

    /// Drop-frame is carried by the frame itself, and the decoder must read it as the numbering it is.
    #[test]
    fn drop_frame_travels_in_the_frame() {
        let positions = vec![
            TimecodePosition::new(0, 10, 59, 29, TimecodeRate::Fps29_97, true).expect("a drop-frame position"),
            TimecodePosition::new(0, 11, 0, 2, TimecodeRate::Fps29_97, true).expect("the next one"),
        ];
        let samples = generate(&positions, 48_000.0);
        let reading = decode_samples(&samples, 48_000.0, TimecodeRate::Fps29_97, 8);
        assert_eq!(reading.frames, 2, "{reading:?}");
        let decoded: Vec<String> = reading.positions.iter().map(|p| p.describe()).collect();
        assert_eq!(decoded, vec!["00:10:59;29", "00:11:00;02"]);
        assert!(reading.drop_frame);
    }

    /// A stream joined in the middle, and a stream with a splice in it, must not invent positions: the decoder finds
    /// the sync word or says nothing.
    #[test]
    fn a_damaged_stream_never_invents_a_position() {
        // Twelve frames of material, so a splice in the middle leaves plenty either side: the decoder has to
        // **find** the sync word again after a gap, and that search consumes bits, so reading every frame after a
        // splice is not what a decoder promises. What it promises is never to invent one.
        let positions: Vec<TimecodePosition> = (0..12)
            .map(|step| position(30, step, TimecodeRate::Fps25))
            .collect();
        let samples = generate(&positions, 48_000.0);

        // Joining the stream mid-frame: the first frames are lost, and what comes back is still correct.
        let joined = decode_samples(&samples[137..], 48_000.0, TimecodeRate::Fps25, 64);
        assert!(joined.frames >= 8, "most frames survive a late join: {joined:?}");
        assert!(joined.positions.iter().all(|p| p.describe().starts_with("01:00:30:")));

        // A splice of silence in the middle: the frames either side are read, and nothing is invented across it.
        let mut spliced = samples.clone();
        let middle = spliced.len() / 2;
        for sample in spliced.iter_mut().skip(middle).take(5_000) {
            *sample = 0.0;
        }
        let reading = decode_samples(&spliced, 48_000.0, TimecodeRate::Fps25, 64);
        assert!(reading.frames >= 6, "the frames either side are read: {reading:?}");
        // The property that matters: every position that came out was **in the signal**. A decoder that invents a
        // position during a dropout puts a cue in a place the show never was.
        let known: Vec<String> = positions.iter().map(|p| p.describe()).collect();
        for decoded in &reading.positions {
            assert!(
                known.contains(&decoded.describe()),
                "{} was never in the signal",
                decoded.describe()
            );
        }

        // Pure noise produces no positions at all: reading transitions out of noise is how a decoder invents a show.
        let noise: Vec<f32> = (0..48_000)
            .map(|index| if (index * 7919) % 13 < 6 { 0.5 } else { -0.5 })
            .collect();
        let noisy = decode_samples(&noise, 48_000.0, TimecodeRate::Fps25, 8);
        assert_eq!(noisy.frames, 0, "noise is not timecode: {noisy:?}");
    }

    /// The format's own rules: the fields are BCD, so a corrupt nibble is refused, and a frame without its sync word
    /// is not a frame.
    #[test]
    fn a_frame_is_refused_unless_its_fields_are_the_formats() {
        let good = frame_bits(&position(12, 15, TimecodeRate::Fps25));
        assert!(position_from_frame(&good, TimecodeRate::Fps25).is_some());

        // A nibble above nine is not a digit: `1010` in the frame-units field.
        // The bits are least significant first, so a value of ten is bits 1 and 3 — writing `1010` in reading order
        // would be five, which is a perfectly good digit and would not test anything.
        let mut corrupt = good.clone();
        for (offset, index) in FRAME_UNITS.enumerate() {
            corrupt[index] = (10_u32 >> offset) & 1 == 1;
        }
        assert!(
            position_from_frame(&corrupt, TimecodeRate::Fps25).is_none(),
            "0b1010 is not a decimal digit"
        );

        // A frame whose sync word is wrong is not a frame.
        let mut unsynced = good.clone();
        unsynced[70] = !unsynced[70];
        assert!(position_from_frame(&unsynced, TimecodeRate::Fps25).is_none());

        // And a frame that says a frame number the rate does not have is refused too: tens digit 3 and units 5 is
        // frame 35, which does not exist at 25 fps, and the position type is what refuses it.
        let mut too_many_frames = good.clone();
        for (offset, index) in FRAME_UNITS.enumerate() {
            too_many_frames[index] = (5_u32 >> offset) & 1 == 1;
        }
        for (offset, index) in FRAME_TENS.enumerate() {
            too_many_frames[index] = (3_u32 >> offset) & 1 == 1;
        }
        assert!(position_from_frame(&too_many_frames, TimecodeRate::Fps25).is_none());
    }

    /// The decoder reads transitions, so it does not care which way the cable is wired: an inverted signal decodes to
    /// the same positions. This is the first thing that fails in the field when a balanced cable is wired the other
    /// way round, and it was not tested before.
    #[test]
    fn an_inverted_signal_decodes_to_the_same_positions() {
        let positions: Vec<TimecodePosition> = (0..40)
            .map(|frame| {
                TimecodePosition::new(1, 0, 0, frame % 25, TimecodeRate::Fps25, false).expect("a position")
            })
            .collect();
        let samples = generate(&positions, 48_000.0);
        let right_way = decode_samples(&samples, 48_000.0, TimecodeRate::Fps25, 64);
        let inverted: Vec<f32> = samples.iter().map(|sample| -*sample).collect();
        let the_other_way = decode_samples(&inverted, 48_000.0, TimecodeRate::Fps25, 64);

        assert!(
            !right_way.positions.is_empty(),
            "the test has to actually decode something before it can compare"
        );
        assert_eq!(
            the_other_way.positions, right_way.positions,
            "an inverted cable must read the same timecode"
        );
        assert_eq!(the_other_way.frames, right_way.frames);
    }
}
