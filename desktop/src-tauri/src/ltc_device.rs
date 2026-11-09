//! LTC from an audio input — Phase T4 of `docs/TIMECODE_PLAN.md`.
//!
//! The step that changes this application's footprint: it needs an audio device and, on macOS, the operator's
//! permission to use the microphone. Nothing here opens until the operator asks for it, closes cleanly, and reports
//! the device and the channel it is listening to.
//!
//! **One thread owns the stream.** `cpal::Stream` is not `Send` on every platform, so the stream is built, played
//! and dropped on a thread of its own — the same rule the meter streams follow, and the reason closing this cannot
//! leave a device open: the thread ends when it is told to, and dropping the stream is what stops capture.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;

use super::ltc::LtcDecoder;
use super::timecode::{TimecodePosition, TimecodeRate, TimecodeState};

/// One input device, for the picker.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AudioInputInfo {
    pub name: String,
    /// How many channels the device's default input configuration has: a rack sends timecode on one of them, and the
    /// operator has to be able to say which.
    pub channels: u16,
    pub sample_rate: u32,
    pub is_default: bool,
}

/// The input devices this machine reports, or **why it could not ask**.
///
/// A machine with no inputs answers with an empty list, which is an answer. A machine whose audio subsystem refuses
/// to be enumerated is a **different sentence**, and the first version of this function swallowed it into an empty
/// list — which is how "Refresh does nothing" is born: the page said "no audio inputs" about a call that never
/// happened.
pub fn list_inputs() -> Result<Vec<AudioInputInfo>, String> {
    let host = cpal::default_host();
    // The trait's documentation is explicit: for the device's name as a string, format the device itself.
    let default_name = host.default_input_device().map(|device| device.to_string());
    let devices = host
        .input_devices()
        .map_err(|error| format!("the audio subsystem would not list its inputs: {error}"))?;
    let mut found = Vec::new();
    for device in devices {
        let name = device.to_string();
        // A device whose configuration cannot be read is still listed, with zeroes: hiding it would leave the
        // operator wondering why the interface they plugged in is not there.
        let (channels, sample_rate) = device
            .default_input_config()
            .map(|config| (config.channels(), config.sample_rate()))
            .unwrap_or((0, 0));
        let is_default = default_name.as_deref() == Some(name.as_str());
        found.push(AudioInputInfo {
            name,
            channels,
            sample_rate,
            is_default,
        });
    }
    let fallback = host.default_input_device().map(|device| {
        let name = device.to_string();
        let (channels, sample_rate) = device
            .default_input_config()
            .map(|config| (config.channels(), config.sample_rate()))
            .unwrap_or((0, 0));
        AudioInputInfo { name, channels, sample_rate, is_default: true }
    });
    Ok(with_default_device(found, fallback))
}

/// The list an operator sees: what the system enumerated, and the default input device when the enumeration came back
/// **empty**.
///
/// That empty answer is what macOS gives an application it has not granted the microphone yet, and it is a trap: the
/// operator cannot choose a device that is not listed, so nothing ever asks for permission. The default device is
/// still known, so it is offered, and choosing it and pressing Listen is what makes the system ask.
fn with_default_device(mut found: Vec<AudioInputInfo>, default: Option<AudioInputInfo>) -> Vec<AudioInputInfo> {
    if found.is_empty() {
        if let Some(device) = default {
            found.push(device);
        }
    }
    found
}

/// Ask macOS for permission to record, by opening the default input for a moment.
///
/// The system's prompt appears when a stream **starts**, and until the permission is granted it may report no input
/// devices at all — so this is the way out of that circle. It returns how many devices are visible afterwards, which
/// is the honest measure of whether the answer was yes: macOS gives silence rather than an error when it refuses.
pub fn request_access() -> Result<String, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "this machine reports no default input device at all".to_string())?;
    let name = device.to_string();
    let supported = device
        .default_input_config()
        .map_err(|error| format!("{name} would not say what it can record: {error}"))?;
    let config = cpal::StreamConfig {
        channels: supported.channels(),
        sample_rate: supported.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };
    // A stream that is started and dropped: starting it is what makes the system ask. Every format the stream path
    // reads is probed here too, because a device this build can record from must not be refused by the permission path.
    match supported.sample_format() {
        cpal::SampleFormat::F32 => probe::<f32>(&device, config, &name)?,
        cpal::SampleFormat::I16 => probe::<i16>(&device, config, &name)?,
        cpal::SampleFormat::U16 => probe::<u16>(&device, config, &name)?,
        cpal::SampleFormat::I32 => probe::<i32>(&device, config, &name)?,
        cpal::SampleFormat::F64 => probe::<f64>(&device, config, &name)?,
        cpal::SampleFormat::I24 => probe::<cpal::I24>(&device, config, &name)?,
        other => {
            return Err(format!(
                "{name} records {other:?}, which this build does not read: it reads 32-bit float, 64-bit float, \
                 and 16, 24 and 32-bit integer input"
            ))
        }
    }
    let visible = list_inputs().map(|list| list.len()).unwrap_or(0);
    Ok(format!(
        "asked macOS about {name} — answer its prompt if it appeared, then press Refresh ({visible} device(s) visible now)"
    ))
}

/// Start a stream of this sample format for a moment and drop it: starting it is what makes macOS ask for the
/// microphone. Generic over the format because the permission path must accept everything the stream path reads.
fn probe<T>(device: &cpal::Device, config: cpal::StreamConfig, name: &str) -> Result<(), String>
where
    T: cpal::SizedSample + Send + 'static,
{
    let stream = device
        .build_input_stream(
            config,
            |_: &[T], _| {},
            |error| eprintln!("audio permission probe: {error}"),
            None,
        )
        .map_err(|error| format!("{name} could not be opened: {error}"))?;
    stream
        .play()
        .map_err(|error| format!("{name} could not be started: {error}"))?;
    std::thread::sleep(std::time::Duration::from_millis(400));
    Ok(())
}

/// How an audio stream died, in the two shapes an operator can act on differently.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct StreamError {
    /// What CPAL said, kept verbatim so the window can show the system's own words.
    pub message: String,
    /// `true` when the device itself went away — an unplug, or a stream macOS invalidated. That is the case where a
    /// reconnect is the only cure, and where the page must stop saying "Listening to …".
    pub disconnected: bool,
}

/// What CPAL hands a stream's error callback, distilled to the two things this application acts on: which words to
/// show, and whether the stream is dead (`DeviceNotAvailable` / `StreamInvalidated` — a hot unplug) rather than
/// merely unhappy (a buffer underrun, say, which the stream survives).
///
/// Public so the mapping can be tested without a device: this is the seam that decides whether the page keeps
/// claiming the timecode is arriving, and there is no other place that decision is made.
#[derive(Debug)]
pub struct ChannelStreamError {
    pub message: String,
    pub is_device_gone: bool,
}

impl ChannelStreamError {
    pub fn new(error: &cpal::Error) -> Self {
        Self {
            message: error.to_string(),
            // Both kinds mean the stream has stopped for good: the device is not there any more, or the system
            // invalidated the stream. Reporting anything else as "disconnected" would make the page drop a live input.
            is_device_gone: matches!(
                error.kind(),
                cpal::ErrorKind::DeviceNotAvailable | cpal::ErrorKind::StreamInvalidated
            ),
        }
    }
}

/// What the owning thread calls when a stream it owns reports an error.
pub type StreamDeathHandler = Box<dyn FnOnce(StreamError) + Send + 'static>;

