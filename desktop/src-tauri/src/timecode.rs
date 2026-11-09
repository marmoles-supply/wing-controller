// Phase T1's core, exercised by its own tests. Nothing in the application constructs a position yet — Phase T2 is
// what wires it to the page and the macro path — and this allows exactly that, in this module only, rather than
// leaving warnings that hide the next piece of dead code.

//! Timecode — the positions, their arithmetic, and MTC.
//!
//! Phase T1 of `docs/TIMECODE_PLAN.md`: the position type every source produces, and the decoder for **MTC**
//! (MIDI Time Code) — the transport that needs no new device and no new permission, because it arrives on a MIDI
//! port this application already speaks. LTC (the audio signal) comes later, and lands on the same position type;
//! that is the whole point of keeping this side source-agnostic.
//!
//! The arithmetic is the part that has to be right rather than approximately right: a cue is a position, and a
//! position that is a frame or two out is a cue that fires at the wrong moment. Drop-frame numbering in particular
//! is where hand-written timecode libraries go wrong, so its boundaries are pinned by tests.

use serde::{Deserialize, Serialize};

/// The rate the material runs at. The two fractional rates are real: 23.976 and 29.97 are what 24 and 30 became
/// when colour television needed them, and timecode counts their frames nominally while the clock does not.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimecodeRate {
    Fps24,
    Fps25,
    /// 30 frames per second, counted nominally, with drop-frame numbering.
    Fps29_97,
    Fps23_976,
    Fps30,
}

impl TimecodeRate {
    /// How many frame **numbers** a second holds. Drop-frame numbering still counts 30 numbers per second; what it
    /// skips is numbers, not frames.
    pub fn frames_per_second(self) -> u64 {
        match self {
            TimecodeRate::Fps24 | TimecodeRate::Fps23_976 => 24,
            TimecodeRate::Fps25 => 25,
            TimecodeRate::Fps29_97 | TimecodeRate::Fps30 => 30,
        }
    }

    /// True for the one rate where drop-frame numbering is a thing.
    pub fn supports_drop_frame(self) -> bool {
        matches!(self, TimecodeRate::Fps29_97)
    }

    /// The rate as MTC names it, and back. MTC's two-bit code is `00` 24, `01` 25, `10` 30-drop, `11` 30.
    pub fn from_mtc_code(code: u8) -> TimecodeRate {
        match code & 0b11 {
            0 => TimecodeRate::Fps24,
            1 => TimecodeRate::Fps25,
            2 => TimecodeRate::Fps29_97,
            _ => TimecodeRate::Fps30,
        }
    }

    pub fn to_mtc_code(self) -> u8 {
        match self {
            TimecodeRate::Fps24 => 0,
            TimecodeRate::Fps25 => 1,
            TimecodeRate::Fps29_97 => 2,
            TimecodeRate::Fps30 => 3,
            // 23.976 has no code of its own: it is carried as 24 and the receiver knows what it is following.
            TimecodeRate::Fps23_976 => 0,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            TimecodeRate::Fps24 => "24",
            TimecodeRate::Fps25 => "25",
            TimecodeRate::Fps29_97 => "29.97",
            TimecodeRate::Fps23_976 => "23.976",
            TimecodeRate::Fps30 => "30",
        }
    }
}

/// One timecode position.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TimecodePosition {
    pub hours: u32,
    pub minutes: u32,
    pub seconds: u32,
    pub frames: u32,
    pub rate: TimecodeRate,
    /// Whether the numbering skips frame numbers 0 and 1 at the start of each minute (except every tenth).
    pub drop_frame: bool,
}

impl TimecodePosition {
    /// A position, refused when it cannot exist: no 25th frame at 24 fps, `99` in a field, or drop-frame numbering
    /// on a rate that does not have it.
    pub fn new(
        hours: u32,
        minutes: u32,
        seconds: u32,
        frames: u32,
        rate: TimecodeRate,
        drop_frame: bool,
    ) -> Result<Self, String> {
        if minutes > 59 || seconds > 59 {
            return Err(format!("{hours:02}:{minutes:02}:{seconds:02} is not a time of day"));
        }
        if hours > 23 {
            return Err(format!("{hours} hours is not a time of day on a 24-hour clock"));
        }
        if frames >= rate.frames_per_second() as u32 {
            return Err(format!(
                "frame {} does not exist at {} fps (0 to {})",
                frames,
                rate.label(),
                rate.frames_per_second() - 1
            ));
        }
        if drop_frame && !rate.supports_drop_frame() {
            return Err(format!(
                "drop-frame numbering only exists at 29.97 fps, not at {}",
                rate.label()
            ));
        }
        // A drop-frame position whose number is one of the two that get skipped is not a position the clock can be
        // in, and accepting it would make every later comparison off by two frames.
        if drop_frame && seconds == 0 && frames < 2 && minutes % 10 != 0 {
            return Err(format!(
                "{};{:02} is a frame number drop-frame numbering skips",
                format!("{hours:02}:{minutes:02}:{seconds:02}"),
                frames
            ));
        }
        Ok(TimecodePosition {
            hours,
            minutes,
            seconds,
            frames,
            rate,
            drop_frame,
        })
    }

    /// How many frames a whole day of this rate holds, drop-frame included.
    ///
    /// A drop-frame day is **not** `24 * 3600 * 30`: 1 296 of its minutes drop two numbers each, so the frame count
    /// is 2 589 408 rather than 2 592 000. Normalising a frame count needs that number, not the naive one.
    pub fn frames_in_a_day(rate: TimecodeRate, drop_frame: bool) -> i64 {
        let per_second = rate.frames_per_second() as i64;
        let numbers = per_second * 60 * 60 * 24;
        if drop_frame {
            let minutes = 24 * 60;
            numbers - 2 * (minutes - minutes / 10)
        } else {
            numbers
        }
    }

    /// The position as a frame count in **its own** format, which is what comparisons and cues use.
    pub fn to_frames(self) -> i64 {
        self.to_frames_in(self.rate, self.drop_frame)
    }

    /// The same numbers, read in **another** format.
    ///
    /// A timecode label — `01:00:00:00` — is not a frame count until a format is chosen, and the format belongs to the
    /// **show**, not to the label: QLab declares the SMPTE format on the cue list and DiGiCo sets the frame rate in
    /// Setup, and neither stores one per event. Reading a cue's numbers in the source's format is what makes a cue mean
    /// the moment the operator sees on the source. Without it, a list written at 25 fps and followed at 30 put a 25 fps
    /// count (90 000) against a 30 fps one (108 000) and fired the cue ten minutes early.
    ///
    /// What drop-frame skips is **numbers**, not frames, and which numbers are skipped depends on the format being
    /// read: the same label read as drop-frame and as non-drop is two different frame counts, and that is the point.
    pub fn to_frames_in(self, rate: TimecodeRate, drop_frame: bool) -> i64 {
        let per_second = rate.frames_per_second() as i64;
        let per_minute = per_second * 60;
        let per_hour = per_minute * 60;
        let mut total = self.hours as i64 * per_hour
            + self.minutes as i64 * per_minute
            + self.seconds as i64 * per_second
            + self.frames as i64;
        if drop_frame {
            // Drop-frame skips two **numbers** at the start of every minute except every tenth: the count of
            // numbers is what has to be corrected, not the count of frames.
            let total_minutes = self.hours as i64 * 60 + self.minutes as i64;
            total -= 2 * (total_minutes - total_minutes / 10);
        }
        total
    }

    /// Whether these numbers can exist in another format.
    ///
    /// Frame 24 exists at 25 fps and not at 24, and drop-frame numbering skips numbers that therefore do not exist in
    /// it. A cue whose label cannot exist in the source's format is **reported**, never compared at a frame nobody
    /// wrote — a cue that fires somewhere the operator did not ask for is worse than one that does not fire.
    pub fn exists_in(self, rate: TimecodeRate, drop_frame: bool) -> bool {
        if self.frames >= rate.frames_per_second() as u32 {
            return false;
        }
        if drop_frame {
            if !rate.supports_drop_frame() {
                return false;
            }
            if self.seconds == 0 && self.frames < 2 && self.minutes % 10 != 0 {
                return false;
            }
        }
        true
    }

    /// A position from a frame count, the inverse of `to_frames`, drop-frame included.
    ///
    /// Two defects lived here and both were found by an exhaustive round-trip test rather than by reading:
    ///
    /// * a ten-minute drop-frame block was treated as 18 000 frames when it is **17 982** (1 800 numbers a minute, and
    ///   18 of them are skipped per block), so the conversion was wrong from the **second minute** of the day onward —
    ///   frame count 3 598 came back as `00:02:00;00` instead of `00:02:00;02`;
    /// * a negative total — a negative offset applied just after midnight — was decomposed with `/` and `%` and cast
    ///   to `u32`, which produced `00:00:00:4294967295`: a position that cannot exist, shown to an operator and
    ///   compared against cues.
    ///
    /// The clock is a day long, so a frame count outside it is the same moment on another day, and that normalisation
    /// is what makes the negative case land where it should. What drop-frame skips is **numbers**, not frames.
    pub fn from_frames(total: i64, rate: TimecodeRate, drop_frame: bool) -> TimecodePosition {
        let per_second = rate.frames_per_second() as i64;
        let per_minute = per_second * 60;
        let per_hour = per_minute * 60;
        let total = total.rem_euclid(Self::frames_in_a_day(rate, drop_frame));
        let number = if drop_frame {
            // A ten-minute block holds 10 minutes of numbers minus the 18 that are skipped; a minute inside one holds
            // 1 800 minus the 2 that are skipped. The first two frames of a block are the numbers 0 and 1 of a tenth
            // minute, which are never skipped.
            let frames_per_ten_minutes = per_minute * 10 - 18;
            let frames_per_dropping_minute = per_minute - 2;
            let blocks = total / frames_per_ten_minutes;
            let rest = total % frames_per_ten_minutes;
            if rest < 2 {
                total + 18 * blocks
            } else {
                total + 18 * blocks + 2 * ((rest - 2) / frames_per_dropping_minute)
            }
        } else {
            total
        };
        let hours = number / per_hour;
        let rest = number % per_hour;
        let minutes = rest / per_minute;
        let rest = rest % per_minute;
        let seconds = rest / per_second;
        let frames = rest % per_second;
        TimecodePosition {
            hours: hours as u32,
            minutes: minutes as u32,
            seconds: seconds as u32,
            frames: frames as u32,
            rate,
            drop_frame,
        }
    }

    /// The position as an operator writes it: `01:00:12:15`, and with a semicolon before the frames when the
    /// numbering is drop-frame, which is the convention every timecode tool uses.
    pub fn describe(self) -> String {
        format!(
            "{:02}:{:02}:{:02}{}{:02}",
            self.hours,
            self.minutes,
            self.seconds,
            if self.drop_frame { ";" } else { ":" },
            self.frames
        )
    }

    /// Read a position in that same notation, or say what is wrong with it.
    pub fn parse(text: &str, rate: TimecodeRate) -> Result<Self, String> {
        let trimmed = text.trim();
        if trimmed.len() < 11 {
            return Err(format!("'{trimmed}' is not a timecode position (try 01:00:12:15)"));
        }
        let separator = if trimmed.contains(';') { ';' } else { ':' };
        let drop_frame = separator == ';';
        let fields: Vec<&str> = trimmed.split([':', ';']).collect();
        if fields.len() != 4 {
            return Err(format!(
                "'{trimmed}' has {} parts; a position has four (hours, minutes, seconds, frames)",
                fields.len()
            ));
        }
        let number = |value: &str, what: &str| -> Result<u32, String> {
            value
                .trim()
                .parse::<u32>()
                .map_err(|_| format!("'{value}' is not a number for the {what}"))
        };
        TimecodePosition::new(
            number(fields[0], "hours")?,
            number(fields[1], "minutes")?,
            number(fields[2], "seconds")?,
            number(fields[3], "frames")?,
            rate,
            drop_frame,
        )
    }
}

impl PartialOrd for TimecodePosition {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for TimecodePosition {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Compared as frame counts: that is what makes a cue point a place rather than a set of four numbers, and it
        // is why the arithmetic above exists at all.
        self.to_frames().cmp(&other.to_frames())
    }
}

// MIDI Association, Complete MIDI 1.0 Detailed Specification, Doc 4.2 pp. 1–5:
// MTC fields are binary (LTC's decimal digits do not apply); QF piece 7 is 0rrh.
// Lesson from the 2026-10-27 audit: a sender/receiver round trip hid the same BCD
// error on both sides. Independent published wire vectors are the authority.
/// One quarter-frame message: three bits of type and four bits of data, which is what `0xF1` carries.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct QuarterFrame {
    pub piece: u8,
    pub data: u8,
}

impl QuarterFrame {
    /// Read an `0xF1` message, or refuse it: the data byte is the message's only argument and it must be there.
    pub fn from_message(bytes: &[u8]) -> Option<QuarterFrame> {
        if bytes.len() < 2 || bytes[0] != 0xF1 {
            return None;
        }
        let byte = bytes[1];
        // The high bit of the data byte must be clear: a quarter-frame's data is seven bits, and a set bit there
        // means this is not the message it claims to be.
        if byte & 0x80 != 0 {
            return None;
        }
        Some(QuarterFrame {
            piece: (byte >> 4) & 0b111,
            data: byte & 0b1111,
        })
    }
}

/// The eight quarter frames of one position, gathered.
///
/// A position is only produced when the whole set has arrived **in a valid order**: a half-set of quarter frames
/// assembled anyway is a position that is wrong in the frames or the seconds, and a wrong position fires the wrong
/// cue. The assembler therefore reports nothing until it is sure, which is the same rule the rest of this project
/// uses for values that arrive over a network.
#[derive(Debug, Default)]
pub struct MtcAssembler {
    seen: [u8; 8],
    count: u8,
    last_piece: u8,
    direction: i64,
    last_at: Option<std::time::Instant>,
}

impl MtcAssembler {
    pub fn new() -> Self { Self::default() }

    #[cfg(test)]
    pub fn push(&mut self, frame: QuarterFrame) -> Option<TimecodePosition> {
        self.push_at(frame, std::time::Instant::now())
    }

    pub fn push_at(&mut self, frame: QuarterFrame, now: std::time::Instant) -> Option<TimecodePosition> {
        // A missing/reordered piece or a paused partial cycle must not mix two times.
        // 100 ms is over nine QF intervals at the slowest supported rate.
        let stale = self.last_at.map(|at| now.saturating_duration_since(at)
            > std::time::Duration::from_millis(100)).unwrap_or(false);
        let mask = match frame.piece { 1 => 1, 3 | 5 => 3, 7 => 7, 0 | 2 | 4 | 6 => 15, _ => 0 };
        if frame.piece > 7 || frame.data & !mask != 0 {
            *self = Self::default();
            return None;
        }
        let expected = (self.last_piece as i64 + self.direction).rem_euclid(8) as u8;
        if stale || (self.count > 0 && frame.piece != expected) { self.count = 0; }
        if self.count == 0 {
            self.direction = match frame.piece { 0 => 1, 7 => -1, _ => return None };
        }
        self.seen[frame.piece as usize] = frame.data;
        self.last_piece = frame.piece;
        self.last_at = Some(now);
        self.count += 1;
        if self.count != 8 { return None; }
        self.count = 0;
        let d = self.seen;
        let rate = TimecodeRate::from_mtc_code((d[7] >> 1) & 3);
        let position = TimecodePosition::new(
            (d[6] | ((d[7] & 1) << 4)) as u32,
            (d[4] | (d[5] << 4)) as u32,
            (d[2] | (d[3] << 4)) as u32,
            (d[0] | (d[1] << 4)) as u32, rate, rate == TimecodeRate::Fps29_97,
        ).ok()?;
        // Eight quarter frames take two frames. MMA Doc 4.2 requires the receiver
        // to compensate in the direction of travel; locate/full-frame has no delay.
        Some(TimecodePosition::from_frames(position.to_frames() + 2 * self.direction, rate, position.drop_frame))
    }

    /// Take a full-frame message, which MTC carries as SysEx:
    /// `F0 7F 7F 01 01 hr mn se fr F7`.
    pub fn push_full_frame(&mut self, bytes: &[u8]) -> Option<TimecodePosition> {
        // `7F 7F` is "all devices, all channels"; `01 01` is the full-frame message. Anything else is SysEx for
        // somebody else, and this decoder must not guess at it.
        // Exactly this shape: the SysEx terminator is part of the message, and a longer tail is somebody else's
        // bytes. Parsing the prefix of a malformed packet invents a position out of nothing, which is worse than
        // refusing it — a rejected message shows up in the "malformed" count, an invented one becomes a cue.
        if bytes.len() != 10
            || bytes[0] != 0xF0
            || bytes[1] != 0x7F
            || bytes[3] != 0x01
            || bytes[4] != 0x01
            || bytes[9] != 0xF7
            || bytes[2..9].iter().any(|byte| byte & 0x80 != 0)
        {
            return None;
        }
        let rate_code = bytes[5] >> 5;
        let rate = TimecodeRate::from_mtc_code(rate_code);
        let drop_frame = rate == TimecodeRate::Fps29_97;
        let position = TimecodePosition::new(
            (bytes[5] & 0b0001_1111) as u32,
            bytes[6] as u32,
            bytes[7] as u32,
            bytes[8] as u32,
            rate,
            drop_frame,
        )
        .ok()?;
        *self = Self::default();
        Some(position)
    }
}



/// How the cue list is laid out for the operator.
///
/// This travels **with the show**, in the same file as the cues, rather than in a window's `localStorage`: the same
/// file opened on another Mac must come back in the order the show was built in, and a layout that only one window
/// remembers is a layout that is lost the moment the file travels.
///
/// `Smpte` is the default, and it is the default **on disk**: a file written before this field existed has no `sort`
/// key, and it must load as `Smpte` rather than being refused. That is what `#[serde(default)]` on the field buys,
/// and it is why the schema version did not have to move for this.
///
/// `Manual` is the list's own order **as stored in the file** — deliberately not a separate `sort_key` per cue: the
/// file's order already is the manual order, and a second key could disagree with it. Nothing here changes when a
/// cue fires: the engine fires by position and the tie is broken by the list's order, whatever this says.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CueSortMode {
    /// By the position each cue fires at, which is what a show reads like.
    Smpte,
    /// The order the cues appear in, which is the order the operator moved them into.
    Manual,
    /// The order the cues were added in.
    Created,
}

impl Default for CueSortMode {
    fn default() -> Self {
        // Not a coin toss: a list nobody has rearranged is a list that reads by time, and every file written before
        // this field existed is one of those.
        CueSortMode::Smpte
    }
}

/// How a list is driven: by the show clock, or by the operator stepping through it.
///
/// The mode belongs to the **list**, never to a row: a cue that waits for the clock and a cue that follows its
/// predecessor in one list would make "when does this fire?" a question about a mode nobody can see from the row.
/// A cue therefore stores both of its answers — the time it names and the duration that follows it — so switching the
/// mode never loses what the operator typed.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CueDrive {
    /// Cues fire when the incoming clock crosses the time each one names. What the list has always done.
    #[default]
    Timecode,
    /// Cues fire in **list order**, and each cue's `duration_ms` decides when the next one is due — measured on the
    /// show clock, not on a wall clock and not by a timer of the application's own.
    ///
    /// That distinction is the whole design: the sequence advances with the timecode, so a rehearsal that pauses the
    /// clock pauses the sequence, a stale signal cannot advance it, and nothing here needs a thread, a timer, or a
    /// window to be open. It is also why a duration never **waits** for a macro: a macro cannot say it has finished,
    /// and a sequence that waited for one would stop at the first step that took longer than its duration.
    Sequential,
}

/// What happens when the show reaches a cue again.
///
/// One boolean forced an operator to guess which of three behaviours he would get, and the three are genuinely
/// different in a rehearsal: a cue that has already happened may be wanted again when a section is re-run, and a cue
/// that must happen **once in the show** — the opening announcement, a one-off command — must not happen again because
/// somebody went back to rehearse ten minutes of it.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CueRepeat {
    /// Fires once per **pass**: going back re-arms it. This is what `repeats: false` always meant.
    #[default]
    Pass,
    /// Fires every time the position crosses it. This is what `repeats: true` always meant.
    Every,
    /// Fires **once in the show**: going back does not re-arm it.
    Show,
}

/// One cue: a position, and the macro it fires.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TimecodeCue {
    pub id: String,
    /// The number the operator sees and says out loud — "go to 12", "5.5 next" — and it is deliberately **not**
    /// `id`: the id is the backend's handle and the address anything outside this window may fire a cue by, and it
    /// is never shown. The number is the show's own label for the cue, stored **with** the cue so it never depends
    /// on where the cue sits in the list: reordering never moves it, and renumbering rewrites numbers only, never
    /// an id — which is what keeps a firing from outside working while the operator renumbers.
    ///
    /// It is a **decimal**, not an integer, because that is what every console that numbers cues does — Hog 4
    /// (`11111.1111`), Titan (a cue inserted between 2 and 3 is `2.5`) and MagicQ's cue id (`1.00`) — and for the
    /// reason they do it: a cue inserted between 5 and 6 is numbered 5.5 and **nothing else moves**. An integer
    /// would force a renumber of the whole list on every insertion, which is exactly what renumbering must not do.
    ///
    /// `""` means "not numbered yet". That is what every file written before this field existed says, and what a
    /// newly added cue says until the operator numbers it: the backend never invents one, because the gap a new cue
    /// belongs in (5.5 between 5 and 6) is the operator's to choose, not this build's to guess.
    ///
    /// JSON can write a decimal as text or as a number, so both are read here (`12` and `"12"` are the same cue
    /// number); what is stored is the canonical decimal (`canonical_cue_number`).
    #[serde(default, deserialize_with = "deserialize_cue_number")]
    pub number: String,
    /// The optional group this cue belongs to — a free name like "Act 1" or "Version B".
    ///
    /// A **name**, not a page index, for the reason the addendum's §7.1 rejected `sort_key`: an index is a second
    /// ordering that can contradict `cues[]`, and a page table is a registry an imported file would have to carry —
    /// a list whose groups do not exist here would arrive pointing at page 3 of a document that has two. A name
    /// carries no ordering and needs no registry: a group exists exactly when a cue carries it, and importing a
    /// list with groups that are unknown here simply brings those names with it.
    ///
    /// Empty means ungrouped, and grouping changes nothing about what fires: it is a label for the operator, never
    /// an address.
    #[serde(default)]
    pub group: String,
    pub at: TimecodePosition,
    /// The macro that fires, named by its **own key** in the library the window owns — never by its place there.
    ///
    /// `None` is a cue whose macro has not been chosen yet: it exists, it is listed, it is marked spent when crossed,
    /// and it fires **nothing** — and the event says so, rather than firing the first macro in the library because
    /// nobody chose one.
    ///
    /// This is what makes the reference survive a reorder. A key travels with the macro, so inserting, moving or
    /// deleting in the library cannot silently re-point the cue at a neighbour; a key that no longer exists is
    /// reported as [`CueProblem::MacroMissing`] instead of resolving to whoever took that place in the list.
    #[serde(default)]
    pub macro_id: Option<String>,
    /// The older, **positional** reference, kept only so a file written before macros had keys can be read.
    ///
    /// A cue this build writes carries `macro_id` and leaves this empty: two stored references to one macro is the
    /// second authority this project keeps removing. It is read, migrated once against the library the window
    /// reports, and then dropped.
    #[serde(default)]
    pub macro_index: Option<usize>,
    /// The **content hash** the macro had when this cue last named it, or `None` for a cue written before this existed.
    ///
    /// It is a record, not a reference: the cue still fires the macro it names whatever the hash says, and the only thing
    /// the hash is used for is the health's note "this macro has changed since this cue named it". The precedent is
    /// already in this struct — `note` holds the macro's name *as it was then*, and nothing acts on it either.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub macro_hash: Option<String>,
    /// A cue that stays armed and fires again every time it is crossed. Off by default: a show's cues fire once.
    ///
    /// This is the older, single-boolean answer, kept so a file written before the three policies existed loads. The
    /// rule that reads it lives in [`TimecodeCue::repeat_policy`] and nowhere else.
    #[serde(default)]
    pub repeats: bool,
    /// What happens when the show reaches this cue **again**: one of three answers rather than a boolean's two.
    ///
    /// `None` means the file predates them, and `repeat_policy` is the one place that reads the old boolean for it —
    /// so the engine, the window and the file's own normalisation cannot disagree about what an older cue meant.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat: Option<CueRepeat>,
    /// How long after this cue the next one is due in **sequential** drive, in milliseconds.
    ///
    /// `None` is a cue the sequence waits at: the operator's Go is what moves it on. Milliseconds and not frames
    /// because a duration is a length of time, and expressing it in frames would tie it to the frame rate — a second
    /// authority over one fact, which is what this project keeps removing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default = "default_cue_enabled")]
    pub enabled: bool,
    /// The operator's own name for this cue — "Door", "Rain" — and it is deliberately **not** `note`.
    ///
    /// `note` is written by the macro editor the moment a cue is created and holds the *macro's* name as it was
    /// then, so editing it to name a cue would overwrite a copy of a macro name with something else, and renaming
    /// the macro would leave the copy behind. This field exists to be typed by the operator: free text, never
    /// interpreted, empty when nobody has named the cue — and it is what a row shows when it is there.
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub note: String,
}

/// Read a cue number that arrives as JSON text **or** as a JSON number.
///
/// A cue number is a decimal, and JSON has two ways to write one: a window that kept the operator's typing as text
/// sends `"12.5"`, and one that parsed it sends `12.5`. Both mean the same cue number, so both are read here —
/// making one of them a save that fails with "invalid type" would be this build inventing a difference the show
/// does not have.
fn deserialize_cue_number<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    match value {
        None | Some(serde_json::Value::Null) => Ok(String::new()),
        Some(serde_json::Value::String(text)) => Ok(text),
        // A JSON number is a decimal by construction; `to_string` is the shortest form that round-trips, and
        // `canonical_cue_number` then reduces it to the stored form.
        Some(serde_json::Value::Number(number)) => Ok(number.to_string()),
        Some(other) => Err(serde::de::Error::custom(format!(
            "a cue number must be a decimal written as text or as a number, not {other}"
        ))),
    }
}

