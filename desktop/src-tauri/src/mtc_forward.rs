//! MIDI Association Doc 4.2: four quarter frames per frame, eight per two frames.
//! Full-frame messages locate; they are not a substitute for a playback clock.
use super::timecode::{PositionUpdate, TimecodePosition, TimecodeRate};
use std::time::{Duration, Instant};

pub fn full_frame(p: TimecodePosition) -> Vec<u8> {
    vec![
        0xf0,
        0x7f,
        0x7f,
        1,
        1,
        (p.rate.to_mtc_code() << 5) | p.hours as u8,
        p.minutes as u8,
        p.seconds as u8,
        p.frames as u8,
        0xf7,
    ]
}
pub fn quarter_frame(p: TimecodePosition, piece: u8) -> Vec<u8> {
    let values = [
        p.frames as u8 & 15,
        p.frames as u8 >> 4,
        p.seconds as u8 & 15,
        p.seconds as u8 >> 4,
        p.minutes as u8 & 15,
        p.minutes as u8 >> 4,
        p.hours as u8 & 15,
        (p.rate.to_mtc_code() << 1) | (p.hours as u8 >> 4),
    ];
    vec![0xf1, (piece << 4) | values[piece as usize]]
}
fn rate_ratio(rate: TimecodeRate) -> (u64, u64) {
    match rate {
        TimecodeRate::Fps23_976 => (24000, 1001),
        TimecodeRate::Fps29_97 => (30000, 1001),
        other => (other.frames_per_second(), 1),
    }
}
fn tick_time(rate: TimecodeRate, ticks: u64) -> Duration {
    let (n, d) = rate_ratio(rate);
    Duration::from_nanos(
        ((ticks as u128 * 1_000_000_000 * d as u128) / (n as u128 * 4)).min(u64::MAX as u128)
            as u64,
    )
}
fn advance(p: TimecodePosition, elapsed: Duration) -> TimecodePosition {
    let (n, d) = rate_ratio(p.rate);
    let frames = elapsed.as_nanos() * n as u128 / (1_000_000_000 * d as u128);
    TimecodePosition::from_frames(
        p.to_frames() + frames.min(i64::MAX as u128) as i64,
        p.rate,
        p.drop_frame,
    )
}
#[derive(Default)]
pub struct MtcPacer {
    anchor: Option<PositionUpdate>,
    origin: Option<Instant>,
    tick: u64,
    cycle: Option<TimecodePosition>,
    locate: bool,
}
impl MtcPacer {
    pub fn reset(&mut self) {
        *self = Self::default();
    }
    pub fn observe(&mut self, update: PositionUpdate, now: Instant) -> Result<(), String> {
        let p = update.position;
        if p.rate == TimecodeRate::Fps29_97 && !p.drop_frame {
            self.reset();
            return Err("MTC forwarding cannot represent 29.97 non-drop numbering; choose drop-frame or another rate".into());
        }
        // A queued sample retains its arrival time; draining backlog cannot make it fresh.
        if now.saturating_duration_since(update.arrived_at) > tick_time(p.rate, 12) {
            return Ok(());
        }
        let previous = self.anchor;
        let continuous = previous.is_some_and(|old| {
            if old.source_epoch != update.source_epoch
                || old.position.rate != p.rate
                || old.position.drop_frame != p.drop_frame
            {
                return false;
            }
            let day = TimecodePosition::frames_in_a_day(p.rate, p.drop_frame);
            let delta = (p.to_frames() - old.position.to_frames()).rem_euclid(day);
            let gap = update.arrived_at.saturating_duration_since(old.arrived_at);
            let expected = advance(old.position, gap);
            let error = (p.to_frames() - expected.to_frames()).rem_euclid(day);
            delta > 0
                && delta <= 4
                && (error <= 2 || error >= day - 2)
                && gap <= tick_time(p.rate, 12)
        });
        if previous.is_some_and(|old| old.position == p && old.source_epoch == update.source_epoch)
        {
            // Repeated positions do not extend permission to manufacture playback.
            return Ok(());
        }
        self.anchor = Some(update);
        if continuous {
            if self.origin.is_none() {
                self.origin = Some(now);
                self.tick = 0;
                self.cycle = None;
            }
        } else {
            self.origin = None;
            self.cycle = None;
            self.locate = true;
        }
        Ok(())
    }
    pub fn deadline(&self) -> Option<Instant> {
        let anchor = self.anchor?;
        if self.locate {
            return Some(anchor.arrived_at);
        }
        Some(self.origin? + tick_time(anchor.position.rate, self.tick))
    }
    pub fn poll(&mut self, now: Instant) -> Option<(u64, Vec<u8>)> {
        let anchor = self.anchor?;
        if now.saturating_duration_since(anchor.arrived_at) > tick_time(anchor.position.rate, 12) {
            self.origin = None;
            self.cycle = None;
            self.locate = false;
            return None;
        }
        if self.locate {
            self.locate = false;
            return Some((anchor.source_epoch, full_frame(anchor.position)));
        }
        let due = self.deadline()?;
        if now < due {
            return None;
        }
        if now.saturating_duration_since(due) > tick_time(anchor.position.rate, 1) / 2 {
            // Missed a deadline: locate once and wait for fresh progression, never
            // emit overdue quarters in a burst or retain a half-cycle.
            self.origin = None;
            self.cycle = None;
            return Some((anchor.source_epoch, full_frame(anchor.position)));
        }
        let piece = (self.tick % 8) as u8;
        if piece == 0 {
            self.cycle = Some(advance(
                anchor.position,
                now.saturating_duration_since(anchor.arrived_at),
            ));
        }
        let message = quarter_frame(self.cycle?, piece);
        self.tick += 1;
        Some((anchor.source_epoch, message))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(frame: i64, at: Instant) -> PositionUpdate {
        PositionUpdate {
            position: TimecodePosition::from_frames(frame, TimecodeRate::Fps25, false),
            arrived_at: at,
            source_epoch: 1,
        }
    }
    #[test]
    fn quarters_are_paced_and_capture_one_position_for_the_cycle() {
        let t = Instant::now();
        let mut p = MtcPacer::default();
        p.observe(sample(100, t), t).unwrap();
        assert_eq!(p.poll(t).unwrap().1[0], 0xf0);
        assert!(p.poll(t).is_none());
        let start = t + Duration::from_millis(40);
        p.observe(sample(101, start), start).unwrap();
        let mut out = Vec::new();
        for i in 0..8 {
            let now = start + Duration::from_millis(i * 10);
            if i == 4 {
                p.observe(sample(102, now), now).unwrap();
            }
            out.push(p.poll(now).unwrap().1);
            assert!(p.poll(now).is_none(), "no burst or early message");
        }
        for (i, msg) in out.iter().enumerate() {
            assert_eq!(*msg, quarter_frame(sample(101, start).position, i as u8));
        }
    }
    #[test]
    fn silence_backlog_and_missed_deadlines_do_not_freewheel_or_burst() {
        let t = Instant::now();
        let mut p = MtcPacer::default();
        p.observe(sample(1, t), t).unwrap();
        p.poll(t);
        let next = t + Duration::from_millis(40);
        p.observe(sample(2, next), next).unwrap();
        p.poll(next);
        let late = next + Duration::from_millis(35);
        assert_eq!(p.poll(late).unwrap().1[0], 0xf0);
        assert!(p.poll(late).is_none());
        assert!(p.poll(t + Duration::from_secs(1)).is_none());
        p.observe(sample(3, t), t + Duration::from_secs(2)).unwrap();
        assert!(p.poll(t + Duration::from_secs(2)).is_none());
        p.reset();
        assert!(p.deadline().is_none());
    }
    #[test]
    fn source_changes_reverse_and_format_changes_locate_and_invalid_format_refuses() {
        let t = Instant::now();
        let mut p = MtcPacer::default();
        p.observe(sample(20, t), t).unwrap();
        p.poll(t);
        let mut changed = sample(10, t);
        changed.source_epoch = 2;
        p.observe(changed, t).unwrap();
        assert_eq!(p.poll(t).unwrap().1[0], 0xf0);
        changed.position = TimecodePosition::from_frames(1, TimecodeRate::Fps29_97, false);
        assert!(p.observe(changed, t).is_err());
        assert!(p.poll(t).is_none());
    }
    #[test]
    fn a_one_tick_delay_cannot_emit_two_quarters_at_the_same_instant() {
        let t = Instant::now();
        let mut p = MtcPacer::default();
        p.observe(sample(1, t), t).unwrap();
        p.poll(t);
        let start = t + Duration::from_millis(40);
        p.observe(sample(2, start), start).unwrap();
        p.poll(start);
        let late = start + Duration::from_millis(20);
        assert_eq!(
            p.poll(late).unwrap().1[0],
            0xf0,
            "resynchronise instead of catching up"
        );
        assert!(p.poll(late).is_none());
    }
    #[test]
    fn fractional_deadlines_have_no_accumulated_rounding_drift() {
        assert_eq!(
            tick_time(TimecodeRate::Fps29_97, 120_000),
            Duration::from_secs(1001)
        );
        assert_eq!(
            tick_time(TimecodeRate::Fps23_976, 96_000),
            Duration::from_secs(1001)
        );
    }
}