/// The state of one stream, shared by the struct the application holds and **every** callback of that stream.
///
/// It is one object on purpose. The fields used to be two: the struct held a plain `AtomicBool` while the callbacks
/// read a separate `Arc<AtomicBool>` — so `close()` set a flag nobody read, the six guards stayed true for ever, and
/// an in-flight audio block could still push positions and fire cues after the operator stopped. One `Arc`, handed
/// to the struct, to the error handler and into every callback, is what makes "is it open?" one fact.
pub(crate) struct LtcStreamStatus {
    commit: Mutex<()>,
    running: AtomicBool,
    /// The stream this status belongs to and the newest generation the input has opened. A status is **current**
    /// when the two agree: that is what lets a new stream take over while an old thread is still finishing, and what
    /// stops the old stream's error from clearing the new one's flag.
    generation: u64,
    current_generation: Arc<AtomicU64>,
    /// A failure the operator has not been told about yet, taken once by the state read.
    last_error: Mutex<Option<StreamError>>,
    /// The rate this stream decodes with, and when it opened. Both belong to the **stream**, not to the input: a
    /// reopen replaces them together with the stream, which is what makes "listening at 30 fps" a fact about the
    /// signal that is open rather than about what the selector last said.
    rate: TimecodeRate,
    opened_at: std::time::Instant,
    /// How many timecode positions this stream has decoded. Zero after a few seconds is the honest symptom of a
    /// declared rate (or a channel) that does not match the signal — the case that used to be silent.
    decoded: AtomicU64,
    /// What the signal's **own** bit timing says the frame rate is, as `f32::to_bits`, or `0` for "not enough signal
    /// measured yet".
    ///
    /// It is the one fact here that can answer "is the rate the operator chose the rate that is arriving?", and it is
    /// kept beside `decoded` because both belong to this stream and both reset with it. A real measurement is never
    /// `0.0` — the decoder reports nothing at all until it has 2 000 bit periods — which is what makes `0` a safe
    /// "none" here and keeps this an `AtomicU64` rather than a lock on the audio thread.
    measured_fps: AtomicU64,
    /// When the last position arrived, as milliseconds since this stream opened, or [`NEVER_POSITION_MS`] when none has.
    ///
    /// The **age of the data** is the only honest answer to "is this input alive": a device that dies without an error
    /// callback leaves the stream open, `is_open()` true and `decoded` frozen at whatever it reached, so the page went
    /// on saying "Listening to …" for ever over a signal that had stopped. An offset from `opened_at` rather than an
    /// `Instant` keeps this a lock-free store on the audio thread.
    last_position_ms: AtomicU64,
}

/// No position has ever arrived on this stream. `u64::MAX` is far outside any session's length in milliseconds, and a
/// real offset is always smaller, so it cannot collide with one.
const NEVER_POSITION_MS: u64 = u64::MAX;

/// How long a stream that **has** decoded may go without a position before it is called stalled.
///
/// It is deliberately its own number rather than the clock's freewheel tolerance. The freewheel window belongs to the
/// clock's position stream — which MTC also feeds — while a silent audio stream is a different fault with a different
/// cure, and borrowing one number for the other would tie two unrelated diagnoses together. It sits above the freewheel
/// window (750 ms by default) so a stream is never called stalled while the clock would still call it running.
pub const LTC_STALL_MS: u64 = 1_000;

/// How long ago the last position arrived, given the stream's age and when that was.
///
/// A pure function, so the rules below can be tested without a clock and without waiting: a stream that has never
/// decoded has **no** age — it is a different fault, reported by its own sentence — and an age is never negative even if
/// the two reads disagree by a hair.
fn data_age_ms(open_ms: u64, last_position_ms: Option<u64>) -> Option<u64> {
    last_position_ms.map(|at| open_ms.saturating_sub(at))
}

/// Whether that age is long enough to call the stream **stalled** — and `false` for a stream that never decoded, which
/// is the distinction this feature turns on: "nothing ever arrived" and "it arrived and then stopped" are different
/// faults with different things to check.
fn is_stalled(age_ms: Option<u64>, stall_ms: u64) -> bool {
    age_ms.is_some_and(|age| age >= stall_ms)
}

impl LtcStreamStatus {
    fn new(generation: u64, current_generation: Arc<AtomicU64>, rate: TimecodeRate) -> Self {
        Self {
            commit: Mutex::new(()),
            running: AtomicBool::new(true),
            generation,
            current_generation,
            last_error: Mutex::new(None),
            rate,
            opened_at: std::time::Instant::now(),
            decoded: AtomicU64::new(0),
            measured_fps: AtomicU64::new(0),
            last_position_ms: AtomicU64::new(NEVER_POSITION_MS),
        }
    }

    /// Count the positions one audio block produced, so the state read can say whether this stream ever decoded
    /// anything — and **when** it last did, which is what says whether it is still alive. Called on the audio thread, so
    /// it is one relaxed add and one relaxed store and nothing else.
    pub(crate) fn record_positions(&self, count: usize) {
        if count > 0 {
            self.decoded.fetch_add(count as u64, Ordering::Relaxed);
            self.last_position_ms
                .store(self.opened_at.elapsed().as_millis() as u64, Ordering::Relaxed);
        }
    }

    /// How long ago the last position arrived, or `None` when none ever has.
    pub(crate) fn data_age_ms(&self) -> Option<u64> {
        let last = match self.last_position_ms.load(Ordering::Relaxed) {
            NEVER_POSITION_MS => None,
            at => Some(at),
        };
        data_age_ms(self.opened_at.elapsed().as_millis() as u64, last)
    }

    /// Publish what the signal's own bit timing says, once the decoder has enough of it to say anything.
    ///
    /// Called on the audio thread beside `record_positions`, so it is one relaxed store and nothing else — and it
    /// stores only when there is something new to store, which is once the measurement exists.
    pub(crate) fn record_measurement(&self, measured_fps: Option<f32>) {
        if let Some(fps) = measured_fps {
            self.measured_fps.store(fps.to_bits() as u64, Ordering::Relaxed);
        }
    }

    /// What the signal's own bit timing says, or `None` until enough of it has been measured.
    pub(crate) fn measured_fps(&self) -> Option<f32> {
        match self.measured_fps.load(Ordering::Relaxed) {
            0 => None,
            bits => Some(f32::from_bits(bits as u32)),
        }
    }

    /// The one guard the audio callback reads. False means **do not touch the shared state**: the block is either
    /// from a stream that was closed, or from one a newer stream has replaced.
    pub(crate) fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed) && self.is_current()
    }

    fn is_current(&self) -> bool {
        self.current_generation.load(Ordering::Relaxed) == self.generation
    }

    fn record_error(&self, error: StreamError) {
        if let Ok(mut guard) = self.last_error.lock() {
            *guard = Some(error);
        }
    }

    fn take_error(&self) -> Option<StreamError> {
        self.last_error.lock().ok().and_then(|mut guard| guard.take())
    }
}

/// The stream's death, as a fact the application can state: the flag `is_open()` reads is cleared, the reason is
/// kept, and the handler — which is how the window is told — is called with it.
///
/// Factored out of `build_stream`'s inline closure on purpose: that closure was the whole response to a hot unplug
/// (`eprintln!`), and a closure inside a generic stream builder cannot be invoked by a test. This can, and it is
/// the decision the page's honesty depends on, so it is the one that is measured.
fn on_stream_error(
    status: &LtcStreamStatus,
    error: StreamError,
    on_death: StreamDeathHandler,
) {
    let commit = status.commit.lock().unwrap_or_else(|e| e.into_inner());
    // A stream that has already been replaced says nothing: the device it lost is not the one that is open now.
    if !status.is_current() {
        return;
    }
    status.running.store(false, Ordering::Relaxed);
    status.record_error(error.clone());
    drop(commit);
    on_death(error);
}