/// The stored form of a cue number, or `None` when the text is not a decimal.
///
/// The stored form is the **canonical** decimal: no leading zeros in the whole part and no trailing zeros in the
/// fraction, so `"007"` is `"7"` and `"1.50"` is `"1.5"`. Canonical form is what makes "two cues share a number" a
/// string comparison, which is the uniqueness a visible number exists for: without it `7` and `007` would be one
/// cue under two labels, and "go to cue 7" would be ambiguous.
///
/// This is a grammar, not a range: any number of digits is a number (Hog caps at five before the decimal and four
/// after, but such a cap would be this build inventing a limit the show does not have).
pub fn canonical_cue_number(number: &str) -> Option<String> {
    let text = number.trim();
    let (whole, fraction) = match text.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (text, None),
    };
    if whole.is_empty() || !whole.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let fraction = match fraction {
        None => None,
        Some(fraction) => {
            if fraction.is_empty() || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
                return None;
            }
            let trimmed = fraction.trim_end_matches('0');
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
    };
    // The whole part keeps no leading zeros: "007" is seven, and "0" is zero rather than nothing.
    let whole = whole.trim_start_matches('0');
    let whole = if whole.is_empty() { "0" } else { whole };
    Some(match fraction {
        Some(fraction) => format!("{whole}.{fraction}"),
        None => whole.to_string(),
    })
}

fn default_cue_enabled() -> bool {
    true
}

impl TimecodeCue {
    /// The policy in force, with the older boolean read **here and nowhere else**.
    ///
    /// A rule written twice is a rule that drifts, and this one decides whether a cue fires again: the engine, the
    /// windows and the save path all ask this rather than testing `repeat` or `repeats` themselves.
    pub fn repeat_policy(&self) -> CueRepeat {
        self.repeat.unwrap_or(if self.repeats { CueRepeat::Every } else { CueRepeat::Pass })
    }
}

/// One line of a **rehearsal plan**: what the list would have fired, where the engine was when it decided, and how far
/// that is from the time the cue names.
///
/// The delta is the reason Monitor is worth having at all: it is how late the incoming timecode was at the moment of
/// the crossing, in **frames**, which is the diagnostic an operator compares against the programmed times. It is `None`
/// where a difference has no meaning — a cue a seek jumped over was never crossed at a position, so there is nothing to
/// subtract, and a zero there would read as a perfectly timed crossing.
#[derive(Clone, Debug, Serialize)]
pub struct RehearsalEntry {
    /// A running number, so a window can tell the newest line from the ones it has already painted.
    pub seq: u64,
    /// `fired`, `skipped` or `rearmed`.
    pub kind: String,
    pub id: String,
    /// The cue's own label, as the row shows it.
    pub at: String,
    /// Where the engine was when it produced this line, as the operator writes a position.
    pub position: String,
    /// `position - at`, in frames, for a cue that **fired**; `None` for anything else.
    pub delta_frames: Option<i64>,
}

/// How many rehearsal lines are kept. A rehearsal is read while it runs and compared afterwards, so the plan is a
/// **window** over what happened rather than a whole show's log — and a window is what keeps a long rehearsal from
/// growing in memory without bound.
pub const REHEARSAL_PLAN_LIMIT: usize = 64;

/// The wall-clock silence above which a jump is read as **the signal having gone**, not as the show having moved.
///
/// Stated once, here, because it is the whole of the rule that separates a dropout from a seek: see
/// [`CueList::arrival_gap_threshold_ms`] for why it is a time rather than a distance, and why half a second.
pub const ARRIVAL_GAP_THRESHOLD_MS: u64 = 500;

/// What feeding a position caused.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CueEvent {
    /// The position played into a cue: it fires.
    Fired {
        id: String,
        at: String,
        /// The macro's own key, when the cue has one. The window fires **this**, so what runs is the macro the cue
        /// names and not whoever occupies its old place in the library.
        macro_id: Option<String>,
        /// The legacy positional reference, carried only while a cue has not been migrated yet: a window that
        /// receives it fires by it exactly as before. Once a cue carries `macro_id`, this is `None`.
        macro_index: Option<usize>,
    },
    /// The position was **seeked** past a cue: it does not fire, and it is named — a skipped scene that leaves no
    /// trace is how an operator loses twenty minutes of a rehearsal wondering what happened.
    ///
    /// **Why this carries two more numbers than it used to.** A cue crossed by a jump and a cue crossed while the
    /// signal was gone used to produce the *identical* event and the identical line on screen, so an operator could
    /// not tell "the show was moved" from "the timecode stopped arriving and then came back somewhere else" — and the
    /// second one is a fault to go and look at, not a decision anybody made. The distinction is not in the positions:
    /// a one-second dropout and a deliberate one-second seek differ only in **how long nothing arrived**, which only
    /// the door that timestamps arrivals can see.
    Skipped {
        id: String,
        at: String,
        /// How far the position jumped, in milliseconds. Always present: a `Skipped` is a jump by definition.
        jumped_ms: u64,
        /// The wall-clock gap between this arrival and the previous one, when there **was** a previous one.
        ///
        /// `None` means *no previous arrival was measured* — the first position after a list is installed, or a
        /// source that has just been opened. That is a **different sentence** from "nothing arrived", and it is the
        /// whole reason this is not a plain `u64`: a window must be able to say the position jumped without inventing
        /// a silence it never observed.
        arrival_gap_ms: Option<u64>,
        /// **The answer, not the inputs.** True when the silence before this arrival was long enough that the position
        /// moving is better explained by the signal having gone than by anybody having seeked.
        ///
        /// It is decided **here** and not by the reader, and that is deliberate: the threshold is one number, it lives
        /// beside the engine, and a window that compared `arrival_gap_ms` against its own copy of it would be the
        /// second copy of a rule — which is the defect this repository has already paid for once
        /// (`AGENTS.md`, *A Rule Written By Hand In Several Places Will Drift*). The window reads a verdict; it does
        /// not hold the policy.
        across_silence: bool,
    },
    /// The position moved backwards: these cues are armed again and will fire when the show reaches them.
    Rearmed { count: usize, position: String },
}

/// What the **window** did with one cue order.
///
/// The engine knows a cue was crossed; only the window knows whether the macro ran — the library, the padlock and
/// the console write all live there. So the window reports the outcome back, and the backend counts it: that is what
/// turns "the macro did not run" from an absence nobody can read into a number the operator can see.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CueOutcome {
    /// The order was carried out: the macro ran, or a skipped/re-armed notice was shown to the operator.
    Delivered,
    /// Live Safe Mode refused to fire. The operator's own padlock — and the window says so out loud.
    Blocked,
    /// There was nothing to fire: no macro chosen for the cue, or the macro it names is no longer in the library.
    Nothing,
    /// The macro was attempted and did not complete.
    Failed,
    Cancelled,
    Dropped,
    Superseded,
    /// Execution completed but at least one console write was not confirmed.
    Unconfirmed,
}

/// How many as-run lines are kept.
///
/// **Stated rather than shrugged**, and chosen from the shape of the thing being recorded: a cue show is tens to a
/// couple of hundred cues and each fires about once per pass, so 2 000 covers several complete performances at
/// roughly 120 bytes a line — a couple of hundred kilobytes, which is a file an operator can open and read.
/// The counter-example that would overturn it: a show long enough that 2 000 does not cover one performance, which
/// makes the bound a correctness problem rather than a housekeeping one, and the answer then is a rolling file per
/// show rather than a bigger number.
pub const AS_RUN_LINES: usize = 2_000;

/// How many unsaved lines make a flush due.
///
/// A bound on **loss**, not on cost: 32 events is under a second of a busy cue list, so a hard kill can lose less
/// than that however long the show runs.
pub const AS_RUN_FLUSH_AFTER: usize = 32;

/// How long the oldest unsaved line may wait before the next opportunity flushes it.
///
/// The other half of the bound, and it is a **time since the oldest unsaved line** rather than a ticker of its own:
/// the check rides an opportunity that already exists (the transports' own loops, a save, a clean exit), so this
/// design adds no thread and no timer to a program whose cue engine is built on there being one place that runs.
/// Five seconds is the most of a show a hard kill can lose when the cue list is quiet.
pub const AS_RUN_INTERVAL_MS: u64 = 5_000;

/// Wall-clock milliseconds since the epoch, for the as-run record.
///
/// A **person** reads this record, so it is the clock on the wall rather than the engine's monotonic `Instant`: "the
/// cue fired at 21:14:07" is a sentence somebody can check against a rehearsal note, and an `Instant` is not.
/// A clock set before 1970 returns `0` rather than panicking, because a broken clock must not stop a show.
fn wall_clock_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

/// The cue an event is about, or `""` for one that is about none.
///
/// A `Rearmed` is about the **list**, not a cue, and that is why it answers with nothing: the as-run record leaves
/// re-arms out entirely, and this is the one place that decides which events name a cue.
fn event_id(event: &CueEvent) -> &str {
    match event {
        CueEvent::Fired { id, .. } | CueEvent::Skipped { id, .. } => id,
        CueEvent::Rearmed { .. } => "",
    }
}

/// One line of the as-run record: what the engine did with one cue, and what the window then said about it.
///
/// It is the answer to a question the counters cannot answer — *"which cue fired at 21:14:07, and where was the
/// show?"* — and it survives a restart, which the engine's in-memory `spent` marks deliberately do not.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AsRunLine {
    /// The ledger's own sequence number, which is how the window's later confirmation finds this line again.
    pub seq: u64,
    pub id: String,
    /// The name an operator says out loud, so a printed record can be read against a cue list.
    pub number: String,
    /// The position the cue fires at, in the source's format.
    pub at: String,
    /// `fired` or `skipped`. The engine's decision, made once and never revisited.
    pub spent: String,
    /// Wall-clock milliseconds since the epoch: when the engine decided, not when a window happened to read it.
    pub wall_ms: u64,
    /// What the window did with the order. **`None` means "not confirmed yet"** — the engine decided and nobody has
    /// said what happened, which is a different sentence from `nothing` and must not be written as one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<CueOutcome>,
    /// The two facts a skip carries, so the record explains itself without the window's wording: a line that said
    /// only `skipped` would put a dropout and a deliberate seek back to looking the same on paper.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub across_silence: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jumped_ms: Option<u64>,
    /// **How long nothing was arriving, for the skip that was a dropout** — the number the row marks and the history
    /// line have always shown and the RECORD did not carry, so the last-run view could say "the timecode had stopped
    /// arriving" and never say for how long. It was found by making a suite's stub faithful: the stub had invented this
    /// field, so the contract asserted a sentence the record could not produce. With it here the record explains itself
    /// as completely as the live surfaces do, and `skipReason` reads one shape from every producer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrival_gap_ms: Option<u64>,
}

/// The as-run record in memory, and when it is due to be written.
///
/// **Nothing here touches a file**, and that is the whole design: this engine does no I/O at all, so it decides
/// *when* the record is due and hands the lines to its host, which knows the path and owns the recovery-copy helper.
/// The same shape as `position_sink` and `cue_sink` — the engine owns the decision, the host owns the side effect.
///
/// **Why the writes are not per event.** The firing path runs once per timecode frame; a disk in the middle of it
/// would make the frame budget depend on a filesystem. So a line is **appended** there (a `VecDeque` push) and the
/// record is **flushed out of it**, bounded twice over — by count and by time — and never on a retry of its own.
#[derive(Debug, Default)]
pub struct AsRunRecord {
    lines: std::collections::VecDeque<AsRunLine>,
    /// Lines appended since the last flush. `0` means everything on disk.
    unsaved: usize,
    revision: u64,
    /// When the **oldest** unsaved line was appended, which is what the interval is measured from.
    oldest_unsaved: Option<std::time::Instant>,
}

impl AsRunRecord {
    /// Put the record back at startup, from what the previous run left.
    pub fn restore(&mut self, lines: Vec<AsRunLine>) {
        self.lines = lines.into_iter().collect();
        while self.lines.len() > AS_RUN_LINES {
            self.lines.pop_front();
        }
        // Restored lines are **already on disk**, so nothing is due: a boot that immediately wrote what it had just
        // read would rewrite the same file on every start and call it progress.
        self.unsaved = 0;
        self.oldest_unsaved = None;
    }

    /// Append one decision. Called on the firing path, so it does the least possible: a push and a counter.
    pub fn append(&mut self, seq: u64, event: &CueEvent, wall_ms: u64, number: &str) {
        let (id, at, spent, across_silence, jumped_ms, arrival_gap_ms) = match event {
            CueEvent::Fired { id, at, .. } => (id.clone(), at.clone(), "fired", None, None, None),
            CueEvent::Skipped { id, at, jumped_ms, across_silence, arrival_gap_ms, .. } => {
                (
                    id.clone(),
                    at.clone(),
                    "skipped",
                    Some(*across_silence),
                    Some(*jumped_ms),
                    *arrival_gap_ms,
                )
            }
            // A re-arm is not a cue being spent: it is the list being put back, and it has no id of its own. It is
            // deliberately not a line, because a record of "what ran" that filled up with "and then nothing ran"
            // would push the lines an operator needs out of the bound.
            CueEvent::Rearmed { .. } => return,
        };
        self.lines.push_back(AsRunLine {
            seq,
            id,
            number: number.to_string(),
            at,
            spent: spent.to_string(),
            wall_ms,
            outcome: None,
            across_silence,
            jumped_ms,
            arrival_gap_ms,
        });
        while self.lines.len() > AS_RUN_LINES {
            self.lines.pop_front();
        }
        if self.unsaved == 0 {
            self.oldest_unsaved = Some(std::time::Instant::now());
        }
        self.unsaved += 1;
        self.revision = self.revision.wrapping_add(1);
    }

    /// Record what the window said about an order, on the line that order produced.
    ///
    /// Keyed by the ledger's sequence number, so a confirmation that arrives after the line has been pushed out of
    /// the bound simply finds nothing — which is a lost detail on a record old enough to have been evicted, and not
    /// an error to shout about.
    pub fn settle(&mut self, seq: u64, outcome: CueOutcome) {
        if let Some(line) = self.lines.iter_mut().find(|line| line.seq == seq) {
            line.outcome = Some(outcome);
            // A settled line is a change to what is on disk, so the flush is due again — otherwise a confirmation
            // arriving after a flush would sit in memory until the NEXT cue happened to make the record dirty.
            if self.unsaved == 0 {
                self.oldest_unsaved = Some(std::time::Instant::now());
            }
            self.unsaved += 1;
        self.revision = self.revision.wrapping_add(1);
        }
    }

    /// Is a flush due, by either bound? Count first, because it is the cheaper question and it fires far more often
    /// on a busy list.
    pub fn due(&self, now: std::time::Instant) -> bool {
        if self.unsaved == 0 {
            return false;
        }
        if self.unsaved >= AS_RUN_FLUSH_AFTER {
            return true;
        }
        self.oldest_unsaved
            .map(|oldest| now.saturating_duration_since(oldest).as_millis() >= AS_RUN_INTERVAL_MS as u128)
            .unwrap_or(false)
    }

    /// A snapshot is only clean after the host confirms that exact revision reached disk.
    pub fn batch(&self, now: std::time::Instant, force: bool) -> Option<(u64, Vec<AsRunLine>)> {
        if self.unsaved == 0 || (!force && !self.due(now)) { return None; }
        Some((self.revision, self.lines.iter().cloned().collect()))
    }
    pub fn acknowledge(&mut self, revision: u64) {
        if revision == self.revision { self.unsaved = 0; self.oldest_unsaved = None; }
    }

    /// The lines as they stand, for a reader that is not a flush: the counts a window shows and the tests.
    pub fn lines(&self) -> &std::collections::VecDeque<AsRunLine> {
        &self.lines
    }
}

/// One cue event with the receipt the window settles it by.
///
/// The sequence number is what makes the hand-over **confirmed** rather than fire-and-forget: the window sends it
/// back when the order has been dealt with, and until it does the event is still `fired_unconfirmed`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StampedCueEvent {
    pub seq: u64,
    pub event: CueEvent,
}

/// How many fired events may wait for the window to confirm them.
///
/// A cue list is fired by a show, not by a storm: a seek across a whole list names every cue it crossed, so this is
/// far larger than any real crossing and far smaller than "grow without bound on a window that stopped answering".
pub const CUE_PENDING_CAPACITY: usize = 512;

/// The record of what the engine fired and what the window has confirmed — the part that must not be lost.
///
/// The engine marks a cue spent the moment it is crossed, and it has to: the show is moving and the cue must not
/// fire twice. But "the engine decided" is not "the macro ran". So the decision is written here, **before** any
/// hand-over is attempted, and it stays here until the window confirms what it did with it. A hand-over that is
/// refused (a full channel, a window that is still booting, a window that is not listening at all) therefore
/// becomes a **retry and a count**, never a silent loss — which is the defect this ledger exists to close.
#[derive(Debug, Default)]
pub struct CueDeliveries {
    next_seq: u64,
    pending: Vec<StampedCueEvent>,
    /// Orders the engine produced (the events that carry a macro).
    orders: u64,
    /// Orders the window confirmed it carried out.
    delivered: u64,
    /// Orders Live Safe Mode refused.
    blocked: u64,
    /// Orders with nothing to fire (no macro chosen, or the macro is not in the library).
    nothing: u64,
    /// Orders whose macro was attempted and failed.
    failed: u64,
    cancelled: u64,
    dropped: u64,
    unconfirmed_writes: u64,
    /// Hand-overs a full channel refused: the events were retried from `pending`, never dropped.
    deferred: u64,
    /// Events this ledger itself had to refuse because it was full. The only true loss, and it is always counted.
    lost: u64,
}

impl CueDeliveries {
    /// Record an event the engine produced, and return the stamped event it will be settled by.
    ///
    /// `Err(())` means the ledger is full. That is a real loss and the caller must count it as one rather than
    /// growing this list without bound on a window that never confirms.
    fn record(&mut self, event: CueEvent) -> Result<StampedCueEvent, ()> {
        if self.pending.len() >= CUE_PENDING_CAPACITY {
            self.lost += 1;
            return Err(());
        }
        let Some(next) = self.next_seq.checked_add(1) else { self.lost += 1; return Err(()); };
        self.next_seq = next;
        if matches!(event, CueEvent::Fired { .. }) {
            self.orders += 1;
        }
        let stamped = StampedCueEvent { seq: self.next_seq, event };
        self.pending.push(stamped.clone());
        Ok(stamped)
    }

    /// A hand-over the channel refused. The event stays pending, so this is a retry, not a loss — and it is counted
    /// so an operator can see that the window is not keeping up rather than merely that a cue did not fire.
    fn record_deferred(&mut self) {
        self.deferred += 1;
    }

    /// Settle one receipt with what the window did. Returns false when it was not pending (already settled, or
    /// never ours), which is not an error: a duplicate confirmation is what a retried hand-over produces.
    fn settle(&mut self, seq: u64, outcome: CueOutcome) -> bool {
        let Some(index) = self.pending.iter().position(|entry| entry.seq == seq) else {
            return false;
        };
        let entry = self.pending.remove(index);
        // Only a cue that carried a macro is an **order**: a skipped or re-armed notice is shown and settled, but it
        // is not a macro that ran and counting it as one would inflate the line an operator reads.
        if matches!(entry.event, CueEvent::Fired { .. }) {
            match outcome {
                CueOutcome::Delivered => self.delivered += 1,
                CueOutcome::Blocked => self.blocked += 1,
                CueOutcome::Nothing => self.nothing += 1,
                CueOutcome::Failed => self.failed += 1,
                CueOutcome::Cancelled => self.cancelled += 1,
                CueOutcome::Dropped | CueOutcome::Superseded => self.dropped += 1,
                CueOutcome::Unconfirmed => self.unconfirmed_writes += 1,
            }
        }
        true
    }

    /// Orders whose macro the window has not confirmed yet — the counter the operator reads.
    fn orders_unconfirmed(&self) -> u64 {
        self.pending
            .iter()
            .filter(|entry| matches!(entry.event, CueEvent::Fired { .. }))
            .count() as u64
    }
}

/// How a cue left the armed state.
///
/// A fired cue and a cue a seek named as skipped both end up spent, and they are opposite things to an operator: one
/// ran, the other never will unless the show goes back. Keeping only the id threw that away, so a window opened after
/// the crossing could paint both as the same neutral "spent" — which is exactly how a rehearsal loses twenty minutes
/// wondering whether the macro ran. The kind is stored **with** the id and travels in the snapshot.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CueSpentKind {
    /// The position played into the cue: it fired.
    Fired,
    /// The position was seeked past the cue: it was named and did not fire.
    Skipped,
}

/// One spent cue and how it was spent.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SpentCue {
    pub id: String,
    pub kind: CueSpentKind,
}

/// Why one cue cannot fire what it says it fires.
///
/// Whether a cue's macro reference means anything is a question about the **window's** macro library, which the
/// backend is told about (see `TimecodeState::set_macro_library`). Until it is told, only the reason that needs no
/// library is reported.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CueProblem {
    /// No macro has been chosen: the cue fires nothing on purpose, and the queue event says so.
    NoMacro,
    /// The macro the cue names is not in the library the window reported: a macro was deleted, or a different
    /// library was imported. It covers both ways of naming one — a **key** that no longer exists, and an older
    /// **position** that is past the end of the list — because to the operator they are one fact: this cue has
    /// nothing to fire.
    MacroMissing,
    /// The cue's label cannot exist in the format the source is speaking: frame 24 is not a frame at 24 fps, and
    /// drop-frame numbering skips numbers that therefore do not exist in it.
    ///
    /// It happens when the show's frame rate is changed under a list written at another one, and it cannot be fixed by
    /// guessing — moving the cue to the nearest frame that does exist would fire it somewhere the operator never asked
    /// for, which is worse than not firing. So it is reported, and the cue stays exactly where it was written.
    FrameNotAtRate,
}

/// What the backend knows about the macro library the window owns.
///
/// Two levels of knowledge, and the difference is load-bearing rather than cosmetic. A **count** is enough to judge
/// an older positional reference ("that place is past the end of the list"). The library's **keys** are what can
/// judge a reference by identity, which a count cannot do at all.
///
/// `None` at the call site is "no window has reported", which is **not** the same as an empty library: guessing would
/// mark every cue that names a macro as broken the moment the application starts.
/// One macro as a window has reported it: the **key** a cue names it by, and the **content hash** of that macro as the
/// window holds it.
///
/// The hash is what lets a cue say "this macro has changed since I named it". It is computed window-side because the
/// backend cannot read the macro library at all — the library belongs to the window — and it is **optional** because a
/// report that knows only the keys is one this application already accepted: such a cue is simply not judged for having
/// drifted, and "nobody told me" never reads as "it changed".
#[derive(Clone, Debug, PartialEq)]
pub struct MacroIdentity {
    pub key: String,
    pub hash: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum MacroLibraryView {
    /// How many macros the library holds, in library order.
    Count(usize),
    /// The library's macros, in library order.
    Keys(Vec<MacroIdentity>),
}

impl MacroLibraryView {
    pub fn len(&self) -> usize {
        match self {
            MacroLibraryView::Count(len) => *len,
            MacroLibraryView::Keys(keys) => keys.len(),
        }
    }

    /// Whether a macro with this key is in the library, or `None` when this view cannot answer that.
    fn holds_key(&self, key: &str) -> Option<bool> {
        match self {
            MacroLibraryView::Count(_) => None,
            MacroLibraryView::Keys(keys) => Some(keys.iter().any(|known| known.key == key)),
        }
    }

    /// What the macro with this key hashes to **now**, or `None` when this view cannot say — because it is only a
    /// count, or because the window did not compute a hash for that macro.
    fn hash_of(&self, key: &str) -> Option<&str> {
        match self {
            MacroLibraryView::Count(_) => None,
            MacroLibraryView::Keys(keys) => keys
                .iter()
                .find(|known| known.key == key)
                .and_then(|known| known.hash.as_deref()),
        }
    }
}

/// One cue's health, so a row can be marked broken and say why without the window re-deriving it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CueHealth {
    pub id: String,
    /// What is wrong, or `None` for a cue that is fine (or that cannot be judged yet).
    pub problem: Option<CueProblem>,
    /// The macro the cue names by key, echoed so a row can say which one is missing.
    pub macro_id: Option<String>,
    /// The older positional reference, echoed for the same reason while a cue still carries one.
    pub macro_index: Option<usize>,
    /// Whether the macro this cue named has **changed since it named it**: `Some(true)` when the cue recorded a content
    /// hash and the library now hashes differently, `Some(false)` when they agree, `None` when nobody can judge it.
    ///
    /// It is deliberately **not** a [`CueProblem`]: nothing is wrong with the cue, it fires exactly what it names, and
    /// turning a note into a problem would make `cues_broken` count it and the row print "cannot fire what it names" —
    /// a note dressed as a gate, and a lie. `None` covers both "this cue recorded no hash" (a file written before this
    /// existed) and "the window reported no hash", because an unknown must never read as a change.
    pub macro_changed: Option<bool>,
}