/// Whether a stream is still the one the input has open. Used by the reconnect loop, which must not report a state
/// the operator did not ask for on top of a stream that replaced it.
fn stream_is_current(current_generation: &AtomicU64, generation: u64) -> bool {
    current_generation.load(Ordering::Relaxed) == generation
}

/// What an [`LtcInput::open`] attempt was asked to listen to, kept so a reconnect can repeat it.
#[derive(Clone)]
pub struct LtcInputTarget {
    pub device: String,
    pub channel: usize,
    pub rate: TimecodeRate,
}

/// What the stream that is open now is doing, as one fact: the rate it decodes with, how long it has been open and
/// how many timecode positions it has decoded.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OpenStreamFacts {
    pub rate: TimecodeRate,
    pub open_ms: u64,
    pub decoded: u64,
    /// What the signal's **own bit timing** says the frame rate is, once enough of it has been measured. `None` for a
    /// stream that has not shown 2 000 bit periods yet — and it is not `Eq` any more because this is an `f32`: an exact
    /// equality on a measurement is not a thing anybody should be able to write.
    pub measured_fps: Option<f32>,
    /// How long ago the last position arrived, or `None` when none ever has. `open_ms` is the age of the **stream**,
    /// which says nothing about whether data is still coming; this is the number that does.
    pub data_age_ms: Option<u64>,
    /// True when a stream that has decoded has now gone quiet for [`LTC_STALL_MS`] — the silent death that used to be
    /// reported as "Listening to …" for ever. Never true for a stream that has never decoded: that is the rate or the
    /// channel, and it has its own sentence.
    pub stalled: bool,
}

/// What a change of the rate selector must do to the input that is open now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LtcRateChange {
    /// Nothing is open: the chosen rate is what the next Listen decodes with, and there is no stream to restart.
    Idle,
    /// The stream that is open already decodes at that rate. Restarting it would drop a locked stream — and the
    /// positions arriving with it — for no change at all.
    AlreadyAtRate,
    /// The open stream was opened at another rate, and only a reopen can change what it decodes.
    Reopen,
}

/// The whole decision a rate change makes, as a pure function of what is open.
///
/// It is separated from the command that applies it because it is the one judgement in this path that can be wrong
/// without anybody noticing: a page may send the same rate twice (a re-rendered form, a return to the page), and a
/// stream already decoding at the right rate must not be torn down and re-locked in the middle of a show. The two
/// answers that must **not** touch a device are decided here, without a device, and pinned by a test.
pub fn ltc_rate_change(open_rate: Option<TimecodeRate>, wanted: TimecodeRate) -> LtcRateChange {
    match open_rate {
        None => LtcRateChange::Idle,
        Some(current) if current == wanted => LtcRateChange::AlreadyAtRate,
        Some(_) => LtcRateChange::Reopen,
    }
}

/// Everything the input owns, behind one `Arc`: the application holds this, and so does each command that has to
/// touch the device from a blocking thread.
///
/// The indirection is what lets an async command hand the input to `spawn_blocking` — which needs `'static` — while
/// the state it reads stays the **one** input the application has. Two `LtcInput` values would be two streams.
#[derive(Default)]
pub struct LtcInput {
    inner: Arc<LtcInputInner>,
}

/// A second handle on the same input. Cheap to clone, and it touches the same stream and the same flag.
#[derive(Clone)]
pub struct LtcInputHandle {
    inner: Arc<LtcInputInner>,
}

#[derive(Default)]
struct LtcInputInner {
    lifecycle: Mutex<()>,
    source: Mutex<Option<(std::sync::Weak<TimecodeState>, u64)>>,
    /// Sending on this is how the owning thread is told to stop; dropping it is the same message.
    stop: Mutex<Option<std::sync::mpsc::Sender<()>>>,
    /// The state of the stream that is open **now**, and the generation counter that makes it the current one.
    ///
    /// The counter is shared with every status this input has ever handed out, so `close()` and the next `open()`
    /// retire every older stream by one write rather than by waiting for its thread.
    status: Mutex<Option<Arc<LtcStreamStatus>>>,
    current_generation: Arc<AtomicU64>,
    listening: Mutex<Option<String>>,
    /// What to listen to again after a hot unplug: the last device and channel the operator chose, kept here so the
    /// reconnect control does not have to trust a page that may have been reloaded.
    last_target: Mutex<Option<LtcInputTarget>>,
}

impl LtcInput {
    /// A handle for one command to move into a blocking thread.
    pub fn handle(&self) -> LtcInputHandle {
        LtcInputHandle { inner: Arc::clone(&self.inner) }
    }
}

impl LtcInputHandle {
    pub fn is_open(&self) -> bool {
        self.inner.status
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|status| status.is_running()))
            .unwrap_or(false)
    }

    /// What it is listening to, for the readout: a device and a channel, so an operator can see at a glance which
    /// input the timecode is coming from.
    pub fn listening(&self) -> Option<String> {
        self.inner.listening.lock().ok().and_then(|guard| guard.clone())
    }

    /// The last failure the stream reported, taken **once**: the page reads it, shows it, and the next read does not
    /// repeat it. Without the clearing, one unplug would be shown for the rest of the session.
    pub fn take_error(&self) -> Option<StreamError> {
        self.inner.status
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().and_then(|status| status.take_error()))
    }

    /// The one flag the stream's callbacks read, exposed for the tests that prove it is the flag `close()` clears.
    #[cfg(test)]
    pub(crate) fn stream_guard(&self) -> Option<Arc<LtcStreamStatus>> {
        self.inner.status.lock().ok().and_then(|guard| guard.clone())
    }

    /// The slot that guard lives in, so a test can install a status the way a successful `open` would — there is no
    /// other way to put one there without a real audio device.
    #[cfg(test)]
    pub(crate) fn stream_guard_slot(&self) -> &Mutex<Option<Arc<LtcStreamStatus>>> {
        &self.inner.status
    }

    /// What the stream that is open **now** is doing: the rate it decodes with, how long it has been open and how
    /// many timecode positions it has produced. `None` when nothing is open.
    ///
    /// The three travel together because they are one fact about one stream. The page's answer to "the source is 30
    /// and the selector says 25" is built from exactly these: the rate it is decoding at, and the fact that a few
    /// seconds have passed with nothing decoded.
    pub fn open_facts(&self) -> Option<OpenStreamFacts> {
        let status = self.inner.status.lock().ok().and_then(|guard| guard.clone())?;
        if !status.is_running() {
            return None;
        }
        Some(OpenStreamFacts {
            rate: status.rate,
            open_ms: status.opened_at.elapsed().as_millis() as u64,
            decoded: status.decoded.load(Ordering::Relaxed),
            measured_fps: status.measured_fps(),
            data_age_ms: status.data_age_ms(),
            stalled: is_stalled(status.data_age_ms(), LTC_STALL_MS),
        })
    }

    /// Open an input and start decoding LTC from one channel of it.
    ///
    /// The stream is built on its own thread, and the result comes back through a channel so that a device that
    /// refuses to open — a permission that was refused, a device somebody else is holding — is reported to the
    /// operator instead of failing silently in a thread nobody is watching.
    ///
    /// **This blocks** (up to ten seconds) and must therefore never be called from the main thread; the command that
    /// calls it belongs in `spawn_blocking`. `on_death` builds the handler the stream reports its death through —
    /// it is given the device name so the window's sentence can name the input that stopped, and it is built here
    /// rather than by the caller so a reconnect cannot report the wrong device.
    pub fn open(
        &self,
        enabled: bool,
        device_name: &str,
        channel: usize,
        rate: TimecodeRate,
        state: Arc<TimecodeState>,
        on_death: impl FnOnce(String) -> StreamDeathHandler,
    ) -> Result<String, String> {
        self.open_expected(enabled, device_name, channel, rate, state, on_death, None)
    }
    fn reserve_open(&self, expected: Option<u64>) -> Result<u64, String> {
        let _operation = self.inner.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        if expected.is_some_and(|generation| generation != self.inner.current_generation.load(Ordering::SeqCst)) {
            return Err("The input request was cancelled or superseded while finding the device".into());
        }
        self.close_inner();
        Ok(self.inner.current_generation.fetch_add(1, Ordering::SeqCst) + 1)
    }
    fn open_expected(
        &self, enabled: bool, device_name: &str, channel: usize, rate: TimecodeRate,
        state: Arc<TimecodeState>, on_death: impl FnOnce(String) -> StreamDeathHandler,
        expected: Option<u64>,
    ) -> Result<String, String> {
        super::ltc::ensure_audio_allowed(enabled)?;
        let device_name = device_name.trim().to_string();
        if device_name.is_empty() {
            return Err("no input device was chosen".to_string());
        }
        let (stop_sender, stop_receiver) = std::sync::mpsc::channel::<()>();
        let (ready_sender, ready_receiver) = std::sync::mpsc::channel::<Result<u32, String>>();
        // A generation no earlier stream has: every callback of the stream about to be built captures it, and the
        // error handler is ignored unless it is still the newest.
        let generation = self.reserve_open(expected)?;
        let status = Arc::new(LtcStreamStatus::new(generation, Arc::clone(&self.inner.current_generation), rate));
        let thread_status = Arc::clone(&status);
        let thread_device = device_name.clone();
        let thread_state = state.clone();
        let on_death = on_death(device_name.clone());
        std::thread::spawn(move || {
            match build_stream(&thread_device, channel, rate, &thread_state, thread_status.clone(), on_death) {
                Ok((stream, sample_rate)) => {
                    let _ = ready_sender.send(Ok(sample_rate));
                    // Block here for as long as the operator wants it open. The stream lives in this frame, so
                    // returning from the thread — which is what a stop does — drops it and stops capture. Keeping it
                    // alive with `mem::forget` would leak it and leave the device recording for ever.
                    let _ = stop_receiver.recv();
                    drop(stream);
                }
                Err(error) => {
                    let _ = ready_sender.send(Err(error));
                }
            }
        });
        match ready_receiver.recv_timeout(std::time::Duration::from_secs(10)) {
            Ok(Ok(sample_rate)) => {
                let _operation = self.inner.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
                let commit = status.commit.lock().unwrap_or_else(|e| e.into_inner());
                if self.inner.current_generation.load(Ordering::SeqCst) != generation || !status.is_running() {
                    return Err("The input start was superseded or the stream stopped before it became ready".to_string());
                }
                // The stream has played successfully, but every callback was rejected
                // until this source activation. Reset occurs before the first accepted frame.
                state.activate_ltc(generation);
                *self.inner.source.lock().unwrap_or_else(|e| e.into_inner()) = Some((Arc::downgrade(&state), generation));
                if let Ok(mut guard) = self.inner.stop.lock() {
                    *guard = Some(stop_sender);
                }
                if let Ok(mut guard) = self.inner.listening.lock() {
                    *guard = Some(format!("{device_name} · channel {}", channel + 1));
                }
                if let Ok(mut guard) = self.inner.last_target.lock() {
                    *guard = Some(LtcInputTarget { device: device_name.clone(), channel, rate });
                }
                if let Ok(mut guard) = self.inner.status.lock() {
                    *guard = Some(status.clone());
                }
                drop(commit);
                Ok(format!(
                    "listening to {device_name} · channel {} · {sample_rate} Hz",
                    channel + 1
                ))
            }
            Ok(Err(error)) => Err(error),
            Err(_) => Err(format!(
                "{device_name} did not start within ten seconds: the device may be held by another application, or \
                 this application may not have permission to use audio input (System Settings → Privacy & \
                 Security → Microphone)"
            )),
        }
    }

    /// Stop listening, and wait **bounded** for the stream to stop being the open one.
    ///
    /// Idempotent, and never fails: switching off must be able to switch off. The generation is retired first, so
    /// every callback of the stream that was open stops touching the shared state **immediately** — whatever the
    /// owning thread is doing, and even if it is inside a device call that never returns. That is what makes the
    /// guard the callback reads false the moment this returns.
    ///
    /// No driver operation or guessed grace period is awaited here. Retirement
    /// serialises only with in-process acceptance; device destruction runs on its owner.
    pub fn close_within(&self, _timeout: std::time::Duration) {
        let _operation = self.inner.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        self.close_inner();
    }
    fn close_inner(&self) {
        if let Some((state, generation)) = self.inner.source.lock().unwrap_or_else(|e| e.into_inner()).take() {
            if let Some(state) = state.upgrade() { state.retire_ltc(generation); }
        }
        self.inner.current_generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut guard) = self.inner.status.lock() {
            if let Some(status) = guard.take() {
                status.running.store(false, Ordering::Relaxed);
            }
        }
        // Dropping the sender ends the owning thread's `recv()`, which drops the stream with it.
        if let Ok(mut guard) = self.inner.stop.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.inner.listening.lock() {
            *guard = None;
        }
        // Retiring the ingress lease is synchronous. No guessed sleep is needed:
        // a decoded block still in flight can no longer commit a position.

    }

    /// Stop listening. Idempotent, and never fails: switching off must be able to switch off.
    pub fn close(&self) {
        self.close_within(std::time::Duration::from_millis(50));
    }

    /// Open the input again after its stream died — one control, one sentence.
    ///
    /// This is the whole recovery path for a hot unplug, and every step of it is deliberate:
    ///
    /// * the **generation** is bumped by `close()` first, so an error still arriving from the old stream is ignored
    ///   and a new stream can open even if the old thread has not finished;
    /// * closing is **bounded**, for the same reason a Stop is;
    /// * the device is re-resolved **by name**, because a device that was unplugged and plugged back in may have a
    ///   new index, and because the list the page holds is as old as the page;
    /// * when the name is not in the list any more, the **default input** is used instead, so a device that came
    ///   back with a slightly different name still has a path;
    /// * the answer names **which step failed**, because "reconnect failed" is not something an operator can act on.
    ///
    /// `rate` is how the same machinery serves a rate change as well as a hot unplug: `None` repeats the rate the
    /// stream was opened with (what a reconnect means), and `Some(rate)` opens at the new one — the only way a rate
    /// this input already opened at can be changed, because the rate is baked into the stream that is running.
    ///
    /// It blocks like `open` does (device enumeration and the ready wait) and must not run on the main thread.
    pub fn reopen(
        &self,
        enabled: bool,
        rate: Option<TimecodeRate>,
        state: Arc<TimecodeState>,
        on_death: impl FnOnce(String) -> StreamDeathHandler,
    ) -> Result<String, String> {
        super::ltc::ensure_audio_allowed(enabled)?;
        // Capture the target and retire/reserve in one lifecycle transaction: a newer
        // Listen must not be replaced using an older target read before it completed.
        let (target, rate, generation) = {
            let _operation = self.inner.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
            let target = self.inner.last_target.lock().ok().and_then(|guard| guard.clone())
                .ok_or_else(|| "nothing to reconnect: no input has been listened to yet in this session — choose a device and press Listen".to_string())?;
            let rate = rate.unwrap_or(target.rate);
            self.close_inner();
            (target, rate, self.inner.current_generation.load(Ordering::SeqCst))
        };
        let device = match resolve_input_device(&target.device) {
            Ok(device) => device.name,
            Err(why) => {
                // The name is gone from the list. The default input is the documented fallback, and it is only
                // reached when the name genuinely is not there — otherwise a rename would silently move the input.
                let fallback = cpal::default_host().default_input_device().map(|device| device.to_string());
                let Some(fallback) = fallback else {
                    return Err(format!(
                        "the step that failed was finding the device: {why}, and this machine reports no default \
                         input either"
                    ));
                };
                if !stream_is_current(&self.inner.current_generation, generation) {
                    return Err("a newer stream took over while this reconnect was looking".to_string());
                }
                fallback
            }
        };
        if !stream_is_current(&self.inner.current_generation, generation) {
            return Err("a newer stream took over while this reconnect was looking".to_string());
        }
        // The channel is re-checked against the device that answered: the fallback device may have fewer channels
        // than the one that was unplugged, and reading a channel that does not exist is the silent kind of wrong.
        let channels = resolve_input_device(&device)
            .ok()
            .and_then(|found| found.device.default_input_config().ok())
            .map(|config| config.channels() as usize)
            .unwrap_or(0);
        let channel = target.channel.min(channels.saturating_sub(1));
        let answer = self.open_expected(enabled, &device, channel, rate, state, on_death, Some(generation))?;
        Ok(if device == target.device {
            format!("Reconnected: {answer}")
        } else {
            format!(
                "Reconnected to the default input instead, because '{}' was not listed: {answer}",
                target.device
            )
        })
    }
}