/// What is wrong with each of `cues`, judged against what the window has reported about its library.
///
/// A free function so a **warning on import** and the **broken mark in the snapshot** come from one rule: two
/// places deciding what "this cue cannot fire what it names" means is how a row and a warning come to disagree.
///
/// A reference by **key** is judged as soon as the library's keys are known; a reference by **position** only as far
/// as a count allows, because that is all a position can be judged against. Before anything is reported, guessing
/// would mark every cue that names a macro as broken.
pub fn cue_health(
    cues: &[TimecodeCue],
    library: Option<&MacroLibraryView>,
    format: Option<(TimecodeRate, bool)>,
) -> Vec<CueHealth> {
    cues.iter()
        .map(|cue| {
            // The label is judged first, and it is the reason a row shows when both are wrong: a label that cannot exist
            // at the source's rate stops the cue firing whatever it names, and it is the one fact an operator cannot
            // read anywhere else in the row.
            let label_problem = match format {
                Some(format) if !cue.at.exists_in(format.0, format.1) => Some(CueProblem::FrameNotAtRate),
                _ => None,
            };
            let macro_problem = match (cue.macro_id.as_deref(), cue.macro_index) {
                // Nothing chosen: the cue fires nothing on purpose.
                (None, None) => Some(CueProblem::NoMacro),
                // Named by its own key, which no reorder can silently re-point.
                (Some(key), _) => match library.and_then(|view| view.holds_key(key)) {
                    Some(false) => Some(CueProblem::MacroMissing),
                    _ => None,
                },
                // The older positional reference, judged only as far as the count reaches.
                (None, Some(index)) => match library {
                    Some(view) if index >= view.len() => Some(CueProblem::MacroMissing),
                    _ => None,
                },
            };
            CueHealth {
                id: cue.id.clone(),
                problem: label_problem.or(macro_problem),
                macro_id: cue.macro_id.clone(),
                macro_index: cue.macro_index,
                // The note, and only a note: a cue that recorded what it named is compared against what the window says
                // that macro hashes to now. Anything unjudgeable is `None` — a cue with no recorded hash, or a window
                // that reported keys without hashes — because an unknown that reads as a change would flag every cue in
                // an older file the moment this shipped.
                macro_changed: match (cue.macro_hash.as_deref(), cue.macro_id.as_deref(), library) {
                    (Some(recorded), Some(key), Some(view)) => {
                        view.hash_of(key).map(|now| now != recorded)
                    }
                    _ => None,
                },
            }
        })
        .collect()
}

/// The frame count at which a cue sits, read in the format the **source** is speaking, or `None` when the cue's label
/// cannot exist there.
///
/// One home for the reading: four comparisons in `CueList` and the health of a row all have to agree about where a cue
/// is, and a second copy of this arithmetic is exactly how a row and a firing come to disagree. The format is passed in
/// rather than taken from the cue because the cue's own rate is what it was *written* at, not what the show is running.
fn cue_frames_at(cue: &TimecodeCue, format: (TimecodeRate, bool)) -> Option<i64> {
    cue.at
        .exists_in(format.0, format.1)
        .then(|| cue.at.to_frames_in(format.0, format.1))
}

/// A position this many milliseconds later, on the show clock.
///
/// The one place a duration is added to a position, so a Go, a duration and the window's countdown cannot disagree.
/// Adding milliseconds rather than a frame count is deliberate: how many frames a second holds depends on the rate, and
/// the rate can change between two cues of one rehearsal.
fn add_ms(position: TimecodePosition, ms: u64) -> TimecodePosition {
    let fps = position.rate.frames_per_second() as f64;
    let frames = (ms as f64 * fps / 1000.0).round() as i64;
    let target = position.to_frames_in(position.rate, position.drop_frame) + frames;
    TimecodePosition::from_frames(target, position.rate, position.drop_frame)
}

/// Does the signal's own bit timing **disagree** with the rate the operator declared?
///
/// Two rules, and both are about the measurement rather than about taste:
///
/// * A deviation below **2 %** is not a disagreement. The measurement averages 2 000 bit periods, whose error is about
///   0.1 %, and the smallest real gap between the rates this application supports is 24 against 25 at 4.17 %.
/// * A **rate boundary is never a disagreement**, and that falls out of comparing against the declared rate's own
///   *nominal* numbers per second: `Fps29_97` and `Fps30` both count 30 numbers a second, `Fps23_976` and `Fps24` both
///   count 24. What separates each pair is the drop-frame bit, which the signal carries, and **not** the bit period — so
///   reporting 29.97 read as 30 would be a permanent false alarm on a professional default.
pub fn rate_disagrees(declared: TimecodeRate, measured_fps: f32) -> bool {
    let nominal = declared.frames_per_second() as f32;
    if !(nominal > 0.0) || !measured_fps.is_finite() || !(measured_fps > 0.0) {
        return false;
    }
    (measured_fps - nominal).abs() / nominal > 0.02
}

/// Which cues could not fire if the show ran at this rate: the labels that do not exist in it.
///
/// A pure function so the window can ask **before** it applies a rate change, instead of the operator finding out
/// afterwards from a row that went red. It is the same `exists_in` rule the engine uses to decide that a cue can never
/// fire, and the same one `cue_health` reports per row — so the warning, the row and the firing cannot disagree about
/// what "cannot exist at this rate" means.
pub fn cues_impossible_at(cues: &[TimecodeCue], rate: TimecodeRate, drop_frame: bool) -> Vec<String> {
    cues.iter()
        .filter(|cue| !cue.at.exists_in(rate, drop_frame))
        .map(|cue| cue.id.clone())
        .collect()
}

/// The cue list, and the state of which cues have been spent.
///
/// The semantics here are the ones a show depends on, and each is a test:
///
/// * the **first** position only arms the engine — a source that appears at 02:00 must not fire every cue before it;
/// * playing **into** a cue fires it, once;
/// * a **seek** past cues does not fire them, and names every one it skipped;
/// * moving **backwards** re-arms what is now ahead of us, and says so;
/// * two cues at the same position both fire, in list order.
#[derive(Debug, Default)]
pub struct CueList {
    cues: Vec<TimecodeCue>,
    /// The cues already dealt with, and **how**: fired, or named as skipped by a seek.
    spent: std::collections::HashMap<String, CueSpentKind>,
    last_position: Option<TimecodePosition>,
    /// The position at which the engine last became armed: the first position after a reset or a cue-list change,
    /// and the position a backward move landed on (which re-arms the cues ahead of it). `None` until a position has
    /// ever been fed. It is a **position** rather than a timestamp because the show's own timecode is the only clock
    /// that matters here, and it is what lets a window opened late say where the list is armed from.
    armed_at: Option<TimecodePosition>,
    /// How far the position may jump and still count as *playing* rather than *seeking*. One second of frames is
    /// far more than playback advances between two reports, and far less than any deliberate move.
    seek_threshold_frames: i64,
    /// The wall-clock gap above which **nothing was arriving**, rather than the show moving.
    ///
    /// The rule that separates a dropout from a seek, and it is deliberately a *time* and not a distance: a one-second
    /// dropout and a deliberate one-second seek move the position by the same amount, so no comparison of positions can
    /// tell them apart. What differs is that in one of them the door went quiet.
    ///
    /// **500 ms, and why that number.** Every source this application accepts reports far more often than that when it
    /// is alive: LTC and MTC both arrive several times per frame, so at the slowest supported rate a live source is
    /// still sending an order of magnitude more often than twice a second. Half a second of complete silence is
    /// therefore not "a slow source", it is a source that stopped — and it is short enough to catch the dropout an
    /// operator actually complains about, which is the one long enough to be noticed at all.
    arrival_gap_threshold_ms: u64,
    /// Which of the two drivers is in force. See [`CueDrive`].
    drive: CueDrive,
    /// Whether the operator has started the sequence with a Go. Until they have, a sequential list is armed and waits:
    /// a list that ran itself the moment timecode arrived would fire the show at whoever opened the window.
    sequential_started: bool,
    sequential_visited: std::collections::HashSet<String>,
    /// The duration the cue that just fired asked for, before a position is known to measure it from. A Go pressed with
    /// no timecode is that case: the countdown starts at the first position that arrives afterwards.
    sequential_wait_ms: Option<u64>,
    /// Where on the show clock the **next** sequential cue is due — the deadline set by the duration of the cue that
    /// just fired. `None` means the sequence waits: at a cue with no duration, or before the countdown has an origin.
    sequential_due: Option<TimecodePosition>,
    /// **Monitor** versus **Armed**: whether this list governs.
    ///
    /// A rehearsing list does everything a show does — the same crossings, the same spent marks, the same arm points —
    /// and its events stop at `deliver` instead of reaching the delivery ledger. Nothing downstream can emit them by
    /// accident, because they are not in the path that emits.
    rehearsing: bool,
    /// What the rehearsal has seen so far, oldest first, capped at [`REHEARSAL_PLAN_LIMIT`].
    plan: std::collections::VecDeque<RehearsalEntry>,
    plan_seq: u64,
}

impl CueList {
    pub fn new(cues: Vec<TimecodeCue>, seek_threshold_frames: i64) -> Self {
        Self {
            cues,
            spent: std::collections::HashMap::new(),
            last_position: None,
            armed_at: None,
            seek_threshold_frames,
            // Not a parameter: it is a property of what the sources ARE rather than of any show, and a second place to
            // configure it would be a second place for the dropout rule to drift from the one the guide describes.
            arrival_gap_threshold_ms: ARRIVAL_GAP_THRESHOLD_MS,
            drive: CueDrive::default(),
            sequential_started: false,
            sequential_visited: Default::default(),
            sequential_wait_ms: None,
            sequential_due: None,
            rehearsing: false,
            plan: std::collections::VecDeque::new(),
            plan_seq: 0,
        }
    }

    pub fn cues(&self) -> &[TimecodeCue] {
        &self.cues
    }

    /// The position the engine last armed at, or `None` before any position ever arrived.
    pub fn armed_at(&self) -> Option<TimecodePosition> {
        self.armed_at
    }
    /// The cues already spent — fired, or named as skipped by a seek.
    ///
    /// **Sorted**, so the same set of spent cues produces the same list on every read: the map behind it is a
    /// `HashMap`, whose iteration order is not a promise, and a snapshot that reshuffles its own fields is a
    /// snapshot no test and no window can compare. It is *not* ordered by the list, because a spent cue is spent
    /// whether or not the list has since been reordered.
    ///
    /// This says **which** cues are spent and not how; [`spent_cues`](Self::spent_cues) is the same read with the
    /// kind, which is what a window opened after the crossing needs.
    pub fn spent_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.spent.keys().cloned().collect();
        ids.sort();
        ids
    }

    /// The spent cues with how each was spent, sorted by id for the same reason `spent_ids` is.
    ///
    /// A fired cue and a cue a seek skipped are opposite things — one ran, the other did not — and a window that
    /// opens late has only this snapshot to tell them apart. The kind is recorded in `feed` at the moment the state
    /// changes, so it is the engine's own answer rather than the window's guess.
    pub fn spent_cues(&self) -> Vec<SpentCue> {
        let mut spent: Vec<SpentCue> = self
            .spent
            .iter()
            .map(|(id, kind)| SpentCue { id: id.clone(), kind: *kind })
            .collect();
        spent.sort_by(|left, right| left.id.cmp(&right.id));
        spent
    }

    /// What is wrong with each cue, in list order, as far as the engine can tell.
    ///
    /// `library_len` is how many macros the window's library holds, or `None` when no window has said: with `None`,
    /// a chosen index is **not** judged, because an unknown library is not an empty one and marking every cue broken
    /// before the window has reported would be a lie the operator cannot act on. The reasons that need no library
    /// (a cue with no macro at all) are always reported.
    ///
    /// What this now **can** say, and could not before: a cue that names its macro by key and no longer resolves to
    /// one is reported, however the library was reordered — which is precisely the fault the positional model could
    /// not see at all. A cue still carrying only the older positional reference is judged as far as the library the
    /// window has reported allows, and no further.
    pub fn health(&self, library: Option<&MacroLibraryView>, format: Option<(TimecodeRate, bool)>) -> Vec<CueHealth> {
        cue_health(&self.cues, library, format)
    }
    pub fn set_cues(&mut self, cues: Vec<TimecodeCue>) {
        // A list that changed must not inherit the spent marks of a list that no longer exists: the cue that was
        // just added would never fire.
        self.spent.clear();
        self.sequential_visited.clear();
        self.cues = cues;
    }

    /// Forget where we were and what was spent. What a source change needs: the new source may start anywhere, and
    /// its first position must arm the engine rather than fire a burst.
    pub fn reset(&mut self) {
        self.spent.clear();
        self.last_position = None;
        // The arm point belongs to the run that was just ended, not to the run about to start: a window opened
        // after the change must not be told the list is armed where the **previous** source left it.
        self.armed_at = None;
        // A sequence belongs to the run that was just ended too: a new source must not continue a sequence the
        // operator started on the previous one, and the Go is one press.
        self.sequential_started = false;
        self.sequential_visited.clear();
        self.sequential_wait_ms = None;
        self.sequential_due = None;
    }

    /// The next armed cue at or after `position`, and how far away it is — what the clock shows.
    pub fn next_cue(&self, position: TimecodePosition) -> Option<(&TimecodeCue, i64)> {
        let format = (position.rate, position.drop_frame);
        let from = position.to_frames();
        self.cues
            .iter()
            .filter_map(|cue| {
                if !cue.enabled || self.spent.contains_key(&cue.id) {
                    return None;
                }
                cue_frames_at(cue, format)
                    .filter(|frames| *frames >= from)
                    .map(|frames| (cue, frames))
            })
            .min_by_key(|(_, frames)| *frames)
            .map(|(cue, frames)| (cue, frames - from))
    }

    /// Feed a position and get what it caused.
    ///
    /// `arrival_gap_ms` is how long the door was silent before this position arrived: `None` when there was no previous
    /// arrival to measure from. It is passed down rather than read here because **this is not where the clock is** —
    /// only the door that timestamps arrivals knows, and a second guess at it here would be a second truth.
    pub fn feed(&mut self, position: TimecodePosition, arrival_gap_ms: Option<u64>) -> Vec<CueEvent> {
        let events = self.feed_events(position, arrival_gap_ms);
        self.deliver(events, Some(position))
    }

    /// Where a run's events go: back to the caller when the list **governs**, into the plan when it is **rehearsing**.
    ///
    /// One place, so a crossing, a seek, a re-arm and a Go cannot disagree about what a rehearsal means. In a rehearsal
    /// the list does everything a show does — the same spent marks, the same arm points, the same events — and the only
    /// difference is that its events stop here. **Nothing downstream can emit them by accident, because they never
    /// enter the delivery ledger at all**: a rehearsal that merely *flagged* its events would be one forgotten `if`
    /// away from firing a show.
    fn deliver(&mut self, events: Vec<CueEvent>, decided_at: Option<TimecodePosition>) -> Vec<CueEvent> {
        if !self.rehearsing {
            return events;
        }
        for event in events {
            self.plan_seq += 1;
            let (kind, id, label) = match &event {
                CueEvent::Fired { id, at, .. } => ("fired", id.clone(), at.clone()),
                CueEvent::Skipped { id, at, .. } => ("skipped", id.clone(), at.clone()),
                CueEvent::Rearmed { position, .. } => ("rearmed", String::new(), position.clone()),
            };
            // The one measurement Monitor exists for: how late the incoming timecode was when the engine decided.
            let delta_frames = match (kind, decided_at) {
                ("fired", Some(position)) => self
                    .cues
                    .iter()
                    .find(|cue| cue.id == id)
                    .and_then(|cue| cue_frames_at(cue, (position.rate, position.drop_frame)))
                    .map(|frames| position.to_frames() - frames),
                _ => None,
            };
            self.plan.push_back(RehearsalEntry {
                seq: self.plan_seq,
                kind: kind.to_string(),
                id,
                at: label,
                position: decided_at.map(|position| position.describe()).unwrap_or_default(),
                delta_frames,
            });
        }
        while self.plan.len() > REHEARSAL_PLAN_LIMIT {
            self.plan.pop_front();
        }
        Vec::new()
    }

    /// Whether this list **governs** or is only being watched.
    pub fn is_rehearsing(&self) -> bool {
        self.rehearsing
    }

    /// Enter or leave Monitor.
    ///
    /// Entering it **starts a fresh plan**: the operator turns Monitor on to watch a run, and a plan carried over from
    /// the timecode before would mix two runs in one report. Leaving it keeps the plan, because leaving Monitor is
    /// exactly when somebody wants to read what it saw.
    pub fn set_rehearsing(&mut self, rehearsing: bool) {
        if rehearsing && !self.rehearsing {
            self.plan.clear();
            self.plan_seq = 0;
        }
        self.rehearsing = rehearsing;
    }

    /// What the rehearsal has seen, oldest first.
    pub fn rehearsal_plan(&self) -> Vec<RehearsalEntry> {
        self.plan.iter().cloned().collect()
    }

    /// Forget the plan, keeping the mode: the operator clearing the report before another pass through the same run.
    /// It resets the sequence number too, so a window that highlights "the newest line" cannot be fooled by numbers
    /// that only ever grow.
    pub fn clear_rehearsal_plan(&mut self) {
        self.plan.clear();
        self.plan_seq = 0;
    }

    fn feed_events(&mut self, position: TimecodePosition, arrival_gap_ms: Option<u64>) -> Vec<CueEvent> {
        let mut events = Vec::new();
        let Some(previous) = self.last_position.replace(position) else {
            // The first position arms the engine and fires nothing: a show that starts its timecode at 01:00:00 has
            // already passed every cue before it, and firing them would be the worst possible welcome.
            //
            // This is also the arm point a window opened late reads: from here on, a crossing is a crossing.
            self.armed_at = Some(position);
            return events;
        };
        let (from, to) = (previous.to_frames_in(position.rate, position.drop_frame), position.to_frames());
        if to == from {
            return events;
        }
        // The cue's numbers are read in the **source's** format, never in the format the cue happens to store: a label
        // is not a frame count until a format is chosen, and the show's format is the one the operator is watching.
        let format = (position.rate, position.drop_frame);
        // Going back re-arms what a pass means, and it means the same in **both** drives: one rule, one place.
        if to < from {
            let count = self.rearm(to, format);
            if count > 0 {
                // A backward move re-arms the cues ahead of the new position: the list is armed **from here**, which
                // is the position a window that was not watching has to be told, or the `Rearmed` notice lives only
                // in the log of a window that is already closed.
                self.armed_at = Some(position);
                events.push(CueEvent::Rearmed {
                    count,
                    position: position.describe(),
                });
            }
        }
        if self.drive == CueDrive::Sequential {
            if to < from {
                // Going back puts the deadline where the operator landed: the sequence follows where he is, and a
                // deadline left in the future of the position he just left would fire the next cue at once.
                self.sequential_due = self.sequential_wait_ms.map(|ms| add_ms(position, ms));
            }
            events.extend(self.advance_sequential(position));
            return events;
        }
        if to < from {
            return events;
        }

        let seeking = to - from > self.seek_threshold_frames;
        // How far the show moved, in the unit a person reads. Measured in the **source's** format for the same reason
        // the cue numbers are: a label is not a duration until a rate is chosen, and the rate the operator is watching
        // is the source's. Computed only for a jump that will be reported, so an ordinary crossing pays nothing.
        let jumped_ms = if seeking {
            let per_second = position.rate.frames_per_second() as f64;
            (((to - from) as f64 / per_second) * 1000.0).round() as u64
        } else {
            0
        };
        // A cue whose label cannot exist in the source's format is left out of the crossing entirely; the row reports
        // it (see `cue_health`), which is how a cue that cannot fire says so instead of firing at a frame nobody wrote.
        let mut crossed: Vec<(&TimecodeCue, i64)> = self
            .cues
            .iter()
            .filter_map(|cue| {
                if !cue.enabled {
                    return None;
                }
                cue_frames_at(cue, format)
                    .filter(|frames| *frames > from && *frames <= to)
                    .map(|frames| (cue, frames))
            })
            .collect();
        // By position, and stable, so two cues at the same position fire in the order the operator listed them.
        crossed.sort_by_key(|(_, frames)| *frames);
        for (cue, _) in crossed {
            if self.spent.contains_key(&cue.id) {
                continue;
            }
            if cue.repeat_policy() != CueRepeat::Every {
                // The **kind** is stored with the id: a window opened after this moment reads the snapshot and has
                // to be able to say "this one ran" and "this one was jumped over" without having heard the event.
                self.spent.insert(
                    cue.id.clone(),
                    if seeking { CueSpentKind::Skipped } else { CueSpentKind::Fired },
                );
            }
            if seeking {
                events.push(CueEvent::Skipped {
                    id: cue.id.clone(),
                    at: cue.at.describe(),
                    jumped_ms: jumped_ms,
                    arrival_gap_ms,
                    // The verdict, decided where the threshold lives. See `CueEvent::Skipped::across_silence`.
                    across_silence: arrival_gap_ms
                        .map(|gap| gap > self.arrival_gap_threshold_ms)
                        .unwrap_or(false),
                });
            } else {
                events.push(CueEvent::Fired {
                    id: cue.id.clone(),
                    at: cue.at.describe(),
                    macro_id: cue.macro_id.clone(),
                    macro_index: cue.macro_index,
                });
            }
        }
        events
    }

    /// The cues a backward move arms again: everything ahead of the new position, except a cue that fires once in the
    /// show. One rule for **both** drives, which is why it is a function and not a block buried in `feed`.
    fn rearm(&mut self, to: i64, format: (TimecodeRate, bool)) -> usize {
        let before = self.spent.len();
        let retain = |id: &String| {
            let cue = self.cues.iter().find(|cue| &cue.id == id);
            let Some(cue) = cue else { return false };
            // A cue that fires **once in the show** is not armed again by going back, and that is the whole
            // difference from "once per pass": it is what lets an operator rehearse a section without the show's
            // opening announcement happening a second time.
            if cue.repeat_policy() == CueRepeat::Show {
                return true;
            }
            cue_frames_at(cue, format).map(|frames| frames <= to).unwrap_or(false)
        };
        self.spent.retain(|id, _| retain(id));
        self.sequential_visited.retain(retain);
        before - self.spent.len()
    }

    /// Which of the two drives is in force. Changing it **ends the sequence**: the countdown that was running belongs
    /// to the drive that was in force a moment ago, and carrying it into the other one would fire a cue because of a
    /// clock the operator has just stopped using.
    pub fn set_drive(&mut self, drive: CueDrive) {
        if self.drive == drive {
            return;
        }
        self.drive = drive;
        self.sequential_started = false;
        self.sequential_visited.clear();
        self.sequential_wait_ms = None;
        self.sequential_due = None;
    }

    pub fn drive(&self) -> CueDrive {
        self.drive
    }

    /// Whether the operator has started the sequence, and where on the show clock the next cue is due. The two answers
    /// travel together because a window that showed one without the other would say "running" of a sequence whose
    /// countdown has no origin yet.
    pub fn sequential_state(&self) -> (bool, Option<TimecodePosition>) {
        (self.sequential_started, self.sequential_due)
    }

    /// The cue a sequential Go or duration fires next: the first in **list order** that is armed and not spent.
    ///
    /// The order is the list's own, not the operator's layout order (`sort`): the layout is how a window draws it, and
    /// a show that fired in `created` order because somebody was looking at the list that way would be a show driven by
    /// a view.
    pub fn next_sequential(&self) -> Option<&TimecodeCue> {
        self.cues.iter().find(|cue| cue.enabled && !self.spent.contains_key(&cue.id) && !self.sequential_visited.contains(&cue.id))
    }

    /// What the cue that just fired asks for: its own duration measured from where it fired, or nothing to measure —
    /// because it has no duration (the sequence waits at it), or because no position is known yet (a Go pressed with no
    /// timecode, whose countdown starts at the first position that arrives).
    fn arm_sequential_after(&mut self, position: Option<TimecodePosition>, duration_ms: Option<u64>) {
        self.sequential_wait_ms = duration_ms;
        self.sequential_due = match (position, duration_ms) {
            (Some(position), Some(ms)) => Some(add_ms(position, ms)),
            _ => None,
        };
    }

    /// The operator's Go: fire the next cue in the list whatever its duration, and start the countdown that follows it.
    ///
    /// It works with **no timecode at all**, which is what a rehearsal with the console and no clock needs; the
    /// countdown then starts at the first position that arrives. At the end of the list it fires nothing — there is no
    /// cue left — and the window says so rather than the control looking broken.
    pub fn go(&mut self) -> Vec<CueEvent> {
        self.sequential_started = true;
        let Some(next) = self.next_sequential() else { return Vec::new() };
        let (id, at, macro_id, macro_index, duration_ms) = (
            next.id.clone(),
            next.at.describe(),
            next.macro_id.clone(),
            next.macro_index,
            next.duration_ms,
        );
        if next.repeat_policy() != CueRepeat::Every {
            self.spent.insert(id.clone(), CueSpentKind::Fired);
        }
        self.sequential_visited.insert(id.clone());
        self.arm_sequential_after(self.last_position, duration_ms);
        // A Go is an event like any other, so it takes the same door: in a rehearsal it goes into the plan and fires
        // nothing, which is what makes "nothing is emitted" true of every path rather than of the crossings alone.
        let decided_at = self.last_position;
        let events = vec![CueEvent::Fired { id, at, macro_id, macro_index }];
        self.deliver(events, decided_at)
    }

    /// Move a **sequential** list on: fire the next cue in list order once the show clock has reached the deadline the
    /// previous cue set, and never before the operator has started the sequence.
    ///
    /// The clock is what advances it — not a timer of the application's own — so a paused or stale timecode pauses the
    /// sequence, and nothing here needs a window to be open. A cue with **no duration** is where the sequence waits: the
    /// operator's Go is what moves it on, because a sequence that invented a duration would advance a show by itself.
    fn advance_sequential(&mut self, position: TimecodePosition) -> Vec<CueEvent> {
        let mut events = Vec::new();
        if !self.sequential_started {
            return events;
        }
        let Some(next) = self.next_sequential() else { return events };
        let due = match self.sequential_due {
            Some(due) => due,
            None => {
                // The cue that fired asked for a duration but there was no position to measure it from. This position
                // is where it starts counting; it does not fire anything by arriving.
                if let Some(ms) = self.sequential_wait_ms {
                    self.sequential_due = Some(add_ms(position, ms));
                }
                return events;
            }
        };
        if position.to_frames() < due.to_frames_in(position.rate, position.drop_frame) {
            return events;
        }
        let (id, at, macro_id, macro_index, duration_ms) = (
            next.id.clone(),
            next.at.describe(),
            next.macro_id.clone(),
            next.macro_index,
            next.duration_ms,
        );
        if next.repeat_policy() != CueRepeat::Every {
            self.spent.insert(id.clone(), CueSpentKind::Fired);
        }
        // The cue that just fired sets the next deadline from **where it fired**, never from the moment it was due: a
        // sequence that carried the overdue time forward would catch up by firing two cues at once after a slow step.
        self.sequential_visited.insert(id.clone());
        self.arm_sequential_after(Some(position), duration_ms);
        events.push(CueEvent::Fired { id, at, macro_id, macro_index });
        events
    }
}