/// One input device by the name the picker showed the operator, or why it is not there.
///
/// The name is the only handle that survives a replug, so it is the one a reconnect re-resolves.
fn resolve_input_device(device_name: &str) -> Result<ResolvedInput, String> {
    let device = cpal::default_host()
        .input_devices()
        .map_err(|error| format!("the audio devices could not be listed: {error}"))?
        // Comparing the displayed name, which is what the picker showed the operator.
        .find(|device| device.to_string() == device_name)
        .ok_or_else(|| format!("'{device_name}' is not an input device this machine reports"))?;
    Ok(ResolvedInput { name: device.to_string(), device })
}

/// A device and the name it answered to, so a caller never has to ask the same question twice.
struct ResolvedInput {
    name: String,
    device: cpal::Device,
}

/// Build the input stream, start it, and hand it back to the thread that will own it.
/// One sample of each format CPAL may hand over, as the -1.0 .. 1.0 float the decoder reads.
///
/// Written out rather than taken from a conversion trait, because the **zero point** is the part that must not be
/// guessed: an unsigned 16-bit sample is centred on 32 768, a signed 32-bit one on 0, and a 24-bit sample carries its
/// sign in the top bit of its 24 bits. Each of these is pinned by a test.
fn f32_from_f32(sample: f32) -> f32 {
    sample
}
fn f32_from_f64(sample: f64) -> f32 {
    sample as f32
}
fn f32_from_i16(sample: i16) -> f32 {
    sample as f32 / 32_768.0
}
fn f32_from_u16(sample: u16) -> f32 {
    (sample as f32 - 32_768.0) / 32_768.0
}
fn f32_from_i32(sample: i32) -> f32 {
    sample as f32 / 2_147_483_648.0
}
fn f32_from_i24(sample: cpal::I24) -> f32 {
    // 24 significant bits, so full scale is 2^23.
    sample.inner() as f32 / 8_388_608.0
}

/// Take one channel out of interleaved samples, converting as it goes, into a buffer the caller reuses.
///
/// Pure and separate from the callback so it can be tested without a device: this is the part that decides **which**
/// channel carries the timecode, and reading the wrong one reads a different input's silence.
fn take_channel_into<T: Copy>(
    data: &[T],
    channels: usize,
    channel: usize,
    out: &mut Vec<f32>,
    convert: fn(T) -> f32,
) {
    out.clear();
    if channels == 0 {
        return;
    }
    out.extend(
        data.chunks(channels)
            .filter_map(|frame| frame.get(channel).copied())
            .map(convert),
    );
}

/// One block of audio, from the callback to the decoder to the shared state, reusing the caller's buffers.
///
/// `mono` and `positions` belong to the stream and are reused for every block, so the callback no longer builds a
/// fresh vector per call. They can still **grow** if a device hands over a block larger than any seen before —
/// `extend` reserves when it must — which is why this says reused and not "without allocating": after the first block
/// of a given size there is nothing left to allocate, and a promise of never allocating is one this code cannot keep.
/// An independent review caught the earlier wording overpromising exactly here.
#[allow(clippy::too_many_arguments)]
fn feed_block<T: Copy>(
    data: &[T],
    channels: usize,
    channel: usize,
    mono: &mut Vec<f32>,
    decoder: &mut LtcDecoder,
    rate: TimecodeRate,
    positions: &mut Vec<TimecodePosition>,
    status: &LtcStreamStatus,
    state: &Arc<TimecodeState>,
    convert: fn(T) -> f32,
) {
    take_channel_into(data, channels, channel, mono, convert);
    decoder.feed_into(mono, rate, positions);
    // What this stream has decoded, counted where it is decided rather than in the six callbacks: the state read's
    // answer to "has this rate produced anything at all" is this number, and it resets with the stream because the
    // status does.
    status.record_positions(positions.len());
    // And what the signal's own timing says, which is the measurement that escapes the declaration: a count-derived
    // rate would confirm a wrong declaration instead of exposing it (see `LtcDecoder::measured_fps`).
    status.record_measurement(decoder.measured_fps());
    // The only work left beyond the decode is handing the positions over. `push_position` takes short locks and never
    // sends blocking messages (its sinks are `try_send`), which is the smallest safe amount of work here: moving it to
    // a worker thread would need a channel and a buffer for a path that produces one position per frame at most.
    for position in positions.iter() {
        let _commit = status.commit.lock().unwrap_or_else(|e| e.into_inner());
        if !status.is_running() { break; }
        state.accept_ltc(status.generation, *position, std::time::Instant::now());
    }
    // **And nothing else — no disk on this thread.** The as-run record used to be flushed right here, and this
    // function is called from the **cpal stream callbacks** (:883, :898, :913, :928), so that line wrote a file on an
    // audio driver callback. The sentence two paragraphs above already said what was wrong with it: *"a disk in the
    // middle of `push_position` would make the frame budget depend on a filesystem."*
    //
    // The flush rides the **position sink's consumer thread** instead (D9, `install_position_sink`), which is fed
    // inside `push_position` for **every** source — so nothing is lost by removing this, and the guide's promise to
    // the operator stays exactly true: 32 lines, five seconds, a save, or a close.
}