/// The running timecode: what has arrived, where it says we are, and whether it is still arriving.
///
/// Every source feeds this one place — MTC today, LTC later — which is what keeps the cue engine source-agnostic:
/// it only ever sees a position and a state, and adding a transport never touches the part that decides when a cue
/// fires.
#[derive(Clone, Copy, Debug)]
pub struct PositionUpdate {
    pub position: TimecodePosition,
    pub arrived_at: std::time::Instant,
    pub source_epoch: u64,
}

#[derive(Debug, Default)]
struct SourceIngress {
    ltc: Option<u64>,
    midi: Option<u64>,
    master: Option<(bool, u64)>, // true = LTC; false = MTC
}

#[derive(Debug)]
pub struct TimecodeState {
    ingress: std::sync::Mutex<SourceIngress>,
    source_epoch: std::sync::atomic::AtomicU64,
    forwarding_error: std::sync::Mutex<Option<String>>,
    assembler: std::sync::Mutex<MtcAssembler>,
    position: std::sync::Mutex<Option<TimecodePosition>>,
    /// How long a position stays "running" without a new one. A signal that stops must stop looking alive: a
    /// frozen position that still says "running" is how a show looks like it is following something it is not.
    stale_after: std::time::Duration,
    last_update: std::sync::Mutex<Option<std::time::Instant>>,
    pieces: std::sync::atomic::AtomicU64,
    positions: std::sync::atomic::AtomicU64,
    source: std::sync::Mutex<String>,
    /// The cue list, and the state of which cues have been spent.
    cues: std::sync::Mutex<CueList>,
    /// How many frames to add to every incoming position. A real rig always needs one — a source that arrives a
    /// little behind the picture, or ahead of it — and pretending otherwise wastes a rehearsal.
    offset_frames: std::sync::atomic::AtomicI64,
    /// Where fired and skipped cues are announced. The channel carries **no data**: it is a doorbell that wakes the
    /// consumer thread, which then reads the ledger below. `None` means "nobody is listening", which is what the tests
    /// and the read-only case use.
    cue_sink: std::sync::Mutex<Option<std::sync::mpsc::SyncSender<()>>>,
    /// What the engine fired, and what the window has confirmed. This is the record that survives a hand-over the
    /// channel refuses, so a drop can never become a cue consumed with nothing said.
    deliveries: std::sync::Mutex<CueDeliveries>,
    /// The as-run record: what the show did, in the order it did it, kept across a restart.
    ///
    /// In memory **here** and on disk in the host, because this file does no I/O: the engine decides *when* the
    /// record is due and hands the lines over, and `main.rs` owns the path and the recovery-copy helper. The same
    /// shape as `position_sink` and `cue_sink` — the engine owns the decision, the host owns the side effect.
    as_run: std::sync::Mutex<AsRunRecord>,
    as_run_error: std::sync::Mutex<Option<String>>,
    /// What the window's library holds, as the window last reported it.
    ///
    /// `None` is "no window has said", which is **not** the same as an empty library: the backend cannot know what
    /// macros exist, and guessing would mark every cue broken the moment the application starts. With `None`, only
    /// the problems that need no library are reported (see `cue_health`).
    macro_library: std::sync::Mutex<Option<MacroLibraryView>>,
    /// Where every position goes, for whoever wants to pass it on. `None` means nobody asked.
    ///
    /// A second sink rather than a call into the MIDI runtime: the state does not know what a MIDI port is, and the
    /// moment it did, adding a transport would mean changing the thing every transport depends on.
    position_sink: std::sync::Mutex<Option<std::sync::mpsc::SyncSender<PositionUpdate>>>,
}

/// How many times the doorbell may ring unanswered before a ring is counted as a retry rather than queued.
///
/// The channel is a **doorbell**, not a queue: one ring is enough for the consumer to pick up everything the ledger
/// holds, so this only bounds how far ahead the engine can get before the ring is refused and counted. It is
/// deliberately small: the doorbell is not the record, and a large one would only hide a consumer that has stopped.
pub const CUE_QUEUE_CAPACITY: usize = 64;

/// What the readout shows.
#[derive(Clone, Debug, Default, Serialize)]
pub struct TimecodeSnapshot {
    /// `running`, `stale` or `nothing`: the three states an operator has to be able to tell apart.
    pub state: String,
    pub position: Option<String>,
    /// How long ago the last position arrived, in milliseconds, when one ever did.
    pub age_ms: Option<u64>,
    pub rate: Option<String>,
    pub drop_frame: bool,
    /// The **freewheel window**: how long a position may stop arriving before the clock is declared `stale`.
    ///
    /// Reported rather than left a constant inside the window, because it is the difference between "the signal
    /// hiccupped" and "the show has stopped", and the operator is the one who has to decide which of the two he is
    /// looking at. It is set where the state is constructed; it is not yet exposed as a setting of its own.
    pub freewheel_ms: u64,
    /// How much of that window is left, or `None` when no window is running because nothing has arrived yet.
    ///
    /// `Some(0)` is the exhausted window — the clock is `stale` — and it is deliberately **not** the same as `None`:
    /// "the show stopped a while ago" and "no show has started" are different facts, and an operator acts on them
    /// differently.
    pub freewheel_remaining_ms: Option<u64>,
    pub pieces: u64,
    pub positions: u64,
    pub source: String,
    /// True when the position is not a round number of seconds' worth of frames — a detail that tells an operator
    /// whether the signal is being read cleanly. It is not an error: any real position is somewhere inside a second.
    pub last_frame_number: Option<u32>,
    /// How many cues are configured, and the next one that will fire with how far away it is — what the clock's
    /// own line shows.
    pub cues: usize,
    pub next_cue: Option<String>,
    /// The **id** of that next cue, which `next_cue` alone cannot say: it is a position, and two cues at the same
    /// position are exactly the case the list's own order decides. A window marks the row by id, so the backend
    /// resolves the tie once here rather than every window resolving it again.
    pub next_cue_id: Option<String>,
    pub next_cue_frames: Option<i64>,
    pub next_cue_seconds: Option<f64>,
    /// The cues already spent — fired, or named as skipped by a seek — so a window that opens **after** the
    /// crossing can still mark what has already happened instead of painting a list that pretends nothing ran.
    ///
    /// Sorted, and a *set* of ids rather than a list of events: it says a cue is spent, and deliberately not how it
    /// was spent (a fired cue and a cue a seek skipped both land in it). Two consequences a consumer has to know:
    /// it is **volatile** — a backend restart, a source change (`reset_cues`) or a saved list (`set_timecode_cues`)
    /// empties it — and a backward move drops the ids of the cues ahead of the new position, because those are
    /// armed again and will fire when the show reaches them.
    pub spent_ids: Vec<String>,
    /// The same spent cues with **how** each was spent, sorted by id.
    ///
    /// This is what a window that opens after the crossing needs and what `spent_ids` cannot say: a cue that fired
    /// and a cue a seek named as skipped both appear in `spent_ids`, and they are opposite things. The two fields
    /// carry the same set of ids on purpose, so a consumer can move from one to the other without a second source of
    /// truth; `spent_ids` stays because existing readers use it, and this is the one that can answer "did it run?".
    pub spent_cues: Vec<SpentCue>,
    /// One entry per cue, in list order, saying what is wrong with each — the field a row is marked broken from.
    ///
    /// A problem is reported only when it can be judged: `no_macro` always, `macro_missing` only once the window has
    /// reported its library (`macro_library_len` is `Some`). Everything a window needs to phrase the row is here or
    /// in `macro_library_len`; nothing about the library is guessed.
    pub cue_health: Vec<CueHealth>,
    /// How many cues cannot fire what they name: the count behind `cue_health`, so a line can say "3 broken" without
    /// walking the list.
    pub cues_broken: usize,
    /// How many macros the window's library holds, or `None` when no window has reported it. `Some(0)` is an empty
    /// library and is not the same thing.
    pub macro_library_len: Option<usize>,
    /// The position at which the engine last became armed, as the operator writes a position: the first position
    /// after a reset or a list change, or where a backward move landed. `None` before any position ever arrived.
    pub armed_at: Option<String>,
    /// Which of the two drives the list runs in, and — in a sequential list — how the sequence is going.
    ///
    /// These travel in the snapshot rather than in a window's own memory because the sequence is the **engine's**
    /// state: it was started by a Go the engine performed, and a window opened halfway through it has to be able to say
    /// where it runs from without having watched it start.
    pub drive: CueDrive,
    pub sequential_started: bool,
    /// The position the current countdown is **due** at, or `None` when it has no origin yet.
    pub sequential_due: Option<String>,
    /// The cue a Go would fire next, or `None` when there is none left.
    pub sequential_next_id: Option<String>,
    /// True when the sequence has reached the **end of the list**: a Go has nothing to fire, which is a state an
    /// operator has to be told rather than left pressing a control that looks broken.
    pub sequential_at_end: bool,
    /// **Monitor** versus **Armed**: false means the list governs and fires.
    pub rehearsing: bool,
    /// What a rehearsal has seen so far, oldest first, capped at [`REHEARSAL_PLAN_LIMIT`]. Empty while the list governs,
    /// because a plan is only produced by a rehearsal — an armed list emits its events instead of recording them.
    pub rehearsal_plan: Vec<RehearsalEntry>,
    /// The delivery record: what the engine fired and what the window confirmed. `fired_unconfirmed` is the counter
    /// that must not stay invisible — a cue whose macro has not been confirmed is either about to run or has been
    /// lost, and an operator has to be able to tell that from "this cue had no macro".
    pub cues_fired: u64,
    pub cues_delivered: u64,
    pub cues_blocked: u64,
    pub cues_nothing: u64,
    pub forwarding_error: Option<String>,
    pub as_run_error: Option<String>,
    pub cues_failed: u64,
    pub cues_cancelled: u64,
    pub cues_dropped: u64,
    pub cues_unconfirmed_writes: u64,
    /// Fired cues the window has not confirmed yet. Non-zero means orders the show is waiting on.
    pub fired_unconfirmed: u64,
    /// Hand-overs the full channel refused and the ledger retried. Counted so "the window is behind" is visible.
    pub deliveries_deferred: u64,
    /// Events the ledger itself had to refuse because it was full: the only true loss, and it is counted, never
    /// silent.
    pub deliveries_lost: u64,
}

impl Default for TimecodeState {
    fn default() -> Self {
        Self::new(std::time::Duration::from_millis(750))
    }
}

impl TimecodeState {
    pub fn new(stale_after: std::time::Duration) -> Self {
        Self {
            ingress: std::sync::Mutex::new(SourceIngress::default()),
            source_epoch: std::sync::atomic::AtomicU64::new(0),
            forwarding_error: std::sync::Mutex::new(None),
            assembler: std::sync::Mutex::new(MtcAssembler::new()),
            position: std::sync::Mutex::new(None),
            stale_after,
            last_update: std::sync::Mutex::new(None),
            pieces: std::sync::atomic::AtomicU64::new(0),
            positions: std::sync::atomic::AtomicU64::new(0),
            source: std::sync::Mutex::new("MTC".to_string()),
            cues: std::sync::Mutex::new(CueList::new(Vec::new(), 25)),
            offset_frames: std::sync::atomic::AtomicI64::new(0),
            cue_sink: std::sync::Mutex::new(None),
            deliveries: std::sync::Mutex::new(CueDeliveries::default()),
            as_run: std::sync::Mutex::new(AsRunRecord::default()),
            as_run_error: std::sync::Mutex::new(None),
            macro_library: std::sync::Mutex::new(None),
            position_sink: std::sync::Mutex::new(None),
        }
    }