/// Build the stream one owning thread will hold, with the status its callbacks read and the handler its death is
/// reported through.
fn build_stream(
    device_name: &str,
    channel: usize,
    rate: TimecodeRate,
    state: &Arc<TimecodeState>,
    status: Arc<LtcStreamStatus>,
    on_death: StreamDeathHandler,
) -> Result<(cpal::Stream, u32), String> {
    let device = resolve_input_device(device_name)?.device;
    let supported = device
        .default_input_config()
        .map_err(|error| format!("{device_name} would not say what it can record: {error}"))?;
    let sample_rate = supported.sample_rate();
    let channels = supported.channels() as usize;
    if channel >= channels {
        return Err(format!(
            "{device_name} records {channels} channel(s), so channel {} does not exist",
            channel + 1
        ));
    }
    let config = cpal::StreamConfig {
        channels: supported.channels(),
        sample_rate: supported.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };
    // The decoder and its buffers belong to the callback: it needs to see every sample in order, it must not be
    // shared, and it must not allocate — these are reused for the life of the stream, whatever block size the device
    // hands over.
    let decoder = LtcDecoder::new(sample_rate as f32, rate);
    let mono: Vec<f32> = Vec::with_capacity(4096);
    let positions: Vec<TimecodePosition> = Vec::with_capacity(8);
    let state = Arc::clone(state);
    // The stream's death is the one thing that used to be swallowed: an `eprintln!` inside a closure. It is now a
    // handler that clears the flag `is_open()` reads, records the reason and tells the window — and because it is
    // built here rather than inline, a test can invoke exactly what CPAL invokes.
    // `on_death` is `FnOnce` — it is the one answer to "this stream is gone" — so it travels in an `Option` and is
    // taken by the single stream this function builds. Exactly one arm of the match below runs; the `Option` is what
    // says so to the borrow checker.
    let mut on_death = Some(on_death);
    let on_error = {
        let status = Arc::clone(&status);
        move |error: cpal::Error| {
            let described = ChannelStreamError::new(&error);
            eprintln!("LTC input error: {}", described.message);
            let Some(on_death) = on_death.take() else { return };
            on_stream_error(
                &status,
                StreamError { message: described.message, disconnected: described.is_device_gone },
                on_death,
            );
        }
    };
    // One channel, not a mix: timecode is on one channel of a recording — a rack sends it on one input — and mixing
    // could cancel a signal that is inverted between channels.
    //
    // Every format CPAL may report is handled, because an interface that offers 24-bit or unsigned input is not a
    // broken interface: rejecting it would be this build's limitation shown to an operator as a device error.
    // Taken before the match, not inside an arm: `match` is not a move-once construct to the borrow checker, so the
    // handler has to be dealt out here and moved into whichever single arm runs.
    let mut on_error = Some(on_error);
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => {
            let (mut mono, mut positions, mut decoder) = (mono, positions, decoder);
            let status = Arc::clone(&status);
            device.build_input_stream(
                config.clone(),
                move |data: &[f32], _| {
                    if !status.is_running() {
                        return;
                    }
                    feed_block(data, channels, channel, &mut mono, &mut decoder, rate, &mut positions, &status, &state, f32_from_f32);
                },
                on_error.take().expect("one stream is built"),
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let (mut mono, mut positions, mut decoder) = (mono, positions, decoder);
            let status = Arc::clone(&status);
            device.build_input_stream(
                config.clone(),
                move |data: &[i16], _| {
                    if !status.is_running() {
                        return;
                    }
                    feed_block(data, channels, channel, &mut mono, &mut decoder, rate, &mut positions, &status, &state, f32_from_i16);
                },
                on_error.take().expect("one stream is built"),
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let (mut mono, mut positions, mut decoder) = (mono, positions, decoder);
            let status = Arc::clone(&status);
            device.build_input_stream(
                config.clone(),
                move |data: &[u16], _| {
                    if !status.is_running() {
                        return;
                    }
                    feed_block(data, channels, channel, &mut mono, &mut decoder, rate, &mut positions, &status, &state, f32_from_u16);
                },
                on_error.take().expect("one stream is built"),
                None,
            )
        }
        cpal::SampleFormat::I32 => {
            let (mut mono, mut positions, mut decoder) = (mono, positions, decoder);
            let status = Arc::clone(&status);
            device.build_input_stream(
                config.clone(),
                move |data: &[i32], _| {
                    if !status.is_running() {
                        return;
                    }
                    feed_block(data, channels, channel, &mut mono, &mut decoder, rate, &mut positions, &status, &state, f32_from_i32);
                },
                on_error.take().expect("one stream is built"),
                None,
            )
        }
        cpal::SampleFormat::F64 => {
            let (mut mono, mut positions, mut decoder) = (mono, positions, decoder);
            let status = Arc::clone(&status);
            device.build_input_stream(
                config.clone(),
                move |data: &[f64], _| {
                    if !status.is_running() {
                        return;
                    }
                    feed_block(data, channels, channel, &mut mono, &mut decoder, rate, &mut positions, &status, &state, f32_from_f64);
                },
                on_error.take().expect("one stream is built"),
                None,
            )
        }
        cpal::SampleFormat::I24 => {
            let (mut mono, mut positions, mut decoder) = (mono, positions, decoder);
            let status = Arc::clone(&status);
            device.build_input_stream(
                config.clone(),
                move |data: &[cpal::I24], _| {
                    if !status.is_running() {
                        return;
                    }
                    feed_block(data, channels, channel, &mut mono, &mut decoder, rate, &mut positions, &status, &state, f32_from_i24);
                },
                on_error.take().expect("one stream is built"),
                None,
            )
        }
        other => {
            return Err(format!(
                "{device_name} records {other:?}, which this build does not read: it reads 32-bit float, 64-bit \
                 float, and 16, 24 and 32-bit integer input"
            ))
        }
    }
    .map_err(|error| format!("{device_name} could not be opened for recording: {error}"))?;
    stream
        .play()
        .map_err(|error| format!("{device_name} could not be started: {error}"))?;
    Ok((stream, sample_rate))
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_reconnect_cannot_reserve_again_after_stop_during_device_resolution() {
        let input=LtcInput::default().handle();
        let expected=input.reserve_open(None).unwrap();
        let (resume,wait)=std::sync::mpsc::channel();
        let pending=input.clone();
        let worker=std::thread::spawn(move || {wait.recv().unwrap();pending.reserve_open(Some(expected))});
        input.close();
        let after_stop=input.inner.current_generation.load(Ordering::SeqCst);
        resume.send(()).unwrap();assert!(worker.join().unwrap().is_err());
        assert_eq!(input.inner.current_generation.load(Ordering::SeqCst),after_stop);
        let current=input.reserve_open(None).unwrap();
        assert!(input.reserve_open(Some(expected)).is_err());
        assert_eq!(input.inner.current_generation.load(Ordering::SeqCst),current);
    }

    use super::*;

    /// The trap macOS sets: an application without the microphone permission can be told there are **no** input
    /// devices, and then nobody can ever choose one — so the default device is offered anyway.
    #[test]
    fn an_empty_device_list_still_offers_the_default_input() {
        let fallback = AudioInputInfo {
            name: "MacBook Pro Microphone".to_string(),
            channels: 1,
            sample_rate: 48_000,
            is_default: true,
        };
        // Empty in, one device out: the operator has something to choose, and choosing it asks for permission.
        let offered = with_default_device(Vec::new(), Some(fallback.clone()));
        assert_eq!(offered.len(), 1);
        assert_eq!(offered[0].name, "MacBook Pro Microphone");
        assert!(offered[0].is_default);

        // A real enumeration is never replaced or duplicated by the fallback.
        let listed = vec![AudioInputInfo {
            name: "QUANTUM".to_string(),
            channels: 2,
            sample_rate: 48_000,
            is_default: false,
        }];
        assert_eq!(with_default_device(listed.clone(), Some(fallback)), listed);

        // And a machine with genuinely nothing still answers with nothing, rather than an invented device.
        assert!(with_default_device(Vec::new(), None).is_empty());
    }

    /// The device list answers without opening anything, and the refusal that keeps a microphone from being opened
    /// unasked names the switch: this is the layer where an application either respects that or does not.
    #[test]
    fn the_input_list_opens_nothing_and_the_audio_switch_is_a_gate() {
        // A machine with no inputs is an answer, not an error: a headless test must be able to ask the question, and
        // every entry that is there has to say what it is.
        // Listing must answer: a machine with no audio gives an empty list or a reason, and either is an answer. What
        // it must never do is panic, which is what this exercises.
        let listed = list_inputs();
        for input in listed.unwrap_or_default() {
            assert!(!input.name.is_empty(), "a device with no name cannot be chosen: {input:?}");
        }

        let refused = super::super::ltc::ensure_audio_allowed(false).expect_err("off must refuse");
        assert!(refused.contains("Settings → Timecode (MTC, LTC, SMPTE)"), "{refused}");
        assert!(refused.contains("no microphone"), "{refused}");
        assert!(super::super::ltc::ensure_audio_allowed(true).is_ok());

        // And a closed input reports itself closed without touching a device.
        let input = LtcInput::default().handle();
        assert!(!input.is_open());
        assert!(input.listening().is_none());
        input.close();
        assert!(!input.is_open(), "closing something that was never open is not an error");
    }

    /// A status as the input hands one out: the flag the callbacks read, the generation that makes it current, the
    /// rate the stream decodes with, and the place a failure is kept for the page.
    fn status_for_test(generation: u64, current: &Arc<AtomicU64>) -> Arc<LtcStreamStatus> {
        Arc::new(LtcStreamStatus::new(generation, Arc::clone(current), TimecodeRate::Fps25))
    }

    /// **The silent death, measured.** A hot unplug makes CPAL call the stream's error callback — and that callback
    /// used to be one `eprintln!`: `is_open()` kept answering `true` and the page kept saying "Listening to …" over a
    /// stream that had stopped. The handler is now a function a test can call, and this is the contract: the flag
    /// `is_open()` reads goes false, the reason is kept, and the window is handed exactly one report.
    #[test]
    fn a_device_that_goes_away_clears_the_flag_and_is_reported() {
        let current = Arc::new(AtomicU64::new(7));
        let status = status_for_test(7, &current);
        assert!(status.is_running(), "the stream starts open");

        // The mapping from CPAL's own error is the part that decides whether this is a death or a complaint, and it
        // is tested directly: only a device that is gone, or a stream the system invalidated, is a disconnect.
        let unavailable = ChannelStreamError::new(&cpal::Error::with_message(
            cpal::ErrorKind::DeviceNotAvailable,
            "The requested audio device is not available. It may have been disconnected.",
        ));
        assert!(unavailable.is_device_gone, "DeviceNotAvailable is a device that went away: {unavailable:?}");
        let invalidated = ChannelStreamError::new(&cpal::Error::new(cpal::ErrorKind::StreamInvalidated));
        assert!(invalidated.is_device_gone, "StreamInvalidated means the stream is dead too: {invalidated:?}");
        let underrun = ChannelStreamError::new(&cpal::Error::new(cpal::ErrorKind::Xrun));
        assert!(!underrun.is_device_gone, "a stream that merely complained is not a device that went away");

        let told = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&told);
        on_stream_error(
            &status,
            StreamError { message: unavailable.message.clone(), disconnected: true },
            Box::new(move |error| sink.lock().expect("the test lock").push(error)),
        );

        assert!(!status.is_running(), "the flag the callbacks read must be false after the device went away");
        let kept = status.take_error().expect("the reason must be kept for the page");
        assert_eq!(kept.message, unavailable.message, "the system's own words, not a paraphrase");
        assert!(kept.disconnected, "and it must be marked as the device being gone");
        assert!(status.take_error().is_none(), "reading the reason clears it: one unplug is not reported for ever");
        let reports = told.lock().expect("the test lock");
        assert_eq!(reports.len(), 1, "the window is told once: {reports:?}");
        assert!(reports[0].disconnected, "and told it was a disconnect");
    }

    /// The other half of the same defect: a stream that was **closed** must never be able to clear a newer one.
    /// Without the generation, the error handler of a dead stream would take down the stream that replaced it.
    #[test]
    fn a_replaced_stream_cannot_clear_the_one_that_replaced_it() {
        let current = Arc::new(AtomicU64::new(2));
        let replaced = status_for_test(1, &current);
        let open_now = status_for_test(2, &current);
        assert!(open_now.is_running());

        let told = Arc::new(Mutex::new(0usize));
        let sink = Arc::clone(&told);
        on_stream_error(
            &replaced,
            StreamError { message: "the device that was replaced went away".to_string(), disconnected: true },
            Box::new(move |_| *sink.lock().expect("the test lock") += 1),
        );
        assert!(open_now.is_running(), "the stream that is open now must not be cleared by the one it replaced");
        assert_eq!(*told.lock().expect("the test lock"), 0, "and nothing may be reported about a stream nobody has");
        assert!(open_now.take_error().is_none(), "and no error may be filed against the current stream");
    }

    /// **The guard after a close.** `running` used to be a plain `AtomicBool` in the struct while the six callbacks
    /// read a *different* `Arc<AtomicBool>` that nothing ever set false — so an in-flight audio block went on
    /// pushing positions and firing cues after Stop. This is the contract the study asked for: after `close()` the
    /// guard the callback evaluates is false.
    #[test]
    fn closing_makes_the_guard_the_callbacks_read_false() {
        // A status as the input installs one when a stream opens, and the handle whose `close()` must reach it.
        let input = LtcInput::default().handle();
        let current = Arc::new(AtomicU64::new(1));
        let guard = Arc::new(LtcStreamStatus::new(1, Arc::clone(&current), TimecodeRate::Fps25));
        if let Ok(mut slot) = input.stream_guard_slot().lock() {
            *slot = Some(Arc::clone(&guard));
        }
        assert!(guard.is_running(), "an open stream's guard is true");

        input.close();
        assert!(!guard.is_running(), "after close the guard must be false, or a block can still fire cues");
        assert!(!input.is_open(), "and the state the page reads says so too");
        assert!(input.stream_guard().is_none(), "a closed input has no stream to guard");

        // And the block the guard protects really is skipped: this is the call the callback makes before touching
        // any shared state.
        let fed = guard.is_running();
        assert!(!fed, "an in-flight block must do nothing at all after the operator stopped");
    }

    /// A stream's guard is also false when a **newer** stream is open, which is what lets a reconnect start before
    /// the old thread has finished.
    #[test]
    fn a_new_open_retires_the_previous_guard() {
        let current = Arc::new(AtomicU64::new(2));
        let old = status_for_test(1, &current);
        assert!(!old.is_running(), "a guard whose generation is not the current one is already false");
        let newest = status_for_test(2, &current);
        assert!(newest.is_running(), "only the stream the input has open reports itself open");
        // Closing something that was never open is not an error, and neither is a second close.
        let input = LtcInput::default().handle();
        input.close();
        assert!(!input.is_open());
    }

    /// The zero point of every format, which is the part that cannot be guessed.
    #[test]
    fn each_sample_format_is_converted_around_its_own_zero_point() {
        assert_eq!(f32_from_i16(0), 0.0);
        assert_eq!(f32_from_i16(i16::MIN), -1.0);
        assert_eq!(f32_from_i16(i16::MAX), 32_767.0 / 32_768.0);
        // An unsigned sample is centred on half scale: reading it as signed would put digital silence at -1.0.
        assert_eq!(f32_from_u16(32_768), 0.0);
        assert_eq!(f32_from_u16(0), -1.0);
        assert_eq!(f32_from_u16(u16::MAX), 32_767.0 / 32_768.0);
        assert_eq!(f32_from_i32(0), 0.0);
        assert_eq!(f32_from_i32(i32::MIN), -1.0);
        // `i32::MAX` cannot be held exactly by an `f32`: it rounds up to 2^31, so the conversion lands on exactly
        // 1.0. Worth stating rather than asserting a bound the arithmetic cannot keep — LTC only reads sign changes.
        assert_eq!(f32_from_i32(i32::MAX), 1.0);
        // A 24-bit sample carries its sign in the top bit of 24, not of 32.
        assert_eq!(f32_from_i24(cpal::I24::new(0).expect("zero")), 0.0);
        assert_eq!(f32_from_i24(cpal::I24::new(-8_388_608).expect("full scale")), -1.0);
        assert_eq!(f32_from_f64(0.5), 0.5);
        assert_eq!(f32_from_f32(-0.25), -0.25);
    }

    /// The channel the operator chose is the channel that is read, and the buffer is reused rather than regrown.
    #[test]
    fn only_the_chosen_channel_is_read() {
        // Two channels interleaved: the timecode is on the second, the first is silence.
        let interleaved: Vec<f32> = vec![0.0, 1.0, 0.0, -1.0, 0.0, 0.5];
        let mut out = Vec::new();
        take_channel_into(&interleaved, 2, 1, &mut out, f32_from_f32);
        assert_eq!(out, vec![1.0, -1.0, 0.5]);
        take_channel_into(&interleaved, 2, 0, &mut out, f32_from_f32);
        assert_eq!(out, vec![0.0, 0.0, 0.0]);
        // A block with more samples than whole frames: the partial frame is dropped rather than read across frames.
        let ragged: Vec<f32> = vec![1.0, 2.0, 3.0];
        take_channel_into(&ragged, 2, 1, &mut out, f32_from_f32);
        assert_eq!(out, vec![2.0]);
        // And the caller's buffer is reused, which is the whole point of the audio path taking it in.
        let capacity = out.capacity();
        take_channel_into(&interleaved, 2, 1, &mut out, f32_from_f32);
        assert_eq!(out.capacity(), capacity, "the buffer must not be reallocated per block");
    }

    /// **The decision a rate change makes, without a device.** Changing the selector on a stream that is already
    /// decoding at the chosen rate must not restart anything: a reopen drops the lock the show is following, and a
    /// page that re-sends the same rate (or a form that re-renders and fires `change`) must not cost the operator a
    /// stream. With nothing open there is nothing to restart either — the choice is what the next Listen will use.
    /// Only a stream open at a **different** rate is reopened, and that is the case the owner reported as doing
    /// nothing.
    #[test]
    fn the_rate_change_decision_restarts_only_a_running_stream_at_another_rate() {
        use TimecodeRate as Rate;
        // Nothing open: the rate is remembered for the next Listen, not applied to a device.
        assert_eq!(ltc_rate_change(None, Rate::Fps30), LtcRateChange::Idle);
        // Open at the rate the selector now reads: restarting would tear down a locked stream for no change.
        assert_eq!(ltc_rate_change(Some(Rate::Fps30), Rate::Fps30), LtcRateChange::AlreadyAtRate);
        // Open at another rate: this is the one answer that has to reach the device.
        assert_eq!(ltc_rate_change(Some(Rate::Fps25), Rate::Fps30), LtcRateChange::Reopen);
        // 29.97 and 30 count the same numbers a second but are different rates, so the change is real: drop-frame
        // numbering is not the same decode.
        assert_eq!(ltc_rate_change(Some(Rate::Fps29_97), Rate::Fps30), LtcRateChange::Reopen);
        assert_eq!(ltc_rate_change(Some(Rate::Fps30), Rate::Fps29_97), LtcRateChange::Reopen);
        // And an input that has been closed reports nothing open, so a change after Stop is Idle rather than a
        // reopen with no target.
        let input = LtcInput::default().handle();
        assert_eq!(input.open_facts(), None, "a closed input has no stream facts");
        assert_eq!(ltc_rate_change(input.open_facts().map(|facts| facts.rate), Rate::Fps30), LtcRateChange::Idle);
    }

    /// What the status line is built from: the rate the open stream decodes with, how long it has been open, and how
    /// many positions it has produced. The counter belongs to the **stream**, so a reopen starts it at zero again —
    /// which is what lets the page say "nothing has decoded since this stream opened".
    #[test]
    fn the_open_stream_reports_its_rate_and_what_it_has_decoded() {
        let input = LtcInput::default().handle();
        let current = Arc::new(AtomicU64::new(3));
        let status = Arc::new(LtcStreamStatus::new(3, Arc::clone(&current), TimecodeRate::Fps30));
        if let Ok(mut slot) = input.stream_guard_slot().lock() {
            *slot = Some(Arc::clone(&status));
        }
        let facts = input.open_facts().expect("an open stream has facts");
        assert_eq!(facts.rate, TimecodeRate::Fps30, "the facts name the rate the stream was opened with");
        assert_eq!(facts.decoded, 0, "a stream that has just opened has decoded nothing");
        // A stream that has never decoded is **not** stalled, whatever its age: that is the rate or the channel, and it
        // has its own sentence. Asserted on the real facts rather than only on the pure rule, because the caller is
        // where "never" could be turned into "stalled" by a `unwrap_or` and every other assertion here would still pass.
        assert_eq!(facts.data_age_ms, None, "a stream that has never decoded has no data age");
        assert!(!facts.stalled, "and it is not stalled, however long it has been open");
        status.record_positions(0);
        assert_eq!(input.open_facts().expect("still open").decoded, 0, "an empty block is not a position");
        assert_eq!(
            input.open_facts().expect("still open").data_age_ms,
            None,
            "and an empty block does not refresh the heartbeat either"
        );
        status.record_positions(2);
        assert_eq!(input.open_facts().expect("still open").decoded, 2, "every decoded position is counted");
        let after = input.open_facts().expect("still open");
        assert!(
            after.data_age_ms.is_some_and(|age| age < LTC_STALL_MS),
            "a position that has just arrived is a young age, not a stall: {after:?}"
        );
        assert!(!after.stalled, "and the stream is not stalled");
        status.record_positions(1);
        assert_eq!(input.open_facts().expect("still open").decoded, 3, "and the count accumulates");
        input.close();
        assert_eq!(input.open_facts(), None, "a closed stream reports no facts at all");
    }

    /// The two rules of the data-age heartbeat, as pure functions so they need no clock and no waiting.
    ///
    /// The distinction the whole feature turns on is here: a stream that has **never** decoded has no age at all and is
    /// never "stalled" — that fault is the rate or the channel, and it has its own sentence — while a stream that
    /// decoded once and then went quiet is exactly the case that used to read "Listening to …" for ever.
    #[test]
    fn a_stream_is_stalled_only_if_it_decoded_and_then_went_quiet() {
        assert_eq!(data_age_ms(30_000, None), None, "a stream that never decoded has no age");
        assert!(!is_stalled(None, LTC_STALL_MS), "and it is not stalled: that is the rate or the channel");
        assert_eq!(data_age_ms(30_000, Some(29_800)), Some(200), "a position 200 ms ago is an age of 200 ms");
        assert!(!is_stalled(Some(200), LTC_STALL_MS), "which is not a stall");
        assert_eq!(data_age_ms(30_000, Some(25_000)), Some(5_000));
        assert!(is_stalled(Some(5_000), LTC_STALL_MS), "five seconds of silence is");
        assert!(is_stalled(Some(LTC_STALL_MS), LTC_STALL_MS), "and the threshold itself counts as stalled");
        // The two reads disagree by a hair in real life — the age is read a moment after the open time was — and a
        // negative age would read as the future in a sentence shown to an operator.
        assert_eq!(data_age_ms(1_000, Some(1_002)), Some(0), "an age never goes backwards");
    }
}