    // Source transitions and position/cue commits share this mutex. A callback
    // checked before Stop cannot commit afterwards using an already retired lease.
    pub fn source_epoch(&self) -> u64 { self.source_epoch.load(std::sync::atomic::Ordering::SeqCst) }
    pub fn set_forwarding_error(&self, error: Option<String>) {
        if let Ok(mut stored) = self.forwarding_error.lock() { *stored = error; }
    }
    fn source_changed(&self, name: &str) {
        self.source_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut source) = self.source.lock() { *source = name.to_string(); }
        if let Ok(mut position) = self.position.lock() { *position = None; }
        if let Ok(mut at) = self.last_update.lock() { *at = None; }
        if let Ok(mut assembler) = self.assembler.lock() { *assembler = MtcAssembler::new(); }
        self.reset_cues();
    }
    pub fn activate_ltc(&self, generation: u64) {
        let mut gate = self.ingress.lock().unwrap_or_else(|e| e.into_inner());
        gate.ltc = Some(generation); gate.master = Some((true, generation));
        self.source_changed("LTC");
    }
    pub fn retire_ltc(&self, generation: u64) {
        let mut gate = self.ingress.lock().unwrap_or_else(|e| e.into_inner());
        if gate.ltc == Some(generation) {
            gate.ltc = None; gate.master = None;
            self.source_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if let Ok(mut at) = self.last_update.lock() { *at = None; }
        }
    }
    pub fn activate_midi_input(&self, generation: u64) {
        let mut gate = self.ingress.lock().unwrap_or_else(|e| e.into_inner());
        gate.midi = Some(generation);
        if gate.ltc.is_none() {
            gate.master = None;
            if let Ok(mut assembler) = self.assembler.lock() { *assembler = MtcAssembler::new(); }
        }
    }
    pub fn retire_midi_input(&self, generation: u64) {
        let mut gate = self.ingress.lock().unwrap_or_else(|e| e.into_inner());
        if gate.midi == Some(generation) {
            gate.midi = None;
            if gate.ltc.is_none() { self.source_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst); }
            if gate.ltc.is_none() {
                gate.master = None;
                if let Ok(mut at) = self.last_update.lock() { *at = None; }
            }
        }
    }
    pub fn accept_ltc(&self, generation: u64, position: TimecodePosition, now: std::time::Instant) -> Option<TimecodePosition> {
        let gate = self.ingress.lock().ok()?;
        if gate.ltc != Some(generation) { return None; }
        self.push_position_inner(position, now)
    }
    #[cfg(test)]
    pub fn feed_system_message(&self, bytes: &[u8], now: std::time::Instant) -> Option<TimecodePosition> {
        { let mut gate = self.ingress.lock().ok()?; if gate.midi.is_none() { gate.midi = Some(0); } }
        self.feed_mtc_generation(0, bytes, now)
    }
    pub fn feed_mtc_generation(&self, generation: u64, bytes: &[u8], now: std::time::Instant) -> Option<TimecodePosition> {
        let mut gate = self.ingress.lock().ok()?;
        if gate.midi != Some(generation) || gate.ltc.is_some() { return None; }
        // Only MTC: a quarter frame, or the full-frame SysEx shape. Anything else (a clock tick, a start message)
        // is somebody else's and must not be counted as timecode arriving.
        let is_quarter = bytes.first().copied() == Some(0xF1);
        let is_full_frame = bytes.len() >= 10
            && bytes[0] == 0xF0
            && bytes[1] == 0x7F
            && bytes[3] == 0x01
            && bytes[4] == 0x01;
        if !is_quarter && !is_full_frame {
            return None;
        }
        self.pieces.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let assembled = {
            let mut assembler = match self.assembler.lock() {
                Ok(assembler) => assembler,
                Err(_) => return None,
            };
            match QuarterFrame::from_message(bytes) {
                Some(frame) => assembler.push_at(frame, now),
                None => assembler.push_full_frame(bytes),
            }
        };
        let position = assembled?;
        if gate.master != Some((false, generation)) {
            self.source_changed("MTC");
            gate.master = Some((false, generation));
        }
        // Every position goes through the same door, whatever produced it.
        self.push_position_inner(position, now)
    }

    /// Install the cue list and where its events go. Returns how many cues are configured.
    ///
    /// The sink is `Option` for the same reason the other protocols' are: a test, or a read-only session, wants the
    /// cues evaluated and nothing handed anywhere.
    pub fn configure_cues(
        &self,
        cues: Vec<TimecodeCue>,
        sink: Option<std::sync::mpsc::SyncSender<()>>,
    ) -> usize {
        let count = cues.len();
        if let Ok(mut guard) = self.cues.lock() {
            // A new list must not inherit the spent marks of a list that no longer exists: the cue that was just
            // added would never fire.
            guard.set_cues(cues);
            // And the engine re-arms, because a list that changed is a list whose crossings are unknown.
            guard.reset();
        }
        if let Ok(mut guard) = self.cue_sink.lock() {
            *guard = sink;
        }
        count
    }

    /// Where every position goes, for a source that wants to pass the timecode on.
    pub fn set_position_sink(&self, sink: Option<std::sync::mpsc::SyncSender<PositionUpdate>>) {
        if let Ok(mut guard) = self.position_sink.lock() {
            *guard = sink;
        }
    }

    /// Set the offset, in frames. `0` is no offset, and it is applied to every incoming position from now on.
    pub fn set_offset_frames(&self, frames: i64) {
        self.offset_frames.store(frames, std::sync::atomic::Ordering::Relaxed);
    }

    /// What a source change needs: the new source may start anywhere, and its first position must arm the engine
    /// rather than fire a burst of cues whose crossings nobody saw.
    pub fn reset_cues(&self) {
        if let Ok(mut guard) = self.cues.lock() {
            guard.reset();
        }
    }

    /// How many macros the window's library holds, so a cue that names one which is not there can be marked broken.
    ///
    /// The library lives in the window — it owns the macros, the imports and the padlock — and this is the window
    /// telling the backend the one thing the backend cannot read. Reporting **zero** is a real report (an empty
    /// library), and it is different from never reporting: see the field's own comment. This changes nothing about
    /// what fires; it changes what the snapshot can say about a cue that will not fire.
    pub fn set_macro_library(&self, library: MacroLibraryView) {
        if let Ok(mut guard) = self.macro_library.lock() {
            *guard = Some(library);
        }
    }

    /// Test fixture for the legacy count-only report, before macros had keys.
    ///
    /// A count can judge a positional reference and nothing else: with it, a cue that names its macro by key is
    /// reported as fine rather than guessed at, because "I do not know this library's keys" is not "the key is
    /// missing".
    #[cfg(test)]
    fn set_macro_library_len(&self, len: usize) {
        self.set_macro_library(MacroLibraryView::Count(len));
    }

    /// The library the window last reported, for a caller that must judge a list **before** it is installed.
    ///
    /// An import warning and the broken mark on a row come from one rule, so both read one report rather than each
    /// asking the snapshot for a number that was derived from it.
    pub fn macro_library(&self) -> Option<MacroLibraryView> {
        self.macro_library.lock().ok().and_then(|guard| guard.clone())
    }

    /// The format the source is speaking, once a position has arrived: its frame rate and whether it is drop-frame.
    ///
    /// `None` before anything has arrived, which is not "25 fps": a list cannot be judged against a format nobody has
    /// heard yet, and guessing one would mark cues broken for a show that has not started.
    pub fn current_format(&self) -> Option<(TimecodeRate, bool)> {
        self.position
            .lock()
            .ok()
            .and_then(|guard| guard.map(|position| (position.rate, position.drop_frame)))
    }

    /// The cues in the installed list that could not fire at another rate — what a rate change would cost, asked
    /// **before** it is made.
    pub fn cues_impossible_at(&self, rate: TimecodeRate, drop_frame: bool) -> Vec<String> {
        self.cues
            .lock()
            .map(|cues| cues_impossible_at(cues.cues(), rate, drop_frame))
            .unwrap_or_default()
    }

    /// Accept a position from **any** source: the assembler above, an LTC decoder reading a device, or a file.
    ///
    /// One door for every transport is what makes the cue engine source-agnostic: adding a way to obtain timecode
    /// never touches the part that decides when a cue fires, and a source cannot accidentally skip the cue list.
    #[cfg(test)]
    pub fn push_position(&self, position: TimecodePosition, now: std::time::Instant) -> Option<TimecodePosition> {
        let _gate = self.ingress.lock().ok()?;
        self.push_position_inner(position, now)
    }
    fn push_position_inner(&self, position: TimecodePosition, now: std::time::Instant) -> Option<TimecodePosition> {
        // The offset is applied **here**, at the single door, so every source gets it and the cue engine only ever
        // compares positions in the show's own timecode. Applying it further in would mean each source remembering to.
        let offset = self.offset_frames.load(std::sync::atomic::Ordering::Relaxed);
        let position = if offset == 0 {
            position
        } else {
            TimecodePosition::from_frames(
                position.to_frames() + offset,
                position.rate,
                position.drop_frame,
            )
        };
        // **How long the door was silent, read BEFORE the timestamp is replaced.** This is the one place with the
        // clock, and after the two lines below the previous instant is gone — so a gap computed anywhere later would
        // be a gap computed from nothing. `None` on the first arrival after a list is installed, which is a different
        // sentence from "nothing arrived" and the reason the field is an `Option` all the way to the window.
        let arrival_gap_ms = self
            .last_update
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|previous| now.saturating_duration_since(*previous)))
            .map(|gap| gap.as_millis().min(u64::MAX as u128) as u64);
        if let Ok(mut guard) = self.position.lock() {
            *guard = Some(position);
        }
        if let Ok(mut guard) = self.last_update.lock() {
            *guard = Some(now);
        }
        self.positions.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        // Whoever asked for the positions gets them **after** the offset, so what is passed on is what the show is
        // following rather than what a cable happened to say.
        if let Ok(sink) = self.position_sink.lock() {
            if let Some(sender) = sink.as_ref() {
                let _ = sender.try_send(PositionUpdate { position, arrived_at: now, source_epoch: self.source_epoch.load(std::sync::atomic::Ordering::SeqCst) });
            }
        }
        self.fire_cues(position, arrival_gap_ms);
        Some(position)
    }

    /// Run a position through the cue list and record what it caused.
    ///
    /// Called for **every** position, whatever produced it: that is what keeps the cue engine source-agnostic, and
    /// why adding LTC later will not touch the part that decides when a cue fires.
    ///
    /// The order of the two halves is the whole fix: the events are **recorded first** and announced second. The
    /// record is what the show depends on — the window may not have registered its listener yet, the doorbell may be
    /// refused, and neither is allowed to turn "the engine fired this cue" into "nobody knows". A refused ring is
    /// counted as a retry, and the events are still in the ledger for the consumer to pick up and the window to
    /// confirm.
    fn fire_cues(&self, position: TimecodePosition, arrival_gap_ms: Option<u64>) {
        let events = match self.cues.lock() {
            Ok(mut cues) => cues.feed(position, arrival_gap_ms),
            Err(_) => return,
        };
        self.announce(events);
    }

    /// The drive mode the list runs in — see [`CueDrive`]. It travels with the list, so it is set where the list is
    /// installed rather than by a command of its own: a mode and a list that arrived separately could disagree.
    pub fn set_drive(&self, drive: CueDrive) {
        if let Ok(mut cues) = self.cues.lock() {
            cues.set_drive(drive);
        }
    }

    /// Put the list in **Monitor** or back in **Armed** — see [`CueList::set_rehearsing`].
    ///
    /// It is deliberately a mode of the **engine** rather than a flag a window keeps: the rule "a rehearsal emits
    /// nothing" is enforced where the events are, so no consumer can be written that forgets it.
    pub fn set_rehearsing(&self, rehearsing: bool) {
        if let Ok(mut cues) = self.cues.lock() {
            cues.set_rehearsing(rehearsing);
        }
    }

    /// Forget the rehearsal report, keeping the mode.
    pub fn clear_rehearsal_plan(&self) {
        if let Ok(mut cues) = self.cues.lock() {
            cues.clear_rehearsal_plan();
        }
    }

    /// Whether the list is in **Monitor** right now — what the engine actually is, not what was last asked for.
    pub fn is_rehearsing(&self) -> bool {
        self.cues.lock().map(|cues| cues.is_rehearsing()).unwrap_or(false)
    }

    /// The operator's Go in a **sequential** list: fire the next cue in order and announce it through the same ledger
    /// and the same doorbell a crossing uses.
    ///
    /// A cue fired by hand is not a special kind of event to anything downstream — the window confirms it, the inter-app
    /// layer sends it, the ledger records it — which is why this route exists instead of a window firing the macro
    /// itself. It answers how many cues it fired: `0` means the sequence has reached the end of the list.
    pub fn sequential_go(&self) -> usize {
        let events = match self.cues.lock() {
            Ok(mut cues) => cues.go(),
            Err(_) => return 0,
        };
        let count = events.len();
        self.announce(events);
        count
    }

    /// Record the events and ring the doorbell — **the one path both drives take**, so a cue fired by a crossing and a
    /// cue fired by a Go reach the window, the ledger and the other applications by the same route.
    ///
    /// The order of the two halves is the whole fix: the events are **recorded first** and announced second. The record
    /// is what the show depends on — the window may not have registered its listener yet, the doorbell may be refused,
    /// and neither is allowed to turn "the engine fired this cue" into "nobody knows". A refused ring is counted as a
    /// retry, and the events are still in the ledger for the consumer to pick up and the window to confirm.
    fn announce(&self, events: Vec<CueEvent>) {
        if events.is_empty() {
            return;
        }
        // The sender is cloned **before** the ledger is locked, so the two locks are never held at once and the
        // thread that decodes timecode takes each one for as long as a push takes.
        let sender = self.cue_sink.lock().ok().and_then(|guard| guard.clone());
        // **The cue numbers are read BEFORE the ledger is locked**, and that ordering is not a detail: it is the
        // difference between a show and a frozen application.
        //
        // `snapshot_at` — which every window calls four times a second — takes `cues` and then `deliveries`, holding
        // both. The first version of this code took `deliveries` here and then `cues` to look a number up, which is
        // **the same two locks in the opposite order**: the poll and the firing path crossing would leave each holding
        // what the other wants, and nothing would run again. Reading the numbers first makes this function take the
        // same order as the poll, which is what `locks_do_not_invert_between_the_poll_and_the_firing_path` pins.
        let numbers: Vec<String> = {
            let list = self.cues.lock().ok();
            events
                .iter()
                .map(|event| {
                    list.as_ref()
                        .and_then(|cues| cues.cues().iter().find(|cue| cue.id == event_id(event)))
                        .map(|cue| cue.number.clone())
                        .unwrap_or_default()
                })
                .collect()
        };
        let Ok(mut deliveries) = self.deliveries.lock() else {
            return;
        };
        for (event, number) in events.into_iter().zip(numbers) {
            // Recorded before anything is announced: an event the ledger refuses is counted as lost right there, and
            // one it accepts is guaranteed to be readable by the consumer and the window even if the ring is refused.
            let Ok(stamped) = deliveries.record(event) else {
                continue;
            };
            // **The as-run line, written here because this is the only place that knows both halves.** The ledger has
            // just given the event the sequence number a later confirmation is keyed by, and the cue list gave the
            // operator's own number for the cue above. Appending is a queue push and a counter, because this runs once
            // per timecode frame and has to stay the cheapest thing in the loop.
            if let Ok(mut record) = self.as_run.lock() {
                record.append(stamped.seq, &stamped.event, wall_clock_ms(), &number);
            }
        }
        if let Some(sender) = sender.as_ref() {
            // **One ring for the batch**, and `try_send`, never `send`: this runs on the thread that decodes
            // timecode, and waiting here would be waiting in the middle of a show. The consumer answers a ring by
            // sweeping the whole ledger, so a refused ring costs nothing but a count — the events are still there
            // and the next ring, or the window's own drain, picks them up. That is what makes a "dropped" event a
            // retry instead of a cue that quietly did not fire.
            if sender.try_send(()).is_err() {
                deliveries.record_deferred();
            }
        }
    }

    /// The events the engine fired that the window has not confirmed yet — what the window drains when it starts
    /// listening, and what the consumer announces.
    ///
    /// Reading never removes: an event leaves this list only when the window **confirms** it (see [`confirm_cues`]),
    /// so a window that reads and then fails cannot lose the order by having read it.
    pub fn pending_cues(&self) -> Vec<StampedCueEvent> {
        self.deliveries.lock().map(|guard| guard.pending.clone()).unwrap_or_default()
    }

    /// The pending events after `seq`, in order — what the consumer thread announces on one ring of the doorbell.
    ///
    /// Reading, not taking: the ring is idempotent, so a consumer that restarts, or that is woken while the engine is
    /// still recording, can sweep again without anything being lost or announced twice out of order.
    pub fn pending_after(&self, seq: u64) -> Vec<StampedCueEvent> {
        self.deliveries
            .lock()
            .map(|guard| {
                guard
                    .pending
                    .iter()
                    .filter(|entry| entry.seq > seq)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Apply what the window did with a batch of orders, and return how many were still waiting.
    ///
    /// A receipt that is not pending is not an error: a retried hand-over can have the window confirm the same event
    /// twice, and the second confirmation is simply nothing left to do.
    pub fn confirm_cues(&self, confirmations: &[(u64, CueOutcome)]) -> usize {
        let settled = {
            let Ok(mut deliveries) = self.deliveries.lock() else {
                return 0;
            };
            confirmations
                .iter()
                .filter(|(seq, outcome)| deliveries.settle(*seq, *outcome))
                .count()
        };
        // And the as-run line the order produced carries what the window said about it. **After** the ledger settles,
        // and only when it settled something: a confirmation the ledger refused — one for an event it no longer holds —
        // must not mark a line as answered when nothing was answered.
        if settled > 0 {
            if let Ok(mut record) = self.as_run.lock() {
                for (seq, outcome) in confirmations {
                    record.settle(*seq, *outcome);
                }
            }
        }
        settled
    }

    pub fn as_run_batch(&self, now: std::time::Instant, force: bool) -> Option<(u64, Vec<AsRunLine>)> {
        self.as_run.lock().ok().and_then(|record| record.batch(now, force))
    }
    pub fn acknowledge_as_run(&self, revision: u64) {
        if let Ok(mut record) = self.as_run.lock() { record.acknowledge(revision); }
    }
    pub fn set_as_run_error(&self, error: Option<String>) {
        if let Ok(mut stored) = self.as_run_error.lock() { *stored = error; }
    }

    /// Put back what the previous run left, at startup.
    pub fn restore_as_run(&self, lines: Vec<AsRunLine>) {
        // Same lock order as event recording: receipts first, then the persistent record.
        let mut deliveries = self.deliveries.lock().unwrap_or_else(|e| e.into_inner());
        deliveries.next_seq = deliveries.next_seq.max(lines.iter().map(|line| line.seq).max().unwrap_or(0));
        if let Ok(mut record) = self.as_run.lock() {
            record.restore(lines);
        }
    }

    /// The record as it stands, for a reader that is not a flush.
    pub fn as_run_lines(&self) -> Vec<AsRunLine> {
        self.as_run
            .lock()
            .map(|record| record.lines().iter().cloned().collect())
            .unwrap_or_default()
    }

    /// What the readout shows, as of `now` — passed in rather than read inside, so a test can decide what "now"
    /// means without waiting for a clock.
    pub fn snapshot_at(&self, now: std::time::Instant) -> TimecodeSnapshot {
        let _gate = self.ingress.lock().unwrap_or_else(|e| e.into_inner());
        let position = self.position.lock().ok().and_then(|guard| *guard);
        let last_update = self.last_update.lock().ok().and_then(|guard| *guard);
        let age = last_update.map(|at| now.saturating_duration_since(at));
        // The freewheel window as a fact rather than as a constant of the window: the tolerance itself, and how much of
        // it is left. `None` until a position has ever arrived, because no window is running before that.
        let freewheel_ms = self.stale_after.as_millis() as u64;
        let freewheel_remaining_ms = match (position, age) {
            (Some(_), Some(age)) => Some(freewheel_ms.saturating_sub(age.as_millis() as u64)),
            _ => None,
        };
        // What the clock's own line shows: the next cue that will fire, and how far the timecode still has to run.
        //
        // The cue list is locked **once** for everything this snapshot says about it — the next cue, the spent ids,
        // the arm point and the count. Read through separate locks, a cue could be spent in one field and still be
        // "the next one" in another, which is precisely the kind of half-state a show reads as a bug.
        let cues = self.cues.lock().ok();
        let next = match (position, cues.as_ref()) {
            (Some(position), Some(cues)) => cues
                .next_cue(position)
                .map(|(cue, distance)| (cue.id.clone(), cue.at.describe(), distance)),
            _ => None,
        };
        let spent_ids = cues.as_ref().map(|cues| cues.spent_ids()).unwrap_or_default();
        let spent_cues = cues.as_ref().map(|cues| cues.spent_cues()).unwrap_or_default();
        let armed_at = cues.as_ref().and_then(|cues| cues.armed_at());
        let cue_count = cues.as_ref().map(|cues| cues.cues().len()).unwrap_or(0);
        // The drive mode and the state of the sequence, read under the same lock as the list they belong to.
        let drive = cues.as_ref().map(|cues| cues.drive()).unwrap_or_default();
        let (sequential_started, sequential_due) = cues
            .as_ref()
            .map(|cues| cues.sequential_state())
            .unwrap_or((false, None));
        // The cue a Go would fire next, and whether there is one. A Go at the end of the list fires nothing, and a
        // window has to be able to say that rather than leaving a dead-looking control on screen.
        let sequential_next_id = match (drive, cues.as_ref()) {
            (CueDrive::Sequential, Some(cues)) => cues.next_sequential().map(|cue| cue.id.clone()),
            _ => None,
        };
        let sequential_at_end =
            drive == CueDrive::Sequential && sequential_started && sequential_next_id.is_none();
        // Monitor versus Armed, and what a rehearsal has seen: read under the same lock as the list they describe.
        let rehearsing = cues.as_ref().map(|cues| cues.is_rehearsing()).unwrap_or(false);
        let rehearsal_plan = cues.as_ref().map(|cues| cues.rehearsal_plan()).unwrap_or_default();
        // The library report is read **once**, before the health is derived from it, for the same reason the cue list
        // is locked once: a snapshot whose two fields disagreed about the library would mark rows against a library
        // it is not describing.
        let macro_library = self.macro_library.lock().ok().and_then(|guard| guard.clone());
        let cue_health = cues
            .as_ref()
            .map(|cues| cues.health(macro_library.as_ref(), position.map(|position| (position.rate, position.drop_frame))))
            .unwrap_or_default();
        let cues_broken = cue_health.iter().filter(|health| health.problem.is_some()).count();
        let frames_per_second = position.map(|position| position.rate.frames_per_second()).unwrap_or(25) as f64;
        // The delivery counters come from one lock, taken once: a snapshot that read them separately could show a
        // fired cue as both confirmed and unconfirmed, which is exactly the kind of number an operator cannot trust.
        let deliveries = self.deliveries.lock().ok();
        let (delivered, blocked, nothing, failed, orders, unconfirmed, deferred, lost) = deliveries
            .as_ref()
            .map(|guard| {
                (
                    guard.delivered,
                    guard.blocked,
                    guard.nothing,
                    guard.failed,
                    guard.orders,
                    guard.orders_unconfirmed(),
                    guard.deferred,
                    guard.lost,
                )
            })
            .unwrap_or((0, 0, 0, 0, 0, 0, 0, 0));
        let state = match (position, age) {
            (None, _) => "nothing",
            (Some(_), Some(age)) if age <= self.stale_after => "running",
            (Some(_), _) => "stale",
        };
        TimecodeSnapshot {
            state: state.to_string(),
            position: position.map(|position| position.describe()),
            age_ms: age.map(|age| age.as_millis() as u64),
            rate: position.map(|position| position.rate.label().to_string()),
            drop_frame: position.map(|position| position.drop_frame).unwrap_or(false),
            freewheel_ms,
            freewheel_remaining_ms,
            pieces: self.pieces.load(std::sync::atomic::Ordering::Relaxed),
            positions: self.positions.load(std::sync::atomic::Ordering::Relaxed),
            source: self
                .source
                .lock()
                .map(|guard| guard.clone())
                .unwrap_or_else(|_| "MTC".to_string()),
            last_frame_number: position.map(|position| position.frames),
            cues: cue_count,
            next_cue: next.as_ref().map(|(_, at, _)| at.clone()),
            next_cue_id: next.as_ref().map(|(id, _, _)| id.clone()),
            next_cue_frames: next.as_ref().map(|(_, _, distance)| *distance),
            next_cue_seconds: next
                .as_ref()
                .map(|(_, _, distance)| *distance as f64 / frames_per_second),
            spent_ids,
            spent_cues,
            cue_health,
            cues_broken,
            macro_library_len: macro_library.as_ref().map(MacroLibraryView::len),
            armed_at: armed_at.map(|position| position.describe()),
            drive,
            sequential_started,
            sequential_due: sequential_due.map(|position| position.describe()),
            sequential_next_id,
            sequential_at_end,
            rehearsing,
            rehearsal_plan,
            cues_fired: orders,
            cues_delivered: delivered,
            cues_blocked: blocked,
            cues_nothing: nothing,
            forwarding_error: self.forwarding_error.lock().ok().and_then(|e| e.clone()),
            as_run_error: self.as_run_error.lock().ok().and_then(|e| e.clone()),
            cues_failed: failed,
            cues_cancelled: deliveries.as_ref().map(|d| d.cancelled).unwrap_or(0),
            cues_dropped: deliveries.as_ref().map(|d| d.dropped).unwrap_or(0),
            cues_unconfirmed_writes: deliveries.as_ref().map(|d| d.unconfirmed_writes).unwrap_or(0),
            fired_unconfirmed: unconfirmed,
            deliveries_deferred: deferred,
            deliveries_lost: lost,
        }
    }

    pub fn snapshot(&self) -> TimecodeSnapshot {
        self.snapshot_at(std::time::Instant::now())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cue(id: &str, seconds: u32, frames: u32) -> TimecodeCue {
        TimecodeCue {
            macro_id: None,
            macro_hash: None,
            id: id.to_string(),
            number: String::new(),
            group: String::new(),
            at: TimecodePosition::new(0, 0, seconds, frames, TimecodeRate::Fps25, false).expect("a position"),
            macro_index: Some(0),
            duration_ms: None,
            repeat: None,
            repeats: false,
            enabled: true,
            label: String::new(),
            note: String::new(),
        }
    }

    fn at(seconds: u32, frames: u32) -> TimecodePosition {
        TimecodePosition::new(0, 0, seconds, frames, TimecodeRate::Fps25, false).expect("a position")
    }

    /// A position in a **named** format, for the tests about one show and more than one frame rate.
    fn at_rate(hours: u32, minutes: u32, seconds: u32, frames: u32, rate: TimecodeRate) -> TimecodePosition {
        TimecodePosition::new(hours, minutes, seconds, frames, rate, false).expect("a position")
    }

    /// A cue whose label was written in a named format.
    fn cue_at(id: &str, rate: TimecodeRate, hours: u32, minutes: u32, seconds: u32, frames: u32) -> TimecodeCue {
        let mut cue = cue(id, 0, 0);
        cue.at = at_rate(hours, minutes, seconds, frames, rate);
        cue
    }

    /// A cue number is a decimal, and the stored form is canonical so two spellings of one number are one number.
    ///
    /// The grammar is what makes "two cues share a number" a string comparison: without canonicalisation `7` and
    /// `007` would be two labels for the same cue, and a system told "go to cue 7" could not tell which. A number
    /// that is not a decimal is refused rather than stored, because a label nobody can address is worse than none.
    #[test]
    fn a_cue_number_is_a_decimal_stored_in_one_canonical_form() {
        for (written, stored) in [
            ("1", "1"),
            ("007", "7"),
            ("0", "0"),
            ("00.50", "0.5"),
            ("12.5", "12.5"),
            ("1.50", "1.5"),
            ("12.05", "12.05"),
            (" 3 ", "3"),
            ("10.0", "10"),
        ] {
            assert_eq!(
                canonical_cue_number(written).as_deref(),
                Some(stored),
                "'{written}' is the number {stored}"
            );
        }
        for not_a_number in ["", "   ", ".", ".5", "5.", "1.2.3", "-1", "+1", "1,5", "one", "1 2", "1e3"] {
            assert_eq!(
                canonical_cue_number(not_a_number),
                None,
                "'{not_a_number}' is not a decimal, so it must be refused rather than stored"
            );
        }
    }

    /// The semantics of playing: a crossing fires, once, and moving backwards arms it again.
    ///
    /// The threshold here is deliberately enormous, so **every** move in this test is playback: the distinction
    /// between playing and seeking is a policy (see the test below), and mixing the two in one list would test the
    /// policy twice and the semantics not at all — which is exactly what the first version of this test did.
    #[test]
    fn playing_into_a_cue_fires_it_once_and_a_backward_move_arms_it_again() {
        let mut list = CueList::new(vec![cue("a", 10, 0), cue("b", 20, 0)], 25 * 3600);

        // The first position arms the engine and fires nothing, wherever it is: a source that appears at 00:00:30
        // must not fire the cues at 00:00:10 and 00:00:20 on its way in.
        assert!(list.feed(at(30, 0), None).is_empty(), "the first position only arms");

        // Moving backwards before anything has been spent reports nothing: there is nothing to re-arm yet, and an
        // event with a count of zero would be noise in the log.
        assert!(list.feed(at(5, 0), None).is_empty(), "moving backwards fires nothing");
        let events = list.feed(at(10, 0), None);
        assert_eq!(
            events,
            vec![CueEvent::Fired {
                macro_id: None,
                id: "a".to_string(),
                at: "00:00:10:00".to_string(),
                macro_index: Some(0)
            }],
            "playing into a cue fires it"
        );
        assert!(list.feed(at(10, 0), None).is_empty(), "the same position again fires nothing");
        assert!(list.feed(at(11, 0), None).is_empty(), "and neither does moving on");

        let events = list.feed(at(0, 0), None);
        assert_eq!(
            events,
            vec![CueEvent::Rearmed {
                // One, not two: only a cue that had **fired** has a state to undo. The cue at 00:00:20 was never
                // spent — the engine armed at 00:00:30, behind it — so it was already armed and there is nothing to
                // re-arm. The count reports changes of state, not how many cues are armed.
                count: 1,
                position: "00:00:00:00".to_string()
            }],
            "a backward move re-arms what had fired"
        );
        let first = list.feed(at(10, 0), None);
        assert!(matches!(first.as_slice(), [CueEvent::Fired { id, .. }] if id == "a"));
        let second = list.feed(at(20, 0), None);
        assert!(matches!(second.as_slice(), [CueEvent::Fired { id, .. }] if id == "b"));
    }

    /// The policy that separates playing from seeking: a jump larger than the threshold **names** the cues it
    /// crossed instead of firing them, and they are spent — a scene skipped by a seek must leave a trace.
    #[test]
    fn a_seek_past_cues_names_them_instead_of_firing() {
        let mut list = CueList::new(vec![cue("a", 10, 0), cue("b", 20, 0)], 25);
        list.feed(at(0, 0), None);
        let events = list.feed(at(25, 0), None);
        assert_eq!(
            events,
            vec![
                CueEvent::Skipped {
                    id: "a".to_string(),
                    at: "00:00:10:00".to_string(),
                    jumped_ms: 25_000,
                    arrival_gap_ms: None,
                    across_silence: false,
                },
                CueEvent::Skipped {
                    id: "b".to_string(),
                    at: "00:00:20:00".to_string(),
                    jumped_ms: 25_000,
                    arrival_gap_ms: None,
                    across_silence: false,
                },
            ],
            "a seek names every cue it skipped"
        );
        assert!(list.feed(at(26, 0), None).is_empty(), "and they are spent, not waiting to fire later");

        // A one-frame step is playback: it fires the cue it reaches.
        let mut list = CueList::new(vec![cue("c", 10, 0)], 25);
        list.feed(at(9, 24), None);
        let events = list.feed(at(10, 0), None);
        assert!(matches!(events.as_slice(), [CueEvent::Fired { id, .. }] if id == "c"));
    }

    /// **A dropout and a seek produce the same jump, and must not produce the same sentence.**
    ///
    /// This is the reliability gap in one test. Two lists, two identical 25-second jumps, and the only difference
    /// between them is how long the door was silent before the second position arrived — one source reporting
    /// normally, one that had been gone for over a second. Without the gap the two runs are byte-identical, which is
    /// what the engine used to do, and why an operator could not tell *"the show was moved"* from *"the timecode
    /// stopped arriving and came back somewhere else"*. The second one is a fault to go and look at.
    ///
    /// The distance is asserted to be **the same in both runs** on purpose: it is the proof that no comparison of
    /// positions could ever have told them apart, and therefore that the fix had to be a clock rather than arithmetic.
    #[test]
    fn a_jump_across_silence_is_told_apart_from_a_seek() {
        let run = |gap: Option<u64>| {
            let mut list = CueList::new(vec![cue("a", 10, 0)], 25);
            list.feed(at(0, 0), None);
            list.feed(at(25, 0), gap)
        };
        let seeked = run(Some(40)); // one frame of LTC: the source is alive and reporting
        let dropped = run(Some(1_200)); // the signal was gone for a second and a fifth
        let unpack = |events: &[CueEvent]| match events {
            [CueEvent::Skipped { jumped_ms, arrival_gap_ms, across_silence, .. }] => {
                (*jumped_ms, *arrival_gap_ms, *across_silence)
            }
            other => panic!("both runs must name the cue they crossed, got {other:?}"),
        };
        let (seek_jump, seek_gap, seek_silence) = unpack(&seeked);
        let (drop_jump, drop_gap, drop_silence) = unpack(&dropped);
        assert_eq!(seek_jump, drop_jump, "the two moves are the same distance");
        assert_eq!(seek_jump, 25_000, "measured in the source's own rate, in the unit a person reads");
        assert_eq!(seek_gap, Some(40));
        assert_eq!(drop_gap, Some(1_200));
        assert!(!seek_silence, "a move with the source reporting normally is a seek");
        assert!(drop_silence, "the SAME move after a second of silence is the signal having gone");
    }

    /// **The door measures the silence — which is a different property from classifying it.**
    ///
    /// The test above proves that a gap, *once measured*, becomes the right verdict. It cannot prove that anything
    /// measures it: it calls `feed` straight on the list, so `push_position` never runs. This one drives the door
    /// itself with two real instants and reads back what the ledger recorded.
    ///
    /// **It exists because the mutation harness said so.** Replacing the measurement with `None` left every test in
    /// this file green — the mutation was reported `MISSED`, which reads as "the contract is blind" and in this case
    /// meant "there is no contract for this at all". A property with no contract behind it is one that can be deleted
    /// by anybody tidying up, and a gap computation that nothing reads looks exactly like an unused local.
    #[test]
    fn the_door_measures_the_silence_and_the_skip_carries_it() {
        let skip_after = |gap_ms: u64| {
            let state = TimecodeState::new(std::time::Duration::from_millis(750));
            state.configure_cues(vec![cue("a", 10, 0)], None);
            let start = std::time::Instant::now();
            // The first arrival arms the engine and has no previous instant to measure from.
            state.push_position(at(0, 0), start);
            state.push_position(at(25, 0), start + std::time::Duration::from_millis(gap_ms));
            state
                .pending_cues()
                .iter()
                .find_map(|stamped| match &stamped.event {
                    CueEvent::Skipped { jumped_ms, arrival_gap_ms, across_silence, .. } => {
                        Some((*jumped_ms, *arrival_gap_ms, *across_silence))
                    }
                    _ => None,
                })
                .expect("the door must have recorded the skip it caused")
        };
        // A source reporting normally: the same 25-second jump, read as the show having been moved.
        let (seek_jump, seek_gap, seek_silence) = skip_after(40);
        assert_eq!(seek_jump, 25_000, "the distance is measured at the door");
        assert_eq!(seek_gap, Some(40), "and so is the silence before the arrival");
        assert!(!seek_silence, "40 ms is a source that is alive, so this is a seek");
        // The SAME jump after the signal was gone: only the silence differs, and it is the whole answer.
        let (drop_jump, drop_gap, drop_silence) = skip_after(1_200);
        assert_eq!(drop_jump, seek_jump, "the two moves are the same distance — no arithmetic could tell them apart");
        assert_eq!(drop_gap, Some(1_200));
        assert!(drop_silence, "and the silence is what makes it the fault it is");
    }

    /// **The as-run record: what the show did, in memory, and when it is due to be written.**
    ///
    /// The engine decides *when*; the host owns the path and the write. Nothing here touches a file, which is what
    /// lets the record exist at all in an engine that does no I/O.
    mod as_run {
        use super::*;
        use std::time::{Duration, Instant};

        fn fired(id: &str) -> CueEvent {
            CueEvent::Fired {
                id: id.to_string(),
                at: "00:00:10:00".to_string(),
                macro_id: None,
                macro_index: None,
            }
        }

        fn skipped(id: &str) -> CueEvent {
            CueEvent::Skipped {
                id: id.to_string(),
                at: "00:00:30:00".to_string(),
                jumped_ms: 30_000,
                arrival_gap_ms: Some(1_200),
                across_silence: true,
            }
        }

        #[test]
        fn a_line_carries_what_the_engine_decided_and_no_outcome_yet() {
            let mut record = AsRunRecord::default();
            record.append(7, &fired("cue-1"), 1_700_000_000_000, "12");
            let lines: Vec<_> = record.lines().iter().collect();
            assert_eq!(lines.len(), 1);
            assert_eq!(lines[0].seq, 7);
            assert_eq!(lines[0].id, "cue-1");
            assert_eq!(lines[0].number, "12");
            assert_eq!(lines[0].at, "00:00:10:00");
            assert_eq!(lines[0].spent, "fired");
            assert_eq!(lines[0].wall_ms, 1_700_000_000_000);
            assert_eq!(
                lines[0].outcome, None,
                "the engine decided; nobody has said what happened, and that is not the same as `nothing`"
            );
        }

        #[test]
        fn a_skip_carries_why_so_the_record_explains_itself() {
            let mut record = AsRunRecord::default();
            record.append(1, &skipped("cue-3"), 1_700_000_000_000, "");
            let line = record.lines().front().cloned().expect("a line");
            assert_eq!(line.spent, "skipped");
            assert_eq!(
                line.across_silence,
                Some(true),
                "without this a dropout and a deliberate seek are the same line on paper"
            );
            assert_eq!(line.jumped_ms, Some(30_000), "and the line says how far, too");
        }

        #[test]
        fn a_re_arm_is_not_a_line() {
            let mut record = AsRunRecord::default();
            record.append(1, &CueEvent::Rearmed { count: 3, position: "00:00:05:00".to_string() }, 0, "");
            assert!(
                record.lines().is_empty(),
                "a record of what RAN must not fill with 'and then nothing ran' — it would push the lines an operator needs out of the bound"
            );
        }

        #[test]
        fn the_bound_drops_the_oldest_and_stays_at_the_stated_number() {
            let mut record = AsRunRecord::default();
            for seq in 1..=(AS_RUN_LINES as u64 + 50) {
                record.append(seq, &fired("cue-1"), 0, "");
            }
            assert_eq!(record.lines().len(), AS_RUN_LINES);
            assert_eq!(record.lines().front().map(|line| line.seq), Some(51), "the oldest went, and only the oldest");
        }

        #[test]
        fn nothing_is_due_when_nothing_has_changed() {
            let record = AsRunRecord::default();
            let now = Instant::now();
            assert!(!record.due(now), "a record that has not moved is not written");
            assert!(record.batch(now, false).is_none());
        }

        #[test]
        fn the_count_bound_fires_before_the_clock_does() {
            let mut record = AsRunRecord::default();
            for seq in 1..=AS_RUN_FLUSH_AFTER as u64 {
                record.append(seq, &fired("cue-1"), 0, "");
            }
            assert!(record.due(Instant::now()), "enough lines is enough, however recently they arrived");
        }

        #[test]
        fn the_time_bound_fires_when_the_list_is_quiet() {
            let mut record = AsRunRecord::default();
            record.append(1, &fired("cue-1"), 0, "");
            let oldest = record.oldest_unsaved.expect("an unsaved line records when it arrived");
            assert!(!record.due(oldest), "not due at the instant it arrived");
            let just_short = oldest + Duration::from_millis(AS_RUN_INTERVAL_MS - 1);
            assert!(!record.due(just_short), "and not one millisecond short of the interval");
            let due = oldest + Duration::from_millis(AS_RUN_INTERVAL_MS);
            assert!(record.due(due), "due AT the interval, because the bound is a promise about the longest wait");
        }

        #[test]
        fn only_a_successful_acknowledged_snapshot_clears_the_debt() {
            let mut record = AsRunRecord::default();
            // Made due by the COUNT, because one line at the instant it arrived is deliberately not due: the two
            // bounds are a promise about the longest wait, not a rule that every change is written at once.
            for seq in 1..=AS_RUN_FLUSH_AFTER as u64 {
                record.append(seq, &fired("cue-1"), 0, "");
            }
            let now = Instant::now();
            assert_eq!(record.batch(now, false).map(|(_, lines)| lines.len()), Some(AS_RUN_FLUSH_AFTER));
            let revision = record.batch(now, false).unwrap().0;
            assert!(record.batch(now, false).is_some(), "a dropped or failed write must retry");
            record.settle(1, CueOutcome::Cancelled);
            record.acknowledge(revision);
            assert!(record.batch(now, true).is_some(), "a concurrent outcome is still dirty");
            record.acknowledge(record.revision);
            assert!(record.batch(now, true).is_none());
        }

        #[test]
        fn a_confirmation_changes_the_line_and_makes_the_record_dirty_again() {
            let mut record = AsRunRecord::default();
            for seq in 1..=AS_RUN_FLUSH_AFTER as u64 {
                record.append(seq, &fired("cue-1"), 0, "");
            }
            let now = Instant::now();
            let (revision, _) = record.batch(now, false).expect("the batch, made due by the count");
            record.acknowledge(revision);
            record.settle(4, CueOutcome::Delivered);
            let settled = record.lines().iter().find(|line| line.seq == 4).and_then(|line| line.outcome);
            assert_eq!(settled, Some(CueOutcome::Delivered), "the line the order produced is the one that carries it");
            assert_eq!(record.unsaved, 1, "the outcome is a change to what is on disk");
            record.settle(999, CueOutcome::Failed);
            assert_eq!(
                record.unsaved, 1,
                "a confirmation for a line the bound has already dropped settles nothing, and must not make the record dirty"
            );
        }

        #[test]
        fn a_restored_record_is_not_due() {
            let mut record = AsRunRecord::default();
            let line = AsRunLine {
                seq: 1,
                id: "cue-1".to_string(),
                number: String::new(),
                at: "00:00:10:00".to_string(),
                spent: "fired".to_string(),
                wall_ms: 1,
                outcome: Some(CueOutcome::Delivered),
                across_silence: None,
                jumped_ms: None,
                arrival_gap_ms: None,
            };
            record.restore(vec![line]);
            assert_eq!(record.lines().len(), 1);
            assert!(
                !record.due(Instant::now()),
                "what was just read from disk is already on disk: a boot that wrote it back would rewrite the same file on every start and call it progress"
            );
        }

        #[test]
        fn a_restored_record_longer_than_the_bound_is_trimmed() {
            let mut record = AsRunRecord::default();
            let line = AsRunLine {
                seq: 1,
                id: "cue-1".to_string(),
                number: String::new(),
                at: "00:00:10:00".to_string(),
                spent: "fired".to_string(),
                wall_ms: 1,
                outcome: None,
                across_silence: None,
                jumped_ms: None,
                arrival_gap_ms: None,
            };
            record.restore(vec![line; AS_RUN_LINES + 10]);
            assert_eq!(
                record.lines().len(),
                AS_RUN_LINES,
                "a file written by a version with a bigger bound must not reopen the bound"
            );
        }
    }

    /// The two edges of the rule, because a threshold is only a policy when its edges are pinned.
    ///
    /// - a gap **on** the threshold is a seek (the comparison is strictly greater, and saying which side an exact
    ///   value falls on is the difference between a rule and a coincidence);
    /// - **no previous arrival** is not a silence. The first position after a list is installed arrives with nothing
    ///   to measure from, and calling that a dropout would put a fault on screen at every list load.
    #[test]
    fn the_silence_threshold_has_edges_and_no_previous_arrival_is_not_a_silence() {
        let silence_of = |gap: Option<u64>| {
            let mut list = CueList::new(vec![cue("a", 10, 0)], 25);
            list.feed(at(0, 0), None);
            match list.feed(at(25, 0), gap).as_slice() {
                [CueEvent::Skipped { across_silence, .. }] => *across_silence,
                other => panic!("expected one skip, got {other:?}"),
            }
        };
        assert!(!silence_of(Some(ARRIVAL_GAP_THRESHOLD_MS)), "exactly at the threshold is still a seek");
        assert!(silence_of(Some(ARRIVAL_GAP_THRESHOLD_MS + 1)), "one millisecond past it is a dropout");
        assert!(!silence_of(None), "with no previous arrival measured there is no silence to report");
    }

    /// with no macro fires nothing and says so; a repeating cue fires every time.
    #[test]
    fn ties_disabled_cues_and_repeats_behave_as_listed() {
        let mut first = cue("a", 10, 0);
        first.macro_index = Some(1);
        let mut second = cue("b", 10, 0);
        second.macro_index = Some(2);
        let mut list = CueList::new(vec![first, second], 25 * 3600);
        list.feed(at(0, 0), None);
        let events = list.feed(at(10, 0), None);
        assert_eq!(events.len(), 2, "both fire: {events:?}");
        assert!(matches!(&events[0], CueEvent::Fired { macro_index: Some(1), .. }));
        assert!(matches!(&events[1], CueEvent::Fired { macro_index: Some(2), .. }));

        // Disabled: never fires, and is not spent either (it is simply not in the show).
        let mut disabled = cue("c", 30, 0);
        disabled.enabled = false;
        let mut list = CueList::new(vec![disabled], 25 * 3600);
        list.feed(at(0, 0), None);
        assert!(list.feed(at(30, 0), None).is_empty(), "a disabled cue never fires");

        // No macro chosen: the cue is crossed, counted as spent, and the event carries no macro rather than
        // pretending the first one in the library was meant.
        let mut unwritten = cue("d", 40, 0);
        unwritten.macro_index = None;
        let mut list = CueList::new(vec![unwritten], 25 * 3600);
        list.feed(at(0, 0), None);
        let events = list.feed(at(40, 0), None);
        assert!(matches!(events.as_slice(), [CueEvent::Fired { macro_index: None, .. }]), "{events:?}");
        assert!(list.feed(at(41, 0), None).is_empty(), "and it is spent like any other");

        // A repeat stays armed, and fires on every **crossing** — not on every report: a cue that fired at
        // 00:00:50 does not fire again merely because the position is now 00:00:51, which is the difference between
        // a cue and an alarm.
        let mut repeating = cue("e", 50, 0);
        repeating.repeats = true;
        let mut list = CueList::new(vec![repeating], 25 * 3600);
        list.feed(at(0, 0), None);
        assert_eq!(list.feed(at(50, 0), None).len(), 1, "crossed once");
        assert!(list.feed(at(51, 0), None).is_empty(), "and moving on does not fire it again");
        assert!(list.feed(at(49, 0), None).is_empty(), "going back crosses nothing");
        assert_eq!(list.feed(at(50, 0), None).len(), 1, "crossing it again fires it again");
    }

    /// What the clock shows: the next armed cue and how far away it is, which is what an operator reads before a
    /// cue is due.
    #[test]
    fn the_next_cue_is_the_next_one_that_will_fire() {
        let mut list = CueList::new(vec![cue("a", 10, 0), cue("b", 20, 0)], 25 * 3600);
        let (next, distance) = list.next_cue(at(0, 0)).expect("a next cue");
        assert_eq!(next.id, "a");
        assert_eq!(distance, 10 * 25, "the distance in frames");

        // A spent cue is not the next one any more.
        list.feed(at(0, 0), None);
        list.feed(at(10, 0), None);
        let (next, _) = list.next_cue(at(10, 0)).expect("a next cue");
        assert_eq!(next.id, "b");

        // Nothing armed ahead: the clock has nothing to show, and says so by showing nothing.
        list.feed(at(20, 0), None);
        assert!(list.next_cue(at(20, 0)).is_none());

        // A source change resets the engine: the next position arms rather than firing a burst.
        list.reset();
        assert!(list.feed(at(20, 0), None).is_empty(), "after a reset the first position only arms");
    }

    /// What a window that opened **late** can still be told, with no events left to announce: which cues are already
    /// spent, which one is next by id, and where the engine armed.
    ///
    /// This is the case the window could not paint before: the live `timecode-cue` events are how a window that was
    /// watching marks a row, and a window that starts afterwards has missed all of them. Nothing here changes the
    /// firing — it is state the engine already had and threw away. Returning an empty `spent_ids`, or dropping the
    /// arm point from the snapshot, turns this red.
    #[test]
    fn the_snapshot_says_what_already_happened_before_a_window_opened() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        state.configure_cues(vec![cue("a", 10, 0), cue("b", 20, 0), cue("c", 30, 0)], None);
        let now = std::time::Instant::now();

        // Nothing has arrived: no arm point, nothing spent, and no next cue to name.
        let before = state.snapshot_at(now);
        assert_eq!(before.armed_at, None);
        assert!(before.spent_ids.is_empty());
        assert_eq!(before.next_cue_id, None);

        // The show arms at 00:00:09:00 and plays into 00:00:10:00, then on: the first cue is spent and the second is
        // next — which is exactly what a clock opened at 00:00:11:00 has to be able to show.
        state.push_position(at(9, 0), now);
        state.push_position(at(10, 0), now);
        state.push_position(at(11, 0), now);
        let after = state.snapshot_at(now);
        assert_eq!(after.armed_at.as_deref(), Some("00:00:09:00"), "the arm point the late window missed");
        assert_eq!(after.spent_ids, vec!["a".to_string()], "the cue that went before it opened");
        assert_eq!(after.next_cue_id.as_deref(), Some("b"), "and which one is next, by id and not only by time");
        assert_eq!(after.next_cue.as_deref(), Some("00:00:20:00"));

        // A seek spends the cues it names as skipped, so `spent_ids` means "already dealt with", not "fired": the
        // snapshot cannot lie about the difference, and the ledger event is where the kind lives.
        state.push_position(at(31, 0), now);
        let sought = state.snapshot_at(now);
        assert_eq!(
            sought.spent_ids,
            vec!["a".to_string(), "b".to_string(), "c".to_string()],
            "skipped cues are spent too, and the list is sorted so a read can be compared"
        );
        assert_eq!(sought.next_cue_id, None, "nothing is armed ahead of the position");

        // Moving backwards re-arms what is ahead of the new position, and says where: the spent set and the arm point
        // have to move together, or a panel would paint a cue dimmed and offer it as the next one at the same time.
        state.push_position(at(15, 0), now);
        let back = state.snapshot_at(now);
        assert_eq!(back.armed_at.as_deref(), Some("00:00:15:00"), "where the list was re-armed");
        assert_eq!(back.spent_ids, vec!["a".to_string()], "only what is behind the new position stays spent");
        assert_eq!(back.next_cue_id.as_deref(), Some("b"), "and what was re-armed is the next one again");

        // A source change forgets all of it: the new source may start anywhere, and nothing has been crossed yet.
        state.reset_cues();
        let reset = state.snapshot_at(now);
        assert_eq!(reset.armed_at, None, "the previous source's arm point is not the new source's");
        assert!(reset.spent_ids.is_empty(), "and nothing it did is spent for the source that replaces it");
        // The cue behind the current position is armed again but is not "next": it fires when the show plays back to
        // it, which is the same rule as before the reset.
        assert_eq!(reset.next_cue_id.as_deref(), Some("b"));
    }

    /// The one thing `next_cue` alone cannot say: **which** of two cues at the same position is next.
    ///
    /// Two cues at the same frame fire in the list's own order, so the id the snapshot publishes has to be the first
    /// of them — the window marks the row by id, and resolving that tie again in every window is how two windows come
    /// to disagree about which cue is coming.
    #[test]
    fn the_next_cue_id_names_the_first_of_two_tied_cues() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        state.configure_cues(vec![cue("tie-1", 10, 0), cue("tie-2", 10, 0)], None);
        let now = std::time::Instant::now();
        // The first position only arms, and it is behind the cues so they are both ahead of it.
        state.push_position(at(0, 0), now);
        let snapshot = state.snapshot_at(now);
        assert_eq!(snapshot.next_cue.as_deref(), Some("00:00:10:00"));
        assert_eq!(
            snapshot.next_cue_id.as_deref(),
            Some("tie-1"),
            "the position alone could not say which of the two fires first"
        );
        // Playing into them fires both, in the same order, and then there is no next cue to name. The step is one
        // second, which is playback rather than a seek, or the tie would be named as skipped instead of fired.
        state.push_position(at(9, 0), now);
        state.push_position(at(10, 0), now);
        let fired: Vec<String> = state
            .pending_cues()
            .into_iter()
            .filter_map(|entry| match entry.event {
                CueEvent::Fired { id, .. } => Some(id),
                _ => None,
            })
            .collect();
        assert_eq!(fired, vec!["tie-1".to_string(), "tie-2".to_string()], "the list order is the firing order");
        let after = state.snapshot_at(now);
        assert_eq!(after.next_cue_id, None);
        assert_eq!(after.spent_ids, vec!["tie-1".to_string(), "tie-2".to_string()]);
    }

    /// The offset is applied at the single door, so a source cannot forget it and the cue engine never compares a
    /// raw position against the show's timecode.
    #[test]
    fn the_offset_moves_every_source_and_is_applied_before_the_cues() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        let (sender, receiver) = std::sync::mpsc::sync_channel(8);
        // A cue at 00:00:05:00, and an offset of half a second: the source has to reach 00:00:04:12 for it to fire.
        state.configure_cues(
            vec![TimecodeCue {
                macro_id: None,
                macro_hash: None,
                id: "cue-1".to_string(),
                number: String::new(),
                group: String::new(),
                at: TimecodePosition::new(0, 0, 5, 0, TimecodeRate::Fps25, false).expect("a position"),
                macro_index: Some(0),
                duration_ms: None,
                repeat: None,
                repeats: false,
                enabled: true,
                label: String::new(),
                note: String::new(),
            }],
            Some(sender),
        );
        state.set_offset_frames(13);
        let now = std::time::Instant::now();
        let armed = state.push_position(at(4, 11), now).expect("a position");
        assert_eq!(armed.describe(), "00:00:04:24", "the readout shows the offset position");
        assert!(receiver.recv_timeout(std::time::Duration::from_millis(100)).is_err());
        state.push_position(at(4, 12), now);
        assert!(
            receiver.recv_timeout(std::time::Duration::from_millis(500)).is_ok(),
            "the cue is announced when the **offset** position reaches it"
        );
        assert!(
            state.pending_cues().iter().any(|entry| matches!(entry.event, CueEvent::Fired { .. })),
            "and it is recorded as fired, which is what the window confirms: {:?}",
            state.pending_cues()
        );

        // And with no offset the raw position is what counts.
        state.set_offset_frames(0);
        state.reset_cues();
        state.push_position(at(0, 0), now);
        assert!(receiver.recv_timeout(std::time::Duration::from_millis(100)).is_err());
        state.push_position(at(5, 0), now);
        // Five seconds in one step is a seek with the default threshold, which names the cue rather than firing it:
        // the point here is only that the offset is gone, which the position shows.
        assert_eq!(state.snapshot_at(now).position.as_deref(), Some("00:00:05:00"));
    }

    /// Changing the source arms the engine rather than firing a burst.
    ///
    /// This is what `reset_cues` is wired to, and the property is a show's: a new source starts wherever it starts,
    /// and every cue **before** that position must be treated as passed rather than fired. Without this, opening the
    /// MIDI ports in the middle of a show would fire every cue the position had gone past — the loudest possible bug.
    #[test]
    fn a_source_change_arms_the_engine_instead_of_firing_a_burst() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        let (sender, receiver) = std::sync::mpsc::sync_channel(8);
        state.configure_cues(
            vec![
                TimecodeCue {
                    macro_id: None,
                    macro_hash: None,
                    id: "early".to_string(),
                    number: String::new(),
                    group: String::new(),
                    at: TimecodePosition::new(0, 0, 1, 0, TimecodeRate::Fps25, false).expect("a position"),
                    macro_index: Some(0),
                    duration_ms: None,
                    repeat: None,
                    repeats: false,
                    enabled: true,
                    label: String::new(),
                    note: String::new(),
                },
                TimecodeCue {
                    macro_id: None,
                    macro_hash: None,
                    id: "late".to_string(),
                    number: String::new(),
                    group: String::new(),
                    at: TimecodePosition::new(0, 0, 9, 0, TimecodeRate::Fps25, false).expect("a position"),
                    macro_index: Some(1),
                    duration_ms: None,
                    repeat: None,
                    repeats: false,
                    enabled: true,
                    label: String::new(),
                    note: String::new(),
                },
            ],
            Some(sender),
        );
        let now = std::time::Instant::now();
        // A source appears at 00:00:10: nothing fires, and the cue behind it is treated as passed.
        assert!(state.push_position(at(10, 0), now).is_some());
        assert!(receiver.recv_timeout(std::time::Duration::from_millis(100)).is_err());

        // The source changes and the new one starts at 00:00:30, well past both cues: still nothing. This is the case
        // that would fire the burst if the engine were not armed.
        state.reset_cues();
        assert!(state.push_position(at(30, 0), now).is_some());
        assert!(
            receiver.recv_timeout(std::time::Duration::from_millis(100)).is_err(),
            "a source change must arm the engine rather than replay the cues it passed"
        );

        // And the show then plays into the cue after the new position.
        state.push_position(at(30, 1), now);
        state.push_position(at(30, 2), now);
        assert_eq!(state.snapshot_at(now).position.as_deref(), Some("00:00:30:02"));
    }

    /// One door for every source: a position pushed in from anywhere reaches the cues, the readout and the clock.
    ///
    /// This is the property that makes adding LTC — or anything else — safe: no source can bypass the cue engine, and
    /// the engine does not know or care which transport produced the position.
    #[test]
    fn a_position_from_any_source_reaches_the_cues() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        let (sender, receiver) = std::sync::mpsc::sync_channel(8);
        state.configure_cues(
            vec![TimecodeCue {
                macro_id: None,
                macro_hash: None,
                id: "cue-1".to_string(),
                number: String::new(),
                group: String::new(),
                at: TimecodePosition::new(0, 0, 5, 0, TimecodeRate::Fps25, false).expect("a position"),
                macro_index: Some(2),
                duration_ms: None,
                repeat: None,
                repeats: false,
                enabled: true,
                label: String::new(),
                note: String::new(),
            }],
            Some(sender),
        );
        let now = std::time::Instant::now();
        // The first position only arms, like every other source.
        assert!(state.push_position(at(0, 0), now).is_some());
        assert!(receiver.recv_timeout(std::time::Duration::from_millis(100)).is_err());
        // The show **plays** into the cue: a step small enough to be playback rather than a seek, which is what a
        // running timecode does. Jumping straight to five seconds would be a seek, and a seek names the cue instead
        // of firing it — the behaviour this very test would have hidden if it had jumped.
        state.push_position(at(4, 24), now);
        state.push_position(at(5, 0), now);
        assert!(
            receiver.recv_timeout(std::time::Duration::from_millis(500)).is_ok(),
            "the cue is announced"
        );
        let pending = state.pending_cues();
        assert!(
            pending.iter().any(|entry| matches!(entry.event, CueEvent::Fired { macro_index: Some(2), .. })),
            "and recorded with the macro it names: {pending:?}"
        );
        // The clock's own line sees it too.
        assert!(state.snapshot_at(now).position.as_deref() == Some("00:00:05:00"));
    }

    /// The three states an operator must be able to tell apart, and the injected clock that makes them testable
    /// without waiting for real time to pass.
    #[test]
    fn a_position_runs_goes_stale_and_comes_back() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        let start = std::time::Instant::now();

        // Nothing has arrived: the readout says so rather than showing a zero.
        let nothing = state.snapshot_at(start);
        assert_eq!(nothing.state, "nothing");
        assert!(nothing.position.is_none());

        // A full set of quarter frames produces a position, and the state becomes running.
        let pieces = [0x0Du8, 0x10, 0x2C, 0x30, 0x40, 0x50, 0x61, 0x72];
        let mut assembled = None;
        for byte in pieces {
            assembled = state.feed_system_message(&[0xF1, byte], start);
        }
        let position = assembled.expect("a complete set");
        assert_eq!(position.describe(), "01:00:12:15");
        let running = state.snapshot_at(start + std::time::Duration::from_millis(100));
        assert_eq!(running.state, "running");
        assert_eq!(running.position.as_deref(), Some("01:00:12:15"));
        assert_eq!(running.rate.as_deref(), Some("25"));
        assert!(!running.drop_frame);
        assert_eq!(running.pieces, 8);
        assert_eq!(running.positions, 1);

        // The signal stops: the position stays visible but the state says it is stale, because a frozen position
        // that still claims to be running is how a show looks like it is following something it is not.
        let stale = state.snapshot_at(start + std::time::Duration::from_millis(1500));
        assert_eq!(stale.state, "stale");
        assert_eq!(stale.position.as_deref(), Some("01:00:12:15"), "the last position is still shown");
        assert_eq!(stale.age_ms, Some(1500));

        // And it comes back: running again, from the new position.
        for byte in [0x00u8, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x72] {
            state.feed_system_message(&[0xF1, byte], start + std::time::Duration::from_millis(1600));
        }
        let resumed = state.snapshot_at(start + std::time::Duration::from_millis(1700));
        assert_eq!(resumed.state, "running");
        assert_eq!(resumed.position.as_deref(), Some("00:00:00:02"), "QF reception compensates two frames");
        assert_eq!(resumed.positions, 2);
    }

    /// Only MTC counts as timecode arriving: a clock tick or another application's SysEx must not be counted as a
    /// piece, and a full-frame message is read as one.
    #[test]
    fn only_mtc_is_counted_and_a_full_frame_is_read() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        let now = std::time::Instant::now();

        // Somebody else's messages.
        assert!(state.feed_system_message(&[0xF8], now).is_none(), "a clock tick");
        assert!(state.feed_system_message(&[0xF0, 0x41, 0x10, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0xF7], now).is_none());
        assert_eq!(state.snapshot_at(now).pieces, 0, "and neither is counted as timecode");

        // The full-frame message, which is how a sender says where it is at once.
        let position = state
            .feed_system_message(&[0xF0, 0x7F, 0x7F, 0x01, 0x01, 0x61, 0x00, 0x0C, 0x0F, 0xF7], now)
            .expect("a full frame");
        assert_eq!(position.describe(), "01:00:12:15");
        let snapshot = state.snapshot_at(now);
        assert_eq!(snapshot.pieces, 1);
        assert_eq!(snapshot.positions, 1);
        assert_eq!(snapshot.last_frame_number, Some(15));
        assert_eq!(snapshot.source, "MTC");

        // A quarter frame that is not one, or a corrupted digit, is not counted either: better nothing than a
        // position nobody sent.
        assert!(state.feed_system_message(&[0xF1, 0x80], now).is_none(), "the data byte is seven bits");
        let before = state.snapshot_at(now).pieces;
        for byte in [0x0Fu8, 0x12, 0x22, 0x31, 0x40, 0x50, 0x61, 0x72] {
            state.feed_system_message(&[0xF1, byte], now);
        }
        assert_eq!(
            state.snapshot_at(now).positions,
            1,
            "a set with a reserved high bit must not produce a position"
        );
        assert!(state.snapshot_at(now).pieces > before, "though the pieces were counted as they arrived");
    }

    /// The arithmetic round trips, and the drop-frame boundaries are the classic ones — the numbers that are
    /// skipped and the two that are not.
    #[test]
    fn frame_counts_and_positions_round_trip_including_drop_frame() {
        let plain = TimecodePosition::new(1, 0, 12, 15, TimecodeRate::Fps25, false).expect("1:00:12:15 at 25");
        assert_eq!(plain.to_frames(), 25 * (3600 + 12) + 15);
        assert_eq!(
            TimecodePosition::from_frames(plain.to_frames(), TimecodeRate::Fps25, false),
            plain
        );
        assert_eq!(plain.describe(), "01:00:12:15");

        // Drop-frame: at 29.97 the numbering skips 00 and 01 at the start of every minute except every tenth.
        let last_frame_of_minute =
            TimecodePosition::new(0, 0, 59, 29, TimecodeRate::Fps29_97, true).expect("00:00:59;29");
        assert_eq!(last_frame_of_minute.describe(), "00:00:59;29");
        let after = TimecodePosition::from_frames(last_frame_of_minute.to_frames() + 1, TimecodeRate::Fps29_97, true);
        assert_eq!(after.describe(), "00:01:00;02", "the two skipped numbers are skipped");
        // And every tenth minute keeps them, which is the half of the rule everybody forgets.
        let nine = TimecodePosition::new(0, 9, 59, 29, TimecodeRate::Fps29_97, true).expect("00:09:59;29");
        let ten = TimecodePosition::from_frames(nine.to_frames() + 1, TimecodeRate::Fps29_97, true);
        assert_eq!(ten.describe(), "00:10:00;00", "every tenth minute counts its two frames");

        // Every position round trips, drop-frame included.
        for frames in [0_i64, 1, 2, 1799, 1800, 17981, 17982, 18000, 107_892] {
            let position = TimecodePosition::from_frames(frames, TimecodeRate::Fps29_97, true);
            assert_eq!(
                position.to_frames(),
                frames,
                "{} did not round trip",
                position.describe()
            );
        }
    }

    /// A position that cannot exist is refused, and the refusal says which part is wrong.
    #[test]
    fn impossible_positions_are_refused() {
        assert!(TimecodePosition::new(0, 0, 0, 24, TimecodeRate::Fps24, false).is_err(), "no frame 24 at 24 fps");
        assert!(TimecodePosition::new(0, 60, 0, 0, TimecodeRate::Fps25, false).is_err(), "60 minutes");
        assert!(TimecodePosition::new(0, 0, 60, 0, TimecodeRate::Fps25, false).is_err(), "60 seconds");
        assert!(TimecodePosition::new(24, 0, 0, 0, TimecodeRate::Fps25, false).is_err(), "24 hours");
        assert!(
            TimecodePosition::new(0, 0, 0, 0, TimecodeRate::Fps25, true).is_err(),
            "drop-frame numbering only exists at 29.97"
        );
        assert!(
            TimecodePosition::new(0, 1, 0, 1, TimecodeRate::Fps29_97, true).is_err(),
            "frame number 1 at the start of a non-tenth minute is skipped"
        );
        assert!(
            TimecodePosition::new(0, 10, 0, 1, TimecodeRate::Fps29_97, true).is_ok(),
            "but every tenth minute counts it"
        );
    }

    /// Reading and writing a position in the notation an operator uses.
    #[test]
    fn a_position_is_parsed_and_written_the_way_operators_write_it() {
        let position = TimecodePosition::parse("01:00:12:15", TimecodeRate::Fps25).expect("a position");
        assert_eq!((position.hours, position.minutes, position.seconds, position.frames), (1, 0, 12, 15));
        assert_eq!(position.describe(), "01:00:12:15");

        // A semicolon is how drop-frame is written, and it is what selects the numbering.
        let drop = TimecodePosition::parse("00:01:00;02", TimecodeRate::Fps29_97).expect("a drop-frame position");
        assert!(drop.drop_frame);
        assert_eq!(drop.describe(), "00:01:00;02");

        // Refusals, each naming what is wrong.
        assert!(TimecodePosition::parse("", TimecodeRate::Fps25).is_err());
        assert!(TimecodePosition::parse("01:00:12", TimecodeRate::Fps25).is_err(), "three parts");
        assert!(TimecodePosition::parse("aa:00:12:15", TimecodeRate::Fps25).is_err(), "not a number");
        assert!(
            TimecodePosition::parse("00:00:00:30", TimecodeRate::Fps25).is_err(),
            "a frame that does not exist at that rate"
        );
    }

    #[test]
    fn independent_mma_vector_decodes_binary_rate_direction_and_latency() {
        // Published MMA Doc 4.2 example: 01:37:52:16 at 30 fps, before latency compensation.
        let vector = [0x00, 0x11, 0x24, 0x33, 0x45, 0x52, 0x61, 0x76];
        let decode = |bytes: &[u8]| {
            let mut a = MtcAssembler::new();
            bytes.iter().filter_map(|b| a.push(QuarterFrame::from_message(&[0xF1, *b]).unwrap())).last()
        };
        let forward = decode(&vector).unwrap();
        assert_eq!(forward.describe(), "01:37:52:18");
        assert_eq!(forward.rate, TimecodeRate::Fps30);
        let reverse: Vec<_> = vector.into_iter().rev().collect();
        assert_eq!(decode(&reverse).unwrap().describe(), "01:37:52:14");
        assert!(decode(&[0x00, 0x24, 0x11, 0x33, 0x45, 0x52, 0x61, 0x76]).is_none());
        let mut a = MtcAssembler::new();
        let now = std::time::Instant::now();
        for (i, b) in vector.iter().enumerate() {
            assert!(a.push_at(QuarterFrame::from_message(&[0xF1,*b]).unwrap(),
                now + std::time::Duration::from_millis(if i < 4 { 0 } else { 101 })).is_none());
        }
        // Invalid high bits and invalid binary ranges must never fabricate a cue.
        for (piece, data) in [(1, 2), (3, 4), (5, 4), (7, 8)] {
            assert!(a.push(QuarterFrame {piece, data}).is_none());
        }
    }

    /// The full-frame message MTC carries as SysEx, and the refusals that keep it from guessing.
    #[test]
    fn a_full_frame_message_is_read() {
        let mut assembler = MtcAssembler::new();
        // 01:00:12:15 at 30 fps (rate code 3): F0 7F 7F 01 01 hr mn se fr F7.
        // Binary fields: decimal 12 seconds / 15 frames are 0x0C / 0x0F.
        let bytes = [0xF0, 0x7F, 0x7F, 0x01, 0x01, 0x61, 0x00, 0x0C, 0x0F, 0xF7];
        let position = assembler.push_full_frame(&bytes).expect("a full frame");
        assert_eq!(position.describe(), "01:00:12:15");
        assert_eq!(position.rate, TimecodeRate::Fps30);

        // Drop-frame is rate code 2.
        let drop = assembler
            // Rate code 2 (29.97 drop) in the top three bits, and **zero** hours: 0x41 would be one hour, which is
            // what this assertion caught.
            .push_full_frame(&[0xF0, 0x7F, 0x7F, 0x01, 0x01, 0x40, 0x01, 0x00, 0x02, 0xF7])
            .expect("a drop-frame full frame");
        assert!(drop.drop_frame);
        assert_eq!(drop.describe(), "00:01:00;02");

        // SysEx for somebody else is refused rather than interpreted, and so is a message that is too short.
        assert!(assembler.push_full_frame(&[0xF0, 0x41, 0x10, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0xF7]).is_none());
        assert!(assembler.push_full_frame(&[0xF0, 0x7F, 0x7F]).is_none());
        // A quarter frame that is not one is refused too.
        assert!(QuarterFrame::from_message(&[0xF8, 0x00]).is_none());
        assert!(QuarterFrame::from_message(&[0xF1]).is_none());
        assert!(QuarterFrame::from_message(&[0xF1, 0x80]).is_none(), "the data byte is seven bits");
    }

    /// The rate codes MTC uses, both ways.
    #[test]
    fn the_mtc_rate_codes_are_the_ones_the_specification_defines() {
        assert_eq!(TimecodeRate::from_mtc_code(0), TimecodeRate::Fps24);
        assert_eq!(TimecodeRate::from_mtc_code(1), TimecodeRate::Fps25);
        assert_eq!(TimecodeRate::from_mtc_code(2), TimecodeRate::Fps29_97);
        assert_eq!(TimecodeRate::from_mtc_code(3), TimecodeRate::Fps30);
        assert_eq!(TimecodeRate::Fps29_97.to_mtc_code(), 2);
        assert_eq!(TimecodeRate::Fps25.to_mtc_code(), 1);
        assert!(TimecodeRate::Fps29_97.supports_drop_frame());
        assert!(!TimecodeRate::Fps24.supports_drop_frame());
    }

    /// The frame count and the position it came from are inverses, over a whole day, at every rate.
    ///
    /// Written **before** the fix, because reading the drop-frame branch said it was fine and it was not: it treated a
    /// ten-minute block as 18 000 frames when a drop-frame block is 17 982, so the error accumulated across the day and
    /// the last frame of the day came out as `23:59:59;27` instead of `23:59:59;29`. Exhaustive rather than sampled,
    /// because the error only shows near the ends of blocks.
    #[test]
    fn a_frame_count_and_its_position_are_inverses_for_a_whole_day() {
        for rate in [TimecodeRate::Fps24, TimecodeRate::Fps25, TimecodeRate::Fps29_97, TimecodeRate::Fps30] {
            let drop_frame = rate.supports_drop_frame();
            let frames_in_a_day = TimecodePosition::frames_in_a_day(rate, drop_frame);
            for total in 0..frames_in_a_day {
                let position = TimecodePosition::from_frames(total, rate, drop_frame);
                assert_eq!(
                    position.to_frames(),
                    total,
                    "{rate:?} frame {total} came back as {}",
                    position.describe()
                );
            }
        }
    }

    /// A frame count before zero is the end of the previous day, not a huge number of hours.
    ///
    /// The old code decomposed with `/` and `%` and cast to `u32`, so a negative offset near midnight produced fields
    /// like `4294967295` — a position that cannot exist, shown to an operator, and compared against cues.
    #[test]
    fn a_frame_count_before_zero_is_the_end_of_the_previous_day() {
        assert_eq!(
            TimecodePosition::from_frames(-1, TimecodeRate::Fps25, false).describe(),
            "23:59:59:24"
        );
        assert_eq!(
            TimecodePosition::from_frames(-1, TimecodeRate::Fps29_97, true).describe(),
            "23:59:59;29",
            "at drop-frame the day ends on the last number the numbering actually uses"
        );
        // A whole day before, and a whole day after, are the same moment: the clock is a day long.
        let day = TimecodePosition::frames_in_a_day(TimecodeRate::Fps25, false);
        assert_eq!(
            TimecodePosition::from_frames(-day, TimecodeRate::Fps25, false),
            TimecodePosition::from_frames(0, TimecodeRate::Fps25, false)
        );
    }

    /// And the same thing through the door every source uses, because that is where an operator meets it.
    #[test]
    fn a_negative_offset_near_midnight_produces_a_position_that_exists() {
        let state = TimecodeState::new(std::time::Duration::from_millis(500));
        state.set_offset_frames(-1);
        let midnight = TimecodePosition::new(0, 0, 0, 0, TimecodeRate::Fps25, false).expect("midnight");
        let shifted = state
            .push_position(midnight, std::time::Instant::now())
            .expect("a position");
        assert_eq!(shifted.describe(), "23:59:59:24");
        assert!(
            shifted.hours < 24 && shifted.minutes < 60 && shifted.seconds < 60 && shifted.frames < 25,
            "every field has to be one the notation can hold: {}",
            shifted.describe()
        );
    }

    /// The terminator is part of the message: a malformed tail is refused rather than parsed as a prefix.
    #[test]
    fn a_full_frame_message_with_a_wrong_terminator_is_refused() {
        let mut assembler = MtcAssembler::new();
        assert!(
            assembler
                .push_full_frame(&[0xF0, 0x7F, 0x7F, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00])
                .is_none(),
            "a SysEx with no F7 is not a full-frame message"
        );
        assert!(
            assembler
                .push_full_frame(&[0xF0, 0x7F, 0x7F, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0xF7, 0x00])
                .is_none(),
            "and neither is one with bytes after the terminator"
        );
        assert!(
            assembler
                .push_full_frame(&[0xF0, 0x7F, 0x7F, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0xF7])
                .is_some(),
            "while the real shape is still accepted"
        );
    }

    // ── The delivery contract ───────────────────────────────────────────────────────────────────────
    //
    // These are the tests that make "a cue consumed and a macro never run, with nothing said" impossible. Each one
    // describes a way the order could be lost — a full channel, a window that never answers, a ledger that overflowed
    // — and demands that the order is still counted and still readable. Removing the ledger from `fire_cues` turns
    // every one of them red, which is what gives the contract its teeth.

    /// The case the study found: **the channel is full**, so the hand-over is refused. The cue must not be lost —
    /// it stays in the ledger, it is counted, and the window can still pick it up and confirm it.
    #[test]
    fn a_full_hand_over_queue_defers_a_fired_cue_instead_of_losing_it() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        // The doorbell has room for one ring and nobody is answering it, so the ring that announces the second cue
        // is refused — which is what a full channel does in the middle of a show.
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        state.configure_cues(vec![cue("a", 10, 0), cue("b", 20, 0)], Some(sender));
        let now = std::time::Instant::now();
        let play = |frames: i64| {
            state.push_position(TimecodePosition::from_frames(frames, TimecodeRate::Fps25, false), now);
        };
        // Arm at 00:00:09:00 and **play** into both cues (one frame at a time, so neither crossing is a seek).
        play(9 * 25);
        play(10 * 25);
        for frames in (10 * 25 + 1)..=(20 * 25) {
            play(frames);
        }

        let snapshot = state.snapshot_at(now);
        assert_eq!(snapshot.cues_fired, 2, "both cues were crossed and fired");
        assert_eq!(snapshot.deliveries_deferred, 1, "the full channel refused exactly one hand-over");
        assert_eq!(
            snapshot.fired_unconfirmed, 2,
            "and the orders the window has not confirmed are **counted**: a dropped hand-over is not a lost cue"
        );
        assert_eq!(snapshot.cues_delivered, 0, "nothing has been confirmed yet");
        assert_eq!(snapshot.deliveries_lost, 0, "nothing was lost: the ledger holds both events");

        // The doorbell rang once and was refused the second time — and neither ring carried the events, because the
        // ledger is the record: both fired cues are still readable whether the ring arrived or not.
        assert!(receiver.try_recv().is_ok(), "the first ring was delivered");
        assert!(receiver.try_recv().is_err(), "and the second one was refused, not queued");
        let pending = state.pending_cues();
        assert_eq!(pending.len(), 2, "both fired events are still readable: {pending:?}");
        assert!(pending[0].seq < pending[1].seq, "the receipts come in the order the cues fired");
        assert!(
            state.pending_after(pending[0].seq).iter().all(|entry| entry.seq > pending[0].seq),
            "a sweep after a receipt announces only what is newer than it"
        );
        assert!(matches!(&pending[0].event, CueEvent::Fired { id, .. } if id == "a"));
        assert!(matches!(&pending[1].event, CueEvent::Fired { id, .. } if id == "b"));

        // The window did its job: it confirms both, and the counter clears.
        let confirmations = [(pending[0].seq, CueOutcome::Delivered), (pending[1].seq, CueOutcome::Delivered)];
        assert_eq!(state.confirm_cues(&confirmations), 2, "both orders were waiting");
        assert_eq!(state.snapshot_at(now).fired_unconfirmed, 0, "nothing is left unconfirmed");
        assert_eq!(state.snapshot_at(now).cues_delivered, 2);
        assert_eq!(state.pending_cues().len(), 0);
        // A retried hand-over can confirm the same receipt twice: the second one is nothing left to do, not a
        // second count of a macro that ran once.
        assert_eq!(state.confirm_cues(&confirmations), 0);
        assert_eq!(state.snapshot_at(now).cues_delivered, 2, "and it does not double-count");
    }

    /// The retry, measured: a ring the doorbell had to refuse still delivers everything, because the sweep the
    /// consumer runs on the **next** ring announces the whole ledger from the last receipt it announced.
    ///
    /// This is the difference between "the event was counted" and "the macro runs anyway", and it is the reason the
    /// channel carries no data: it cannot lose an event it never carried.
    #[test]
    fn a_refused_ring_is_retried_by_the_next_sweep() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        // One slot in the doorbell and nobody answering during the feed: the ring for the second cue is refused.
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        state.configure_cues(vec![cue("a", 10, 0), cue("b", 20, 0)], Some(sender));
        let now = std::time::Instant::now();
        state.push_position(at(9, 0), now);
        state.push_position(at(10, 0), now);
        for frames in (10 * 25 + 1)..=(20 * 25) {
            state.push_position(TimecodePosition::from_frames(frames, TimecodeRate::Fps25, false), now);
        }
        assert_eq!(state.snapshot_at(now).deliveries_deferred, 1, "the second ring was refused");
        assert!(receiver.try_recv().is_ok(), "and the first one is waiting for the consumer");

        // The consumer's loop, in miniature: on one ring it announces everything after the last receipt it
        // announced. The cue whose own ring was refused is in that sweep — which is the retry.
        let mut announced = 0u64;
        let sweep: Vec<String> = state
            .pending_after(announced)
            .into_iter()
            .map(|entry| {
                announced = entry.seq;
                match entry.event {
                    CueEvent::Fired { id, .. } => id,
                    other => panic!("expected a fired cue, got {other:?}"),
                }
            })
            .collect();
        assert_eq!(sweep, vec!["a".to_string(), "b".to_string()], "one ring announces both, in the order they fired");
        assert!(state.pending_after(announced).is_empty(), "and nothing is announced twice");
        assert_eq!(state.snapshot_at(now).deliveries_deferred, 1, "the deferral is still visible to the operator");
    }

    /// What the window reports for each order is counted by outcome, so "the cue fired and nothing happened" always
    /// has a number and a reason beside it — including the macro the library no longer has, which used to fail in
    /// silence.
    #[test]
    fn what_the_window_did_with_each_order_is_counted() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        let (sender, _receiver) = std::sync::mpsc::sync_channel(8);
        state.configure_cues(
            vec![cue("a", 10, 0), cue("b", 20, 0), cue("c", 30, 0), cue("d", 40, 0)],
            Some(sender),
        );
        let now = std::time::Instant::now();
        // One second at a time: exactly the seek threshold, so every crossing is playback and all four fire.
        for second in 9..=40 {
            state.push_position(at(second, 0), now);
        }
        let pending = state.pending_cues();
        assert_eq!(pending.len(), 4, "four orders are waiting: {pending:?}");
        let outcomes = [
            (pending[0].seq, CueOutcome::Delivered),
            (pending[1].seq, CueOutcome::Blocked),
            (pending[2].seq, CueOutcome::Nothing),
            (pending[3].seq, CueOutcome::Failed),
        ];
        assert_eq!(state.confirm_cues(&outcomes), 4);
        let snapshot = state.snapshot_at(now);
        assert_eq!(snapshot.cues_fired, 4);
        assert_eq!(snapshot.cues_delivered, 1, "the macro that ran");
        assert_eq!(snapshot.cues_blocked, 1, "the one Live Safe Mode refused");
        assert_eq!(snapshot.cues_nothing, 1, "the one with no macro left in the library");
        assert_eq!(snapshot.cues_failed, 1, "the one that was attempted and failed");
        assert_eq!(snapshot.fired_unconfirmed, 0);
        assert_eq!(state.confirm_cues(&[(9999, CueOutcome::Delivered)]), 0, "an unknown receipt is ignored");
        assert_eq!(state.snapshot_at(now).cues_delivered, 1);
    }

    /// A ledger that fills up is the last way an order can be lost, and it is the one that must never be silent:
    /// what it refuses is counted, and the count is in the snapshot the operator reads.
    #[test]
    fn a_ledger_that_overflows_counts_what_it_lost() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        // Nobody reading, and room for one: every hand-over but the first is deferred, which fills the ledger.
        let (sender, _receiver) = std::sync::mpsc::sync_channel(1);
        let mut repeating = cue("loop", 10, 0);
        repeating.repeats = true;
        state.configure_cues(vec![repeating], Some(sender));
        let now = std::time::Instant::now();
        state.push_position(at(9, 0), now);
        let crossings = CUE_PENDING_CAPACITY + 40;
        for _ in 0..crossings {
            state.push_position(at(10, 0), now);
            // Back below it. A repeating cue is never spent, so this move re-arms nothing and produces no event.
            state.push_position(at(9, 0), now);
        }
        let snapshot = state.snapshot_at(now);
        assert_eq!(
            snapshot.deliveries_lost, 40,
            "a ledger that overflowed says how many orders it could not keep, rather than losing them quietly"
        );
        assert_eq!(state.pending_cues().len(), CUE_PENDING_CAPACITY, "and it holds everything it accepted");
        assert!(snapshot.deliveries_deferred >= 1, "the refused hand-overs were counted as retries");
    }

    /// A late window can tell a cue that **fired** from one a seek **skipped**: the kind is stored with the id.
    ///
    /// Without it both land in the same set of ids and a window opened after the crossing can only paint a neutral
    /// "spent" — which is exactly the state that makes an operator wonder whether the macro ran.
    #[test]
    fn a_spent_cue_carries_whether_it_fired_or_was_skipped() {
        let mut list = CueList::new(vec![cue("a", 10, 0), cue("b", 20, 0), cue("c", 30, 0)], 25);
        list.feed(at(0, 0), None);
        // a and b are played into: each is reached by a one-frame step, and the step before it crosses no cue, so
        // both are crossings rather than seeks. (A seek is anything over the 25-frame threshold.)
        list.feed(at(9, 24), None);
        list.feed(at(10, 0), None);
        list.feed(at(19, 24), None);
        list.feed(at(20, 0), None);
        // Then the position jumps to 00:00:40:00 — a seek — and c is named instead of fired.
        let events = list.feed(at(40, 0), None);
        assert!(matches!(events.as_slice(), [CueEvent::Skipped { id, .. }] if id == "c"), "{events:?}");
        assert_eq!(
            list.spent_cues(),
            vec![
                SpentCue { id: "a".to_string(), kind: CueSpentKind::Fired },
                SpentCue { id: "b".to_string(), kind: CueSpentKind::Fired },
                SpentCue { id: "c".to_string(), kind: CueSpentKind::Skipped },
            ],
            "the kind is stored with the id, so a window opened late can say which is which"
        );
        assert_eq!(
            list.spent_ids(),
            vec!["a".to_string(), "b".to_string(), "c".to_string()],
            "and the ids alone are still the same set, which is why the kind had to be added"
        );
    }

    /// The snapshot a late window reads says **how** each spent cue was spent, because the snapshot is all it has.
    #[test]
    fn the_snapshot_says_how_a_cue_was_spent() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        state.configure_cues(vec![cue("a", 10, 0), cue("b", 30, 0)], None);
        let now = std::time::Instant::now();
        state.push_position(at(9, 24), now);
        state.push_position(at(10, 0), now); // one frame: a crossing, so `a` fires
        state.push_position(at(40, 0), now); // a big jump: a seek, so `b` is skipped
        let snapshot = state.snapshot_at(now);
        assert_eq!(snapshot.spent_ids, vec!["a".to_string(), "b".to_string()], "both are spent");
        assert_eq!(
            snapshot.spent_cues,
            vec![
                SpentCue { id: "a".to_string(), kind: CueSpentKind::Fired },
                SpentCue { id: "b".to_string(), kind: CueSpentKind::Skipped },
            ],
            "and the kind is in the snapshot, which is the only thing a window opened late has"
        );
    }

    /// A cue whose macro is not in the library is **broken**, and the snapshot says which and why — the case that used
    /// to fail in silence (`fireMacroNow` returns when the macro is missing, and nothing marked the row).
    #[test]
    fn a_cue_whose_macro_is_not_in_the_library_is_reported_broken() {
        let mut unset = cue("unset", 10, 0);
        unset.macro_index = None;
        let mut in_range = cue("ok", 20, 0);
        in_range.macro_index = Some(2);
        let mut missing = cue("gone", 30, 0);
        missing.macro_index = Some(7);
        let list = CueList::new(vec![unset, in_range, missing], 25);

        // No window has reported a library: the reasons that need one are **not** guessed. An unknown library is not
        // an empty one, and marking every cue broken at launch would be a lie the operator cannot act on.
        let unreported = list.health(None, None);
        assert_eq!(unreported[0].problem, Some(CueProblem::NoMacro), "a cue with no macro is always reportable");
        assert_eq!(unreported[1].problem, None, "an index cannot be judged against a library nobody reported");
        assert_eq!(unreported[2].problem, None);

        // The window reports a library of five macros: index 7 is outside it, and index 2 is not.
        assert_eq!(
            list.health(Some(&MacroLibraryView::Count(5)), None),
            vec![
                CueHealth { id: "unset".to_string(), problem: Some(CueProblem::NoMacro), macro_id: None, macro_index: None, macro_changed: None },
                CueHealth { id: "ok".to_string(), problem: None, macro_id: None, macro_index: Some(2), macro_changed: None },
                CueHealth { id: "gone".to_string(), problem: Some(CueProblem::MacroMissing), macro_id: None, macro_index: Some(7), macro_changed: None },
            ],
            "a row can be marked broken and say which macro is not there"
        );
        // An empty library is a real report, not an absent one: every chosen index is outside it.
        assert_eq!(list.health(Some(&MacroLibraryView::Count(0)), None)[1].problem, Some(CueProblem::MacroMissing));

        // And the same through the state, which is the only path a window has to this.
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        state.configure_cues(list.cues().to_vec(), None);
        let before = state.snapshot_at(std::time::Instant::now());
        assert_eq!(before.macro_library_len, None, "no window has reported a library");
        assert_eq!(before.cues_broken, 1, "only the cue with no macro at all can be judged yet");
        state.set_macro_library_len(5);
        let after = state.snapshot_at(std::time::Instant::now());
        assert_eq!(after.macro_library_len, Some(5));
        assert_eq!(after.cues_broken, 2, "once the library is reported, the out-of-range cue joins it");
        assert_eq!(
            after.cue_health[2],
            CueHealth { macro_id: None, id: "gone".to_string(), problem: Some(CueProblem::MacroMissing), macro_index: Some(7), macro_changed: None },
            "and the row that is broken is named, with the index it names"
        );
    }

    /// A macro that has **changed** since the cue named it is a **note**, not a gate.
    ///
    /// The cue fires exactly the macro it names — that is what the operator asked for, and refusing to run a show over a
    /// note would be worse than the note — so the health reports it in its own field and leaves `problem` alone. The
    /// three-valued shape matters as much: a cue that recorded no hash, and a window that reported keys without hashes,
    /// are both unjudged, because an unknown that read as a change would flag every cue in an older file at once.
    #[test]
    fn a_macro_that_changed_since_a_cue_named_it_is_a_note_and_not_a_problem() {
        let mut drifted = cue("drifted", 20, 0);
        drifted.macro_id = Some("mk-7".to_string());
        drifted.macro_hash = Some("hash-as-it-was".to_string());
        let mut same = cue("same", 30, 0);
        same.macro_id = Some("mk-3".to_string());
        same.macro_hash = Some("hash-that-still-matches".to_string());
        let mut silent = cue("silent", 40, 0);
        silent.macro_id = Some("mk-7".to_string());
        // `silent` recorded no hash: a cue written before this existed.
        let list = CueList::new(vec![drifted.clone(), same, silent], 25);

        let library = MacroLibraryView::Keys(vec![
            MacroIdentity { key: "mk-7".to_string(), hash: Some("hash-in-the-library-now".to_string()) },
            MacroIdentity { key: "mk-3".to_string(), hash: Some("hash-that-still-matches".to_string()) },
        ]);
        let health = list.health(Some(&library), None);
        assert_eq!(health[0].macro_changed, Some(true), "the library's content for that key is not what the cue recorded");
        assert_eq!(health[0].problem, None, "AND IT IS NOT A PROBLEM: the cue fires exactly what it names");
        assert_eq!(health[1].macro_changed, Some(false), "a macro whose content still matches is not reported");
        assert_eq!(health[2].macro_changed, None, "and a cue that recorded no hash is not judged at all");

        // A window that reports keys without hashes cannot judge it either: the shape an older window sends.
        let keys_only = MacroLibraryView::Keys(vec![MacroIdentity { key: "mk-7".to_string(), hash: None }]);
        assert_eq!(list.health(Some(&keys_only), None)[0].macro_changed, None, "no hash reported, nothing to compare");
        // And a count cannot answer at all.
        assert_eq!(list.health(Some(&MacroLibraryView::Count(2)), None)[0].macro_changed, None);

        // The firing half, which is the part that must never change: the cue the note is about still fires.
        let mut engine = CueList::new(vec![drifted], 1000);
        engine.feed(at(5, 0), None);
        let events = engine.feed(at(20, 0), None);
        assert!(
            matches!(events.as_slice(), [CueEvent::Fired { id, .. }] if id == "drifted"),
            "a note is not a gate: the cue fires: {events:?}"
        );
    }

    /// A cue that names its macro by **key** is healthy however the library is ordered, and reported broken when the
    /// key is gone. This is the fault the positional reference could not see at all: a reorder used to leave every
    /// row green while pointing it at a neighbour.
    #[test]
    fn a_cue_that_names_its_macro_by_key_survives_a_reorder() {
        let mut named = cue("named", 20, 0);
        // The key, plus a stale index that points somewhere else entirely: the key is what the cue means.
        named.macro_id = Some("mk-7".to_string());
        named.macro_index = Some(99);
        let mut gone = cue("gone", 30, 0);
        gone.macro_id = Some("mk-3".to_string());
        let list = CueList::new(vec![named, gone], 25);

        // Keys **without** hashes: a report that knows which macros exist and nothing about their content, which is
        // the shape an older window sends and the reason `macro_changed` is an `Option`.
        let keys = |keys: &[&str]| {
            MacroLibraryView::Keys(
                keys.iter()
                    .map(|key| MacroIdentity { key: key.to_string(), hash: None })
                    .collect::<Vec<_>>(),
            )
        };
        let before = keys(&["mk-7", "mk-3"]);
        let after = keys(&["mk-3", "mk-7"]);

        assert_eq!(list.health(Some(&before), None)[0].problem, None, "the key it names is in the library");
        assert_eq!(list.health(Some(&before), None)[1].problem, None, "and so is the other one");
        assert_eq!(
            list.health(Some(&before), None)[0].problem,
            list.health(Some(&after), None)[0].problem,
            "reordering the library says nothing about a cue that names a key"
        );

        // The key is gone: reported, and the stale index is **not** consulted to rescue it.
        let without = keys(&["mk-3"]);
        assert_eq!(
            list.health(Some(&without), None)[0].problem,
            Some(CueProblem::MacroMissing),
            "a key that is gone must be reported, however healthy the place it used to occupy looks"
        );

        // A count alone cannot judge a key, and an unknown library is not an empty one: nothing is claimed about it,
        // even though the index the cue still carries is far outside that count.
        assert_eq!(list.health(Some(&MacroLibraryView::Count(9)), None)[0].problem, None);
    }

    /// A cue that names its macro by key hands that key to the window, so what runs is the macro the cue names and
    /// not whoever occupies its old place in the library.
    #[test]
    fn a_fired_cue_hands_over_the_key_it_names() {
        let mut named = cue("a", 10, 0);
        named.macro_id = Some("mk-4".to_string());
        named.macro_index = None;
        let mut list = CueList::new(vec![named], 25);
        assert!(list.feed(at(9, 24), None).is_empty(), "the first position arms and fires nothing");
        let events = list.feed(at(10, 0), None);
        assert!(
            matches!(
                &events[0],
                CueEvent::Fired { macro_id: Some(key), macro_index: None, .. } if key == "mk-4"
            ),
            "a fired cue must carry the macro's key: {events:?}"
        );
    }

    /// One show, one frame rate — and the list was written at another.
    ///
    /// A label is not a frame count until a format is chosen. This list says `01:00:00:00` and was written at 25 fps;
    /// the source speaks 30. Reading the cue's count at 25 (90 000) against a position counted at 30 fired it at
    /// `00:50:00:00` — ten minutes early — and left it silent at the hour it names. The format belongs to the show
    /// (QLab declares the SMPTE format on the cue list, DiGiCo sets the frame rate in Setup), so the cue's numbers are
    /// read in the **source's** format and both counts are the same kind of thing.
    #[test]
    fn a_cue_written_at_one_rate_fires_where_it_says_when_the_source_speaks_another() {
        let mut list = CueList::new(vec![cue_at("late", TimecodeRate::Fps25, 1, 0, 0, 0)], 25);
        list.feed(at_rate(0, 49, 59, 29, TimecodeRate::Fps30), None);
        assert!(
            list.feed(at_rate(0, 50, 0, 0, TimecodeRate::Fps30), None).is_empty(),
            "the cue says 01:00:00:00 and must not fire at 00:50:00:00, which is where a 25 fps count lands at 30"
        );

        let mut list = CueList::new(vec![cue_at("late", TimecodeRate::Fps25, 1, 0, 0, 0)], 25);
        list.feed(at_rate(0, 59, 59, 29, TimecodeRate::Fps30), None);
        let events = list.feed(at_rate(1, 0, 0, 0, TimecodeRate::Fps30), None);
        assert!(
            matches!(events.as_slice(), [CueEvent::Fired { id, .. }] if id == "late"),
            "and it fires on the frame that crosses the time it names: {events:?}"
        );
    }

    /// A label that cannot exist in the source's format is **reported**, never fired at a frame nobody wrote.
    ///
    /// Frame 24 exists at 25 fps and not at 24, and drop-frame numbering skips numbers that therefore do not exist in
    /// it. Moving the cue to the nearest frame that does exist would fire it somewhere the operator never asked for,
    /// which is worse than not firing — so it stays where it was written and the row says why.
    #[test]
    fn a_label_that_cannot_exist_at_the_sources_rate_is_reported_and_never_fired() {
        let frames = TimecodeRate::Fps24;
        let mut list = CueList::new(vec![cue_at("frame24", TimecodeRate::Fps25, 0, 0, 10, 24)], 25);
        list.feed(at_rate(0, 0, 9, 23, frames), None);
        let events = list.feed(at_rate(0, 0, 10, 0, frames), None);
        assert!(events.is_empty(), "frame 24 is not a frame at 24 fps: {events:?}");
        assert_eq!(
            list.health(None, Some((frames, false)))[0].problem,
            Some(CueProblem::FrameNotAtRate),
            "and the row says so rather than staying silent about a cue that can never fire"
        );
        // The same cue at its own rate is fine, and nothing at all is claimed before a format has been heard.
        assert_eq!(list.health(None, Some((TimecodeRate::Fps25, false)))[0].problem, None);
        assert_eq!(list.health(None, None)[0].problem, None);
    }

    /// The freewheel window is a **fact in the snapshot**, not a constant buried inside the window.
    ///
    /// It is the difference between "the signal hiccupped" and "the show has stopped", and the two are told apart by
    /// numbers the operator can read: the tolerance, how much of it is left, and — once it is gone — that the clock is
    /// `stale` rather than absent. `Some(0)` and `None` are deliberately different answers.
    #[test]
    fn the_snapshot_says_how_much_of_the_freewheel_window_is_left() {
        let state = TimecodeState::new(std::time::Duration::from_millis(750));
        let now = std::time::Instant::now();
        let before = state.snapshot_at(now);
        assert_eq!(before.freewheel_ms, 750, "the tolerance is reported even before anything arrives");
        assert_eq!(before.freewheel_remaining_ms, None, "and no window is running: nothing has arrived");

        state.push_position(at(10, 0), now);
        let running = state.snapshot_at(now + std::time::Duration::from_millis(250));
        assert_eq!(running.state, "running");
        assert_eq!(running.freewheel_remaining_ms, Some(500), "500 ms of the 750 ms window are left");

        let stale = state.snapshot_at(now + std::time::Duration::from_millis(900));
        assert_eq!(stale.state, "stale");
        assert_eq!(
            stale.freewheel_remaining_ms,
            Some(0),
            "the window is exhausted, which is not the same as never having started"
        );
        assert_eq!(stale.freewheel_ms, 750, "and the tolerance it was judged against is still named");
    }

    /// A rate change is checked **before** it is made: the labels that cannot exist at the new rate are named, by the
    /// same rule that will later mark their rows broken. Asking afterwards is asking too late — the show is already
    /// running at a rate that cannot fire them.
    #[test]
    fn the_cues_a_rate_could_not_fire_are_named_before_the_change() {
        let list = CueList::new(
            vec![
                cue_at("fine", TimecodeRate::Fps25, 1, 0, 0, 0),
                cue_at("frame24", TimecodeRate::Fps25, 1, 0, 10, 24),
                cue_at("frame23", TimecodeRate::Fps25, 1, 0, 10, 23),
            ],
            25,
        );
        assert_eq!(
            cues_impossible_at(list.cues(), TimecodeRate::Fps24, false),
            vec!["frame24".to_string()],
            "only the label that does not exist at 24 fps is named"
        );
        assert!(
            cues_impossible_at(list.cues(), TimecodeRate::Fps25, false).is_empty(),
            "at its own rate the list is fine"
        );
        // 23.976 counts 24 numbers a second, so the same label is impossible there too: the check is about the numbers
        // a rate has, not about what the rate is called.
        assert_eq!(
            cues_impossible_at(list.cues(), TimecodeRate::Fps23_976, false),
            vec!["frame24".to_string()]
        );
        assert!(
            cues_impossible_at(list.cues(), TimecodeRate::Fps30, false).is_empty(),
            "and a coarser rate has every number the finer one had"
        );
    }

    /// The three repeat policies are three behaviours, and the difference between two of them only shows when an
    /// operator goes back: "once per pass" is armed again, "once in the show" is not. The third, "every crossing", is
    /// never spent at all, which is what the old `repeats: true` meant.
    #[test]
    fn the_three_repeat_policies_are_three_behaviours() {
        let cue_with = |id: &str, seconds: u32, policy: Option<CueRepeat>| {
            let mut cue = cue(id, seconds, 0);
            cue.repeat = policy;
            cue
        };
        // A threshold wide enough that stepping from cue to cue is *playing*, not seeking: the policies are what this
        // test is about, and a seek would mark the crossed cues skipped instead of firing them.
        let mut list = CueList::new(
            vec![
                cue_with("once", 10, Some(CueRepeat::Pass)),
                cue_with("show", 20, Some(CueRepeat::Show)),
                cue_with("every", 30, Some(CueRepeat::Every)),
            ],
            1000,
        );
        list.feed(at(9, 24), None);
        list.feed(at(10, 0), None);
        list.feed(at(20, 0), None);
        list.feed(at(30, 0), None);
        assert_eq!(
            list.spent_ids(),
            vec!["once".to_string(), "show".to_string()],
            "a cue that fires every crossing is never marked spent"
        );

        list.feed(at(5, 0), None);
        assert_eq!(
            list.spent_ids(),
            vec!["show".to_string()],
            "going back arms the once-per-pass cue again and leaves the once-in-the-show cue spent"
        );

        list.feed(at(9, 24), None);
        let events = list.feed(at(10, 0), None);
        assert!(
            matches!(events.as_slice(), [CueEvent::Fired { id, .. }] if id == "once"),
            "so it fires again, which is the whole point of the middle policy: {events:?}"
        );
    }

    /// A sequential list is driven by the operator and by the clock, and **never** by a crossing.
    ///
    /// The cues still carry the times they were written at — the same list is run in either drive — but in this one the
    /// positions are only the clock the durations are measured on. That is what makes a list of cues without meaningful
    /// timestamps usable at all.
    #[test]
    fn retired_callbacks_cannot_commit_after_stop_or_replace() {
        let state=std::sync::Arc::new(TimecodeState::default());
        state.activate_ltc(1);state.accept_ltc(1,at(0,0),std::time::Instant::now());
        let (resume,wait)=std::sync::mpsc::channel();
        let old=state.clone();
        let worker=std::thread::spawn(move || {wait.recv().unwrap();old.accept_ltc(1,at(10,0),std::time::Instant::now())});
        state.retire_ltc(1);state.activate_ltc(2);
        assert!(state.snapshot().position.is_none(), "new source does not relabel the old position");
        state.accept_ltc(2,at(2,0),std::time::Instant::now());
        resume.send(()).unwrap();assert!(worker.join().unwrap().is_none());
        state.retire_ltc(1); // an old cleanup must not retire its replacement
        assert!(state.accept_ltc(2,at(3,0),std::time::Instant::now()).is_some());
        assert_eq!(state.snapshot().position.as_deref(),Some("00:00:03:00"));
    }
    #[test]
    fn ltc_owns_the_clock_until_explicit_stop_and_mtc_then_arms_only() {
        let state=TimecodeState::default();state.configure_cues(vec![cue("one",1,0)],None);
        state.activate_ltc(1);state.accept_ltc(1,at(0,0),std::time::Instant::now());
        state.activate_midi_input(4);
        let full=[0xf0,0x7f,0x7f,1,1,0x20,0,2,0,0xf7];
        assert!(state.feed_mtc_generation(4,&full,std::time::Instant::now()).is_none());
        assert_eq!(state.snapshot().source,"LTC");
        state.retire_midi_input(4);assert_eq!(state.snapshot().source,"LTC");
        state.retire_ltc(1);state.activate_midi_input(5);
        assert!(state.feed_mtc_generation(4,&full,std::time::Instant::now()).is_none());
        assert!(state.feed_mtc_generation(5,&[0x90,60,1],std::time::Instant::now()).is_none());
        assert_eq!(state.snapshot().source,"LTC", "notes do not claim a timecode source");
        assert!(state.feed_mtc_generation(5,&full,std::time::Instant::now()).is_some());
        assert_eq!(state.snapshot().source,"MTC");assert!(state.pending_cues().is_empty());
    }

    #[test]
    fn every_repeat_cues_advance_in_sequence_and_rearm_on_rewind() {
        let mut a = cue("a", 10, 0); a.repeat = Some(CueRepeat::Every); a.duration_ms = Some(1000);
        let mut b = cue("b", 20, 0); b.repeat = Some(CueRepeat::Every);
        let mut list = CueList::new(vec![a,b], 1000);
        list.set_drive(CueDrive::Sequential);
        list.feed(at(0,0),None);
        assert!(matches!(&list.go()[0], CueEvent::Fired {id,..} if id=="a"));
        assert!(matches!(&list.feed(at(1,0),Some(1000))[0], CueEvent::Fired {id,..} if id=="b"));
        assert!(list.go().is_empty());
        list.feed(at(0,0),Some(10));
        assert!(matches!(&list.go()[0], CueEvent::Fired {id,..} if id=="a"));
        list.reset();
        assert!(matches!(&list.go()[0], CueEvent::Fired {id,..} if id=="a"));
    }

    #[test]
    fn a_restored_receipt_cannot_be_settled_by_a_new_run() {
        let old = TimecodeState::default(); old.configure_cues(vec![cue("old",1,0)],None);
        old.push_position(at(0,0),std::time::Instant::now()); old.push_position(at(1,0),std::time::Instant::now());
        let lines = old.as_run_lines(); assert_eq!(lines.len(),1);
        let state = TimecodeState::default(); state.restore_as_run(lines.clone());
        state.configure_cues(vec![cue("new",1,0)],None);
        state.push_position(at(0,0),std::time::Instant::now()); state.push_position(at(1,0),std::time::Instant::now());
        let seq = state.pending_cues()[0].seq; assert!(seq>lines[0].seq);
        state.confirm_cues(&[(seq,CueOutcome::Cancelled)]);
        assert_eq!(state.as_run_lines()[0].outcome,None);
        assert_eq!(state.as_run_lines()[1].outcome,Some(CueOutcome::Cancelled));
    }

    #[test]
    fn a_sequential_list_fires_nothing_on_a_crossing() {
        let mut list = CueList::new(vec![cue("one", 10, 0), cue("two", 20, 0)], 1000);
        list.set_drive(CueDrive::Sequential);

        list.feed(at(5, 0), None);
        assert!(list.feed(at(10, 0), None).is_empty(), "a crossing must not fire a sequential cue");
        assert!(list.feed(at(20, 0), None).is_empty(), "and neither must the second one");
        assert!(list.spent_ids().is_empty(), "a crossing spends nothing in this drive");

        let events = list.go();
        assert!(matches!(events.as_slice(), [CueEvent::Fired { id, .. }] if id == "one"), "{events:?}");
        assert_eq!(list.spent_ids(), vec!["one".to_string()], "the Go fires the first cue in list order");
        let events = list.go();
        assert!(matches!(events.as_slice(), [CueEvent::Fired { id, .. }] if id == "two"), "{events:?}");
        assert!(list.go().is_empty(), "at the end of the list a Go fires nothing, which the window says plainly");
    }

    /// The duration that moves a sequence on belongs to the cue that **fired**, is measured on the show clock, and is
    /// never waited on by a macro.
    ///
    /// Every clause here is a decision rather than an accident: the deadline comes from the cue that fired (so a row's
    /// duration means "after me"), it is measured in positions (so a paused clock pauses the sequence and no timer
    /// exists to leak into the show), and a cue with no duration is where the sequence **waits** (because a sequence
    /// that invented one would advance a show by itself).
    #[test]
    fn a_sequential_duration_is_measured_on_the_show_clock_from_where_the_cue_fired() {
        let mut one = cue("one", 10, 0);
        one.duration_ms = Some(2000);
        let mut two = cue("two", 20, 0);
        two.duration_ms = Some(1000);
        // "three" has no duration: it is where the sequence waits.
        let mut list = CueList::new(vec![one, two, cue("three", 30, 0)], 1000);
        list.set_drive(CueDrive::Sequential);

        list.feed(at(0, 0), None);
        let events = list.go();
        assert!(
            matches!(events.as_slice(), [CueEvent::Fired { id, .. }] if id == "one"),
            "the Go fires the first cue: {events:?}"
        );

        assert!(
            list.feed(at(1, 24), None).is_empty(),
            "a frame short of the two seconds the first cue asked for, the next is not due"
        );
        let events = list.feed(at(2, 0), None);
        assert!(
            matches!(events.as_slice(), [CueEvent::Fired { id, .. }] if id == "two"),
            "and at two seconds it is: {events:?}"
        );

        // The second cue asked for one second **from where it fired** (2 s), so the third is due at 3 s and not before
        // — the property that keeps a duration meaning "after me" rather than "at some absolute time".
        assert!(list.feed(at(2, 24), None).is_empty(), "the deadline is measured from where the cue fired");
        let events = list.feed(at(3, 0), None);
        assert!(
            matches!(events.as_slice(), [CueEvent::Fired { id, .. }] if id == "three"),
            "one second after the second cue fired, the third is due: {events:?}"
        );

        // Nothing moves a sequence on but a position or a Go: the third cue has no duration, so the clock may run to
        // the end of the day and nothing else happens.
        assert!(list.feed(at(30, 0), None).is_empty(), "a cue with no duration is where the sequence waits for a Go");
        assert!(list.feed(at(40, 0), None).is_empty(), "and it waits there however far the clock runs");
        assert_eq!(list.spent_ids(), vec!["one".to_string(), "three".to_string(), "two".to_string()]);
    }

    /// The two rules of the rate check: a real mismatch is reported, and a rate boundary never is.
    ///
    /// It is a contract because both halves are decisions somebody could reasonably take the other way, and because the
    /// second half is what keeps a professional default from alarming for ever.
    #[test]
    fn the_measured_rate_disagrees_only_past_two_per_cent_and_never_at_a_boundary() {
        assert!(rate_disagrees(TimecodeRate::Fps30, 25.0), "a 25 fps signal read as 30 is a disagreement");
        assert!(rate_disagrees(TimecodeRate::Fps25, 30.0), "and a 30 fps signal read as 25 is the other one");
        // The boundaries: 29.97 and 30 count the same numbers a second, and so do 23.976 and 24. Only the drop-frame bit
        // tells each pair apart, and the bit period says nothing about it.
        assert!(!rate_disagrees(TimecodeRate::Fps30, 29.97), "29.97 read as 30 is 0.1 %: not a disagreement");
        assert!(!rate_disagrees(TimecodeRate::Fps29_97, 30.0), "nor 30 read as 29.97");
        assert!(!rate_disagrees(TimecodeRate::Fps24, 23.976), "a 0.1 % boundary is not one either");
        // The threshold itself, and the shapes that must never be reported at all.
        assert!(!rate_disagrees(TimecodeRate::Fps25, 25.4), "1.6 % is inside the measurement's own error bar");
        assert!(rate_disagrees(TimecodeRate::Fps25, 25.6), "2.4 % is not");
        assert!(!rate_disagrees(TimecodeRate::Fps25, 0.0), "a measurement of nothing is not a disagreement");
        assert!(!rate_disagrees(TimecodeRate::Fps25, f32::NAN), "and neither is one that is not a number");
    }

    /// The older boolean is read as the two answers it could express, in **one** place.
    #[test]
    fn the_older_repeat_flag_is_read_as_the_two_policies_it_could_express() {
        let mut repeating = cue("repeating", 10, 0);
        repeating.repeats = true;
        assert_eq!(repeating.repeat_policy(), CueRepeat::Every, "`repeats: true` always meant every crossing");
        let plain = cue("plain", 10, 0);
        assert_eq!(plain.repeat_policy(), CueRepeat::Pass, "and `false` always meant once per pass");

        let mut both = cue("both", 10, 0);
        both.repeats = true;
        both.repeat = Some(CueRepeat::Show);
        assert_eq!(
            both.repeat_policy(),
            CueRepeat::Show,
            "once the file carries the policy, the policy is the authority and the old flag is not consulted"
        );
    }

    /// **The rehearsal contract**: the same run produces the same invocation plan, and nothing enters the delivery path.
    ///
    /// The comparison is the point, and it is the exit criterion written in the plan. A rehearsal that merely suppressed
    /// the firing could also have suppressed the spent marks, the skips and the re-arms — and the report it printed would
    /// then be the report of a **different show** than the one that will run. So both runs are driven with the same
    /// positions and compared item by item, and the rehearsal is required to return no events at all.
    #[test]
    fn a_rehearsal_produces_the_same_plan_as_the_show_and_emits_nothing() {
        let cues = vec![cue("one", 10, 0), cue("two", 20, 0)];
        let mut show = CueList::new(cues.clone(), 1000);
        let mut fired = Vec::new();
        show.feed(at(5, 0), None);
        fired.extend(show.feed(at(10, 0), None));
        fired.extend(show.feed(at(20, 0), None));
        assert_eq!(fired.len(), 2, "the show fires both cues: {fired:?}");

        let mut rehearsal = CueList::new(cues, 1000);
        rehearsal.set_rehearsing(true);
        let mut nothing = Vec::new();
        rehearsal.feed(at(5, 0), None);
        nothing.extend(rehearsal.feed(at(10, 0), None));
        nothing.extend(rehearsal.feed(at(20, 0), None));
        assert!(nothing.is_empty(), "a rehearsal hands back no events at all: {nothing:?}");

        let planned: Vec<(String, String)> = rehearsal
            .rehearsal_plan()
            .iter()
            .filter(|line| line.kind == "fired")
            .map(|line| (line.id.clone(), line.at.clone()))
            .collect();
        let shown: Vec<(String, String)> = fired
            .iter()
            .filter_map(|event| match event {
                CueEvent::Fired { id, at, .. } => Some((id.clone(), at.clone())),
                _ => None,
            })
            .collect();
        assert_eq!(planned, shown, "the plan is the show's own invocation plan, item for item");
        assert_eq!(
            rehearsal.spent_ids(),
            show.spent_ids(),
            "and the spent marks agree, which is what makes it a plan of **this** show rather than of a fresh one"
        );
    }

    /// The delta Monitor exists for: how late the incoming timecode was when the engine decided, in frames.
    #[test]
    fn a_rehearsal_measures_the_lateness_of_a_crossing_in_frames() {
        let mut list = CueList::new(vec![cue("one", 10, 0)], 1000);
        list.set_rehearsing(true);
        list.feed(at(9, 24), None);
        list.feed(at(10, 2), None);
        let plan = list.rehearsal_plan();
        assert_eq!(plan.len(), 1, "{plan:?}");
        assert_eq!(plan[0].kind, "fired");
        assert_eq!(plan[0].delta_frames, Some(2), "the crossing was two frames past the time the cue names");

        // A cue a **seek** jumped over has no lateness at all, and says so rather than reporting a perfect zero.
        let mut skipped = CueList::new(vec![cue("one", 10, 0)], 10);
        skipped.set_rehearsing(true);
        skipped.feed(at(5, 0), None);
        skipped.feed(at(30, 0), None);
        let plan = skipped.rehearsal_plan();
        assert_eq!(plan.len(), 1, "{plan:?}");
        assert_eq!(plan[0].kind, "skipped");
        assert_eq!(plan[0].delta_frames, None, "a cue a seek jumped over was never crossed at a position");
    }

    /// A cue's **stored** rate is a record of the format its label was written in; it does not decide when the cue
    /// fires, because every position is read in the **source's** format.
    ///
    /// This is the behaviour behind a refusal that was deleted from the save path. The save used to reject a list whose
    /// cues carried two rates, and the way to reach that was nothing more than changing the input's rate between two
    /// captures — a cue added from the live position is stamped with the rate it was captured at. The contract is that
    /// such a list behaves exactly like a homogeneous one, at whatever format the source speaks.
    #[test]
    fn a_cue_written_at_another_rate_still_fires_in_the_source_format() {
        let list = || {
            CueList::new(
                vec![
                    cue_at("captured-at-25", TimecodeRate::Fps25, 0, 0, 10, 0),
                    cue_at("captured-at-30", TimecodeRate::Fps30, 0, 0, 20, 0),
                ],
                1000,
            )
        };
        let fired_ids = |events: Vec<CueEvent>| -> Vec<String> {
            events
                .into_iter()
                .filter_map(|event| match event {
                    CueEvent::Fired { id, .. } => Some(id),
                    _ => None,
                })
                .collect()
        };

        // The source speaks 25: both labels are read at 25.
        let mut at25 = list();
        at25.feed(at_rate(0, 0, 5, 0, TimecodeRate::Fps25), None);
        let fired = fired_ids(at25.feed(at_rate(0, 0, 25, 0, TimecodeRate::Fps25), None));
        assert_eq!(
            fired,
            vec!["captured-at-25".to_string(), "captured-at-30".to_string()],
            "both cues fire where the source's own clock crosses them"
        );

        // And the source may speak 30 for the very same list: nothing about a cue's stored rate changes that.
        let mut at30 = list();
        at30.feed(at_rate(0, 0, 5, 0, TimecodeRate::Fps30), None);
        let fired = fired_ids(at30.feed(at_rate(0, 0, 25, 0, TimecodeRate::Fps30), None));
        assert_eq!(
            fired,
            vec!["captured-at-25".to_string(), "captured-at-30".to_string()],
            "the same two labels, read in the other format, fire on the same two cues"
        );
    }
}
