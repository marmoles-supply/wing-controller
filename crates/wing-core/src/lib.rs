//! Core WING protocol contracts for the macOS desktop runtime.
//!
//! This crate intentionally has no UI or socket dependencies. It is the first
//! extraction point for the Tauri/Rust port so Maillot-sensitive meter behavior
//! can be tested separately from Android, React, and future desktop IPC.

/// Model-aware plugin parameters, generated from the Maillot appendix by
/// `scripts/wing-plugin-models.mjs`. A channel's gate/compressor/EQ parameters exist only for the
/// model loaded on that strip, so this is the table the catalogue has to consult.
pub mod plugin_models;

/// Parses the appendix's value descriptions (`linf [-80, 0, 161] dB`) into UI-ready metadata.
pub mod plugin_spec;

/// Which console of the WING family is at the other end of the cable.
///
/// The family shares one protocol and one parameter tree, but not one surface and not one set of
/// connectors, and Maillot says so in the document's own words: the full-size console has "8 local
/// Inputs, 8 Aux inputs, 8 aux outputs, 8 local outputs" (402) with a control surface, while the
/// Rack and the Compact have "24 Local Inputs (8 on the WING)" and "No local Aux IO" (421-422,
/// 448-449), no faders and no surface potentiometers. Footnote 17 (1641) makes the consequence
/// explicit for the parameter tree — *"All 24 local inputs may not be available depending on the
/// console model"* — and footnote 13 (1357-1359) does the same for the monitor bus level.
///
/// Every count, capability and hint in this crate that the document ties to one of those models
/// therefore has to be derived from this value and never from "the desk in front of us" (master
/// plan 2026-09-22, §12, "Work for every WING, not for the one on the bench").
///
/// The value comes from the desk itself: the discovery reply's model field, `WING,<ip>,<name>,<mdl>`
/// (563-567, `[c_model] 'ngc-full' (standard Wing console)`) and, for a desk already known, the
/// read-only `/$syscfg/$cnsmdl` row (1565-1570: *"typically 'ngc-full' for the full sized desk, can
/// also be 'wing-bk', 'wing-rack', 'wing-compact'"*). `/$syscfg/$cnscfg` (1562-1564) carries the
/// same families in the "wing…" spelling. [`DeskModel::Unknown`] is a real answer, not a default:
/// where the model is not known the app truncates instead of assuming (see
/// `meters::MeterDescriptor::group_words`).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord)]
pub enum DeskModel {
    /// The large-console WING: 8 local inputs, 8 local aux in/out, 8 local outputs, 4 GPIO, and a
    /// surface control potentiometer on the monitor bus.
    Full,
    /// The 19" 4U rack: 24 local inputs, no local aux IO, no faders, no wheel, 4 GPIO.
    Rack,
    /// The smaller surface: 24 local inputs, no local aux IO, 2 GPIO (footnote 122, 11536).
    Compact,
    /// The desk has not announced a model the document names. Nothing may be assumed from it.
    Unknown,
}

impl DeskModel {
    /// Reads the model out of an announcement string — the discovery `mdl` field, `/$syscfg/$cnsmdl`
    /// or `/$syscfg/$cnscfg`. The comparison is on lower-case substrings because the document prints
    /// the same families in several spellings (`ngc-full`, `wing-bk`, `wing`, `wing-rack`,
    /// `wing-compact`, 566 and 1565-1570) and the console is free to add a suffix.
    pub fn from_announcement(text: &str) -> Self {
        let lowered = text.trim().to_ascii_lowercase();
        if lowered.is_empty() {
            return DeskModel::Unknown;
        }
        // `cmpct` is the console's own abbreviation for the Compact surface in the fader-layer node
        // (`/$ctl/layer/CMPCT/sel`, 3456); it is the same console.
        if lowered.contains("rack") {
            return DeskModel::Rack;
        }
        if lowered.contains("compact") || lowered.contains("cmpct") {
            return DeskModel::Compact;
        }
        // "ngc-full" is the full-size desk (566) and the bare family name is the desk that gave the
        // family its name. `wing-bk` is the black full-size console (392: "Available in gray or
        // black"), not a distinct protocol partner.
        if lowered.contains("full") || lowered.starts_with("wing") || lowered == "ngc" {
            return DeskModel::Full;
        }
        DeskModel::Unknown
    }

    /// The model field of a `WING?` discovery reply: `WING,<ip>,<name>,<mdl>,<serial>,<firmware>`
    /// (563-567). Anything shorter than the model field is [`DeskModel::Unknown`].
    pub fn from_discovery_reply(reply: &str) -> Self {
        let mut fields = reply.split(',');
        let _ = fields.next();
        let _ = fields.next();
        let _ = fields.next();
        Self::from_announcement(fields.next().unwrap_or_default())
    }

    /// The token the interface uses for this model, in the same spelling as the `mdl` field families.
    pub fn as_str(self) -> &'static str {
        match self {
            DeskModel::Full => "full",
            DeskModel::Rack => "rack",
            DeskModel::Compact => "compact",
            DeskModel::Unknown => "unknown",
        }
    }

    /// How a hint or a status line names this model family. It is a family, never a unit: no
    /// discovery name, serial, address or firmware may reach the operator (AGENTS.md, "No Console
    /// Identity In User-Visible Text").
    pub fn label(self) -> &'static str {
        match self {
            DeskModel::Full => "full-size WING",
            DeskModel::Rack => "WING Rack",
            DeskModel::Compact => "WING Compact",
            DeskModel::Unknown => "model not announced",
        }
    }

    pub fn is_known(self) -> bool {
        self != DeskModel::Unknown
    }

    /// The console's local microphone preamps: 8 on the full-size console, 24 on a Rack or a Compact
    /// (344, 421, 448; footnote 17 at 1641). `None` while the model is unknown.
    pub fn local_inputs(self) -> Option<u16> {
        match self {
            DeskModel::Full => Some(8),
            DeskModel::Rack | DeskModel::Compact => Some(24),
            DeskModel::Unknown => None,
        }
    }

    /// The local outputs. `/io/out/LCL/1` is documented `1..8` (1843) with no model note anywhere,
    /// and the Rack maps its four headphone outputs onto the same eight local outputs (423-424), so
    /// eight is a property of the family and not of one model. `None` while the model is unknown.
    pub fn local_outputs(self) -> Option<u16> {
        match self {
            DeskModel::Full | DeskModel::Rack | DeskModel::Compact => Some(8),
            DeskModel::Unknown => None,
        }
    }

    /// The local aux in/out pair: 8 in and 8 out on the full-size console, and the Rack and the
    /// Compact have "No local Aux IO" (422, 449). The parameter node prints no model note, so
    /// whether the node and its meters survive on the two smaller models was **hardware-pending**
    /// until 2026-09-27, when a WING Rack answered an `/io/in` AUX group of eight values: the node
    /// and its meter group are there even though the model is documented with no local aux IO. This
    /// still answers only what the document settles about the *connectors*. `None` while the model
    /// is unknown.
    pub fn local_aux_io(self) -> Option<u16> {
        match self {
            DeskModel::Full => Some(8),
            DeskModel::Rack | DeskModel::Compact => Some(0),
            DeskModel::Unknown => None,
        }
    }

    /// How many GPIOs the surface really has: 4 on the full-size console and on the Rack (408, 433),
    /// 2 on a Compact (453, and footnote 122 at 11536: *"2 GPIOs for the Compact model"*). The node
    /// itself prints `1..4` (4010), which is why the catalogue offers four and this is what tells the
    /// operator — and the id bound — what the desk in front of them has.
    pub fn gpio_count(self) -> u16 {
        match self {
            DeskModel::Compact => 2,
            // The documented node, for the desks the document gives four, and for a model that has
            // not announced itself: the catalogue may not shrink because of a missing answer.
            DeskModel::Full | DeskModel::Rack | DeskModel::Unknown => 4,
        }
    }

    /// Whether `/cfg/mon/<n>/$lvl` takes a write on this desk.
    ///
    /// Footnote 13 (1357-1359), glued to the row at 1316: *"This command is considered RO on the
    /// full-size WING, and can be set for other devices where the actual surface control
    /// potentiometer is not present."* The document therefore withholds it from the full-size
    /// console and grants it to the two smaller models, which have no surface potentiometer at all
    /// (the Rack's only level knob is the front headphone out, 423-424 and 440-450).
    ///
    /// **Measured on a WING Rack, 2026-09-27**: the desk refused the write in every spelling the
    /// leaf could take — the normalised integer, the normalised float, the dB float, the dB string
    /// and the console's own spelling of the value — and `/cfg/mon/2/$lvl` did not answer at all
    /// while `/cfg/mon/2/pan` did, so on that model (and firmware) the leaf is a report and not a
    /// control. Footnote 13's reading of "a Rack can set it" does not hold there, so the write is
    /// withheld on the Rack as well and only the Compact keeps it — the one model the document
    /// grants and no desk here can measure (master plan 2026-09-22 §12 item 2; the measurement is
    /// recorded in `docs/MACRO_TARGET_PLAN_2026-09-24.md`, "Measured on the console, 2026-09-27").
    /// An unannounced model fails closed, and the caller says why.
    pub fn monitor_level_is_writable(self) -> bool {
        matches!(self, DeskModel::Compact)
    }
}

pub mod osc {
    use std::fmt;

    #[derive(Clone, Debug, PartialEq)]
    pub enum OscArg {
        Int(i32),
        Float(f32),
        String(String),
        Bool(bool),
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum OscEncodeError {
        EmptyAddress,
        InvalidAddress(String),
        StringContainsNull,
    }

    impl fmt::Display for OscEncodeError {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            match self {
                OscEncodeError::EmptyAddress => write!(f, "OSC address is required"),
                OscEncodeError::InvalidAddress(address) => {
                    write!(f, "OSC address must start with '/': {address}")
                }
                OscEncodeError::StringContainsNull => {
                    write!(f, "OSC strings cannot contain null bytes")
                }
            }
        }
    }

    impl std::error::Error for OscEncodeError {}

    pub fn encode_message(address: &str, args: &[OscArg]) -> Result<Vec<u8>, OscEncodeError> {
        let address = address.trim();
        if address.is_empty() {
            return Err(OscEncodeError::EmptyAddress);
        }
        if !address.starts_with('/') {
            return Err(OscEncodeError::InvalidAddress(address.to_string()));
        }
        if address.as_bytes().contains(&0) {
            return Err(OscEncodeError::StringContainsNull);
        }

        let mut bytes = Vec::new();
        push_osc_string(&mut bytes, address)?;

        let mut type_tags = String::from(",");
        for arg in args {
            match arg {
                OscArg::Int(_) => type_tags.push('i'),
                OscArg::Float(_) => type_tags.push('f'),
                OscArg::String(_) => type_tags.push('s'),
                OscArg::Bool(true) => type_tags.push('T'),
                OscArg::Bool(false) => type_tags.push('F'),
            }
        }
        push_osc_string(&mut bytes, &type_tags)?;

        for arg in args {
            match arg {
                OscArg::Int(value) => bytes.extend_from_slice(&value.to_be_bytes()),
                OscArg::Float(value) => bytes.extend_from_slice(&value.to_bits().to_be_bytes()),
                OscArg::String(value) => push_osc_string(&mut bytes, value)?,
                OscArg::Bool(_) => {}
            }
        }

        Ok(bytes)
    }

    fn push_osc_string(bytes: &mut Vec<u8>, value: &str) -> Result<(), OscEncodeError> {
        if value.as_bytes().contains(&0) {
            return Err(OscEncodeError::StringContainsNull);
        }
        bytes.extend_from_slice(value.as_bytes());
        bytes.push(0);
        while bytes.len() % 4 != 0 {
            bytes.push(0);
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn encodes_address_and_integer_arg() {
            let bytes = encode_message("/ch/1/mute", &[OscArg::Int(1)]).expect("encode");

            assert_eq!(
                bytes,
                vec![
                    0x2f, 0x63, 0x68, 0x2f, 0x31, 0x2f, 0x6d, 0x75, 0x74, 0x65, 0x00, 0x00, 0x2c,
                    0x69, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
                ],
            );
        }

        #[test]
        fn encodes_float_string_and_bool_tags() {
            let bytes = encode_message(
                "/test",
                &[
                    OscArg::Float(1.5),
                    OscArg::String("ok".to_string()),
                    OscArg::Bool(true),
                    OscArg::Bool(false),
                ],
            )
            .expect("encode");

            assert_eq!(&bytes[8..16], b",fsTF\0\0\0");
            assert_eq!(&bytes[16..20], &1.5_f32.to_bits().to_be_bytes());
            assert_eq!(&bytes[20..24], b"ok\0\0");
        }

        #[test]
        fn rejects_invalid_addresses() {
            assert_eq!(
                encode_message("ch/1/mute", &[]).expect_err("invalid"),
                OscEncodeError::InvalidAddress("ch/1/mute".to_string()),
            );
        }
    }
}

pub mod targets {
    use crate::meters::{MeterDescriptor, MeterFamily};
    use crate::DeskModel;

    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct BasicTargetSpec {
        pub category: String,
        pub ids: String,
        pub parameter: String,
        pub send_id: Option<u8>,
        pub custom_address: Option<String>,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub struct TargetCategoryInfo {
        pub key: &'static str,
        pub label: &'static str,
        pub group: &'static str,
        /// The finer family inside `group`, empty when the group is short enough to read in one go.
        ///
        /// An `<optgroup>` cannot nest, so the two levels travel side by side: the select keeps one
        /// group per `group`, each option carries its `subgroup`, and the drawn dropdown
        /// (`desktop/ui/dropdown.js`) paints the subgroup as a heading inside the group. This is the
        /// sixteen input families and eleven output feeds of Maillot 1955-1965 and 1844-1846 (his
        /// seventeen-entry group list less `OFF`, which is not a source), where one flat list of
        /// sixteen names hides which of them are the desk's own inputs and which are a stage box.
        pub subgroup: &'static str,
        pub count: u16,
        pub prefix: &'static str,
        pub can_trigger: bool,
        pub can_target: bool,
    }

    /// How a fade moves between the two values it was given.
    ///
    /// Maillot spells a numeric row `linf […, n]` or `logf […, n]` in the plugin appendix, and that
    /// word is the leaf's own description of how its steps are spaced: [`FadeDomain::Linear`] moves by
    /// a constant offset per step, [`FadeDomain::Logarithmic`] by a constant ratio. A ramp of a
    /// frequency, a Q or a release time that ignores it arrives at the right value by a wrong path.
    /// See [`fade_domain`], which is the one place the answer is decided.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum FadeDomain {
        Linear,
        Logarithmic,
    }

    // No `Eq`: the range is kept as `f32`, and a float has no total equality.
    #[derive(Clone, Copy, Debug, PartialEq)]
    pub struct TargetParameterInfo {
        pub key: &'static str,
        pub label: &'static str,
        /// What the console accepts when the parameter is written: `int`, `float` or `string`.
        pub arg_kind: &'static str,
        /// How the value behaves, which decides what can be done with it: the comparators that make
        /// sense when it is watched, the field the editor draws and the unit it shows. One of
        /// [`VALUE_KINDS`]; the rule table is [`operators_for_value_kind`].
        pub value_kind: &'static str,
        /// Unit of a numeric value ("dB", "Hz", "ms", "%"), empty when it has none.
        pub unit: &'static str,
        /// Inclusive range of a numeric value; `f32::NAN` means "no range declared".
        pub min: f32,
        pub max: f32,
        /// True when the console **reports** this parameter, so it can be watched as a trigger or an
        /// IF gate: every OSC leaf the console publishes qualifies, and only the deliberately dead
        /// entries (`custom`'s snapshot/preset loading, which resolve to no address at all) do not.
        ///
        /// What makes a watch *meaningful* is not the parameter but the comparison, and that is what
        /// `value_kind` decides: a source's `Name` can be watched with "equals VOX 1" and never with
        /// "rises above -20".
        pub can_trigger: bool,
        /// Extra sentence the editor shows under the field.
        pub hint: &'static str,
        /// Closed list of accepted values when the console documents one (a model name, a user
        /// button mode, the output source group). Empty when the value is free.
        pub options: &'static [&'static str],
        /// Longest value the console accepts, when Maillot documents it (a name is 16 characters,
        /// a DCA or mute-group name is 8). `0` means "no documented limit".
        pub max_len: u16,
        /// The console models on which this leaf is **read-only** although the document prints a
        /// write path for it. `monitor_level` is the only one: footnote 13 (1357-1359) withholds it
        /// from the full-size WING and gives it to the devices whose surface has no control
        /// potentiometer, and a WING Rack was measured on 2026-09-27 to refuse the write as well
        /// (the measurement is in `docs/MACRO_TARGET_PLAN_2026-09-24.md`). Empty for everything else.
        ///
        /// A desk that has not announced its model is not in this list and is not offered the write
        /// either — see [`write_allowed_on_model`]: the permission is model-specific, so an unknown
        /// model cannot be granted it.
        pub read_only_on_models: &'static [DeskModel],
    }

    /// Whether a parameter may be written on a desk of this model.
    ///
    /// [`TargetParameterInfo::read_only_on_models`] lists the models the document itself refuses.
    /// Two answers follow from it, and both matter to a step: a model the document names and that is
    /// not in the list takes the write; a model the desk has not announced does not, because the
    /// permission is model-specific and guessing it in either direction is what the audit exists to
    /// stop (a write the console ignores, reported as success).
    pub fn write_allowed_on_model(parameter: &TargetParameterInfo, model: DeskModel) -> bool {
        parameter.read_only_on_models.is_empty()
            || (model.is_known() && !parameter.read_only_on_models.contains(&model))
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct ResolvedMeterTarget {
        pub address: String,
        pub label: String,
        pub family: &'static str,
        pub device_id: Option<u8>,
        pub index: u8,
        pub value_slot: usize,
    }

    const fn category(
        key: &'static str,
        label: &'static str,
        group: &'static str,
        count: u16,
        prefix: &'static str,
        can_trigger: bool,
        can_target: bool,
    ) -> TargetCategoryInfo {
        category_in(key, label, group, "", count, prefix, can_trigger, can_target)
    }

    /// A category that needs a second level inside its group.
    ///
    /// The group is the coarse family ("Sources", "Outputs") and the subgroup names what the entries
    /// actually are ("Local", "Stage box", "Card & USB", "Bus meters", "Internal"). The drawn
    /// dropdown shows both; the `<select>` keeps the group alone, because an `<optgroup>` cannot nest
    /// and the native list is what every other part of the app reads.
    const fn category_in(
        key: &'static str,
        label: &'static str,
        group: &'static str,
        subgroup: &'static str,
        count: u16,
        prefix: &'static str,
        can_trigger: bool,
        can_target: bool,
    ) -> TargetCategoryInfo {
        TargetCategoryInfo {
            key,
            label,
            group,
            subgroup,
            count,
            prefix,
            can_trigger,
            can_target,
        }
    }

    /// An entry that is listed so the editor can show it, but deliberately writes nothing. The hint
    /// is not optional: an operator who finds a control with no explanation has been told nothing,
    /// which is the failure mode this whole audit is about.
    const fn dead_parameter(
        key: &'static str,
        label: &'static str,
        hint: &'static str,
    ) -> TargetParameterInfo {
        TargetParameterInfo {
            key,
            label,
            arg_kind: "string",
            value_kind: "text",
            unit: "",
            min: f32::NAN,
            max: f32::NAN,
            can_trigger: false,
            hint,
            options: &[],
            max_len: 0,
            read_only_on_models: &[],
        }
    }

    /// A value the console reports as a native meter: a level in dB with `>` / `<`.
    const fn meter_parameter(key: &'static str, label: &'static str) -> TargetParameterInfo {
        TargetParameterInfo {
            key,
            label,
            arg_kind: "float",
            value_kind: "db_meter",
            unit: "dB",
            min: -144.0,
            max: 10.0,
            can_trigger: true,
            hint: "First value of the group the console reports (Maillot table 5 slot 0: input left for a channel, the group level for a source).",
            options: &[],
            max_len: 0,
            read_only_on_models: &[],
        }
    }

    /// A `* V2` slot that is a flag rather than a level (Maillot: "Gate LED and Dyn State in `* V2`
    /// subscriptions return a value of 0 or 1").
    const fn meter_flag_parameter(key: &'static str, label: &'static str) -> TargetParameterInfo {
        TargetParameterInfo {
            key,
            label,
            arg_kind: "int",
            value_kind: "toggle",
            unit: "",
            min: 0.0,
            max: 1.0,
            can_trigger: true,
            hint: "Reported by the console as 0 or 1.",
            options: &[],
            max_len: 0,
            read_only_on_models: &[],
        }
    }

    /// A parameter the console reports as an OSC state value and that can be watched.
    /// Every value kind the catalogue may declare.
    pub const VALUE_KINDS: &[&str] = &[
        "db_meter",
        "db",
        "number",
        "hz",
        "ms",
        "percent",
        "toggle",
        "text",
        "enum",
    ];

    /// Which comparators make sense for a value kind. The editor builds its comparison list from
    /// this table and the backend refuses anything outside it, so an impossible comparison cannot be
    /// built in the window nor injected with a hand-edited show file.
    pub fn operators_for_value_kind(value_kind: &str) -> &'static [&'static str] {
        match value_kind {
            // A meter is a level that moves; only a crossing means anything.
            "db_meter" => &[">", "<"],
            // On/off and text are compared, never ordered.
            "toggle" | "text" | "enum" => &["==", "!="],
            "db" | "number" | "hz" | "ms" | "percent" => &["<", ">", "==", "!="],
            _ => &[],
        }
    }

    /// How a value is written when it is used as a comparison value: numbers plain, a toggle as 0/1.
    pub fn default_trigger_value(value_kind: &str) -> &'static str {
        match value_kind {
            "toggle" => "1",
            "db" | "db_meter" => "-18",
            "hz" => "1000",
            "ms" => "100",
            "percent" => "0",
            "number" => "1",
            _ => "",
        }
    }

    /// A value the editor can start a comparison with: the first entry of a closed list, and for a
    /// number the kind's usual default moved inside the parameter's own range.
    ///
    /// A fixed per-kind default is wrong for half the catalogue: `-18` is a sensible threshold but
    /// outside Gate Range (3…60) and Compressor Gain (−6…12), and `1` is outside a ratio (1.1…100).
    /// Seeding one of those handed the operator a value the same validator refuses. Free text seeds
    /// nothing (there is no sensible default for a name), and neither does a parameter the console
    /// does not report.
    pub fn default_comparison_value(category: &str, parameter: &str) -> Option<String> {
        let rule = watch_rule(category, parameter)?;
        if !rule.can_trigger {
            return None;
        }
        match rule.value_kind {
            "toggle" => Some("1".to_string()),
            "enum" => rule.options.first().map(|option| (*option).to_string()),
            "text" => None,
            kind => {
                let seed = default_trigger_value(kind).parse::<f32>().ok()?;
                let clamped = if seed < rule.min {
                    rule.min
                } else if seed > rule.max {
                    rule.max
                } else {
                    seed
                };
                Some(trim_number(clamped))
            }
        }
    }

    pub const TARGET_CATEGORIES: &[TargetCategoryInfo] = &[
        category("ch", "Channels", "Mix", 40, "CH", true, true),
        category("aux", "Aux Inputs", "Mix", 8, "AUX", true, true),
        category("bus", "Buses", "Mix", 16, "BUS", true, true),
        category("main", "Mains", "Mix", 4, "MAIN", true, true),
        category("matrix", "Matrices", "Mix", 8, "MTX", true, true),
        category_in(
            "preamp_local",
            "Local Inputs",
            "Sources",
            "Local",
            24,
            "LCL",
            true,
            true,
        ),
        category_in(
            "preamp_aux",
            "Aux Sources",
            "Sources",
            "Local",
            8,
            "AUX",
            true,
            true,
        ),
        category_in(
            "preamp_aes50a",
            "AES50-A Inputs",
            "Sources",
            "Stage box",
            48,
            "A",
            true,
            true,
        ),
        category_in(
            "preamp_aes50b",
            "AES50-B Inputs",
            "Sources",
            "Stage box",
            48,
            "B",
            true,
            true,
        ),
        category_in(
            "preamp_aes50c",
            "AES50-C Inputs",
            "Sources",
            "Stage box",
            48,
            "C",
            true,
            true,
        ),
        category_in(
            "preamp_stageconnect",
            "StageConnect Inputs",
            "Sources",
            "Stage box",
            32,
            "SC",
            true,
            true,
        ),
        category_in(
            "usb",
            "USB Audio Inputs",
            "Sources",
            "Card & USB",
            48,
            "USB",
            true,
            true,
        ),
        category_in(
            "preamp_card",
            "Card Inputs",
            "Sources",
            "Card & USB",
            64,
            "CRD",
            true,
            true,
        ),
        category_in(
            "preamp_module",
            "Module Inputs",
            "Sources",
            "Card & USB",
            64,
            "MOD",
            true,
            true,
        ),
        category_in(
            "preamp_usbplayer",
            "USB Player Inputs",
            "Sources",
            "Local",
            4,
            "PLAY",
            true,
            true,
        ),
        category_in(
            "preamp_aesebu",
            "AES/EBU Inputs",
            "Sources",
            "Local",
            2,
            "AES",
            true,
            true,
        ),
        category_in(
            "usersig",
            "User Signals",
            "Sources",
            "Internal",
            56,
            "USR",
            true,
            true,
        ),
        category_in(
            "preamp_oscillator",
            "Oscillator",
            "Sources",
            "Local",
            2,
            "OSC",
            true,
            true,
        ),
        category_in(
            "preamp_bus",
            "Bus Source Meters",
            "Sources",
            "Bus meters",
            32,
            "BUS",
            true,
            false,
        ),
        category_in(
            "preamp_main",
            "Main Source Meters",
            "Sources",
            "Bus meters",
            8,
            "MAIN",
            true,
            false,
        ),
        category_in(
            "preamp_matrix",
            "Matrix Source Meters",
            "Sources",
            "Bus meters",
            16,
            "MTX",
            true,
            false,
        ),
        category_in(
            "output_local",
            "Local Outputs",
            "Outputs",
            "Local",
            8,
            "LCL",
            true,
            true,
        ),
        category_in(
            "output_aux",
            "Aux Outputs",
            "Outputs",
            "Local",
            8,
            "AUX",
            true,
            true,
        ),
        category_in(
            "output_aes50a",
            "AES50-A Outputs",
            "Outputs",
            "Stage box",
            48,
            "A",
            true,
            true,
        ),
        category_in(
            "output_aes50b",
            "AES50-B Outputs",
            "Outputs",
            "Stage box",
            48,
            "B",
            true,
            true,
        ),
        category_in(
            "output_aes50c",
            "AES50-C Outputs",
            "Outputs",
            "Stage box",
            48,
            "C",
            true,
            true,
        ),
        category_in(
            "output_stageconnect",
            "StageConnect Outputs",
            "Outputs",
            "Stage box",
            32,
            "SC",
            true,
            true,
        ),
        category_in(
            "output_usb",
            "USB Audio Outputs",
            "Outputs",
            "Card & USB",
            48,
            "USB",
            true,
            true,
        ),
        category_in(
            "output_card",
            "Card Outputs",
            "Outputs",
            "Card & USB",
            64,
            "CRD",
            true,
            true,
        ),
        category_in(
            "output_module",
            "Module Outputs",
            "Outputs",
            "Card & USB",
            64,
            "MOD",
            true,
            true,
        ),
        category_in(
            "output_usbrec",
            "USB Recorder Outputs",
            "Outputs",
            "Local",
            4,
            "REC",
            true,
            true,
        ),
        category_in(
            "output_aesebu",
            "AES/EBU Outputs",
            "Outputs",
            "Local",
            2,
            "AES",
            true,
            true,
        ),
        category("dca", "DCAs", "Control", 16, "DCA", true, true),
        category("mutegroup", "Mute Groups", "Control", 8, "MGRP", true, true),
        category("fx", "FX Slots", "Control", 16, "FX", true, true),
        // The category index is the console's *second* index: `/$ctl/user/<page>/<button>` is a
        // page 1..16 with buttons 1..4 (Maillot 3933 and 3942), and the resolver always builds
        // `/$ctl/user/1/<id>/bu/mode`. Counting sixteen here offered twelve buttons that do not
        // exist (ids 5..16 built a path the console ignores), the same class of defect as `ch 999`.
        category("userctrl", "User Controls", "Control", 4, "USER", true, true),
        category(
            "monitor",
            "Monitor Meters",
            "Control",
            6,
            "MON",
            true,
            false,
        ),
        category("rta", "RTA Bands", "Control", 120, "RTA", true, false),
        // Talkback (Maillot 1460-1534): one node with two entries, A and B, whose id segment in the
        // path is the **letter** and not the number (`/cfg/talk/A/$on`, never `/cfg/talk/1/$on`).
        // Both entries are written and reported, so both flags are set. See
        // [`CategoryIdSegment::Letter`], the second shape the resolver builds. The group is its own
        // section in the editor's picker, the way the console's own screen presents it.
        category("talk", "Talkback", "Talkback", 2, "/cfg/talk", true, true),
        // GPIO (Maillot 4009-4014): one node, two categories, because the split *is* the rule. The
        // console takes `mode` and `gpstate` and also reports them, while `$state` is `[RO]`:
        // offering it as a target would aim a step at a leaf the console only reads, and the flags
        // are per category, so it cannot stay in the target category either. Exactly the shape of
        // `show`/`showstate` below, and the leaf tables refuse the crossing as well.
        //
        // All four ids are offered although a Compact console has two (footnote 122, "2 GPIOs for
        // the Compact model"): the catalogue describes the node the document prints — `1..4` at
        // 4010 — and each hint says what a Compact really has.
        category("gpio", "GPIO", "GPIO", 4, "/$ctl/gpio", true, true),
        category(
            "gpiostate",
            "GPIO Input State",
            "GPIO",
            4,
            "/$ctl/gpio",
            true,
            false,
        ),
        // The I/O node (Maillot 1592-1594): the two desk-wide switches a macro could not reach —
        // the MAIN/ALT switch and its automatic override — both reported by the console as well as
        // written, hence both flags. Its documented path carries no id segment (`/io/altsw`, never
        // `/io/1/altsw`), so it is the catalogue's third **index-less** category, exactly the shape
        // `show`/`showstate` established (see `category_id_segment`).
        category("io", "I/O", "I/O", 1, "/io", true, true),
        // ── Batch 4: transport and surface (Maillot 3045-3075, 3095-3097, 3219-3701) ─────────────
        //
        // The fader layers are the catalogue's second **letter** category: one node per surface
        // (`/$ctl/layer/L`, `/C`, `/R`, `/CMPCT`, `/RCK`, `/EXT`, `/VRT`, 3219-3644), each carrying
        // the same `sel` leaf, and the letter in the path is the id (`/$ctl/layer/L/sel`, never
        // `/$ctl/layer/1/sel`). The id and the value are two different things here: the id names the
        // surface, the value written is the layer number 1…22. Every surface is written and reported,
        // so both flags are set.
        //
        // The USB recorder and the USB player are one node each, split in two: the console takes the
        // transport leaves and *reports* the state ones (`$actstate`, `$pos`, `$time`), so offering
        // either half on the other's control would build a write the console ignores or a watch that
        // can never fire — the rule `show`/`showstate` and `gpio`/`gpiostate` established. Both nodes
        // are index-less: `/rec/$action` and `/play/$action` carry no id (3068-3075, 3045-3066).
        //
        // `stat` is the console-status node `/$ctl/$stat` (3095-3097). Its two keys are read-only, and
        // they are the "the operator selected strip n" trigger the sweep called valuable: `can_trigger`
        // only, so no step can be aimed at a leaf the console does not write.
        category("layer", "Fader Layers", "Surface", 7, "/$ctl/layer", true, true),
        category("rec", "USB Recorder", "Transport", 1, "/rec", false, true),
        category("recstate", "USB Recorder State", "Transport", 1, "/rec", true, false),
        category("play", "USB Player", "Transport", 1, "/play", false, true),
        category("playstate", "USB Player State", "Transport", 1, "/play", true, false),
        category("stat", "Console Status", "Console", 1, "/$ctl/$stat", true, false),
        // Show control (Maillot 4105-4126): one node, two categories, because the split *is* the
        // rule. The console takes the two keys a step writes and reports the five a trigger reads,
        // and offering either side on the other's control is the defect the split prevents: a
        // "watch" of `$actionidx` could never fire, and a step at `$scenes` would write a read-only
        // leaf. `can_target`/`can_trigger` therefore differ, exactly as `monitor` and `rta` do.
        //
        // Both are the catalogue's first **index-less** categories: the documented path carries no
        // id segment (`/$ctl/lib/$action`, never `/$ctl/lib/1/$action`), so `count` is the single
        // documented entry and the id the editor happens to hold is not part of the address. See
        // `category_id_segment`, which is also the seam `layer` (batch 4, a letter segment) needs.
        category("show", "Show Control", "Control", 1, "/$ctl/lib", false, true),
        category("showstate", "Show State", "Control", 1, "/$ctl/lib", true, false),
        // ── Batch 6: the desk level (Maillot 3128-3145, 4016-4067, 1314-1394, 1249-1301, 2950-3024,
        //    4168-4186) ─────────────────────────────────────────────────────────────────────────────
        //
        // Nine blocks the sweep ranked last but a show still touches. Three shapes are worth naming
        // here, because they are what the flags below express:
        //
        //   * a node that carries read-only *and* writable leaves — the monitor buses (`$lvl` is
        //     read-only on the full-size desk, footnote 13; `$lvlact` is `[RO]`), the solo
        //     configuration (the six `$`-prefixed leaves), the AES50 status (`stat`, `dev`, both
        //     error counters; only `clrerr` is writable) and the W-Live card (`$stat/state` against
        //     the `$ctl` commands). The category stays **one**, because the document prints one node
        //     and the editor's picker is per node; the split lives in the two parameter lists, and
        //     the read-only keys are only ever offered as watches. Both flags are true.
        //   * two nodes the console only reports: `deskstatus` (`/$stat/lock`, `/$stat/ppm`, both
        //     `[RO]`) and `cards` (the identity of the card in the slot, `/$type` and `/$ver`).
        //     `can_target` is false, so no step can be aimed at them whatever the leaf table holds.
        //   * the AES50 status node, whose id segment is a **letter** (`/$stat/A/stat`, 1254-1272) and
        //     not a number: the third category on that seam after talkback and the fader layers.
        //
        // `wlive` gets two ids, not four: Maillot prints `/cards/wlive/1  N  1..2` (2966) and a node
        // row's range column *is* its series range (`/cfg/mon/1 N 1..2` at 1315, `/ch/1 N 1..40` at
        // 1933), while `$stat/linkedpos` speaks of "the other card" (3017). An id 3 or 4 would build
        // a path the console ignores in silence — the defect class the whole audit exists for.
        category("lights", "Desk Lights", "Console", 1, "/$ctl/cfg/lights", true, true),
        category("safes", "Safes", "Control", 1, "/$ctl/safes", true, true),
        category("monbus", "Monitor Buses", "Monitor", 2, "/cfg/mon", true, true),
        category("solocfg", "Solo Configuration", "Monitor", 1, "/cfg/solo", true, true),
        category("aes50", "AES50 Status", "Console", 3, "/$stat", true, true),
        category("deskstatus", "Desk Status", "Console", 1, "/$stat", true, false),
        category("wlive", "W-Live Multitrack", "Transport", 2, "/cards/wlive", true, true),
        category("cards", "Cards", "Transport", 1, "/cards", true, false),
        category("globals", "Global Settings", "Console", 1, "/$globals", true, true),
        category("custom", "Custom OSC", "Advanced", 1, "/", false, true),
    ];

    // ── The catalogue is the single source of truth ────────────────────────────────────────────────
    //
    // Every entry carries, besides the OSC leaf it resolves to:
    //   * `value_kind` — what the value *is*, which decides the comparators that make sense, the
    //     field the editor draws and whether a number, an on/off pair or a text value is asked for;
    //   * `unit` and `min`/`max` — the documented unit and range (Maillot's appendix tables), used by
    //     the editor and by the backend validation so both refuse the same values;
    //   * `options` — the closed list when the console documents one (a model, a user-button mode);
    //   * `can_trigger` — whether the console *reports* the parameter, so it can be watched;
    //   * `max_len` — the documented length of a text value (16 for a channel name, 8 for a DCA).
    //
    // Ranges below are Maillot's, cited line by line in `scratch/wing_protocols.txt`; the audit that
    // filled them is the reason a source's "Name" can no longer be compared with "rises above -20".

    /// On/off leaves: 0 or 1, compared with `==` / `!=`.
    const fn toggle(key: &'static str, label: &'static str, hint: &'static str) -> TargetParameterInfo {
        TargetParameterInfo {
            key,
            label,
            arg_kind: "int",
            value_kind: "toggle",
            unit: "",
            min: 0.0,
            max: 1.0,
            can_trigger: true,
            hint,
            options: &[],
            max_len: 0,
            read_only_on_models: &[],
        }
    }

    /// A numeric leaf with its documented unit and range.
    const fn number(
        key: &'static str,
        label: &'static str,
        value_kind: &'static str,
        unit: &'static str,
        min: f32,
        max: f32,
        hint: &'static str,
    ) -> TargetParameterInfo {
        TargetParameterInfo {
            key,
            label,
            arg_kind: "float",
            value_kind,
            unit,
            min,
            max,
            can_trigger: true,
            hint,
            options: &[],
            max_len: 0,
            read_only_on_models: &[],
        }
    }

    /// A numeric leaf Maillot documents as `I`: the console takes an OSC integer there, so the app
    /// must send `,i` and not `,f` (a float is at best coerced and at worst ignored).
    ///
    /// The value kind is the caller's, because it describes how the *value* behaves (`number` here:
    /// the editor still offers the ordered comparators) while `arg_kind` describes how it is
    /// **written**, which is what [`watch_value_is_continuous`] has to see: a fade writes a series of
    /// numbers, and a colour, an icon, a knee or an output index cannot be ramped.
    const fn integer(
        key: &'static str,
        label: &'static str,
        value_kind: &'static str,
        unit: &'static str,
        min: f32,
        max: f32,
        hint: &'static str,
    ) -> TargetParameterInfo {
        TargetParameterInfo {
            key,
            label,
            arg_kind: "int",
            value_kind,
            unit,
            min,
            max,
            can_trigger: true,
            hint,
            options: &[],
            max_len: 0,
            read_only_on_models: &[],
        }
    }

    /// A text leaf (a name) with the length the console accepts.
    const fn text(
        key: &'static str,
        label: &'static str,
        max_len: u16,
        hint: &'static str,
    ) -> TargetParameterInfo {
        TargetParameterInfo {
            key,
            label,
            arg_kind: "string",
            value_kind: "text",
            unit: "",
            min: f32::NAN,
            max: f32::NAN,
            can_trigger: true,
            hint,
            options: &[],
            max_len,
            read_only_on_models: &[],
        }
    }

    /// A leaf whose value is one of a documented list.
    const fn choice(
        key: &'static str,
        label: &'static str,
        options: &'static [&'static str],
        hint: &'static str,
    ) -> TargetParameterInfo {
        TargetParameterInfo {
            key,
            label,
            arg_kind: "string",
            value_kind: "enum",
            unit: "",
            min: f32::NAN,
            max: f32::NAN,
            can_trigger: true,
            hint,
            options,
            max_len: 0,
            read_only_on_models: &[],
        }
    }

    /// The entry a constructor above built, with `can_trigger` cleared: a leaf the console **takes**
    /// but does not report.
    ///
    /// The category flag is the primary split — `show` cannot be triggered at all, so
    /// [`trigger_parameters_for_category`] answers nothing for it — and this makes the entry itself
    /// honest too, so the per-entry rule the contract test pins ("a parameter that cannot be watched
    /// offers no comparator") holds wherever the entry is read from, and so
    /// [`default_comparison_value`] and [`watch_problem`] refuse it without a category test.
    ///
    /// It is applied *around* the ordinary constructor, not as a second one: `scene_index` is a
    /// whole number exactly like a colour index (`integer`) and `scene_action` a closed list exactly
    /// like a user-button mode (`choice`), and a parallel constructor would be a second place for
    /// those rules to drift.
    const fn write_only(mut parameter: TargetParameterInfo) -> TargetParameterInfo {
        parameter.can_trigger = false;
        parameter
    }

    /// The same entry, with the write withheld on the models the document refuses it on **and** on
    /// the model a desk was measured to refuse it on.
    ///
    /// One key uses it: the monitor bus level, whose footnote 13 (1357-1359) makes it read-only on
    /// the full-size WING and settable on the devices whose surface has no control potentiometer —
    /// a reading the WING Rack contradicted on 2026-09-27, when it ignored every spelling of the
    /// write while still answering the rest of its monitor node. The Compact, which the document
    /// grants and no desk here can measure, is the only model the write is offered on.
    /// Like [`write_only`] it wraps the ordinary constructor instead of duplicating it, so the range,
    /// the unit, the hint and the comparators stay in one place and the models cannot drift apart.
    const fn read_only_on(
        mut parameter: TargetParameterInfo,
        models: &'static [DeskModel],
    ) -> TargetParameterInfo {
        parameter.read_only_on_models = models;
        parameter
    }

    /// The 33 user-button modes (Maillot 3957-3968).
    const USER_BUTTON_MODES: &[&str] = &[
        "OFF", "MUTE", "SOLO", "INS1", "INS2", "MGRP", "DCAMUTE", "SOF", "SPILL", "FXPAR",
        "DAWBTN", "DAWENC", "CHPAGE", "PAGE", "FDRPAGE", "VIEWPAGE", "OTHER", "GPIO", "FSTART",
        "SHOWCTL", "SCENES", "MIDICCT", "MIDICCP", "MIDINT", "MIDINP", "MIDIPGM", "USBPR", "SDRECA",
        "SESSIONA", "MARKERA", "SDRECB", "SESSIONB", "MARKERB",
    ];

    /// The output source groups, byte for byte Maillot's `/io/out/*/grp` list (1844-1846):
    /// `OFF, LCL, AUX, A, B, C, SC, USB, CRD, MOD, PLAY, AES, USR, OSC, BUS, MAIN, MTX, SEND, MON`.
    /// The previous constant invented `INP`/`USBREC`/`SIG` and dropped `USR`/`SEND`/`MON`, so the
    /// editor offered `SEND` and the backend refused it, while the three documented groups the
    /// console really has could not be selected at all.
    const OUTPUT_SOURCE_GROUPS: &[&str] = &[
        "OFF", "LCL", "AUX", "A", "B", "C", "SC", "USB", "CRD", "MOD", "PLAY", "AES", "USR", "OSC",
        "BUS", "MAIN", "MTX", "SEND", "MON",
    ];

    /// The seventeen groups a channel's or an aux's input can be connected to (Maillot 1956-1958
    /// and 2225-2227), in the document's order. It is the output list without `SEND` and `MON`: an
    /// input can be fed from a bus, a main or a matrix (1795-1823) but not from an FX send or the
    /// monitor node. The two lists are kept separate because they are two documented rows, not
    /// because they disagree — a test pins the seventeen.
    const INPUT_CONN_GROUPS: &[&str] = &[
        "OFF", "LCL", "AUX", "A", "B", "C", "SC", "USB", "CRD", "MOD", "PLAY", "AES", "USR", "OSC",
        "BUS", "MAIN", "MTX",
    ];

    /// The three modes of an input source node, `/io/in/<group>/<n>/mode` (Maillot 1599, 1618, 1629,
    /// 1652, 1671, 1690, 1702, 1713, 1724, 1735, 1747, 1760, 1781): mono, stereo and mid/side. Every
    /// physical input group prints the same three, the oscillator's own row included — but that row is
    /// `[RO]` (1781), so it is the one source the key is not offered on (see
    /// [`source_parameter_allowed`]).
    const SOURCE_MODES: &[&str] = &["M", "ST", "M/S"];

    /// The three waveforms of `/io/in/OSC/<n>/osc/mode` (Maillot 1792), in the document's order.
    const OSCILLATOR_MODES: &[&str] = &["SINE", "PINK", "WHITE"];

    /// The three monitor modes of `/mon` (Maillot 2002, 2253, 2396, 2567, 2734 and 2876 for DCAs).
    const MONITOR_MODES: &[&str] = &["A", "B", "A+B"];

    /// An insert FX slot assignment: `NONE` or one of the sixteen slots (Maillot `NONE, FX1..FX16`
    /// at 2148, 2183, 2327, 2491, 2514, 2666, 2677, 2836, 2841). The document's `FX1..FX16` ranges
    /// are written out because the console takes the slot names, not the range notation.
    const INSERT_FX_SLOTS: &[&str] = &[
        "NONE", "FX1", "FX2", "FX3", "FX4", "FX5", "FX6", "FX7", "FX8", "FX9", "FX10", "FX11",
        "FX12", "FX13", "FX14", "FX15", "FX16",
    ];

    // ── Documented `/fx/<slot>/mdl` values ────────────────────────────────────────────────────────
    //
    // Maillot 2896-2919 lists the models for `/fx/1..8`, 2921-2934 the reduced list for `/fx/9..16`.
    // The strings are transcribed from the `/fx/N/mdl` row itself, not from the appendix: the
    // appendix also carries spellings the console does not accept (`V_IMG`, `R-OOM`, `DELREV`,
    // `TILT`, `MAX`, `AP1`, `AP2`, `2250`), and a mangled model name is a silent no-op on a write.
    // Note `DEL/REV` (2898-2901) is the console's spelling, not `DELREV`.
    const FX_MODELS_SLOTS_1_TO_8: &[&str] = &[
        "NONE", "EXT", "HALL", "ROOM", "CHAMBER", "PLATE", "CONCERT", "AMBI", "V-ROOM", "V-REV",
        "V-PLATE", "GATED", "REVERSE", "DEL/REV", "SHIMMER", "SPRING", "DIMCRS", "CHORUS",
        "FLANGER", "ST-DL", "TAP-DL", "TAPE-DL", "OILCAN", "BBD-DL", "PITCH", "D-PITCH", "VSS3",
        "BPLATE", "GEQ", "PIA", "DOUBLE", "PCORR", "LIMITER", "DE-S2", "ENHANCE", "EXCITER",
        "P-BASS", "ROTARY", "PHASER", "PANNER", "TAPE", "MOOD", "SUB", "RACKAMP", "UKROCK", "ANGEL",
        "JAZZC", "DELUXE", "BODY", "SOUL", "E88", "E84", "F110", "PULSAR", "MACH4", "C5-CMB",
        "SUB-M", "V-IMG", "SPKMAN", "DEQ3", "*EVEN*", "*SOUL*", "*VINTAGE*", "*BUS*", "*MASTER*",
    ];

    /// The reduced list for `/fx/9..16` (Maillot 2921-2934). Every entry is also in
    /// [`FX_MODELS_SLOTS_1_TO_8`], which is why [`fx_models`] can return that list as the union.
    const FX_MODELS_SLOTS_9_TO_16: &[&str] = &[
        "NONE", "EXT", "GEQ", "PIA", "DOUBLE", "PCORR", "LIMITER", "DE-S2", "ENHANCE", "EXCITER",
        "P-BASS", "ROTARY", "PHASER", "PANNER", "TAPE", "MOOD", "SUB", "RACKAMP", "UKROCK", "ANGEL",
        "JAZZC", "DELUXE", "BODY", "SOUL", "E88", "E84", "F110", "PULSAR", "MACH4", "C5-CMB",
        "SUB-M", "V-IMG", "SPKMAN", "DEQ3", "*EVEN*", "*SOUL*", "*VINTAGE*", "*BUS*", "*MASTER*",
    ];

    /// Documented `/fx/<slot>/mdl` values (Maillot 2896-2934). Slots 1..8 and 9..16 differ: the
    /// eight premium slots load the full list, the other eight the reduced one. Anything outside
    /// `1..=16` is not an FX slot and gets the empty list, so a caller cannot validate against a
    /// list that does not exist.
    pub fn fx_models_for_slot(slot: u8) -> &'static [&'static str] {
        match slot {
            1..=8 => FX_MODELS_SLOTS_1_TO_8,
            9..=16 => FX_MODELS_SLOTS_9_TO_16,
            _ => &[],
        }
    }

    /// The union of both slot lists, in documented order: what the editor may offer for `/fx/N/mdl`.
    /// Slot 9..16's list is a subset of slot 1..8's, so the union is that list unchanged;
    /// `the_fx_model_list_depends_on_the_slot` fails if a future edit breaks the containment.
    pub fn fx_models() -> &'static [&'static str] {
        FX_MODELS_SLOTS_1_TO_8
    }

    // The gate and dynamics model lists are `plugin_models::CHANNEL_GATE_MODELS` and
    // `CHANNEL_DYN_MODELS`, which carry `2250` between `NSTR` and `L100` as Maillot documents it
    // for `/ch/1/gate/mdl` (2030) and `/ch/1/dyn/mdl` (2104) — and for aux, bus, main and matrix
    // (2293, 2450, 2622, 2792). Kept as a single source of truth: no mirror lives here.

    // ── The strip long tail's documented values (batch 5) ─────────────────────────────────────────
    //
    // The per-strip controls the catalogue never offered. Each list is one routing-table row in the
    // document's order, and the rows a mix family documents differently are stated once in
    // [`MIX_FAMILY_OVERRIDES`] instead of being duplicated here.

    /// `/flt/lcs`, the low-cut slope (1970).
    const FILTER_LOW_SLOPES: &[&str] = &["6", "12", "18", "24"];

    /// `/flt/hcs`, the high-cut slope (1973): two values, where the low cut has four.
    const FILTER_HIGH_SLOPES: &[&str] = &["6", "12"];

    /// `/flt/mdl`, the filter model (1975). Each model brings its own parameters (footnote 21), and
    /// `/flt/tilt` (1979) is the one the TILT model documents.
    const FILTER_MODELS: &[&str] = &["TILT", "MAX", "AP1", "AP2"];

    /// `/dyn/det` (2113, 2457, 2629, 2799) and `/dyn/env` (2117, 2461, 2633, 2803).
    const DYNAMICS_DETECTORS: &[&str] = &["PEAK", "RMS"];
    const DYNAMICS_ENVELOPES: &[&str] = &["LIN", "LOG"];

    /// The sidechain filter type of both sidechain nodes: `/gatesc/type` (2049) and `/dynsc/type`
    /// (2131, 2316, 2479, 2654, 2824).
    ///
    /// Row 2049 is the one place in the reference that prints the switch `Off`; the dynamics row of
    /// the same strip prints `OFF`, the four other families do too, and the console's own `/ch/1`
    /// node dump prints `gatesc.type=OFF` (958). A comparison value the console never reports can
    /// never fire — `value_problem` compares strings exactly — so the catalogue carries the spelling
    /// the console prints, and the row's `Off` is recorded here rather than offered.
    const SIDECHAIN_TYPES: &[&str] = &["OFF", "LP12", "HP12", "BP", "NOTCH"];

    /// The channel sidechain sources: `SELF` or one of the 40 channels. `/ch/1/gatesc/src` (2052) and
    /// `/ch/1/dynsc/src` (2135) document the same value space, and the list is written out because
    /// the console takes the names, not the `CH.1..CH.40` range notation (the same reason
    /// `INSERT_FX_SLOTS` lists `FX1`…`FX16`).
    ///
    /// Row 2052 prints the first entry `SHELF`, where 2135 prints `SELF`, and the console's own
    /// `/ch/1` node dump settles which one the **gate** node takes. The dump marks each node with a
    /// `.name.` prefix, and the gate sidechain's own group is the one at 958-959, not the
    /// compressor's at 962:
    ///
    /// ```text
    /// 958| …ratio='1:3',.gatesc.type=OFF,f=1k0,q=2.00,src=SEL
    /// 959| F,tap=IN,.eq.on=0,mdl=STD,mix=100,…
    /// 962| …to=1,.dynxo.depth=6.0,type=OFF,f=1k0,.dynsc.type=OFF,f=1k0,q=2.00,src=SELF,tap=IN,…
    /// ```
    ///
    /// `gatesc.src` therefore reads `SELF` as well — split across the line break — and the dynamics
    /// group prints the same value. `SHELF` names no source anywhere else in the reference, so the
    /// gate row's spelling is recorded here rather than offered: a catalogue that could not express
    /// the value the console reports would refuse the comparison that matches it, since
    /// `value_problem` compares strings exactly.
    const CHANNEL_SIDECHAIN_SOURCES: &[&str] = &[
        "SELF", "CH.1", "CH.2", "CH.3", "CH.4", "CH.5", "CH.6", "CH.7", "CH.8", "CH.9", "CH.10",
        "CH.11", "CH.12", "CH.13", "CH.14", "CH.15", "CH.16", "CH.17", "CH.18", "CH.19", "CH.20",
        "CH.21", "CH.22", "CH.23", "CH.24", "CH.25", "CH.26", "CH.27", "CH.28", "CH.29", "CH.30",
        "CH.31", "CH.32", "CH.33", "CH.34", "CH.35", "CH.36", "CH.37", "CH.38", "CH.39", "CH.40",
    ];

    /// The sources a non-channel strip's dynamics sidechain can tap (2319, 2483, 2658, 2828): its own
    /// signal, a bus 1…16, a main 1…4, a matrix 1…8 or an aux 1…8. Written out for the same reason as
    /// the channel list above.
    const MIX_SIDECHAIN_SOURCES: &[&str] = &[
        "SELF", "BUS.1", "BUS.2", "BUS.3", "BUS.4", "BUS.5", "BUS.6", "BUS.7", "BUS.8", "BUS.9",
        "BUS.10", "BUS.11", "BUS.12", "BUS.13", "BUS.14", "BUS.15", "BUS.16", "MAIN.1", "MAIN.2",
        "MAIN.3", "MAIN.4", "MTX.1", "MTX.2", "MTX.3", "MTX.4", "MTX.5", "MTX.6", "MTX.7", "MTX.8",
        "AUX.1", "AUX.2", "AUX.3", "AUX.4", "AUX.5", "AUX.6", "AUX.7", "AUX.8",
    ];

    /// The two sidechain taps, which are the rows that differ most between the channel and every
    /// other family.
    ///
    /// `/gatesc/tap` (2053) and `/ch/1/dynsc/tap` (2136) take the eight-entry channel list; an aux, a
    /// bus, a main and a matrix take the six-entry one (2322, 2486, 2661, 2831), whose `INS2` names
    /// the post insert where the channel's `POST` does.
    const CHANNEL_SIDECHAIN_TAPS: &[&str] = &["IN", "FILT", "3", "4", "5", "PFL", "AFL", "POST"];
    const MIX_SIDECHAIN_TAPS: &[&str] = &["BUS", "DYN", "PFL", "AFL", "EQ", "INS2"];

    /// `/mtx/1/dir/in`, the source of a matrix's direct input (2714-2715): the monitor feeds the
    /// matrix can take directly, in the document's order.
    const MATRIX_DIRECT_SOURCES: &[&str] = &["OFF", "AES", "MON.PH", "MON.SPK", "MON.BUS"];

    /// `/ch/1/gate/ratio` (2046): the whole value space the row prints, in its order —
    /// `1:1.5, 1:2, 1:3, 1:4, gate`. The extracted line wraps after the fourth value, which is why the
    /// list looked truncated; the desk takes all five (see the key's own comment).
    const GATE_RATIOS: &[&str] = &["1:1.5", "1:2", "1:3", "1:4", "gate"];

    /// `/proc`, the 24 process orders (2003-2008): every permutation of the gate, EQ, dynamics and
    /// insert stages, in the document's order.
    const PROCESS_ORDERS: &[&str] = &[
        "GEDI", "GEID", "GIED", "IGED", "GDEI", "GDIE", "GIDE", "IGDE", "EGDI", "EGID", "EIGD",
        "IEGD", "EDGI", "EDIG", "EIDG", "IEDG", "DEGI", "DEIG", "DIEG", "IDEG", "DGEI", "DGIE",
        "DIGE", "IDGE",
    ];

    /// The thirteen EQ band types a bus, a main and a matrix document for the low and the high band
    /// (2410/2438, 2581/2609, 2755/2779): the channel's `PEQ, SHV`, the aux's `CUT`, and the ten
    /// crossover filters.
    const EQ_CROSSOVER_TYPES: &[&str] = &[
        "PEQ", "SHV", "CUT", "BW6", "BW12", "BS12", "LR12", "BW18", "BW24", "BS24", "LR24", "BW48",
        "LR48",
    ];

    /// The three types an aux documents (2267, 2283), and the six models its EQ accepts (2257): the
    /// channel's list without `MACH4`, which no aux row prints.
    const EQ_AUX_SHELF_TYPES: &[&str] = &["PEQ", "SHV", "CUT"];
    const EQ_AUX_MODELS: &[&str] = &["STD", "SOUL", "E88", "E84", "F110", "PULSAR"];

    /// The EQ models a bus, a main and a matrix document (2400, 2571, 2738): the channel's seven with
    /// `PIA` where the channel has `MACH4`.
    const EQ_MIX_BUS_MODELS: &[&str] = &["STD", "SOUL", "E88", "E84", "F110", "PULSAR", "PIA"];

    // ── The per-family overlay ────────────────────────────────────────────────────────────────────
    //
    // The catalogue is one table per family, and a handful of these rows print a different bound or a
    // different list in each family's block of the reference. The shared row is the documented
    // default and this table states only what another family changes, so the mechanism is one place
    // and every key that needs it is one more row here — never a branch in the resolver.

    /// One row of [`MIX_FAMILY_OVERRIDES`]: the value rules a family replaces on a shared row.
    ///
    /// A field left at its sentinel — `f32::NAN` for a bound, an empty list, an empty hint — keeps
    /// the shared row's value, so a row states only the difference. The overlaid entry is what
    /// [`target_parameters_for_category`] returns, which is what the trigger list, the DTO, the
    /// validator and the editor all read: nothing downstream needs to know the overlay exists.
    #[derive(Clone, Copy)]
    struct FamilyOverride {
        category: &'static str,
        key: &'static str,
        min: f32,
        max: f32,
        options: &'static [&'static str],
        hint: &'static str,
    }

    /// A bound another family documents for a shared row.
    const fn family_range(
        category: &'static str,
        key: &'static str,
        min: f32,
        max: f32,
        hint: &'static str,
    ) -> FamilyOverride {
        FamilyOverride {
            category,
            key,
            min,
            max,
            options: &[],
            hint,
        }
    }

    /// A list another family documents for a shared row.
    const fn family_list(
        category: &'static str,
        key: &'static str,
        options: &'static [&'static str],
        hint: &'static str,
    ) -> FamilyOverride {
        FamilyOverride {
            category,
            key,
            min: f32::NAN,
            max: f32::NAN,
            options,
            hint,
        }
    }

    /// The hint shared by the rows that state the same difference (`the same list on every family
    /// that has it`), so three rows cannot drift into three spellings of one sentence.
    const EQ_MIX_FAMILY_HINT: &str = "0…100 % on a bus and a main (2404, 2575); a channel, an aux and a matrix take 0…125 (2063, 2261, 2742).";
    const EQ_CROSSOVER_HINT: &str = "The thirteen band types of a bus, a main and a matrix (2410, 2438, 2581, 2609, 2755, 2779): PEQ, SHV, CUT and the ten crossover filters.";
    const EQ_AUX_SHELF_HINT: &str =
        "PEQ, SHV or CUT (2267, 2283): the aux EQ adds CUT to the channel's two.";
    const EQ_MIX_MODEL_HINT: &str = "STD, SOUL, E88, E84, F110, PULSAR or PIA (2400, 2571, 2738): these families run PIA where a channel runs MACH4 (2059).";
    const EQ_AUX_MODEL_HINT: &str =
        "STD, SOUL, E88, E84, F110 or PULSAR (2257): an aux has no MACH4 and no PIA.";
    const MIX_SIDECHAIN_SOURCE_HINT: &str = "SELF, a bus 1…16, a main 1…4, a matrix 1…8 or an aux 1…8 (2319, 2483, 2658, 2828).";
    const MIX_SIDECHAIN_TAP_HINT: &str =
        "BUS, DYN, PFL, AFL, EQ or INS2 (2322, 2486, 2661, 2831).";

    /// Every documented per-family difference of the shared mix rows, key by key and family by
    /// family. The channel row is the shared default in each case, so no row here names `ch`.
    const MIX_FAMILY_OVERRIDES: &[FamilyOverride] = &[
        // EQ mix: a channel, an aux and a matrix take 0…125 %, a bus and a main 0…100 % (2063, 2261,
        // 2404, 2575, 2742). A bus row prints `0..100 126 steps`, which contradicts itself; the
        // bound is what the field carries and what the console clamps.
        family_range("bus", "eq_mix", 0.0, 100.0, EQ_MIX_FAMILY_HINT),
        family_range("main", "eq_mix", 0.0, 100.0, EQ_MIX_FAMILY_HINT),
        // EQ model: the three documented lists (2059, 2257, 2400, 2571, 2738).
        family_list("aux", "eq_model", EQ_AUX_MODELS, EQ_AUX_MODEL_HINT),
        family_list("bus", "eq_model", EQ_MIX_BUS_MODELS, EQ_MIX_MODEL_HINT),
        family_list("main", "eq_model", EQ_MIX_BUS_MODELS, EQ_MIX_MODEL_HINT),
        family_list("matrix", "eq_model", EQ_MIX_BUS_MODELS, EQ_MIX_MODEL_HINT),
        // The EQ low and high band types (2069/2094, 2267/2283, 2410/2438, 2581/2609, 2755/2779).
        family_list("aux", "eq_low_type", EQ_AUX_SHELF_TYPES, EQ_AUX_SHELF_HINT),
        family_list("aux", "eq_high_type", EQ_AUX_SHELF_TYPES, EQ_AUX_SHELF_HINT),
        family_list("bus", "eq_low_type", EQ_CROSSOVER_TYPES, EQ_CROSSOVER_HINT),
        family_list("bus", "eq_high_type", EQ_CROSSOVER_TYPES, EQ_CROSSOVER_HINT),
        family_list("main", "eq_low_type", EQ_CROSSOVER_TYPES, EQ_CROSSOVER_HINT),
        family_list("main", "eq_high_type", EQ_CROSSOVER_TYPES, EQ_CROSSOVER_HINT),
        family_list("matrix", "eq_low_type", EQ_CROSSOVER_TYPES, EQ_CROSSOVER_HINT),
        family_list("matrix", "eq_high_type", EQ_CROSSOVER_TYPES, EQ_CROSSOVER_HINT),
        // The dynamics sidechain: the source list and the tap list of every family that has the node
        // (2135-2136, 2319-2322, 2483-2486, 2658-2661, 2828-2831).
        family_list("aux", "dyn_sc_source", MIX_SIDECHAIN_SOURCES, MIX_SIDECHAIN_SOURCE_HINT),
        family_list("bus", "dyn_sc_source", MIX_SIDECHAIN_SOURCES, MIX_SIDECHAIN_SOURCE_HINT),
        family_list("main", "dyn_sc_source", MIX_SIDECHAIN_SOURCES, MIX_SIDECHAIN_SOURCE_HINT),
        family_list("matrix", "dyn_sc_source", MIX_SIDECHAIN_SOURCES, MIX_SIDECHAIN_SOURCE_HINT),
        family_list("aux", "dyn_sc_tap", MIX_SIDECHAIN_TAPS, MIX_SIDECHAIN_TAP_HINT),
        family_list("bus", "dyn_sc_tap", MIX_SIDECHAIN_TAPS, MIX_SIDECHAIN_TAP_HINT),
        family_list("main", "dyn_sc_tap", MIX_SIDECHAIN_TAPS, MIX_SIDECHAIN_TAP_HINT),
        family_list("matrix", "dyn_sc_tap", MIX_SIDECHAIN_TAPS, MIX_SIDECHAIN_TAP_HINT),
    ];

    /// Applies [`MIX_FAMILY_OVERRIDES`] to the rows of one family, in place.
    ///
    /// It is the only reader of the table, and [`target_parameters_for_category`] is its only caller:
    /// the trigger list, the DTO and every validator downstream read the overlaid entries because
    /// they read that function's answer, not a second table.
    fn apply_mix_family_overrides(category: &str, parameters: &mut [TargetParameterInfo]) {
        for parameter in parameters.iter_mut() {
            for overlay in MIX_FAMILY_OVERRIDES {
                if overlay.category != category || overlay.key != parameter.key {
                    continue;
                }
                if overlay.min.is_finite() {
                    parameter.min = overlay.min;
                }
                if overlay.max.is_finite() {
                    parameter.max = overlay.max;
                }
                if !overlay.options.is_empty() {
                    parameter.options = overlay.options;
                }
                if !overlay.hint.is_empty() {
                    parameter.hint = overlay.hint;
                }
            }
        }
    }

    /// The eight values `/ch/N/ptap` documents (2009), in the document's order. The row is an `S`
    /// leaf: the console takes the string itself (verified on hardware), and the numbers `3`, `4`
    /// and `5` are values of the list rather than an index into it.
    const CHANNEL_PRETAPS: &[&str] = &["IN", "FILT", "3", "4", "5", "PFL", "AFL", "POST"];

    const MIX_BASE_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        toggle("mute", "Mute", "0 = unmuted, 1 = muted (Maillot 1995)."),
        number("fader", "Fader", "db", "dB", -144.0, 10.0, "-144 = -inf, 0 = unity (1996)."),
        number("pan", "Pan", "percent", "%", -100.0, 100.0, "-100 = left, 0 = centre, 100 = right (1997)."),
        text("name", "Name", 16, "16 characters max (1986); a DCA or mute group takes 8."),
        // The strip's tags (2187, 2355, 2525, 2688, 2852): the document's own mechanism for putting
        // a strip into a DCA, which is why the hint carries it — `#D1`…`#D16` are reserved for
        // DCA 1…16 (footnote 29).
        text("tags", "Tags", 80, "Up to 80 characters (2187, 2355, 2525, 2688, 2852). `#D1`…`#D16` are reserved for the DCA assignment: tagging a strip `#D3` puts it in DCA 3 (footnote 29)."),
        // The channel's pretap: the feed the sends take (2009). A string enum, and the encoding was
        // settled on hardware (WING Rack, FW 3.1.1): every one of the eight documented values
        // is accepted verbatim, an int write is ignored and an unknown string leaves the previous
        // value in place. The reference's state dumps print it as a number (`ptap=4`, 956/5456)
        // because that is how the console's own dump renders the string, not because the write takes
        // an int — which is why this waited for the console read instead of being guessed.
        choice("ptap", "Channel Pretap", CHANNEL_PRETAPS, "The feed the sends take: IN, FILT, 3, 4, 5, PFL, AFL or POST (2009); channels only. Written as the string itself, which the console takes verbatim."),
        integer("color", "Color", "number", "", 1.0, 18.0, "1…18 (1985)."),
        integer("icon", "Icon", "number", "", 0.0, 999.0, "Icon index (1987)."),
        // `/in/set/trim` is the channel trim (-18…18) and `/in/set/$g` the head amp (-3…45.5): two
        // different leaves. They used to share one range, so the editor rejected valid trims and
        // accepted gains the console clamps.
        number("gain", "Input Gain", "db", "dB", -3.0, 45.5, "Head amp gain on the channel/aux (1943, 2215)."),
        number("trim", "Input Trim", "db", "dB", -18.0, 18.0, "Digital trim (1940, 2213)."),
        toggle("alt_source", "Alt Source", "0 = main, 1 = alternative input (1938, 2211)."),
        toggle("phantom_48v", "Phantom 48V", "0 = off, 1 = on (1945, 2216)."),
        toggle("phase", "Phase Invert", "0 = normal, 1 = inverted (1939, 2212)."),
        // The two remaining `/in/set` leaves. `bal` is documented on every mix family's input set
        // (1941, 2214, 2378, 2549, 2709) but this key is offered on channels and aux, the two strips
        // that also take an input connection; `srcauto` exists on those two alone (1937, 2210) —
        // a bus, a main and a matrix have no auto-source switch to write.
        toggle("source_auto", "Auto Source", "Input auto source switch, 0 = off, 1 = on (1937, 2210); channels and aux only."),
        number("input_balance", "Input Balance", "db", "dB", -9.0, 9.0, "Input balance, ±9 dB (1941, 2214); channels and aux only."),
        // ── Input routing (channels and aux only) ─────────────────────────────────────────────────
        // `/ch/1/in/conn/{grp,in,altgrp,altin}` (1955-1965) and the same node on an aux (2224-2233).
        // Bus, main and matrix have an `/in/set` node with no `conn` child at all (2374-2378,
        // 2545-2549, 2705-2709), so `mix_parameter_allowed` refuses the four keys there instead of
        // resolving a path the console ignores.
        //
        // The index field is one field for every group, and the groups do not share a size: the
        // console takes 1…64 at the node (1959, 2228), while the source a group names is 32 buses
        // (1796), 8 mains (1810), 16 matrices (1818), 2417 local inputs (1598), 48 AES50 (1628),
        // 56 user signals (1757) and so on. One field cannot validate the pair, so the hint says so
        // and the console clamps: the read-back reports what it really took.
        choice(
            "input_conn_group",
            "Input Source Group",
            INPUT_CONN_GROUPS,
            "The group the main input is taken from: OFF, LCL, AUX, A, B, C, SC, USB, CRD, MOD, PLAY, AES, USR, OSC, BUS, MAIN or MTX (1956-1958, 2225-2227). Channels and aux only.",
        ),
        integer(
            "input_conn_index",
            "Input Source Number",
            "number",
            "",
            1.0,
            64.0,
            "Input source number within the group, 1…64 (1959, 2228). The meaningful range depends on the group chosen — $BUS is 1…32, $MAIN 1…8 and $MTX 1…16 (1795-1823) — which one field cannot validate: the console clamps, and the read-back reports it.",
        ),
        choice(
            "input_conn_alt_group",
            "Alt Input Source Group",
            INPUT_CONN_GROUPS,
            "The group the alternative input is taken from: OFF, LCL, AUX, A, B, C, SC, USB, CRD, MOD, PLAY, AES, USR, OSC, BUS, MAIN or MTX (1961-1963, 2229-2231); the main/alt switch itself is the global `/io/altsw` (1593). Channels and aux only.",
        ),
        integer(
            "input_conn_alt_index",
            "Alt Input Source Number",
            "number",
            "",
            1.0,
            64.0,
            "Alt input source number within the group, 1…64 (1964, 2232). The meaningful range depends on the group chosen — $BUS is 1…32, $MAIN 1…8 and $MTX 1…16 (1795-1823) — which one field cannot validate: the console clamps, and the read-back reports it.",
        ),
        toggle("hpf_on", "HPF On", "0 = off, 1 = on (1968)."),
        number("hpf_freq", "HPF Frequency", "hz", "Hz", 20.0, 2000.0, "20…2000 Hz (1969)."),
        toggle("lpf_on", "LPF On", "0 = off, 1 = on (1971)."),
        number("lpf_freq", "LPF Frequency", "hz", "Hz", 50.0, 20000.0, "50…20000 Hz (1972)."),
        // ── The filter node's own switches (channels only) ────────────────────────────────────────
        // `/ch/1/flt/{lcs,hcs,tf,mdl,tilt}` (1970-1979). Aux has no filter node at all, and neither
        // has a bus, a main or a matrix, so `mix_parameter_allowed` refuses the whole `flt_*` family
        // there; `flt_tilt` is the TILT model's own leaf, which is the model `/flt/mdl` selects and
        // the one the row's footnote 21 describes.
        choice("flt_low_slope", "HPF Slope", FILTER_LOW_SLOPES, "Low cut slope in dB per octave: 6, 12, 18 or 24 (1970)."),
        choice("flt_high_slope", "LPF Slope", FILTER_HIGH_SLOPES, "High cut slope in dB per octave: 6 or 12 (1973)."),
        toggle("flt_tool", "Tool Filter", "Tool filter switch, 0 = off, 1 = on (1974)."),
        choice("flt_model", "Filter Model", FILTER_MODELS, "TILT, MAX, AP1 or AP2 (1975); each model brings its own parameters (footnote 21)."),
        number("flt_tilt", "Filter Tilt", "db", "dB", -6.0, 6.0, "Tilt level, ±6 dB (1979): the TILT filter model's own parameter."),
        // ── The PreSend EQ (channels only) ────────────────────────────────────────────────────────
        // `/ch/1/peq/*` (2013-2023): a three-band EQ in front of the sends, a node only a channel
        // has. The bands carry the same ranges as the channel EQ's (2066-2081): ±15 dB, 20…20000 Hz
        // and a Q of 0.44…10.
        toggle("peq_on", "PreSend EQ On", "PEQ switch, 0 = off, 1 = on (2014); channels only."),
        number("peq_1_gain", "PreSend EQ 1 Gain", "db", "dB", -15.0, 15.0, "±15 dB (2015)."),
        number("peq_1_freq", "PreSend EQ 1 Frequency", "hz", "Hz", 20.0, 20000.0, "20…20000 Hz (2016)."),
        number("peq_1_q", "PreSend EQ 1 Q", "number", "", 0.44, 10.0, "0.44…10 (2017)."),
        number("peq_2_gain", "PreSend EQ 2 Gain", "db", "dB", -15.0, 15.0, "±15 dB (2018)."),
        number("peq_2_freq", "PreSend EQ 2 Frequency", "hz", "Hz", 20.0, 20000.0, "20…20000 Hz (2019)."),
        number("peq_2_q", "PreSend EQ 2 Q", "number", "", 0.44, 10.0, "0.44…10 (2020)."),
        number("peq_3_gain", "PreSend EQ 3 Gain", "db", "dB", -15.0, 15.0, "±15 dB (2021)."),
        number("peq_3_freq", "PreSend EQ 3 Frequency", "hz", "Hz", 20.0, 20000.0, "20…20000 Hz (2022)."),
        number("peq_3_q", "PreSend EQ 3 Q", "number", "", 0.44, 10.0, "0.44…10 (2023)."),
        toggle("eq_on", "EQ On", "0 = off, 1 = on (2058, 2256)."),
        // The EQ model and the dry/wet mix (2059-2063, 2257-2261, 2400-2404, 2571-2575, 2738-2742).
        // Both are per-family and both go through the overlay: an aux EQ has no MACH4 to select, and
        // a bus and a main take a mix of 0…100 % where the other three families take 0…125 %.
        choice("eq_model", "EQ Model", crate::plugin_models::CHANNEL_EQ_MODELS, "The model the strip's EQ runs (2059); the list is the family's own — an aux has no MACH4 (2257) and a bus, a main and a matrix run PIA (2400, 2571, 2738)."),
        number("eq_mix", "EQ Mix", "percent", "%", 0.0, 125.0, "0…125 % on a channel, an aux and a matrix (2063, 2261, 2742); a bus and a main take 0…100 (2404, 2575)."),
        number("eq_1_gain", "EQ 1 Gain", "db", "dB", -15.0, 15.0, "±15 dB (2066-2094)."),
        number("eq_1_freq", "EQ 1 Frequency", "hz", "Hz", 20.0, 20000.0, "20…20000 Hz (2066-2094)."),
        number("eq_1_q", "EQ 1 Q", "number", "", 0.44, 10.0, "0.44…10 (2066-2094)."),
        number("eq_2_gain", "EQ 2 Gain", "db", "dB", -15.0, 15.0, "±15 dB (2066-2094)."),
        number("eq_2_freq", "EQ 2 Frequency", "hz", "Hz", 20.0, 20000.0, "20…20000 Hz (2066-2094)."),
        number("eq_2_q", "EQ 2 Q", "number", "", 0.44, 10.0, "0.44…10 (2066-2094)."),
        number("eq_3_gain", "EQ 3 Gain", "db", "dB", -15.0, 15.0, "±15 dB (2066-2094)."),
        number("eq_3_freq", "EQ 3 Frequency", "hz", "Hz", 20.0, 20000.0, "20…20000 Hz (2066-2094)."),
        number("eq_3_q", "EQ 3 Q", "number", "", 0.44, 10.0, "0.44…10 (2066-2094)."),
        number("eq_4_gain", "EQ 4 Gain", "db", "dB", -15.0, 15.0, "±15 dB (2066-2094)."),
        number("eq_4_freq", "EQ 4 Frequency", "hz", "Hz", 20.0, 20000.0, "20…20000 Hz (2066-2094)."),
        number("eq_4_q", "EQ 4 Q", "number", "", 0.44, 10.0, "0.44…10 (2066-2094)."),
        // Maillot documents the STD channel EQ as four parametric bands plus a low and a high band
        // (`/eq/l*`, `/eq/h*`). Bands 5 and 6 exist on bus/main/matrix only, never on ch/aux.
        number("eq_5_gain", "EQ 5 Gain", "db", "dB", -15.0, 15.0, "±15 dB; bus, main and matrix only (2431-2434)."),
        number("eq_5_freq", "EQ 5 Frequency", "hz", "Hz", 20.0, 20000.0, "20…20000 Hz; bus, main and matrix only."),
        number("eq_5_q", "EQ 5 Q", "number", "", 0.44, 10.0, "0.44…10; bus, main and matrix only."),
        number("eq_6_gain", "EQ 6 Gain", "db", "dB", -15.0, 15.0, "±15 dB; bus, main and matrix only (2600-2605)."),
        number("eq_6_freq", "EQ 6 Frequency", "hz", "Hz", 20.0, 20000.0, "20…20000 Hz; bus, main and matrix only."),
        number("eq_6_q", "EQ 6 Q", "number", "", 0.44, 10.0, "0.44…10; bus, main and matrix only."),
        number("eq_low_gain", "EQ Low Gain", "db", "dB", -15.0, 15.0, "±15 dB (2066-2094)."),
        number("eq_low_freq", "EQ Low Frequency", "hz", "Hz", 20.0, 2000.0, "20…2000 Hz (2066-2094)."),
        number("eq_low_q", "EQ Low Q", "number", "", 0.44, 10.0, "0.44…10 (2066-2094)."),
        choice("eq_low_type", "EQ Low Type", &["PEQ", "SHV"], "PEQ or SHV on a channel (2069); an aux adds CUT (2267) and a bus, a main and a matrix take the thirteen crossover types (2410, 2581, 2755)."),
        number("eq_high_gain", "EQ High Gain", "db", "dB", -15.0, 15.0, "±15 dB (2066-2094)."),
        number("eq_high_freq", "EQ High Frequency", "hz", "Hz", 50.0, 20000.0, "50…20000 Hz (2066-2094)."),
        number("eq_high_q", "EQ High Q", "number", "", 0.44, 10.0, "0.44…10 (2066-2094)."),
        choice("eq_high_type", "EQ High Type", &["PEQ", "SHV"], "PEQ or SHV on a channel (2094); an aux adds CUT (2283) and a bus, a main and a matrix take the thirteen crossover types (2438, 2609, 2779)."),
        // The tilt level is the one EQ leaf only a bus, a main and a matrix document (2441, 2612,
        // 2782): the channel and aux EQ nodes stop at `heq` (2094, 2283).
        number("eq_tilt", "EQ Tilt", "db", "dB", -6.0, 6.0, "Tilt level, ±6 dB; a bus, a main and a matrix only (2441, 2612, 2782)."),
        toggle("gate_on", "Gate On", "0 = off, 1 = on (2026)."),
        number("gate_thr", "Gate Threshold", "db", "dB", -80.0, 0.0, "-80…0 dB (2040)."),
        number("gate_range", "Gate Range", "db", "dB", 3.0, 60.0, "3…60 dB (2041, 2299-2313)."),
        number("gate_attack", "Gate Attack", "ms", "ms", 0.0, 120.0, "0…120 ms (2042)."),
        number("gate_hold", "Gate Hold", "ms", "ms", 0.0, 200.0, "0…200 ms (2043)."),
        number("gate_release", "Gate Release", "ms", "ms", 4.0, 4000.0, "4…4000 ms (2044)."),
        // The gate leaves whose name belongs to the *model* loaded in the gate slot, like `gate_thr`
        // above: `mix` and `gain` are documented by the models that have them (`2250`, `76LA`,
        // `LMT`…), while the `GATE` model's own table stops at `acc` and `ratio` (appendix; the
        // console's default `/ch/1` dump shows `mdl=GATE` with no `mix` and no `gain`, 958).
        // `model_leaf_for_parameter` carries all four, so the strip's model is checked before the
        // write leaves the app.
        number("gate_mix", "Gate Mix", "percent", "%", 0.0, 100.0, "Gate mix, 0…100 % (2038); the gate slot's model decides whether it has a `mix` at all (appendix)."),
        number("gate_gain", "Gate Gain", "db", "dB", -6.0, 12.0, "Gate gain, -6…12 dB (2039); like `mix`, a name only some gate models have (appendix)."),
        number("gate_accent", "Gate Accent", "number", "", 0.0, 100.0, "Gate accent, 0…100 (2045); the GATE model has `acc`, a DEQ2 does not (appendix)."),
        // The gate ratio (2046) is a *string*, and its whole value space is the five rows the document
        // prints. The extracted row wraps after `1:4` (8219-8220), so the fifth value — the word
        // `gate`, which looks like prose — sits on the line below; the console settles what the PDF
        // could not: on WING Rack (FW 3.1.1) all five are taken verbatim, `1:5`, `1:10`,
        // `1:20`, `1:100`, `GATE` and `EXP` are ignored and leave the previous value, and a whole
        // number is read as an index into the same list (1 → `1:2`, 2 → `1:3`, 4 → `gate`, so
        // 0 → `1:1.5`). Like `acc`, the name belongs to the models that document it: the appendix
        // gives `ratio` to the GATE table and to sixteen other gate models, while a DEQ2 gate has
        // `1-ratio`/`2-ratio` and no plain `ratio` at all.
        choice("gate_ratio", "Gate Ratio", GATE_RATIOS, "Gate ratio, one of the five the document lists (2046), written as a string: `1:1.5`, `1:2`, `1:3`, `1:4` or `gate`. The console also reads a whole number as an index into the same list (1 → `1:2`, 4 → `gate`); any other value leaves the previous one in place."),
        choice("gate_type", "Gate Model", crate::plugin_models::CHANNEL_GATE_MODELS, "A gate model from the appendix (2027-2037); `2250` sits between `NSTR` and `L100` (2030)."),
        number("gate_1_thr", "DEQ2 Gate 1 Threshold", "db", "dB", -60.0, 0.0, "DEQ2 in the gate slot (8290)."),
        number("gate_2_thr", "DEQ2 Gate 2 Threshold", "db", "dB", -60.0, 0.0, "DEQ2 in the gate slot (8300)."),
        number("gate_1_gain", "DEQ2 Gate 1 Gain", "db", "dB", -15.0, 15.0, "±15 dB (8296)."),
        // ── The gate sidechain (channels only) ────────────────────────────────────────────────────
        // `/ch/1/gatesc/*` (2048-2055). Aux prints gate leaves of its own (2309-2313) but no
        // `/aux/1/gatesc` node, and the console has no aux gate node either — the family gate is
        // `mix_parameter_allowed`, which keeps every `gate_*` key on a channel.
        choice("gate_sc_type", "Gate Sidechain Type", SIDECHAIN_TYPES, "OFF, LP12, HP12, BP or NOTCH (2049): the filter the sidechain listens through. Row 2049 prints the switch `Off`, the console's own `/ch/1` dump prints `OFF` (958)."),
        number("gate_sc_freq", "Gate Sidechain Frequency", "hz", "Hz", 20.0, 20000.0, "20…20000 Hz (2050)."),
        number("gate_sc_q", "Gate Sidechain Q", "number", "", 0.44, 10.0, "0.44…10 (2051)."),
        choice("gate_sc_source", "Gate Sidechain Source", CHANNEL_SIDECHAIN_SOURCES, "SELF or a channel 1…40 (2052, 2135). Row 2052 prints the first entry `SHELF`; the console's own `/ch/1` dump prints `src=SELF` inside the `.gatesc.` group (958-959), and `.dynsc.` prints the same (962)."),
        choice("gate_sc_tap", "Gate Sidechain Tap", CHANNEL_SIDECHAIN_TAPS, "IN, FILT, 3, 4, 5, PFL, AFL or POST (2053): where in the strip the sidechain signal is taken."),
        toggle("comp_on", "Compressor On", "0 = off, 1 = on (2097)."),
        number("comp_thr", "Compressor Threshold", "db", "dB", -60.0, 0.0, "-60…0 dB (2108, 2454)."),
        number("comp_ratio", "Compressor Ratio", "number", ":1", 1.1, 100.0, "1.1…100 (2455)."),
        number("comp_attack", "Compressor Attack", "ms", "ms", 0.0, 120.0, "0…120 ms (2114)."),
        number("comp_hold", "Compressor Hold", "ms", "ms", 1.0, 200.0, "1…200 ms (2115)."),
        number("comp_release", "Compressor Release", "ms", "ms", 4.0, 4000.0, "4…4000 ms (2116)."),
        integer("comp_knee", "Compressor Knee", "db", "dB", 0.0, 5.0, "0…5 dB, whole dB only (2112)."),
        number("comp_makeup", "Compressor Gain", "db", "dB", -6.0, 12.0, "Compressor gain, -6…12 dB (2107)."),
        choice("comp_type", "Compressor Model", crate::plugin_models::CHANNEL_DYN_MODELS, "A dynamics model from the appendix (2098-2105); `2250` sits between `NSTR` and `L100` (2104)."),
        // The detector, the envelope and the auto switch (2113-2118, 2457-2462, 2629-2634,
        // 2799-2810). The reference prints them for a channel, a bus, a main and a matrix; the aux
        // block stops its dynamics node at `mix` and `gain`, so these three are refused there.
        choice("dyn_detector", "Dynamics Detector", DYNAMICS_DETECTORS, "PEAK or RMS (2113, 2457, 2629, 2799); not on aux, whose dynamics block documents neither."),
        choice("dyn_envelope", "Dynamics Envelope", DYNAMICS_ENVELOPES, "LIN or LOG (2117, 2461, 2633, 2803); not on aux."),
        toggle("dyn_auto", "Dynamics Auto", "Compressor auto switch, 0 = off, 1 = on (2118, 2462, 2634, 2810); not on aux."),
        number("dyn_drv", "WARM Drive", "percent", "%", 10.0, 100.0, "WARM drive, 10…100 (8358)."),
        number("dyn_trim", "WARM Trim", "db", "dB", -18.0, 6.0, "WARM trim, -18…6 dB (8361)."),
        number("dyn_mix", "Compressor Mix", "percent", "%", 0.0, 100.0, "Dry/wet mix, 0…100 (2106, 8358-8362)."),
        number("dyn_tspd", "LMT Transient Speed", "number", "", 0.0, 1.0, "LMT transient speed, 0…1 (8590-8596)."),
        number("dyn_trans", "LMT Transients", "db", "dB", -10.0, 10.0, "LMT transients, ±10 dB."),
        number("dyn_tgain", "LMT Transient Gain", "db", "dB", -12.0, 12.0, "LMT transient gain, ±12 dB."),
        toggle("dyn_ton", "LMT Transient Shaper On", "0 = off, 1 = on."),
        number("dyn_comp", "LMT Compressor Amount", "percent", "%", 0.0, 100.0, "LMT compressor amount, 0…100."),
        number("dyn_cgain", "LMT Compressor Gain", "db", "dB", -12.0, 12.0, "LMT compressor gain, ±12 dB."),
        toggle("dyn_con", "LMT Compressor On", "0 = off, 1 = on."),
        // ── The dynamics sidechain (every mix family) ─────────────────────────────────────────────
        // `/ch/1/dynsc/*` (2130-2138) and the same node on an aux (2315-2323), a bus (2478-2487), a
        // main (2653-2662) and a matrix (2823-2832). Every family documents all five leaves; what
        // changes is the source list and the tap list, which the overlay carries.
        choice("dyn_sc_type", "Dynamics Sidechain Type", SIDECHAIN_TYPES, "OFF, LP12, HP12, BP or NOTCH (2131, 2316, 2479, 2654, 2824): the filter the sidechain listens through."),
        number("dyn_sc_freq", "Dynamics Sidechain Frequency", "hz", "Hz", 20.0, 20000.0, "20…20000 Hz (2132, 2317, 2480, 2655, 2825)."),
        number("dyn_sc_q", "Dynamics Sidechain Q", "number", "", 0.44, 10.0, "0.44…10 (2134, 2318, 2482, 2657, 2827)."),
        choice("dyn_sc_source", "Dynamics Sidechain Source", CHANNEL_SIDECHAIN_SOURCES, "SELF or a channel 1…40 on a channel (2135; the console's dump prints `src=SELF`, 962); every other family taps a bus, a main, a matrix or an aux instead (2319, 2483, 2658, 2828)."),
        choice("dyn_sc_tap", "Dynamics Sidechain Tap", CHANNEL_SIDECHAIN_TAPS, "IN, FILT, 3, 4, 5, PFL, AFL or POST on a channel (2136); a bus, a main, a matrix and an aux take BUS, DYN, PFL, AFL, EQ or INS2 (2322, 2486, 2661, 2831)."),
        // ── Inserts ───────────────────────────────────────────────────────────────────────────────
        // An insert costs about 32 samples (~0.66 ms) of processing delay on any channel, because
        // the audio is routed to a different DSP (6816-6818): worth knowing when a phase-sensitive
        // pair is aligned by ear. The slot assignment is exclusive: giving an effect to an insert
        // removes it from the strip that carried it before (6090).
        toggle("insert_on", "Pre Insert On", "0 = off, 1 = on (2147). Any insert adds ~32 samples (0.66 ms) of processing delay (6816)."),
        choice("pre_insert_slot", "Pre Insert FX Slot", INSERT_FX_SLOTS, "NONE or FX1…FX16 (2148, 2327, 2491, 2666, 2836); assigning a slot takes that effect away from the strip it was inserted in (6090) and adds ~32 samples (0.66 ms) of processing delay (6816)."),
        toggle("post_insert_on", "Post Insert On", "0 = off, 1 = on (2181). Any insert adds ~32 samples (0.66 ms) of processing delay (6816)."),
        choice("post_insert_slot", "Post Insert FX Slot", INSERT_FX_SLOTS, "NONE or FX1…FX16 (2183, 2514, 2677, 2841); the same ~32 samples (0.66 ms) insert delay applies (6816)."),
        choice("post_insert_mode", "Post Insert Mode", &["FX", "AUTO_X", "AUTO_Y"], "FX, AUTO_X or AUTO_Y (2182)."),
        number("post_insert_weight", "Post Insert Autogain Weight", "number", "", -12.0, 12.0, "Autogain weight, -12…12 (2184)."),
        // ── Sends ─────────────────────────────────────────────────────────────────────────────────
        // The destination index comes from `send_id` and its bound from `send_destination`: buses
        // 1…16, matrices 1…8, mains 1…4 (2168, 2670, 2153). A family only offers the sends Maillot
        // documents for it — a matrix has no send node at all and a main has no `/send/<n>` (see
        // `mix_parameter_allowed`).
        number("send_level", "Send Level", "db", "dB", -144.0, 10.0, "Bus send 1…16, -144…10 dB (2159-2161, 2337-2339, 2501-2503)."),
        toggle("send_on", "Send On", "0 = off, 1 = on (2160, 2338, 2502)."),
        toggle("send_pre_always_on", "Send Pre Always On", "Pre always on: the send ignores the channel mute (2162, 2340)."),
        number("send_pan", "Send Pan", "percent", "%", -100.0, 100.0, "Send pan, -100…100 (2166, 2343)."),
        choice("send_mode", "Send Tap", &["PRE", "POST", "GRP"], "Send tap point: PRE, POST or GRP (2163, 2341)."),
        toggle("send_pre", "Send Pre Fader", "Pre/post fader switch of a bus-to-bus send (2504)."),
        number("send_matrix_level", "Matrix Send Level", "db", "dB", -144.0, 10.0, "Matrix send 1…8, -144…10 dB (2170, 2347, 2508, 2672)."),
        toggle("send_matrix_on", "Matrix Send On", "0 = off, 1 = on (2169, 2346, 2507, 2671)."),
        choice("send_matrix_mode", "Matrix Send Tap", &["PRE", "POST", "GRP"], "Matrix send tap point: PRE, POST or GRP (2173, 2350)."),
        toggle("send_matrix_pre", "Matrix Send Pre Fader", "Pre/post fader switch (2509, 2673)."),
        number("send_main_level", "Main Send Level", "db", "dB", -144.0, 10.0, "Main send 1…4, -144…10 dB (2155, 2333, 2497)."),
        toggle("send_main_on", "Main Send On", "0 = off, 1 = on (2154, 2332, 2496)."),
        toggle("send_main_pre", "Main Send Pre Fader", "Pre/post fader switch (2156, 2334, 2498)."),
        // ── Strip basics ──────────────────────────────────────────────────────────────────────────
        // `width` is `/wid` on every mix family (1998, 2249, 2393, 2564, 2731); `/ch/1/tapwid`
        // (2178) is a different leaf and is not offered here.
        number("width", "Width", "percent", "%", -150.0, 150.0, "Width in percent, -150…150 (1998, 2249, 2393, 2564, 2731)."),
        // Every mix family has `/mon` (2002, 2253, 2396, 2567, 2734) and so does a DCA (2876).
        choice("monitor_mode", "Monitor Mode", MONITOR_MODES, "Monitor mode A, B or A+B (2002, 2253, 2396, 2567, 2734, 2876)."),
        // The mono switch (2389, 2560, 2727) and the process order (2003-2008), the two remaining
        // strip-wide leaves: `busmono` is documented on a bus, a main and a matrix and on no other
        // family, `proc` on channels alone.
        toggle("bus_mono", "Bus Mono", "Mono switch, 0 = off, 1 = on (2389, 2560, 2727); a bus, a main and a matrix only."),
        // The matrix direct input (2711-2715): `/mtx/1/dir/{on,lvl,inv,in}`, a node no other family
        // has — a matrix can take a monitor feed directly, and `mix_parameter_allowed` keeps the
        // four keys on the matrix alone.
        toggle("dir_on", "Direct In On", "Direct in on switch, 0 = off, 1 = on (2711); matrix only. The console reports it, so it can be watched as well."),
        number("dir_level", "Direct In Level", "db", "dB", -144.0, 10.0, "Direct in level, -144 (=-inf)…10 dB (2712); matrix only."),
        toggle("dir_invert", "Direct In Invert", "Direct in invert, 0 = normal, 1 = inverted (2713); matrix only."),
        choice("dir_source", "Direct In Source", MATRIX_DIRECT_SOURCES, "OFF, AES, MON.PH, MON.SPK or MON.BUS (2714-2715): the feed the direct input takes; matrix only."),
        choice("proc_order", "Process Order", PROCESS_ORDERS, "The order of the gate (G), EQ (E), dynamics (D) and insert (I) stages — all 24 permutations, in the document's order (2003-2008); channels only."),
        // The solo switch (1999, 2250, 2394, 2565, 2732) on every mix family, and on a DCA (2874).
        // The console publishes it, so a step can set it *and* a macro can watch it: "when channel 3
        // is soloed" is an ordinary state trigger. `/sololed` (2000, 2251, …) is the read-only LED
        // and is deliberately not a key.
        toggle("solo", "Solo", "0 = not soloed, 1 = soloed (1999, 2250, 2394, 2565, 2732); the console also reports it, so it can be watched."),
        // `/solosafe` is documented for channels and aux only (2001, 2252): there is no
        // `/bus/1/solosafe`, `/main/1/solosafe`, `/mtx/1/solosafe` or `/dca/1/solosafe` row in the
        // reference, so the parameter fails closed on those families instead of writing nowhere.
        toggle("solo_safe", "Solo Safe", "Solo safe, 0 = off, 1 = on; channels and aux only (2001, 2252)."),
        // The delay leaves differ by family: `/in/set/dly*` on ch/aux (1947-1953, 2217-2222) and
        // `/dly/*` on bus, main and matrix (2517-2523, 2680-2686, 2844-2850).
        toggle("delay_on", "Input Delay On", "0 = off, 1 = on (1953, 2222, 2518, 2681, 2845)."),
        choice("delay_mode", "Delay Mode", &["M", "FT", "MS", "SMP"], "Meters, feet, milliseconds, samples (1947, 2217, 2519, 2682, 2846)."),
        // One f32 range cannot express the four documented units (0…150 m, 0.5…500 ft, 0.5…500 ms,
        // 16…500 samples), so the field carries the widest documented value and the hint names each
        // unit's own limit: refusing 500 ms would make the commonest delay unusable.
        number("delay_time", "Delay Time", "number", "", 0.0, 500.0, "Delay in the unit set by Delay Mode: 0…150 m, 0.5…500 ft, 0.5…500 ms or 16…500 samples (1948-1952, 2218-2221, 2520-2523, 2683-2686, 2847-2850); the console clamps a value above its unit's limit."),
    ];

    const SOURCE_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        // The input mode of the physical source node itself — `/io/in/<group>/<n>/mode` — which every
        // input group documents (1599, 1618, 1629, 1652, 1671, 1690, 1702, 1713, 1724, 1735, 1747,
        // 1760, 1781). It is **not** the channel's own `/in/set/$mode`, which is read-only (1936):
        // this is the row a macro can set, which is why the key exists at all.
        //
        // The oscillator's row is the exception: Maillot prints it `[RO]` (1781), so the console does
        // not take a write there and `source_parameter_allowed` keeps the key off that one category.
        // Writing a leaf the console ignores in silence is the defect this catalogue exists to
        // prevent, and "the read-back will show it" is not a substitute for not building it. The
        // twelve categories the key reaches are the ones whose row carries no `[RO]`.
        choice(
            "source_mode",
            "Source Mode",
            SOURCE_MODES,
            "Input mode of the source node: M (mono), ST (stereo) or M/S (mid/side) (1599, 1618, 1629, 1652, 1671, 1690, 1702, 1713, 1724, 1735, 1747, 1760). This is the source's own row, not the channel's read-only `/in/set/$mode` (1936). The oscillator's row (1781) is `[RO]`, so it is not offered here.",
        ),
        number("gain", "Source Gain", "db", "dB", -3.0, 45.5, "Head amp gain, -3…45.5 dB (1600, 1630)."),
        toggle("phantom_48v", "Phantom 48V", "0 = off, 1 = on (1601)."),
        toggle("mute", "Source Mute", "0 = unmuted, 1 = muted (1602)."),
        toggle("phase", "Polarity", "0 = normal, 1 = inverted (1603)."),
        text("name", "Name", 16, "16 characters max (1677)."),
        integer("color", "Color", "number", "", 1.0, 18.0, "1…18 (1604)."),
        integer("icon", "Icon", "number", "", 0.0, 999.0, "Icon index (1606)."),
        // The oscillator's own source sub-node (1789-1793): only `/io/in/OSC` has the extra `osc`
        // segment, which the parameter string carries, so the resolver needs no new shape. The three
        // leaves are offered on the oscillator alone (`source_parameter_allowed`): the other twelve
        // physical inputs share this table but have no `osc` node.
        number("osc_level", "Oscillator Level", "number", "", -40.0, 6.0, "Oscillator source level, -40…6 in 69 steps (1790). Maillot prints no unit for it."),
        choice("osc_mode", "Oscillator Waveform", OSCILLATOR_MODES, "Oscillator waveform: SINE, PINK or WHITE (1792)."),
        number("osc_freq", "Oscillator Frequency", "hz", "Hz", 20.0, 20000.0, "Oscillator frequency, 20…20000 Hz in 2323 steps (1793)."),
    ];

    const OUTPUT_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        choice("output_group", "Output Source Group", OUTPUT_SOURCE_GROUPS, "The source feeding the output (1844-1846)."),
        integer("output_source", "Output Source Index", "number", "", 1.0, 64.0, "1…64 (1847)."),
    ];

    const DCA_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        toggle("mute", "DCA Mute", "0 = unmuted, 1 = muted (2872)."),
        number("fader", "Fader", "db", "dB", -144.0, 10.0, "-144 = -inf, 0 = unity (2873)."),
        text("name", "Name", 8, "8 characters max (2868)."),
        integer("color", "Color", "number", "", 1.0, 18.0, "1…18 (2869)."),
        integer("icon", "Icon", "number", "", 0.0, 999.0, "Icon index (2870)."),
        // A DCA has `/dca/1/mon` like every mix strip (2876) and its own solo switch (2874), but no
        // `/dca/1/wid` and no `/dca/1/solosafe`, so only the monitor mode and the solo are offered
        // here (plus the mute, fader, name, colour and icon above).
        choice("monitor_mode", "Monitor Mode", MONITOR_MODES, "Monitor mode A, B or A+B (2876)."),
        toggle("solo", "Solo", "0 = not soloed, 1 = soloed (2874); the console also reports it, so it can be watched."),
    ];

    const MUTEGROUP_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        toggle("mute", "Mute Group", "0 = unmuted, 1 = muted (2886)."),
        text("name", "Mute Group Name", 8, "8 characters max (2885)."),
    ];

    const FX_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        number("fx_mix", "FX Mix", "percent", "%", 0.0, 100.0, "0…100 (2935)."),
        // A closed list, not free text: the console only takes the model names printed in the
        // `/fx/N/mdl` row (2896-2934), and a name taken from the appendix instead (`DELREV`,
        // `V_IMG`, `R-OOM`…) is a silent no-op. `fx_models()` is the union of both slot lists and
        // is what the editor offers; `fx_models_for_slot` decides what the slot being written can
        // actually load.
        choice("fx_model", "FX Model", FX_MODELS_SLOTS_1_TO_8, "An FX model from the `/fx/<slot>/mdl` list (2896-2934); slots 9…16 load fewer models than slots 1…8."),
    ];

    // Maillot 3956-3957: `/$ctl/user/1/1/bu` is a **node**, not a writable parameter; the leaf is
    // `/$ctl/user/1/1/bu/mode`, a string from the list OFF, MUTE, SOLO, …, MARKERB. Writing an
    // integer to the node was a silent no-op that the macro counted as "completed".
    const USERCTRL_TARGET_PARAMETERS: &[TargetParameterInfo] = &[choice(
        "user_btn",
        "User Button (mode)",
        USER_BUTTON_MODES,
        "One of the appendix modes (3957-3968); page 1, buttons 1…4 (3933, 3942).",
    )];

    // Listed so the editor can show them, but deliberately unsupported: snapshot
    // and preset loading is a console filesystem operation over the snapshot JSON
    // (`global/snapshots`, `global/ch_presets`, `global/fx_presets`,
    // `global/routing_presets`), not an OSC leaf. `/show/load` and `/library/load`
    // are silent on the console (verified read-only on WING Rack,
    // FW 3.1.1), so they fail closed in `resolve_basic_addresses` instead of
    // producing a write the console would ignore.
    const CUSTOM_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        dead_parameter(
            "load_snapshot",
            "Load Snapshot",
            "Not an OSC leaf: a snapshot is loaded by the console from its own files, and `/show/load` is silent. Listed so the editor can say so instead of writing nowhere.",
        ),
        dead_parameter(
            "load_preset",
            "Load Preset",
            "Not an OSC leaf: presets are console files, and `/library/load` is silent. Listed so the editor can say so instead of writing nowhere.",
        ),
    ];

    // ── Show control (Maillot 4105-4126, `/$ctl/lib`) ─────────────────────────────────────────────
    //
    // Two categories over one node: the two keys below are the ones a step writes and the console
    // does not report (`write_only`), the five after them are the ones the console reports and a
    // step must not write. The split is the category's `can_target`/`can_trigger`, and the leaf
    // table in `show_leaf` follows the same split, so the two halves cannot drift.
    //
    // The hints carry the documented caveats verbatim: every one of these leaves only answers with
    // a show open (footnotes 77-79), `$actionidx` has to be 0 for NEXT/PREV + GO to behave (footnote
    // 79), GO loads the scene the number points at while GOTAG reads it as a tag, and `$scenes`
    // returns only the first name over plain OSC (footnote 77).

    /// The show-control actions (Maillot 4114), in the document's order.
    const SHOW_ACTIONS: &[&str] = &["IDLE", "GOPREV", "GONEXT", "GO", "PREV", "NEXT", "GOTAG"];

    const SHOW_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        write_only(integer(
            "scene_index",
            "Scene Number",
            "number",
            "",
            0.0,
            16384.0,
            "Scene number user selection, 0…16384 (4116). A show must be open. Set the number, then send GO to load the scene $actionidx points to. $actionidx should be 0 to enable NEXT or PREV to work as expected with a GO command (footnote 79).",
        )),
        write_only(choice(
            "scene_action",
            "Scene Action",
            SHOW_ACTIONS,
            "Show control action: IDLE, GOPREV, GONEXT, GO, PREV, NEXT or GOTAG (4114), after a show has been opened. GO loads the scene $actionidx points to; GOTAG treats $actionidx as the tag number of a tagged scene (footnote 79).",
        )),
    ];

    const SHOW_STATE_PARAMETERS: &[TargetParameterInfo] = &[
        integer(
            "scene_active_index",
            "Active Scene Number",
            "number",
            "",
            0.0,
            16384.0,
            "Scene number currently loaded/active, 0…16384 (4107, footnote 78). A show must be open.",
        ),
        text(
            "scene_active_name",
            "Active Scene",
            256,
            "Name of the active scene, 256 characters maximum, for example I:SHOW2/scene_1.snap (4109). A show must be open.",
        ),
        integer(
            "scene_active_tag",
            "Active Scene Tag",
            "number",
            "",
            0.0,
            128.0,
            "Tag of the active scene if present, 0…128 (4126). A show must be open.",
        ),
        text(
            "scene_show_name",
            "Active Show",
            256,
            "Name of the active show, 256 characters maximum, after the OPEN SHOW icon has been pressed, for example I:SHOW2 (4111).",
        ),
        text(
            "scene_list",
            "Scene List",
            256,
            "List of scene names in the currently opened show (4105); over plain OSC only the first name is returned (footnote 77).",
        ),
    ];

    // ── Talkback (Maillot 1460-1534, `/cfg/talk/<A|B>`) ───────────────────────────────────────────
    //
    // One node with two entries, A (id 1) and B (id 2), whose id segment is the letter. Every leaf
    // below is reported by the console as well as written, so the whole category is both a target
    // and a trigger, and the two dims are the only numeric ones.

    /// The three talkback modes (Maillot 1462, 1500), in the document's order.
    const TALK_MODES: &[&str] = &["AUTO", "PUSH", "LATCH"];

    const TALK_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        toggle(
            "talk_on",
            "Talkback On",
            "0 = off, 1 = on; entry 1 is talkback A and entry 2 is talkback B (1461, 1499).",
        ),
        choice(
            "talk_mode",
            "Talkback Mode",
            TALK_MODES,
            "AUTO, PUSH or LATCH (1462, 1500).",
        ),
        // Both dims are an amount of attenuation the document prints as `40..0` in 41 steps
        // (1463-1464, 1501-1502), so the range below is 0…40 and 40 is the most attenuation.
        //
        // The four rows disagree on the write type: `/cfg/talk/A/mondim` is `I` while
        // `/cfg/talk/B/mondim` and both `busdim` rows are `F`. One catalogue key serves both ids, so
        // the leaf is written as the float three of the four rows document (a float is also what the
        // console takes for the integer-valued 41-step range). Maillot prints no unit for either
        // dim, so `unit` stays empty and the hint says "attenuation" rather than inventing dB.
        number(
            "talk_monitor_dim",
            "Talkback Monitor Dim",
            "number",
            "",
            0.0,
            40.0,
            "Monitor dim, documented 40…0 in 41 steps (1463, 1501): 40 is the most attenuation, 0 none.",
        ),
        number(
            "talk_bus_dim",
            "Talkback Bus Dim",
            "number",
            "",
            0.0,
            40.0,
            "Bus dim, documented 40…0 in 41 steps (1464, 1502): 40 is the most attenuation, 0 none.",
        ),
        toggle(
            "talk_individual",
            "Talkback Individual Levels",
            "Use individual Bus/Main TB send levels, 0 = off, 1 = on (1465-1466, 1503-1504).",
        ),
        // The three assigns: one toggle per destination, addressed by the destination index the send
        // parameters already carry (`send_destination`), so the editor's destination control, its
        // bound and the backend's check work on them unchanged.
        toggle(
            "talk_bus_assign",
            "Talkback Bus Assign",
            "Talkback bus assignment, 1…16 (1469-1484, 1507-1522); the destination index is the one the bus sends use.",
        ),
        toggle(
            "talk_matrix_assign",
            "Talkback Matrix Assign",
            "Talkback matrix assignment, 1…8 (1485-1492, 1523-1530); the destination index is the one the matrix sends use.",
        ),
        toggle(
            "talk_main_assign",
            "Talkback Main Assign",
            "Talkback main assignment, 1…4 (1493-1496, 1531-1534); the destination index is the one the main sends use.",
        ),
    ];

    // ── GPIO (Maillot 4009-4014, `/$ctl/gpio`) ────────────────────────────────────────────────────
    //
    // Two categories over one node, and the split *is* the rule: `mode` and `gpstate` are written
    // and reported, `$state` is read-only (`[RO]` at 4013). The category flags are the primary
    // mechanism, exactly as they are for show/showstate; the leaf tables in `gpio_leaf_for_category`
    // follow the same split, so a hand-edited show file cannot cross it either.

    /// The six GPIO modes (Maillot 4011 and the appendix at 11518-11527), in the document's order.
    const GPIO_MODES: &[&str] = &["TGLNO", "TGLNC", "INNO", "INNC", "OUTNO", "OUTNC"];

    const GPIO_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        choice(
            "gpio_mode",
            "GPIO Mode",
            GPIO_MODES,
            "TGLNO, TGLNC, INNO, INNC, OUTNO or OUTNC (4011): TGL toggles the internal state, IN reads an external contact and OUT drives one; NO/NC is normally open or normally closed. GPIO 1…4 (4010); a Compact console has two (footnote 122).",
        ),
        toggle(
            "gpio_state",
            "GPIO State",
            "The state the console drives, 0 = open/OFF, 1 = closed/ON (4014). GPIO 1…4 (4010); a Compact console has two (footnote 122).",
        ),
    ];

    const GPIO_STATE_PARAMETERS: &[TargetParameterInfo] = &[toggle(
        "gpio_input_state",
        "GPIO Input State",
        "The GPIO input state the console reports, 0 = open/OFF, 1 = closed/ON (4013, [RO]). Read-only: it can be watched, never written. GPIO 1…4 (4010); a Compact console has two (footnote 122).",
    )];

    // ── The I/O node (Maillot 1592-1594, `/io`) ───────────────────────────────────────────────────
    //
    // The two desk-wide switches of the input section, on the catalogue's third index-less category.
    // Unlike `show`/`gpio`, this is not a read/write split: the console takes both keys and also
    // reports them (they are ordinary state), so the same list is the target list and the watch
    // list — and the hint says which way round 0 and 1 are, because "Main/Alt switch" alone does not.

    const IO_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        toggle(
            "io_altsw",
            "Main/Alt Switch",
            "The desk-wide main/alt input switch, 0 = main, 1 = alternative (1593).",
        ),
        toggle(
            "io_auto_alt_override",
            "Auto Input Override",
            "The global input select override, 0 = off, 1 = on (1594).",
        ),
    ];

    // ── Batch 4: the USB transport, the fader layers and the console status ───────────────────────
    //
    // Frozen from Maillot 3.1.0, line by line:
    //   * `/rec/*` (3068-3075): the four writable leaves of the USB recorder, and the two the console
    //     only reports;
    //   * `/play/*` (3045-3066): the three writable leaves of the USB player (a playlist must be
    //     active and open, footnote 51), and the two it reports;
    //   * `/$ctl/layer/<letter>/sel` (3220, 3299, 3381, 3456, 3523, 3585, 3645): one leaf under every
    //     surface's own node, carrying the layer number with a per-surface settable range;
    //   * `/$ctl/$stat/{selidx,pageidx}` (3096-3097): the two read-only console-status triggers.
    //
    // The write/watch split is the category's `can_target`/`can_trigger`, and the leaf table in
    // `usb_transport_leaf_for_category` follows it, so neither half can be reached through the
    // other's category — exactly the shape `show`/`showstate` established.

    /// The recorder's four actions (Maillot 3071), in the document's order.
    const RECORDER_ACTIONS: &[&str] = &["STOP", "REC", "PAUSE", "NEWFILE"];

    /// The recorder's two bit depths (3073). The row is a string leaf, so the values are the strings
    /// the console documents, not numbers.
    const RECORDER_RESOLUTIONS: &[&str] = &["16", "24"];

    /// The recorder's two channel counts (3074). Not the player's `$channels` row (3063), which is
    /// read-only and lists 1, 2, 3 and 4: two different leaves that happen to share a name.
    const RECORDER_CHANNELS: &[&str] = &["2", "4"];

    /// The four states the USB recorder reports on `$actstate` (3069).
    const RECORDER_STATES: &[&str] = &["STOP", "REC", "PAUSE", "ERROR"];

    /// The seven USB player actions (3053), in the document's order.
    const PLAYER_ACTIONS: &[&str] = &["IDLE", "STOP", "PLAY", "PAUSE", "NEXT", "PREV", "PLAYFILE"];

    /// The four states the USB player reports on `$actstate` (3055). `REC` is the recorder's, not the
    /// player's: the two nodes print different lists and the catalogue keeps them apart.
    const PLAYER_STATES: &[&str] = &["STOP", "PLAY", "PAUSE", "ERROR"];

    /// The seven fader layers of the WING family, in the order the document prints the nodes (3219,
    /// 3298, 3380, 3455, 3522, 3584, 3644): id 1 is the left surface, id 7 the virtual one. The
    /// letters are the path segment itself (`/$ctl/layer/CMPCT/sel`), which is why
    /// [`id_letter_for_category`] answers a string and not a character.
    const FADER_LAYER_LETTERS: &[&str] = &["L", "C", "R", "CMPCT", "RCK", "EXT", "VRT"];

    const LAYER_TARGET_PARAMETERS: &[TargetParameterInfo] = &[integer(
        "layer_select",
        "Fader Layer",
        "number",
        "",
        1.0,
        22.0,
        "Fader layer selection, 1…22 (3220, 3299, 3381, 3456, 3523, 3585, 3645). Only 1…7 can be set, and only 1…6 on the Center surface (3299); 8 and 9 are no-ops on L and R (3220, 3381), 7…9 on C, and the rest are the fixed pre-assigned layers — several of them are [TBV] in this document copy. The id selects the surface: 1 = L, 2 = C, 3 = R, 4 = CMPCT, 5 = RCK, 6 = EXT, 7 = VRT.",
    )];

    const REC_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        write_only(choice(
            "rec_action",
            "Recorder Action",
            RECORDER_ACTIONS,
            "USB recorder action: STOP, REC, PAUSE or NEWFILE (3071). The console reports what the recorder is doing on `/rec/$actstate` (3069) — this leaf is written, never read back.",
        )),
        write_only(text(
            "rec_path",
            "Recorder Destination",
            0,
            "USB recorder filename path (3072), an OSC string. Maillot documents no length limit for it, so the field accepts the path the operator types; the active filename the console reports is `/rec/$actfile` (3070), which this catalogue does not offer.",
        )),
        write_only(choice(
            "rec_resolution",
            "Recorder Bit Depth",
            RECORDER_RESOLUTIONS,
            "USB recorder bit depth: 16 or 24 (3073), written as the string the console documents.",
        )),
        write_only(choice(
            "rec_channels",
            "Recorder Tracks",
            RECORDER_CHANNELS,
            "USB recorder channel count: 2 or 4 (3074). The USB player's `$channels` row is a different, read-only leaf listing 1, 2, 3 and 4 (3063).",
        )),
    ];

    const REC_STATE_PARAMETERS: &[TargetParameterInfo] = &[
        choice(
            "rec_state",
            "Recorder State",
            RECORDER_STATES,
            "USB recorder active state the console reports: STOP, REC, PAUSE or ERROR (3069). Read-only: a trigger or an IF gate, never a step.",
        ),
        number(
            "rec_time",
            "Recorder Time",
            "number",
            "",
            0.0,
            1_000_000_000.0,
            "USB recorder time the console reports (3075). Maillot types the leaf `F` and documents neither a unit nor a range, so the bound here is deliberately wide (a billion) to refuse nothing plausible, and the read-back is the authority on what the number means.",
        ),
    ];

    const PLAY_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        write_only(choice(
            "play_action",
            "Player Action",
            PLAYER_ACTIONS,
            "USB player action: IDLE, STOP, PLAY, PAUSE, NEXT, PREV or PLAYFILE (3053). These commands are valid only when a playlist is active and open (footnote 51); PLAYFILE plays the path Player File carries.",
        )),
        write_only(text(
            "play_file",
            "Player File",
            256,
            "Full path to a song to play with the PLAYFILE action (3051), 256 characters maximum. The active file the console reports is `/play/$actfile` (3057), which this catalogue does not offer.",
        )),
        write_only(toggle(
            "play_repeat",
            "Player Repeat",
            "USB player repeat, 0 = no repeat, 1 = repeat (3066).",
        )),
    ];

    const PLAY_STATE_PARAMETERS: &[TargetParameterInfo] = &[
        choice(
            "play_state",
            "Player State",
            PLAYER_STATES,
            "USB player active state the console reports: STOP, PLAY, PAUSE or ERROR (3055). Read-only: a trigger or an IF gate, never a step. Only meaningful while a playlist is active and open (footnote 51).",
        ),
        number(
            "play_position",
            "Player Position",
            "number",
            "",
            0.0,
            35999.0,
            "USB player position the console reports, 0…35999 in 36000 steps (3060). Maillot gives no unit for it, so the read-back is the authority on what one step is. Only meaningful while a playlist is active and open (footnote 51).",
        ),
    ];

    const STAT_STATE_PARAMETERS: &[TargetParameterInfo] = &[
        integer(
            "selected_strip",
            "Selected Strip",
            "number",
            "",
            1.0,
            76.0,
            "Channel strip currently selected on the console, 1…76 (3096). Read-only: the trigger \"the operator selected strip n\". The console's get reports 0…75 while 1…76 is the indexing used when setting (footnote 54), so a comparison has to allow for the offset.",
        ),
        integer(
            "selected_page",
            "Selected Page",
            "number",
            "",
            0.0,
            30.0,
            "Channel page currently displayed, 0…30 (3097). Read-only: a trigger or an IF gate, never a step.",
        ),
    ];

    // ── Batch 6: the desk level (Maillot 3128-3145, 4016-4067, 1314-1394, 1249-1301, 2950-3024,
    //    4168-4186) ───────────────────────────────────────────────────────────────────────────────
    //
    // Nine blocks the sweep ranked last but a show still touches: the desk's own lights, the safes,
    // the two monitor buses, the solo configuration, the AES50 links, the desk status, the W-Live
    // multitrack card, the identity of the card in the slot, and the clock. Frozen line by line, and
    // the shapes worth naming are the ones the category flags cannot express by themselves:
    //
    //   * a node that carries read-only *and* writable leaves. The category stays one, because the
    //     document prints one node and the editor's picker is per node; the split lives in the two
    //     parameter lists — `*_TARGET_PARAMETERS` is what a step may write, and
    //     `desk_level_read_only_parameters` is the `[RO]` half a watch may read. The leaf table
    //     resolves both halves, because a watch is a comparison against a real address exactly as a
    //     step is a write to one;
    //   * two nodes the console only reports (`deskstatus`, `cards`): their `can_target` is false, so
    //     `target_parameters_for_category` answers nothing for them whatever the leaf table holds.
    //
    // A hint that does not fit in one line carries the document's own caveat — footnote 13 for the
    // monitor level, the "must be followed by gotomarker 101" rule for the W-Live time, the
    // `+`/space alphabet of a safes mask — because the operator reads the hint and nothing else.

    /// The eleven rows of the desk-light node (Maillot 3128-3145), in the document's order.
    ///
    /// The block prints six rows before a page break (3128-3134: `btns`, `leds`, `meters`,
    /// `rgbleds`, `chlcds` and `chlcdctr`) and the other five at 3141-3145 after footnotes 53-54;
    /// `chedit`, "Channel strip intensity", opens that continuation. Four rows document a minimum of
    /// 5 (`leds`, `chlcds`, `chedit` and `main`): those surfaces have no off position, so a step to 0
    /// would be clamped by the console in silence. The catalogue therefore carries the documented
    /// minimum per row, not a shared 0.
    const LIGHTS_LEAVES: &[(&str, &str)] = &[
        ("lights_btns", "/btns"),
        ("lights_leds", "/leds"),
        ("lights_meters", "/meters"),
        ("lights_rgbleds", "/rgbleds"),
        ("lights_chlcds", "/chlcds"),
        ("lights_chlcdctr", "/chlcdctr"),
        ("lights_chedit", "/chedit"),
        ("lights_main", "/main"),
        ("lights_glow", "/glow"),
        ("lights_patch", "/patch"),
        ("lights_lamp", "/lamp"),
    ];

    const LIGHTS_PARAMETERS: &[TargetParameterInfo] = &[
        integer(
            "lights_btns",
            "Button Backlight",
            "number",
            "",
            0.0,
            100.0,
            "Buttons backlight intensity, 0…100 (3128).",
        ),
        integer(
            "lights_leds",
            "Button/LED Light",
            "number",
            "",
            5.0,
            100.0,
            "Buttons/LED light intensity, 5…100 (3129): 5 is the documented minimum because the surface has no off position.",
        ),
        integer(
            "lights_meters",
            "Meters Light",
            "number",
            "",
            0.0,
            100.0,
            "Meters intensity, 0…100 (3130).",
        ),
        integer(
            "lights_rgbleds",
            "Colour LED Light",
            "number",
            "",
            0.0,
            100.0,
            "Colour LED intensity, the scribble lights, 0…100 (3131).",
        ),
        integer(
            "lights_chlcds",
            "Channel LCD Light",
            "number",
            "",
            5.0,
            100.0,
            "Channel LCD intensity, the scribble backlight, 5…100 (3132): no off position, hence the minimum of 5.",
        ),
        integer(
            "lights_chlcdctr",
            "Channel LCD Contrast",
            "number",
            "",
            0.0,
            100.0,
            "Channel LCD contrast, the scribble contrast, 0…100 (3134).",
        ),
        integer(
            "lights_chedit",
            "Channel Strip Light",
            "number",
            "",
            5.0,
            100.0,
            "Channel strip intensity, 5…100 (3141). The row opens the block's continuation page (the six rows before the page break are 3128-3134), which is why the node reads as ten rows at first glance.",
        ),
        integer(
            "lights_main",
            "Touchscreen Light",
            "number",
            "",
            5.0,
            100.0,
            "Touchscreen intensity, 5…100 (3142): no off position, hence the minimum of 5.",
        ),
        integer(
            "lights_glow",
            "Under-Console Light",
            "number",
            "",
            0.0,
            100.0,
            "Under console light intensity, 0…100 (3143).",
        ),
        integer(
            "lights_patch",
            "Patch Panel Light",
            "number",
            "",
            0.0,
            100.0,
            "Patch panel light intensity, 0…100 (3144).",
        ),
        integer(
            "lights_lamp",
            "Lamp Light",
            "number",
            "",
            0.0,
            100.0,
            "Lamp light intensity, 0…100 (3145).",
        ),
    ];

    /// The safes node (Maillot 4016-4067), one string per scope, in the document's order.
    ///
    /// Every leaf is a mask of `+` and space, one character per item, and the document gives each
    /// scope its own documented length — that length is `max_len` below and the reason a safes key
    /// is typed as text rather than as a list. None of the rows carries `[RO]`, so every one of them
    /// is written and reported and the two lists hold the same keys. (`/$ctl/safes/area/{RIGHT,
    /// EXTERN,VIRTUAL}` are here too: the extraction prints their rows with a space where the
    /// separator belongs — `/$ctl/safes /area/RIGHT` at 4059 — and the path audit was taught to join
    /// such a token, so the addresses are traced.)
    ///
    /// **Measured on a WING Rack, 2026-09-27** (read-only probes): the output node is
    /// `/$ctl/safes/output/<group>` — `/$ctl/safes/outpu/A` does not exist — `output` lists the
    /// eleven groups below and each mask is as long as its group's entry count (A 48, MOD 64, REC 4).
    /// That is exactly what the rows resolve to, and `every_desk_level_key_resolves_to_its_documented_path`
    /// pins it so the extraction's typo cannot come back as a silent write.
    const SAFES_LEAVES: &[(&str, &str)] = &[
        ("safes_ch", "/ch"),
        ("safes_aux", "/aux"),
        ("safes_bus", "/bus"),
        ("safes_main", "/main"),
        ("safes_mtx", "/mtx"),
        ("safes_dca", "/dca"),
        ("safes_mute", "/mute"),
        ("safes_fx", "/fx"),
        ("safes_source_lcl", "/source/LCL"),
        ("safes_source_aux", "/source/AUX"),
        ("safes_source_a", "/source/A"),
        ("safes_source_b", "/source/B"),
        ("safes_source_c", "/source/C"),
        ("safes_source_sc", "/source/SC"),
        ("safes_source_usb", "/source/USB"),
        ("safes_source_crd", "/source/CRD"),
        ("safes_source_mod", "/source/MOD"),
        ("safes_source_play", "/source/PLAY"),
        ("safes_source_aes", "/source/AES"),
        ("safes_source_usr", "/source/USR"),
        ("safes_source_osc", "/source/OSC"),
        ("safes_output_lcl", "/output/LCL"),
        ("safes_output_aux", "/output/AUX"),
        ("safes_output_a", "/output/A"),
        ("safes_output_b", "/output/B"),
        ("safes_output_c", "/output/C"),
        ("safes_output_sc", "/output/SC"),
        ("safes_output_usb", "/output/USB"),
        ("safes_output_crd", "/output/CRD"),
        ("safes_output_mod", "/output/MOD"),
        ("safes_output_rec", "/output/REC"),
        ("safes_output_aes", "/output/AES"),
        ("safes_area_left", "/area/LEFT"),
        ("safes_area_center", "/area/CENTER"),
        ("safes_area_right", "/area/RIGHT"),
        ("safes_area_compact", "/area/COMPACT"),
        ("safes_area_rack", "/area/RACK"),
        ("safes_area_extern", "/area/EXTERN"),
        ("safes_area_virtual", "/area/VIRTUAL"),
        ("safes_custom", "/custom"),
        ("safes_setup", "/setup"),
    ];

    const SAFES_PARAMETERS: &[TargetParameterInfo] = &[
        text("safes_ch", "Channel Safes", 40, "Channel safes switches, 40 characters maximum, one per channel 1…40 (`+` = safe, space = not safe) (4017)."),
        text("safes_aux", "Aux Safes", 8, "Aux safes switches, 8 characters maximum (`+` = safe, space = not safe), one per aux 1…8 (4018)."),
        text("safes_bus", "Bus Safes", 16, "Bus safes switches, 16 characters maximum (`+` = safe, space = not safe), one per bus 1…16 (4019)."),
        text("safes_main", "Main Safes", 4, "Main safes switches, 4 characters maximum (`+` = safe, space = not safe), one per main 1…4 (4020)."),
        text("safes_mtx", "Matrix Safes", 8, "Matrix safes switches, 8 characters maximum (`+` = safe, space = not safe), one per matrix 1…8 (4021)."),
        text("safes_dca", "DCA Safes", 16, "DCA safes switches, 16 characters maximum (`+` = safe, space = not safe), one per DCA 1…16 (4022)."),
        text("safes_mute", "Mute Group Safes", 8, "Mute safes switches, 8 characters maximum (`+` = safe, space = not safe), one per mute group 1…8 (4023)."),
        text("safes_fx", "FX Safes", 16, "FX safes switches, 16 characters maximum (`+` = safe, space = not safe), one per FX slot 1…16 (4024)."),
        text("safes_source_lcl", "Local Source Safes", 24, "LCL source safes switches, 24 characters maximum (`+` = safe, space = not safe), one per local input (4027). The leaf always takes 24 characters; how many of them a desk really has follows its model — 8 local inputs on the full-size console, 24 on a Rack or a Compact (344, 402, 421, 448; footnote 17 at 1641)."),
        text("safes_source_aux", "Aux Source Safes", 8, "AUX source safes switches, 8 characters maximum (`+` = safe, space = not safe), one per aux input 1…8 (4028)."),
        text("safes_source_a", "AES50-A Source Safes", 48, "A source safes switches, 48 characters maximum (`+` = safe, space = not safe), one per AES50-A input 1…48 (4029)."),
        text("safes_source_b", "AES50-B Source Safes", 48, "B source safes switches, 48 characters maximum (`+` = safe, space = not safe), one per AES50-B input 1…48 (4030)."),
        text("safes_source_c", "AES50-C Source Safes", 48, "C source safes switches, 48 characters maximum (`+` = safe, space = not safe), one per AES50-C input 1…48 (4031)."),
        text("safes_source_sc", "StageConnect Source Safes", 32, "SC source safes switches, 32 characters maximum (`+` = safe, space = not safe), one per StageConnect input 1…32 (4032)."),
        text("safes_source_usb", "USB Source Safes", 48, "USB source safes switches, 48 characters maximum (`+` = safe, space = not safe), one per USB input 1…48 (4033)."),
        text("safes_source_crd", "Card Source Safes", 64, "CRD source safes switches, 64 characters maximum (`+` = safe, space = not safe), one per card input 1…64 (4034)."),
        text("safes_source_mod", "Module Source Safes", 64, "MOD source safes switches, 64 characters maximum (`+` = safe, space = not safe), one per module input 1…64 (4035)."),
        text("safes_source_play", "Player Source Safes", 4, "PLAY source safes switches, 4 characters maximum (`+` = safe, space = not safe), one per player input 1…4 (4036). The document's description says REC where the leaf says PLAY."),
        text("safes_source_aes", "AES/EBU Source Safes", 2, "AES source safes switches, 2 characters maximum (`+` = safe, space = not safe), one per AES/EBU input 1…2 (4037)."),
        text("safes_source_usr", "User Signal Safes", 48, "USR source safes switches, 48 characters maximum (`+` = safe, space = not safe) (4038). The node documents 56 user signals while this mask is 48 characters long, so the characters are the document's, not a count of the signals."),
        text("safes_source_osc", "Oscillator Source Safes", 2, "OSC source safes switches, 2 characters maximum (`+` = safe, space = not safe), one per oscillator source 1…2 (4039)."),
        text("safes_output_lcl", "Local Output Safes", 8, "LCL out safes switches, 8 characters maximum (`+` = safe, space = not safe), one per local output 1…8 (4042)."),
        text("safes_output_aux", "Aux Output Safes", 8, "AUX out safes switches, 8 characters maximum (`+` = safe, space = not safe), one per aux output 1…8 (4043)."),
        text("safes_output_a", "AES50-A Output Safes", 48, "A out safes switches, 48 characters maximum (`+` = safe, space = not safe), one per AES50-A output 1…48 (4044). The row prints the node as `outpu/A`, a typo: the node is `/$ctl/safes/output` (4041) and its ten siblings spell it out, so the address resolved here is `/$ctl/safes/output/A`."),
        text("safes_output_b", "AES50-B Output Safes", 48, "B out safes switches, 48 characters maximum (`+` = safe, space = not safe), one per AES50-B output 1…48 (4045)."),
        text("safes_output_c", "AES50-C Output Safes", 48, "C out safes switches, 48 characters maximum (`+` = safe, space = not safe), one per AES50-C output 1…48 (4048)."),
        text("safes_output_sc", "StageConnect Output Safes", 32, "SC out safes switches, 32 characters maximum (`+` = safe, space = not safe), one per StageConnect output 1…32 (4049)."),
        text("safes_output_usb", "USB Output Safes", 48, "USB out safes switches, 48 characters maximum (`+` = safe, space = not safe), one per USB output 1…48 (4050)."),
        text("safes_output_crd", "Card Output Safes", 64, "CRD out safes switches, 64 characters maximum (`+` = safe, space = not safe), one per card output 1…64 (4051)."),
        text("safes_output_mod", "Module Output Safes", 64, "MOD out safes switches, 64 characters maximum (`+` = safe, space = not safe), one per module output 1…64 (4052)."),
        text("safes_output_rec", "Recorder Output Safes", 4, "REC out safes switches, 4 characters maximum (`+` = safe, space = not safe), one per recorder output 1…4 (4053)."),
        text("safes_output_aes", "AES/EBU Output Safes", 2, "AES out safes switches, 2 characters maximum (`+` = safe, space = not safe), one per AES/EBU output 1…2 (4054)."),
        text("safes_area_left", "Left Area Safes", 7, "Left area safes switches, 7 characters maximum (`+` = safe, space = not safe), one per item of that area (4057)."),
        text("safes_area_center", "Center Area Safes", 6, "Center area safes switches, 6 characters maximum (`+` = safe, space = not safe), one per item of that area (4058)."),
        text("safes_area_right", "Right Area Safes", 7, "Right area safes switches, 7 characters maximum (`+` = safe, space = not safe), one per item of that area (4059). The extraction prints the row with a space before the leaf (`/$ctl/safes /area/RIGHT`); it is the same node as its siblings."),
        text("safes_area_compact", "Compact Area Safes", 9, "Compact area safes switches, 9 characters maximum (`+` = safe, space = not safe), one per item of that area (4060)."),
        text("safes_area_rack", "Rack Area Safes", 5, "Rack area safes switches, 5 characters maximum (`+` = safe, space = not safe), one per item of that area (4062)."),
        text("safes_area_extern", "Extern Area Safes", 8, "Extern area safes switches, 8 characters maximum (`+` = safe, space = not safe), one per item of that area (4063). Its row carries the same extraction space as the right area's."),
        text("safes_area_virtual", "Virtual Area Safes", 8, "Virtual area safes switches, 8 characters maximum (`+` = safe, space = not safe), one per item of that area (4064). Its row carries the same extraction space as the right area's."),
        text("safes_custom", "Custom Area Safes", 31, "Custom area safes switches, 31 characters maximum (`+` = safe, space = not safe), one per item of that area (4066)."),
        text("safes_setup", "Setup Safes", 3, "Setup area safes switches, 3 characters maximum (`+` = safe, space = not safe), one per item of that area (4067)."),
    ];

    /// The leaves of one monitor bus (Maillot 1314-1378), after the bus id.
    ///
    /// The two read-only rows are in the same table as the writable ones on purpose: the monitor
    /// level is read-only on the full-size desk (footnote 13) and on the Rack measured on
    /// 2026-09-27, and `$lvlact` is `[RO]` everywhere, and a watch of either is a comparison against
    /// a real address, so the address has to resolve exactly as `/eq/1g` does. What keeps a step away
    /// from them is the target list, not this table.
    const MONBUS_LEAVES: &[(&str, &str)] = &[
        ("monitor_level", "/$lvl"),
        ("monitor_invert", "/inv"),
        ("monitor_pan", "/pan"),
        ("monitor_width", "/wid"),
        ("monitor_eq_on", "/eq/on"),
        ("monitor_eq_low_gain", "/eq/lsg"),
        ("monitor_eq_low_freq", "/eq/lsf"),
        ("monitor_eq_1_gain", "/eq/1g"),
        ("monitor_eq_1_freq", "/eq/1f"),
        ("monitor_eq_1_q", "/eq/1q"),
        ("monitor_eq_2_gain", "/eq/2g"),
        ("monitor_eq_2_freq", "/eq/2f"),
        ("monitor_eq_2_q", "/eq/2q"),
        ("monitor_eq_3_gain", "/eq/3g"),
        ("monitor_eq_3_freq", "/eq/3f"),
        ("monitor_eq_3_q", "/eq/3q"),
        ("monitor_eq_4_gain", "/eq/4g"),
        ("monitor_eq_4_freq", "/eq/4f"),
        ("monitor_eq_4_q", "/eq/4q"),
        ("monitor_eq_5_gain", "/eq/5g"),
        ("monitor_eq_5_freq", "/eq/5f"),
        ("monitor_eq_5_q", "/eq/5q"),
        ("monitor_eq_6_gain", "/eq/6g"),
        ("monitor_eq_6_freq", "/eq/6f"),
        ("monitor_eq_6_q", "/eq/6q"),
        ("monitor_eq_high_gain", "/eq/hsg"),
        ("monitor_eq_high_freq", "/eq/hsf"),
        ("monitor_limiter", "/lim"),
        ("monitor_delay_on", "/dly/on"),
        ("monitor_delay", "/dly/m"),
        ("monitor_dim", "/dim"),
        ("monitor_pfl_dim", "/pfldim"),
        ("monitor_band_solo_trim", "/eqbdtrim"),
        ("monitor_source_level", "/srclvl"),
        ("monitor_source_mix", "/srcmix"),
        ("monitor_source", "/src"),
        ("monitor_direct_in", "/dirin"),
        ("monitor_active_level", "/$lvlact"),
        ("monitor_tags", "/tags"),
    ];

    /// What a monitor bus feeds from (Maillot 1371-1373), in the document's order: `OFF`, the four
    /// mains, the eight matrices, the sixteen buses and the eight auxes.
    const MONITOR_SOURCES: &[&str] = &[
        "OFF", "MAIN.1", "MAIN.2", "MAIN.3", "MAIN.4", "MTX.1", "MTX.2", "MTX.3", "MTX.4", "MTX.5",
        "MTX.6", "MTX.7", "MTX.8", "BUS.1", "BUS.2", "BUS.3", "BUS.4", "BUS.5", "BUS.6", "BUS.7",
        "BUS.8", "BUS.9", "BUS.10", "BUS.11", "BUS.12", "BUS.13", "BUS.14", "BUS.15", "BUS.16",
        "AUX.1", "AUX.2", "AUX.3", "AUX.4", "AUX.5", "AUX.6", "AUX.7", "AUX.8",
    ];

    /// What a monitor bus takes on its direct input (Maillot 1374-1376), in the document's order:
    /// `OFF`, the forty channels, the eight auxes, the sixteen buses, the four mains and the eight
    /// matrices — a different list from the source above, and a longer one.
    const MONITOR_DIRECT_SOURCES: &[&str] = &[
        "OFF", "CH.1", "CH.2", "CH.3", "CH.4", "CH.5", "CH.6", "CH.7", "CH.8", "CH.9", "CH.10",
        "CH.11", "CH.12", "CH.13", "CH.14", "CH.15", "CH.16", "CH.17", "CH.18", "CH.19", "CH.20",
        "CH.21", "CH.22", "CH.23", "CH.24", "CH.25", "CH.26", "CH.27", "CH.28", "CH.29", "CH.30",
        "CH.31", "CH.32", "CH.33", "CH.34", "CH.35", "CH.36", "CH.37", "CH.38", "CH.39", "CH.40",
        "AUX.1", "AUX.2", "AUX.3", "AUX.4", "AUX.5", "AUX.6", "AUX.7", "AUX.8", "BUS.1", "BUS.2",
        "BUS.3", "BUS.4", "BUS.5", "BUS.6", "BUS.7", "BUS.8", "BUS.9", "BUS.10", "BUS.11", "BUS.12",
        "BUS.13", "BUS.14", "BUS.15", "BUS.16", "MAIN.1", "MAIN.2", "MAIN.3", "MAIN.4", "MTX.1",
        "MTX.2", "MTX.3", "MTX.4", "MTX.5", "MTX.6", "MTX.7", "MTX.8",
    ];

    const MONBUS_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        // The row footnote 13 (1357-1359) restricts: *"This command is considered RO on the
        // full-size WING, and can be set for other devices where the actual surface control
        // potentiometer is not present."* Measured on a WING Rack, 2026-09-27 (read-only probes,
        // every write restored): the desk refused the normalised integer, the normalised float, the
        // dB float, the dB string and the console's own spelling of the value, and `/cfg/mon/2/$lvl`
        // stayed silent while `/cfg/mon/2/pan` answered — so the Rack is on the read-only side too
        // and only the Compact, which the document grants and no desk here can measure, keeps the
        // write. The two buses keep the key in the watch list on every model: `$lvl` is a report
        // there, and the second bus of the desk measured is a report that never arrived, which a
        // watch can show and a step can only lie about. The hint names the families the document
        // and the measurement distinguish, never a unit (AGENTS.md, "No Console Identity In
        // User-Visible Text").
        read_only_on(
            number(
                "monitor_level",
                "Monitor Level",
                "db",
                "dB",
                -144.0,
                10.0,
                "Monitor bus level, -144…10 in 1024 steps (1316); -144 is -inf. Writable on a Compact, which footnote 13 grants; read-only on the full-size WING (footnote 13) and on a Rack, where the console was measured to ignore every spelling of the write (2026-09-27). The write is offered for the model the desk announced at discovery and withheld otherwise; watching the level works where the desk reports the leaf — on the desk measured, the second monitor bus did not report `$lvl`.",
            ),
            &[DeskModel::Full, DeskModel::Rack],
        ),
        toggle(
            "monitor_invert",
            "Monitor Invert",
            "Monitor bus polarity, 0 = normal, 1 = inverted (1317).",
        ),
        number(
            "monitor_pan",
            "Monitor Pan",
            "percent",
            "%",
            -100.0,
            100.0,
            "Monitor bus pan, -100…100 in 201 steps (1318).",
        ),
        number(
            "monitor_width",
            "Monitor Width",
            "percent",
            "%",
            -150.0,
            150.0,
            "Monitor bus width, -150…150 in 61 steps (1319).",
        ),
        toggle(
            "monitor_eq_on",
            "Monitor EQ On",
            "Monitor bus EQ off/on (1322).",
        ),
        number(
            "monitor_eq_low_gain",
            "Monitor EQ Low Shelf Gain",
            "db",
            "dB",
            -15.0,
            15.0,
            "Monitor bus EQ low shelf gain, ±15 dB (1323).",
        ),
        number(
            "monitor_eq_low_freq",
            "Monitor EQ Low Shelf Frequency",
            "hz",
            "Hz",
            20.0,
            2000.0,
            "Monitor bus EQ low shelf frequency, 20…2000 Hz (1325).",
        ),
        number(
            "monitor_eq_1_gain",
            "Monitor EQ 1 Gain",
            "db",
            "dB",
            -15.0,
            15.0,
            "Monitor bus EQ band 1 gain, ±15 dB (1327).",
        ),
        number(
            "monitor_eq_1_freq",
            "Monitor EQ 1 Frequency",
            "hz",
            "Hz",
            20.0,
            20000.0,
            "Monitor bus EQ band 1 frequency, 20…20000 Hz (1328).",
        ),
        number(
            "monitor_eq_1_q",
            "Monitor EQ 1 Q",
            "number",
            "",
            0.44,
            10.0,
            "Monitor bus EQ band 1 Q, 0.44…10 (1330).",
        ),
        number(
            "monitor_eq_2_gain",
            "Monitor EQ 2 Gain",
            "db",
            "dB",
            -15.0,
            15.0,
            "Monitor bus EQ band 2 gain, ±15 dB (1331).",
        ),
        number(
            "monitor_eq_2_freq",
            "Monitor EQ 2 Frequency",
            "hz",
            "Hz",
            20.0,
            20000.0,
            "Monitor bus EQ band 2 frequency, 20…20000 Hz (1332).",
        ),
        number(
            "monitor_eq_2_q",
            "Monitor EQ 2 Q",
            "number",
            "",
            0.44,
            10.0,
            "Monitor bus EQ band 2 Q, 0.44…10 (1334).",
        ),
        number(
            "monitor_eq_3_gain",
            "Monitor EQ 3 Gain",
            "db",
            "dB",
            -15.0,
            15.0,
            "Monitor bus EQ band 3 gain, ±15 dB (1335).",
        ),
        number(
            "monitor_eq_3_freq",
            "Monitor EQ 3 Frequency",
            "hz",
            "Hz",
            20.0,
            20000.0,
            "Monitor bus EQ band 3 frequency, 20…20000 Hz (1336).",
        ),
        number(
            "monitor_eq_3_q",
            "Monitor EQ 3 Q",
            "number",
            "",
            0.44,
            10.0,
            "Monitor bus EQ band 3 Q, 0.44…10 (1338).",
        ),
        number(
            "monitor_eq_4_gain",
            "Monitor EQ 4 Gain",
            "db",
            "dB",
            -15.0,
            15.0,
            "Monitor bus EQ band 4 gain, ±15 dB (1339).",
        ),
        number(
            "monitor_eq_4_freq",
            "Monitor EQ 4 Frequency",
            "hz",
            "Hz",
            20.0,
            20000.0,
            "Monitor bus EQ band 4 frequency, 20…20000 Hz (1340).",
        ),
        number(
            "monitor_eq_4_q",
            "Monitor EQ 4 Q",
            "number",
            "",
            0.44,
            10.0,
            "Monitor bus EQ band 4 Q, 0.44…10 (1342).",
        ),
        number(
            "monitor_eq_5_gain",
            "Monitor EQ 5 Gain",
            "db",
            "dB",
            -15.0,
            15.0,
            "Monitor bus EQ band 5 gain, ±15 dB (1343).",
        ),
        number(
            "monitor_eq_5_freq",
            "Monitor EQ 5 Frequency",
            "hz",
            "Hz",
            20.0,
            20000.0,
            "Monitor bus EQ band 5 frequency, 20…20000 Hz (1344).",
        ),
        number(
            "monitor_eq_5_q",
            "Monitor EQ 5 Q",
            "number",
            "",
            0.44,
            10.0,
            "Monitor bus EQ band 5 Q, 0.44…10 (1346).",
        ),
        number(
            "monitor_eq_6_gain",
            "Monitor EQ 6 Gain",
            "db",
            "dB",
            -15.0,
            15.0,
            "Monitor bus EQ band 6 gain, ±15 dB (1347).",
        ),
        number(
            "monitor_eq_6_freq",
            "Monitor EQ 6 Frequency",
            "hz",
            "Hz",
            20.0,
            20000.0,
            "Monitor bus EQ band 6 frequency, 20…20000 Hz (1348).",
        ),
        number(
            "monitor_eq_6_q",
            "Monitor EQ 6 Q",
            "number",
            "",
            0.44,
            10.0,
            "Monitor bus EQ band 6 Q, 0.44…10 (1350).",
        ),
        number(
            "monitor_eq_high_gain",
            "Monitor EQ High Shelf Gain",
            "db",
            "dB",
            -15.0,
            15.0,
            "Monitor bus EQ high shelf gain, ±15 dB (1351).",
        ),
        number(
            "monitor_eq_high_freq",
            "Monitor EQ High Shelf Frequency",
            "hz",
            "Hz",
            50.0,
            20000.0,
            "Monitor bus EQ high shelf frequency, 50…20000 Hz (1353).",
        ),
        number(
            "monitor_limiter",
            "Monitor Limiter",
            "db",
            "dB",
            -40.0,
            0.0,
            "Monitor bus limiter level, -40…0 dB in 41 steps (1361).",
        ),
        toggle(
            "monitor_delay_on",
            "Monitor Delay On",
            "Monitor bus delay off/on (1364).",
        ),
        number(
            "monitor_delay",
            "Monitor Delay",
            "number",
            "m",
            0.1,
            100.0,
            "Monitor bus delay in metres, 0.1…100 in 1000 steps (1365). The leaf is a float and the document gives it no mode selector, so the unit is metres and nothing else.",
        ),
        number(
            "monitor_dim",
            "Monitor Dim",
            "db",
            "dB",
            0.0,
            40.0,
            "Monitor bus dim level, documented 40…0 in 41 steps (1366): 40 is the most attenuation, 0 none.",
        ),
        number(
            "monitor_pfl_dim",
            "Monitor PFL Dim",
            "db",
            "dB",
            0.0,
            40.0,
            "Monitor bus PFL dim, documented 40…0 in 41 steps (1367): 40 is the most attenuation, 0 none.",
        ),
        number(
            "monitor_band_solo_trim",
            "Monitor Band Solo Trim",
            "db",
            "dB",
            0.0,
            24.0,
            "Monitor bus band solo trim, 0…24 dB in 25 steps (1368).",
        ),
        number(
            "monitor_source_level",
            "Monitor Source Level",
            "db",
            "dB",
            -144.0,
            10.0,
            "Monitor bus source level, -144…10 in 1024 steps (1369); -144 is -inf.",
        ),
        number(
            "monitor_source_mix",
            "Monitor Source Mix",
            "db",
            "dB",
            -144.0,
            10.0,
            "Monitor bus source mix, -144…10 in 1024 steps (1370); -144 is -inf.",
        ),
        choice(
            "monitor_source",
            "Monitor Source",
            MONITOR_SOURCES,
            "Monitor bus source: OFF, MAIN.1…MAIN.4, MTX.1…MTX.8, BUS.1…BUS.16, AUX.1…AUX.8 (1371-1373).",
        ),
        choice(
            "monitor_direct_in",
            "Monitor Direct Input",
            MONITOR_DIRECT_SOURCES,
            "Monitor bus direct input: OFF, CH.1…CH.40, AUX.1…AUX.8, BUS.1…BUS.16, MAIN.1…MAIN.4, MTX.1…MTX.8 (1374-1376) — a different and longer list than the source above.",
        ),
        text(
            "monitor_tags",
            "Monitor Tags",
            80,
            "Monitor bus tags, up to 80 characters (1378).",
        ),
    ];

    /// The monitor-bus row the console only reports (Maillot 1377).
    ///
    /// `$lvl` (1316) is **not** here any more: footnote 13 gives the write to the devices whose
    /// surface has no control potentiometer, so it is a model-restricted *target* in
    /// [`MONBUS_TARGET_PARAMETERS`] and a watch everywhere — see
    /// [`TargetParameterInfo::read_only_on_models`] and [`write_allowed_on_model`]. A `[RO]` row
    /// like this one is both a target-list absence and a watch-list presence, which is the split
    /// [`desk_level_watch_parameters`] builds.
    const MONBUS_READ_ONLY_PARAMETERS: &[TargetParameterInfo] = &[number(
        "monitor_active_level",
        "Monitor Active Level",
        "db",
        "dB",
        -144.0,
        10.0,
        "Monitor bus fader level the console reports, -144…10 in 1024 steps (1377). `[RO]`: a watch, never a step.",
    )];

    /// The solo-configuration node (Maillot 1380-1394), after the `/cfg/solo` prefix.
    const SOLO_LEAVES: &[(&str, &str)] = &[
        ("solo_mode", "/mode"),
        ("solo_monitor", "/mon"),
        ("solo_mute", "/mute"),
        ("solo_dim", "/$dim"),
        ("solo_mono", "/$mono"),
        ("solo_flip", "/$flip"),
        ("solo_channel_tap", "/chtap"),
        ("solo_bus_tap", "/bustap"),
        ("solo_main_tap", "/maintap"),
        ("solo_matrix_tap", "/mtxtap"),
        ("solo_source", "/srcsolo"),
        ("solo_source_state", "/$srcsolo"),
        ("solo_source_group", "/$srcsgrp"),
        ("solo_source_input", "/$srcsin"),
    ];

    /// The three solo modes (1381), the three monitor destinations (1382) and the two taps every
    /// family takes (1387-1390).
    const SOLO_MODES: &[&str] = &["LIVE", "STUDIO", "SIP"];
    const SOLO_MONITORS: &[&str] = &["PH", "SPK", "PH+SPK"];
    const SOLO_TAPS: &[&str] = &["PFL", "AFL"];

    /// The values the extracted row prints for `/cfg/solo/srcsolo` (1391): `OFF, CH39, AUX7`.
    ///
    /// It is the one list in this batch that does not read like a complete enumeration — an enum
    /// would not single out channel 39 and aux 7 — but it is what the block prints, the batch rule is
    /// that no option list enters the code without the line it came from, and refusing a value the
    /// document does print would be the other kind of mistake. The hint says what the three are and
    /// points at the read-back that reports the real state.
    const SOLO_SOURCE_VALUES: &[&str] = &["OFF", "CH39", "AUX7"];

    const SOLOCFG_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        choice(
            "solo_mode",
            "Solo Mode",
            SOLO_MODES,
            "Solo mode: LIVE, STUDIO or SIP (1381).",
        ),
        choice(
            "solo_monitor",
            "Solo Monitor",
            SOLO_MONITORS,
            "Where solo is monitored: PH, SPK or PH+SPK (1382).",
        ),
        toggle("solo_mute", "Solo Mute", "Solo mute, 0/1 (1383)."),
        toggle(
            "solo_dim",
            "Solo Dim",
            "Solo dim off/on (1384). Written and reported: a write latches on hardware, and the value written reads back.",
        ),
        toggle(
            "solo_mono",
            "Solo Mono",
            "Solo mono off/on (1385). Written and reported: a write latches on hardware, and the value written reads back.",
        ),
        toggle(
            "solo_flip",
            "Solo Flip",
            "Solo left and right channels flipped (1386). Written and reported: a write latches on hardware, and the value written reads back.",
        ),
        choice(
            "solo_channel_tap",
            "Solo Channel Tap",
            SOLO_TAPS,
            "Solo channel tap: PFL or AFL (1387).",
        ),
        choice(
            "solo_bus_tap",
            "Solo Bus Tap",
            SOLO_TAPS,
            "Solo bus tap: PFL or AFL (1388).",
        ),
        choice(
            "solo_main_tap",
            "Solo Main Tap",
            SOLO_TAPS,
            "Solo main tap: PFL or AFL (1389).",
        ),
        choice(
            "solo_matrix_tap",
            "Solo Matrix Tap",
            SOLO_TAPS,
            "Solo matrix tap: PFL or AFL (1390).",
        ),
        choice(
            "solo_source",
            "Source Solo Enable",
            SOLO_SOURCE_VALUES,
            "Source solo enable (1391). The document prints exactly OFF, CH39 and AUX7: it does not enumerate the whole source space, and what the console is really soloing is reported by `/cfg/solo/$srcsolo`, `$srcsgrp` and `$srcsin` (1392-1394) — Source Solo State, Group and Input in this catalogue.",
        ),
    ];

    /// The three source-solo reports of the solo node (Maillot 1392-1394), the `$` rows a macro may
    /// only watch.
    ///
    /// The document does not mark them `[RO]`, so the reason is the node itself: the three say what
    /// the source solo above actually selected, and a write was tried on hardware and did not latch
    /// (WING Rack, FW 3.1.1: writing `$srcsolo` 1 left it at 0). The three switches the desk's
    /// surface drives — `$dim`, `$mono` and `$flip` (1384-1386) — do take a write on that same desk
    /// and are offered as targets, so the split here is measured rather than assumed.
    const SOLOCFG_READ_ONLY_PARAMETERS: &[TargetParameterInfo] = &[
        toggle(
            "solo_source_state",
            "Source Solo",
            "Source solo state the console reports (1392). A watch: a write was tried on hardware and did not latch.",
        ),
        integer(
            "solo_source_group",
            "Source Solo Group",
            "number",
            "",
            1.0,
            13.0,
            "Source solo group the console reports, 1…13 (1393). A watch: a write was tried on hardware and did not latch.",
        ),
        integer(
            "solo_source_input",
            "Source Solo Input",
            "number",
            "",
            1.0,
            64.0,
            "Source solo input the console reports, 1…64 (1394). A watch: a write was tried on hardware and did not latch.",
        ),
    ];

    /// The AES50 status node (Maillot 1254-1272), after the port's letter.
    ///
    /// Four of the five rows are `[RO]`, including both error counters (the row at 1270 even prints a
    /// mangled `RO]` where the other two print `[RO]`), so the point of the block is a watch: "the
    /// AES50 link dropped" or "the error count is climbing". Only `clrerr` is writable, and it is a
    /// command rather than a state — the console reports the counters it resets — so it is offered as
    /// a write only, the shape `rec_action` and `play_action` established.
    const AES50_LEAVES: &[(&str, &str)] = &[
        ("aes50_state", "/stat"),
        ("aes50_device", "/dev"),
        ("aes50_errors_corrected", "/errorsc"),
        ("aes50_errors_uncorrected", "/errorsu"),
        ("aes50_clear_errors", "/clrerr"),
    ];

    /// The four states an AES50 port reports (1254, 1261, 1268), in the document's order. The first
    /// is the single character `-`.
    const AES50_STATES: &[&str] = &["-", "OK", "ERR", "UPD"];

    const AES50_TARGET_PARAMETERS: &[TargetParameterInfo] = &[write_only(toggle(
        "aes50_clear_errors",
        "Clear AES50 Errors",
        "Reset the port's error counters, 0/1 (1258, 1265, 1272). A command, not a state: the counters themselves are the read-only Corrected and Uncorrected Errors keys.",
    ))];

    const AES50_READ_ONLY_PARAMETERS: &[TargetParameterInfo] = &[
        choice(
            "aes50_state",
            "AES50 State",
            AES50_STATES,
            "AES50 link state the console reports: `-`, OK, ERR or UPD (1254, 1261, 1268). `[RO]`: the trigger \"the link dropped\".",
        ),
        text(
            "aes50_device",
            "AES50 Device",
            128,
            "AES50 device name the console reports, 128 characters maximum (1255, 1262, 1269). `[RO]`.",
        ),
        integer(
            "aes50_errors_corrected",
            "AES50 Corrected Errors",
            "number",
            "",
            0.0,
            9999.0,
            "Corrected error count the console reports, 0…9999 (1256, 1263, 1270). `[RO]`: watch it climb before the link drops.",
        ),
        integer(
            "aes50_errors_uncorrected",
            "AES50 Uncorrected Errors",
            "number",
            "",
            0.0,
            9999.0,
            "Uncorrected error count the console reports, 0…9999 (1257, 1264, 1271). `[RO]`: the count that matters when audio has already glitched.",
        ),
    ];

    /// The desk-status rows of the `/$stat` node (Maillot 1274-1275).
    ///
    /// The whole block around them is `[RO]` — the clock, the USB player, StageConnect and the three
    /// remote-console names (1276-1301) — and the only settable row of `/$stat` is the AES50
    /// `clrerr` above, which belongs to the AES50 category. So this category carries no target list
    /// at all: it is `desk_lock` ("is the desk clock locked") and `desk_ppm` ("how far the clock is
    /// pulling"), both watches.
    const DESK_STATUS_LEAVES: &[(&str, &str)] =
        &[("desk_lock", "/lock"), ("desk_ppm", "/ppm")];

    const DESK_STATUS_PARAMETERS: &[TargetParameterInfo] = &[
        toggle(
            "desk_lock",
            "Clock Lock",
            "Clock lock the console reports: 0 = not locked, 1 = locked (1274). `[RO]`: a watch, never a step.",
        ),
        integer(
            "desk_ppm",
            "Clock PPM",
            "number",
            "ppm",
            -200.0,
            200.0,
            "Clock deviation the console reports, -200…200 ppm (1275). `[RO]`: a watch, never a step.",
        ),
    ];

    /// The identity of the card in the slot (Maillot 2951-2954), a watch-only category like the desk
    /// status: both rows are `[RO]`, and they are how a macro tells whether a W-Live card is in the
    /// desk before a transport step is armed.
    const CARDS_LEAVES: &[(&str, &str)] = &[("cards_type", "/$type"), ("cards_version", "/$ver")];

    /// The five card types the console reports (2951), in the document's order.
    const CARD_TYPES: &[&str] = &["NONE", "WLIVE", "WDANTE", "WMADI", "WDWSG"];

    const CARDS_PARAMETERS: &[TargetParameterInfo] = &[
        choice(
            "cards_type",
            "Card Type",
            CARD_TYPES,
            "Card type the console reports: NONE, WLIVE, WDANTE, WMADI or WDWSG (2951). `[RO]`: compare it to WLIVE to know whether the multitrack card is in the slot.",
        ),
        text(
            "cards_version",
            "Card Version",
            32,
            "Card version the console reports, 32 characters maximum (2954). `[RO]`.",
        ),
    ];

    /// The W-Live multitrack card (Maillot 2966-2998), after the card's id.
    ///
    /// The `$ctl` node is the transport and it is written; the `$stat` node is what the console
    /// reports, and only `state` is offered from it. Every `$ctl` key is therefore a write-only
    /// entry: the console answers what the card is doing on `/cards/wlive/<n>/$stat/state`, not by
    /// reading the command back, exactly as the USB recorder's `$action` does (batch 4).
    ///
    /// **Measured on a WING Rack, 2026-09-27** (read-only probes): a desk with **no card in the
    /// slot** leaves every report leaf of this node silent — `$actlink`, `$battstate`, `etime`,
    /// `sdfree`, `sdsize`, `sdstate`, `rate`, `sessionlen`, `sessionpos`, `markerpos`, `tracks`,
    /// `linkedpos` and `errorcode` — so whether they take a write is still open for a desk that has
    /// one, and they stay **out of the catalogue**: an entry nothing can answer would offer the
    /// operator a watch that can never fire or a step whose success nothing can confirm. Only
    /// `$stat/state` is offered here, and it is offered as a watch alone.
    const WLIVE_LEAVES: &[(&str, &str)] = &[
        ("wlive_control", "/$ctl/control"),
        ("wlive_open_session", "/$ctl/opensession"),
        ("wlive_marker_edit", "/$ctl/editmarker"),
        ("wlive_marker_goto", "/$ctl/gotomarker"),
        ("wlive_marker_delete", "/$ctl/deletemarker"),
        ("wlive_session_delete", "/$ctl/deletesession"),
        ("wlive_time", "/$ctl/stime"),
        ("wlive_session_name", "/$ctl/namesession"),
        ("wlive_marker_set", "/$ctl/setmarker"),
        ("wlive_format_card", "/$ctl/formatsdcard"),
        ("wlive_state", "/$stat/state"),
    ];

    /// The four transport states of `/cards/wlive/<n>/$ctl/control` (2968) and the same four the
    /// console reports on `/cards/wlive/<n>/$stat/state` (2991), in the document's order.
    const WLIVE_CONTROL: &[&str] = &["STOP", "PPAUSE", "PLAY", "REC"];
    const WLIVE_STATES: &[&str] = &["STOP", "PPAUSE", "PLAY", "REC"];

    const WLIVE_TARGET_PARAMETERS: &[TargetParameterInfo] = &[
        write_only(choice(
            "wlive_control",
            "W-Live Control",
            WLIVE_CONTROL,
            "W-Live transport: STOP, PPAUSE, PLAY or REC (2968). What the card is doing is reported on W-Live State, not read back from this leaf.",
        )),
        write_only(integer(
            "wlive_open_session",
            "W-Live Open Session",
            "number",
            "",
            0.0,
            100.0,
            "Open session number, 0…100 (2970). There can be a maximum of 100 sessions per card (footnote 50, 3040-3041).",
        )),
        write_only(integer(
            "wlive_marker_edit",
            "W-Live Edit Marker",
            "number",
            "",
            0.0,
            100.0,
            "Edit marker number, 0…100 (2971): moves that marker to the current PAUSE time or to the last PLAY start time.",
        )),
        write_only(integer(
            "wlive_marker_goto",
            "W-Live Goto Marker",
            "number",
            "",
            0.0,
            101.0,
            "Go to marker number, 0…101 (2974). 101 is not a marker: it validates the time set on W-Live Time, and a time step does nothing without it (2978-2980).",
        )),
        write_only(integer(
            "wlive_marker_delete",
            "W-Live Delete Marker",
            "number",
            "",
            0.0,
            100.0,
            "Delete marker number, 0…100 (2976).",
        )),
        write_only(integer(
            "wlive_session_delete",
            "W-Live Delete Session",
            "number",
            "",
            0.0,
            100.0,
            "Delete session number, 0…100 (2977). There can be a maximum of 100 sessions per card (footnote 50).",
        )),
        write_only(number(
            "wlive_time",
            "W-Live Time",
            "ms",
            "ms",
            0.0,
            36_000_000.0,
            "Position in milliseconds, 0…36000000 in 36000000 steps (2978-2980). It must be followed by W-Live Goto Marker = 101 to be taken into account — the two are one operation, and a time step alone is ignored.",
        )),
        write_only(text(
            "wlive_session_name",
            "W-Live Session Name",
            19,
            "Name of the session, 19 characters maximum (2981-2982). Works only in STOP mode.",
        )),
        write_only(toggle(
            "wlive_marker_set",
            "W-Live Set Marker",
            "Set a marker at the current position, 0/1 (2983).",
        )),
        write_only(toggle(
            "wlive_format_card",
            "W-Live Format Card",
            "Format the SD card, 0/1 (2984). Destructive: the card's sessions are gone afterwards.",
        )),
    ];

    const WLIVE_READ_ONLY_PARAMETERS: &[TargetParameterInfo] = &[choice(
        "wlive_state",
        "W-Live State",
        WLIVE_STATES,
        "W-Live card state the console reports: STOP, PPAUSE, PLAY or REC (2991). `[RO]`: a watch, never a step — and the only watch this node offers.",
    )];

    /// The clock and the two bus configurations of the `/$globals` node (Maillot 4168-4186).
    ///
    /// The node also carries the HA-remote and custom-sync switches (4188-4196), which this batch
    /// does not offer: they are desk wiring, not something a show changes between cues.
    const GLOBALS_LEAVES: &[(&str, &str)] = &[
        ("global_clock_rate", "/clkrate"),
        ("global_clock_source", "/clksrc"),
        ("global_start_mute", "/startmute"),
        ("global_usb_config", "/usbacfg"),
        ("global_stageconnect_config", "/sccfg"),
    ];

    /// The two master clock rates (4171) and the seven clock sources (4172-4173), as the strings the
    /// console documents.
    const CLOCK_RATES: &[&str] = &["48000.0", "44100.0"];
    const CLOCK_SOURCES: &[&str] = &["INT", "A", "B", "C", "AES", "CARD", "MOD"];

    /// The five USB input/output configurations (4175-4176).
    const USB_CONFIGS: &[&str] = &["2/2", "8/8", "16/16", "32/32", "48/48"];

    /// The StageConnect configurations (4177-4186): `AUTO` and the 33 upstream/downstream splits
    /// from `0/32` to `32/0`.
    const STAGECONNECT_CONFIGS: &[&str] = &[
        "AUTO", "0/32", "1/31", "2/30", "3/29", "4/28", "5/27", "6/26", "7/25", "8/24", "9/23",
        "10/22", "11/21", "12/20", "13/19", "14/18", "15/17", "16/16", "17/15", "18/14", "19/13",
        "20/12", "21/11", "22/10", "23/9", "24/8", "25/7", "26/6", "27/5", "28/4", "29/3", "30/2",
        "31/1", "32/0",
    ];

    const GLOBALS_PARAMETERS: &[TargetParameterInfo] = &[
        choice(
            "global_clock_rate",
            "Clock Rate",
            CLOCK_RATES,
            "Master clock rate, written as the string the console documents: 48000.0 or 44100.0 (4171).",
        ),
        choice(
            "global_clock_source",
            "Clock Source",
            CLOCK_SOURCES,
            "Master clock source: INT, A, B, C, AES, CARD or MOD (4172-4173).",
        ),
        toggle(
            "global_start_mute",
            "Mute Outputs On Startup",
            "Mute the outputs on startup, 0 = off, 1 = on (4174).",
        ),
        choice(
            "global_usb_config",
            "USB Configuration",
            USB_CONFIGS,
            "USB input/output configuration: 2/2, 8/8, 16/16, 32/32 or 48/48 (4175-4176).",
        ),
        choice(
            "global_stageconnect_config",
            "StageConnect Configuration",
            STAGECONNECT_CONFIGS,
            "StageConnect upstream/downstream split, AUTO or 0/32 … 32/0 (4177-4186).",
        ),
    ];

    /// The other half of the desk-level nodes that carry both directions: the `[RO]` rows a watch may
    /// read and a step may not write.
    ///
    /// It is the one place that says which keys a category offers as watches only, and
    /// [`desk_level_watch_parameters`] builds the watch list from it, so a key cannot be a watch in
    /// one list and a target in the other: a read-only key is not in the category's
    /// `*_TARGET_PARAMETERS` at all.
    fn desk_level_read_only_parameters(category: &str) -> &'static [TargetParameterInfo] {
        match category {
            "monbus" => MONBUS_READ_ONLY_PARAMETERS,
            "solocfg" => SOLOCFG_READ_ONLY_PARAMETERS,
            "aes50" => AES50_READ_ONLY_PARAMETERS,
            "wlive" => WLIVE_READ_ONLY_PARAMETERS,
            // The two watch-only nodes keep their whole list in the trigger half, so they need no
            // entry here: `deskstatus` and `cards` cannot be targeted at all.
            _ => &[],
        }
    }

    /// The watch list of a desk-level node that carries both directions.
    ///
    /// Two halves, and neither is optional: what a step writes and the console also reports is a
    /// watch as well (the same list, minus the write-only commands), and the `[RO]` rows are watches
    /// and nothing else. Reading the catalogue here rather than keeping a second copy is what makes
    /// a key's range, unit and closed list identical on the step side and the watch side, and it is
    /// also why the *unfiltered* catalogue is what feeds this half: the monitor level's write is
    /// refused on the full-size desk (footnote 13) and the level itself is reported there like on any
    /// other model, so dropping the key from the step list may not drop it from the watch list.
    fn desk_level_watch_parameters(category: &str) -> Vec<TargetParameterInfo> {
        let mut parameters = catalogue_target_parameters(category)
            .into_iter()
            .filter(|parameter| parameter.can_trigger)
            .collect::<Vec<_>>();
        parameters.extend_from_slice(desk_level_read_only_parameters(category));
        parameters
    }

    const TRIGGER_METER_PARAMETERS: &[TargetParameterInfo] =
        &[meter_parameter("meter", "Meter Level")];

    const TRIGGER_MIX_METER_PARAMETERS: &[TargetParameterInfo] = &[
        meter_parameter("meter", "Meter Level"),
        meter_flag_parameter("meter_v2_gate_led", "Gate LED V2"),
        meter_flag_parameter("meter_v2_dyn_state", "Dyn State V2"),
        meter_parameter("meter_v2_automix", "Automix Gain V2"),
    ];

    const TRIGGER_MONITOR_PARAMETERS: &[TargetParameterInfo] =
        &[meter_parameter("meter_monitor", "Monitor Meter")];

    const TRIGGER_RTA_PARAMETERS: &[TargetParameterInfo] =
        &[meter_parameter("meter_rta_band", "RTA Band")];

    pub fn target_categories() -> &'static [TargetCategoryInfo] {
        TARGET_CATEGORIES
    }

    /// What a step may write in this category.
    ///
    /// The category's own `can_target` decides first: a category that cannot be targeted has no
    /// action parameters at all, whatever its watch list carries. `showstate`'s five keys are the
    /// console's report of the show — writing one would aim a step at a read-only leaf — and
    /// `monitor`, `rta` and the meter-only source groups have always been on that side of the split.
    ///
    /// This is the list for a desk whose model is not known: it is the whole catalogue minus every
    /// entry [`write_allowed_on_model`] refuses on an unannounced model. Callers that know the model
    /// ask [`target_parameters_for_category_for_model`], which is the only difference between the
    /// two lists (`monitor_level` on a Compact).
    pub fn target_parameters_for_category(category: &str) -> Vec<TargetParameterInfo> {
        target_parameters_for_category_for_model(category, DeskModel::Unknown)
    }

    /// What a step may write in this category **on this desk**.
    ///
    /// One entry of the whole catalogue is model-restricted: the monitor bus level
    /// (`/cfg/mon/<n>/$lvl`), which footnote 13 (1357-1359) withholds from the full-size WING and
    /// gives to the devices whose surface has no control potentiometer — a grant a WING Rack was
    /// measured to contradict on 2026-09-27, so the write is offered on a Compact alone.
    /// Everything else is the same list on every model, and a model the desk has not announced is
    /// answered like a model that does not take the write.
    pub fn target_parameters_for_category_for_model(
        category: &str,
        model: DeskModel,
    ) -> Vec<TargetParameterInfo> {
        catalogue_target_parameters(category)
            .into_iter()
            .filter(|parameter| write_allowed_on_model(parameter, model))
            .collect()
    }

    /// The whole documented step catalogue of a category, before the model has a say. It is what
    /// [`target_parameters_for_category_for_model`] filters and what the watch half reads, so a
    /// model-restricted key cannot disappear from the watch list on the model that refuses its write.
    fn catalogue_target_parameters(category: &str) -> Vec<TargetParameterInfo> {
        let category = normalize_category(category);
        if !category_can_target(&category) {
            return Vec::new();
        }
        if mix_family(&category).is_some() {
            let mut parameters = MIX_BASE_TARGET_PARAMETERS
                .iter()
                .copied()
                .filter(|parameter| mix_parameter_allowed(&category, parameter.key))
                .collect::<Vec<_>>();
            // The shared table is the documented default; the few rows a family prints differently
            // are folded in here, so every caller of this function — the trigger list below, the
            // DTO, `watch_rule`, the validator and the editor — reads the family's own values.
            apply_mix_family_overrides(&category, &mut parameters);
            return parameters;
        }
        if source_input_prefix(&category).is_some() {
            return SOURCE_TARGET_PARAMETERS
                .iter()
                .copied()
                .filter(|parameter| source_parameter_allowed(&category, parameter.key))
                .collect();
        }
        if output_prefix_for_category(&category).is_some() {
            return OUTPUT_TARGET_PARAMETERS.to_vec();
        }
        match category.as_str() {
            "dca" => DCA_TARGET_PARAMETERS.to_vec(),
            "mutegroup" => MUTEGROUP_TARGET_PARAMETERS.to_vec(),
            "fx" => FX_TARGET_PARAMETERS.to_vec(),
            "userctrl" => USERCTRL_TARGET_PARAMETERS.to_vec(),
            "talk" => TALK_TARGET_PARAMETERS.to_vec(),
            // The writable half of the GPIO split. `gpiostate` never reaches this match: its
            // `can_target` is false, so the early return above already answered nothing for it.
            "gpio" => GPIO_TARGET_PARAMETERS.to_vec(),
            // The whole I/O node: both switches are written and reported.
            "io" => IO_TARGET_PARAMETERS.to_vec(),
            // The fader layers: the one `sel` leaf is written and reported, so the same list is the
            // target list and the watch list below.
            "layer" => LAYER_TARGET_PARAMETERS.to_vec(),
            // The writable halves of the two USB transport splits. `recstate` and `playstate` never
            // reach this match: their `can_target` is false, so the early return above already
            // answered nothing for them.
            "rec" => REC_TARGET_PARAMETERS.to_vec(),
            "play" => PLAY_TARGET_PARAMETERS.to_vec(),
            "show" => SHOW_TARGET_PARAMETERS.to_vec(),
            // ── Batch 6: the desk level ───────────────────────────────────────────────────────────
            //
            // Seven of the nine categories are here; `deskstatus` and `cards` never reach this match
            // because their `can_target` is false and the early return above already answered nothing
            // for them. Four of the seven (`monbus`, `solocfg`, `aes50`, `wlive`) also carry read-only
            // rows: those are absent from the `*_TARGET_PARAMETERS` list, which is what keeps a step
            // off them, and `desk_level_read_only_parameters` names them for the watch half below.
            "lights" => LIGHTS_PARAMETERS.to_vec(),
            "safes" => SAFES_PARAMETERS.to_vec(),
            "monbus" => MONBUS_TARGET_PARAMETERS.to_vec(),
            "solocfg" => SOLOCFG_TARGET_PARAMETERS.to_vec(),
            "aes50" => AES50_TARGET_PARAMETERS.to_vec(),
            "wlive" => WLIVE_TARGET_PARAMETERS.to_vec(),
            "globals" => GLOBALS_PARAMETERS.to_vec(),
            "custom" => CUSTOM_TARGET_PARAMETERS.to_vec(),
            _ => Vec::new(),
        }
    }

    /// What can be watched as a trigger or an IF gate in this category.
    ///
    /// It used to be "the meter parameters plus every writable target parameter", which offered a
    /// source's `Name` (a string) with the comparator "rises above" and a dB threshold: a macro that
    /// could never fire while the editor called it configured. Only parameters the console
    /// **reports** are listed now, and each one carries the value kind that decides its comparators.
    ///
    /// The category's own `can_trigger` decides first, so a category whose keys the console does not
    /// report has no watch list whatever its target list carries: `show` is the case that made this
    /// explicit (`scene_index` and `scene_action` are written, never read back), and `custom`'s dead
    /// keys were already excluded by the fallback arm.
    pub fn trigger_parameters_for_category(category: &str) -> Vec<TargetParameterInfo> {
        let category = normalize_category(category);
        if !category_can_trigger(&category) {
            return Vec::new();
        }
        let with_meter = |meter_parameters: &[TargetParameterInfo],
                          target_parameters: Vec<TargetParameterInfo>| {
            meter_parameters
                .iter()
                .copied()
                .chain(target_parameters.into_iter().filter(|parameter| parameter.can_trigger))
                .collect()
        };
        match category.as_str() {
            "monitor" => TRIGGER_MONITOR_PARAMETERS.to_vec(),
            "rta" => TRIGGER_RTA_PARAMETERS.to_vec(),
            "showstate" => SHOW_STATE_PARAMETERS.to_vec(),
            // The read-only half of the GPIO split, and the reason it is a split: this list is the
            // only one `gpiostate` has, because `can_target` is false.
            "gpiostate" => GPIO_STATE_PARAMETERS.to_vec(),
            // The read-only halves of the two USB transport splits, and the whole console-status
            // node: what the console reports, and nothing a step may write.
            "recstate" => REC_STATE_PARAMETERS.to_vec(),
            "playstate" => PLAY_STATE_PARAMETERS.to_vec(),
            "stat" => STAT_STATE_PARAMETERS.to_vec(),
            _ if mix_family(&category).is_some() => with_meter(
                // The target list carries the family's own bounds and lists: it is the overlaid one
                // `target_parameters_for_category` returns, so the watch side of a key and its write
                // side can never disagree about the range or the closed list.
                TRIGGER_MIX_METER_PARAMETERS,
                target_parameters_for_category(&category),
            ),
            _ if source_device_id(&category).is_some()
                || output_device_id(&category).is_some()
                || category == "dca"
                || category == "fx" =>
            {
                with_meter(
                    TRIGGER_METER_PARAMETERS,
                    target_parameters_for_category(&category),
                )
            }
            // No meter in these: the console reports every key the category already carries, so the
            // target list *is* the watch list. `mutegroup`, `userctrl`, `talk`, `gpio`, `io` and the
            // fader layers (`layer`) are on this side.
            "mutegroup" | "userctrl" | "talk" | "gpio" | "io" | "layer" => {
                target_parameters_for_category(&category)
            }
            // ── Batch 6: the desk level ───────────────────────────────────────────────────────────
            //
            // The two nodes the console only reports: `can_target` is false, so the list below is the
            // only one they have and no step can be aimed at them.
            "deskstatus" => DESK_STATUS_PARAMETERS.to_vec(),
            "cards" => CARDS_PARAMETERS.to_vec(),
            // The desk-level nodes that carry both directions. The watch list is the target list
            // without the write-only commands, plus the read-only rows — see
            // [`desk_level_watch_parameters`], which is also where the read-only keys are named, so
            // the write half and the watch half of one category cannot drift apart.
            "lights" | "safes" | "monbus" | "solocfg" | "aes50" | "wlive" | "globals" => {
                desk_level_watch_parameters(&category)
            }
            _ => Vec::new(),
        }
    }

    // ── The rule that makes a nonsense comparison impossible ──────────────────────────────────────
    //
    // One place decides what can be watched and how. The editor asks for the same answers through the
    // catalogue (so its selects only offer valid choices) and the backend refuses anything else, which
    // means a hand-edited show file cannot inject a comparison the window would not have offered. The
    // case that started this: a source with the parameter `Name` and the comparator "rises above -20",
    // which the console could never satisfy (`>` on text is always false) while the app called the
    // macro configured.

    /// The catalogue entry for a parameter: its value rules (kind, range, unit, closed list, length,
    /// how it is written) and whether the console **reports** it.
    ///
    /// Both views of the catalogue are searched, because a category may carry a parameter in only
    /// one of them. `show`'s `scene_index` and `scene_action` are writable and are not reported, so
    /// they appear in [`target_parameters_for_category`] alone; a caller that writes a value (the
    /// step preflight's range and closed-list check) needs exactly those entries, and the caller that
    /// watches asks `can_trigger` — [`watch_problem`], [`watch_operators`] and
    /// [`default_comparison_value`] all do, so an entry the console does not report is still refused
    /// as a watch however it was found.
    pub fn watch_rule(category: &str, parameter: &str) -> Option<TargetParameterInfo> {
        let category = normalize_category(category);
        let parameter = normalize_parameter(parameter);
        target_parameters_for_category(&category)
            .into_iter()
            .chain(trigger_parameters_for_category(&category))
            .find(|candidate| candidate.key == parameter)
    }

    /// Why a parameter cannot be the target of a **step**, or `None` when it can be one.
    ///
    /// [`watch_rule`] is the union of both catalogue views, because a caller that writes has to find
    /// a write-only key and a caller that watches has to find a read-only one. A step writes, so it
    /// needs the *target* list: the six `$` rows of the solo node, the four AES50 health leaves and
    /// the whole of `deskstatus` and `cards` are watches on every model, and `monitor_level`
    /// (`/cfg/mon/<n>/$lvl`) is a watch on the full-size WING and on the Rack (footnote 13, and the
    /// Rack measurement of 2026-09-27). The editor never
    /// offers one of them as a step, and this is what refuses a hand-edited show file that names one
    /// — without it the address resolves, the macro arms, the console ignores the write and the app
    /// reports success.
    ///
    /// This is the answer for a desk whose model is not known, so it refuses a model-restricted write
    /// instead of granting it: ask [`target_problem_for_model`] with the model the console announced
    /// at discovery to get the answer for that desk.
    ///
    /// An unknown key returns `None`: a parameter the catalogue does not know is not this rule's
    /// business (a raw custom address never reaches it, and the dead `load_snapshot` entries resolve
    /// to no address at all).
    pub fn target_problem(category: &str, parameter: &str) -> Option<String> {
        target_problem_for_model(category, parameter, DeskModel::Unknown)
    }

    /// Why a parameter cannot be the target of a step **on this desk**, or `None` when it can be.
    ///
    /// The model changes exactly one answer in the catalogue — the monitor bus level, which footnote
    /// 13 (1357-1359) leaves read-only on the full-size WING and gives to the devices whose surface
    /// has no control potentiometer, and which a WING Rack was measured to ignore on 2026-09-27,
    /// leaving the Compact the only model the write is offered on — and an unannounced model takes
    /// the conservative one.
    pub fn target_problem_for_model(
        category: &str,
        parameter: &str,
        model: DeskModel,
    ) -> Option<String> {
        let category = normalize_category(category);
        let parameter = normalize_parameter(parameter);
        let catalogue = catalogue_target_parameters(&category);
        if let Some(entry) = catalogue.iter().find(|candidate| candidate.key == parameter) {
            if write_allowed_on_model(entry, model) {
                return None;
            }
            // The leaf is documented and the write is real; what refuses it is this desk's surface
            // (or, on the Rack, what the desk answered when the write was tried).
            if model.is_known() {
                return Some(match model {
                    DeskModel::Rack => format!(
                        "{parameter} is read-only on the {}: footnote 13 gives the write to the devices whose surface has no control potentiometer, but this model was measured to ignore every spelling of it (2026-09-27), so a macro can watch it or test it in an IF gate but cannot set it",
                        model.label()
                    ),
                    _ => format!(
                        "{parameter} is read-only on the {}: the document gives the write to the models whose surface has no control potentiometer (footnote 13), so a macro can watch it or test it in an IF gate but cannot set it",
                        model.label()
                    ),
                });
            }
            return Some(format!(
                "{parameter} is read-only until the desk's model is known: footnote 13 gives the write to the models whose surface has no control potentiometer and withholds it from the full-size WING, and the one model left that takes it is the Compact, so this step needs a discovery probe against the console before it can be offered"
            ));
        }
        if trigger_parameters_for_category(&category)
            .iter()
            .any(|candidate| candidate.key == parameter)
        {
            return Some(format!(
                "{parameter} is read-only: the console reports it and takes no write, so a macro can watch it or test it in an IF gate but cannot set it"
            ));
        }
        None
    }

    /// The comparators that make sense for this parameter, in the order the editor shows them.
    pub fn watch_operators(category: &str, parameter: &str) -> &'static [&'static str] {
        match watch_rule(category, parameter) {
            // A parameter the console does not report offers no comparator at all, even though its
            // entry carries a value kind: the entry describes the leaf — `scene_index` is a whole
            // number, `load_snapshot` is text — and that is not a watch.
            Some(rule) if rule.can_trigger => operators_for_value_kind(rule.value_kind),
            _ => &[],
        }
    }

    /// True when this parameter can be ramped: a fade writes a series of numbers, so only a leaf the
    /// console takes as a number can accept one.
    ///
    /// It takes the whole catalogue entry, not a `value_kind` string, because two fields decide the
    /// answer and a caller that supplies one of them will get it wrong:
    ///   * the value kind, because an on/off, a name or a model is not a number at all;
    ///   * the **argument kind**, because a leaf Maillot documents as `I` takes an OSC integer. A
    ///     whole-number parameter deliberately keeps the `number` value kind so the operator still
    ///     gets the ordered comparators, but a fade across a colour (1…18), an icon index, a
    ///     compressor knee in whole dB or an output source index is meaningless — and the write it
    ///     would send is `,f` where the console expects `,i`.
    ///
    /// The whitelist is on `arg_kind` on purpose: a new entry that forgets to declare how it is
    /// written is not offered a fade by default. Faders, trims, frequencies and times all carry
    /// `float`, so they keep their fade.
    pub fn watch_value_is_continuous(rule: &TargetParameterInfo) -> bool {
        value_is_continuous(rule.value_kind, rule.arg_kind)
    }

    pub fn value_is_continuous(value_kind: &str, arg_kind: &str) -> bool {
        arg_kind == "float"
            && matches!(
                value_kind,
                "db_meter" | "db" | "number" | "hz" | "ms" | "percent"
            )
    }

    /// The domain a fade interpolates in for one target, as Maillot documents the leaf.
    ///
    /// A fade writes a series of values between two endpoints, and *how* it moves between them is the
    /// leaf's own property: the appendix spells a numeric row `linf [-15, 15, 301]` (a constant offset
    /// per step) or `logf [20, 20000, 961]` (a constant ratio). Interpolating by offset a leaf the
    /// console documents by ratio puts almost the whole sweep in the last fraction of the ramp — a
    /// 20 Hz → 20 kHz linear fade has already reached 10 kHz at the halfway point — which is what the
    /// owner heard as "a fade to an EQ band does not work": the parameter moved, and it moved wrongly.
    ///
    /// The answer is the leaf's, so it is read from the table that documents the leaf, in this order:
    ///   * a leaf that belongs to a model slot (`/eq/1f` is the STD EQ's, `/gate/rel` is whatever model
    ///     that strip's gate runs) is answered by that model's appendix row. Every table that carries
    ///     the name must agree on `logf`; a name some tables document `linf` and others `logf` (the
    ///     release of `GATE` at 8217 against the `DUCK` one at 8230) falls back to linear, which still
    ///     lands on both endpoints. A model that is not known leaves every candidate table in play, so
    ///     the answer is the one they agree on.
    ///   * anything else is answered by its value kind plus the three families the kind cannot express
    ///     (see [`fade_domain_for_value_kind`]).
    ///   * a raw custom address, or a key nothing documents, is linear.
    ///
    /// The endpoints are the same in either domain, so a wrong answer here can never change *what* a
    /// fade arrives at — only the shape of the way there.
    pub fn fade_domain(category: &str, parameter: &str, model: Option<&str>) -> FadeDomain {
        let category = normalize_category(category);
        let parameter = normalize_parameter(parameter);
        let scoped = if parameter.contains(':') {
            parameter
                .split_once(':')
                .filter(|(_, name)| !name.trim().is_empty())
                .map(|(section, name)| (section.trim().to_string(), name.trim().to_string()))
        } else {
            model_leaf_name(&category, &parameter)
                .map(|(section, name)| (section.to_string(), name.to_string()))
        };
        if let Some((section, name)) = scoped {
            if let Some(rule) = model_parameter_rule(&section, &name, model) {
                if rule.logarithmic {
                    return FadeDomain::Logarithmic;
                }
                // The models agree on what the value is, and it is not a `logf` row: the table's own
                // `linf`/`fader` is the answer. When they disagree the rule carries `text` and no
                // range — the name means different things on different tables — and the catalogue's
                // own row is then the only common ground.
                if rule.value_kind != "text" {
                    return FadeDomain::Linear;
                }
            }
        }
        match watch_rule(&category, &parameter) {
            Some(rule) => fade_domain_for_value_kind(rule.value_kind, &parameter),
            None => FadeDomain::Linear,
        }
    }

    /// The half of [`fade_domain`] that a value kind alone can answer.
    ///
    /// Three families need naming beyond the kind, and each is read off the appendix:
    ///   * a frequency is `logf` on every table that prints one (`lf`/`1f`/`hf` at 8615-8632, the
    ///     filter's `hpf`/`lpf` at 6990-6994, the sidechain rows at 6911/7013), and the oscillator's
    ///     `/io/in/OSC/<n>/osc/f` (1793) carries no appendix table at all — the window's own frequency
    ///     slider has been logarithmic since the first port, so `hz` is logarithmic everywhere here.
    ///   * a Q (`lq`, `1q`…`6q`, `hq`, the sidechain `q`) is `logf [0.442, 10, 181]` on every table
    ///     that prints one (8616, 8620, 8632).
    ///   * a release time is the one `ms` row the appendix documents `logf` (GATE 8217, COMP 8377); the
    ///     attack and hold of the same tables are `linf` (8215-8216, 8375-8376), so the key's own name
    ///     is what separates them and not the unit.
    ///
    /// Everything else moves by offset: every dB row, every percentage, every attack, hold and delay.
    fn fade_domain_for_value_kind(value_kind: &str, parameter: &str) -> FadeDomain {
        match value_kind {
            "hz" => FadeDomain::Logarithmic,
            "number" if parameter.ends_with("_q") => FadeDomain::Logarithmic,
            "ms" if parameter.ends_with("_release") => FadeDomain::Logarithmic,
            _ => FadeDomain::Linear,
        }
    }

    /// The range a fade's two endpoints are held to: the leaf's own documented range.
    ///
    /// A fade interpolates between two values of one leaf, so endpoints the leaf cannot hold push part
    /// of the ramp outside the parameter: the console clamps every write there, the value sits still
    /// for that fraction of the ramp, and the audible move is squeezed into what is left. Holding the
    /// endpoints to the documented range first makes the ramp cross the span the parameter really has
    /// — a `-60 → 0` fade of an EQ gain (`±15` dB, 8618) becomes `-15 → 0`, which is the fade the
    /// operator asked for — and it is the same range the editor's own field rule refuses a value
    /// outside of, so the two cannot disagree.
    ///
    /// `None` when nothing documents a range: a raw custom address, or a key whose range the catalogue
    /// does not carry. The caller then keeps whatever sanity bound it applies to every value.
    pub fn fade_value_range(
        category: &str,
        parameter: &str,
        model: Option<&str>,
    ) -> Option<(f32, f32)> {
        let category = normalize_category(category);
        let parameter = normalize_parameter(parameter);
        if parameter.contains(':') {
            let (section, name) = parameter.split_once(':')?;
            let rule = model_parameter_rule(section, name, model)?;
            return finite_range(rule.min, rule.max);
        }
        if let Some((section, name)) = model_leaf_name(&category, &parameter) {
            // A catalogue key that resolves into a model slot: the strip's model decides the range
            // when the strip's table carries the name. A model that does not carry it, or none that
            // was read, leaves the catalogue's documented range, which is the STD row.
            if let Some(rule) = model_parameter_rule(section, name, model) {
                if rule.model.is_some() {
                    if let Some(range) = finite_range(rule.min, rule.max) {
                        return Some(range);
                    }
                }
            }
        }
        let rule = watch_rule(&category, &parameter)?;
        finite_range(rule.min, rule.max)
    }

    fn finite_range(min: f32, max: f32) -> Option<(f32, f32)> {
        (min.is_finite() && max.is_finite() && min < max).then_some((min, max))
    }

    /// Why this comparison cannot be watched as it stands, or `None` when it is valid.
    ///
    /// `value` is the comparison value as the operator typed it: a number for meters and numeric
    /// state, `0`/`1` for an on/off parameter, the text itself for a name or a model.
    ///
    /// A `section:name` target (`gate:1-thr`, `fx:lc`) has no catalogue row — the name exists only for
    /// the model the strip or slot runs — so its rules come from the appendix table of that model (see
    /// [`model_parameter_rule`]). Every row of the appendix is an ordinary published leaf (not one
    /// carries the document's `[RO]`), which is why such a target can be watched at all.
    pub fn watch_problem(
        category: &str,
        parameter: &str,
        operator: &str,
        value: &str,
    ) -> Option<String> {
        let (rule, reported) = match watch_rule(category, parameter) {
            Some(rule) => (ValueRule::from_catalogue(&rule), rule.can_trigger),
            None => match model_parameter_rule_for_key(category, parameter, None) {
                Some(rule) => (ValueRule::from_model(&rule), true),
                // A key the catalogue does not know and no model documents: refused, as it always was.
                None => {
                    return Some(format!(
                        "{parameter} is not a value the console reports for {category}, so it cannot be watched"
                    ))
                }
            },
        };
        if !reported {
            return Some(format!("{} cannot be watched", rule.label));
        }
        let allowed = operators_for_value_kind(rule.value_kind);
        let operator = operator.trim();
        if !allowed.contains(&operator) {
            return Some(format!(
                "{} is {}, so it cannot be compared with \"{operator}\"; use {}",
                rule.label,
                describe_value_kind(rule.value_kind),
                allowed
                    .iter()
                    .map(|candidate| format!("\"{candidate}\""))
                    .collect::<Vec<_>>()
                    .join(" or ")
            ));
        }
        rule.value_problem(value)
    }

    /// Why this value cannot be written to this parameter, or `None` when it can.
    ///
    /// This is the value half of the one rule table: the kind decides what the value *is* (a number
    /// with a unit and a range, `0`/`1`, the text itself, an entry of a closed list) and the
    /// catalogue carries the documented limits. `watch_problem` calls it after checking the
    /// comparator, and the action path calls it directly — a step writes a value without comparing
    /// anything, and it has to obey exactly the same limits.
    ///
    /// A `section:name` target is judged by the appendix row its model documents, exactly as a
    /// catalogue key is judged by its own entry (`fx:mix` therefore obeys the `0…100` of the table the
    /// slot runs, not a generic idea of "mix").
    pub fn value_problem(category: &str, parameter: &str, value: &str) -> Option<String> {
        let rule = match watch_rule(category, parameter) {
            Some(rule) => ValueRule::from_catalogue(&rule),
            None => match model_parameter_rule_for_key(category, parameter, None) {
                Some(rule) => ValueRule::from_model(&rule),
                None => {
                    return Some(format!(
                        "{parameter} is not a value the console has for {category}"
                    ))
                }
            },
        };
        rule.value_problem(value)
    }

    /// The value-half rules of one parameter, whatever their source: a catalogue entry or a row of the
    /// appendix's per-model tables. `label` and `options` are owned because a model-qualified key's are
    /// built at the call site, and the body below is written once so the two sources can never enforce
    /// different limits.
    struct ValueRule {
        label: String,
        value_kind: &'static str,
        unit: String,
        min: f32,
        max: f32,
        /// Longest value a text parameter takes; 0 = no documented limit.
        max_len: u16,
        options: Vec<String>,
    }

    impl ValueRule {
        fn from_catalogue(rule: &TargetParameterInfo) -> Self {
            Self {
                label: rule.label.to_string(),
                value_kind: rule.value_kind,
                unit: rule.unit.to_string(),
                min: rule.min,
                max: rule.max,
                max_len: rule.max_len,
                options: rule.options.iter().map(|option| (*option).to_string()).collect(),
            }
        }

        fn from_model(rule: &ModelParameterRule) -> Self {
            Self {
                label: rule.label.clone(),
                value_kind: rule.value_kind,
                unit: rule.unit.clone(),
                min: rule.min,
                max: rule.max,
                // The appendix documents no length for a plugin parameter: its values are numbers or
                // entries of a list.
                max_len: 0,
                options: rule.options.clone(),
            }
        }

        fn value_problem(&self, value: &str) -> Option<String> {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                // A mask of spaces is not the same mistake as an empty field, and the document does not
                // say what either writes to a leaf whose value is one character per item (the safes
                // blocks, 4017-4067: `+` safes the item, a space leaves it unprotected). Both are
                // refused; only the wording tells them apart.
                if self.value_kind == "text" && !value.is_empty() {
                    return Some(format!(
                        "{} takes one character per item (`+` or space): a mask of spaces is not the documented way to protect nothing",
                        self.label
                    ));
                }
                return Some(format!("{} needs a value", self.label));
            }
            let value = trimmed;
            if self.value_kind == "toggle" {
                return match value {
                    "0" | "1" => None,
                    other => Some(format!(
                        "{} is on/off, so it takes 0 or 1 (not \"{other}\")",
                        self.label
                    )),
                };
            }
            if matches!(self.value_kind, "text" | "enum") {
                if !self.options.is_empty() && !self.options.iter().any(|option| option == value) {
                    return Some(format!(
                        "{} must be one of {}",
                        self.label,
                        self.options.join(", ")
                    ));
                }
                if self.max_len > 0 && value.chars().count() > self.max_len as usize {
                    return Some(format!(
                        "{} takes at most {} characters",
                        self.label, self.max_len
                    ));
                }
                return None;
            }
            let Ok(number) = value.parse::<f32>() else {
                return Some(format!(
                    "{} needs a number (you wrote \"{value}\")",
                    self.label
                ));
            };
            if !number.is_finite() {
                return Some(format!("{} needs a finite number", self.label));
            }
            if self.min.is_finite() && number < self.min {
                return Some(format!(
                    "{} has a minimum of {}{}",
                    self.label,
                    trim_number(self.min),
                    unit_suffix(&self.unit)
                ));
            }
            if self.max.is_finite() && number > self.max {
                return Some(format!(
                    "{} has a maximum of {}{}",
                    self.label,
                    trim_number(self.max),
                    unit_suffix(&self.unit)
                ));
            }
            None
        }
    }

    /// One sentence describing a value kind, for the messages the operator reads.
    pub fn describe_value_kind(value_kind: &str) -> &'static str {
        match value_kind {
            "db_meter" => "a meter level in dB",
            "db" => "a level in dB",
            "number" => "a number",
            "hz" => "a frequency in Hz",
            "ms" => "a time in milliseconds",
            "percent" => "a percentage",
            "toggle" => "on or off",
            "enum" => "one of a fixed list",
            "text" => "text",
            _ => "a value",
        }
    }

    fn unit_suffix(unit: &str) -> String {
        if unit.is_empty() {
            String::new()
        } else {
            format!(" {unit}")
        }
    }

    fn trim_number(value: f32) -> String {
        if (value - value.round()).abs() < f32::EPSILON {
            format!("{}", value.round() as i64)
        } else {
            format!("{value}")
        }
    }

    /// How a category writes the id between its OSC prefix and its parameter leaf.
    ///
    /// Every category but three puts the index there (`/ch/1/mute`, `/$ctl/user/1/4/bu/mode`), and
    /// the resolver used to build `{prefix}/{id}{leaf}` for all of them. Two shapes do not fit:
    ///
    ///   * show control has no index dimension at all: the documented path is `/$ctl/lib/$action`,
    ///     and `/$ctl/lib/1/$action` is a path the console ignores (which the app would have
    ///     reported as a successful write);
    ///   * talkback names its two entries by letter: the documented path is `/cfg/talk/A/$on`, and
    ///     `/cfg/talk/1/$on` is a path the console ignores just the same.
    ///
    /// The shape is named here rather than special-cased in the resolver because the next category
    /// needs a third kind of segment — `layer` (batch 4) is `/$ctl/layer/<L|C|R|CMPCT|RCK|EXT|VRT>/sel`
    /// — so a new shape is one more variant of this enum, one more arm in [`id_segment_for_category`]
    /// and one more entry in the test that enumerates them, and no change to any caller.
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub enum CategoryIdSegment {
        /// The ordinary case: the id itself between prefix and leaf (`/ch/1/mute`).
        Index,
        /// The id's **letter**: `A` for 1, `B` for 2 (`/cfg/talk/A/$on`). The alphabet belongs to the
        /// category ([`id_letter_for_category`]) and an id it has no letter for resolves to nothing,
        /// so a numeric segment the console ignores can never be built.
        Letter,
        /// No segment at all: the prefix is followed directly by the leaf (`/$ctl/lib/$action`).
        Absent,
    }

    /// The id segment a category builds its addresses with — the one place the shape is decided.
    ///
    /// It is asked by [`resolve_basic_addresses`] (through [`id_segment_for_category`]), by
    /// [`category_has_id`] and by the show-control and GPIO leaf tables, so a category cannot be
    /// index-less in one of those places and indexed in another.
    pub fn category_id_segment(category: &str) -> CategoryIdSegment {
        match normalize_category(category).as_str() {
            // The index-less categories of the catalogue. Show control (Maillot 4105-4126) sits on
            // `/$ctl/lib` and the I/O node (1592-1594) on `/io`, and in both the leaves are the
            // parameters themselves: `/io/altsw` has no index dimension at all. The USB recorder
            // (3068-3075), the USB player (3045-3066) and the console-status node (3095-3097) are
            // the same shape: `/rec/$action`, `/play/$action` and `/$ctl/$stat/selidx`.
            "show" | "showstate" | "io" | "rec" | "recstate" | "play" | "playstate" | "stat" => {
                CategoryIdSegment::Absent
            }
            // Batch 6 adds six more index-less nodes, and they are all of the same kind: the leaves
            // are the whole address after the prefix (`/$ctl/cfg/lights/leds`, 3128-3145;
            // `/$ctl/safes/ch`, 4016-4067; `/cfg/solo/mode`, 1380-1394; `/$stat/lock`, 1274-1275;
            // `/cards/$type`, 2951-2954; `/$globals/clkrate`, 4168-4186). None of them has an id
            // dimension, so an id the editor happens to hold never reaches the path.
            "lights" | "safes" | "solocfg" | "deskstatus" | "cards" | "globals" => {
                CategoryIdSegment::Absent
            }
            // Talkback (Maillot 1460-1534): `/cfg/talk/A/…` and `/cfg/talk/B/…`; the fader layers
            // (3219-3644): `/$ctl/layer/L/sel` … `/$ctl/layer/VRT/sel`; the AES50 status (1254-1272):
            // `/$stat/A/stat` … `/$stat/C/stat`.
            "talk" | "layer" | "aes50" => CategoryIdSegment::Letter,
            _ => CategoryIdSegment::Index,
        }
    }

    /// The letter a [`CategoryIdSegment::Letter`] category prints in place of its id, or `None` when
    /// that id names no entry of the category.
    ///
    /// The alphabet is per category on purpose, because the two are not the same shape. Talkback
    /// has two entries, `A` for id 1 and `B` for id 2 (Maillot 1460, 1498); the fader layers are
    /// `L`, `C`, `R`, `CMPCT`, `RCK`, `EXT` and `VRT` (3220, 3299, 3381, 3456, 3523, 3585, 3645),
    /// which do not fit a single character — hence a string and not a `char`. The AES50 status node
    /// is the third: `/$stat/A`, `/B` and `/C` (1253, 1260, 1267).
    ///
    /// `None` is what keeps the resolver honest: an id a letter category has no letter for is not
    /// rendered as its number (`/cfg/talk/3/$on` would be a path the console ignores while the app
    /// reported success), it resolves to no address at all.
    fn id_letter_for_category(category: &str, id: u16) -> Option<&'static str> {
        match category {
            "talk" => match id {
                1 => Some("A"),
                2 => Some("B"),
                _ => None,
            },
            // The fader layers (3220, 3299, 3381, 3456, 3523, 3585, 3645), in the document's node
            // order: 1 = L, 2 = C, 3 = R, 4 = CMPCT, 5 = RCK, 6 = EXT, 7 = VRT. An eighth id names no
            // surface and resolves to nothing rather than to `/$ctl/layer/8/sel`.
            "layer" => usize::from(id)
                .checked_sub(1)
                .and_then(|index| FADER_LAYER_LETTERS.get(index).copied()),
            // The three AES50 ports (1253, 1260, 1267), in the document's order. A fourth id names
            // no port: `/$stat/D/stat` is not a path the console has, so it resolves to nothing
            // rather than to a numeric `/$stat/4/stat` the console would ignore in silence.
            "aes50" => match id {
                1 => Some("A"),
                2 => Some("B"),
                3 => Some("C"),
                _ => None,
            },
            _ => None,
        }
    }

    /// The segment itself, ready to concatenate between a prefix and a leaf: `/1` in the ordinary
    /// case, `/A` for talkback, an empty string for an index-less category, and `None` when a letter
    /// category has no letter for that id.
    fn id_segment_for_category(category: &str, id: u16) -> Option<String> {
        match category_id_segment(category) {
            CategoryIdSegment::Index => Some(format!("/{id}")),
            CategoryIdSegment::Letter => {
                id_letter_for_category(category, id).map(|letter| format!("/{letter}"))
            }
            CategoryIdSegment::Absent => Some(String::new()),
        }
    }

    /// True when a category carries the given flag in `TARGET_CATEGORIES`.
    ///
    /// The category (not the individual entry) decides what may be targeted and what may be watched:
    /// `show` and `showstate` are one node split in two for exactly this reason.
    fn category_can_target(category: &str) -> bool {
        TARGET_CATEGORIES
            .iter()
            .any(|info| info.key == category && info.can_target)
    }

    fn category_can_trigger(category: &str) -> bool {
        TARGET_CATEGORIES
            .iter()
            .any(|info| info.key == category && info.can_trigger)
    }

    /// True when the family really has that index. `TARGET_CATEGORIES` carries the documented count
    /// (channels 1-40, USB 1-48…): resolving `/ch/999/mute` produced a path the console ignores while
    /// the app reported success, and a meter trigger on index 999 could never match an event.
    pub fn category_has_id(category: &str, id: u16) -> bool {
        let category = normalize_category(category);
        // An index-less category has no index dimension: its one entry is what any id the caller
        // holds refers to, because the id never reaches the address. The editor's id field is
        // normally empty for these, and `resolve_basic_addresses` injects the single entry itself.
        if category_id_segment(&category) == CategoryIdSegment::Absent {
            return true;
        }
        id > 0 && TARGET_CATEGORIES.iter().any(|info| {
            (info.key == category || normalize_category(info.key) == category)
                && id <= info.count
        })
    }

    /// The highest id this category really has **on this desk**.
    ///
    /// Almost every category is the same on every model of the family — forty channels, sixteen
    /// buses, eight matrices — and its count is the documented one. Two are not, and the document
    /// says so itself:
    ///
    ///   * the **local inputs**, of which a full-size WING has 8 where a Rack and a Compact have 24
    ///     (344, 402, 421, 448), footnote 17 (1641) spelling out the consequence: *"All 24 local
    ///     inputs may not be available depending on the console model"*;
    ///   * the **GPIOs**, four on the full-size console and the Rack (408, 433) and two on a Compact
    ///     (453; footnote 122 at 11536).
    ///
    /// A desk that has announced no model is answered with the documented maximum, so the catalogue
    /// does not shrink because an answer is missing — but a named model narrows it, which is what
    /// keeps a step off `/io/in/LCL/20/g` on a console that has no input 20 (a write the console
    /// ignores in silence while the app reports success).
    pub fn category_id_limit_for_model(category: &str, model: DeskModel) -> u16 {
        let category = normalize_category(category);
        let documented = TARGET_CATEGORIES
            .iter()
            .find(|info| info.key == category)
            .map(|info| info.count)
            .unwrap_or(0);
        match category.as_str() {
            "preamp_local" => model.local_inputs().unwrap_or(documented),
            // `gpio` and `gpiostate` are the two halves of one node: both bound their ids the same
            // way, and `gpio_count` answers the documented four for a model that has not spoken.
            "gpio" | "gpiostate" => model.gpio_count(),
            _ => documented,
        }
    }

    /// True when the family really has that index on this desk; see [`category_id_limit_for_model`].
    pub fn category_has_id_for_model(category: &str, id: u16, model: DeskModel) -> bool {
        let category = normalize_category(category);
        if category_id_segment(&category) == CategoryIdSegment::Absent {
            return true;
        }
        id > 0 && id <= category_id_limit_for_model(&category, model)
    }

    /// Why the ids of a step do not exist on this desk, or `None` when they do.
    ///
    /// Only the two categories the document sizes by model can answer `Some`: every other count is
    /// the family's, and a desk that has announced no model is answered with the documented maximum
    /// (the caller's own bounds handle a genuinely out-of-range id there). The point is the named
    /// model: `/io/in/LCL/20/g` on a full-size console, or GPIO 3 on a Compact, build a path the
    /// console ignores while the app reports success — the defect class this catalogue exists to
    /// close.
    pub fn model_id_problem(category: &str, ids: &str, model: DeskModel) -> Option<String> {
        if !model.is_known() {
            return None;
        }
        let category = normalize_category(category);
        let entry = TARGET_CATEGORIES.iter().find(|info| info.key == category)?;
        let limit = category_id_limit_for_model(&category, model);
        if limit >= entry.count {
            return None;
        }
        let out_of_range = parse_ids(ids, 256)
            .into_iter()
            .filter(|id| *id > limit)
            .collect::<Vec<_>>();
        if out_of_range.is_empty() {
            return None;
        }
        let numbers = out_of_range
            .iter()
            .map(u16::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        let reason = match category.as_str() {
            "preamp_local" => "the document sizes the local inputs by model (Maillot 344, 402, 421 and footnote 17 at 1641)",
            "gpio" | "gpiostate" => "the GPIO node prints four entries and a Compact has two (Maillot 4010, 453 and footnote 122 at 11536)",
            _ => "this desk does not have that entry",
        };
        Some(format!(
            "{} {numbers} does not exist on a {}, which has {limit}: {reason}, so the console would ignore the write",
            entry.label,
            model.label()
        ))
    }

    pub fn resolve_basic_addresses(target: &BasicTargetSpec) -> Vec<String> {
        let category = normalize_category(&target.category);
        let parameter = normalize_parameter(&target.parameter);

        if parameter == "load_snapshot" {
            // Snapshot and preset loading is a console filesystem operation over
            // the snapshot JSON (`global/snapshots`, `global/ch_presets`,
            // `global/fx_presets`, `global/routing_presets`), not an OSC leaf.
            // `/show/load` and `/library/load` are silent on the console, so they
            // fail closed here instead of producing a write that is ignored.
            return Vec::new();
        }
        if parameter == "load_preset" {
            return Vec::new();
        }

        if category == "custom" {
            return target
                .custom_address
                .as_deref()
                .map(str::trim)
                .filter(|address| address.starts_with('/'))
                .map(|address| vec![address.to_string()])
                .unwrap_or_default();
        }

        // The id list. An index-less category has one entry and no id in its path, so the list the
        // editor holds — often empty, because there is no id field to fill — is not part of the
        // question: injecting the single entry keeps the rest of this function (the meter branch and
        // every id bound) on one path instead of a second early return. `parse_ids("")` failing
        // closed on `/$ctl/lib/$action` was exactly the trap this avoids.
        let ids = match category_id_segment(&category) {
            CategoryIdSegment::Absent => vec![1],
            // A letter category is addressed by the same id the editor holds — talk's entries are
            // 1 and 2 — and the letter is the *rendering* of that id, not a second id space. Only
            // the address changes (`/cfg/talk/A/…`), never the bound (`category_has_id` still uses
            // the category's count).
            CategoryIdSegment::Index | CategoryIdSegment::Letter => parse_ids(&target.ids, 256),
        };
        if ids.is_empty() {
            return Vec::new();
        }

        if is_meter_parameter(&parameter) {
            let ids = ids
                .into_iter()
                .filter(|id| category_has_id(&category, *id))
                .collect::<Vec<_>>();
            return resolve_meter_addresses(&category, &parameter, &ids);
        }

        let Some(prefix) = prefix_for_category(&category) else {
            return Vec::new();
        };
        let Some(param) = param_for_category(&category, &parameter, target.send_id) else {
            return Vec::new();
        };

        ids.into_iter()
            .filter(|id| category_has_id(&category, *id))
            // Maillot footnote 38 (`scratch/wing_protocols.txt:2528`): "Sending bus 'n' to bus 'n' is
            // not possible… trying to enable `/bus/1/send/1/on` will be ignored". Building the
            // address anyway produced a write the console dropped while the macro said completed.
            // It applies to every bus-to-bus send leaf, `pre` included.
            .filter(|id| {
                !(category == "bus"
                    && matches!(
                        parameter.as_str(),
                        "send_level" | "send_on" | "send_pre"
                    )
                    // Compare in the wider type: `id as u8` wraps, so a bus id above 255 would compare
                    // equal to an unrelated send id (audit 2026-10-02, L2 — the desktop path already made
                    // this change for the same reason).
                    && target.send_id.map(u16::from) == Some(*id))
            })
            // The id segment: `/1` ordinarily, `/A` for talkback, nothing at all where the category
            // has no index. A letter category that has no letter for this id answers `None` here, so
            // the id resolves to no address instead of to a numeric segment the console ignores.
            .filter_map(|id| {
                let segment = id_segment_for_category(&category, id)?;
                Some(format!("{prefix}{segment}{param}"))
            })
            .collect()
    }

    pub fn parse_ids(ids: &str, max: usize) -> Vec<u16> {
        let clean = ids.trim();
        if clean.is_empty() {
            return Vec::new();
        }

        let mut out = Vec::new();
        for item in clean.split(',') {
            if out.len() >= max {
                break;
            }
            let item = item.trim();
            if item.is_empty() {
                continue;
            }
            if let Some((start, end)) = item.split_once('-') {
                if let (Ok(start), Ok(end)) =
                    (start.trim().parse::<u16>(), end.trim().parse::<u16>())
                {
                    for id in start.min(end)..=start.max(end) {
                        if id > 0 && !out.contains(&id) {
                            if out.len() >= max {
                                break;
                            }
                            out.push(id);
                        }
                    }
                }
            } else if let Ok(id) = item.parse::<u16>() {
                // The single-id branch has to honour `max` too: a comma-separated list of loose ids
                // could otherwise grow past the caller's cap.
                if id > 0 && out.len() < max && !out.contains(&id) {
                    out.push(id);
                }
            }
        }
        out
    }

    pub fn resolve_meter_targets(target: &BasicTargetSpec) -> Vec<ResolvedMeterTarget> {
        resolve_meter_targets_for_model(target, DeskModel::Unknown)
    }

    /// [`resolve_meter_targets`] for a desk whose model is known.
    ///
    /// The difference is the id bound: Maillot's footnote 17 (1641) says *"All 24 local inputs may not
    /// be available depending on the console model"*, so a trigger on Local 12 of a full-size desk is a
    /// meter the console never sends and the bound has to come from the model rather than from the
    /// family maximum.
    pub fn resolve_meter_targets_for_model(
        target: &BasicTargetSpec,
        model: DeskModel,
    ) -> Vec<ResolvedMeterTarget> {
        let category = normalize_category(&target.category);
        let parameter = normalize_parameter(&target.parameter);
        let ids = parse_ids(&target.ids, 256);
        if ids.is_empty() || !is_meter_parameter(&parameter) {
            return Vec::new();
        }
        let ids = ids
            .into_iter()
            .filter(|id| meter_id_allowed_for_model(&category, *id, model))
            .collect::<Vec<_>>();
        resolve_meter_target_specs(&category, &parameter, &ids, DeskModel::Unknown)
    }

    /// The highest index the family really has a meter for.
    ///
    /// `resolve_basic_addresses` bounds every write with `category_has_id`; the meter path only
    /// filtered through the `u8` conversion, so a hand-edited show could ask for channel 100: the
    /// address came out well formed, the resolve preflight saw it as non-empty, and the trigger
    /// could never match an event (macro audit of 2026-09-24, item A2).
    ///
    /// It is not always `TARGET_CATEGORIES`' count: `preamp_bus`, `preamp_main` and `preamp_matrix`
    /// are meter-only source groups whose *target* count is 32/8/16 while their **meter** space is
    /// the same, and every other source and output group takes its size from the hardware the
    /// console reports, so the bound comes from the meter tables themselves. `monitor` and `rta`
    /// bound their own spaces (six monitor meters, 120 RTA bands, Maillot table 5).
    ///
    /// This is the bound for a desk whose model is not known: the documented maximum, so nothing the
    /// catalogue offers today disappears. [`meter_id_allowed_for_model`] narrows the two groups the
    /// document sizes by model.
    fn meter_id_allowed_for_model(category: &str, id: u16, model: DeskModel) -> bool {
        if source_device_id(category).is_some() || output_device_id(category).is_some() {
            // The meter space is the device's, not the target count: `output_usbrec` has four
            // meters while the phrase "USB recorder" alone would suggest more, and `preamp_bus`
            // carries 32 meters while a bus *target* on the same strip is a different thing.
            let count = match (source_device_id(category), output_device_id(category)) {
                // Local inputs are the one group the document sizes by model (footnote 17), and the
                // local outputs follow `/io/out/LCL/1 N 1..8` on every model (1843).
                (Some(1), _) => model
                    .local_inputs()
                    .map(usize::from)
                    .unwrap_or_else(|| crate::meters::source_device_meter_count(1)),
                (_, Some(1)) => model
                    .local_outputs()
                    .map(usize::from)
                    .unwrap_or_else(|| crate::meters::output_device_meter_count(1)),
                (Some(device_id), _) => crate::meters::source_group_words(model, device_id)
                    .unwrap_or_else(|| crate::meters::source_device_meter_count(device_id)),
                (_, Some(device_id)) => crate::meters::output_group_words(model, device_id)
                    .unwrap_or_else(|| crate::meters::output_device_meter_count(device_id)),
                _ => 0,
            };
            return id > 0 && usize::from(id) <= count;
        }
        match category {
            "monitor" => (1..=6).contains(&id),
            "rta" => (1..=120).contains(&id),
            // The GPIO node's bound is the model's, but this function only sees the meter path and
            // `gpio` has no meter: the id bound that reaches it is `category_id_limit_for_model`,
            // which the step, trigger and gate validators and the catalogue DTO all use.
            _ => category_has_id(category, id),
        }
    }

    pub fn meter_descriptors_for_target(target: &BasicTargetSpec) -> Vec<MeterDescriptor> {
        meter_descriptors_for_target_for_model(target, DeskModel::Unknown)
    }

    /// [`meter_descriptors_for_target`] for a desk whose model is known: the id bound is the desk's
    /// and every source and output group carries the word count the model gives it
    /// ([`MeterDescriptor::source_for_model`]), which is what keeps a datagram aligned group by group.
    pub fn meter_descriptors_for_target_for_model(
        target: &BasicTargetSpec,
        model: DeskModel,
    ) -> Vec<MeterDescriptor> {
        let category = normalize_category(&target.category);
        let parameter = normalize_parameter(&target.parameter);
        let ids = parse_ids(&target.ids, 256);
        if ids.is_empty() || !is_meter_parameter(&parameter) {
            return Vec::new();
        }

        // The bound is checked before the family dispatch, because the families that answer a meter
        // with no per-index payload (`monitor`, `rta`, a source or an output device) would otherwise
        // accept `/meters/preamp/bus/33` or a channel 100 exactly as the trigger path did.
        let ids = ids
            .into_iter()
            .filter(|id| meter_id_allowed_for_model(&category, *id, model))
            .filter_map(|id| u8::try_from(id).ok())
            .collect::<Vec<_>>();
        if ids.is_empty() {
            return Vec::new();
        }
        if let Some(device_id) = source_device_id(&category) {
            // The model sizes the group (`0xa7`), and an unannounced model leaves the length
            // unsettled rather than assumed: see `MeterDescriptor::source_for_model`.
            return vec![MeterDescriptor::source_for_model(model, device_id)];
        }
        if let Some(device_id) = output_device_id(&category) {
            return vec![MeterDescriptor::output_for_model(model, device_id)];
        }
        if category == "monitor" {
            return vec![MeterDescriptor::indexed(
                MeterFamily::Monitor,
                Vec::<u8>::new(),
            )];
        }
        if category == "rta" {
            return vec![MeterDescriptor::indexed(MeterFamily::Rta, Vec::<u8>::new())];
        }
        if let Some((family, _family_label, _slot)) =
            v2_meter_family_and_slot(&category, &parameter)
        {
            return vec![MeterDescriptor::indexed(family, ids)];
        }
        if let Some(family) = mix_family(&category).or_else(|| special_meter_family(&category)) {
            return vec![MeterDescriptor::indexed(family, ids)];
        }

        Vec::new()
    }

    fn normalize_category(category: &str) -> String {
        let trimmed = category.trim();
        // A key of the catalogue is never an alias. `play` used to be a shorthand for the USB player
        // *input* source (`preamp_usbplayer`, `/io/in/PLAY`) and is now the USB player transport node
        // (`/play/$action`, 3045-3066): without this guard the alias arm below would answer
        // `preamp_usbplayer` for the new category, and every transport key would resolve through the
        // source tables to nothing. The guard makes the rule hold for the next name that collides as
        // well, instead of only for this one.
        if TARGET_CATEGORIES.iter().any(|info| info.key == trimmed) {
            return trimmed.to_string();
        }
        match trimmed {
            "card" | "crd" | "dante" | "dante_card" | "preamp_expansion" | "preamp_wlive" => {
                "preamp_card".to_string()
            }
            "module" | "mod" | "dante_module" => "preamp_module".to_string(),
            "local" | "lcl" => "preamp_local".to_string(),
            "auxin" | "aux_in" => "preamp_aux".to_string(),
            "stagea" | "aes50a" | "aes50_a" | "preamp_stagea" => "preamp_aes50a".to_string(),
            "stageb" | "aes50b" | "aes50_b" | "preamp_stageb" => "preamp_aes50b".to_string(),
            "stagec" | "aes50c" | "aes50_c" | "preamp_stagec" => "preamp_aes50c".to_string(),
            "stageconnect" | "sc" => "preamp_stageconnect".to_string(),
            // `play` is deliberately absent: it is the USB player transport category now, and a
            // show file that meant the input source has to name `preamp_usbplayer` (or `usbplayer`).
            "usbplayer" => "preamp_usbplayer".to_string(),
            "aes" | "aesebu" => "preamp_aesebu".to_string(),
            "usr" => "usersig".to_string(),
            "osc" => "preamp_oscillator".to_string(),
            "out_card" | "out_crd" | "out_dante" => "output_card".to_string(),
            "out_module" | "out_mod" => "output_module".to_string(),
            "output_stagea" | "out_stagea" | "out_aes50a" => "output_aes50a".to_string(),
            "output_stageb" | "out_stageb" | "out_aes50b" => "output_aes50b".to_string(),
            "output_stagec" | "out_stagec" | "out_aes50c" => "output_aes50c".to_string(),
            "output_local" | "out_local" | "out_lcl" => "output_local".to_string(),
            "output_aux" | "out_aux" => "output_aux".to_string(),
            "output_usb" | "out_usb" => "output_usb".to_string(),
            "output_usbrec" | "out_usbrec" => "output_usbrec".to_string(),
            "output_aesebu" | "out_aes" => "output_aesebu".to_string(),
            other => other.to_string(),
        }
    }

    fn normalize_parameter(parameter: &str) -> String {
        match parameter.trim() {
            "fdr" => "fader".to_string(),
            other => other.to_string(),
        }
    }

    /// The appendix name a catalogue key resolves to inside a model slot, or `None`.
    ///
    /// The value is the leaf's own name in the generated appendix tables, so the caller can ask
    /// [`crate::plugin_models::plugin_model_has_parameter`] whether the model loaded on that strip
    /// really has it. `section:name` targets (`gate:1-thr`) carry the name themselves and need no
    /// map; this exists for the catalogue keys.
    ///
    /// The map is not a second opinion about addresses: a test walks the whole catalogue and requires
    /// `/{section}/{name}` to be exactly [`resolve_basic_addresses`]'s path for the same key, so a
    /// name here that the resolver does not build (or the other way round) fails the build.
    fn model_leaf_name(_category: &str, parameter: &str) -> Option<(&'static str, &'static str)> {
        // The family rule stays in `model_parameter_allowed`: a catalogue key is described the same
        // way on every family, so the answer here is per section, never per category (`_category` is
        // kept for symmetry with the public wrapper and for a future family-specific name).
        if parameter.contains(':') {
            // A `section:name` target already carries the appendix name and `model_parameter_path`
            // validates it against the tables; the map describes catalogue keys only.
            return None;
        }
        match parameter {
            // ── Gate ────────────────────────────────────────────────────────────────────────────
            // `gate_thr` is `/gate/thr`, not `/gate/thr23`: the digits the extracted text glues on
            // are footnote references (Maillot 3.1.0 renders the row as `thr23`; the console only
            // answers `/gate/thr`, hardware-verified on WING Rack FW 3.1.1).
            "gate_thr" => Some(("gate", "thr")),
            "gate_attack" => Some(("gate", "att")),
            "gate_range" => Some(("gate", "range")),
            "gate_hold" => Some(("gate", "hld")),
            "gate_release" => Some(("gate", "rel")),
            // The three gate leaves whose name the appendix gives only to some models: `mix` and
            // `gain` belong to the models that have them (`2250`, `76LA`, `LMT`…), `acc` to `GATE`
            // alone — the console's default `/ch/1` dump runs `mdl=GATE` and prints `thr, range, att,
            // hld, rel, acc, ratio` with no `mix` and no `gain` (958). The map is what makes
            // `main.rs` check the strip's model before the write, exactly as it does for `gate_thr`.
            //
            // The model *selector* itself (`gate_type`, `comp_type`, `eq_model`) is deliberately not
            // here: `/gate/mdl`, `/dyn/mdl` and `/eq/mdl` exist whatever model is loaded, and no
            // appendix table lists `mdl` among a model's own parameters, so mapping it would refuse
            // the one write that is always valid.
            "gate_mix" => Some(("gate", "mix")),
            "gate_gain" => Some(("gate", "gain")),
            "gate_accent" => Some(("gate", "acc")),
            // `ratio` is the fourth name the gate's own table owns: the GATE table prints it (8219) and
            // so do sixteen other gate models, while a DEQ2 gate has `1-ratio`/`2-ratio` and no plain
            // `ratio` — so the strip's model decides, exactly as it does for `acc`.
            "gate_ratio" => Some(("gate", "ratio")),
            // The DEQ2/DEQ3 bands: the model's own names, hyphen and all (`/gate/1-thr`).
            "gate_1_thr" => Some(("gate", "1-thr")),
            "gate_2_thr" => Some(("gate", "2-thr")),
            "gate_1_gain" => Some(("gate", "1-g")),
            // ── Compressor ──────────────────────────────────────────────────────────────────────
            "comp_thr" => Some(("dyn", "thr")),
            "comp_ratio" => Some(("dyn", "ratio")),
            "comp_attack" => Some(("dyn", "att")),
            "comp_hold" => Some(("dyn", "hld")),
            "comp_release" => Some(("dyn", "rel")),
            "comp_knee" => Some(("dyn", "knee")),
            // The detector, the envelope and the auto switch of the compressor are the model's own
            // rows too: the console's `mdl=COMP` dump prints `det=RMS, env=LOG, auto=1` (961), and
            // the appendix gives `det` and `env` to COMP and EXP alone, `auto` to COMP, EXP, B560
            // and RED3. A strip whose compressor runs WARM, LMT or DEQ2 has none of the three.
            "dyn_detector" => Some(("dyn", "det")),
            "dyn_envelope" => Some(("dyn", "env")),
            "dyn_auto" => Some(("dyn", "auto")),
            // `/dyn/gain` is the compressor's make-up gain, named `gain` in the appendix.
            "comp_makeup" => Some(("dyn", "gain")),
            // Soul Warmth Preamp (WARM) compressor parameters.
            "dyn_drv" => Some(("dyn", "drv")),
            "dyn_trim" => Some(("dyn", "trim")),
            "dyn_mix" => Some(("dyn", "mix")),
            // The LMT section's own names.
            "dyn_tspd" => Some(("dyn", "tspd")),
            "dyn_trans" => Some(("dyn", "trans")),
            "dyn_tgain" => Some(("dyn", "tgain")),
            "dyn_ton" => Some(("dyn", "ton")),
            "dyn_comp" => Some(("dyn", "comp")),
            "dyn_cgain" => Some(("dyn", "cgain")),
            "dyn_con" => Some(("dyn", "con")),
            // ── EQ ──────────────────────────────────────────────────────────────────────────────
            // The three EQ node leaves that only the STD model documents (appendix, "Standard EQ":
            // `leq`, `heq` and `tilt` are STD rows, and no other EQ model's table lists them) — the
            // routing-table footnote on every family's `eq/mdl` row says the rows below it are that
            // model's ("This is for the STD eq model", 2090, 2304, 2421, 2592, 2753). A strip whose
            // EQ runs SOUL, MACH4 or PIA therefore refuses them, which is the point of the check.
            //
            // `/eq/mix` is deliberately absent, though it sits in the same slot: the console's own
            // node dump prints `mdl=STD,mix=100` (958), so the EQ node has a mix whatever model it
            // runs, and a name every model has is not a model parameter (see `trailing_model_leaf`
            // in the tests). `/eq/mdl` is absent for the same reason — it *is* the model.
            "eq_low_type" => Some(("eq", "leq")),
            "eq_high_type" => Some(("eq", "heq")),
            "eq_tilt" => Some(("eq", "tilt")),
            // The STD model addresses the low and high shelves as `lg`/`lf`/`lq` and `hg`/`hf`/`hq`
            // and the parametric bands as `<n>g`/`<n>f`/`<n>q` (Maillot 2070-2094, 8607-8650).
            "eq_low_gain" => Some(("eq", "lg")),
            "eq_low_freq" => Some(("eq", "lf")),
            "eq_low_q" => Some(("eq", "lq")),
            "eq_high_gain" => Some(("eq", "hg")),
            "eq_high_freq" => Some(("eq", "hf")),
            "eq_high_q" => Some(("eq", "hq")),
            "eq_1_gain" => Some(("eq", "1g")),
            "eq_1_freq" => Some(("eq", "1f")),
            "eq_1_q" => Some(("eq", "1q")),
            "eq_2_gain" => Some(("eq", "2g")),
            "eq_2_freq" => Some(("eq", "2f")),
            "eq_2_q" => Some(("eq", "2q")),
            "eq_3_gain" => Some(("eq", "3g")),
            "eq_3_freq" => Some(("eq", "3f")),
            "eq_3_q" => Some(("eq", "3q")),
            "eq_4_gain" => Some(("eq", "4g")),
            "eq_4_freq" => Some(("eq", "4f")),
            "eq_4_q" => Some(("eq", "4q")),
            "eq_5_gain" => Some(("eq", "5g")),
            "eq_5_freq" => Some(("eq", "5f")),
            "eq_5_q" => Some(("eq", "5q")),
            "eq_6_gain" => Some(("eq", "6g")),
            "eq_6_freq" => Some(("eq", "6f")),
            // `/eq/6q` is band 6's Q in the routing tables (bus 2434, main 2605, matrix 2775). The
            // STD appendix entry for it is the one row that does not name itself: it prints `7q` with
            // the description "q 6", a mangled band digit in the source document, and `7q` is in no
            // model table. `6q` is what the address really is, so the map keeps it and the coverage
            // test names it as the single documented exception rather than pretending it exists.
            "eq_6_q" => Some(("eq", "6q")),
            _ => None,
        }
    }

    fn is_meter_parameter(parameter: &str) -> bool {
        matches!(
            parameter,
            "meter"
                | "meter_monitor"
                | "meter_rta_band"
                | "meter_v2_gate_led"
                | "meter_v2_dyn_state"
                | "meter_v2_automix"
        )
    }

    fn resolve_meter_addresses(category: &str, parameter: &str, ids: &[u16]) -> Vec<String> {
        resolve_meter_target_specs(category, parameter, ids, DeskModel::Unknown)
            .into_iter()
            .map(|target| target.address)
            .collect()
    }

    fn resolve_meter_target_specs(
        category: &str,
        parameter: &str,
        ids: &[u16],
        model: DeskModel,
    ) -> Vec<ResolvedMeterTarget> {
        // One bound for both meter entry points: `resolve_basic_addresses` already applies
        // `category_has_id` to its writes, and a meter that does not exist is the same defect — the
        // preflight sees a non-empty address and the trigger can never match (macro audit item A2).
        let ids = ids
            .iter()
            .copied()
            .filter(|id| meter_id_allowed_for_model(category, *id, model))
            .collect::<Vec<_>>();
        let ids = ids.as_slice();
        if parameter == "meter_monitor" || (category == "monitor" && parameter == "meter") {
            return ids
                .iter()
                .filter_map(|id| monitor_meter_label(*id).map(|label| (*id, label)))
                .filter_map(|(id, label)| {
                    u8::try_from(id).ok().map(|index| ResolvedMeterTarget {
                        address: format!("/meters/monitor/{label}"),
                        label: format!("Monitor {label}"),
                        family: "monitor",
                        device_id: None,
                        index,
                        value_slot: 0,
                    })
                })
                .collect();
        }
        if parameter == "meter_rta_band" || (category == "rta" && parameter == "meter") {
            return ids
                .iter()
                .filter(|id| **id >= 1 && **id <= 120)
                .filter_map(|id| {
                    u8::try_from(*id).ok().map(|index| ResolvedMeterTarget {
                        address: format!("/meters/rta/{id}"),
                        label: format!("RTA {id}"),
                        family: "rta",
                        device_id: None,
                        index,
                        value_slot: 0,
                    })
                })
                .collect();
        }
        if let Some((family, family_label, value_slot)) =
            v2_meter_family_and_slot(category, parameter)
        {
            return ids
                .iter()
                .filter_map(|id| {
                    u8::try_from(*id).ok().map(|index| ResolvedMeterTarget {
                        address: format!(
                            "/meters/{family_label}/{id}/{}",
                            v2_meter_field(parameter).unwrap_or("level")
                        ),
                        label: format!(
                            "{family_label} {id} {}",
                            v2_meter_field(parameter).unwrap_or("level")
                        ),
                        family: family_label,
                        device_id: None,
                        index,
                        value_slot,
                    })
                })
                .collect::<Vec<_>>()
                .into_iter()
                .filter(|_| family.value_count() > value_slot)
                .collect();
        }

        if let Some((device_id, base, label_prefix)) = source_meter_info(category) {
            return ids
                .iter()
                .filter_map(|id| {
                    u8::try_from(*id).ok().map(|index| ResolvedMeterTarget {
                        address: format!("{base}/{id}"),
                        label: format!("{label_prefix} {id}"),
                        family: "source",
                        device_id: Some(device_id),
                        index,
                        value_slot: 0,
                    })
                })
                .collect();
        }
        if let Some((device_id, base, label_prefix)) = output_meter_info(category) {
            return ids
                .iter()
                .filter_map(|id| {
                    u8::try_from(*id).ok().map(|index| ResolvedMeterTarget {
                        address: format!("{base}/{id}"),
                        label: format!("{label_prefix} {id}"),
                        family: "output",
                        device_id: Some(device_id),
                        index,
                        value_slot: 0,
                    })
                })
                .collect();
        }
        let Some((family, family_label)) = normal_meter_family_and_label(category) else {
            return Vec::new();
        };
        ids.iter()
            .filter_map(|id| {
                u8::try_from(*id).ok().map(|index| ResolvedMeterTarget {
                    address: format!("/meters/{family_label}/{id}"),
                    label: format!("{family_label} {id}"),
                    family: family_label,
                    device_id: None,
                    index,
                    value_slot: 0,
                })
            })
            .filter(|_| family.value_count() > 0)
            .collect()
    }

    /// OSC prefix of a target category (`matrix` -> `/mtx`). Public inside the crate because the
    /// backend builds derived addresses — for instance the model read
    /// `/<family>/<id>/<section>/mdl` — and it has already got it wrong by using the category key.
    ///
    /// For the index-less categories this is the whole address prefix: `show` and `showstate` both
    /// answer `/$ctl/lib` and the leaf follows directly (see [`category_id_segment`]).
    pub fn prefix_for_category(category: &str) -> Option<&'static str> {
        match category {
            "ch" => Some("/ch"),
            "aux" => Some("/aux"),
            "bus" => Some("/bus"),
            "main" => Some("/main"),
            "matrix" => Some("/mtx"),
            "dca" => Some("/dca"),
            "mutegroup" => Some("/mgrp"),
            "fx" => Some("/fx"),
            "userctrl" => Some("/$ctl/user/1"),
            // Talkback: the prefix ends where the letter entry begins (`/cfg/talk/A/$on`).
            "talk" => Some("/cfg/talk"),
            // The GPIO node, one prefix for both halves of the split, with the id as a number.
            "gpio" | "gpiostate" => Some("/$ctl/gpio"),
            // The show-control node: one prefix for both halves of the split, and no id segment.
            "show" | "showstate" => Some("/$ctl/lib"),
            // The I/O node (1592-1594): the prefix is the whole address prefix, because the leaves
            // follow it directly (`/io/altsw`) — see `category_id_segment`.
            "io" => Some("/io"),
            // The fader layers: the prefix ends where the surface's letter begins
            // (`/$ctl/layer/CMPCT/sel`), the same shape talkback has.
            "layer" => Some("/$ctl/layer"),
            // The two USB transport nodes, one prefix per node for its two halves, with no id
            // segment: `/rec/$action` and `/play/$action` (3068-3075, 3045-3066).
            "rec" | "recstate" => Some("/rec"),
            "play" | "playstate" => Some("/play"),
            // The console-status node (3095-3097): `/$ctl/$stat/selidx`, no id segment.
            "stat" => Some("/$ctl/$stat"),
            // ── Batch 6: the desk level ───────────────────────────────────────────────────────────
            //
            // Nine nodes, and the prefix stops where the id segment begins. Six are index-less, so
            // the leaf follows the prefix directly; the monitor buses carry a number (`/cfg/mon/1/…`,
            // 1314) and the AES50 status a letter (`/$stat/A/…`, 1253), which the two bus/port
            // categories leave to `category_id_segment`. The W-Live card carries a number as well
            // (`/cards/wlive/1/$ctl/control`, 2966), and `/cards` is the card identity node above it
            // (2951-2954), not a prefix of it.
            "lights" => Some("/$ctl/cfg/lights"),
            "safes" => Some("/$ctl/safes"),
            "monbus" => Some("/cfg/mon"),
            "solocfg" => Some("/cfg/solo"),
            // One prefix for both halves of the AES50 split: the id is the port's letter, and which
            // half a key belongs to is the leaf table's business, not the prefix's.
            "aes50" | "deskstatus" => Some("/$stat"),
            "wlive" => Some("/cards/wlive"),
            "cards" => Some("/cards"),
            "globals" => Some("/$globals"),
            _ => source_input_prefix(category).or_else(|| output_prefix_for_category(category)),
        }
    }

    fn source_input_prefix(category: &str) -> Option<&'static str> {
        match category {
            "preamp_local" | "local" | "lcl" => Some("/io/in/LCL"),
            "preamp_aux" | "auxin" | "aux_in" => Some("/io/in/AUX"),
            "preamp_aes50a" | "aes50a" | "stagea" => Some("/io/in/A"),
            "preamp_aes50b" | "aes50b" | "stageb" => Some("/io/in/B"),
            "preamp_aes50c" | "aes50c" | "stagec" => Some("/io/in/C"),
            "preamp_stageconnect" | "stageconnect" | "sc" => Some("/io/in/SC"),
            "usb" => Some("/io/in/USB"),
            "preamp_card" | "card" | "crd" | "dante" | "dante_card" => Some("/io/in/CRD"),
            "preamp_module" | "module" | "mod" | "dante_module" => Some("/io/in/MOD"),
            "preamp_usbplayer" | "usbplayer" => Some("/io/in/PLAY"),
            "preamp_aesebu" | "aesebu" | "aes" => Some("/io/in/AES"),
            "usersig" | "usr" => Some("/io/in/USR"),
            "preamp_oscillator" | "oscillator" | "osc" => Some("/io/in/OSC"),
            _ => None,
        }
    }

    fn output_prefix_for_category(category: &str) -> Option<&'static str> {
        match category {
            "output_local" | "out_local" | "out_lcl" => Some("/io/out/LCL"),
            "output_aux" | "out_aux" => Some("/io/out/AUX"),
            "output_aes50a" | "out_aes50a" | "out_stagea" => Some("/io/out/A"),
            "output_aes50b" | "out_aes50b" | "out_stageb" => Some("/io/out/B"),
            "output_aes50c" | "out_aes50c" | "out_stagec" => Some("/io/out/C"),
            "output_stageconnect" | "out_stageconnect" | "out_sc" => Some("/io/out/SC"),
            "output_usb" | "out_usb" => Some("/io/out/USB"),
            "output_card" | "out_card" | "out_crd" | "out_dante" => Some("/io/out/CRD"),
            "output_module" | "out_module" | "out_mod" => Some("/io/out/MOD"),
            "output_usbrec" | "out_usbrec" => Some("/io/out/REC"),
            "output_aesebu" | "out_aesebu" | "out_aes" => Some("/io/out/AES"),
            _ => None,
        }
    }

    // Mirrors Android `MacroEngine.resolveAddresses`, updated against Maillot
    // WING Remote Protocols 3.1.0 tables: `/io/in/*`, `/io/out/*`, `/mtx`,
    // Channel 3 meter tokens `0xa7`/`0xa8`, and 1/256 dB meter values.
    /// Parameters whose name depends on the model loaded in the strip or slot are addressed as
    /// `<section>:<name>` (`gate:1-thr`, `dyn:tspd`, `eq:1g`, `fx:lc`). The name is validated against
    /// the generated Maillot appendix table — through `plugin_parameter_is_documented`, so the rows the
    /// extraction mangled count under the name the console really has and their printed spelling
    /// (`7q`) is refused — and a typo is refused here instead of being written to a path the console
    /// ignores in silence.
    ///
    /// The leaf is what differs between the two kinds of section. A gate, compressor or EQ section sits
    /// inside the strip (`/ch/1/gate/thr`, 2046), so its leaf carries the section. An FX slot's
    /// parameters live directly under the slot — `/fx/N/<name>`, "up to 4048 parameters that depend on
    /// the selected model (/fx/N/mdl)" (2940-2942) — so the leaf is the name alone and the id
    /// `resolve_basic_addresses` puts in front of it is the slot's.
    fn model_parameter_path(parameter: &str) -> Option<String> {
        let (section, name) = parameter.split_once(':')?;
        if !matches!(section, "gate" | "dyn" | "eq" | "fx") {
            return None;
        }
        if !crate::plugin_models::plugin_parameter_is_documented(name) {
            return None;
        }
        if section == "fx" {
            return Some(format!("/{name}"));
        }
        Some(format!("/{section}/{name}"))
    }

    /// Whether a category can carry a model-scoped parameter at all: the gate lives on channels, the
    /// compressor and the EQ on every mix family (verified read-only on WING Rack FW 3.1.1:
    /// `/aux/1/gate/mdl` is silent while `/aux/1/dyn/on` answers), and the effect parameters belong to
    /// the FX slots alone. Nothing else has a model — a monitor bus's EQ is the node's own and has no
    /// `/eq/mdl` — however much one of its leaves (`/eq/lsg`, `/eq/1g`) resembles an appendix parameter
    /// name. The catalogue-wide model walk in the tests asks this, and [`model_parameter_allowed`] is
    /// built on the same answer, so the two cannot disagree.
    fn category_has_model_slots(category: &str) -> bool {
        matches!(category, "ch" | "aux" | "bus" | "main" | "matrix")
    }

    fn model_parameter_allowed(category: &str, parameter: &str) -> bool {
        let Some((section, _)) = parameter.split_once(':') else {
            return false;
        };
        // The effect parameters are the slot's own, and the slot is the category (`/fx/<id>/<name>`,
        // 2940-2942): no other category has an FX node to put them in.
        if section == "fx" {
            return category == "fx";
        }
        if !category_has_model_slots(category) {
            return false;
        }
        match section {
            "gate" => category == "ch",
            "dyn" | "eq" => true,
            _ => false,
        }
    }

    /// The value rules of one model-qualified parameter: what the editor's field and the validator's
    /// range check read, for a name no static catalogue entry can describe.
    ///
    /// A rule is built from the appendix row the model named (see [`model_parameter_rule`]) and is the
    /// same vocabulary a [`TargetParameterInfo`] carries, so the comparators, the unit and the closed
    /// list of a `fx:lc` are read and enforced exactly like a catalogue key's.
    #[derive(Clone, Debug, PartialEq)]
    pub struct ModelParameterRule {
        /// The key the operator selected, `<section>:<name>`, for the messages.
        pub label: String,
        /// How the value behaves, which decides the comparators ([`operators_for_value_kind`]).
        pub value_kind: &'static str,
        pub arg_kind: &'static str,
        /// Unit of a numeric value ("dB", "Hz", "ms", "%"), empty when it has none.
        pub unit: String,
        /// Inclusive range of a numeric value; `f32::NAN` means "no range declared" — the spec
        /// documents none, or the models read together do not agree on one.
        pub min: f32,
        pub max: f32,
        /// The closed list the value must come from, empty when the value is free.
        pub options: Vec<String>,
        /// True when **every** table that carries the name documents it `logf`: the leaf's own answer
        /// to how a fade between two of its values should move (see [`fade_domain`]). `false` when the
        /// tables document it `linf`/`fader`, and also when they disagree — a linear ramp still lands
        /// on both endpoints, which is the property that matters when the table is unknown.
        pub logarithmic: bool,
        /// The appendix table the rules came from, when a single model decided them; `None` when every
        /// model that carries the name agreed.
        pub model: Option<&'static str>,
    }

    /// Whether two value kinds are judged the same way: the same comparators and the same kind of
    /// value check.
    ///
    /// `number` and `db` are two labels for one numeric field, `text` and `enum` are one closed list,
    /// and a toggle is its own — its value check is `0`/`1` and not a list, which is why it cannot be
    /// merged with text even though both are compared with `==`/`!=`.
    fn value_kinds_agree(left: &str, right: &str) -> bool {
        operators_for_value_kind(left) == operators_for_value_kind(right)
            && (left == "toggle") == (right == "toggle")
    }

    /// Why a model-scoped parameter cannot be used on a strip or slot whose model is `model`, or
    /// `None` when it can.
    ///
    /// A gate, compressor, EQ or effect name belongs to the model loaded in that slot (Maillot's
    /// appendix): a `DEQ2` gate has `1-thr`/`2-thr` and no `thr`, a `WARM` compressor has no `thr` at
    /// all, and a `ROOM` slot has `pdel`/`size`/`dcy` while a `CHORUS` slot has `wave`/`sprd`/`flc`.
    /// The address is well formed either way, so the console ignores the write without a word — which
    /// is why the editor and the backend both have to check it *before* it leaves the app (macro audit
    /// of 2026-09-24, open item 1).
    ///
    /// An empty `model` means "not known": there is nothing to check against, and the caller keeps its
    /// own "the model was not consulted" note rather than refusing a macro that works today.
    ///
    /// The names are asked through [`crate::plugin_models::plugin_model_has_parameter`], which knows
    /// both the appendix rows the extraction mangled (see
    /// [`crate::plugin_models::PLUGIN_PARAMETER_ALIASES`]: `STD` answers yes for `6q`, the leaf the
    /// routing tables document at 2434/2605/2775, even though the appendix prints that row as `7q`) and
    /// the names the console spells differently (see
    /// [`crate::plugin_models::PLUGIN_MODEL_ALIASES`]: `V-IMG` is the console's name for the `V_IMG`
    /// table, 2916).
    pub fn model_parameter_problem(section: &str, name: &str, model: &str) -> Option<String> {
        let section = section.trim().to_ascii_lowercase();
        if !matches!(section.as_str(), "gate" | "dyn" | "eq" | "fx") {
            return Some(format!("\"{section}\" is not a model slot"));
        }
        let model = model.trim();
        if model.is_empty() {
            return None;
        }
        let Some(entry) = crate::plugin_models::plugin_model(model) else {
            return Some(match section.as_str() {
                // The FX model list is the console's own (`/fx/<slot>/mdl`, 2896-2934), and the appendix
                // spells three of its entries differently — `ROOM`, `DEL/REV` and `V-IMG` — so a name
                // the console offers always resolves here.
                "fx" => format!("\"{model}\" is not a documented effect model (Maillot 2896-2934)"),
                _ => format!("\"{model}\" is not a documented {section} model"),
            });
        };
        let name = name.trim();
        if crate::plugin_models::plugin_model_has_parameter(model, name) {
            return None;
        }
        // Name a few of the names this model does have: the operator is editing a mask, and the
        // whole table would not fit in a dialog. The list is the console's spelling, so an example
        // can never be a name the console would ignore.
        let examples = crate::plugin_models::plugin_parameter_names(model)
            .unwrap_or_default()
            .into_iter()
            .take(6)
            .collect::<Vec<_>>()
            .join(", ");
        let holder = match section.as_str() {
            "fx" => "the slot's model is".to_string(),
            _ => format!("the strip's {section} runs"),
        };
        Some(format!(
            "{holder} {}, which has no \"{name}\"; it has {examples}, … (Maillot appendix)",
            entry.model
        ))
    }

    /// The models a model-qualified section can run, in the console's own order.
    ///
    /// The strip sections' lists come from the routing tables that document each `mdl` row; the FX one
    /// is `/fx/<slot>/mdl` itself (2896-2934), which is the only set of effect models a slot loads.
    fn section_models(section: &str) -> Option<&'static [&'static str]> {
        match section {
            "gate" => Some(crate::plugin_models::CHANNEL_GATE_MODELS),
            "dyn" => Some(crate::plugin_models::CHANNEL_DYN_MODELS),
            "eq" => Some(crate::plugin_models::CHANNEL_EQ_MODELS),
            "fx" => Some(fx_models()),
            _ => None,
        }
    }

    /// The value rules of a model-qualified parameter (`fx:lc`, `gate:1-thr`), which no static
    /// catalogue entry can carry: the name exists only for the model the console reports.
    ///
    /// `model` is the model the console reports — `/ch/<id>/gate/mdl`, `/fx/<slot>/mdl` — when the
    /// caller knows it, and then the row is that model's own, which is the only answer that can be
    /// right: the appendix gives `d_att` a list of times on one table and a number on another, and `hf`
    /// a closed list on one and a level on another.
    ///
    /// When no model is known (an older `.wcz`, the Android import, a hand-edited show) the rows of
    /// every model the section accepts are read together and only what they agree on survives: one
    /// value kind, one range and the union of their closed lists. A name the models disagree about
    /// keeps no rule beyond its comparators — `text`, no range, no list — so another model's row can
    /// never refuse a value this one accepts. The caller keeps its "the model was not checked" note.
    pub fn model_parameter_rule(
        section: &str,
        name: &str,
        model: Option<&str>,
    ) -> Option<ModelParameterRule> {
        let section = section.trim().to_ascii_lowercase();
        let name = name.trim();
        if name.is_empty() {
            return None;
        }
        let named = model.map(str::trim).filter(|model| !model.is_empty());
        // A model the appendix documents decides the answer alone. A model it does not document leaves
        // the question where it was — `model_parameter_problem` refuses that name with its own message,
        // and the rules here stay the union's.
        let candidates: Vec<&str> = match named {
            Some(model) if crate::plugin_models::plugin_model(model).is_some() => vec![model],
            _ => section_models(&section)?.to_vec(),
        };
        let mut specs = Vec::new();
        for candidate in candidates {
            let Some(entry) = crate::plugin_models::plugin_model(candidate) else {
                continue;
            };
            for (console_name, row) in
                crate::plugin_models::plugin_parameters(entry.model).unwrap_or_default()
            {
                if console_name == name {
                    specs.push((entry.model, crate::plugin_spec::parse_plugin_spec(row.spec)));
                }
            }
        }
        let (first_model, first) = specs.first()?;
        let mut options: Vec<String> = Vec::new();
        for (_, spec) in &specs {
            for option in &spec.options {
                if !options.contains(option) {
                    options.push(option.clone());
                }
            }
        }
        let ranges = specs
            .iter()
            .map(|(_, spec)| {
                spec.min
                    .zip(spec.max)
                    .map(|(min, max)| (min as f32, max as f32))
            })
            .collect::<Vec<_>>();
        let range = ranges
            .first()
            .copied()
            .flatten()
            .filter(|first| ranges.iter().all(|candidate| *candidate == Some(*first)));
        let agrees = specs
            .iter()
            .all(|(_, spec)| value_kinds_agree(spec.catalogue_value_kind(), first.catalogue_value_kind()));
        let (value_kind, unit, min, max, options) = if agrees {
            (
                first.catalogue_value_kind(),
                first.unit.clone().unwrap_or_default(),
                range.map_or(f32::NAN, |(min, _)| min),
                range.map_or(f32::NAN, |(_, max)| max),
                options,
            )
        } else {
            // The models do not agree on what the value *is* (`hf` is a closed list on one table and a
            // level on another). Only the name is common ground: no range, no list, and the comparators
            // of text, so a value one model takes is never refused on the strength of another's row.
            ("text", String::new(), f32::NAN, f32::NAN, Vec::new())
        };
        // Maillot model appendix: OSC type must agree as well as the displayed unit.
        let arg_kind = if specs.iter().all(|(_, spec)| spec.catalogue_arg_kind() == first.catalogue_arg_kind()) {
            first.catalogue_arg_kind()
        } else { "unknown" };
        Some(ModelParameterRule {
            arg_kind,
            label: format!("{section}:{name}"),
            value_kind,
            unit,
            min,
            max,
            options,
            // The appendix's own word for how the value is spaced. Every table that carries the name
            // has to say `logf` (or `log`): one `linf` table among them is enough to prefer the domain
            // that cannot be wrong about the endpoints.
            logarithmic: specs.iter().all(|(_, spec)| spec.logarithmic),
            // The model the rules came from, when a single one decided them.
            model: (specs.len() == 1).then_some(*first_model),
        })
    }

    /// The parameter names a documented model exposes, for a caller that has to show them.
    pub fn model_parameter_names(model: &str) -> Vec<&'static str> {
        crate::plugin_models::plugin_parameter_names(model).unwrap_or_default()
    }

    /// The rule for a `section:name` key, when the category may carry that section at all.
    ///
    /// The category check is the same one the resolver makes ([`model_parameter_allowed`]), so a key
    /// that resolves to no address (`gate:thr` on a bus, `fx:lc` on a channel) is answered for by
    /// neither: the caller keeps its "the console has no such value" refusal.
    fn model_parameter_rule_for_key(
        category: &str,
        parameter: &str,
        model: Option<&str>,
    ) -> Option<ModelParameterRule> {
        let (section, name) = parameter.split_once(':')?;
        if !model_parameter_allowed(category, parameter) {
            return None;
        }
        model_parameter_rule(section, name, model)
    }

    /// The model slot a catalogue parameter belongs to, when its leaf lives in one:
    /// (`"gate"`, `"thr"`) for `gate_thr`, (`"dyn"`, `"1-thr"`)-style names for the DEQ2 keys,
    /// (`"eq"`, `"lg"`) for `eq_low_gain`. `None` for everything that is not model-scoped.
    ///
    /// Every model-scoped parameter also exists as a plain catalogue key, and `main.rs`'s model
    /// check only looked at `section:name` targets, so a macro watching or writing `Gate Threshold`
    /// on a strip whose gate runs `DEQ2` compiled, could never fire, and was never checked: the
    /// console has no `/gate/thr` for that model (macro audit of 2026-09-24, open item 1). A caller
    /// holding the strip's model asks [`model_parameter_problem`] with these two values, so the plain
    /// key gets the same check as the qualified one.
    ///
    /// The name is the appendix's own (validated against the generated tables by
    /// `every_model_leaf_name_exists_in_an_appendix_table`), and `/{section}/{name}` is exactly the
    /// path [`resolve_basic_addresses`] builds for the key
    /// (`every_catalogue_model_key_agrees_with_its_resolved_path`).
    pub fn model_leaf_for_parameter(
        category: &str,
        parameter: &str,
    ) -> Option<(&'static str, &'static str)> {
        model_leaf_name(&normalize_category(category), &normalize_parameter(parameter))
    }

    /// The leaf of a show-control key, under the category that owns it.
    ///
    /// The two categories *are* the write/watch split, and this table follows it: `show` carries the
    /// leaves a step writes, `showstate` the leaves the console reports. Asking one category for the
    /// other's key answers `None`, so a hand-edited show file cannot aim a write at the read-only
    /// `$scenes` nor a watch at `$actionidx`, whatever the picker would have offered.
    ///
    /// Each leaf is the whole address that follows the `/$ctl/lib` prefix: both categories are
    /// index-less ([`category_id_segment`]), so no id sits between the two.
    fn show_leaf_for_category(category: &str, parameter: &str) -> Option<String> {
        let category = normalize_category(category);
        let leaves: &[(&str, &str)] = match category.as_str() {
            "show" => &[("scene_index", "/$actionidx"), ("scene_action", "/$action")],
            "showstate" => &[
                ("scene_active_index", "/$actidx"),
                ("scene_active_name", "/$active"),
                ("scene_active_tag", "/$activeid"),
                ("scene_show_name", "/$actshow"),
                ("scene_list", "/$scenes"),
            ],
            _ => return None,
        };
        // Each row above is the whole address after the prefix, which is only true of a category
        // whose path carries no id segment: the named mechanism and this table cannot drift apart.
        debug_assert_eq!(
            category_id_segment(&category),
            CategoryIdSegment::Absent,
            "{category} has an id segment, so its leaf is not the whole address"
        );
        leaves
            .iter()
            .find(|(key, _)| *key == parameter)
            .map(|(_, leaf)| (*leaf).to_string())
    }

    /// The leaf of a talkback key, after the `/cfg/talk/<A|B>` prefix (Maillot 1461-1534).
    ///
    /// The three assigns are the send destination's index under the console's own segment: the leaf
    /// is `B16`, `MX8` or `M4`, and the index and its bound come from [`send_index_for`], the same
    /// function the send parameters use. A 17th bus, a 9th matrix or a 5th main therefore resolves to
    /// nothing exactly as it does for a send, and the editor's destination control works unchanged.
    ///
    /// A missing index still means destination 1 here: `send_index_for`'s fail-closed branch is the
    /// bus-to-bus self-send rule (footnote 38), and talkback is not a bus sending to itself.
    fn talk_leaf_for_category(
        category: &str,
        parameter: &str,
        send_id: Option<u8>,
    ) -> Option<String> {
        match parameter {
            "talk_on" => Some("/$on".to_string()),
            "talk_mode" => Some("/mode".to_string()),
            "talk_monitor_dim" => Some("/mondim".to_string()),
            "talk_bus_dim" => Some("/busdim".to_string()),
            "talk_individual" => Some("/indiv".to_string()),
            _ => {
                let prefix = talk_assign_prefix(parameter)?;
                let index = send_index_for(category, parameter, send_id)?;
                Some(format!("/{prefix}{index}"))
            }
        }
    }

    /// The leaf of a GPIO key, under the category that owns it.
    ///
    /// The two categories *are* the write/watch split, and this table follows it: `gpio` carries the
    /// two leaves a step may write (`mode` at 4011, `gpstate` at 4014), `gpiostate` the read-only
    /// `$state` the console reports (4013, `[RO]`). Asking one category for the other's key answers
    /// `None`, so a hand-edited show file cannot aim a write at `$state` — which is what a single
    /// category could not express, because the flags are per category.
    fn gpio_leaf_for_category(category: &str, parameter: &str) -> Option<String> {
        let category = normalize_category(category);
        let leaves: &[(&str, &str)] = match category.as_str() {
            "gpio" => &[("gpio_mode", "/mode"), ("gpio_state", "/gpstate")],
            "gpiostate" => &[("gpio_input_state", "/$state")],
            _ => return None,
        };
        leaves
            .iter()
            .find(|(key, _)| *key == parameter)
            .map(|(_, leaf)| (*leaf).to_string())
    }

    /// The leaf of a USB transport key, under the category that owns it (Maillot 3045-3075).
    ///
    /// Four categories over two nodes, and the split *is* the write/watch rule: `rec` and `play`
    /// carry the leaves a step writes, `recstate` and `playstate` the ones the console reports.
    /// Asking one category for the other's key answers `None`, so a hand-edited show file cannot aim
    /// a write at `$actstate` — a leaf the console only reads — nor a watch at `$action`, which it
    /// only takes.
    ///
    /// Every leaf is the whole address that follows the node's prefix, which is only true of a
    /// category whose path carries no id segment: `debug_assert` names the mechanism, so this table
    /// and [`category_id_segment`] cannot drift apart.
    fn usb_transport_leaf_for_category(category: &str, parameter: &str) -> Option<String> {
        let category = normalize_category(category);
        let leaves: &[(&str, &str)] = match category.as_str() {
            "rec" => &[
                ("rec_action", "/$action"),
                ("rec_path", "/path"),
                ("rec_resolution", "/resolution"),
                ("rec_channels", "/channels"),
            ],
            "recstate" => &[("rec_state", "/$actstate"), ("rec_time", "/$time")],
            "play" => &[
                ("play_action", "/$action"),
                ("play_file", "/$playfile"),
                ("play_repeat", "/repeat"),
            ],
            "playstate" => &[("play_state", "/$actstate"), ("play_position", "/$pos")],
            _ => return None,
        };
        debug_assert_eq!(
            category_id_segment(&category),
            CategoryIdSegment::Absent,
            "{category} has an id segment, so its leaf is not the whole address"
        );
        leaves
            .iter()
            .find(|(key, _)| *key == parameter)
            .map(|(_, leaf)| (*leaf).to_string())
    }

    /// The leaf of every desk-level key, after the category's id segment (Maillot 3128-3145,
    /// 4016-4067, 1314-1394, 1249-1301, 2950-3024, 4168-4186).
    ///
    /// One table per node, and the leaf is what follows the prefix — plus the id segment where the
    /// category has one, which never appears here: `resolve_basic_addresses` glues
    /// `{prefix}{segment}{leaf}` together and the segment is [`category_id_segment`]'s business. That
    /// is why `monbus` answers `/eq/1g` (the address is `/cfg/mon/1/eq/1g`), `aes50` answers `/stat`
    /// (`/$stat/A/stat`) and `wlive` answers `/$ctl/control` (`/cards/wlive/1/$ctl/control`).
    ///
    /// The read-only keys are in the same table as the writable ones on purpose: a watch is a
    /// comparison against a real address exactly as a step is a write to one, so a `[RO]` row a
    /// trigger is offered has to resolve like any other. What keeps a step away from it is the
    /// category's *target list*, not this table — see [`desk_level_read_only_parameters`].
    fn desk_level_leaf_table(category: &str) -> Option<&'static [(&'static str, &'static str)]> {
        match category {
            "lights" => Some(LIGHTS_LEAVES),
            "safes" => Some(SAFES_LEAVES),
            "monbus" => Some(MONBUS_LEAVES),
            "solocfg" => Some(SOLO_LEAVES),
            "aes50" => Some(AES50_LEAVES),
            "deskstatus" => Some(DESK_STATUS_LEAVES),
            "wlive" => Some(WLIVE_LEAVES),
            "cards" => Some(CARDS_LEAVES),
            "globals" => Some(GLOBALS_LEAVES),
            _ => None,
        }
    }

    fn param_for_category(category: &str, parameter: &str, send_id: Option<u8>) -> Option<String> {
        if parameter.contains(':') {
            return if model_parameter_allowed(category, parameter) {
                model_parameter_path(parameter)
            } else {
                None
            };
        }
        if matches!(category, "show" | "showstate") {
            return show_leaf_for_category(category, parameter);
        }
        // Talkback and the two halves of the GPIO split have their own leaf tables, for the same
        // reason `show` does: the table *is* the write/watch rule, and it refuses the crossing.
        if category == "talk" {
            return talk_leaf_for_category(category, parameter, send_id);
        }
        if matches!(category, "gpio" | "gpiostate") {
            return gpio_leaf_for_category(category, parameter);
        }
        // The USB recorder and player: two nodes, four categories, one leaf table that *is* the
        // write/watch rule and refuses the crossing between the two halves.
        if matches!(category, "rec" | "recstate" | "play" | "playstate") {
            return usb_transport_leaf_for_category(category, parameter);
        }
        if category == "layer" {
            // The seven fader-layer surfaces share the one `sel` leaf (3220, 3299, 3381, 3456, 3523,
            // 3585, 3645). The surface is the id — rendered as its letter — and the value written is
            // the layer number, so nothing per-surface lives here.
            return (parameter == "layer_select").then(|| "/sel".to_string());
        }
        if category == "stat" {
            // The console-status node (3095-3097), read-only leaves. The id never enters the path.
            return match parameter {
                "selected_strip" => Some("/selidx".to_string()),
                "selected_page" => Some("/pageidx".to_string()),
                _ => None,
            };
        }
        if category == "io" {
            // The I/O node's two leaves (1593-1594), each an ordinary toggle. The category carries no
            // index, so the address is the prefix plus the leaf and nothing else.
            return match parameter {
                "io_altsw" => Some("/altsw".to_string()),
                "io_auto_alt_override" => Some("/autoaltovr".to_string()),
                _ => None,
            };
        }
        // The nine desk-level blocks of batch 6: one node each, and the table *is* the block. It is
        // asked before the mix/source/output dispatch below because a desk-level category is none of
        // those, and it answers for a known category even when the key is unknown to it — a key the
        // block does not document must not fall through to a family table that happens to share the
        // name.
        if let Some(leaves) = desk_level_leaf_table(category) {
            return leaves
                .iter()
                .find(|(key, _)| *key == parameter)
                .map(|(_, leaf)| (*leaf).to_string());
        }
        if category == "dca" {
            return match parameter {
                "mute" => Some("/mute".to_string()),
                "fader" => Some("/fdr".to_string()),
                "name" => Some("/name".to_string()),
                "color" => Some("/col".to_string()),
                "icon" => Some("/icon".to_string()),
                // Maillot 2876. A DCA has no `/dca/1/wid` and no `/dca/1/solosafe`, but it does
                // have the solo switch (2874), which the console also reports.
                "monitor_mode" => Some("/mon".to_string()),
                "solo" => Some("/$solo".to_string()),
                _ => None,
            };
        }
        if category == "mutegroup" {
            return match parameter {
                "mute" | "mute_group" => Some("/mute".to_string()),
                "name" => Some("/name".to_string()),
                _ => None,
            };
        }
        if category == "fx" {
            return match parameter {
                "fx_mix" => Some("/fxmix".to_string()),
                "fx_model" => Some("/mdl".to_string()),
                _ => None,
            };
        }
        if category == "userctrl" {
            return match parameter {
                // The leaf, not the node: Maillot 3956/3957. The value is a string from the appendix.
                "user_btn" => Some("/bu/mode".to_string()),
                _ => None,
            };
        }
        if source_input_prefix(category).is_some() {
            return match parameter {
                // The input mode of the source node itself (1599, 1618, …): a different leaf from the
                // channel's read-only `/in/set/$mode` (1936), which no key addresses. The guard is the
                // oscillator's `[RO]` row (1781): there the console does not take the write, so the
                // address is never built — see `source_parameter_allowed`.
                "source_mode" if source_parameter_allowed(category, parameter) => {
                    Some("/mode".to_string())
                }
                // `/io/in/*` documents the head amp as `g` (1600, 1630) and no `trim` leaf at all:
                // there is no `/io/in/LCL/1/trim`, so a source `trim` resolves to nothing rather than
                // to the head amp — writing `/g` while the editor says "trim" is how a hand-edited
                // show wrote a gain the operator never asked for. The *input* trim is a real leaf on
                // the mix families (`/in/set/trim`, 1940) and is untouched by this.
                "gain" if source_parameter_allowed(category, parameter) => Some("/g".to_string()),
                "phantom_48v" if source_parameter_allowed(category, parameter) => {
                    Some("/vph".to_string())
                }
                "mute" => Some("/mute".to_string()),
                "phase" if source_parameter_allowed(category, parameter) => {
                    Some("/pol".to_string())
                }
                "name" => Some("/name".to_string()),
                "color" => Some("/col".to_string()),
                "icon" => Some("/icon".to_string()),
                // The oscillator's source sub-node (1789-1793): the extra `osc` segment travels in the
                // parameter string, so no new id shape is needed. `source_parameter_allowed` keeps the
                // three leaves on `/io/in/OSC`, the only node the document gives them to.
                "osc_level" if source_parameter_allowed(category, parameter) => {
                    Some("/osc/lvl".to_string())
                }
                "osc_mode" if source_parameter_allowed(category, parameter) => {
                    Some("/osc/mode".to_string())
                }
                "osc_freq" if source_parameter_allowed(category, parameter) => {
                    Some("/osc/f".to_string())
                }
                _ => None,
            };
        }
        if output_prefix_for_category(category).is_some() {
            return match parameter {
                "output_group" => Some("/grp".to_string()),
                "output_source" => Some("/in".to_string()),
                _ => None,
            };
        }
        if !mix_parameter_allowed(category, parameter) {
            return None;
        }
        match parameter {
            "mute" => Some("/mute".to_string()),
            "fader" => Some("/fdr".to_string()),
            "pan" => Some("/pan".to_string()),
            "name" => Some("/name".to_string()),
            "color" => Some("/col".to_string()),
            "icon" => Some("/icon".to_string()),
            // Two different leaves with their own ranges (Maillot 1940 trim -18..18, 1943 `$g`
            // -3..45.5). Sharing one arm made the editor reject valid trims and accept gains the
            // console clamps.
            "gain" => Some("/in/set/$g".to_string()),
            "trim" => Some("/in/set/trim".to_string()),
            "alt_source" => Some("/in/set/altsrc".to_string()),
            // The input connection node, on channels and aux only (1955-1965, 2224-2233). The family
            // gate is `mix_parameter_allowed`, which this function has already asked: bus, main and
            // matrix have an `/in/set` node with no `conn` child (2374-2378, 2545-2549, 2705-2709),
            // so those four keys resolve to nothing there.
            "input_conn_group" => Some("/in/conn/grp".to_string()),
            "input_conn_index" => Some("/in/conn/in".to_string()),
            "input_conn_alt_group" => Some("/in/conn/altgrp".to_string()),
            "input_conn_alt_index" => Some("/in/conn/altin".to_string()),
            "phantom_48v" => Some("/in/set/$vph".to_string()),
            "phase" => Some("/in/set/inv".to_string()),
            // The two remaining input-set leaves (1937-1941, 2210-2214).
            "source_auto" => Some("/in/set/srcauto".to_string()),
            "input_balance" => Some("/in/set/bal".to_string()),
            "hpf_on" => Some("/flt/lc".to_string()),
            "hpf_freq" => Some("/flt/lcf".to_string()),
            "lpf_on" => Some("/flt/hc".to_string()),
            "lpf_freq" => Some("/flt/hcf".to_string()),
            // The filter node's own switches (1970-1979). `tilt` is the row the extracted text
            // prints `tilt21`, where `21` is a footnote reference: the console only knows
            // `/flt/tilt` (footnote 21 explains that the other filter models bring other
            // parameters, which is why only the TILT leaf is offered).
            "flt_low_slope" => Some("/flt/lcs".to_string()),
            "flt_high_slope" => Some("/flt/hcs".to_string()),
            "flt_tool" => Some("/flt/tf".to_string()),
            "flt_model" => Some("/flt/mdl".to_string()),
            "flt_tilt" => Some("/flt/tilt".to_string()),
            // The PreSend EQ (2013-2023): its own node, in front of the sends.
            "peq_on" => Some("/peq/on".to_string()),
            "peq_1_gain" => Some("/peq/1g".to_string()),
            "peq_1_freq" => Some("/peq/1f".to_string()),
            "peq_1_q" => Some("/peq/1q".to_string()),
            "peq_2_gain" => Some("/peq/2g".to_string()),
            "peq_2_freq" => Some("/peq/2f".to_string()),
            "peq_2_q" => Some("/peq/2q".to_string()),
            "peq_3_gain" => Some("/peq/3g".to_string()),
            "peq_3_freq" => Some("/peq/3f".to_string()),
            "peq_3_q" => Some("/peq/3q".to_string()),
            "eq_on" => Some("/eq/on".to_string()),
            // The EQ model, the mix and the two band types are named rows, not bands, so they are
            // listed before the `eq_<band>_<field>` catch-all: `eq_parameter_path` parses a band and
            // a field and answers `None` for these five.
            "eq_model" => Some("/eq/mdl".to_string()),
            "eq_mix" => Some("/eq/mix".to_string()),
            "eq_low_type" => Some("/eq/leq".to_string()),
            "eq_high_type" => Some("/eq/heq".to_string()),
            "eq_tilt" => Some("/eq/tilt".to_string()),
            parameter if parameter.starts_with("eq_") => eq_parameter_path(category, parameter),
            "gate_on" => Some("/gate/on".to_string()),
            // Maillot 3.1.0 renders these as `thr23`/`thr26`/`thr32`/`thr37`/
            // `thr42`/`thr46`, but the trailing digits are footnote references
            // glued to the name by the text extraction, not path segments. The
            // console only knows `/gate/thr` and `/dyn/thr`; verified by
            // read-only leaf reads on WING Rack (FW 3.1.1): every
            // suffixed form is silent while the plain forms answer.
            "gate_thr" => Some("/gate/thr".to_string()),
            "gate_range" => Some("/gate/range".to_string()),
            "gate_attack" => Some("/gate/att".to_string()),
            "gate_hold" => Some("/gate/hld".to_string()),
            "gate_release" => Some("/gate/rel".to_string()),
            // Gate mix, gain and accent (2038-2045): ordinary leaves of the gate node whose *name*
            // only some gate models have — `model_leaf_for_parameter` maps them so the strip's model
            // is checked before the write (see `model_parameter_allowed`).
            "gate_mix" => Some("/gate/mix".to_string()),
            "gate_gain" => Some("/gate/gain".to_string()),
            "gate_accent" => Some("/gate/acc".to_string()),
            // The gate ratio (2046): a string enum, and the fifth value is printed on the wrapped line
            // below the row (`gate`, 8219-8220).
            "gate_ratio" => Some("/gate/ratio".to_string()),
            "gate_type" => Some("/gate/mdl".to_string()),
            // The gate sidechain node (2048-2055), channels only.
            "gate_sc_type" => Some("/gatesc/type".to_string()),
            "gate_sc_freq" => Some("/gatesc/f".to_string()),
            "gate_sc_q" => Some("/gatesc/q".to_string()),
            "gate_sc_source" => Some("/gatesc/src".to_string()),
            "gate_sc_tap" => Some("/gatesc/tap".to_string()),
            // Dual Dynamic EQ bands: the model's own names (see the comment above).
            "gate_1_thr" => Some("/gate/1-thr".to_string()),
            "gate_2_thr" => Some("/gate/2-thr".to_string()),
            "gate_1_gain" => Some("/gate/1-g".to_string()),
            "comp_on" => Some("/dyn/on".to_string()),
            // Same footnote-reference trap as the gate threshold above.
            "comp_thr" => Some("/dyn/thr".to_string()),
            "comp_ratio" => Some("/dyn/ratio".to_string()),
            "comp_attack" => Some("/dyn/att".to_string()),
            "comp_hold" => Some("/dyn/hld".to_string()),
            "comp_release" => Some("/dyn/rel".to_string()),
            "comp_knee" => Some("/dyn/knee".to_string()),
            // Soul Warmth Preamp (WARM) compressor parameters.
            "dyn_drv" => Some("/dyn/drv".to_string()),
            "dyn_trim" => Some("/dyn/trim".to_string()),
            "dyn_mix" => Some("/dyn/mix".to_string()),
            // LMT Compressor section: its own names, not the generic compressor ones.
            "dyn_tspd" => Some("/dyn/tspd".to_string()),
            "dyn_trans" => Some("/dyn/trans".to_string()),
            "dyn_tgain" => Some("/dyn/tgain".to_string()),
            "dyn_ton" => Some("/dyn/ton".to_string()),
            "dyn_comp" => Some("/dyn/comp".to_string()),
            "dyn_cgain" => Some("/dyn/cgain".to_string()),
            "dyn_con" => Some("/dyn/con".to_string()),
            "comp_makeup" => Some("/dyn/gain".to_string()),
            "comp_type" => Some("/dyn/mdl".to_string()),
            // The detector, the envelope and the auto switch (2113-2118, 2457-2462, 2629-2634,
            // 2799-2810).
            "dyn_detector" => Some("/dyn/det".to_string()),
            "dyn_envelope" => Some("/dyn/env".to_string()),
            "dyn_auto" => Some("/dyn/auto".to_string()),
            // The dynamics sidechain node (2130-2138 and the same rows on the four other families):
            // `dynsc`, not `gatesc`, and the same five leaves on every family that has it. The
            // source and tap lists are the overlay's.
            "dyn_sc_type" => Some("/dynsc/type".to_string()),
            "dyn_sc_freq" => Some("/dynsc/f".to_string()),
            "dyn_sc_q" => Some("/dynsc/q".to_string()),
            "dyn_sc_source" => Some("/dynsc/src".to_string()),
            "dyn_sc_tap" => Some("/dynsc/tap".to_string()),
            "insert_on" => Some("/preins/on".to_string()),
            // Insert slot assignment: an FX slot name, not a node (2148, 2183, 2327, 2491, 2514,
            // 2666, 2677, 2836, 2841).
            "pre_insert_slot" => Some("/preins/ins".to_string()),
            "post_insert_on" => Some("/postins/on".to_string()),
            "post_insert_slot" => Some("/postins/ins".to_string()),
            "post_insert_mode" => Some("/postins/mode".to_string()),
            "post_insert_weight" => Some("/postins/w".to_string()),
            // Strip basics: `/wid` (1998), `/mon` (2002) and `/solosafe` (2001) are their own
            // leaves on every family the catalogue offers them for (see `mix_parameter_allowed`).
            "width" => Some("/wid".to_string()),
            "monitor_mode" => Some("/mon".to_string()),
            // The mono switch (2389, 2560, 2727), the process order (2003-2008) and the tags (2187,
            // 2355, 2525, 2688, 2852). `proc` is a channel leaf; `mix_parameter_allowed` keeps it
            // there and keeps `busmono` on the three output families.
            "bus_mono" => Some("/busmono".to_string()),
            "proc_order" => Some("/proc".to_string()),
            "tags" => Some("/tags".to_string()),
            // The channel's pretap (2009). `mix_parameter_allowed` keeps it on channels: the row is
            // printed by the channel block alone.
            "ptap" => Some("/ptap".to_string()),
            // The matrix direct input (2711-2715): its own node, and `mix_parameter_allowed` keeps
            // the four keys on the matrix.
            "dir_on" => Some("/dir/on".to_string()),
            "dir_level" => Some("/dir/lvl".to_string()),
            "dir_invert" => Some("/dir/inv".to_string()),
            "dir_source" => Some("/dir/in".to_string()),
            "solo_safe" => Some("/solosafe".to_string()),
            // The solo switch itself (1999, 2250, 2394, 2565, 2732): every mix family has it, and
            // the console reports it, so it is a watch as well as a write. Not to be confused with
            // the read-only `$sololed` (2000, 2251, …), which is not a catalogue key.
            "solo" => Some("/$solo".to_string()),
            // The delay leaves move with the family: `/in/set/dly*` on ch and aux (1947-1953,
            // 2217-2222), `/dly/*` on bus, main and matrix (2517-2523, 2680-2686, 2844-2850).
            "delay_on" if matches!(category, "ch" | "aux") => Some("/in/set/dlyon".to_string()),
            "delay_mode" if matches!(category, "ch" | "aux") => Some("/in/set/dlymode".to_string()),
            "delay_time" if matches!(category, "ch" | "aux") => Some("/in/set/dly".to_string()),
            "delay_on" => Some("/dly/on".to_string()),
            "delay_mode" => Some("/dly/mode".to_string()),
            "delay_time" => Some("/dly/dly".to_string()),
            // Sends: prefix and index come from the destination, so a family can never resolve to
            // a node it does not have (a matrix has no send node at all, and a main only has matrix
            // sends). The leaf table lives in `send_leaf`.
            parameter if send_destination(category, parameter).is_some() => {
                send_parameter_path(category, parameter, send_id)
            }
            _ => None,
        }
    }

    /// What a send parameter addresses: the destination family, its documented size and the OSC
    /// node its sends live under. Used by the resolver (prefix and index bound) and published for
    /// the editor, which bounds its destination selector with it.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct SendDestination {
        /// `"bus"`, `"matrix"` or `"main"`.
        pub key: &'static str,
        /// `"Bus"`, `"Matrix"` or `"Main"`.
        pub label: &'static str,
        /// Highest documented index: buses 16 (2168), matrices 8 (2670), mains 4 (2153).
        pub max: u8,
    }

    const SEND_DESTINATION_BUS: SendDestination = SendDestination {
        key: "bus",
        label: "Bus",
        max: 16,
    };
    const SEND_DESTINATION_MATRIX: SendDestination = SendDestination {
        key: "matrix",
        label: "Matrix",
        max: 8,
    };
    const SEND_DESTINATION_MAIN: SendDestination = SendDestination {
        key: "main",
        label: "Main",
        max: 4,
    };

    /// What `send_id` addresses for this (category, parameter) pair, or None when the parameter
    /// takes no destination index at all — every non-send parameter, and every send parameter the
    /// family does not document (a matrix has no sends, a main has no `/send/<n>` bus send).
    pub fn send_destination(category: &str, parameter: &str) -> Option<SendDestination> {
        let category = normalize_category(category);
        let parameter = normalize_parameter(parameter);
        // The talkback assigns are addressed by the destination index the send parameters already
        // carry (Maillot 1469-1496, 1507-1534): `talk_bus_assign` is `B<n>` with the buses' own
        // 1…16, `talk_matrix_assign` is `MX<n>` with 1…8 and `talk_main_assign` is `M<n>` with 1…4.
        // They are asked before the mix gate because `talk` is not a mix family, and they answer the
        // very same `SendDestination` values the sends do — which is what makes the editor's
        // destination control, its bound and the backend's check work on them unchanged.
        if category == "talk" {
            return talk_assign_destination(&parameter);
        }
        if !mix_parameter_allowed(&category, &parameter) {
            return None;
        }
        match parameter.as_str() {
            // `/send/<n>/…`: bus sends (2158-2166, 2336-2343, 2500-2504).
            "send_level" | "send_on" | "send_pre" | "send_pre_always_on" | "send_pan"
            | "send_mode" => Some(SEND_DESTINATION_BUS),
            // `/send/MX<n>/…`: matrix sends (2168-2176, 2345-2353, 2506-2509, 2669-2673).
            "send_matrix_level" | "send_matrix_on" | "send_matrix_mode" | "send_matrix_pre" => {
                Some(SEND_DESTINATION_MATRIX)
            }
            // `/main/<n>/…`: main sends (2151-2156, 2330-2334, 2494-2498).
            "send_main_level" | "send_main_on" | "send_main_pre" => Some(SEND_DESTINATION_MAIN),
            _ => None,
        }
    }

    /// The destination a talkback assign key reuses: the buses' 1…16 (1469-1484, 1507-1522), the
    /// matrices' 1…8 (1485-1492, 1523-1530) and the mains' 1…4 (1493-1496, 1531-1534).
    fn talk_assign_destination(parameter: &str) -> Option<SendDestination> {
        match parameter {
            "talk_bus_assign" => Some(SEND_DESTINATION_BUS),
            "talk_matrix_assign" => Some(SEND_DESTINATION_MATRIX),
            "talk_main_assign" => Some(SEND_DESTINATION_MAIN),
            _ => None,
        }
    }

    /// The segment a talkback assign leaf is named by: `B16`, `MX8`, `M4` (1469, 1485, 1493).
    fn talk_assign_prefix(parameter: &str) -> Option<&'static str> {
        match parameter {
            "talk_bus_assign" => Some("B"),
            "talk_matrix_assign" => Some("MX"),
            "talk_main_assign" => Some("M"),
            _ => None,
        }
    }

    /// OSC node a destination's sends live under, with its trailing separator: `/send/` for buses,
    /// `/send/MX` for matrices and `/main/` for mains (2158, 2168, 2669). `SendDestination`
    /// deliberately carries no prefix, so the mapping stays in one place here.
    fn send_destination_prefix(destination: SendDestination) -> &'static str {
        match destination.key {
            "matrix" => "/send/MX",
            "main" => "/main/",
            _ => "/send/",
        }
    }

    /// The leaf of a send parameter (2154-2166, 2169-2176, 2502-2509, 2671-2673).
    fn send_leaf(parameter: &str) -> Option<&'static str> {
        match parameter {
            "send_level" | "send_matrix_level" | "send_main_level" => Some("lvl"),
            "send_on" | "send_matrix_on" | "send_main_on" => Some("on"),
            "send_pre" | "send_matrix_pre" | "send_main_pre" => Some("pre"),
            "send_pre_always_on" => Some("pon"),
            "send_pan" => Some("pan"),
            "send_mode" | "send_matrix_mode" => Some("mode"),
            _ => None,
        }
    }

    /// The resolved destination index, or None when it falls outside the destination. Maillot gives
    /// each one its size (bus 1…16 at 2168, matrix 1…8 at 2670, main 1…4 at 2153): a ninth matrix
    /// send or a fifth main send is a path the console ignores, so it resolves to nothing.
    fn send_index_for(category: &str, parameter: &str, send_id: Option<u8>) -> Option<u8> {
        let destination = send_destination(category, parameter)?;
        // No destination, no address — on every family, not only on a bus. Defaulting to send 1 was
        // harmless on ch/aux/main and wrong on a bus (bus 1 sends to itself, footnote 38), but the
        // operator still cannot see which destination a macro writes: a step that says "Send Level"
        // and means bus 1 in silence is the defect this rule exists to prevent. The editor asks for
        // the destination before it builds the address.
        let index = send_id?;
        (index > 0 && index <= destination.max).then_some(index)
    }

    /// `/send/7/lvl`, `/send/MX3/pre`, `/main/2/on`: the send leaf prefixed by its destination.
    fn send_parameter_path(
        category: &str,
        parameter: &str,
        send_id: Option<u8>,
    ) -> Option<String> {
        let destination = send_destination(category, parameter)?;
        let index = send_index_for(category, parameter, send_id)?;
        let leaf = send_leaf(parameter)?;
        Some(format!(
            "{}{index}/{leaf}",
            send_destination_prefix(destination)
        ))
    }

    fn mix_parameter_allowed(category: &str, parameter: &str) -> bool {
        if mix_family(category).is_none() {
            return false;
        }
        if matches!(parameter, "gain" | "alt_source" | "phantom_48v") {
            // Only channels and aux strips have a head amp (`$g`), an alternative
            // source and phantom power: `/bus/1/in/set/$g`, `altsrc` and `$vph` do
            // not exist (Maillot 2375-2378, 2546-2549, 2706-2709).
            return matches!(category, "ch" | "aux");
        }
        if matches!(parameter, "trim" | "phase") {
            // The digital trim and the polarity inverter are documented on EVERY
            // mix family: `/bus/1/in/set/trim` and `/inv` (Maillot 2376-2377),
            // `/main/1/in/set/trim` and `/inv` (2547-2548), `/mtx/1/in/set/trim`
            // and `/inv` (2707-2708). Refusing them for bus/main/matrix left the
            // step unconfigured with no way to invert polarity there.
            return true;
        }
        if parameter.starts_with("flt_")
            || matches!(parameter, "hpf_on" | "hpf_freq" | "lpf_on" | "lpf_freq")
        {
            // Aux has no filter node at all: `/aux/1/flt/lc` is silent and the
            // reference lists no `/aux/<i>/flt`. Offering the filter to aux
            // produced a write the console ignored.
            // Verified read-only on WING Rack (FW 3.1.1), 2026-09-21.
            //
            // The same node carries the low/high cut slopes, the tool filter, the model and the tilt
            // level (1970-1979), so `flt_low_slope`, `flt_high_slope`, `flt_tool`, `flt_model` and
            // `flt_tilt` fail closed with the four switches: a bus, a main and a matrix have no
            // `/flt` node either (2374-2378, 2545-2549, 2705-2709 print no such row).
            return category == "ch";
        }
        if parameter == "ptap" {
            // `/ch/1/ptap` (2009) is printed by the channel block alone: no aux, bus, main or matrix
            // documents a pretap row, so the key fails closed there instead of building a path the
            // console ignores in silence.
            return category == "ch";
        }
        if parameter.starts_with("peq_") || parameter == "proc_order" {
            // The PreSend EQ (2013-2023) and the process order (2003-2008) are documented in the
            // channel block alone: neither node exists on aux, bus, main or matrix.
            return category == "ch";
        }
        if matches!(parameter, "dyn_detector" | "dyn_envelope" | "dyn_auto") {
            // The detector, the envelope and the auto switch are printed by a channel (2113-2118),
            // a bus (2457-2462), a main (2629-2634) and a matrix (2799-2810). The aux block stops
            // its dynamics node at `mix` and `gain` (2294-2297), so the three keys are refused there
            // rather than aimed at rows the reference does not give an aux.
            return matches!(category, "ch" | "bus" | "main" | "matrix");
        }
        if parameter == "bus_mono" {
            // `/bus/1/busmono` (2389), `/main/1/busmono` (2560), `/mtx/1/busmono` (2727): the mono
            // switch is documented on the three output families and on no channel or aux.
            return matches!(category, "bus" | "main" | "matrix");
        }
        if parameter.starts_with("dir_") {
            // `/mtx/1/dir/{on,lvl,inv,in}` (2711-2715): the direct input is the matrix's own node.
            // No channel, aux, bus or main prints a `/dir` row, so the four keys fail closed there
            // instead of building a path the console ignores in silence.
            return category == "matrix";
        }
        if matches!(parameter, "input_balance" | "source_auto") {
            // `/in/set/bal` and `/in/set/srcauto` (1941, 1937 and 2214, 2210): the two input-set
            // leaves the connection node brought with it. `bal` is also printed by the bus, main and
            // matrix input sets (2378, 2549, 2709) but the key is offered where the batch's scope
            // puts it — the two strips that can connect an input at all — while `srcauto` exists on
            // those two alone.
            return matches!(category, "ch" | "aux");
        }
        if parameter == "eq_tilt" {
            // `/bus/1/eq/tilt` (2441), `/main/1/eq/tilt` (2612), `/mtx/1/eq/tilt` (2782): the
            // channel and aux EQ nodes end at `heq` (2094, 2283) and print no tilt row.
            return matches!(category, "bus" | "main" | "matrix");
        }
        if matches!(
            parameter,
            "eq_5_gain" | "eq_5_freq" | "eq_5_q" | "eq_6_gain" | "eq_6_freq" | "eq_6_q"
        ) {
            // Maillot documents bands 5 and 6 on bus (2431-2434), main (2600-2605)
            // and matrix (2770-2775); the channel and aux EQs stop at band 4
            // (2070-2081, 2268-2279).
            return matches!(category, "bus" | "main" | "matrix");
        }
        if parameter.starts_with("gate_") {
            // Maillot lists `/aux/1/gate/*`, but the console exposes no aux gate
            // node at all: `/aux/1/gate`, `/aux/1/gate/range` and
            // `/aux/2/gate/mdl` are silent while `/aux/1/dyn/on` and
            // `/aux/1/dyn/thr` answer. Aux strips carry a compressor, not a gate.
            return category == "ch";
        }
        if parameter.starts_with("send_") {
            // Sends are offered per family, exactly as Maillot documents them (the 3.1.0 tables
            // repeat the generic mix layout, so a text comparison alone would hand a matrix a send
            // node it does not have):
            //   * `/send/<n>/…` bus sends — ch, aux and bus only. A main has no numeric send node
            //     (`/main/1/send/1/lvl` is silent, hardware-verified on WING Rack FW 3.1.1)
            //     and a matrix has no `/mtx/N/send` node at all;
            //   * `pre`, `pon`, `pan` and `mode` are each documented for one destination only:
            //     `pre` on bus sends (2504), `pon`/`pan`/`mode` on ch and aux sends (2162-2163,
            //     2166, 2340-2343);
            //   * `/send/MX<n>/…` matrix sends — ch, aux, bus and main (2168, 2345, 2506, 2669);
            //     `mode` is documented for ch and aux (2173, 2350) and `pre` for bus and main
            //     (2509, 2673);
            //   * `/main/<n>/…` main sends — ch, aux and bus (2151, 2330, 2494); never main, which
            //     has no `/main/1/main` node, and never a matrix.
            return match parameter {
                "send_level" | "send_on" => matches!(category, "ch" | "aux" | "bus"),
                "send_pre" => category == "bus",
                "send_pre_always_on" | "send_pan" | "send_mode" => matches!(category, "ch" | "aux"),
                "send_matrix_level" | "send_matrix_on" => category != "matrix",
                "send_matrix_mode" => matches!(category, "ch" | "aux"),
                "send_matrix_pre" => matches!(category, "bus" | "main"),
                "send_main_level" | "send_main_on" | "send_main_pre" => {
                    matches!(category, "ch" | "aux" | "bus")
                }
                _ => false,
            };
        }
        if matches!(
            parameter,
            "post_insert_on" | "post_insert_slot" | "post_insert_mode" | "post_insert_weight"
        ) {
            // Every mix family answers `/postins/on` except aux: verified read-only
            // on WING Rack (FW 3.1.1) for ch, bus, main and mtx, and a
            // write test on `/aux/1/postins/on` neither read nor changed anything
            // while `/aux/1/preins/on` works. Aux has a pre-insert, not a
            // post-insert. The post-insert mode and autogain weight are documented
            // for channels alone (2182, 2184).
            return match parameter {
                "post_insert_mode" | "post_insert_weight" => category == "ch",
                _ => matches!(category, "ch" | "bus" | "main" | "matrix"),
            };
        }
        if matches!(
            parameter,
            "input_conn_group" | "input_conn_index" | "input_conn_alt_group" | "input_conn_alt_index"
        ) {
            // Channels and aux are the only strips with an input connection node: `/ch/1/in/conn/*`
            // (1955-1965) and `/aux/1/in/conn/*` (2224-2233). A bus, a main and a matrix have an
            // `/in/set` node that lists `inv`, `trim` and `bal` and no `conn` child at all
            // (2374-2378, 2545-2549, 2705-2709) — their input is a fixed internal feed, so the four
            // keys fail closed there instead of building a path the console ignores in silence.
            return matches!(category, "ch" | "aux");
        }
        if parameter == "solo_safe" {
            // `/ch/1/solosafe` (2001) and `/aux/1/solosafe` (2252) are the only rows in the
            // reference: there is no solosafe leaf on bus, main, matrix or DCA, so offering it
            // there produced a write the console ignores.
            return matches!(category, "ch" | "aux");
        }
        // Everything left is documented on every mix family, and is offered on every one of them:
        // the tags (2187, 2355, 2525, 2688, 2852), the EQ model, the EQ mix and the two band-type
        // lists (2059-2094, 2257-2283, 2400-2442, 2571-2611, 2738-2782), and the dynamics sidechain
        // node the five families all print (2130, 2315, 2478, 2653, 2823). The per-family part of
        // those rows is the overlay's, not this gate's: a family keeps the key and changes the
        // bound or the list.
        true
    }

    /// True when a category key names the oscillator input node.
    ///
    /// One definition for three rules: the `source_mode` write the oscillator's `[RO]` row forbids, the
    /// oscillator's own source leaves (`osc_*`, 1789-1793) that belong to this node alone, and the
    /// polarity leaf the node lacks (see [`source_parameter_allowed`]). The aliases are the ones
    /// [`source_input_prefix`] accepts, so a caller that spells the oscillator `oscillator` gets the
    /// same answer as the catalogue key `preamp_oscillator`; `normalize_category` maps `osc` onto that
    /// key before any resolver runs.
    fn is_oscillator_source(category: &str) -> bool {
        matches!(category, "preamp_oscillator" | "oscillator" | "osc")
    }

    fn source_parameter_allowed(category: &str, parameter: &str) -> bool {
        if matches!(parameter, "gain" | "phantom_48v") {
            return matches!(
                category,
                "preamp_local" | "preamp_aes50a" | "preamp_aes50b" | "preamp_aes50c"
            );
        }
        if parameter == "source_mode" {
            // Every physical input group prints `/io/in/<group>/<n>/mode` (1599, 1618, 1629, 1652,
            // 1671, 1690, 1702, 1713, 1724, 1735, 1747, 1760) — and the oscillator's row as `[RO]`
            // (1781). A `[RO]` leaf is one the console reports and does not take, so offering it as a
            // write would build an address the console drops in silence while the app reported
            // success. The key is therefore kept off the oscillator, exactly as `/io/in/OSC/1/pol` is
            // kept off it below for the same reason. Note this also keeps the key out of the category's
            // *watch* list: one catalogue key cannot be a write nowhere and a trigger somewhere.
            return !is_oscillator_source(category);
        }
        if matches!(parameter, "osc_level" | "osc_mode" | "osc_freq") {
            // The oscillator's own source sub-node (1789-1793): the `osc` leaves are documented for
            // `/io/in/OSC` alone, and this table is shared by every physical input, so
            // `/io/in/LCL/1/osc/lvl` — a path the console ignores — can never be built. Unlike the
            // node's `mode`, these three carry no `[RO]`: they are ordinary writable leaves.
            return is_oscillator_source(category);
        }
        if parameter == "phase" {
            // Maillot documents the oscillator input node with mode, mute, col,
            // name, icon and tags only; there is no polarity leaf and
            // `/io/in/OSC/1/pol` is silent on the console, while
            // `/io/in/USB/1/pol` answers. Verified read-only on WING Rack
            // (FW 3.1.1), 2026-09-21.
            return !is_oscillator_source(category);
        }
        true
    }

    fn eq_parameter_path(category: &str, parameter: &str) -> Option<String> {
        let mut parts = parameter.split('_');
        let prefix = parts.next()?;
        let band = parts.next()?;
        let field = parts.next()?;
        if prefix != "eq" || parts.next().is_some() {
            return None;
        }
        // Maillot 3.1.0, channel EQ (STD model): the low band is addressed as
        // `/eq/lg`, `/eq/lf`, `/eq/lq` and the high band as `/eq/hg`, `/eq/hf`,
        // `/eq/hq`; the four parametric bands as `/eq/<n>g`, `<n>f`, `<n>q`.
        // There is no band 5 or 6 in the STD model, so those are not offered.
        // Verified by read-only leaf reads: `/ch/1/eq/lg`, `/eq/lq`, `/eq/hg`,
        // `/eq/1g`, `/eq/2g`, `/eq/4g` answer while `/eq/5g` and `/eq/6q` are
        // silent. Note the document renders the low gain as `lg24`, where `24` is
        // a footnote reference and not part of the path.
        let suffix = match field {
            "gain" => "g",
            "freq" => "f",
            "q" => "q",
            _ => return None,
        };
        match band {
            "low" => Some(format!("/eq/l{suffix}")),
            "high" => Some(format!("/eq/h{suffix}")),
            _ => {
                let number = band.parse::<u8>().ok()?;
                // Bands 5 and 6 exist on bus, main and matrix (Maillot 2431-2434, 2600-2605,
                // 2770-2775); the channel and aux EQs stop at band 4 (2070-2081, 2268-2279). The
                // catalogue offers them by family and this is the other half of the same rule.
                let max_band = if matches!(category, "bus" | "main" | "matrix") {
                    6
                } else {
                    4
                };
                if !(1..=max_band).contains(&number) {
                    return None;
                }
                Some(format!("/eq/{number}{suffix}"))
            }
        }
    }

    fn source_meter_info(category: &str) -> Option<(u8, &'static str, &'static str)> {
        match category {
            "preamp_local" | "local" | "lcl" => Some((1, "/meters/preamp/local", "Local")),
            "preamp_aux" | "auxin" | "aux_in" => Some((2, "/meters/preamp/aux", "Aux Source")),
            "preamp_aes50a" | "aes50a" | "aes50_a" | "stagea" => Some((3, "/meters/preamp/stagea", "AES50-A")),
            "preamp_aes50b" | "aes50b" | "aes50_b" | "stageb" => Some((4, "/meters/preamp/stageb", "AES50-B")),
            "preamp_aes50c" | "aes50c" | "aes50_c" | "stagec" => Some((5, "/meters/preamp/stagec", "AES50-C")),
            "preamp_stageconnect" | "stageconnect" | "sc" => Some((6, "/meters/preamp/stageconnect", "StageConnect")),
            "usb" => Some((7, "/meters/usb", "USB")),
            // `wlive` is deliberately **not** an alias any more. It was one for the card *input*
            // source's meters, and batch 6 gives the bare name to the W-Live multitrack card
            // (`/cards/wlive/<n>`, 2966-2998): one key cannot mean two nodes without a show file
            // meaning something its editor never offered. The card source is still reachable under
            // every other spelling below, and `preamp_wlive` keeps working through
            // `normalize_category`. Batch 4 did the same for `play`.
            "preamp_card" | "card" | "crd" | "dante" | "dante_card" => Some((8, "/meters/preamp/card", "Card")),
            "preamp_module" | "module" | "mod" | "dante_module" => Some((9, "/meters/preamp/module", "Module")),
            "preamp_usbplayer" | "usbplayer" => Some((10, "/meters/preamp/usbplayer", "USB Player")),
            "preamp_aesebu" | "aesebu" | "aes" => Some((11, "/meters/preamp/aesebu", "AES/EBU")),
            "usersig" | "usr" => Some((12, "/meters/usersig", "User Signal")),
            "preamp_oscillator" | "oscillator" | "osc" => Some((13, "/meters/preamp/oscillator", "Oscillator")),
            "preamp_bus" | "bus_src" => Some((14, "/meters/preamp/bus", "Bus Source")),
            "preamp_main" | "main_src" => Some((15, "/meters/preamp/main", "Main Source")),
            "preamp_matrix" | "matrix_src" | "mtx_src" => Some((16, "/meters/preamp/matrix", "Matrix Source")),
            _ => None,
        }
    }

    fn output_meter_info(category: &str) -> Option<(u8, &'static str, &'static str)> {
        match category {
            "output_local" | "out_local" | "out_lcl" => Some((1, "/meters/output/local", "Local Out")),
            "output_aux" | "out_aux" => Some((2, "/meters/output/aux", "Aux Out")),
            "output_aes50a" | "out_aes50a" | "out_stagea" => Some((3, "/meters/output/stagea", "AES50-A Out")),
            "output_aes50b" | "out_aes50b" | "out_stageb" => Some((4, "/meters/output/stageb", "AES50-B Out")),
            "output_aes50c" | "out_aes50c" | "out_stagec" => Some((5, "/meters/output/stagec", "AES50-C Out")),
            "output_stageconnect" | "out_stageconnect" | "out_sc" => Some((6, "/meters/output/stageconnect", "StageConnect Out")),
            "output_usb" | "out_usb" => Some((7, "/meters/output/usb", "USB Out")),
            "output_card" | "out_card" | "out_crd" | "out_dante" => Some((8, "/meters/output/card", "Card Out")),
            "output_module" | "out_module" | "out_mod" => Some((9, "/meters/output/module", "Module Out")),
            "output_usbrec" | "out_usbrec" => Some((10, "/meters/output/usbrec", "USB Rec Out")),
            "output_aesebu" | "out_aesebu" | "out_aes" => Some((11, "/meters/output/aesebu", "AES/EBU Out")),
            _ => None,
        }
    }

    fn source_device_id(category: &str) -> Option<u8> {
        source_meter_info(category).map(|(device_id, _base, _label)| device_id)
    }

    fn output_device_id(category: &str) -> Option<u8> {
        output_meter_info(category).map(|(device_id, _base, _label)| device_id)
    }

    fn mix_family(category: &str) -> Option<MeterFamily> {
        match category {
            "ch" => Some(MeterFamily::Ch),
            "aux" => Some(MeterFamily::Aux),
            "bus" => Some(MeterFamily::Bus),
            "main" => Some(MeterFamily::Main),
            "matrix" => Some(MeterFamily::Matrix),
            _ => None,
        }
    }

    fn special_meter_family(category: &str) -> Option<MeterFamily> {
        match category {
            "dca" => Some(MeterFamily::Dca),
            "fx" => Some(MeterFamily::Fx),
            _ => None,
        }
    }

    fn normal_meter_family_and_label(category: &str) -> Option<(MeterFamily, &'static str)> {
        match category {
            "ch" => Some((MeterFamily::Ch, "ch")),
            "aux" => Some((MeterFamily::Aux, "aux")),
            "bus" => Some((MeterFamily::Bus, "bus")),
            "main" => Some((MeterFamily::Main, "main")),
            "matrix" => Some((MeterFamily::Matrix, "matrix")),
            "dca" => Some((MeterFamily::Dca, "dca")),
            "fx" => Some((MeterFamily::Fx, "fx")),
            _ => None,
        }
    }

    pub(crate) fn v2_meter_family_and_slot(
        category: &str,
        parameter: &str,
    ) -> Option<(MeterFamily, &'static str, usize)> {
        let family = match category {
            "ch" => (MeterFamily::ChV2, "chv2"),
            "aux" => (MeterFamily::AuxV2, "auxv2"),
            "bus" => (MeterFamily::BusV2, "busv2"),
            "main" => (MeterFamily::MainV2, "mainv2"),
            "matrix" => (MeterFamily::MatrixV2, "matrixv2"),
            _ => return None,
        };
        // Maillot table 5 (doc. 3.1.0, lines 4487-4497): input left / input right / output left /
        // output right / gate key / gate gain / **gate led** / dyn key / dyn gain / dyn state /
        // automix gain. Slot 8 is `dyn gain` (in dB), not the LED: with 8 a compressor gain was
        // compared against a boolean threshold and the V2 gate indicator could never work.
        let slot = match parameter {
            "meter_v2_gate_led" => 6,
            "meter_v2_dyn_state" => 9,
            "meter_v2_automix" => 10,
            _ => return None,
        };
        Some((family.0, family.1, slot))
    }

    fn v2_meter_field(parameter: &str) -> Option<&'static str> {
        match parameter {
            "meter_v2_gate_led" => Some("gate_led"),
            "meter_v2_dyn_state" => Some("dyn_state"),
            "meter_v2_automix" => Some("automix_gain"),
            _ => None,
        }
    }

    fn monitor_meter_label(id: u16) -> Option<&'static str> {
        match id {
            1 => Some("solo_l"),
            2 => Some("solo_r"),
            3 => Some("mon1_l"),
            4 => Some("mon1_r"),
            5 => Some("mon2_l"),
            6 => Some("mon2_r"),
            _ => None,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn target(category: &str, ids: &str, parameter: &str) -> BasicTargetSpec {
            BasicTargetSpec {
                category: category.to_string(),
                ids: ids.to_string(),
                parameter: parameter.to_string(),
                send_id: None,
                custom_address: None,
            }
        }

        /// The same, with an explicit send destination: the new send keys take their index and
        /// their bound from it (Maillot 2168, 2670, 2153).
        fn send_target(
            category: &str,
            ids: &str,
            parameter: &str,
            send_id: u8,
        ) -> BasicTargetSpec {
            BasicTargetSpec {
                send_id: Some(send_id),
                ..target(category, ids, parameter)
            }
        }

        #[test]
        fn parses_lists_and_ranges() {
            assert_eq!(parse_ids("1, 2, 2, 4", 256), vec![1, 2, 4]);
            assert_eq!(parse_ids("4-2", 256), vec![2, 3, 4]);
            assert_eq!(
                parse_ids("1-4, 7, 9-11", 256),
                vec![1, 2, 3, 4, 7, 9, 10, 11]
            );
            assert_eq!(parse_ids("", 256), Vec::<u16>::new());
        }

        #[test]
        fn parse_ids_caps_loose_ids_and_ranges() {
            // The loop checks `max` before every item, so both branches are capped (the "loose ids can
            // exceed the cap" finding was a false positive).
            assert_eq!(parse_ids("1,2,3,4,5", 3), vec![1, 2, 3]);
            assert_eq!(parse_ids("1-10", 4), vec![1, 2, 3, 4]);
        }

        #[test]
        fn resolves_the_lmt_compressor_section() {
            // Hardware-confirmed on WING Rack (FW 3.1.1), where /mtx/1/dyn/mdl reports LMT.
            for (parameter, address) in [
                // The category key is `matrix`; its OSC prefix is `/mtx`.
                ("dyn_tspd", "/mtx/1/dyn/tspd"),
                ("dyn_trans", "/mtx/1/dyn/trans"),
                ("dyn_tgain", "/mtx/1/dyn/tgain"),
                ("dyn_ton", "/mtx/1/dyn/ton"),
                ("dyn_comp", "/mtx/1/dyn/comp"),
                ("dyn_cgain", "/mtx/1/dyn/cgain"),
                ("dyn_con", "/mtx/1/dyn/con"),
            ] {
                assert_eq!(
                    resolve_basic_addresses(&target("matrix", "1", parameter)),
                    vec![address.to_string()],
                    "{parameter} must resolve to {address}"
                );
            }
        }

        /// A name the appendix lists for *some* model is not automatically a name this strip has:
        /// the same section on a different model can lack it entirely (`DEQ2` has `1-thr`, not
        /// `thr`; `WARM` has no `thr` at all). The address is well formed either way, so the check
        /// has to happen before the write leaves the app.
        #[test]
        fn a_model_parameter_is_checked_against_the_strips_model() {
            assert!(model_parameter_problem("gate", "1-thr", "DEQ2").is_none());
            let problem = model_parameter_problem("gate", "thr", "DEQ2")
                .expect("DEQ2 does not have a bare thr");
            assert!(problem.contains("DEQ2"), "{problem}");
            assert!(problem.contains("1-thr"), "{problem}");
            assert!(model_parameter_problem("dyn", "thr", "COMP").is_none());
            assert!(model_parameter_problem("dyn", "thr", "WARM").is_some());
            assert!(model_parameter_problem("eq", "1g", "STD").is_none());
            // A letter suffix resolves through the alias table, so a real variant is not refused.
            assert!(model_parameter_problem("gate", "thr", "D241G").is_none());
            // An unknown model is refused rather than silently trusted.
            assert!(model_parameter_problem("gate", "thr", "XYZ").is_some());
            // No model known: nothing to check, and the caller keeps its own note.
            assert!(model_parameter_problem("gate", "thr", "").is_none());
            // Only the three model slots exist.
            assert!(model_parameter_problem("flt", "tilt", "TILT").is_some());
            assert!(model_parameter_names("DEQ2").contains(&"1-thr"));
            assert!(model_parameter_names("not a model").is_empty());
        }

        /// Model parameters are addressed as `<section>:<appendix name>`; the name is validated
        /// against the generated table so a typo cannot become a silent write, and the section has to
        /// exist on the family (no gate on an aux strip).
        #[test]
        fn resolves_model_parameters_by_section_and_appendix_name() {
            assert_eq!(
                resolve_basic_addresses(&target("ch", "3", "gate:1-thr")),
                vec!["/ch/3/gate/1-thr".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("ch", "3", "dyn:tspd")),
                vec!["/ch/3/dyn/tspd".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("main", "1", "dyn:drv")),
                vec!["/main/1/dyn/drv".to_string()]
            );
            // Matrices use the catalogue key `matrix`; their OSC prefix is `/mtx`.
            assert_eq!(
                resolve_basic_addresses(&target("matrix", "2", "eq:1g")),
                vec!["/mtx/2/eq/1g".to_string()]
            );
            // The gate node only exists on channels, and a name that is in no appendix table is
            // refused instead of producing a path the console would ignore.
            assert!(resolve_basic_addresses(&target("aux", "1", "gate:1-thr")).is_empty());
            assert!(resolve_basic_addresses(&target("ch", "1", "gate:not-a-real-parameter")).is_empty());
            assert!(resolve_basic_addresses(&target("ch", "1", "postins:on")).is_empty());
        }

        #[test]
        fn resolves_the_model_dependent_gate_and_compressor_parameters() {
            // Maillot 3.1.0 plugin appendices, verified read-only on WING Rack (FW 3.1.1):
            // a DEQ2 strip answers /gate/1-thr, /gate/2-thr and /gate/1-g while /gate/thr is silent;
            // a WARM compressor answers /dyn/drv, /dyn/trim and /dyn/mix while /dyn/thr is silent.
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "gate_1_thr")),
                vec!["/ch/1/gate/1-thr".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "gate_2_thr")),
                vec!["/ch/1/gate/2-thr".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "gate_1_gain")),
                vec!["/ch/1/gate/1-g".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("main", "1", "dyn_drv")),
                vec!["/main/1/dyn/drv".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("main", "1", "dyn_mix")),
                vec!["/main/1/dyn/mix".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("main", "1", "dyn_trim")),
                vec!["/main/1/dyn/trim".to_string()]
            );
            // The gate only exists on channels; the compressor parameters are open to every mix strip
            // because any of them can load WARM (the read-back names the model when it does not).
            assert_eq!(resolve_basic_addresses(&target("aux", "1", "gate_1_thr")), Vec::<String>::new());
        }

        #[test]
        fn resolves_alt_source_target() {
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1-2", "alt_source")),
                vec![
                    "/ch/1/in/set/altsrc".to_string(),
                    "/ch/2/in/set/altsrc".to_string()
                ]
            );
            assert_eq!(
                resolve_basic_addresses(&target("aux", "3", "alt_source")),
                vec!["/aux/3/in/set/altsrc".to_string()]
            );
        }

        #[test]
        fn resolves_show_critical_wing_targets() {
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1-2", "mute")),
                vec!["/ch/1/mute".to_string(), "/ch/2/mute".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("bus", "1", "fader")),
                vec!["/bus/1/fdr".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("preamp_aes50a", "7", "gain")),
                vec!["/io/in/A/7/g".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("usb", "1", "meter")),
                vec!["/meters/usb/1".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("matrix", "3", "mute")),
                vec!["/mtx/3/mute".to_string()]
            );
        }

        #[test]
        fn resolves_maillot_source_and_output_meter_sources() {
            assert_eq!(
                resolve_basic_addresses(&target("preamp_aes50a", "12", "meter")),
                vec!["/meters/preamp/stagea/12".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("preamp_stageconnect", "2", "meter")),
                vec!["/meters/preamp/stageconnect/2".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("usersig", "24", "meter")),
                vec!["/meters/usersig/24".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("output_aes50b", "16", "meter")),
                vec!["/meters/output/stageb/16".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("output_usbrec", "4", "meter")),
                vec!["/meters/output/usbrec/4".to_string()]
            );
        }

        #[test]
        fn resolves_monitor_rta_and_v2_meter_addresses() {
            assert_eq!(
                resolve_basic_addresses(&target("monitor", "1,6", "meter_monitor")),
                vec![
                    "/meters/monitor/solo_l".to_string(),
                    "/meters/monitor/mon2_r".to_string()
                ]
            );
            assert_eq!(
                resolve_basic_addresses(&target("rta", "1,120", "meter_rta_band")),
                vec!["/meters/rta/1".to_string(), "/meters/rta/120".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("ch", "2", "meter_v2_automix")),
                vec!["/meters/chv2/2/automix_gain".to_string()]
            );

            let targets = resolve_meter_targets(&target("ch", "2", "meter_v2_automix"));
            assert_eq!(targets[0].family, "chv2");
            assert_eq!(targets[0].value_slot, 10);
        }

        /// A meter index is bounded by the family exactly as a write is: a hand-edited show or an
        /// Android import could ask for channel 100, the address came out well formed, the resolve
        /// preflight saw it as non-empty, and the trigger could never match an event (macro audit of
        /// 2026-09-24, item A2). The bound is the *meter* space, which is the family's own — see
        /// `meter_id_allowed`.
        #[test]
        fn a_meter_index_outside_the_family_is_refused() {
            // Every mix family has as many meter strips as it has targets.
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1,40", "meter")),
                vec!["/meters/ch/1", "/meters/ch/40"]
            );
            assert!(resolve_basic_addresses(&target("ch", "41", "meter")).is_empty());
            assert!(resolve_meter_targets(&target("ch", "41", "meter")).is_empty());
            assert!(meter_descriptors_for_target(&target("ch", "41", "meter")).is_empty());

            // A bus source is a meter-only group: 32 preamp meters, not the 16 bus targets.
            assert_eq!(
                resolve_basic_addresses(&target("preamp_bus", "32", "meter")),
                vec!["/meters/preamp/bus/32"]
            );
            assert!(resolve_basic_addresses(&target("preamp_bus", "33", "meter")).is_empty());
            assert!(meter_descriptors_for_target(&target("preamp_bus", "33", "meter")).is_empty());
            // Main sources take 8, matrix sources 16 (Maillot table 5's source groups).
            assert_eq!(
                resolve_basic_addresses(&target("preamp_main", "8", "meter")),
                vec!["/meters/preamp/main/8"]
            );
            assert!(resolve_basic_addresses(&target("preamp_main", "9", "meter")).is_empty());
            assert_eq!(
                resolve_basic_addresses(&target("preamp_matrix", "16", "meter")),
                vec!["/meters/preamp/matrix/16"]
            );
            assert!(resolve_basic_addresses(&target("preamp_matrix", "17", "meter")).is_empty());

            // A device's meter count is the hardware's, not the target count of the phrase: the USB
            // recorder has four meters and the AES/EBU output two.
            assert!(resolve_basic_addresses(&target("output_usbrec", "5", "meter")).is_empty());
            assert!(resolve_basic_addresses(&target("output_aesebu", "3", "meter")).is_empty());

            // The bounded families keep the meters they really have, so the guard cannot pass by
            // refusing everything.
            assert_eq!(
                resolve_basic_addresses(&target("ch", "40", "meter_v2_automix")),
                vec!["/meters/chv2/40/automix_gain"]
            );
            assert!(resolve_basic_addresses(&target("ch", "41", "meter_v2_automix")).is_empty());
            assert_eq!(
                resolve_basic_addresses(&target("monitor", "6", "meter_monitor")),
                vec!["/meters/monitor/mon2_r"]
            );
            assert!(resolve_basic_addresses(&target("monitor", "7", "meter_monitor")).is_empty());
            assert_eq!(
                resolve_basic_addresses(&target("rta", "120", "meter_rta_band")),
                vec!["/meters/rta/120"]
            );
            assert!(resolve_basic_addresses(&target("rta", "121", "meter_rta_band")).is_empty());
            assert_eq!(
                resolve_basic_addresses(&target("dca", "16", "meter")),
                vec!["/meters/dca/16"]
            );
            assert!(resolve_basic_addresses(&target("dca", "17", "meter")).is_empty());
        }

        /// Two counts in the catalogue are the document's family maximum, not one desk's: the local
        /// inputs (footnote 17, 1641) and the GPIOs (footnote 122, 11536). With the model announced
        /// the bound is the desk's, and the refusal says which document line makes it so.
        #[test]
        fn the_two_counts_the_document_sizes_by_model_follow_the_desk() {
            assert_eq!(category_id_limit_for_model("preamp_local", DeskModel::Full), 8);
            assert_eq!(category_id_limit_for_model("preamp_local", DeskModel::Rack), 24);
            assert_eq!(category_id_limit_for_model("preamp_local", DeskModel::Compact), 24);
            // An alias resolves to the same category, and an unannounced model keeps the maximum.
            assert_eq!(category_id_limit_for_model("local", DeskModel::Unknown), 24);
            assert_eq!(category_id_limit_for_model("gpio", DeskModel::Compact), 2);
            assert_eq!(category_id_limit_for_model("gpiostate", DeskModel::Compact), 2);
            assert_eq!(category_id_limit_for_model("gpio", DeskModel::Full), 4);
            assert_eq!(category_id_limit_for_model("gpio", DeskModel::Unknown), 4);
            // Everything else is the family's count whatever the model is.
            assert_eq!(category_id_limit_for_model("ch", DeskModel::Compact), 40);
            assert_eq!(category_id_limit_for_model("bus", DeskModel::Full), 16);
            assert_eq!(category_id_limit_for_model("matrix", DeskModel::Rack), 8);

            assert!(!category_has_id_for_model("preamp_local", 9, DeskModel::Full));
            assert!(category_has_id_for_model("preamp_local", 8, DeskModel::Full));
            assert!(category_has_id_for_model("preamp_local", 9, DeskModel::Rack));
            assert!(category_has_id_for_model("preamp_local", 9, DeskModel::Unknown));
            assert!(!category_has_id_for_model("gpio", 3, DeskModel::Compact));
            assert!(category_has_id_for_model("gpio", 3, DeskModel::Rack));
            assert!(category_has_id_for_model("gpio", 3, DeskModel::Unknown));

            let full_problem = model_id_problem("preamp_local", "20", DeskModel::Full)
                .expect("a full-size console has eight local inputs");
            assert!(full_problem.contains("footnote 17"), "{full_problem}");
            assert!(full_problem.contains("full-size WING"), "{full_problem}");
            assert!(
                model_id_problem("preamp_local", "20", DeskModel::Rack).is_none(),
                "a Rack has twenty-four"
            );
            assert!(
                model_id_problem("preamp_local", "20", DeskModel::Unknown).is_none(),
                "an unannounced model keeps the documented maximum"
            );
            assert!(
                model_id_problem("preamp_local", "1-8", DeskModel::Full).is_none(),
                "the ids this desk does have must pass"
            );
            assert!(model_id_problem("gpio", "3", DeskModel::Compact)
                .expect("a Compact has two GPIOs")
                .contains("footnote 122"));
            assert!(model_id_problem("gpio", "3", DeskModel::Rack).is_none());
            // A category the model does not size is never refused by this rule: its own bound is the
            // documented one and `category_has_id` is what polices a channel 999.
            assert!(model_id_problem("ch", "999", DeskModel::Full).is_none());
        }

        /// A meter the desk does not have is a trigger that can never fire, and the model is what
        /// says so: the full-size console sends eight local meters where a Rack sends twenty-four
        /// (footnote 17, 1641), and a Compact has two GPIO inputs where the node prints four.
        #[test]
        fn the_meter_space_of_a_local_source_and_the_gpio_follow_the_desk() {
            assert_eq!(
                resolve_meter_targets_for_model(&target("preamp_local", "8", "meter"), DeskModel::Full)
                    .len(),
                1
            );
            assert!(resolve_meter_targets_for_model(
                &target("preamp_local", "12", "meter"),
                DeskModel::Full
            )
            .is_empty());
            assert_eq!(
                resolve_meter_targets_for_model(
                    &target("preamp_local", "12", "meter"),
                    DeskModel::Rack
                )
                .len(),
                1
            );
            // The unannounced model keeps the whole documented space, because the catalogue may not
            // shrink on a missing answer.
            assert_eq!(
                resolve_meter_targets_for_model(
                    &target("preamp_local", "12", "meter"),
                    DeskModel::Unknown
                )
                .len(),
                1
            );

            // The descriptor for the local group carries the desk's length, not the table's.
            let full = meter_descriptors_for_target_for_model(
                &target("preamp_local", "1", "meter"),
                DeskModel::Full,
            );
            assert_eq!(full.len(), 1);
            assert_eq!(full[0].group_words, crate::meters::GroupWords::Fixed(8));
            let rack = meter_descriptors_for_target_for_model(
                &target("preamp_local", "1", "meter"),
                DeskModel::Rack,
            );
            assert_eq!(rack[0].group_words, crate::meters::GroupWords::Fixed(24));

        }

        #[test]
        fn resolves_maillot_macro_target_parameters() {
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "trim")),
                vec!["/ch/1/in/set/trim".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "phantom_48v")),
                vec!["/ch/1/in/set/$vph".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "gate_thr")),
                vec!["/ch/1/gate/thr".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("bus", "1", "comp_thr")),
                vec!["/bus/1/dyn/thr".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("main", "1", "comp_thr")),
                vec!["/main/1/dyn/thr".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("matrix", "1", "comp_thr")),
                vec!["/mtx/1/dyn/thr".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "eq_4_q")),
                vec!["/ch/1/eq/4q".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "eq_low_gain")),
                vec!["/ch/1/eq/lg".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "eq_low_freq")),
                vec!["/ch/1/eq/lf".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("bus", "1", "eq_high_q")),
                vec!["/bus/1/eq/hq".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "insert_on")),
                vec!["/ch/1/preins/on".to_string()]
            );
        }

        /// A **source** trim is not a leaf: `/io/in/*` has the head amp (`/g`, 1600) and no `/trim`
        /// row, so the old mapping silently wrote a gain where the operator asked for a trim. It
        /// must resolve to nothing instead. The *input* trim on the mix families is a different,
        /// documented leaf (`/in/set/trim`, 1940, 2213) and keeps resolving.
        #[test]
        fn a_source_has_no_trim_leaf_and_the_input_trim_still_resolves() {
            for category in [
                "preamp_local",
                "preamp_aux",
                "preamp_aes50a",
                "preamp_card",
                "usb",
                "usersig",
            ] {
                assert!(
                    resolve_basic_addresses(&target(category, "1", "trim")).is_empty(),
                    "{category}/trim must not resolve: a source has no trim leaf"
                );
                let keys = target_parameters_for_category(category)
                    .into_iter()
                    .map(|parameter| parameter.key)
                    .collect::<Vec<_>>();
                assert!(
                    !keys.contains(&"trim"),
                    "{category} must not offer trim: {keys:?}"
                );
                // The head amp itself is untouched and still resolves.
                if matches!(
                    category,
                    "preamp_local" | "preamp_aes50a"
                ) {
                    assert_eq!(
                        resolve_basic_addresses(&target(category, "1", "gain")),
                        vec![format!(
                            "{}/1/g",
                            prefix_for_category(category).expect("a source prefix")
                        )]
                    );
                }
            }
            // The mix families keep the real input trim, and it is a different leaf from the gain.
            for category in ["ch", "aux", "bus", "main", "matrix"] {
                assert_eq!(
                    resolve_basic_addresses(&target(category, "1", "trim")),
                    vec![format!(
                        "{}/1/in/set/trim",
                        prefix_for_category(category).expect("a mix prefix")
                    )],
                    "{category} has /in/set/trim"
                );
            }
        }

        #[test]
        fn resolves_groups_outputs_fx_and_sends() {
            let mut send_target = target("ch", "1", "send_level");
            send_target.send_id = Some(12);
            assert_eq!(
                resolve_basic_addresses(&send_target),
                vec!["/ch/1/send/12/lvl".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("mutegroup", "2", "mute_group")),
                vec!["/mgrp/2/mute".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("output_usb", "8", "output_group")),
                vec!["/io/out/USB/8/grp".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("fx", "5", "fx_mix")),
                vec!["/fx/5/fxmix".to_string()]
            );
        }

        #[test]
        fn eq_catalogue_exposes_four_bands_plus_low_and_high() {
            let keys = target_parameters_for_category("ch")
                .into_iter()
                .map(|parameter| parameter.key)
                .filter(|key| key.starts_with("eq_"))
                .collect::<Vec<_>>();

            for band in 1..=4 {
                for field in ["gain", "freq", "q"] {
                    let key = format!("eq_{band}_{field}");
                    assert!(keys.contains(&key.as_str()), "missing {key}");
                }
            }
            for shelf in ["low", "high"] {
                for field in ["gain", "freq", "q"] {
                    let key = format!("eq_{shelf}_{field}");
                    assert!(keys.contains(&key.as_str()), "missing {key}");
                }
            }
            // The STD channel EQ has no band 5 or 6 (Maillot 2070-2081): they exist on bus, main
            // and matrix only, which is where the catalogue offers them.
            for removed in ["eq_5_gain", "eq_5_freq", "eq_5_q", "eq_6_gain", "eq_6_freq", "eq_6_q"] {
                assert!(!keys.contains(&removed), "{removed} must not be offered on a channel");
            }
            // `trim` and `phase` are documented on every mix family (see
            // `mix_parameter_allowed`), so they must be in the *whole* channel list.
            let channel_parameters = target_parameters_for_category("ch")
                .into_iter()
                .map(|parameter| parameter.key)
                .collect::<Vec<_>>();
            for present in ["trim", "phase"] {
                assert!(
                    channel_parameters.contains(&present),
                    "{present} is documented on channels"
                );
            }
        }

        #[test]
        fn a_comparison_is_validated_by_the_kind_of_the_value() {
            // The case the operator reported, now refused with a reason that says what to do:
            // a source name is text, so "rises above" cannot mean anything.
            let problem = watch_problem("preamp_aes50c", "name", ">", "-20").expect("refused");
            assert!(problem.contains("Name"), "{problem}");
            assert!(problem.contains("text"), "{problem}");
            assert!(problem.contains("=="), "the message must offer what works: {problem}");

            // The same name compared for equality is a real trigger ("when the input is called X").
            assert!(watch_problem("preamp_aes50c", "name", "==", "VOX 1").is_none());
            assert!(watch_problem("preamp_aes50c", "name", "!=", "VOX 1").is_none());
            // …but not a name longer than the console takes (Maillot 1677: 16 characters).
            assert!(watch_problem("preamp_aes50c", "name", "==", &"x".repeat(17)).is_some());

            // A meter is a level: only a crossing, and the value must be a number in range.
            assert!(watch_problem("ch", "meter", ">", "-20").is_none());
            assert!(watch_problem("ch", "meter", "==", "-20").is_some());
            assert!(watch_problem("ch", "meter", ">", "not a number").is_some());
            assert!(watch_problem("ch", "meter", ">", "-500").is_some());

            // On/off values are compared with 0/1, never with a dB threshold.
            assert!(watch_problem("ch", "mute", "==", "1").is_none());
            assert!(watch_problem("ch", "mute", "==", "0").is_none());
            assert!(watch_problem("ch", "mute", ">", "-18").is_some());
            assert!(watch_problem("ch", "mute", "==", "-18").is_some());

            // A V2 flag is a boolean meter, not a dB one (Maillot: gate LED and dyn state return 0/1).
            assert_eq!(watch_operators("ch", "meter_v2_gate_led"), &["==", "!="]);
            assert!(watch_problem("ch", "meter_v2_gate_led", "==", "1").is_none());
            assert!(watch_problem("ch", "meter_v2_gate_led", ">", "-18").is_some());

            // Numbers carry their own unit and range, so a frequency is not compared in dB.
            assert!(watch_problem("ch", "hpf_freq", ">", "100").is_none());
            assert!(watch_problem("ch", "hpf_freq", ">", "9000").is_some());
            assert!(watch_problem("ch", "fader", ">", "-500").is_some());

            // A parameter the console does not report cannot be watched at all.
            assert!(watch_problem("custom", "load_snapshot", "==", "x").is_some());
        }

        #[test]
        fn an_index_outside_the_family_is_refused() {
            // Maillot gives each family its size (channels 1-40, USB 1-48…). A hand-edited show could
            // ask for `/ch/999/mute`: the console ignores the write and the app said "completed".
            assert!(resolve_basic_addresses(&target("ch", "999", "mute")).is_empty());
            assert!(resolve_basic_addresses(&target("ch", "0", "mute")).is_empty());
            assert_eq!(
                resolve_basic_addresses(&target("ch", "40", "mute")),
                vec!["/ch/40/mute".to_string()]
            );
            assert!(resolve_basic_addresses(&target("usb", "49", "mute")).is_empty());
            assert_eq!(
                resolve_basic_addresses(&target("usb", "48", "mute")),
                vec!["/io/in/USB/48/mute".to_string()]
            );
            // Mixed lists keep what is real and drop what is not, instead of all-or-nothing.
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1,999,2", "mute")),
                vec!["/ch/1/mute".to_string(), "/ch/2/mute".to_string()]
            );
            assert!(category_has_id("ch", 40));
            assert!(!category_has_id("ch", 41));
        }

        #[test]
        fn the_console_has_four_user_controls_on_the_first_page() {
            // `/$ctl/user/<page>/<button>` is a page 1..16 with buttons 1..4 (Maillot 3933, 3942) and
            // the resolver builds page 1, so offering sixteen controls addressed twelve that do not
            // exist. This is the `ch 999` defect in another family.
            assert_eq!(
                resolve_basic_addresses(&target("userctrl", "4", "user_btn")),
                vec!["/$ctl/user/1/4/bu/mode".to_string()]
            );
            assert!(resolve_basic_addresses(&target("userctrl", "5", "user_btn")).is_empty());
            assert!(resolve_basic_addresses(&target("userctrl", "16", "user_btn")).is_empty());
            assert!(category_has_id("userctrl", 4));
            assert!(!category_has_id("userctrl", 5));
        }

        /// Show control is the catalogue's first index-less family: the documented path carries no
        /// id segment, so the id the editor holds — empty, because there is no id field to fill —
        /// must not stop the address resolving. `/$ctl/lib/$actionidx` is the address; the
        /// `/$ctl/lib/1/$actionidx` an indexed resolver would have built is one the console ignores
        /// while the app reports success.
        #[test]
        fn every_show_control_key_resolves_without_an_id_segment() {
            // The frozen list: the owning category, the key and the documented address (Maillot
            // 4105-4126). Checked against both catalogue tables below, so a key that is in one and
            // missing from the other fails here rather than becoming a dead selector.
            const DOCUMENTED: &[(&str, &str, &str)] = &[
                ("show", "scene_index", "/$ctl/lib/$actionidx"),
                ("show", "scene_action", "/$ctl/lib/$action"),
                ("showstate", "scene_active_index", "/$ctl/lib/$actidx"),
                ("showstate", "scene_active_name", "/$ctl/lib/$active"),
                ("showstate", "scene_active_tag", "/$ctl/lib/$activeid"),
                ("showstate", "scene_show_name", "/$ctl/lib/$actshow"),
                ("showstate", "scene_list", "/$ctl/lib/$scenes"),
            ];

            let mut listed: Vec<(&str, &str)> = Vec::new();
            for (category, parameters) in [
                ("show", target_parameters_for_category("show")),
                ("showstate", trigger_parameters_for_category("showstate")),
            ] {
                for parameter in parameters {
                    listed.push((category, parameter.key));
                }
            }
            let expected: Vec<(&str, &str)> =
                DOCUMENTED.iter().map(|(category, key, _)| (*category, *key)).collect();
            assert_eq!(listed, expected, "the catalogue tables and this list must be the same keys");

            for (category, parameter, address) in DOCUMENTED {
                // The id list is not part of the question: no id field at all, the single entry,
                // another number or a list all give the one documented address.
                for ids in ["", "1", "7", "1,2,3"] {
                    assert_eq!(
                        resolve_basic_addresses(&target(category, ids, parameter)),
                        vec![address.to_string()],
                        "{category}/{parameter} with ids \"{ids}\" must resolve to {address}"
                    );
                }
            }
            // The shape specifically, named as the document's opposite: the id never enters the path.
            assert_ne!(
                resolve_basic_addresses(&target("show", "1", "scene_action")),
                vec!["/$ctl/lib/1/$action".to_string()]
            );
        }

        /// The mechanism is a named property of a category, not a hole in the resolver: the indexed
        /// families keep their id and their bound, and every category whose id is not a plain index
        /// has to be added to the list below on purpose — the second shape (talkback's letter, and
        /// the fader layers' longer one) as much as the first (show control's absent segment).
        #[test]
        fn only_show_control_is_index_less_and_the_indexed_families_are_untouched() {
            let unusual: Vec<(&str, CategoryIdSegment)> = target_categories()
                .iter()
                .filter(|info| category_id_segment(info.key) != CategoryIdSegment::Index)
                .map(|info| (info.key, category_id_segment(info.key)))
                .collect();
            assert_eq!(
                unusual,
                vec![
                    ("talk", CategoryIdSegment::Letter),
                    ("io", CategoryIdSegment::Absent),
                    ("layer", CategoryIdSegment::Letter),
                    ("rec", CategoryIdSegment::Absent),
                    ("recstate", CategoryIdSegment::Absent),
                    ("play", CategoryIdSegment::Absent),
                    ("playstate", CategoryIdSegment::Absent),
                    ("stat", CategoryIdSegment::Absent),
                    ("show", CategoryIdSegment::Absent),
                    ("showstate", CategoryIdSegment::Absent),
                    // Batch 6: the desk lights, the safes, the solo configuration, the desk status,
                    // the card identity and the clock are index-less nodes; the AES50 status is the
                    // third letter category (`/$stat/A/stat`, 1254-1272). The monitor buses and the
                    // W-Live cards are ordinary indexed ones (`/cfg/mon/1/…`, `/cards/wlive/1/…`).
                    ("lights", CategoryIdSegment::Absent),
                    ("safes", CategoryIdSegment::Absent),
                    ("solocfg", CategoryIdSegment::Absent),
                    ("aes50", CategoryIdSegment::Letter),
                    ("deskstatus", CategoryIdSegment::Absent),
                    ("cards", CategoryIdSegment::Absent),
                    ("globals", CategoryIdSegment::Absent),
                ],
                "a new category without an index segment (or with a new shape) must be added here deliberately"
            );

            assert_eq!(category_id_segment("ch"), CategoryIdSegment::Index);
            assert_eq!(category_id_segment("userctrl"), CategoryIdSegment::Index);
            assert_eq!(category_id_segment("io"), CategoryIdSegment::Absent);
            assert_eq!(category_id_segment("show"), CategoryIdSegment::Absent);
            assert_eq!(category_id_segment("showstate"), CategoryIdSegment::Absent);
            assert_eq!(category_id_segment("talk"), CategoryIdSegment::Letter);
            // The batch-4 shapes: the two USB nodes and the console status carry no id, and the
            // fader layers carry the surface's own letter.
            assert_eq!(category_id_segment("rec"), CategoryIdSegment::Absent);
            assert_eq!(category_id_segment("recstate"), CategoryIdSegment::Absent);
            assert_eq!(category_id_segment("play"), CategoryIdSegment::Absent);
            assert_eq!(category_id_segment("playstate"), CategoryIdSegment::Absent);
            assert_eq!(category_id_segment("stat"), CategoryIdSegment::Absent);
            assert_eq!(category_id_segment("layer"), CategoryIdSegment::Letter);
            // A letter category is not index-less: the id is still part of the question, it is only
            // rendered as a letter. `gpio` is the ordinary case of the same document section.
            assert_ne!(category_id_segment("talk"), CategoryIdSegment::Absent);
            assert_ne!(category_id_segment("layer"), CategoryIdSegment::Absent);
            assert_eq!(category_id_segment("gpio"), CategoryIdSegment::Index);
            assert_eq!(category_id_segment("gpiostate"), CategoryIdSegment::Index);
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "mute")),
                vec!["/ch/1/mute".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("userctrl", "4", "user_btn")),
                vec!["/$ctl/user/1/4/bu/mode".to_string()]
            );
            // The lettered families keep their id and their documented bound, exactly like an
            // indexed one.
            assert!(category_has_id("talk", 1));
            assert!(category_has_id("talk", 2));
            assert!(!category_has_id("talk", 3));
            assert!(category_has_id("layer", 1));
            assert!(category_has_id("layer", 7));
            assert!(!category_has_id("layer", 8));
            // An empty id list still fails closed where an id really is part of the path, and the
            // documented bound still applies.
            assert!(resolve_basic_addresses(&target("ch", "", "mute")).is_empty());
            assert!(resolve_basic_addresses(&target("talk", "", "talk_on")).is_empty());
            assert!(resolve_basic_addresses(&target("layer", "", "layer_select")).is_empty());
            assert!(!category_has_id("ch", 41));
            // An index-less category has one entry and no id to bound: whatever id arrives names it.
            assert!(category_has_id("show", 1));
            assert!(category_has_id("showstate", 1));
            assert!(category_has_id("rec", 1));
            assert!(category_has_id("stat", 9));
        }

        /// The write/watch split: the two keys a step may write are not reported by the console, the
        /// five it reports are not writable, and neither can be used through the other's category —
        /// in the picker, which asks the two lists, or in a hand-edited show file, which the leaf
        /// table refuses.
        #[test]
        fn only_the_writable_show_keys_are_targets_and_only_the_read_only_ones_are_watched() {
            let show = target_categories()
                .iter()
                .find(|info| info.key == "show")
                .expect("show is a category");
            let showstate = target_categories()
                .iter()
                .find(|info| info.key == "showstate")
                .expect("showstate is a category");
            assert!(show.can_target && !show.can_trigger, "show is written, never watched");
            assert!(showstate.can_trigger && !showstate.can_target, "showstate is watched, never written");

            let writable: Vec<&str> = target_parameters_for_category("show")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert_eq!(writable, vec!["scene_index", "scene_action"]);
            let watchable: Vec<&str> = trigger_parameters_for_category("showstate")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert_eq!(
                watchable,
                vec![
                    "scene_active_index",
                    "scene_active_name",
                    "scene_active_tag",
                    "scene_show_name",
                    "scene_list",
                ]
            );
            // The other direction is empty, so the picker cannot offer a key on the wrong control.
            assert!(trigger_parameters_for_category("show").is_empty());
            assert!(target_parameters_for_category("showstate").is_empty());

            // Every entry answers the same as its category, so a key moved across the split fails
            // here even if a list were edited to keep it in both places.
            for parameter in target_parameters_for_category("show") {
                assert!(
                    !parameter.can_trigger,
                    "{} is writable: the console does not report it",
                    parameter.key
                );
                assert!(
                    watch_operators("show", parameter.key).is_empty(),
                    "{} must offer no comparator",
                    parameter.key
                );
                assert!(
                    watch_problem("show", parameter.key, "==", "1").is_some(),
                    "{} must not be watchable",
                    parameter.key
                );
            }
            for parameter in trigger_parameters_for_category("showstate") {
                assert!(
                    parameter.can_trigger,
                    "{} is reported by the console",
                    parameter.key
                );
            }

            // A hand-edited file cannot cross the split either: the leaf belongs to the category.
            assert!(resolve_basic_addresses(&target("show", "1", "scene_active_index")).is_empty());
            assert!(resolve_basic_addresses(&target("show", "", "scene_list")).is_empty());
            assert!(resolve_basic_addresses(&target("showstate", "1", "scene_index")).is_empty());
            assert!(resolve_basic_addresses(&target("showstate", "", "scene_action")).is_empty());
        }

        /// `$action` is the documented closed list (4114), in the document's order: the console takes
        /// the action names, so a misspelt one is an OSC string it ignores in silence.
        #[test]
        fn the_show_control_action_list_is_the_documented_one() {
            let rule = watch_rule("show", "scene_action").expect("the action is in the catalogue");
            assert_eq!(
                rule.options,
                ["IDLE", "GOPREV", "GONEXT", "GO", "PREV", "NEXT", "GOTAG"],
                "Maillot 4114"
            );
            assert_eq!(rule.arg_kind, "string");
            assert_eq!(rule.value_kind, "enum");
            assert!(value_problem("show", "scene_action", "GO").is_none());
            assert!(value_problem("show", "scene_action", "NOPE").is_some());
            // The console's list is upper case; the editor's select is what keeps it that way, and
            // the value rule refuses anything else.
            assert!(value_problem("show", "scene_action", "go").is_some());
        }

        /// The three scene numbers are Maillot's `I` leaves: the console takes an OSC integer (a
        /// fade would write `,f`), each one carries its own documented range, and its hint has to
        /// say which number it is — three fields called "scene number" and "tag" are not
        /// interchangeable.
        #[test]
        fn the_show_control_numbers_are_whole_numbers_in_the_documented_range() {
            for (category, parameter, max, meaning, maillot) in [
                ("show", "scene_index", 16384.0, "Scene number user selection", 4116),
                (
                    "showstate",
                    "scene_active_index",
                    16384.0,
                    "Scene number currently loaded/active",
                    4107,
                ),
                ("showstate", "scene_active_tag", 128.0, "Tag of the active scene", 4126),
            ] {
                let rule = watch_rule(category, parameter)
                    .unwrap_or_else(|| panic!("{category}/{parameter} must be in the catalogue"));
                assert_eq!(rule.arg_kind, "int", "{parameter} is an OSC integer ({maillot})");
                assert_eq!(
                    rule.value_kind, "number",
                    "{parameter} is an index, not a level ({maillot})"
                );
                assert_eq!((rule.min, rule.max), (0.0, max), "{parameter} ({maillot})");
                assert!(
                    rule.hint.contains(meaning),
                    "{parameter} must say what the number means: \"{meaning}\" ({maillot})"
                );
                assert!(
                    !watch_value_is_continuous(&rule),
                    "{parameter} is a whole number ({maillot}): a fade must not be offered"
                );
            }
            // The writable one is validated by the same rule the editor reads, so a hand-edited show
            // file cannot send a scene number the console does not have.
            assert!(value_problem("show", "scene_index", "0").is_none());
            assert!(value_problem("show", "scene_index", "16384").is_none());
            assert!(value_problem("show", "scene_index", "16385").is_some());
            assert!(value_problem("show", "scene_index", "-1").is_some());
            // A watched number keeps its ordered comparators: "the active scene is above 40" is a
            // comparison the console can satisfy.
            assert_eq!(watch_operators("showstate", "scene_active_index"), &["<", ">", "==", "!="]);
        }

        /// The hints carry what the console does not enforce for you: nothing here answers with no
        /// show open (footnotes 77-79), `$actionidx` has to be 0 for NEXT or PREV followed by GO
        /// (footnote 79), GO loads the scene the number points at while GOTAG reads it as a tag, and
        /// `$scenes` returns only the first name over plain OSC (footnote 77). A hint that loses one
        /// of these leaves the operator with a control that silently does nothing.
        #[test]
        fn the_show_control_hints_carry_the_documented_caveats() {
            let hint = |category: &str, parameter: &str| {
                watch_rule(category, parameter)
                    .unwrap_or_else(|| panic!("{category}/{parameter} must be in the catalogue"))
                    .hint
            };
            assert!(hint("show", "scene_index").contains("A show must be open"));
            assert!(hint("show", "scene_index").contains("should be 0 to enable NEXT or PREV"));
            assert!(hint("show", "scene_action").contains("after a show has been opened"));
            assert!(hint("show", "scene_action").contains("GOTAG treats $actionidx as the tag number"));
            for parameter in ["scene_active_index", "scene_active_name", "scene_active_tag"] {
                assert!(
                    hint("showstate", parameter).contains("A show must be open"),
                    "{parameter} must say a show has to be open"
                );
            }
            assert!(hint("showstate", "scene_show_name").contains("OPEN SHOW"));
            assert!(hint("showstate", "scene_list").contains("only the first name is returned"));
        }

        // ── Batch 2: solo, talkback, GPIO ─────────────────────────────────────────────────────────

        /// Every key of the batch resolves to its documented address — both talkback entries, so the
        /// letter segment is checked on `A` and on `B` — and the pairs the document does not define
        /// resolve to nothing instead of to a path the console ignores.
        #[test]
        fn every_talkback_gpio_and_solo_key_resolves_to_its_documented_path() {
            let table: &[(&str, &str, &str, Option<u8>, &str)] = &[
                // Talkback (Maillot 1461-1504): the id is the number the editor holds, the segment
                // in the path is the letter.
                ("talk", "1", "talk_on", None, "/cfg/talk/A/$on"),
                ("talk", "2", "talk_on", None, "/cfg/talk/B/$on"),
                ("talk", "1", "talk_mode", None, "/cfg/talk/A/mode"),
                ("talk", "2", "talk_mode", None, "/cfg/talk/B/mode"),
                ("talk", "1", "talk_monitor_dim", None, "/cfg/talk/A/mondim"),
                ("talk", "2", "talk_monitor_dim", None, "/cfg/talk/B/mondim"),
                ("talk", "1", "talk_bus_dim", None, "/cfg/talk/A/busdim"),
                ("talk", "2", "talk_bus_dim", None, "/cfg/talk/B/busdim"),
                ("talk", "1", "talk_individual", None, "/cfg/talk/A/indiv"),
                ("talk", "2", "talk_individual", None, "/cfg/talk/B/indiv"),
                // The three assigns, at a destination each (1469-1496, 1507-1534): the same keys on
                // both entries, and the destination index the sends use.
                ("talk", "1", "talk_bus_assign", Some(7), "/cfg/talk/A/B7"),
                ("talk", "2", "talk_bus_assign", Some(16), "/cfg/talk/B/B16"),
                ("talk", "1", "talk_matrix_assign", Some(3), "/cfg/talk/A/MX3"),
                ("talk", "2", "talk_matrix_assign", Some(8), "/cfg/talk/B/MX8"),
                ("talk", "1", "talk_main_assign", Some(2), "/cfg/talk/A/M2"),
                ("talk", "2", "talk_main_assign", Some(4), "/cfg/talk/B/M4"),
                // GPIO (4009-4014): the id is a number here, and the node has four of them.
                ("gpio", "1", "gpio_mode", None, "/$ctl/gpio/1/mode"),
                ("gpio", "4", "gpio_mode", None, "/$ctl/gpio/4/mode"),
                ("gpio", "1", "gpio_state", None, "/$ctl/gpio/1/gpstate"),
                ("gpio", "4", "gpio_state", None, "/$ctl/gpio/4/gpstate"),
                ("gpiostate", "1", "gpio_input_state", None, "/$ctl/gpio/1/$state"),
                ("gpiostate", "4", "gpio_input_state", None, "/$ctl/gpio/4/$state"),
                // Solo, on every mix family and on the DCA (1999, 2250, 2394, 2565, 2732, 2874).
                ("ch", "1", "solo", None, "/ch/1/$solo"),
                ("aux", "1", "solo", None, "/aux/1/$solo"),
                ("bus", "1", "solo", None, "/bus/1/$solo"),
                ("main", "1", "solo", None, "/main/1/$solo"),
                ("matrix", "1", "solo", None, "/mtx/1/$solo"),
                ("dca", "1", "solo", None, "/dca/1/$solo"),
            ];

            for (category, id, key, send_id, expected) in table {
                let mut spec = target(category, id, key);
                spec.send_id = *send_id;
                assert_eq!(
                    resolve_basic_addresses(&spec),
                    vec![(*expected).to_string()],
                    "{category}/{key} (id {id}, destination {send_id:?}) must resolve to {expected}"
                );
            }

            // The other side: no id outside the node, and no key on a category the document does
            // not define it for.
            assert!(resolve_basic_addresses(&target("talk", "3", "talk_on")).is_empty());
            assert!(resolve_basic_addresses(&target("gpio", "5", "gpio_mode")).is_empty());
            assert!(resolve_basic_addresses(&target("gpiostate", "5", "gpio_input_state")).is_empty());
            assert!(resolve_basic_addresses(&target("talk", "1", "solo")).is_empty());
            assert!(resolve_basic_addresses(&target("gpio", "1", "solo")).is_empty());
            assert!(resolve_basic_addresses(&target("mutegroup", "1", "talk_on")).is_empty());
        }

        /// The letter segment renders `A` and `B` and never the number, and the alphabet belongs to
        /// the category: an id it has no letter for resolves to nothing. The other letter family is
        /// the fader layers' (batch 4), which has its own test; every other category answers no
        /// letter at all, which is also what the enumeration in
        /// `only_show_control_is_index_less_and_the_indexed_families_are_untouched` pins.
        #[test]
        fn the_talk_letter_segment_renders_a_and_b_and_never_the_number() {
            assert_eq!(category_id_segment("talk"), CategoryIdSegment::Letter);
            assert_eq!(id_letter_for_category("talk", 1), Some("A"));
            assert_eq!(id_letter_for_category("talk", 2), Some("B"));
            assert_eq!(id_letter_for_category("talk", 0), None);
            assert_eq!(id_letter_for_category("talk", 3), None);

            assert_eq!(
                resolve_basic_addresses(&target("talk", "1", "talk_on")),
                vec!["/cfg/talk/A/$on".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("talk", "2", "talk_on")),
                vec!["/cfg/talk/B/$on".to_string()]
            );
            // The number is not a fallback: the console has no `/cfg/talk/1/$on`.
            assert_ne!(
                resolve_basic_addresses(&target("talk", "1", "talk_on")),
                vec!["/cfg/talk/1/$on".to_string()]
            );
            // An id the category has no letter for resolves to no address at all, and a list renders
            // one address per entry, in the order the editor wrote it.
            assert!(resolve_basic_addresses(&target("talk", "3", "talk_on")).is_empty());
            assert_eq!(
                resolve_basic_addresses(&target("talk", "1,2", "talk_mode")),
                vec!["/cfg/talk/A/mode".to_string(), "/cfg/talk/B/mode".to_string()]
            );

            // The alphabet is the category's: every other category answers no letter, and only
            // `talk` and `layer` declare the letter shape (the enumeration is in
            // `only_show_control_is_index_less_and_the_indexed_families_are_untouched`).
            for category in ["ch", "aux", "bus", "main", "matrix", "dca", "gpio", "gpiostate", "show", "showstate", "rec", "play", "stat"] {
                assert_eq!(
                    id_letter_for_category(category, 1),
                    None,
                    "{category} must not answer a letter"
                );
                assert_ne!(
                    category_id_segment(category),
                    CategoryIdSegment::Letter,
                    "{category} must not render a letter segment"
                );
            }
            // The two letter families do not share an alphabet: `A` is talkback's and `L` the fader
            // layers', so neither can be resolved through the other.
            assert_eq!(id_letter_for_category("layer", 1), Some("L"));
            assert_ne!(id_letter_for_category("layer", 1), id_letter_for_category("talk", 1));
            assert!(resolve_basic_addresses(&target("talk", "1", "layer_select")).is_empty());
            assert!(resolve_basic_addresses(&target("layer", "1", "talk_on")).is_empty());
        }

        /// Solo exists on all six families — the five mixes and the DCA — as the same `$solo` toggle,
        /// and the console reports it, so it is a target *and* a trigger: "when channel 3 is soloed"
        /// is an ordinary state trigger, which is why it is not a write-only key.
        #[test]
        fn solo_exists_on_every_mix_family_and_on_the_dca() {
            for (category, prefix) in [
                ("ch", "/ch"),
                ("aux", "/aux"),
                ("bus", "/bus"),
                ("main", "/main"),
                ("matrix", "/mtx"),
                ("dca", "/dca"),
            ] {
                let targets: Vec<&str> = target_parameters_for_category(category)
                    .iter()
                    .map(|parameter| parameter.key)
                    .collect();
                assert!(
                    targets.contains(&"solo"),
                    "{category} must offer Solo as a target: {targets:?}"
                );
                let watches: Vec<&str> = trigger_parameters_for_category(category)
                    .iter()
                    .map(|parameter| parameter.key)
                    .collect();
                assert!(
                    watches.contains(&"solo"),
                    "{category} must offer Solo as a watch: {watches:?}"
                );

                let rule = watch_rule(category, "solo")
                    .unwrap_or_else(|| panic!("{category} must carry the solo rule"));
                assert_eq!(rule.value_kind, "toggle", "{category}/solo is 0 or 1");
                assert_eq!((rule.min, rule.max), (0.0, 1.0), "{category}/solo");
                assert!(rule.can_trigger, "{category}/solo is reported by the console");
                assert_eq!(
                    resolve_basic_addresses(&target(category, "1", "solo")),
                    vec![format!("{prefix}/1/$solo")],
                    "{category}/solo"
                );
                assert!(value_problem(category, "solo", "0").is_none(), "{category}/solo takes 0");
                assert!(value_problem(category, "solo", "1").is_none(), "{category}/solo takes 1");
                assert!(
                    value_problem(category, "solo", "2").is_some(),
                    "{category}/solo is on/off, not a number"
                );
            }
            // Every family that has the leaf has it; the ones that do not must not invent it.
            assert!(resolve_basic_addresses(&target("mutegroup", "1", "solo")).is_empty());
            assert!(resolve_basic_addresses(&target("userctrl", "1", "solo")).is_empty());
            assert!(resolve_basic_addresses(&target("gpio", "1", "solo")).is_empty());
        }

        /// The three assign keys reuse the destination index the send parameters already carry, so
        /// `send_destination` answers the sends' own `SendDestination` — Bus/16, Matrix/8, Main/4 —
        /// and an index above the destination's size resolves to nothing, exactly as it does for a
        /// send (Maillot 1469-1496, 1507-1534; bounds at 2168, 2670, 2153).
        #[test]
        fn a_talkback_assign_index_is_bounded_by_its_destination() {
            // The destination is literally the send's own value, not a second table that could drift.
            assert_eq!(
                send_destination("talk", "talk_bus_assign"),
                send_destination("ch", "send_level")
            );
            assert_eq!(
                send_destination("talk", "talk_matrix_assign"),
                send_destination("ch", "send_matrix_level")
            );
            assert_eq!(
                send_destination("talk", "talk_main_assign"),
                send_destination("ch", "send_main_level")
            );
            assert_eq!(
                send_destination("talk", "talk_bus_assign"),
                Some(SendDestination {
                    key: "bus",
                    label: "Bus",
                    max: 16,
                })
            );
            assert_eq!(
                send_destination("talk", "talk_matrix_assign"),
                Some(SendDestination {
                    key: "matrix",
                    label: "Matrix",
                    max: 8,
                })
            );
            assert_eq!(
                send_destination("talk", "talk_main_assign"),
                Some(SendDestination {
                    key: "main",
                    label: "Main",
                    max: 4,
                })
            );
            // Every other talkback key takes no destination index at all.
            for key in [
                "talk_on",
                "talk_mode",
                "talk_monitor_dim",
                "talk_bus_dim",
                "talk_individual",
            ] {
                assert_eq!(send_destination("talk", key), None, "{key} takes no destination");
            }

            // The last valid destination of each family…
            assert_eq!(
                resolve_basic_addresses(&send_target("talk", "2", "talk_bus_assign", 16)),
                vec!["/cfg/talk/B/B16".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&send_target("talk", "1", "talk_matrix_assign", 8)),
                vec!["/cfg/talk/A/MX8".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&send_target("talk", "1", "talk_main_assign", 4)),
                vec!["/cfg/talk/A/M4".to_string()]
            );
            // …and one above it fails closed, like a send: `/cfg/talk/A/B17` does not exist.
            for (key, outside) in [
                ("talk_bus_assign", 17_u8),
                ("talk_matrix_assign", 9),
                ("talk_main_assign", 5),
            ] {
                assert!(
                    resolve_basic_addresses(&send_target("talk", "1", key, outside)).is_empty(),
                    "{key} must refuse destination {outside}"
                );
            }
            // 0 is not a destination, and neither is a missing one: an assign with no destination
            // would silently switch bus 1, which is the same defect the send rule closes.
            assert!(
                resolve_basic_addresses(&send_target("talk", "1", "talk_bus_assign", 0)).is_empty()
            );
            assert!(
                resolve_basic_addresses(&target("talk", "1", "talk_bus_assign")).is_empty(),
                "an assign with no destination must not resolve"
            );
            assert_eq!(
                resolve_basic_addresses(&send_target("talk", "1", "talk_bus_assign", 1)),
                vec!["/cfg/talk/A/B1".to_string()]
            );
        }

        /// The GPIO split: `$state` is the console's read-only input report, so it is a watch and
        /// never a target, while `mode` and `gpstate` are written and reported. One category cannot
        /// express that, because `can_target`/`can_trigger` are per category — a single `gpio` with
        /// `can_target` would put `$state` in its target list — so the node is split the way
        /// show/showstate is, and the leaf tables refuse the crossing as well (Maillot 4011-4014).
        #[test]
        fn the_gpio_split_keeps_the_read_only_input_state_a_trigger_only() {
            let gpio = target_categories()
                .iter()
                .find(|info| info.key == "gpio")
                .expect("gpio is a category");
            let gpiostate = target_categories()
                .iter()
                .find(|info| info.key == "gpiostate")
                .expect("gpiostate is a category");
            assert!(
                gpio.can_target && gpio.can_trigger,
                "mode and gpstate are written and reported"
            );
            assert!(
                gpiostate.can_trigger && !gpiostate.can_target,
                "the input state is read-only: watched, never written"
            );

            let writable: Vec<&str> = target_parameters_for_category("gpio")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert_eq!(writable, vec!["gpio_mode", "gpio_state"]);
            assert!(
                target_parameters_for_category("gpiostate").is_empty(),
                "the read-only half offers nothing a step may write"
            );
            let watched: Vec<&str> = trigger_parameters_for_category("gpiostate")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert_eq!(watched, vec!["gpio_input_state"]);
            // The two writable keys are reported as well, so they are watches too.
            let gpio_watch: Vec<&str> = trigger_parameters_for_category("gpio")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert_eq!(gpio_watch, vec!["gpio_mode", "gpio_state"]);

            // The read-only key is a real watch — 0/1, compared with `==` and `!=`…
            assert!(watch_problem("gpiostate", "gpio_input_state", "==", "1").is_none());
            assert_eq!(watch_operators("gpiostate", "gpio_input_state"), &["==", "!="]);
            assert_eq!(watch_operators("gpio", "gpio_state"), &["==", "!="]);
            // …and not a target: the picker offers it on no action list, and a hand-edited show file
            // that names it under the writable category resolves to nothing.
            assert!(resolve_basic_addresses(&target("gpio", "1", "gpio_input_state")).is_empty());
            assert!(resolve_basic_addresses(&target("gpiostate", "1", "gpio_state")).is_empty());
            assert!(resolve_basic_addresses(&target("gpiostate", "1", "gpio_mode")).is_empty());
            assert_eq!(
                resolve_basic_addresses(&target("gpiostate", "1", "gpio_input_state")),
                vec!["/$ctl/gpio/1/$state".to_string()]
            );

            // The mode is the documented closed list (4011), in the document's order.
            let mode = watch_rule("gpio", "gpio_mode").expect("the mode is in the catalogue");
            assert_eq!(
                mode.options,
                &["TGLNO", "TGLNC", "INNO", "INNC", "OUTNO", "OUTNC"]
            );
            assert_eq!(mode.arg_kind, "string", "a list is written as text");
            assert!(value_problem("gpio", "gpio_mode", "INNO").is_none());
            assert!(value_problem("gpio", "gpio_mode", "INVERTED").is_some());

            // Four ids are offered, and every hint says a Compact console has two (footnote 122,
            // "2 GPIOs for the Compact model"): the catalogue describes the node the document prints.
            for (category, key) in [
                ("gpio", "gpio_mode"),
                ("gpio", "gpio_state"),
                ("gpiostate", "gpio_input_state"),
            ] {
                let rule = watch_rule(category, key)
                    .unwrap_or_else(|| panic!("{category}/{key} must be in the catalogue"));
                assert!(
                    rule.hint.contains("Compact"),
                    "{category}/{key} must say a Compact has two GPIOs: {}",
                    rule.hint
                );
                assert!(
                    rule.hint.contains("footnote 122"),
                    "{category}/{key} must cite footnote 122: {}",
                    rule.hint
                );
            }
            assert!(category_has_id("gpio", 4));
            assert!(!category_has_id("gpio", 5));
            assert!(category_has_id("gpiostate", 4));
            assert!(!category_has_id("gpiostate", 5));
        }

        /// The two talkback dims are documented `40..0` in 41 steps — an amount of attenuation, so
        /// 40 is the most and 0 none — and both ends are accepted while 41 is refused with the
        /// documented bound in the message (Maillot 1463-1464, 1501-1502).
        #[test]
        fn the_talkback_dims_refuse_41_and_accept_40_and_0() {
            for (key, maillot) in [("talk_monitor_dim", 1463), ("talk_bus_dim", 1464)] {
                let rule = watch_rule("talk", key)
                    .unwrap_or_else(|| panic!("talk/{key} must be in the catalogue"));
                assert_eq!(rule.value_kind, "number", "{key} is a number ({maillot})");
                assert_eq!((rule.min, rule.max), (0.0, 40.0), "{key} ({maillot})");
                assert!(
                    rule.hint.contains("40…0"),
                    "{key} must keep the documented order, 40…0 ({maillot}): {}",
                    rule.hint
                );
                assert!(
                    rule.hint.contains("41 steps"),
                    "{key} must say 41 steps ({maillot}): {}",
                    rule.hint
                );
                // Both ends of the documented range are inside it…
                assert!(value_problem("talk", key, "0").is_none(), "{key} accepts 0");
                assert!(value_problem("talk", key, "40").is_none(), "{key} accepts 40");
                // …and one above it is refused, with the documented bound in the message.
                let above = value_problem("talk", key, "41")
                    .unwrap_or_else(|| panic!("{key} must refuse 41: the range is 0…40"));
                assert!(above.contains("40"), "{key}: the message must name the bound: {above}");
                let below = value_problem("talk", key, "-1")
                    .unwrap_or_else(|| panic!("{key} must refuse a negative attenuation"));
                assert!(below.contains("minimum of 0"), "{key}: {below}");
                // A dim is a state a trigger can compare, with the ordered comparators of a number.
                assert!(watch_problem("talk", key, "<", "10").is_none());
                assert!(watch_problem("talk", key, "==", "10").is_none());
            }
            // Both keys are written as floats. The four documented rows disagree on the type
            // (`/cfg/talk/A/mondim` is `I`, the other three are `F`) and one key serves both
            // entries, so the catalogue writes the float three of the four rows document; the value
            // space is the same 41 steps either way.
            for key in ["talk_monitor_dim", "talk_bus_dim"] {
                let rule = watch_rule("talk", key).expect("both dims are in the catalogue");
                assert_eq!(rule.arg_kind, "float", "{key}");
                // Maillot prints no unit for either dim: the hint says what the number means
                // instead of the catalogue inventing dB.
                assert_eq!(rule.unit, "", "{key} has no documented unit");
                assert!(
                    rule.hint.contains("attenuation"),
                    "{key} must say what the number is: {}",
                    rule.hint
                );
            }
        }

        // ── Batch 3: input routing, the MAIN/ALT switch, the oscillator, the source mode ─────────

        /// Every key this batch adds resolves to the address Maillot documents, the oscillator's extra
        /// `osc` segment and the alt pair included. Ids 2, 3 and 7 are used so a stuck index cannot
        /// hide behind a 1, and the two index-less `io` keys are checked with an id and without one.
        #[test]
        fn every_batch3_key_resolves_to_its_documented_path() {
            let table: &[(&str, &str, &str, &str)] = &[
                // The input routing pair, on channels and aux (1955-1965, 2224-2233).
                ("ch", "3", "input_conn_group", "/ch/3/in/conn/grp"),
                ("ch", "3", "input_conn_index", "/ch/3/in/conn/in"),
                ("ch", "3", "input_conn_alt_group", "/ch/3/in/conn/altgrp"),
                ("ch", "3", "input_conn_alt_index", "/ch/3/in/conn/altin"),
                ("aux", "2", "input_conn_group", "/aux/2/in/conn/grp"),
                ("aux", "2", "input_conn_index", "/aux/2/in/conn/in"),
                ("aux", "2", "input_conn_alt_group", "/aux/2/in/conn/altgrp"),
                ("aux", "2", "input_conn_alt_index", "/aux/2/in/conn/altin"),
                // The I/O node, index-less like show control: `/io/altsw`, never `/io/1/altsw`
                // (1593-1594).
                ("io", "", "io_altsw", "/io/altsw"),
                ("io", "1", "io_auto_alt_override", "/io/autoaltovr"),
                // The oscillator's own source sub-node, whose last-but-one segment is `osc`
                // (1790-1793).
                ("preamp_oscillator", "1", "osc_level", "/io/in/OSC/1/osc/lvl"),
                ("preamp_oscillator", "2", "osc_mode", "/io/in/OSC/2/osc/mode"),
                ("preamp_oscillator", "2", "osc_freq", "/io/in/OSC/2/osc/f"),
                // The source mode, one row per writable physical input group (1599 … 1760; the
                // oscillator's row 1781 is `[RO]` and is refused below).
                ("preamp_local", "3", "source_mode", "/io/in/LCL/3/mode"),
                ("preamp_aux", "2", "source_mode", "/io/in/AUX/2/mode"),
                ("preamp_aes50a", "5", "source_mode", "/io/in/A/5/mode"),
                ("preamp_aes50b", "5", "source_mode", "/io/in/B/5/mode"),
                ("preamp_aes50c", "5", "source_mode", "/io/in/C/5/mode"),
                ("preamp_stageconnect", "4", "source_mode", "/io/in/SC/4/mode"),
                ("usb", "9", "source_mode", "/io/in/USB/9/mode"),
                ("preamp_card", "6", "source_mode", "/io/in/CRD/6/mode"),
                ("preamp_module", "6", "source_mode", "/io/in/MOD/6/mode"),
                ("preamp_usbplayer", "2", "source_mode", "/io/in/PLAY/2/mode"),
                ("preamp_aesebu", "2", "source_mode", "/io/in/AES/2/mode"),
                ("usersig", "7", "source_mode", "/io/in/USR/7/mode"),
            ];
            for (category, id, key, expected) in table {
                assert_eq!(
                    resolve_basic_addresses(&target(category, id, key)),
                    vec![(*expected).to_string()],
                    "{category}/{key} (id {id}) must resolve to {expected}"
                );
            }

            const ROUTING_KEYS: &[&str] = &[
                "input_conn_group",
                "input_conn_index",
                "input_conn_alt_group",
                "input_conn_alt_index",
            ];
            // The other direction: the four routing keys must not resolve on the mix families whose
            // `/in/set` node has no `conn` child (2374-2378, 2545-2549, 2705-2709).
            for category in ["bus", "main", "matrix"] {
                for key in ROUTING_KEYS {
                    assert!(
                        resolve_basic_addresses(&target(category, "1", key)).is_empty(),
                        "{category}/{key} must resolve to nothing: there is no conn node there"
                    );
                }
            }
            // The source mode is not a mix key either: the channel's own mode is the read-only
            // `/in/set/$mode` (1936) and no mix strip has an `/io/in` leaf.
            for category in ["ch", "aux", "bus", "main", "matrix"] {
                assert!(
                    resolve_basic_addresses(&target(category, "1", "source_mode")).is_empty(),
                    "{category} has no source_mode: /in/set/$mode is read-only and is not this key"
                );
            }
            // The oscillator's own `mode` is `[RO]` (1781) and is refused as a write like the mix
            // families' read-only leaf; its `osc_*` leaves above are the oscillator's writable ones.
            assert!(
                resolve_basic_addresses(&target("preamp_oscillator", "1", "source_mode")).is_empty(),
                "the oscillator's source mode is [RO]: no write may be built for it"
            );
            // The oscillator's three leaves belong to `/io/in/OSC` alone, and a source id outside the
            // node still resolves to nothing.
            for category in ["preamp_local", "usb", "usersig", "preamp_aesebu", "preamp_card"] {
                for key in ["osc_level", "osc_mode", "osc_freq"] {
                    assert!(
                        resolve_basic_addresses(&target(category, "1", key)).is_empty(),
                        "{category}/{key}: only the oscillator has an osc sub-node"
                    );
                }
            }
            assert!(resolve_basic_addresses(&target("preamp_oscillator", "3", "osc_level")).is_empty());
            // And the `io` keys are not on another category, nor another category's keys on `io`.
            for category in ["show", "showstate", "gpio", "ch", "bus"] {
                assert!(resolve_basic_addresses(&target(category, "1", "io_altsw")).is_empty());
                assert!(
                    resolve_basic_addresses(&target(category, "1", "io_auto_alt_override")).is_empty()
                );
            }
            assert!(resolve_basic_addresses(&target("io", "1", "scene_index")).is_empty());
        }

        /// The source mode is a key of the physical input groups, not of the mix families. Twelve
        /// categories carry it, one per writable documented row — local 1599, aux 1618, AES50 A/B/C
        /// 1629/1652/1671, StageConnect 1690, USB 1702, card 1713, module 1724, USB player 1735,
        /// AES/EBU 1747 and user signals 1760.
        ///
        /// The thirteen physical rows are not all writable: the oscillator's is printed `[RO]` (1781)
        /// and is excluded here — that is the rule the audit exists for, and it has its own test
        /// (`the_read_only_oscillator_source_mode_is_not_offered_for_writing`). The batch brief's
        /// original list of "twelve" line numbers miscounted in both directions: it named AES/EBU in
        /// prose but left 1747 out of the numbers, and it included 1781. The count below is pinned, so
        /// neither a dropped category nor a re-added read-only one can pass unnoticed.
        #[test]
        fn the_source_mode_key_exists_on_all_twelve_source_categories_and_on_no_mix_family() {
            const WRITABLE_SOURCES: &[(&str, &str, u32)] = &[
                ("preamp_local", "/io/in/LCL", 1599),
                ("preamp_aux", "/io/in/AUX", 1618),
                ("preamp_aes50a", "/io/in/A", 1629),
                ("preamp_aes50b", "/io/in/B", 1652),
                ("preamp_aes50c", "/io/in/C", 1671),
                ("preamp_stageconnect", "/io/in/SC", 1690),
                ("usb", "/io/in/USB", 1702),
                ("preamp_card", "/io/in/CRD", 1713),
                ("preamp_module", "/io/in/MOD", 1724),
                ("preamp_usbplayer", "/io/in/PLAY", 1735),
                ("preamp_aesebu", "/io/in/AES", 1747),
                ("usersig", "/io/in/USR", 1760),
            ];
            assert_eq!(
                WRITABLE_SOURCES.len(),
                12,
                "the twelve rows whose `mode` Maillot does not mark read-only"
            );
            for (category, prefix, line) in WRITABLE_SOURCES {
                let listed: Vec<&str> = target_parameters_for_category(category)
                    .iter()
                    .map(|parameter| parameter.key)
                    .collect();
                assert!(
                    listed.contains(&"source_mode"),
                    "{category} must offer source_mode ({line})"
                );
                assert_eq!(
                    resolve_basic_addresses(&target(category, "1", "source_mode")),
                    vec![format!("{prefix}/1/mode")],
                    "{category} ({line}): the mode of the source node itself"
                );
                // The console reports the node's mode, so it is a watch as well as a step value.
                assert!(
                    watch_problem(category, "source_mode", "==", "ST").is_none(),
                    "{category} must be able to watch its source mode ({line})"
                );
            }

            // …and not one mix family carries it: what a channel has is the read-only
            // `/in/set/$mode`, which is a different leaf and no key at all.
            for category in ["ch", "aux", "bus", "main", "matrix"] {
                let listed: Vec<&str> = target_parameters_for_category(category)
                    .iter()
                    .map(|parameter| parameter.key)
                    .collect();
                assert!(
                    !listed.contains(&"source_mode"),
                    "{category} is a mix family: its input mode is read-only (1936)"
                );
                assert!(resolve_basic_addresses(&target(category, "1", "source_mode")).is_empty());
            }
        }

        /// The oscillator is the thirteenth physical row and the one exception: Maillot prints
        /// `/io/in/OSC/1/mode` as `[RO]` (1781), so the console reports it and does not take it.
        /// Offering the write would build an address the console drops in silence while the app
        /// reported success — the defect the whole audit exists to remove — so the key is kept off
        /// that category in the picker *and* in the resolver, and its own `osc/*` leaves, which are
        /// ordinary writable rows, still work.
        #[test]
        fn the_read_only_oscillator_source_mode_is_not_offered_for_writing() {
            let listed: Vec<&str> = target_parameters_for_category("preamp_oscillator")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert!(
                !listed.contains(&"source_mode"),
                "`/io/in/OSC/1/mode` is [RO] (1781): it must not be a step destination"
            );
            assert!(
                resolve_basic_addresses(&target("preamp_oscillator", "1", "source_mode")).is_empty(),
                "the resolver must not build /io/in/OSC/1/mode for a write"
            );
            // One catalogue key cannot be a write nowhere and a trigger somewhere, so the key leaves
            // the oscillator's watch list too; what the node's mode is can still be read from the
            // console's own screen.
            assert!(
                trigger_parameters_for_category("preamp_oscillator")
                    .iter()
                    .all(|parameter| parameter.key != "source_mode"),
                "the category's target list is its watch list: the key is gone from both"
            );

            // The oscillator's own source sub-node does not share that `[RO]`: `osc/lvl`, `osc/mode`
            // and `osc/f` (1790-1793) are ordinary writable leaves and still resolve.
            for (key, expected) in [
                ("osc_level", "/io/in/OSC/1/osc/lvl"),
                ("osc_mode", "/io/in/OSC/1/osc/mode"),
                ("osc_freq", "/io/in/OSC/1/osc/f"),
            ] {
                assert!(
                    listed.contains(&key),
                    "{key} is not [RO] and must stay on the oscillator"
                );
                assert_eq!(
                    resolve_basic_addresses(&target("preamp_oscillator", "1", key)),
                    vec![expected.to_string()],
                    "{key} must keep resolving ({expected})"
                );
                assert!(
                    watch_rule("preamp_oscillator", key).is_some(),
                    "{key} must stay in the catalogue"
                );
            }

            // The exclusion is the oscillator's alone: the twelve other physical rows keep the key.
            for (category, prefix) in [
                ("preamp_local", "/io/in/LCL"),
                ("preamp_aesebu", "/io/in/AES"),
                ("usersig", "/io/in/USR"),
            ] {
                assert_eq!(
                    resolve_basic_addresses(&target(category, "1", "source_mode")),
                    vec![format!("{prefix}/1/mode")],
                    "{category} documents the row without [RO] and keeps it"
                );
            }
        }

        /// The routing pair is the one node the reference gives channels and aux alone. A bus, a main
        /// and a matrix have an `/in/set` node whose children are `inv`, `trim` and `bal`, with no
        /// `conn` child at all (2374-2378, 2545-2549, 2705-2709), so the four keys are offered on ch
        /// and aux and resolve to nothing on the other three — checked against both the catalogue list
        /// (what the editor offers) and the resolver (what a hand-edited show file reaches).
        #[test]
        fn the_routing_keys_exist_on_ch_and_aux_and_on_no_other_mix_family() {
            const ROUTING_KEYS: &[&str] = &[
                "input_conn_group",
                "input_conn_index",
                "input_conn_alt_group",
                "input_conn_alt_index",
            ];
            for category in ["ch", "aux"] {
                let listed: Vec<&str> = target_parameters_for_category(category)
                    .iter()
                    .map(|parameter| parameter.key)
                    .collect();
                for key in ROUTING_KEYS {
                    assert!(
                        listed.contains(key),
                        "{category} must offer {key} (1955-1965, 2224-2233)"
                    );
                    assert!(
                        !resolve_basic_addresses(&target(category, "1", key)).is_empty(),
                        "{category}/{key} must resolve"
                    );
                }
            }
            for category in ["bus", "main", "matrix"] {
                let listed: Vec<&str> = target_parameters_for_category(category)
                    .iter()
                    .map(|parameter| parameter.key)
                    .collect();
                for key in ROUTING_KEYS {
                    assert!(
                        !listed.contains(key),
                        "{category} has no conn node and must not offer {key}"
                    );
                    assert!(
                        resolve_basic_addresses(&target(category, "1", key)).is_empty(),
                        "{category}/{key} must resolve to nothing: the console has no such leaf"
                    );
                }
            }
            // The node those families *do* have is untouched: `trim` and `inv` are theirs (2376-2377).
            assert_eq!(
                resolve_basic_addresses(&target("bus", "1", "trim")),
                vec!["/bus/1/in/set/trim".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("main", "1", "phase")),
                vec!["/main/1/in/set/inv".to_string()]
            );
        }

        /// The I/O category is index-less like `show`: `/io/altsw` and `/io/autoaltovr`, with no
        /// `/io/1/…` anywhere, whatever id the editor holds. Both keys are written *and* reported — the
        /// console takes the switches and publishes them — so both lists carry them, which is why
        /// `io` has both flags set.
        #[test]
        fn the_io_category_is_index_less_like_show_and_its_two_keys_are_writable_and_watchable() {
            let io = target_categories()
                .iter()
                .find(|info| info.key == "io")
                .expect("io is a category");
            assert_eq!(io.label, "I/O");
            assert_eq!(io.group, "I/O");
            assert_eq!(io.count, 1);
            assert_eq!(io.prefix, "/io");
            assert!(
                io.can_target && io.can_trigger,
                "both switches are written and reported"
            );
            assert_eq!(category_id_segment("io"), CategoryIdSegment::Absent);
            assert_eq!(prefix_for_category("io"), Some("/io"));

            let writable: Vec<&str> = target_parameters_for_category("io")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            let watchable: Vec<&str> = trigger_parameters_for_category("io")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert_eq!(writable, vec!["io_altsw", "io_auto_alt_override"]);
            assert_eq!(watchable, writable, "the target list *is* the watch list here");
            for parameter in ["io_altsw", "io_auto_alt_override"] {
                let rule = watch_rule("io", parameter)
                    .unwrap_or_else(|| panic!("io/{parameter} must be in the catalogue"));
                assert_eq!(rule.value_kind, "toggle", "{parameter}");
                assert_eq!((rule.min, rule.max), (0.0, 1.0), "{parameter}");
                assert!(watch_problem("io", parameter, "==", "1").is_none(), "{parameter}");
                assert!(value_problem("io", parameter, "1").is_none(), "{parameter}");
                assert!(value_problem("io", parameter, "2").is_some(), "{parameter}");
            }

            // No id ever enters the path: the single entry, a number or a list all give the one
            // documented address…
            for ids in ["", "1", "7", "1,2,3"] {
                assert_eq!(
                    resolve_basic_addresses(&target("io", ids, "io_altsw")),
                    vec!["/io/altsw".to_string()],
                    "io_altsw with ids \"{ids}\""
                );
            }
            // …and the number is never a segment, exactly as `/$ctl/lib/1/$action` never is.
            let altsw = resolve_basic_addresses(&target("io", "1", "io_altsw"));
            assert_ne!(altsw, vec!["/io/1/altsw".to_string()]);
            assert!(altsw.iter().all(|address| !address.contains("/1/")));
            // An index-less category has one entry and no id to bound, like show control.
            assert!(category_has_id("io", 1));
            assert!(category_has_id("io", 9));
        }

        /// The input connection group list is Maillot's, byte for byte (1956-1958, 2225-2227): the
        /// seventeen groups from `OFF` to `MTX`, in the document's order, and the alt pair carries the
        /// same list. `SEND` and `MON` belong to the *output* list (1844-1846) and are not input
        /// groups, so a value the console would ignore cannot be selected.
        #[test]
        fn the_routing_group_option_list_is_the_documented_seventeen() {
            let expected = [
                "OFF", "LCL", "AUX", "A", "B", "C", "SC", "USB", "CRD", "MOD", "PLAY", "AES", "USR",
                "OSC", "BUS", "MAIN", "MTX",
            ];
            assert_eq!(INPUT_CONN_GROUPS, &expected, "Maillot 1956-1958");
            assert_eq!(INPUT_CONN_GROUPS.len(), 17);
            for (category, key) in [
                ("ch", "input_conn_group"),
                ("ch", "input_conn_alt_group"),
                ("aux", "input_conn_group"),
                ("aux", "input_conn_alt_group"),
            ] {
                let rule = watch_rule(category, key)
                    .unwrap_or_else(|| panic!("{category}/{key} must be in the catalogue"));
                assert_eq!(rule.value_kind, "enum", "{category}/{key}");
                assert_eq!(rule.arg_kind, "string", "{category}/{key}: a list is written as text");
                assert_eq!(rule.options, INPUT_CONN_GROUPS, "{category}/{key}");
                assert!(value_problem(category, key, "BUS").is_none(), "{category}/{key}");
                assert!(value_problem(category, key, "MTX").is_none(), "{category}/{key}");
                // The console's list is upper case, and the two output-only groups are not in it.
                assert!(value_problem(category, key, "bus").is_some(), "{category}/{key}");
                assert!(value_problem(category, key, "SEND").is_some(), "{category}/{key}");
                assert!(value_problem(category, key, "MON").is_some(), "{category}/{key}");
            }
            // The two documented lists agree on the seventeen: the output list is this one plus the FX
            // send and the monitor node, which no input can be connected to.
            assert_eq!(OUTPUT_SOURCE_GROUPS.len(), INPUT_CONN_GROUPS.len() + 2);
            for group in INPUT_CONN_GROUPS {
                assert!(
                    OUTPUT_SOURCE_GROUPS.contains(group),
                    "{group} is documented for both an input and an output"
                );
            }
        }

        /// The two routing numbers are whole numbers with the node's documented bound (1959, 2228,
        /// 1964, 2232): the console takes 1…64 whatever the group, and the group decides what the
        /// number means — `$BUS` 1…32, `$MAIN` 1…8, `$MTX` 1…16 (1795-1823). One field cannot validate
        /// the pair, so the hint has to say so and the read-back is the authority.
        #[test]
        fn the_routing_numbers_are_whole_numbers_bounded_1_to_64() {
            for (category, key, maillot) in [
                ("ch", "input_conn_index", 1959),
                ("ch", "input_conn_alt_index", 1964),
                ("aux", "input_conn_index", 2228),
                ("aux", "input_conn_alt_index", 2232),
            ] {
                let rule = watch_rule(category, key)
                    .unwrap_or_else(|| panic!("{category}/{key} must be in the catalogue"));
                assert_eq!(rule.arg_kind, "int", "{category}/{key} is an OSC integer ({maillot})");
                assert_eq!(
                    rule.value_kind, "number",
                    "{category}/{key} is an index, not a level ({maillot})"
                );
                assert_eq!((rule.min, rule.max), (1.0, 64.0), "{category}/{key} ({maillot})");
                assert!(
                    !watch_value_is_continuous(&rule),
                    "{category}/{key} is a whole number: a fade must not be offered"
                );
                assert!(value_problem(category, key, "1").is_none(), "{category}/{key}");
                assert!(value_problem(category, key, "64").is_none(), "{category}/{key}");
                assert!(value_problem(category, key, "65").is_some(), "{category}/{key}");
                assert!(value_problem(category, key, "0").is_some(), "{category}/{key}");
                for needle in ["$BUS", "$MAIN", "$MTX", "1…32", "1…8", "1…16"] {
                    assert!(
                        rule.hint.contains(needle),
                        "{category}/{key} must name the group-dependent range ({needle}): {}",
                        rule.hint
                    );
                }
                assert!(
                    rule.hint.contains("one field cannot validate"),
                    "{category}/{key} must say the pair cannot be validated here: {}",
                    rule.hint
                );
            }
        }

        #[test]
        fn a_bus_sending_to_itself_is_refused() {
            // Maillot footnote 38 (`scratch/wing_protocols.txt:2528`).
            let mut itself = target("bus", "1", "send_on");
            itself.send_id = Some(1);
            assert!(resolve_basic_addresses(&itself).is_empty());
            let mut other = target("bus", "1", "send_on");
            other.send_id = Some(2);
            assert_eq!(
                resolve_basic_addresses(&other),
                vec!["/bus/1/send/2/on".to_string()]
            );
            // The rule covers every bus-to-bus leaf, `pre` included.
            let mut pre_itself = target("bus", "1", "send_pre");
            pre_itself.send_id = Some(1);
            assert!(resolve_basic_addresses(&pre_itself).is_empty());
            let mut pre_other = target("bus", "1", "send_pre");
            pre_other.send_id = Some(3);
            assert_eq!(
                resolve_basic_addresses(&pre_other),
                vec!["/bus/1/send/3/pre".to_string()]
            );
            // A bus send with no destination at all defaults to send 1, which is the same
            // self-send trap: it fails closed instead (see `send_index_for`).
            assert!(resolve_basic_addresses(&target("bus", "1", "send_on")).is_empty());
            assert!(resolve_basic_addresses(&target("bus", "1", "send_pre")).is_empty());
            // A channel may send to itself: the rule is bus-only.
            let mut channel = target("ch", "1", "send_on");
            channel.send_id = Some(1);
            assert_eq!(
                resolve_basic_addresses(&channel),
                vec!["/ch/1/send/1/on".to_string()]
            );
        }

        // ── Batch 4: the USB transport, the fader layers and the console status ───────────────────

        /// Every key of the batch resolves to the address Maillot documents, in the category that
        /// owns it: the two USB nodes and the console-status node without an id segment, the fader
        /// layers with each of their seven letters (Maillot 3045-3075, 3096-3097, 3220-3645).
        #[test]
        fn every_transport_layer_and_status_key_resolves_to_its_documented_path() {
            let table: &[(&str, &str, &str, &str)] = &[
                // The USB recorder (3068-3075): the four leaves a step writes, then the two the
                // console reports.
                ("rec", "", "rec_action", "/rec/$action"),
                ("rec", "1", "rec_path", "/rec/path"),
                ("rec", "3", "rec_resolution", "/rec/resolution"),
                ("rec", "7", "rec_channels", "/rec/channels"),
                ("recstate", "", "rec_state", "/rec/$actstate"),
                ("recstate", "2", "rec_time", "/rec/$time"),
                // The USB player (3045-3066), whose commands need an open playlist (footnote 51).
                ("play", "", "play_action", "/play/$action"),
                ("play", "4", "play_file", "/play/$playfile"),
                ("play", "9", "play_repeat", "/play/repeat"),
                ("playstate", "", "play_state", "/play/$actstate"),
                ("playstate", "5", "play_position", "/play/$pos"),
                // The seven fader-layer surfaces, each with its own letter (3219-3644).
                ("layer", "1", "layer_select", "/$ctl/layer/L/sel"),
                ("layer", "2", "layer_select", "/$ctl/layer/C/sel"),
                ("layer", "3", "layer_select", "/$ctl/layer/R/sel"),
                ("layer", "4", "layer_select", "/$ctl/layer/CMPCT/sel"),
                ("layer", "5", "layer_select", "/$ctl/layer/RCK/sel"),
                ("layer", "6", "layer_select", "/$ctl/layer/EXT/sel"),
                ("layer", "7", "layer_select", "/$ctl/layer/VRT/sel"),
                // The console status (3095-3097), no id segment either.
                ("stat", "", "selected_strip", "/$ctl/$stat/selidx"),
                ("stat", "6", "selected_page", "/$ctl/$stat/pageidx"),
            ];
            for (category, id, key, expected) in table {
                assert_eq!(
                    resolve_basic_addresses(&target(category, id, key)),
                    vec![(*expected).to_string()],
                    "{category}/{key} (id {id}) must resolve to {expected}"
                );
            }

            // The id list is not part of the question for the index-less categories: no id, the
            // single entry, another number or a list all give the one documented address — exactly
            // as show control and `io` behave — and the number is never a path segment.
            for (category, key, address) in [
                ("rec", "rec_action", "/rec/$action"),
                ("recstate", "rec_state", "/rec/$actstate"),
                ("play", "play_action", "/play/$action"),
                ("playstate", "play_state", "/play/$actstate"),
                ("stat", "selected_strip", "/$ctl/$stat/selidx"),
            ] {
                for ids in ["", "1", "7", "1,2,3"] {
                    let resolved = resolve_basic_addresses(&target(category, ids, key));
                    assert_eq!(
                        resolved,
                        vec![address.to_string()],
                        "{category}/{key} with ids \"{ids}\" must resolve to {address}"
                    );
                    assert!(
                        resolved.iter().all(|one| !one.contains("/1/")),
                        "{category}/{key}: the id never enters the path"
                    );
                }
                assert!(
                    category_has_id(category, 9),
                    "{category} has one entry and no id to bound"
                );
            }

            // The other direction: the two halves of a split are not interchangeable, and no key of
            // the batch exists on a category the document does not define it for.
            assert!(resolve_basic_addresses(&target("rec", "1", "rec_state")).is_empty());
            assert!(resolve_basic_addresses(&target("recstate", "1", "rec_action")).is_empty());
            assert!(resolve_basic_addresses(&target("play", "1", "play_state")).is_empty());
            assert!(resolve_basic_addresses(&target("playstate", "1", "play_action")).is_empty());
            assert!(resolve_basic_addresses(&target("stat", "1", "rec_action")).is_empty());
            assert!(resolve_basic_addresses(&target("rec", "1", "play_action")).is_empty());
            assert!(resolve_basic_addresses(&target("play", "1", "layer_select")).is_empty());
            assert!(resolve_basic_addresses(&target("ch", "1", "layer_select")).is_empty());
            assert!(resolve_basic_addresses(&target("layer", "1", "selected_strip")).is_empty());
            assert!(resolve_basic_addresses(&target("stat", "1", "scene_active_index")).is_empty());
            assert!(resolve_basic_addresses(&target("showstate", "1", "selected_strip")).is_empty());

            // The USB player *node* is not the USB player *input source*: `play` used to be a
            // shorthand for `preamp_usbplayer` (`/io/in/PLAY`, 1735), and the transport category owns
            // the name now. A catalogue key wins over an alias, so the transport keys resolve under
            // `/play` while the source keeps its own two names…
            assert_eq!(
                resolve_basic_addresses(&target("preamp_usbplayer", "2", "source_mode")),
                vec!["/io/in/PLAY/2/mode".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&target("usbplayer", "2", "source_mode")),
                vec!["/io/in/PLAY/2/mode".to_string()]
            );
            // …and a show file that meant the source through the old shorthand fails closed instead
            // of resolving to a wrong address, on the write path and on the meter path alike.
            assert!(resolve_basic_addresses(&target("play", "2", "source_mode")).is_empty());
            assert!(resolve_basic_addresses(&target("play", "1", "gain")).is_empty());
            assert!(meter_descriptors_for_target(&target("play", "1", "meter")).is_empty());
        }

        /// The transport keys are writes and the state keys are watches: the four writable recorder
        /// keys and the three writable player keys are in their category's target list and in no
        /// watch list, the two reported keys of each node the other way round, and the leaf table
        /// refuses the crossing — exactly the split `show`/`showstate` established (Maillot
        /// 3045-3075). The last loop pins the rule the other way: a key offered as a write must never
        /// be refused by the resolver.
        #[test]
        fn only_the_writable_transport_keys_are_targets_and_only_the_read_only_state_keys_are_watched(
        ) {
            for (category, can_target, can_trigger) in [
                ("rec", true, false),
                ("recstate", false, true),
                ("play", true, false),
                ("playstate", false, true),
            ] {
                let info = target_categories()
                    .iter()
                    .find(|info| info.key == category)
                    .unwrap_or_else(|| panic!("{category} is a category"));
                assert_eq!(
                    (info.can_target, info.can_trigger),
                    (can_target, can_trigger),
                    "{category}: the console takes one half of the node and reports the other"
                );
            }

            let keys = |parameters: Vec<TargetParameterInfo>| -> Vec<&'static str> {
                parameters
                    .into_iter()
                    .map(|parameter| parameter.key)
                    .collect()
            };
            assert_eq!(
                keys(target_parameters_for_category("rec")),
                vec!["rec_action", "rec_path", "rec_resolution", "rec_channels"]
            );
            assert_eq!(
                keys(target_parameters_for_category("play")),
                vec!["play_action", "play_file", "play_repeat"]
            );
            assert_eq!(
                keys(trigger_parameters_for_category("recstate")),
                vec!["rec_state", "rec_time"]
            );
            assert_eq!(
                keys(trigger_parameters_for_category("playstate")),
                vec!["play_state", "play_position"]
            );
            // The other direction is empty, so the picker cannot offer a key on the wrong control.
            assert!(trigger_parameters_for_category("rec").is_empty());
            assert!(trigger_parameters_for_category("play").is_empty());
            assert!(target_parameters_for_category("recstate").is_empty());
            assert!(target_parameters_for_category("playstate").is_empty());

            // Every writable entry answers "not reported", so a key moved across the split fails
            // here even if a list were edited to keep it in both places.
            for category in ["rec", "play"] {
                for parameter in target_parameters_for_category(category) {
                    assert!(
                        !parameter.can_trigger,
                        "{category}/{} is written, never reported",
                        parameter.key
                    );
                    assert!(
                        watch_operators(category, parameter.key).is_empty(),
                        "{category}/{} must offer no comparator",
                        parameter.key
                    );
                    assert!(
                        watch_problem(category, parameter.key, "==", "1").is_some(),
                        "{category}/{} must not be watchable",
                        parameter.key
                    );
                }
            }
            // Every state entry is reported and resolves (that address is what a watch reads), and
            // the crossing resolves to nothing whatever the picker offered.
            for category in ["recstate", "playstate"] {
                for parameter in trigger_parameters_for_category(category) {
                    assert!(
                        parameter.can_trigger,
                        "{category}/{} is reported by the console",
                        parameter.key
                    );
                }
            }
            assert!(resolve_basic_addresses(&target("rec", "1", "rec_state")).is_empty());
            assert!(resolve_basic_addresses(&target("recstate", "1", "rec_action")).is_empty());
            assert!(resolve_basic_addresses(&target("play", "1", "play_state")).is_empty());
            assert!(resolve_basic_addresses(&target("playstate", "1", "play_action")).is_empty());

            // A key must never be both offered as a write and refused by the resolver: every entry
            // of both views of every batch-4 category resolves to an address.
            for category in ["rec", "recstate", "play", "playstate", "layer", "stat"] {
                for parameter in target_parameters_for_category(category)
                    .into_iter()
                    .chain(trigger_parameters_for_category(category))
                {
                    assert!(
                        !resolve_basic_addresses(&target(category, "1", parameter.key)).is_empty(),
                        "{category}/{} is offered but resolves to nothing",
                        parameter.key
                    );
                }
            }
        }

        /// The console status is watch-only: the two keys the sweep called valuable — "when the
        /// operator selects strip n" — are read by the console and written by nobody, so the
        /// category carries `can_trigger` and not `can_target`, its target list is empty and a step
        /// cannot be built for it (Maillot 3095-3097).
        #[test]
        fn the_console_status_keys_are_watch_only_and_a_write_is_refused() {
            let stat = target_categories()
                .iter()
                .find(|info| info.key == "stat")
                .expect("stat is a category");
            assert_eq!(stat.label, "Console Status");
            assert_eq!(stat.group, "Console");
            assert_eq!(stat.count, 1);
            assert_eq!(stat.prefix, "/$ctl/$stat");
            assert!(
                stat.can_trigger && !stat.can_target,
                "the console reports the status node; a step must not write it"
            );
            assert_eq!(category_id_segment("stat"), CategoryIdSegment::Absent);
            assert_eq!(prefix_for_category("stat"), Some("/$ctl/$stat"));

            let writable = target_parameters_for_category("stat");
            assert!(
                writable.is_empty(),
                "a write into the status node must be refused: {writable:?}"
            );
            assert!(watch_rule("stat", "selected_strip").is_some());
            assert!(watch_rule("stat", "selected_page").is_some());
            let watchable: Vec<&str> = trigger_parameters_for_category("stat")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert_eq!(watchable, vec!["selected_strip", "selected_page"]);

            // Both are whole numbers with the documented range (3096-3097): the read-back is the
            // only way the console reports them, and the comparison value obeys the same rule.
            let strip = watch_rule("stat", "selected_strip").expect("the strip is in the catalogue");
            assert_eq!((strip.arg_kind, strip.value_kind), ("int", "number"));
            assert_eq!((strip.min, strip.max), (1.0, 76.0), "Maillot 3096: 1…76");
            assert!(
                !watch_value_is_continuous(&strip),
                "a strip index is a whole number: a fade must not be offered"
            );
            assert_eq!(watch_operators("stat", "selected_strip"), &["<", ">", "==", "!="]);
            assert!(watch_problem("stat", "selected_strip", "==", "12").is_none());
            assert!(value_problem("stat", "selected_strip", "76").is_none());
            assert!(value_problem("stat", "selected_strip", "77").is_some());
            assert!(value_problem("stat", "selected_strip", "0").is_some());
            // Footnote 54 is the trap this hint exists for: what the console reports is 0…75 while
            // the indexing used when setting is 1…76.
            assert!(
                strip.hint.contains("0…75") && strip.hint.contains("footnote 54"),
                "the strip hint must carry the read/write offset: {}",
                strip.hint
            );

            let page = watch_rule("stat", "selected_page").expect("the page is in the catalogue");
            assert_eq!((page.arg_kind, page.value_kind), ("int", "number"));
            assert_eq!((page.min, page.max), (0.0, 30.0), "Maillot 3097: 0…30");
            assert!(value_problem("stat", "selected_page", "0").is_none());
            assert!(value_problem("stat", "selected_page", "30").is_none());
            assert!(value_problem("stat", "selected_page", "31").is_some());
            assert!(value_problem("stat", "selected_page", "-1").is_some());

            // No id ever enters the path, and the number is not a fallback.
            for ids in ["", "1", "12", "1,2,3"] {
                assert_eq!(
                    resolve_basic_addresses(&target("stat", ids, "selected_strip")),
                    vec!["/$ctl/$stat/selidx".to_string()],
                    "selected_strip with ids \"{ids}\""
                );
                assert_eq!(
                    resolve_basic_addresses(&target("stat", ids, "selected_page")),
                    vec!["/$ctl/$stat/pageidx".to_string()],
                    "selected_page with ids \"{ids}\""
                );
            }
            assert_ne!(
                resolve_basic_addresses(&target("stat", "1", "selected_strip")),
                vec!["/$ctl/$stat/1/selidx".to_string()]
            );
        }

        /// The closed lists are the documented ones — the player's seven actions (3053), the
        /// recorder's four (3071), the recorder's 16/24 bit depth and 2/4 channel count (3073-3074)
        /// and the four states each node reports (3055, 3069) — in the document's order and in the
        /// console's own spelling. A misspelt action is an OSC string the console ignores in silence,
        /// so this list is the only thing between the editor and a macro that does nothing.
        #[test]
        fn the_transport_option_lists_are_the_documented_ones() {
            let rule = |category: &str, parameter: &str| {
                watch_rule(category, parameter)
                    .unwrap_or_else(|| panic!("{category}/{parameter} must be in the catalogue"))
            };

            let actions = rule("play", "play_action");
            assert_eq!(actions.value_kind, "enum");
            assert_eq!(actions.arg_kind, "string", "a list is written as text");
            assert_eq!(
                actions.options,
                ["IDLE", "STOP", "PLAY", "PAUSE", "NEXT", "PREV", "PLAYFILE"],
                "Maillot 3053"
            );
            assert_eq!(actions.options.len(), 7);

            let recorder_actions = rule("rec", "rec_action");
            assert_eq!(recorder_actions.value_kind, "enum");
            assert_eq!(
                recorder_actions.options,
                ["STOP", "REC", "PAUSE", "NEWFILE"],
                "Maillot 3071"
            );
            assert_eq!(recorder_actions.options.len(), 4);

            assert_eq!(
                rule("rec", "rec_resolution").options,
                ["16", "24"],
                "Maillot 3073"
            );
            assert_eq!(rule("rec", "rec_channels").options, ["2", "4"], "Maillot 3074");
            assert_eq!(
                rule("recstate", "rec_state").options,
                ["STOP", "REC", "PAUSE", "ERROR"],
                "Maillot 3069"
            );
            assert_eq!(
                rule("playstate", "play_state").options,
                ["STOP", "PLAY", "PAUSE", "ERROR"],
                "Maillot 3055"
            );
            // The two nodes print different state lists — the recorder has REC where the player has
            // PLAY — so one list cannot serve both.
            assert_ne!(
                rule("recstate", "rec_state").options,
                rule("playstate", "play_state").options
            );

            // The values are the console's strings: upper case, and nothing outside the list.
            assert!(value_problem("play", "play_action", "PLAYFILE").is_none());
            assert!(value_problem("play", "play_action", "playfile").is_some());
            assert!(value_problem("play", "play_action", "LOAD").is_some());
            assert!(value_problem("rec", "rec_action", "NEWFILE").is_none());
            assert!(value_problem("rec", "rec_action", "RESET").is_some());
            assert!(value_problem("rec", "rec_resolution", "16").is_none());
            assert!(value_problem("rec", "rec_resolution", "32").is_some());
            assert!(value_problem("rec", "rec_channels", "4").is_none());
            // 1 is a channel count of the *player's* read-only `$channels` row (3063), not of this
            // writable recorder leaf.
            assert!(value_problem("rec", "rec_channels", "1").is_some());
        }

        /// The two time-like leaves are numbers, not meters and not text: `$pos` and `$time` are
        /// documented `F` (3060, 3075), so the editor offers the ordered comparators and invents no
        /// unit. `$pos` carries the document's own 0…35999; `$time` carries no range at all, so the
        /// catalogue's bound is deliberately wide and the hint says the read-back is the authority.
        #[test]
        fn the_player_position_and_recorder_time_are_numbers() {
            let position =
                watch_rule("playstate", "play_position").expect("the position is in the catalogue");
            assert_eq!(position.arg_kind, "float", "Maillot 3060 types `$pos` as F");
            assert_eq!(position.value_kind, "number");
            assert_eq!((position.min, position.max), (0.0, 35999.0), "36000 steps (3060)");
            assert!(position.unit.is_empty(), "Maillot gives no unit for the position");
            assert!(
                position.hint.contains("36000 steps") && position.hint.contains("footnote 51"),
                "the position hint must carry the documented steps and the playlist caveat: {}",
                position.hint
            );
            assert_eq!(watch_operators("playstate", "play_position"), &["<", ">", "==", "!="]);
            assert!(watch_problem("playstate", "play_position", ">", "120").is_none());
            assert!(value_problem("playstate", "play_position", "35999").is_none());
            assert!(value_problem("playstate", "play_position", "36000").is_some());
            assert!(value_problem("playstate", "play_position", "-1").is_some());
            // A position is not a level: the dB comparison this audit exists for is refused by the
            // range, not accepted as a macro that can never fire.
            assert!(watch_problem("playstate", "play_position", ">", "-20").is_some());

            let time = watch_rule("recstate", "rec_time").expect("the time is in the catalogue");
            assert_eq!(time.arg_kind, "float", "Maillot 3075 types `$time` as F");
            assert_eq!(time.value_kind, "number");
            assert!(
                time.min.is_finite() && time.max.is_finite() && time.min < time.max,
                "a number needs a usable range ({}…{})",
                time.min,
                time.max
            );
            assert_eq!(time.min, 0.0);
            assert!(
                time.hint.contains("neither a unit nor a range"),
                "the time hint must say the document settles neither: {}",
                time.hint
            );
            assert_eq!(watch_operators("recstate", "rec_time"), &["<", ">", "==", "!="]);
            assert!(value_problem("recstate", "rec_time", "0").is_none());
            assert!(value_problem("recstate", "rec_time", "3600").is_none());
            assert!(value_problem("recstate", "rec_time", "-1").is_some());

            // Both are watch-only, and the state leaves beside them are closed lists, not numbers.
            assert!(target_parameters_for_category("recstate").is_empty());
            assert!(target_parameters_for_category("playstate").is_empty());
            assert_eq!(watch_rule("recstate", "rec_state").unwrap().value_kind, "enum");
            assert_eq!(watch_rule("playstate", "play_state").unwrap().value_kind, "enum");
        }

        /// The fader layers are the catalogue's second letter family: seven surfaces, seven letters,
        /// and an eighth id resolves to nothing rather than to a numeric segment the console ignores
        /// (Maillot 3220, 3299, 3381, 3456, 3523, 3585, 3645). The one `sel` leaf carries the layer
        /// number 1…22, written and reported, with a per-surface settable range the hint states
        /// because one field cannot validate it.
        #[test]
        fn the_layer_letter_segment_renders_all_seven_surfaces_and_an_eighth_id_resolves_to_nothing()
        {
            assert_eq!(category_id_segment("layer"), CategoryIdSegment::Letter);
            assert_eq!(FADER_LAYER_LETTERS, &["L", "C", "R", "CMPCT", "RCK", "EXT", "VRT"]);
            for (id, letter) in (1_u16..=7).zip(FADER_LAYER_LETTERS) {
                assert_eq!(id_letter_for_category("layer", id), Some(*letter));
                assert_eq!(
                    resolve_basic_addresses(&target("layer", &id.to_string(), "layer_select")),
                    vec![format!("/$ctl/layer/{letter}/sel")],
                    "layer {id} is {letter}"
                );
            }
            // A list renders one address per surface, in the order the editor wrote it.
            assert_eq!(
                resolve_basic_addresses(&target("layer", "2,7", "layer_select")),
                vec![
                    "/$ctl/layer/C/sel".to_string(),
                    "/$ctl/layer/VRT/sel".to_string()
                ]
            );
            // The eighth id names no surface: no address at all, and never a numeric segment.
            assert_eq!(id_letter_for_category("layer", 8), None);
            assert_eq!(id_letter_for_category("layer", 0), None);
            assert!(resolve_basic_addresses(&target("layer", "8", "layer_select")).is_empty());
            assert!(resolve_basic_addresses(&target("layer", "0", "layer_select")).is_empty());
            assert_eq!(
                resolve_basic_addresses(&target("layer", "1-8", "layer_select")).len(),
                7,
                "1-8 renders the seven surfaces and drops the eighth"
            );
            assert_ne!(
                resolve_basic_addresses(&target("layer", "1", "layer_select")),
                vec!["/$ctl/layer/1/sel".to_string()]
            );
            // The alphabet belongs to the category: talkback's `A` is not this one, and no other
            // category renders a letter (the enumeration is in
            // `only_show_control_is_index_less_and_the_indexed_families_are_untouched`).
            assert_eq!(id_letter_for_category("layer", 1), Some("L"));
            assert_eq!(id_letter_for_category("ch", 1), None);
            assert_ne!(
                id_letter_for_category("layer", 1),
                id_letter_for_category("talk", 1)
            );

            let rule =
                watch_rule("layer", "layer_select").expect("the layer leaf is in the catalogue");
            assert_eq!(rule.label, "Fader Layer");
            assert_eq!(rule.arg_kind, "int", "Maillot 3220 types `sel` as I");
            assert_eq!(rule.value_kind, "number");
            assert_eq!((rule.min, rule.max), (1.0, 22.0), "Maillot 3220: 1…22");
            assert!(
                !watch_value_is_continuous(&rule),
                "a layer index is a whole number: a fade must not be offered"
            );
            assert!(rule.can_trigger, "the console reports the layer it took");
            assert!(
                rule.hint.contains("1…7") && rule.hint.contains("1…6") && rule.hint.contains("[TBV]"),
                "the layer hint must carry the per-surface settable range and the [TBV] caveat: {}",
                rule.hint
            );
            assert!(value_problem("layer", "layer_select", "1").is_none());
            assert!(value_problem("layer", "layer_select", "22").is_none());
            assert!(value_problem("layer", "layer_select", "23").is_some());
            assert!(value_problem("layer", "layer_select", "0").is_some());

            // Written *and* reported, so the one key is in both views of its category.
            let targets: Vec<&str> = target_parameters_for_category("layer")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            let watches: Vec<&str> = trigger_parameters_for_category("layer")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert_eq!(targets, vec!["layer_select"]);
            assert_eq!(watches, targets, "the console reports the layer it took");
        }

        /// A fade writes a series of numbers, so the catalogue entry has to say the leaf takes one:
        /// the value kind rules out an on/off, a name or a model, and the argument kind rules out
        /// the whole-number leaves Maillot documents as `I`.
        #[test]
        fn only_continuous_values_can_be_ramped() {
            // Per family, because the catalogue is: a bus has a trim and a fader but no filter.
            for (category, parameter) in [
                ("ch", "fader"),
                ("ch", "pan"),
                ("ch", "trim"),
                ("ch", "hpf_freq"),
                ("bus", "trim"),
                ("main", "eq_5_gain"),
                ("ch", "delay_time"),
                ("fx", "fx_mix"),
            ] {
                let rule = watch_rule(category, parameter)
                    .unwrap_or_else(|| panic!("{category} must offer {parameter}"));
                assert!(
                    watch_value_is_continuous(&rule),
                    "{parameter} should accept a fade on {category}"
                );
            }
            for parameter in ["mute", "name", "gate_type", "output_group"] {
                let family = if parameter == "output_group" { "output_local" } else { "ch" };
                let rule = watch_rule(family, parameter).expect(parameter);
                assert!(
                    !watch_value_is_continuous(&rule),
                    "{parameter} must not be ramped: a fade writes numbers"
                );
            }
            // A whole-number leaf keeps its numeric value kind (the ordered comparators still make
            // sense) but must not be offered a fade: the write would be `,f` on a leaf Maillot
            // documents as `I`, and "fade the colour from 3 to 9" is not an operation the console
            // has. Each of these is a real catalogue key on a family that offers it.
            for (category, parameter, value_kind, maillot) in [
                ("ch", "color", "number", 1985),
                ("ch", "icon", "number", 1987),
                ("ch", "comp_knee", "db", 2112),
                ("dca", "color", "number", 2869),
                ("preamp_local", "color", "number", 1604),
                ("output_local", "output_source", "number", 1847),
            ] {
                let rule = watch_rule(category, parameter)
                    .unwrap_or_else(|| panic!("{category} must offer {parameter}"));
                assert_eq!(
                    rule.arg_kind, "int",
                    "{parameter} is written as an OSC integer ({maillot})"
                );
                assert_eq!(
                    rule.value_kind, value_kind,
                    "{parameter} keeps its ordered comparators ({maillot})"
                );
                assert!(
                    !watch_value_is_continuous(&rule),
                    "{parameter} is a whole number ({maillot}): a fade must not be offered"
                );
            }
        }

        /// A fade's *shape* is the leaf's own property, so the domain has to be read from the tables
        /// that document the leaf: `linf` moves by offset, `logf` by ratio.
        ///
        /// The evidence, per family:
        ///   * a frequency is `logf` on every table that prints one (`lf`/`1f`/`hf`, Maillot 8615-8632),
        ///     and the routing tables' own step counts agree for the leaves the appendix does not
        ///     label: `hpf_freq` is 20…2000 in 641 steps (1969), exactly the STD `lf` row's range and
        ///     step count, `lpf_freq` is 50…20000 in 833 (1972), which is STD `hf`'s, and
        ///     `peq_*_freq`/`gate_sc_freq` are 20…20000 in 960/961 (2016, 2050) against STD `1f`'s 961.
        ///     A linear scale over those ranges would need a 3.1 Hz and a 20.8 Hz step — a resolution
        ///     no desk documents — where the ratio is 0.7 % per step, the same as every labelled row.
        ///   * a Q (`lq`, `1q`…`6q`, `hq`, `gatesc/q`, `dynsc/q`) is `logf [0.442, 10, 181]` in the
        ///     STD table (8616, 8620) and the unlabelled sidechain rows print the same 0.44…10 in 181
        ///     steps (2051, 2134).
        ///   * a release time is the one `ms` row the appendix documents `logf` (GATE 8217, COMP 8377);
        ///     the attack and hold of the same tables are `linf` (8215-8216, 8375-8376).
        /// Everything else moves by offset: every dB row, every percentage, every attack, hold, delay
        /// and accent.
        #[test]
        fn a_fade_moves_in_the_domain_its_leaf_documents() {
            for (category, parameter) in [
                ("ch", "eq_1_freq"),
                ("ch", "eq_low_freq"),
                ("ch", "eq_high_freq"),
                ("bus", "eq_5_freq"),
                ("ch", "hpf_freq"),
                ("ch", "lpf_freq"),
                ("ch", "peq_1_freq"),
                ("ch", "gate_sc_freq"),
                ("ch", "dyn_sc_freq"),
                ("preamp_oscillator", "osc_freq"),
                ("ch", "eq_1_q"),
                ("ch", "eq_low_q"),
                ("ch", "peq_1_q"),
                ("ch", "gate_sc_q"),
                ("ch", "dyn_sc_q"),
                ("ch", "gate_release"),
                ("ch", "comp_release"),
            ] {
                assert_eq!(
                    fade_domain(category, parameter, None),
                    FadeDomain::Logarithmic,
                    "{category}/{parameter} is documented logarithmic and must move by ratio"
                );
            }
            for (category, parameter) in [
                ("ch", "fader"),
                ("ch", "pan"),
                ("ch", "trim"),
                ("ch", "eq_1_gain"),
                ("ch", "eq_mix"),
                ("ch", "gate_thr"),
                ("ch", "gate_attack"),
                ("ch", "gate_hold"),
                ("ch", "comp_attack"),
                ("ch", "comp_hold"),
                ("ch", "gate_accent"),
                ("ch", "delay_time"),
                ("preamp_oscillator", "osc_level"),
                ("fx", "fx_mix"),
                ("monbus", "monitor_dim"),
            ] {
                assert_eq!(
                    fade_domain(category, parameter, None),
                    FadeDomain::Linear,
                    "{category}/{parameter} is documented linear and must move by offset"
                );
            }
            // A raw custom address, and a key nothing documents, keep the linear fallback.
            assert_eq!(fade_domain("custom", "raw", None), FadeDomain::Linear);
            assert_eq!(fade_domain("ch", "no_such_key", None), FadeDomain::Linear);
        }

        /// Where the tables disagree, the model the step carries decides; where it is not known, the
        /// answer is the one every candidate table agrees on.
        #[test]
        fn a_model_scoped_fade_domain_follows_the_model_the_step_carries() {
            // `/gate/rel` is `logf` on the GATE table (8217) and `linf` on the DUCK one (8230) — the
            // same leaf, two scales, decided by the model the console reports.
            assert_eq!(
                fade_domain("ch", "gate_release", Some("GATE")),
                FadeDomain::Logarithmic
            );
            assert_eq!(
                fade_domain("ch", "gate_release", Some("DUCK")),
                FadeDomain::Linear
            );
            // The EQ's `lf` is a frequency on STD (`logf`, 8615) and a plain 0…10 control on SOUL
            // (`linf`, 8669): a fade of the same key has to follow the strip's own model.
            assert_eq!(
                fade_domain("ch", "eq_low_freq", Some("STD")),
                FadeDomain::Logarithmic
            );
            assert_eq!(
                fade_domain("ch", "eq_low_freq", Some("SOUL")),
                FadeDomain::Linear
            );
            // A model-qualified key is answered the same way, without a catalogue row.
            assert_eq!(
                fade_domain("ch", "eq:1f", Some("STD")),
                FadeDomain::Logarithmic
            );
            assert_eq!(fade_domain("ch", "gate:att", Some("GATE")), FadeDomain::Linear);
        }

        /// The range a fade's endpoints are held to is the leaf's own documented range — the same one
        /// the editor's field rule and the preflight note read, so the three cannot disagree.
        #[test]
        fn a_fade_endpoint_range_is_the_leafs_own() {
            assert_eq!(fade_value_range("ch", "eq_1_freq", None), Some((20.0, 20_000.0)));
            assert_eq!(fade_value_range("ch", "eq_1_gain", None), Some((-15.0, 15.0)));
            assert_eq!(fade_value_range("ch", "fader", None), Some((-144.0, 10.0)));
            assert_eq!(fade_value_range("ch", "pan", None), Some((-100.0, 100.0)));
            assert_eq!(fade_value_range("ch", "comp_release", None), Some((4.0, 4000.0)));
            // A model-scoped key comes from that model's appendix row when the model is known.
            assert_eq!(
                fade_value_range("ch", "eq_low_gain", Some("STD")),
                Some((-15.0, 15.0))
            );
            assert_eq!(
                fade_value_range("ch", "eq_low_gain", Some("SOUL")),
                Some((-5.0, 5.0))
            );
            // Nothing documents a range for a raw custom address.
            assert_eq!(fade_value_range("custom", "raw", None), None);
            assert_eq!(fade_value_range("ch", "no_such_key", None), None);
        }

        /// Every parameter the catalogue offers a fade on has both answers: a domain and a range. A
        /// new entry that forgets one is a fade the runtime would have to guess about.
        #[test]
        fn every_fadeable_parameter_declares_a_domain_and_a_range() {
            for category in target_categories() {
                for rule in target_parameters_for_category(category.key) {
                    if !watch_value_is_continuous(&rule) {
                        continue;
                    }
                    assert!(
                        fade_value_range(category.key, rule.key, None).is_some(),
                        "{}/{} can be faded but documents no range",
                        category.key,
                        rule.key
                    );
                    let domain = fade_domain(category.key, rule.key, None);
                    assert!(
                        matches!(domain, FadeDomain::Linear | FadeDomain::Logarithmic),
                        "{}/{} has no domain",
                        category.key,
                        rule.key
                    );
                }
            }
        }

        #[test]
        fn every_watchable_parameter_declares_a_kind_with_operators() {
            for category in target_categories() {
                for rule in trigger_parameters_for_category(category.key) {
                    assert!(
                        VALUE_KINDS.contains(&rule.value_kind),
                        "{} / {} declares an unknown value kind {}",
                        category.key,
                        rule.key,
                        rule.value_kind
                    );
                    assert!(
                        !operators_for_value_kind(rule.value_kind).is_empty(),
                        "{} / {} has no comparators",
                        category.key,
                        rule.key
                    );
                    if matches!(rule.value_kind, "text" | "enum") && !rule.options.is_empty() {
                        assert!(
                            !rule.hint.is_empty() || !rule.options.is_empty(),
                            "{} / {} needs a hint or options",
                            category.key,
                            rule.key
                        );
                    }
                }
            }
        }

        /// A value a parameter of this kind accepts, for the contract test below.
        fn sample_value(parameter: &TargetParameterInfo) -> String {
            match parameter.value_kind {
                "toggle" => "1".to_string(),
                "enum" | "text" => {
                    let sample = parameter.options.first().copied().unwrap_or("VOX 1");
                    // A free-text leaf can be shorter than the sample — the safes masks go down to
                    // two characters (`safes_source_aes`, 4037) and rightly refuse "VOX 1" — so the
                    // sample is cut to the documented length. A closed list is never cut: its options
                    // are the list itself, and a truncated one would not be a value at all.
                    let limit = if parameter.options.is_empty() {
                        usize::from(parameter.max_len)
                    } else {
                        0
                    };
                    if limit == 0 {
                        sample.to_string()
                    } else {
                        sample.chars().take(limit).collect()
                    }
                }
                _ => trim_number((parameter.min + parameter.max) / 2.0),
            }
        }

        /// No user-visible string of the catalogue may name the console this project tests with. The app
        /// is used with many different WING desks, and one unit's identity — its discovery name, its
        /// serial, its address, its firmware — only confuses the operator who owns another one
        /// (AGENTS.md, "No Console Identity In User-Visible Text"). Hardware evidence belongs in the
        /// code comments and in `docs/`; what a hint may carry is "verified on hardware" and the
        /// document's own row.
        ///
        /// Model *families* stay legal, because the document itself distinguishes them: the monitor
        /// level's "a Rack or a Compact" is footnote 13, not this desk. That is why the guard looks for
        /// a hyphenated identity token (`WING-RACK…`) rather than for the word WING.
        #[test]
        fn no_hint_names_a_specific_desk() {
            /// `FW 3.1.1`, `FW3.1.1` and `FW_3.1.1` are all the same disclosure: a firmware build.
            fn names_a_firmware(text: &str) -> bool {
                let mut from = 0;
                while let Some(found) = text[from..].find("FW") {
                    let at = from + found;
                    let rest = text[at + 2..].trim_start_matches([' ', '_', '-']);
                    if rest.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                        return true;
                    }
                    from = at + 2;
                }
                false
            }

            let mut checked = 0_usize;
            for category in target_categories() {
                let mut parameters = target_parameters_for_category(category.key);
                for parameter in trigger_parameters_for_category(category.key) {
                    if !parameters.iter().any(|listed| listed.key == parameter.key) {
                        parameters.push(parameter);
                    }
                }
                for parameter in parameters {
                    for (field, text) in [("label", parameter.label), ("hint", parameter.hint)] {
                        let context = format!("{} / {} ({field})", category.key, parameter.key);
                        assert!(
                            !text.contains("WING-"),
                            "{context}: names a console's identity: {text}"
                        );
                        assert!(
                            !text.contains("192.168."),
                            "{context}: names an address: {text}"
                        );
                        assert!(
                            !names_a_firmware(text),
                            "{context}: names a firmware build: {text}"
                        );
                        checked += 1;
                    }
                }
            }
            assert!(
                checked > 500,
                "the walk must see both views of the whole catalogue, saw {checked} strings"
            );
        }

        /// One contract for the whole catalogue. The editor, the validator and the resolver all read
        /// these fields, so an entry that breaks the shape breaks a rule somewhere the operator
        /// cannot see — and a comparator list wider than the value kind allows is exactly the
        /// "meaningless combination" this audit set out to remove.
        ///
        /// Both views are walked, because a category may carry a parameter in only one of them:
        /// `showstate`'s five read-only keys are never in a target list and `show`'s two writable
        /// keys never in a trigger list, and the contract — kind, hint, range, closed list,
        /// comparators — has to hold for all seven.
        #[test]
        fn every_catalogue_entry_obeys_the_same_contract() {
            for category in target_categories() {
                let mut seen: Vec<&str> = Vec::new();
                let mut parameters = target_parameters_for_category(category.key);
                for parameter in trigger_parameters_for_category(category.key) {
                    if !parameters.iter().any(|listed| listed.key == parameter.key) {
                        parameters.push(parameter);
                    }
                }
                for parameter in parameters {
                    let context = format!("{} / {}", category.key, parameter.key);
                    assert!(!parameter.key.trim().is_empty(), "{context}: empty key");
                    assert!(
                        !parameter.label.trim().is_empty(),
                        "{context}: empty label"
                    );
                    assert!(!parameter.hint.trim().is_empty(), "{context}: empty hint");
                    assert!(
                        !parameter.key.contains(' ') && !parameter.key.contains('/'),
                        "{context}: a key names a parameter, it is not a path"
                    );
                    assert!(!seen.contains(&parameter.key), "{context}: listed twice");
                    seen.push(parameter.key);
                    assert!(
                        VALUE_KINDS.contains(&parameter.value_kind),
                        "{context}: unknown value kind {}",
                        parameter.value_kind
                    );
                    assert!(
                        matches!(parameter.arg_kind, "int" | "float" | "string"),
                        "{context}: unknown argument kind {}",
                        parameter.arg_kind
                    );
                    match parameter.value_kind {
                        "enum" => {
                            assert!(
                                parameter.options.len() >= 2,
                                "{context}: a closed list needs at least two entries"
                            );
                            for option in parameter.options {
                                assert!(!option.trim().is_empty(), "{context}: empty option");
                            }
                            let mut unique = parameter.options.to_vec();
                            unique.sort_unstable();
                            unique.dedup();
                            assert_eq!(
                                unique.len(),
                                parameter.options.len(),
                                "{context}: an option is listed twice"
                            );
                            assert_eq!(
                                parameter.arg_kind, "string",
                                "{context}: a list is written as text"
                            );
                        }
                        "text" => assert_eq!(
                            parameter.arg_kind, "string",
                            "{context}: text is written as text"
                        ),
                        "toggle" => assert_eq!(
                            (parameter.min, parameter.max),
                            (0.0, 1.0),
                            "{context}: an on/off value is 0 or 1"
                        ),
                        numeric => {
                            assert!(
                                parameter.min.is_finite()
                                    && parameter.max.is_finite()
                                    && parameter.min < parameter.max,
                                "{context}: {numeric} has no usable range ({}…{})",
                                parameter.min,
                                parameter.max
                            );
                            assert_ne!(
                                parameter.arg_kind, "string",
                                "{context}: a {numeric} value is a number"
                            );
                        }
                    }
                    // The comparators are the ones the kind allows: no more (an offer the backend
                    // refuses) and no fewer (a comparison that works but cannot be built). A
                    // parameter the console does not report offers none at all.
                    let operators = watch_operators(category.key, parameter.key);
                    if !parameter.can_trigger {
                        assert!(
                            operators.is_empty(),
                            "{context}: a parameter that cannot be watched offers comparators"
                        );
                        continue;
                    }
                    assert_eq!(
                        operators,
                        operators_for_value_kind(parameter.value_kind),
                        "{context}: comparators do not match the value kind"
                    );
                    let sample = sample_value(&parameter);
                    for operator in operators_for_value_kind(parameter.value_kind) {
                        assert!(
                            watch_problem(category.key, parameter.key, operator, &sample).is_none(),
                            "{context}: {operator} {sample} is refused although it is the parameter's own kind"
                        );
                    }
                    for operator in ["<", ">", "==", "!="] {
                        if operators_for_value_kind(parameter.value_kind).contains(&operator) {
                            continue;
                        }
                        assert!(
                            watch_problem(category.key, parameter.key, operator, &sample).is_some(),
                            "{context}: the meaningless combination {operator} {sample} is accepted"
                        );
                    }
                }
            }
        }

        /// Whatever the editor seeds into a comparison must be a value its own rule accepts: the
        /// kind default alone is not, for every parameter whose range does not contain it.
        #[test]
        fn a_starting_value_is_always_one_the_parameter_accepts() {
            for (category, parameter) in [
                ("ch", "gate_range"),
                ("ch", "comp_makeup"),
                ("ch", "comp_ratio"),
                ("ch", "dyn_drv"),
                ("ch", "send_level"),
                ("ch", "delay_time"),
                ("bus", "delay_time"),
                ("matrix", "eq_5_freq"),
            ] {
                let value = default_comparison_value(category, parameter)
                    .unwrap_or_else(|| panic!("{category}/{parameter} needs a starting value"));
                assert!(
                    watch_problem(category, parameter, ">", &value).is_none(),
                    "{category}/{parameter} seeded \"{value}\", which it refuses"
                );
            }
            // A closed list starts at its first entry; an on/off value at 1.
            assert_eq!(
                default_comparison_value("ch", "gate_type").as_deref(),
                Some("GATE")
            );
            assert_eq!(default_comparison_value("ch", "mute").as_deref(), Some("1"));
            // Free text has no sensible default, and an unwatchable parameter has none at all.
            assert!(default_comparison_value("ch", "name").is_none());
            assert!(default_comparison_value("custom", "load_snapshot").is_none());
        }

        /// A step writes a value without comparing anything, so it must obey the same limits as a
        /// comparison: the value half of the rule is now one function, and this pins it.
        #[test]
        fn a_step_value_obeys_the_same_limits_as_a_comparison() {
            assert!(value_problem("ch", "name", "VOX 1").is_none());
            assert!(value_problem("ch", "name", "a name longer than sixteen characters").is_some());
            assert!(value_problem("ch", "mute", "1").is_none());
            assert!(value_problem("ch", "mute", "ON").is_some());
            assert!(value_problem("ch", "gate_type", "GATE").is_none());
            assert!(value_problem("ch", "gate_type", "NOPE").is_some());
            assert!(value_problem("ch", "fader", "0").is_none());
            assert!(value_problem("ch", "fader", "-200").is_some());
            assert!(value_problem("ch", "fader", "").is_some());
            assert!(value_problem("ch", "pre_insert_slot", "FX3").is_none());
            assert!(value_problem("ch", "pre_insert_slot", "FX17").is_some());
            assert!(value_problem("ch", "not_a_parameter", "1").is_some());
        }

        /// The one validator the editor, preflight and the compile path all call: every refusal it
        /// can make is pinned here, including the inclusive range bounds, so a rule cannot loosen
        /// without a test noticing.
        #[test]
        fn the_shared_validator_refuses_every_impossible_comparison() {
            // An unknown pair is refused rather than accepted in silence.
            assert!(watch_problem("ch", "not_a_parameter", "==", "1").is_some());
            assert!(watch_problem("nowhere", "mute", "==", "1").is_some());
            // A parameter the console does not report cannot be watched at all.
            assert!(watch_problem("custom", "load_snapshot", "==", "/x").is_some());
            // The kind decides the comparator…
            assert!(watch_problem("ch", "name", ">", "VOX 1").is_some());
            assert!(watch_problem("ch", "mute", ">", "1").is_some());
            assert!(watch_problem("ch", "fader", "==", "0").is_none());
            // …that it is not a meter, so it keeps equality…
            assert!(watch_problem("ch", "fader", "!=", "0").is_none());
            // …the value it takes…
            assert!(watch_problem("ch", "mute", "==", "2").is_some());
            assert!(watch_problem("ch", "name", "==", "").is_some());
            assert!(
                watch_problem("ch", "name", "==", "a name longer than sixteen characters").is_some()
            );
            assert!(watch_problem("ch", "gate_type", "==", "NOPE").is_some());
            assert!(watch_problem("ch", "gate_type", "==", "GATE").is_none());
            // …and its range, with the documented bounds included.
            let fader = watch_rule("ch", "fader").expect("a channel has a fader");
            for bound in [fader.min, fader.max] {
                assert!(
                    watch_problem("ch", "fader", ">", &trim_number(bound)).is_none(),
                    "{bound} is inside the documented range"
                );
            }
            for outside in [fader.min - 1.0, fader.max + 1.0] {
                assert!(
                    watch_problem("ch", "fader", ">", &trim_number(outside)).is_some(),
                    "{outside} is outside the documented range"
                );
            }
            assert!(watch_problem("ch", "fader", ">", "not a number").is_some());
            // A meter compares by crossing only: equality is not a crossing.
            assert!(watch_problem("ch", "meter", "==", "-20").is_some());
            assert!(watch_problem("ch", "meter", ">", "-20").is_none());
            // Every message names the parameter, so the operator knows what to fix.
            let problem = watch_problem("ch", "name", ">", "VOX 1").expect("refused");
            assert!(problem.contains("Name"), "{problem}");
        }

        /// The catalogue key → appendix name map is the half of the model check that does not carry
        /// the name itself. It cannot be a second opinion about addresses: for every key of every
        /// family, `/{section}/{name}` has to be **exactly** the path the resolver builds, so a name
        /// here that `param_for_category` does not use (or the other way round) fails this test.
        /// The `section/name` tail of a resolved address, or `None` when the address does not end in
        /// a **model-scoped** leaf. A model parameter is `/<prefix>/<id>/<section>/<name>`; the
        /// section's own on/off and model-selector leaves sit in the same slot (`/gate/on`,
        /// `/gate/mdl`, `/eq/on`) but exist whatever model is loaded, so they are not model-scoped
        /// and are listed explicitly here. `/eq/mix` is the third such leaf, and the console's own
        /// node dump is the witness: the default channel prints `mdl=STD,mix=100` (958), so the EQ
        /// node has a mix whatever model it runs — while the appendix's STD table happens to omit
        /// `mix` and every other EQ table lists it. Mapping it would make the model check refuse the
        /// mix on the very model the console reports it for. `/gate/mix` is **not** in this list: the
        /// gate node's own default dump prints `mdl=GATE` with no `mix` at all (958), so there the
        /// name really is the model's. Anything else in a model slot is a leaf the map has to
        /// cover, which is what makes the walk below a completeness check and not just an equality
        /// check.
        fn trailing_model_leaf(address: &str) -> Option<String> {
            let parts = address.split('/').collect::<Vec<_>>();
            if parts.len() < 4 {
                return None;
            }
            let section = parts[parts.len() - 2];
            if !matches!(section, "gate" | "dyn" | "eq") {
                return None;
            }
            let name = parts[parts.len() - 1];
            if matches!(name, "on" | "mdl") || (section, name) == ("eq", "mix") {
                return None;
            }
            Some(format!("{section}/{name}"))
        }

        #[test]
        fn every_catalogue_model_key_agrees_with_its_resolved_path() {
            let mut mapped = std::collections::BTreeSet::new();
            let mut skipped_leaf = 0_usize;
            // The walk covers the categories a model slot can exist on, not every category: the
            // structural test in `trailing_model_leaf` cannot tell a channel's `/eq/1g` from a monitor
            // bus's `/eq/1g` (Maillot 1327), and the monitor bus has no EQ model to check against. The
            // family rule is `category_has_model_slots`, which is also what `model_parameter_allowed`
            // uses — a key outside those families is never model-checked, so it must not be expected
            // in the map either.
            let model_categories = target_categories()
                .iter()
                .filter(|info| category_has_model_slots(info.key));
            for category in model_categories.clone() {
                for parameter in target_parameters_for_category(category.key) {
                    let key = parameter.key;
                    let addresses = resolve_basic_addresses(&target(category.key, "1", key));
                    let leaf = addresses.first().and_then(|a| trailing_model_leaf(a));
                    let mapped_leaf = model_leaf_for_parameter(category.key, key)
                        .map(|(section, name)| format!("{section}/{name}"));
                    if leaf.is_some() {
                        mapped.insert((category.key, key));
                    } else {
                        skipped_leaf += 1;
                    }
                    assert_eq!(
                        mapped_leaf,
                        leaf,
                        "{}/{}: the map says {:?}, the resolver builds {:?}",
                        category.key,
                        parameter.key,
                        mapped_leaf,
                        leaf
                    );
                }
            }
            // …and they are the same keys: no resolvable model leaf is missing from the map, so no
            // plain catalogue key escapes the model check `main.rs` now runs on it.
            let mut walked = std::collections::BTreeSet::new();
            for category in model_categories {
                for parameter in target_parameters_for_category(category.key) {
                    let addresses =
                        resolve_basic_addresses(&target(category.key, "1", parameter.key));
                    if addresses
                        .first()
                        .and_then(|address| trailing_model_leaf(address))
                        .is_some()
                    {
                        walked.insert((category.key, parameter.key));
                    }
                }
            }
            assert_eq!(
                mapped, walked,
                "the map and the keys resolving into a model slot must be the same set"
            );
            assert!(!mapped.is_empty(), "the map must cover the model keys");
            // Whatever the walk skipped is a leaf that is not a model slot (`/mute`, `/fdr`…, and
            // the section's own on/off and model selectors): those keys must all answer `None`.
            assert!(skipped_leaf > 0, "the walk must see non-model keys too");
        }

        /// Every name the map hands out has to be documented by a model — that is what
        /// `model_parameter_problem` looks it up in. The check goes through
        /// `plugin_parameter_is_documented`, which is alias-aware, so the one appendix row the
        /// extraction mangled is not an exception any more: `/eq/6q` is band 6's Q in the routing
        /// tables (bus 2434, main 2605, matrix 2775) and `PLUGIN_PARAMETER_ALIASES` teaches the
        /// tables that `STD`'s printed `7q` row is that leaf.
        #[test]
        fn every_model_leaf_name_exists_in_an_appendix_table() {
            for category in target_categories() {
                for parameter in target_parameters_for_category(category.key) {
                    let Some((section, name)) = model_leaf_for_parameter(category.key, parameter.key)
                    else {
                        continue;
                    };
                    assert!(
                        crate::plugin_models::plugin_parameter_is_documented(name),
                        "{}/{}: {section}/{name} is documented by no model",
                        category.key,
                        parameter.key
                    );
                }
            }
        }

        /// The plain keys reach the same leaf as the qualified ones, so they need the same model
        /// check: `plugin_model_has_parameter` is what the check asks, and these are the pairs the
        /// adversarial review used — a strip whose slot runs `DEQ2`, `WARM` or `LMT` has no plain
        /// `thr`, while `COMP` has exactly that name.
        #[test]
        fn plain_keys_and_qualified_keys_name_the_same_model_leaf() {
            for (category, plain, qualified) in [
                ("ch", "gate_thr", "gate:thr"),
                ("ch", "gate_attack", "gate:att"),
                ("ch", "gate_ratio", "gate:ratio"),
                ("ch", "comp_thr", "dyn:thr"),
                ("ch", "comp_knee", "dyn:knee"),
                ("ch", "eq_1_gain", "eq:1g"),
                ("ch", "eq_low_gain", "eq:lg"),
            ] {
                let plain_leaf =
                    model_leaf_for_parameter(category, plain).expect("the plain key is mapped");
                let qualified_leaf = qualified
                    .split_once(':')
                    .expect("a section:name target");
                assert_eq!(
                    plain_leaf, qualified_leaf,
                    "{plain} and {qualified} must name the same leaf"
                );
            }
            // The counter-examples: the names exist somewhere (the appendix lists them for other
            // models), but not on these.
            assert!(!crate::plugin_models::plugin_model_has_parameter(
                "DEQ2", "thr"
            ));
            assert!(!crate::plugin_models::plugin_model_has_parameter("WARM", "thr"));
            assert!(!crate::plugin_models::plugin_model_has_parameter("LMT", "thr"));
            // …and the ones that do have them, so the check cannot pass by refusing everything.
            assert!(crate::plugin_models::plugin_model_has_parameter("COMP", "thr"));
            assert!(crate::plugin_models::plugin_model_has_parameter("GATE", "range"));
            assert!(crate::plugin_models::plugin_model_has_parameter("STD", "1g"));
        }

        /// The on/off leaves and the model selectors are catalogue keys of the same sections but not
        /// model-scoped names: `/gate/on` and `/gate/mdl` exist whatever the model is. They must
        /// answer `None`, or the check would refuse a write the console accepts.
        #[test]
        fn the_map_leaves_the_on_off_and_selector_keys_alone() {
            for (category, parameter) in [
                ("ch", "gate_on"),
                ("ch", "comp_on"),
                ("ch", "eq_on"),
                ("ch", "gate_type"),
                ("ch", "comp_type"),
                ("ch", "eq_model"),
                ("ch", "mute"),
                ("ch", "fader"),
                ("ch", "meter"),
                ("ch", "send_level"),
                ("dca", "name"),
                ("preamp_local", "gain"),
                ("output_local", "output_group"),
                ("userctrl", "user_btn"),
                ("fx", "fx_model"),
                ("custom", "load_snapshot"),
            ] {
                assert_eq!(
                    model_leaf_for_parameter(category, parameter),
                    None,
                    "{category}/{parameter} is not a model-scoped leaf"
                );
            }
            // A `section:name` target carries its own name and is validated by `model_parameter_path`;
            // this map describes catalogue keys only, so it answers `None`.
            assert_eq!(model_leaf_for_parameter("ch", "gate:1-thr"), None);
        }

        #[test]
        fn no_resolved_path_carries_a_footnote_suffix() {
            // The extracted Maillot text glues footnote references to parameter
            // names (`thr23`, `lg24`). Those are not path segments: the console
            // only knows `/gate/thr`, `/dyn/thr` and `/eq/lg`. This guard walks
            // every category and parameter the catalogue exposes so the mistake
            // cannot come back through a new entry.
            let artifact_prefixes = ["thr", "lg", "hg", "lf", "hf", "lq", "hq"];
            for category in target_categories() {
                for parameter in target_parameters_for_category(category.key) {
                    for address in
                        resolve_basic_addresses(&target(category.key, "1", parameter.key))
                    {
                        let tail = address.rsplit('/').next().unwrap_or("");
                        let is_artifact = artifact_prefixes.iter().any(|prefix| {
                            tail.len() > prefix.len()
                                && tail.starts_with(prefix)
                                && tail[prefix.len()..]
                                    .chars()
                                    .all(|character| character.is_ascii_digit())
                        });
                        assert!(
                            !is_artifact,
                            "{}/{} resolved to a footnote-suffixed path: {address}",
                            category.key, parameter.key
                        );
                    }
                }
            }
        }

        #[test]
        fn aux_and_main_do_not_offer_parameters_the_console_lacks() {
            // Read-only verification on WING Rack (FW 3.1.1), 2026-09-21:
            // `/aux/1/flt/lc`, `/aux/1/gate`, `/aux/1/gate/range`,
            // `/aux/2/gate/mdl` and `/main/1/send/1/lvl` are all silent while
            // `/aux/1/eq/1g`, `/aux/1/dyn/thr`, `/aux/1/dyn/on` and
            // `/bus/1/send/1/lvl` answer. Offering them produced writes the console
            // ignored without telling the operator.
            for parameter in ["hpf_on", "hpf_freq", "lpf_on", "lpf_freq"] {
                assert!(
                    resolve_basic_addresses(&target("aux", "1", parameter)).is_empty(),
                    "aux has no filter node: {parameter}"
                );
                assert!(
                    !resolve_basic_addresses(&target("ch", "1", parameter)).is_empty(),
                    "ch keeps {parameter}"
                );
            }
            for parameter in ["gate_on", "gate_thr", "gate_range", "gate_attack"] {
                assert!(
                    resolve_basic_addresses(&target("aux", "1", parameter)).is_empty(),
                    "aux has no gate node: {parameter}"
                );
                assert!(
                    !resolve_basic_addresses(&target("ch", "1", parameter)).is_empty(),
                    "ch keeps {parameter}"
                );
            }
            for parameter in ["send_level", "send_on"] {
                assert!(
                    resolve_basic_addresses(&target("main", "1", parameter)).is_empty(),
                    "main has no numeric send node: {parameter}"
                );
                // Send 2, because a bus sending to itself is refused and a bus send without a
                // destination now fails closed as well (`send_index_for`).
                assert!(
                    !resolve_basic_addresses(&send_target("bus", "1", parameter, 2)).is_empty(),
                    "bus keeps {parameter}"
                );
            }
            // Aux answers for the pre-insert but has no post-insert node.
            assert!(resolve_basic_addresses(&target("aux", "1", "post_insert_on")).is_empty());
            assert!(!resolve_basic_addresses(&target("aux", "1", "insert_on")).is_empty());
            for category in ["ch", "bus", "main", "matrix"] {
                assert!(
                    !resolve_basic_addresses(&target(category, "1", "post_insert_on")).is_empty(),
                    "{category} keeps post_insert_on"
                );
            }
            // Snapshot and preset loading is a console filesystem operation over
            // the snapshot JSON, not an OSC leaf.
            assert!(resolve_basic_addresses(&target("custom", "1", "load_snapshot")).is_empty());
            assert!(resolve_basic_addresses(&target("custom", "1", "load_preset")).is_empty());
        }

        #[test]
        fn oscillator_source_does_not_offer_polarity() {
            // `/io/in/OSC/1/pol` is silent and undocumented; `/io/in/USB/1/pol`
            // and `/io/in/LCL/1/pol` answer.
            assert!(resolve_basic_addresses(&target("preamp_oscillator", "1", "phase")).is_empty());
            assert!(!resolve_basic_addresses(&target("usb", "1", "phase")).is_empty());
            assert!(!resolve_basic_addresses(&target("preamp_local", "1", "phase")).is_empty());
        }

        #[test]
        fn aux_keeps_the_parameters_it_really_has() {
            for parameter in [
                "mute",
                "fader",
                "gain",
                "trim",
                "phase",
                "eq_1_gain",
                "eq_low_gain",
                "eq_high_q",
                "comp_on",
                "comp_thr",
                "comp_makeup",
            ] {
                assert!(
                    !resolve_basic_addresses(&target("aux", "1", parameter)).is_empty(),
                    "aux must keep {parameter}"
                );
            }
        }

        #[test]
        fn exposes_osc_state_parameters_as_trigger_candidates() {
            let ch_parameters = trigger_parameters_for_category("ch")
                .into_iter()
                .map(|parameter| parameter.key)
                .collect::<Vec<_>>();
            for expected in [
                "meter",
                "fader",
                "gain",
                "trim",
                "name",
                "eq_1_gain",
                "gate_thr",
                "comp_thr",
            ] {
                assert!(
                    ch_parameters.contains(&expected),
                    "missing channel trigger parameter {expected}"
                );
            }

            let source_parameters = trigger_parameters_for_category("preamp_local")
                .into_iter()
                .map(|parameter| parameter.key)
                .collect::<Vec<_>>();
            // `/io/in/*` has `g` and `$vph`, not `trim`: the duplicate entry was removed (Maillot
            // 1600-1606), and `gain` carries the head-amp range -3..45.5 dB.
            for expected in ["meter", "gain", "phantom_48v", "name", "mute", "phase"] {
                assert!(
                    source_parameters.contains(&expected),
                    "missing source trigger parameter {expected}"
                );
            }
            assert!(
                !source_parameters.contains(&"trim"),
                "a source has no trim leaf: it would be a second entry for the same head amp"
            );
        }

        #[test]
        fn builds_meter_descriptors_for_trigger_targets() {
            assert_eq!(
                meter_descriptors_for_target(&target("usb", "1,2", "meter")),
                vec![MeterDescriptor::source(7)]
            );
            assert_eq!(
                meter_descriptors_for_target(&target("output_aes50a", "1", "meter")),
                vec![MeterDescriptor::output(3)]
            );
            assert_eq!(
                meter_descriptors_for_target(&target("rta", "48", "meter_rta_band")),
                vec![MeterDescriptor::indexed(MeterFamily::Rta, Vec::<u8>::new())]
            );
        }

        #[test]
        fn resolves_custom_addresses_only_when_absolute() {
            assert_eq!(
                resolve_basic_addresses(&BasicTargetSpec {
                    category: "custom".to_string(),
                    ids: String::new(),
                    parameter: String::new(),
                    send_id: None,
                    custom_address: Some("/custom/path".to_string()),
                }),
                vec!["/custom/path".to_string()]
            );
            assert!(resolve_basic_addresses(&BasicTargetSpec {
                category: "custom".to_string(),
                ids: String::new(),
                parameter: String::new(),
                send_id: None,
                custom_address: Some("custom/path".to_string()),
            })
            .is_empty());
        }

        // ── Stage 1 expansion: sends, insert slots, strip basics ──────────────────────────────────

        /// Every key this batch adds, in every family it is offered for, with the path Maillot
        /// documents. Buses are destination 1…16 (2168), matrices 1…8 (2670), mains 1…4 (2153);
        /// destinations 7, 4 and 2 are used so a wrong prefix or a stuck index cannot hide behind
        /// a 1.
        #[test]
        fn every_new_key_resolves_to_its_documented_path() {
            let table: &[(&str, &str, &str, u8, &str)] = &[
                // `/send/<n>/…` bus sends: ch and aux (2159-2166, 2337-2343), bus (2501-2504).
                ("ch", "3", "send_level", 7, "/ch/3/send/7/lvl"),
                ("aux", "2", "send_level", 7, "/aux/2/send/7/lvl"),
                ("bus", "2", "send_level", 7, "/bus/2/send/7/lvl"),
                ("ch", "3", "send_on", 7, "/ch/3/send/7/on"),
                ("aux", "2", "send_on", 7, "/aux/2/send/7/on"),
                ("bus", "2", "send_on", 7, "/bus/2/send/7/on"),
                ("bus", "2", "send_pre", 7, "/bus/2/send/7/pre"),
                (
                    "ch",
                    "3",
                    "send_pre_always_on",
                    7,
                    "/ch/3/send/7/pon",
                ),
                (
                    "aux",
                    "2",
                    "send_pre_always_on",
                    7,
                    "/aux/2/send/7/pon",
                ),
                ("ch", "3", "send_pan", 7, "/ch/3/send/7/pan"),
                ("aux", "2", "send_pan", 7, "/aux/2/send/7/pan"),
                ("ch", "3", "send_mode", 7, "/ch/3/send/7/mode"),
                ("aux", "2", "send_mode", 7, "/aux/2/send/7/mode"),
                // `/send/MX<n>/…` matrix sends: ch, aux, bus and main (2168-2176, 2345-2353,
                // 2506-2509, 2669-2673).
                ("ch", "3", "send_matrix_level", 4, "/ch/3/send/MX4/lvl"),
                ("aux", "2", "send_matrix_level", 4, "/aux/2/send/MX4/lvl"),
                ("bus", "2", "send_matrix_level", 4, "/bus/2/send/MX4/lvl"),
                ("main", "3", "send_matrix_level", 4, "/main/3/send/MX4/lvl"),
                ("ch", "3", "send_matrix_on", 4, "/ch/3/send/MX4/on"),
                ("aux", "2", "send_matrix_on", 4, "/aux/2/send/MX4/on"),
                ("bus", "2", "send_matrix_on", 4, "/bus/2/send/MX4/on"),
                ("main", "3", "send_matrix_on", 4, "/main/3/send/MX4/on"),
                ("ch", "3", "send_matrix_mode", 4, "/ch/3/send/MX4/mode"),
                ("aux", "2", "send_matrix_mode", 4, "/aux/2/send/MX4/mode"),
                ("bus", "2", "send_matrix_pre", 4, "/bus/2/send/MX4/pre"),
                ("main", "3", "send_matrix_pre", 4, "/main/3/send/MX4/pre"),
                // `/main/<n>/…` main sends: ch, aux and bus (2154-2156, 2332-2334, 2496-2498).
                ("ch", "3", "send_main_level", 2, "/ch/3/main/2/lvl"),
                ("aux", "2", "send_main_level", 2, "/aux/2/main/2/lvl"),
                ("bus", "2", "send_main_level", 2, "/bus/2/main/2/lvl"),
                ("ch", "3", "send_main_on", 2, "/ch/3/main/2/on"),
                ("aux", "2", "send_main_on", 2, "/aux/2/main/2/on"),
                ("bus", "2", "send_main_on", 2, "/bus/2/main/2/on"),
                ("ch", "3", "send_main_pre", 2, "/ch/3/main/2/pre"),
                ("aux", "2", "send_main_pre", 2, "/aux/2/main/2/pre"),
                ("bus", "2", "send_main_pre", 2, "/bus/2/main/2/pre"),
                // Insert slots, every family Maillot documents them for (2148, 2183, 2327, 2491,
                // 2514, 2666, 2677, 2836, 2841).
                ("ch", "1", "pre_insert_slot", 1, "/ch/1/preins/ins"),
                ("aux", "1", "pre_insert_slot", 1, "/aux/1/preins/ins"),
                ("bus", "1", "pre_insert_slot", 1, "/bus/1/preins/ins"),
                ("main", "1", "pre_insert_slot", 1, "/main/1/preins/ins"),
                ("matrix", "1", "pre_insert_slot", 1, "/mtx/1/preins/ins"),
                ("ch", "1", "post_insert_slot", 1, "/ch/1/postins/ins"),
                ("bus", "1", "post_insert_slot", 1, "/bus/1/postins/ins"),
                ("main", "1", "post_insert_slot", 1, "/main/1/postins/ins"),
                ("matrix", "1", "post_insert_slot", 1, "/mtx/1/postins/ins"),
                ("ch", "1", "post_insert_mode", 1, "/ch/1/postins/mode"),
                ("ch", "1", "post_insert_weight", 1, "/ch/1/postins/w"),
                // Strip basics.
                ("ch", "1", "width", 1, "/ch/1/wid"),
                ("aux", "1", "width", 1, "/aux/1/wid"),
                ("bus", "1", "width", 1, "/bus/1/wid"),
                ("main", "1", "width", 1, "/main/1/wid"),
                ("matrix", "1", "width", 1, "/mtx/1/wid"),
                ("ch", "1", "monitor_mode", 1, "/ch/1/mon"),
                ("aux", "1", "monitor_mode", 1, "/aux/1/mon"),
                ("bus", "1", "monitor_mode", 1, "/bus/1/mon"),
                ("main", "1", "monitor_mode", 1, "/main/1/mon"),
                ("matrix", "1", "monitor_mode", 1, "/mtx/1/mon"),
                ("dca", "1", "monitor_mode", 1, "/dca/1/mon"),
                ("ch", "1", "solo_safe", 1, "/ch/1/solosafe"),
                ("aux", "1", "solo_safe", 1, "/aux/1/solosafe"),
                ("ch", "1", "delay_on", 1, "/ch/1/in/set/dlyon"),
                ("aux", "1", "delay_on", 1, "/aux/1/in/set/dlyon"),
                ("bus", "1", "delay_on", 1, "/bus/1/dly/on"),
                ("main", "1", "delay_on", 1, "/main/1/dly/on"),
                ("matrix", "1", "delay_on", 1, "/mtx/1/dly/on"),
                ("ch", "1", "delay_mode", 1, "/ch/1/in/set/dlymode"),
                ("aux", "1", "delay_mode", 1, "/aux/1/in/set/dlymode"),
                ("bus", "1", "delay_mode", 1, "/bus/1/dly/mode"),
                ("main", "1", "delay_mode", 1, "/main/1/dly/mode"),
                ("matrix", "1", "delay_mode", 1, "/mtx/1/dly/mode"),
                ("ch", "1", "delay_time", 1, "/ch/1/in/set/dly"),
                ("aux", "1", "delay_time", 1, "/aux/1/in/set/dly"),
                ("bus", "1", "delay_time", 1, "/bus/1/dly/dly"),
                ("main", "1", "delay_time", 1, "/main/1/dly/dly"),
                ("matrix", "1", "delay_time", 1, "/mtx/1/dly/dly"),
            ];

            for (category, id, key, send_id, expected) in table {
                assert_eq!(
                    resolve_basic_addresses(&send_target(category, id, key, *send_id)),
                    vec![(*expected).to_string()],
                    "{category}/{key} with send destination {send_id} must resolve to {expected}"
                );
            }

            // …and the families the documents do not define each key for resolve to nothing.
            let refused: &[(&str, &str, u8)] = &[
                // A main has no `/send/<n>` bus send, and a matrix has no send node at all.
                ("main", "send_level", 2),
                ("main", "send_on", 2),
                ("main", "send_pre", 2),
                ("main", "send_pre_always_on", 2),
                ("main", "send_pan", 2),
                ("main", "send_mode", 2),
                ("matrix", "send_level", 2),
                ("matrix", "send_on", 2),
                ("matrix", "send_pre", 2),
                ("matrix", "send_pre_always_on", 2),
                ("matrix", "send_pan", 2),
                ("matrix", "send_mode", 2),
                // `pon`, `pan` and `mode` exist on ch and aux sends only (2162-2163, 2166).
                ("bus", "send_pre_always_on", 2),
                ("bus", "send_pan", 2),
                ("bus", "send_mode", 2),
                // `pre` exists on bus sends only (2504), never on a ch or aux send.
                ("ch", "send_pre", 2),
                ("aux", "send_pre", 2),
                // Matrix sends: no matrix, and `mode`/`pre` are family-specific.
                ("matrix", "send_matrix_level", 2),
                ("matrix", "send_matrix_on", 2),
                ("matrix", "send_matrix_mode", 2),
                ("matrix", "send_matrix_pre", 2),
                ("bus", "send_matrix_mode", 2),
                ("main", "send_matrix_mode", 2),
                ("ch", "send_matrix_pre", 2),
                ("aux", "send_matrix_pre", 2),
                // Main sends: ch, aux and bus only.
                ("main", "send_main_level", 2),
                ("main", "send_main_on", 2),
                ("main", "send_main_pre", 2),
                ("matrix", "send_main_level", 2),
                ("matrix", "send_main_on", 2),
                ("matrix", "send_main_pre", 2),
                // Aux has no post-insert; the post-insert mode and weight are channel-only.
                ("aux", "post_insert_slot", 1),
                ("bus", "post_insert_mode", 1),
                ("main", "post_insert_mode", 1),
                ("matrix", "post_insert_mode", 1),
                ("aux", "post_insert_mode", 1),
                ("bus", "post_insert_weight", 1),
                ("main", "post_insert_weight", 1),
                ("matrix", "post_insert_weight", 1),
                ("aux", "post_insert_weight", 1),
                // `/solosafe` is documented for channels and aux only (2001, 2252).
                ("bus", "solo_safe", 1),
                ("main", "solo_safe", 1),
                ("matrix", "solo_safe", 1),
                ("dca", "solo_safe", 1),
                // A DCA has no width leaf (2876 is its only strip-basics row besides mute/fader).
                ("dca", "width", 1),
            ];

            for (category, key, send_id) in refused {
                assert!(
                    resolve_basic_addresses(&send_target(category, "1", key, *send_id)).is_empty(),
                    "{category}/{key} must not resolve: the documents define no such leaf there"
                );
            }
        }

        /// Maillot gives each send destination its size and the node its sends live under. A
        /// destination outside it is a path the console ignores, so it must resolve to nothing.
        #[test]
        fn a_send_index_is_bounded_by_its_destination() {
            assert_eq!(
                send_destination("ch", "send_level"),
                Some(SendDestination {
                    key: "bus",
                    label: "Bus",
                    max: 16,
                })
            );
            assert_eq!(
                send_destination("ch", "send_matrix_level"),
                Some(SendDestination {
                    key: "matrix",
                    label: "Matrix",
                    max: 8,
                })
            );
            assert_eq!(
                send_destination("ch", "send_main_level"),
                Some(SendDestination {
                    key: "main",
                    label: "Main",
                    max: 4,
                })
            );
            // A parameter that takes no destination index at all.
            assert_eq!(send_destination("ch", "fader"), None);
            assert_eq!(send_destination("ch", "delay_time"), None);
            assert_eq!(send_destination("ch", "monitor_mode"), None);
            // A pair the family does not offer has no destination either.
            assert_eq!(send_destination("matrix", "send_level"), None);
            assert_eq!(send_destination("main", "send_level"), None);

            // `/send/`, `/send/MX` and `/main/` are the three prefixes, at the last valid index.
            assert_eq!(
                resolve_basic_addresses(&send_target("ch", "1", "send_level", 16)),
                vec!["/ch/1/send/16/lvl".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&send_target("ch", "1", "send_matrix_level", 8)),
                vec!["/ch/1/send/MX8/lvl".to_string()]
            );
            assert_eq!(
                resolve_basic_addresses(&send_target("ch", "1", "send_main_level", 4)),
                vec!["/ch/1/main/4/lvl".to_string()]
            );

            // The 17th bus, the 9th matrix and the 5th main fail closed (2168, 2670, 2153).
            for (key, index) in [
                ("send_level", 17_u8),
                ("send_matrix_level", 9),
                ("send_main_level", 5),
            ] {
                assert!(
                    resolve_basic_addresses(&send_target("ch", "1", key, index)).is_empty(),
                    "{key} must refuse destination {index}"
                );
            }
            // 0 is not a destination either.
            assert!(resolve_basic_addresses(&send_target("ch", "1", "send_level", 0)).is_empty());

            // A send with no destination has no address at all: on a bus "send 1" is the bus's own
            // send, which footnote 38 says the console ignores (2528), and on any other family the
            // operator still cannot see which destination the step writes. Fail closed everywhere and
            // let the editor ask for the index.
            for category in ["ch", "aux", "bus", "main", "matrix"] {
                assert!(
                    resolve_basic_addresses(&target(category, "1", "send_level")).is_empty(),
                    "{category}: a send with no destination must not resolve"
                );
            }
            assert!(resolve_basic_addresses(&target("bus", "1", "send_pre")).is_empty());
        }

        #[test]
        fn main_has_no_bus_sends_and_a_matrix_has_no_sends_at_all() {
            // Hardware-verified read-only on WING Rack (FW 3.1.1): `/main/1/send/1/lvl` is
            // silent, and Maillot documents `/send/<n>` for ch, aux and bus only (2158, 2336, 2500).
            for key in [
                "send_level",
                "send_on",
                "send_pre",
                "send_pre_always_on",
                "send_pan",
                "send_mode",
            ] {
                assert!(
                    resolve_basic_addresses(&send_target("main", "1", key, 2)).is_empty(),
                    "a main has no `/send/<n>` node: {key}"
                );
            }
            // A matrix has no sends at all: no `/mtx/N/send`, no `/send/<n>`, no `/main/<n>`.
            let every_send_key = [
                "send_level",
                "send_on",
                "send_pre",
                "send_pre_always_on",
                "send_pan",
                "send_mode",
                "send_matrix_level",
                "send_matrix_on",
                "send_matrix_mode",
                "send_matrix_pre",
                "send_main_level",
                "send_main_on",
                "send_main_pre",
            ];
            for key in every_send_key {
                assert!(
                    resolve_basic_addresses(&send_target("matrix", "1", key, 2)).is_empty(),
                    "a matrix has no sends: {key}"
                );
            }
            // The catalogue does not offer them there either, so the editor cannot pick one.
            let matrix_keys = target_parameters_for_category("matrix")
                .into_iter()
                .map(|parameter| parameter.key)
                .collect::<Vec<_>>();
            assert!(
                !matrix_keys.iter().any(|key| key.starts_with("send_")),
                "a matrix must not offer sends: {matrix_keys:?}"
            );
            let main_keys = target_parameters_for_category("main")
                .into_iter()
                .map(|parameter| parameter.key)
                .collect::<Vec<_>>();
            for absent in ["send_level", "send_on", "send_pre"] {
                assert!(
                    !main_keys.contains(&absent),
                    "a main must not offer {absent}: {main_keys:?}"
                );
            }
            // What a main does have is matrix sends (2671-2673).
            for (key, expected) in [
                ("send_matrix_level", "/main/2/send/MX3/lvl"),
                ("send_matrix_on", "/main/2/send/MX3/on"),
                ("send_matrix_pre", "/main/2/send/MX3/pre"),
            ] {
                assert_eq!(
                    resolve_basic_addresses(&send_target("main", "2", key, 3)),
                    vec![expected.to_string()],
                    "main keeps {key}"
                );
            }
        }

        #[test]
        fn aux_has_a_pre_insert_and_no_post_insert() {
            assert_eq!(
                resolve_basic_addresses(&target("aux", "1", "pre_insert_slot")),
                vec!["/aux/1/preins/ins".to_string()]
            );
            for key in [
                "post_insert_on",
                "post_insert_slot",
                "post_insert_mode",
                "post_insert_weight",
            ] {
                assert!(
                    resolve_basic_addresses(&target("aux", "1", key)).is_empty(),
                    "aux has no post-insert node: {key}"
                );
            }
            let aux_keys = target_parameters_for_category("aux")
                .into_iter()
                .map(|parameter| parameter.key)
                .collect::<Vec<_>>();
            assert!(
                !aux_keys.iter().any(|key| key.starts_with("post_insert")),
                "aux must not offer post-insert parameters: {aux_keys:?}"
            );
            // The four families that do have a post-insert keep it.
            for category in ["ch", "bus", "main", "matrix"] {
                assert!(
                    !resolve_basic_addresses(&target(category, "1", "post_insert_slot")).is_empty(),
                    "{category} keeps post_insert_slot"
                );
                assert!(
                    !resolve_basic_addresses(&target(category, "1", "post_insert_on")).is_empty(),
                    "{category} keeps post_insert_on"
                );
            }
        }

        #[test]
        fn the_fx_model_list_depends_on_the_slot() {
            // Maillot 2896-2919 (slots 1…8) and 2921-2934 (slots 9…16).
            assert!(fx_models_for_slot(1).contains(&"HALL"));
            assert!(!fx_models_for_slot(12).contains(&"HALL"));
            for slot in [1_u8, 8, 9, 12, 16] {
                let models = fx_models_for_slot(slot);
                assert!(!models.is_empty(), "slot {slot} has no model list");
                assert!(models.contains(&"NONE"), "slot {slot} cannot be emptied");
                assert!(models.contains(&"GEQ"), "slot {slot} has no GEQ");
            }
            // Only the eight premium slots carry the full list.
            assert_eq!(fx_models_for_slot(8), fx_models_for_slot(1));
            assert_eq!(fx_models_for_slot(9), fx_models_for_slot(16));
            assert!(fx_models_for_slot(8).len() > fx_models_for_slot(9).len());
            // Slots outside 1…16 are not FX slots; there is no list to validate against.
            assert!(fx_models_for_slot(0).is_empty());
            assert!(fx_models_for_slot(17).is_empty());
            assert!(fx_models_for_slot(u8::MAX).is_empty());
            // The union is in documented order and carries no duplicate; every model a reduced slot
            // can load is in it.
            let union = fx_models();
            for model in fx_models_for_slot(12) {
                assert!(union.contains(model), "{model} is missing from the union");
            }
            assert!(union.contains(&"HALL"));
            assert!(union.contains(&"FLANGER"));
            let mut seen = std::collections::HashSet::new();
            for model in union {
                assert!(seen.insert(*model), "{model} appears twice in the union");
            }
            // The appendix-only spellings are not `/fx/mdl` values and must not be offered.
            for appendix_only in ["DELREV", "V_IMG", "R-OOM", "TILT", "MAX", "AP1", "AP2", "2250"] {
                assert!(
                    !union.contains(&appendix_only),
                    "{appendix_only} is an appendix spelling, not a `/fx/mdl` value"
                );
            }
        }

        #[test]
        fn fx_model_is_a_closed_list_of_the_documented_models() {
            let rule = watch_rule("fx", "fx_model").expect("the FX model parameter is offered");
            assert_eq!(rule.label, "FX Model");
            assert_eq!(rule.value_kind, "enum", "the model is one of a fixed list");
            assert_eq!(rule.options, fx_models());
            // A documented model passes the comparison check, an appendix spelling does not.
            assert!(watch_problem("fx", "fx_model", "==", "HALL").is_none());
            assert!(watch_problem("fx", "fx_model", "==", "DELREV").is_some());
        }

        /// An FX slot's model parameters are real targets: the name sits under the slot's own node
        /// ("`/fx/1/…` contains up to 4048 parameters that depend on the selected model (`/fx/1/mdl`)",
        /// Maillot 2940-2942), so `fx:<name>` resolves to `/fx/<slot>/<name>` with the slot taken from
        /// the target's id. The name is the model's, so it is asked of the appendix tables rather than
        /// listed here.
        #[test]
        fn an_fx_model_parameter_resolves_under_its_slot() {
            assert_eq!(
                resolve_basic_addresses(&target("fx", "1", "fx:lc")),
                vec!["/fx/1/lc"]
            );
            // The slot the operator chose is the target's id, not a constant.
            assert_eq!(
                resolve_basic_addresses(&target("fx", "16", "fx:mix")),
                vec!["/fx/16/mix"]
            );
            assert_eq!(
                resolve_basic_addresses(&target("fx", "1, 3", "fx:flc")),
                vec!["/fx/1/flc", "/fx/3/flc"]
            );
            // A name no appendix table documents resolves to nothing, exactly as a catalogue typo does:
            // the console would ignore the write in silence (AGENTS.md, silent-write rule).
            assert!(resolve_basic_addresses(&target("fx", "1", "fx:thrr")).is_empty());
            // The effect parameters belong to the FX slots alone — a channel has no `/ch/1/lc` — and a
            // strip's model parameter is not an effect parameter.
            assert!(resolve_basic_addresses(&target("ch", "1", "fx:lc")).is_empty());
            assert!(resolve_basic_addresses(&target("fx", "1", "gate:thr")).is_empty());
            // Outside 1…16 there is no FX node, so there is no address either.
            assert!(resolve_basic_addresses(&target("fx", "17", "fx:lc")).is_empty());
        }

        /// The parameters of an FX slot are gated by the model the console reports for that slot
        /// (`/fx/<slot>/mdl`, 2896-2934), exactly as a strip's gate/dyn/EQ parameters are gated by the
        /// model of their own section.
        #[test]
        fn an_fx_parameter_is_gated_by_the_slots_model() {
            // The names the console offers that the appendix's tables spell differently (2897, 2901,
            // 2916) resolve to the table that documents them, so their parameters are reachable at all.
            for (reported, table) in [("ROOM", "R-OOM"), ("DEL/REV", "DELREV"), ("V-IMG", "V_IMG")] {
                assert_eq!(
                    crate::plugin_models::plugin_model(reported).map(|entry| entry.model),
                    Some(table),
                    "{reported} is what the console reports, {table} is the appendix's table"
                );
            }
            // A documented name of the model the slot runs.
            assert!(model_parameter_problem("fx", "dcy", "ROOM").is_none());
            assert!(model_parameter_problem("fx", "wave", "CHORUS").is_none());
            // A name that model does not have is refused, and the message names what it does have.
            let problem = model_parameter_problem("fx", "wave", "FLANGER").expect("refused");
            assert!(problem.contains("FLANGER"), "{problem}");
            assert!(problem.contains("lc"), "{problem}");
            // The two tables are not each other's: the flanger's feedback rows belong to FLANGER.
            assert!(model_parameter_problem("fx", "flc", "FLANGER").is_none());
            assert!(model_parameter_problem("fx", "flc", "CHORUS").is_some());
            // An empty model means "not known": nothing is refused, and `main.rs` adds its own "the
            // model was not checked" note instead.
            assert!(model_parameter_problem("fx", "wave", "").is_none());
            // A model no appendix table documents is refused, in the console's own vocabulary.
            let unknown = model_parameter_problem("fx", "wave", "NOPE").expect("refused");
            assert!(unknown.contains("2896-2934"), "{unknown}");
            // `fx` is a model slot; a section that is none is still refused as one.
            assert!(model_parameter_problem("lamp", "lc", "CHORUS").is_some());
        }

        /// Every model `/fx/<slot>/mdl` offers resolves to an appendix table with parameters, so no
        /// model the console can load leaves its parameters unreachable. `NONE` loads nothing, which is
        /// the one documented empty table (Maillot 2896-2934).
        #[test]
        fn every_fx_model_the_console_offers_has_an_appendix_table() {
            for model in fx_models() {
                let entry = crate::plugin_models::plugin_model(model).unwrap_or_else(|| {
                    panic!("{model} is offered by /fx/<slot>/mdl but has no appendix table")
                });
                if *model == "NONE" {
                    assert!(entry.parameters.is_empty(), "NONE loads no parameter");
                    continue;
                }
                assert!(
                    !entry.parameters.is_empty(),
                    "{model} resolves to a table with no parameter"
                );
            }
        }

        /// The flanger's rows are the flanger's. The appendix's "Stereo Flanger" table prints
        /// `0 “mdl”:  CHORUS` (7757), the name of the table above it — the document's own typo — while
        /// the console lists `CHORUS` and `FLANGER` as two models behind `/fx/<slot>/mdl` (2903-2904).
        /// The two tables share eight rows, so a merge would have been invisible.
        #[test]
        fn the_flanger_and_the_chorus_are_two_tables() {
            let chorus = crate::plugin_models::plugin_parameter_names("CHORUS").expect("CHORUS");
            let flanger = crate::plugin_models::plugin_parameter_names("FLANGER").expect("FLANGER");
            // The Stereo Chorus table prints 11 rows (7742-7753) and the Stereo Flanger 12 (7756-7769).
            assert_eq!(chorus.len(), 11, "{chorus:?}");
            assert_eq!(flanger.len(), 12, "{flanger:?}");
            for shared in ["lc", "hc", "mix", "dlyl", "dlyr", "depl", "depr", "spd"] {
                assert!(
                    chorus.contains(&shared) && flanger.contains(&shared),
                    "{shared} is printed by both tables"
                );
            }
            assert!(chorus.contains(&"wave") && chorus.contains(&"sprd"));
            assert!(flanger.contains(&"flc") && flanger.contains(&"fhc") && flanger.contains(&"feed"));
            assert!(!chorus.contains(&"flc") && !chorus.contains(&"feed"));
            assert!(!flanger.contains(&"wave"));
        }

        /// The appendix rows the text extraction mangled are documented parameters and are recovered,
        /// not dropped: `5 “drive` and `8 “heq”` (7211, 7214), `5 “pres` and `8 “sag”` (7227, 7230,
        /// 7240, 7243), `4 “t_hi“` and `12 ”airm”` (8140, 8149) — and the Mood Filter table, whose
        /// index column restarted mid-table, keeps its six further rows (7189-7195).
        #[test]
        fn the_mangled_appendix_rows_are_recovered() {
            for (model, name) in [
                ("RACKAMP", "drive"),
                ("RACKAMP", "heq"),
                ("UKROCK", "pres"),
                ("UKROCK", "sag"),
                ("ANGEL", "pres"),
                ("ANGEL", "sag"),
                ("*MASTER*", "t_hi"),
                ("*MASTER*", "airm"),
                ("MOOD", "rel"),
                ("MOOD", "mix"),
                ("MOOD", "lfo"),
                ("MOOD", "spd"),
                ("MOOD", "phase"),
                ("MOOD", "wave"),
            ] {
                assert!(
                    crate::plugin_models::plugin_model_has_parameter(model, name),
                    "{model} must carry {name}: the appendix prints the row"
                );
            }
            // A value list that wrapped onto the line below keeps its values: the gate's ratio row is
            // `str [1:1.5, 1:2, 1:3, 1:4,` + `gate] ratio` (8219-8220), the same five the routing table
            // documents at 2046. A truncated list would refuse the `gate` value the console takes.
            let row = crate::plugin_models::plugin_model("GATE")
                .and_then(|entry| entry.parameters.iter().find(|row| row.name == "ratio"))
                .expect("the GATE table has a ratio row");
            let spec = crate::plugin_spec::parse_plugin_spec(row.spec);
            assert_eq!(spec.options, vec!["1:1.5", "1:2", "1:3", "1:4", "gate"]);
        }

        /// An FX parameter is a watch as well as a target. The key has no catalogue row, so its
        /// comparators and its value come from the appendix row of the model the slot runs — and when
        /// no model travelled with the target, from what every model that carries the name agrees on,
        /// so another model's row can never refuse a value this one takes.
        #[test]
        fn an_fx_parameter_can_be_watched() {
            // `lc` is a frequency (`logf [20, 400, 51] Hz, LC`, 7743) on every table that has it, so
            // the crossing comparators apply and a non-number is refused.
            assert!(watch_problem("fx", "fx:lc", ">", "400").is_none());
            assert!(watch_problem("fx", "fx:lc", ">", "not a number").is_some());
            // `mix` is 0…100 on most tables and 0…125 on three, so with no model named the range is not
            // enforced — but the comparators are the numeric ones.
            assert!(watch_problem("fx", "fx:mix", "<", "110").is_none());
            assert!(watch_problem("fx", "fx:mix", ">", "banana").is_some());
            // A name no table documents is not a watch, and an FX key on a channel is not one either.
            assert!(watch_problem("fx", "fx:thrr", ">", "1").is_some());
            assert!(watch_problem("ch", "fx:lc", ">", "1").is_some());
            // A step's value obeys the same rule (`value_problem` is the other half of `watch_problem`).
            assert!(value_problem("fx", "fx:lc", "banana").is_some());
            // The rule itself says which row it was built from, so a caller can tell an exact answer
            // from the union's.
            let exact = model_parameter_rule("fx", "lc", Some("CHORUS")).expect("CHORUS has lc");
            assert_eq!(exact.model, Some("CHORUS"));
            assert_eq!(exact.value_kind, "hz");
            assert_eq!(exact.min, 20.0);
            assert_eq!(exact.max, 400.0);
            let union = model_parameter_rule("fx", "lc", None).expect("some table has lc");
            assert_eq!(union.model, None, "no single model decided the union's rules");
            assert_eq!(union.value_kind, "hz");
        }

        #[test]
        fn a_delay_takes_the_leaf_of_its_family() {
            // Maillot 1947-1953 and 2217-2222: ch and aux carry the delay in the input section.
            for (category, prefix) in [("ch", "/ch/1/in/set"), ("aux", "/aux/1/in/set")] {
                assert_eq!(
                    resolve_basic_addresses(&target(category, "1", "delay_on")),
                    vec![format!("{prefix}/dlyon")]
                );
                assert_eq!(
                    resolve_basic_addresses(&target(category, "1", "delay_mode")),
                    vec![format!("{prefix}/dlymode")]
                );
                assert_eq!(
                    resolve_basic_addresses(&target(category, "1", "delay_time")),
                    vec![format!("{prefix}/dly")]
                );
            }
            // Maillot 2517-2523, 2680-2686 and 2844-2850: bus, main and matrix have `/dly/*`.
            for (category, prefix) in [
                ("bus", "/bus/1/dly"),
                ("main", "/main/1/dly"),
                ("matrix", "/mtx/1/dly"),
            ] {
                assert_eq!(
                    resolve_basic_addresses(&target(category, "1", "delay_on")),
                    vec![format!("{prefix}/on")]
                );
                assert_eq!(
                    resolve_basic_addresses(&target(category, "1", "delay_mode")),
                    vec![format!("{prefix}/mode")]
                );
                assert_eq!(
                    resolve_basic_addresses(&target(category, "1", "delay_time")),
                    vec![format!("{prefix}/dly")]
                );
            }
        }

        /// The value kind, unit, range and option list of every key this batch adds, so a hand
        /// edit cannot quietly widen a field the console clamps.
        #[test]
        fn the_new_keys_declare_their_documented_range_and_options() {
            let mix = |key: &str| {
                target_parameters_for_category("ch")
                    .into_iter()
                    .find(|parameter| parameter.key == key)
                    .unwrap_or_else(|| panic!("ch must offer {key}"))
            };

            for key in ["send_level", "send_matrix_level", "send_main_level"] {
                let rule = mix(key);
                assert_eq!((rule.value_kind, rule.unit), ("db", "dB"), "{key}");
                assert_eq!((rule.min, rule.max), (-144.0, 10.0), "{key}");
            }
            for key in ["send_on", "send_pre_always_on", "send_matrix_on", "send_main_on", "send_main_pre"] {
                assert_eq!(mix(key).value_kind, "toggle", "{key}");
            }
            // `send_pre` is documented on bus-to-bus sends only (2504) and `send_matrix_pre` on
            // bus and main matrix sends (2509, 2673), so both are looked up on a bus.
            let bus_rule = |key: &str| {
                target_parameters_for_category("bus")
                    .into_iter()
                    .find(|parameter| parameter.key == key)
                    .unwrap_or_else(|| panic!("bus must offer {key}"))
            };
            assert_eq!(bus_rule("send_pre").value_kind, "toggle");
            assert_eq!(bus_rule("send_matrix_pre").value_kind, "toggle");
            let pan = mix("send_pan");
            assert_eq!((pan.value_kind, pan.unit), ("percent", "%"));
            assert_eq!((pan.min, pan.max), (-100.0, 100.0));
            for key in ["send_mode", "send_matrix_mode"] {
                assert_eq!(mix(key).options, &["PRE", "POST", "GRP"], "{key}");
            }
            // `/postins/w` is -12…12 (2184), not a percentage.
            let weight = mix("post_insert_weight");
            assert_eq!(weight.value_kind, "number");
            assert_eq!((weight.min, weight.max), (-12.0, 12.0));
            let mode = mix("post_insert_mode");
            assert_eq!(mode.options, &["FX", "AUTO_X", "AUTO_Y"]);
            // Insert slots: NONE plus FX1…FX16 (2148, 2183).
            for key in ["pre_insert_slot", "post_insert_slot"] {
                let rule = mix(key);
                assert_eq!(rule.value_kind, "enum", "{key}");
                assert_eq!(rule.options, INSERT_FX_SLOTS, "{key}");
                assert_eq!(rule.options.len(), 17, "{key}");
                assert_eq!(rule.options.first(), Some(&"NONE"), "{key}");
                assert_eq!(rule.options.last(), Some(&"FX16"), "{key}");
            }
            let width = mix("width");
            assert_eq!((width.value_kind, width.unit), ("percent", "%"));
            assert_eq!((width.min, width.max), (-150.0, 150.0));
            let monitor = mix("monitor_mode");
            assert_eq!(monitor.options, &["A", "B", "A+B"]);
            assert_eq!(mix("solo_safe").value_kind, "toggle");
            assert_eq!(mix("delay_on").value_kind, "toggle");
            let delay_mode = mix("delay_mode");
            assert_eq!(delay_mode.options, &["M", "FT", "MS", "SMP"]);
            let delay_time = mix("delay_time");
            assert_eq!(delay_time.value_kind, "number");
            // The four documented units do not share a range (0…150 m, 0.5…500 ft, 0.5…500 ms,
            // 16…500 samples, 1948-1952), so the field carries the widest value and the hint names
            // each unit's own limit: pinning it at 150 would refuse a 500 ms delay.
            assert_eq!((delay_time.min, delay_time.max), (0.0, 500.0));

            // A DCA is not a mix family, but it does have the monitor mode (2876).
            let dca_monitor = target_parameters_for_category("dca")
                .into_iter()
                .find(|parameter| parameter.key == "monitor_mode")
                .expect("a DCA has a monitor mode");
            assert_eq!(dca_monitor.options, &["A", "B", "A+B"]);
        }

        /// The list the console documents at `/$ctl/user/1/1/bu/mode` (Maillot 3957-3968) has 33
        /// modes, not 32: the comment above the constant said 32, and a wrong count is how a mode
        /// gets dropped from a closed list without anyone noticing.
        #[test]
        fn the_user_button_modes_are_the_documented_33() {
            let expected = [
                "OFF", "MUTE", "SOLO", "INS1", "INS2", "MGRP", "DCAMUTE", "SOF", "SPILL", "FXPAR",
                "DAWBTN", "DAWENC", "CHPAGE", "PAGE", "FDRPAGE", "VIEWPAGE", "OTHER", "GPIO",
                "FSTART", "SHOWCTL", "SCENES", "MIDICCT", "MIDICCP", "MIDINT", "MIDINP", "MIDIPGM",
                "USBPR", "SDRECA", "SESSIONA", "MARKERA", "SDRECB", "SESSIONB", "MARKERB",
            ];
            assert_eq!(USER_BUTTON_MODES, &expected, "the list is Maillot's, in order");
            assert_eq!(USER_BUTTON_MODES.len(), 33, "Maillot 3957-3968 lists 33 modes");
            let rule = USERCTRL_TARGET_PARAMETERS
                .iter()
                .find(|parameter| parameter.key == "user_btn")
                .expect("the user button is offered");
            assert_eq!(rule.options, USER_BUTTON_MODES);
            assert_eq!(rule.value_kind, "enum", "the mode is one of a fixed list");
            assert_eq!(rule.arg_kind, "string", "the console takes the mode as a string");

            // The catalogue validates it as a closed list, like every other text leaf: a documented
            // mode passes, and one outside the list is refused with the list named — so a hand-edited
            // show or an import cannot send a mode the console would ignore in silence.
            for mode in USER_BUTTON_MODES {
                assert!(
                    value_problem("userctrl", "user_btn", mode).is_none(),
                    "{mode} is one of the documented modes"
                );
            }
            let problem = value_problem("userctrl", "user_btn", "BOGUS").expect("refused");
            assert!(problem.contains("must be one of"), "{problem}");
            assert!(
                problem.contains("OFF") && problem.contains("MARKERB"),
                "the refusal must carry the documented list: {problem}"
            );
            // The leaf, not the node: `/$ctl/user/1/<n>/bu/mode` (3957). Writing to the `bu` node did
            // nothing while the macro assumed it had.
            assert_eq!(
                resolve_basic_addresses(&target("userctrl", "4", "user_btn")),
                vec!["/$ctl/user/1/4/bu/mode".to_string()]
            );
            // A gate on the mode obeys the same list, and an enum is compared for equality only.
            assert!(watch_problem("userctrl", "user_btn", "==", "MUTE").is_none());
            assert!(watch_problem("userctrl", "user_btn", "==", "BOGUS").is_some());
            assert!(watch_problem("userctrl", "user_btn", ">", "MUTE").is_some());
        }

        /// The output source group list is Maillot's, byte for byte (1844-1846): the previous
        /// constant invented `INP`/`USBREC`/`SIG` and dropped `USR`/`SEND`/`MON`.
        #[test]
        fn the_output_source_groups_are_the_documented_list() {
            let rule = target_parameters_for_category("output_local")
                .into_iter()
                .find(|parameter| parameter.key == "output_group")
                .expect("the output group is offered");
            assert_eq!(
                rule.options,
                &[
                    "OFF", "LCL", "AUX", "A", "B", "C", "SC", "USB", "CRD", "MOD", "PLAY", "AES",
                    "USR", "OSC", "BUS", "MAIN", "MTX", "SEND", "MON"
                ]
            );
            for present in ["USR", "SEND", "MON", "LCL"] {
                assert!(rule.options.contains(&present), "{present} is documented");
            }
            for invented in ["INP", "USBREC", "SIG"] {
                assert!(
                    !rule.options.contains(&invented),
                    "{invented} is not in Maillot's list"
                );
            }
        }

        /// The gate and dynamics sections accept `2250`, documented between `NSTR` and `L100`
        /// (2030, 2104). It is offered through the shared `plugin_models` constants, so this pins
        /// that the catalogue really carries it and refuses a model that is not in the list.
        #[test]
        fn the_catalogue_offers_the_documented_2250_model() {
            for key in ["gate_type", "comp_type"] {
                let rule = target_parameters_for_category("ch")
                    .into_iter()
                    .find(|parameter| parameter.key == key)
                    .unwrap_or_else(|| panic!("ch must offer {key}"));
                let position = rule
                    .options
                    .iter()
                    .position(|model| *model == "2250")
                    .unwrap_or_else(|| panic!("{key} must offer 2250"));
                assert_eq!(rule.options[position - 1], "NSTR", "{key}");
                assert_eq!(rule.options[position + 1], "L100", "{key}");
                assert!(watch_problem("ch", key, "==", "2250").is_none());
                assert!(watch_problem("ch", key, "==", "NOT-A-MODEL").is_some());
            }
        }

        // ── Batch 5: the strip long tail ──────────────────────────────────────────────────────────

        /// Every key the batch adds resolves to the leaf the family's own block of the reference
        /// prints — including the two rows the extracted text glues a footnote onto
        /// (`flt/tilt21` is `/flt/tilt`, `tags29` is `/tags`).
        #[test]
        fn every_strip_long_tail_key_resolves_to_its_documented_path() {
            let table: &[(&str, &str, &str, &str)] = &[
                // The two remaining input-set leaves (1937-1941, 2210-2214).
                ("ch", "1", "source_auto", "/ch/1/in/set/srcauto"),
                ("ch", "1", "input_balance", "/ch/1/in/set/bal"),
                ("aux", "2", "source_auto", "/aux/2/in/set/srcauto"),
                ("aux", "2", "input_balance", "/aux/2/in/set/bal"),
                // The filter node (1970-1979). `/flt/tilt` is the row the text prints `tilt21`.
                ("ch", "4", "flt_low_slope", "/ch/4/flt/lcs"),
                ("ch", "4", "flt_high_slope", "/ch/4/flt/hcs"),
                ("ch", "4", "flt_tool", "/ch/4/flt/tf"),
                ("ch", "4", "flt_model", "/ch/4/flt/mdl"),
                ("ch", "4", "flt_tilt", "/ch/4/flt/tilt"),
                // The PreSend EQ (2013-2023).
                ("ch", "6", "peq_on", "/ch/6/peq/on"),
                ("ch", "6", "peq_1_gain", "/ch/6/peq/1g"),
                ("ch", "6", "peq_1_freq", "/ch/6/peq/1f"),
                ("ch", "6", "peq_1_q", "/ch/6/peq/1q"),
                ("ch", "6", "peq_2_gain", "/ch/6/peq/2g"),
                ("ch", "6", "peq_2_freq", "/ch/6/peq/2f"),
                ("ch", "6", "peq_2_q", "/ch/6/peq/2q"),
                ("ch", "6", "peq_3_gain", "/ch/6/peq/3g"),
                ("ch", "6", "peq_3_freq", "/ch/6/peq/3f"),
                ("ch", "6", "peq_3_q", "/ch/6/peq/3q"),
                // The gate node's three model-dependent leaves (2038-2045).
                ("ch", "5", "gate_mix", "/ch/5/gate/mix"),
                ("ch", "5", "gate_gain", "/ch/5/gate/gain"),
                ("ch", "5", "gate_accent", "/ch/5/gate/acc"),
                // The gate sidechain (2048-2055).
                ("ch", "5", "gate_sc_type", "/ch/5/gatesc/type"),
                ("ch", "5", "gate_sc_freq", "/ch/5/gatesc/f"),
                ("ch", "5", "gate_sc_q", "/ch/5/gatesc/q"),
                ("ch", "5", "gate_sc_source", "/ch/5/gatesc/src"),
                ("ch", "5", "gate_sc_tap", "/ch/5/gatesc/tap"),
                // The detector, the envelope and the auto switch (2113-2118, 2457-2462, 2629-2634,
                // 2799-2810).
                ("ch", "5", "dyn_detector", "/ch/5/dyn/det"),
                ("ch", "5", "dyn_envelope", "/ch/5/dyn/env"),
                ("ch", "5", "dyn_auto", "/ch/5/dyn/auto"),
                ("bus", "7", "dyn_detector", "/bus/7/dyn/det"),
                ("main", "2", "dyn_envelope", "/main/2/dyn/env"),
                ("matrix", "3", "dyn_auto", "/mtx/3/dyn/auto"),
                // The dynamics sidechain, `dynsc` on every family that has the node (2130-2138,
                // 2315-2323, 2478-2487, 2653-2662, 2823-2832).
                ("ch", "5", "dyn_sc_type", "/ch/5/dynsc/type"),
                ("ch", "5", "dyn_sc_freq", "/ch/5/dynsc/f"),
                ("ch", "5", "dyn_sc_q", "/ch/5/dynsc/q"),
                ("ch", "5", "dyn_sc_source", "/ch/5/dynsc/src"),
                ("ch", "5", "dyn_sc_tap", "/ch/5/dynsc/tap"),
                ("aux", "2", "dyn_sc_tap", "/aux/2/dynsc/tap"),
                ("bus", "7", "dyn_sc_source", "/bus/7/dynsc/src"),
                ("main", "2", "dyn_sc_q", "/main/2/dynsc/q"),
                ("matrix", "3", "dyn_sc_type", "/mtx/3/dynsc/type"),
                // The process order (2003-2008) and the tags (2187, 2355, 2525, 2688, 2852).
                ("ch", "2", "proc_order", "/ch/2/proc"),
                ("ch", "2", "tags", "/ch/2/tags"),
                ("aux", "2", "tags", "/aux/2/tags"),
                ("bus", "2", "tags", "/bus/2/tags"),
                ("main", "2", "tags", "/main/2/tags"),
                ("matrix", "2", "tags", "/mtx/2/tags"),
                // The mono switch of the three output families (2389, 2560, 2727).
                ("bus", "3", "bus_mono", "/bus/3/busmono"),
                ("main", "1", "bus_mono", "/main/1/busmono"),
                ("matrix", "4", "bus_mono", "/mtx/4/busmono"),
                // The matrix direct input (2711-2715), the matrix's own node.
                ("matrix", "3", "dir_on", "/mtx/3/dir/on"),
                ("matrix", "3", "dir_level", "/mtx/3/dir/lvl"),
                ("matrix", "3", "dir_invert", "/mtx/3/dir/inv"),
                ("matrix", "3", "dir_source", "/mtx/3/dir/in"),
                // The EQ family (2059-2094, 2257-2283, 2400-2442, 2571-2611, 2738-2782).
                ("ch", "1", "eq_model", "/ch/1/eq/mdl"),
                ("aux", "1", "eq_model", "/aux/1/eq/mdl"),
                ("bus", "1", "eq_model", "/bus/1/eq/mdl"),
                ("main", "1", "eq_model", "/main/1/eq/mdl"),
                ("matrix", "1", "eq_model", "/mtx/1/eq/mdl"),
                ("ch", "1", "eq_mix", "/ch/1/eq/mix"),
                ("aux", "1", "eq_mix", "/aux/1/eq/mix"),
                ("bus", "1", "eq_mix", "/bus/1/eq/mix"),
                ("main", "1", "eq_mix", "/main/1/eq/mix"),
                ("matrix", "1", "eq_mix", "/mtx/1/eq/mix"),
                ("ch", "1", "eq_low_type", "/ch/1/eq/leq"),
                ("aux", "1", "eq_high_type", "/aux/1/eq/heq"),
                ("bus", "1", "eq_low_type", "/bus/1/eq/leq"),
                ("main", "1", "eq_high_type", "/main/1/eq/heq"),
                ("matrix", "1", "eq_low_type", "/mtx/1/eq/leq"),
                ("bus", "1", "eq_tilt", "/bus/1/eq/tilt"),
                ("main", "1", "eq_tilt", "/main/1/eq/tilt"),
                ("matrix", "1", "eq_tilt", "/mtx/1/eq/tilt"),
            ];
            for (category, id, key, expected) in table {
                assert_eq!(
                    resolve_basic_addresses(&target(category, id, key)),
                    vec![(*expected).to_string()],
                    "{category}/{key} (id {id}) must resolve to {expected}"
                );
                assert!(
                    watch_rule(category, key).is_some(),
                    "{category}/{key} must be in the catalogue, not only in the resolver"
                );
            }
        }

        /// The EQ mix is the batch's clearest per-family bound: 0…125 % on a channel, an aux and a
        /// matrix (2063, 2261, 2742), 0…100 % on a bus and a main (2404, 2575). The DTO carries the
        /// same numbers because it is built from this list.
        #[test]
        fn the_eq_mix_range_is_pinned_per_family() {
            let range = |category: &str| {
                let rule = watch_rule(category, "eq_mix")
                    .unwrap_or_else(|| panic!("{category} must offer eq_mix"));
                (rule.min, rule.max)
            };
            assert_eq!(range("ch"), (0.0, 125.0), "Maillot 2063");
            assert_eq!(range("aux"), (0.0, 125.0), "Maillot 2261");
            assert_eq!(range("matrix"), (0.0, 125.0), "Maillot 2742");
            assert_eq!(range("bus"), (0.0, 100.0), "Maillot 2404");
            assert_eq!(range("main"), (0.0, 100.0), "Maillot 2575");
            // The validator follows the family's own bound, not the shared one…
            assert!(value_problem("matrix", "eq_mix", "125").is_none());
            assert!(value_problem("ch", "eq_mix", "125").is_none());
            assert!(value_problem("bus", "eq_mix", "125").is_some());
            assert!(value_problem("bus", "eq_mix", "100").is_none());
            assert!(value_problem("main", "eq_mix", "-1").is_some());
            // …and so does the watch side of the key: one key cannot carry two ranges.
            let trigger = trigger_parameters_for_category("bus")
                .into_iter()
                .find(|parameter| parameter.key == "eq_mix")
                .expect("a bus can watch its EQ mix");
            assert_eq!((trigger.min, trigger.max), (0.0, 100.0));
        }

        /// The three EQ band-type lists, one per family group (2069/2094, 2267/2283, 2410/2438,
        /// 2581/2609, 2755/2779): a channel's two shelf types, the aux's three, and the thirteen
        /// crossover types a bus, a main and a matrix document.
        #[test]
        fn the_eq_band_types_are_pinned_per_family() {
            let options = |category: &str, key: &str| {
                watch_rule(category, key)
                    .unwrap_or_else(|| panic!("{category} must offer {key}"))
                    .options
            };
            const CROSSOVER: &[&str] = &[
                "PEQ", "SHV", "CUT", "BW6", "BW12", "BS12", "LR12", "BW18", "BW24", "BS24",
                "LR24", "BW48", "LR48",
            ];
            for key in ["eq_low_type", "eq_high_type"] {
                assert_eq!(options("ch", key), ["PEQ", "SHV"], "{key} (2069, 2094)");
                assert_eq!(
                    options("aux", key),
                    ["PEQ", "SHV", "CUT"],
                    "{key} (2267, 2283)"
                );
                for category in ["bus", "main", "matrix"] {
                    assert_eq!(
                        options(category, key),
                        CROSSOVER,
                        "{category}/{key} takes the thirteen crossover types (2410, 2438, 2581, 2609, 2755, 2779)"
                    );
                    assert_eq!(options(category, key).len(), 13, "{category}/{key}");
                }
                assert_ne!(
                    options("aux", key),
                    CROSSOVER,
                    "{key}: the aux list stops at CUT"
                );
            }
            // The list is what the validator accepts, family by family.
            assert!(value_problem("ch", "eq_low_type", "CUT").is_some());
            assert!(value_problem("aux", "eq_low_type", "CUT").is_none());
            assert!(value_problem("bus", "eq_low_type", "LR48").is_none());
            assert!(value_problem("bus", "eq_high_type", "BW6").is_none());
            assert!(value_problem("main", "eq_low_type", "BW6").is_none());
            assert!(value_problem("matrix", "eq_high_type", "LR48").is_none());
            assert!(value_problem("ch", "eq_low_type", "LR48").is_some());
        }

        /// The EQ model list is the family's own (2059, 2257, 2400, 2571, 2738): a channel runs
        /// MACH4, an aux has neither MACH4 nor PIA, and a bus, a main and a matrix run PIA. Offering
        /// a union would put a model in the picker that the console ignores for that strip.
        #[test]
        fn the_eq_model_list_is_pinned_per_family() {
            let options = |category: &str| {
                watch_rule(category, "eq_model")
                    .unwrap_or_else(|| panic!("{category} must offer eq_model"))
                    .options
            };
            let channel = ["STD", "SOUL", "E88", "E84", "F110", "PULSAR", "MACH4"];
            let aux = ["STD", "SOUL", "E88", "E84", "F110", "PULSAR"];
            let output = ["STD", "SOUL", "E88", "E84", "F110", "PULSAR", "PIA"];
            assert_eq!(options("ch"), channel, "Maillot 2059");
            assert_eq!(
                options("ch"),
                crate::plugin_models::CHANNEL_EQ_MODELS,
                "the channel list is the generated one, not a second copy"
            );
            assert_eq!(options("aux"), aux, "Maillot 2257");
            for category in ["bus", "main", "matrix"] {
                assert_eq!(options(category), output, "{category} (2400, 2571, 2738)");
            }
            assert!(value_problem("aux", "eq_model", "MACH4").is_some());
            assert!(value_problem("bus", "eq_model", "MACH4").is_some());
            assert!(value_problem("ch", "eq_model", "PIA").is_some());
            assert!(value_problem("ch", "eq_model", "MACH4").is_none());
            assert!(value_problem("bus", "eq_model", "PIA").is_none());
            assert!(value_problem("aux", "eq_model", "PULSAR").is_none());
        }

        /// The two sidechain tap lists (2053, 2136, 2322, 2486, 2661, 2831): the channel's eight
        /// entries ending in `POST`, and the six a bus, a main, a matrix and an aux take, where
        /// `INS2` names the post insert.
        #[test]
        fn the_dynamics_sidechain_tap_is_pinned_per_family() {
            let options = |category: &str, key: &str| {
                watch_rule(category, key)
                    .unwrap_or_else(|| panic!("{category} must offer {key}"))
                    .options
            };
            let channel = ["IN", "FILT", "3", "4", "5", "PFL", "AFL", "POST"];
            let other = ["BUS", "DYN", "PFL", "AFL", "EQ", "INS2"];
            assert_eq!(options("ch", "dyn_sc_tap"), channel, "Maillot 2136");
            assert_eq!(options("ch", "gate_sc_tap"), channel, "Maillot 2053");
            for category in ["aux", "bus", "main", "matrix"] {
                assert_eq!(
                    options(category, "dyn_sc_tap"),
                    other,
                    "{category} (2322, 2486, 2661, 2831)"
                );
                assert_eq!(options(category, "dyn_sc_tap").len(), 6);
                assert!(!options(category, "dyn_sc_tap").contains(&"POST"));
            }
            assert!(value_problem("ch", "dyn_sc_tap", "POST").is_none());
            assert!(value_problem("ch", "dyn_sc_tap", "INS2").is_some());
            assert!(value_problem("bus", "dyn_sc_tap", "INS2").is_none());
            assert!(value_problem("bus", "dyn_sc_tap", "POST").is_some());
            assert!(value_problem("aux", "dyn_sc_tap", "EQ").is_none());
        }

        /// The sidechain sources, written out because the console takes the names and not the
        /// `CH.1..CH.40` range notation (2052, 2135, 2319, 2483, 2658, 2828). A channel listens to
        /// itself or to one of the 40 channels; every other family listens to a bus, a main, a
        /// matrix or an aux.
        #[test]
        fn the_sidechain_sources_are_the_documented_names_per_family() {
            let options = |category: &str, key: &str| {
                watch_rule(category, key)
                    .unwrap_or_else(|| panic!("{category} must offer {key}"))
                    .options
            };
            let channel = options("ch", "dyn_sc_source");
            assert_eq!(channel.len(), 41, "SELF and the 40 channels (2135)");
            assert_eq!(channel.first().copied(), Some("SELF"));
            assert_eq!(channel[1], "CH.1");
            assert_eq!(channel.last().copied(), Some("CH.40"));
            assert_eq!(
                options("ch", "gate_sc_source"),
                channel,
                "2052 documents the same value space"
            );
            for category in ["aux", "bus", "main", "matrix"] {
                let sources = options(category, "dyn_sc_source");
                assert_eq!(
                    sources.len(),
                    37,
                    "{category}: SELF, 16 buses, 4 mains, 8 matrices and 8 aux (2319, 2483, 2658, 2828)"
                );
                assert_eq!(sources.first().copied(), Some("SELF"));
                for expected in ["BUS.16", "MAIN.4", "MTX.8", "AUX.8"] {
                    assert!(sources.contains(&expected), "{category} must offer {expected}");
                }
                assert!(
                    !sources.contains(&"CH.1"),
                    "{category} documents no channel in its sidechain source list"
                );
                assert!(
                    !sources.iter().any(|source| source.contains("..")),
                    "{category}: `BUS.1..BUS.16` is the document's shorthand, not a value"
                );
            }
            assert!(value_problem("ch", "gate_sc_source", "SELF").is_none());
            assert!(value_problem("ch", "dyn_sc_source", "CH.40").is_none());
            assert!(value_problem("bus", "dyn_sc_source", "BUS.16").is_none());
            assert!(value_problem("bus", "dyn_sc_source", "CH.1").is_some());
            assert!(value_problem("aux", "dyn_sc_source", "AUX.8").is_none());
        }

        /// The gate's `mix`, `gain` and `acc` belong to the model loaded in the gate slot, exactly
        /// like `thr`: `2250` documents `mix` and `gain`, the `GATE` model documents `acc` and
        /// neither of the other two, and a `DEQ2` has none of the three. The strip's model decides,
        /// through `model_leaf_for_parameter` and `model_parameter_problem`.
        #[test]
        fn the_gate_slot_keys_are_checked_against_the_strips_model() {
            for (plain, name) in [
                ("gate_mix", "mix"),
                ("gate_gain", "gain"),
                ("gate_accent", "acc"),
            ] {
                // The plain key reaches the leaf of the qualified target…
                assert_eq!(
                    model_leaf_for_parameter("ch", plain),
                    Some(("gate", name)),
                    "{plain}"
                );
                assert_eq!(
                    resolve_basic_addresses(&target("ch", "1", plain)),
                    vec![format!("/ch/1/gate/{name}")],
                    "{plain}"
                );
            }
            // A model that has the name is not refused…
            assert!(model_parameter_problem("gate", "mix", "2250").is_none());
            assert!(model_parameter_problem("gate", "gain", "2250").is_none());
            assert!(model_parameter_problem("gate", "acc", "GATE").is_none());
            // …and one that does not is checked before the write leaves the app, which is the point:
            // the console ignores the address without a word.
            for (name, model) in [("mix", "GATE"), ("gain", "GATE"), ("acc", "DEQ2")] {
                let problem = model_parameter_problem("gate", name, model).unwrap_or_else(|| {
                    panic!("{model} has no `{name}`, so gate:{name} must be refused")
                });
                assert!(problem.contains(model), "{problem}");
            }
            // The console's own default `/ch/1` dump is the witness for `GATE` (958): it prints
            // `mdl=GATE` with `thr, range, att, hld, rel, acc, ratio` and no `mix` and no `gain`.
            assert!(!crate::plugin_models::plugin_model_has_parameter("GATE", "mix"));
            assert!(!crate::plugin_models::plugin_model_has_parameter("GATE", "gain"));
            assert!(crate::plugin_models::plugin_model_has_parameter("GATE", "acc"));
        }

        /// The compressor's detector, envelope and auto switch belong to the model loaded in the
        /// dynamics slot, exactly like its threshold: the appendix gives `det` and `env` to COMP and
        /// EXP alone and `auto` to COMP, EXP, B560 and RED3, and the console's own default dump
        /// prints `mdl=COMP` with all three (961).
        #[test]
        fn the_dynamics_keys_are_checked_against_the_strips_model() {
            assert_eq!(
                model_leaf_for_parameter("ch", "dyn_detector"),
                Some(("dyn", "det"))
            );
            assert_eq!(
                model_leaf_for_parameter("ch", "dyn_envelope"),
                Some(("dyn", "env"))
            );
            assert_eq!(model_leaf_for_parameter("ch", "dyn_auto"), Some(("dyn", "auto")));
            for (category, key, address) in [
                ("ch", "dyn_detector", "/ch/1/dyn/det"),
                ("bus", "dyn_envelope", "/bus/1/dyn/env"),
                ("matrix", "dyn_auto", "/mtx/1/dyn/auto"),
            ] {
                assert_eq!(
                    resolve_basic_addresses(&target(category, "1", key)),
                    vec![address.to_string()],
                    "{category}/{key}"
                );
            }
            for name in ["det", "env", "auto"] {
                assert!(
                    model_parameter_problem("dyn", name, "COMP").is_none(),
                    "COMP documents `{name}`"
                );
                assert!(
                    model_parameter_problem("dyn", name, "LMT").is_some(),
                    "LMT has no `{name}`, so the write would be ignored in silence"
                );
            }
        }

        /// The model *selectors* are not model parameters: `/gate/mdl`, `/dyn/mdl` and `/eq/mdl`
        /// exist whatever model is loaded, and no appendix table lists `mdl` among a model's own
        /// parameters. Mapping one would make the model check refuse the very write that selects the
        /// model, so `gate_type`, `comp_type` and `eq_model` answer `None` here — the rule `main.rs`
        /// states for the on/off leaves and the selectors.
        #[test]
        fn the_model_selectors_are_not_model_parameters() {
            for (category, key) in [
                ("ch", "gate_type"),
                ("ch", "comp_type"),
                ("ch", "eq_model"),
                ("aux", "eq_model"),
                ("bus", "eq_model"),
                ("main", "eq_model"),
                ("matrix", "eq_model"),
            ] {
                assert_eq!(
                    model_leaf_for_parameter(category, key),
                    None,
                    "{category}/{key} is the model slot's selector, not one of its parameters"
                );
            }
            assert!(
                !crate::plugin_models::plugin_parameter_is_documented("mdl"),
                "no appendix table lists `mdl` as one of its own parameters"
            );
        }

        /// The EQ node's own leaves split in two, and the console's node dump is the witness for the
        /// split: `/eq/leq`, `/eq/heq` and `/eq/tilt` are the STD model's rows (no other EQ model's
        /// appendix table lists them), while `/eq/mix` exists whatever model the strip runs — the
        /// default dump prints `mdl=STD,mix=100` (958) although the appendix STD table omits `mix`.
        /// So the first three are model-checked and the mix is not: refusing the mix on the default
        /// model would block a control the console has.
        #[test]
        fn the_eq_node_leaves_are_model_checked_where_the_model_decides() {
            assert_eq!(model_leaf_for_parameter("ch", "eq_low_type"), Some(("eq", "leq")));
            assert_eq!(
                model_leaf_for_parameter("ch", "eq_high_type"),
                Some(("eq", "heq"))
            );
            assert_eq!(model_leaf_for_parameter("bus", "eq_tilt"), Some(("eq", "tilt")));
            for (name, model) in [("leq", "SOUL"), ("heq", "MACH4"), ("tilt", "PIA")] {
                assert!(
                    model_parameter_problem("eq", name, model).is_some(),
                    "{model} has no `{name}` in its appendix table"
                );
            }
            for name in ["leq", "heq", "tilt"] {
                assert!(
                    model_parameter_problem("eq", name, "STD").is_none(),
                    "STD documents `{name}`"
                );
            }
            // The mix is not a model parameter: every family offers it whatever model it runs, which
            // is what `trailing_model_leaf` in the test module pins for the contract walk.
            for category in ["ch", "aux", "bus", "main", "matrix"] {
                assert_eq!(
                    model_leaf_for_parameter(category, "eq_mix"),
                    None,
                    "{category}/eq_mix exists for every EQ model, so no model check may refuse it"
                );
            }
            assert!(
                !crate::plugin_models::plugin_model_has_parameter("STD", "mix"),
                "the appendix STD table omits `mix` although the console prints it (958)"
            );
            assert!(
                crate::plugin_models::plugin_model_has_parameter("SOUL", "mix"),
                "every other EQ model's table does list `mix`"
            );
        }

        /// The channel pretap (2009): a string enum, channels only, and the encoding settled on
        /// hardware. The reference's own state dumps print `ptap=4`, which is why this waited — an
        /// int write is ignored by the console, the string is taken verbatim, and a value outside the
        /// eight documented ones leaves the previous value in place.
        #[test]
        fn the_channel_pretap_is_the_documented_string_enum() {
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "ptap")),
                vec!["/ch/1/ptap".to_string()],
                "the channel's pretap is /ch/<n>/ptap (2009)"
            );
            for category in ["aux", "bus", "main", "matrix"] {
                assert!(
                    resolve_basic_addresses(&target(category, "1", "ptap")).is_empty(),
                    "{category} documents no pretap row, so the key must not resolve there"
                );
            }
            let rule = watch_rule("ch", "ptap").expect("the pretap is in the catalogue");
            assert_eq!((rule.arg_kind, rule.value_kind), ("string", "enum"));
            assert_eq!(
                rule.options,
                &["IN", "FILT", "3", "4", "5", "PFL", "AFL", "POST"],
                "the document's own list, in its order"
            );
            assert!(rule.can_trigger, "the console reports the pretap, so it is a watch too");
            for value in rule.options {
                assert!(
                    value_problem("ch", "ptap", value).is_none(),
                    "{value} is one of the eight documented values"
                );
            }
            assert!(
                value_problem("ch", "ptap", "ZZ").is_some(),
                "a value outside the list is refused before it is sent"
            );
            assert!(
                rule.hint.contains("verbatim"),
                "the hint must say the console takes the string itself: {:?}",
                rule.hint
            );
        }

        /// The gate ratio (2046) is offered: the extracted row wraps after its fourth value, so the
        /// list *looked* truncated and the key waited for a console read — on the test desk
        /// (WING Rack, FW 3.1.1, the engineering record) all five values are taken verbatim and
        /// an int is read as an index, so the key is a closed list of them.
        /// It is a model leaf as well: the appendix gives `ratio` to the GATE table (8219-8220) and to
        /// sixteen other gate models, and a DEQ2 gate has `1-ratio`/`2-ratio` instead, so the strip's
        /// model is checked before the write leaves the app.
        #[test]
        fn the_gate_ratio_is_a_closed_list_of_the_five_documented_values() {
            let rule = watch_rule("ch", "gate_ratio").expect("the gate ratio is offered");
            assert_eq!(rule.label, "Gate Ratio");
            assert_eq!(rule.value_kind, "enum", "the row is a string, and the list is the value space");
            assert_eq!(rule.options, ["1:1.5", "1:2", "1:3", "1:4", "gate"]);
            assert!(
                rule.hint.contains("index") && rule.hint.contains("gate"),
                "the hint must name the documented values and the index encoding: {:?}",
                rule.hint
            );
            assert!(rule.can_trigger, "the console reports the leaf, so it is a watch too");
            for value in rule.options {
                assert!(
                    value_problem("ch", "gate_ratio", value).is_none(),
                    "{value} is one of the five documented values"
                );
            }
            // The values the desk ignores are refused before a packet is built, and so is the mangled
            // spelling whose list this copy of the reference truncates.
            for value in ["1:5", "1:10", "1:20", "1:100", "GATE", "EXP"] {
                assert!(value_problem("ch", "gate_ratio", value).is_some(), "{value} is not taken");
            }
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "gate_ratio")),
                vec!["/ch/1/gate/ratio".to_string()]
            );
            // A channel's gate alone: no other family prints a `/gate` row, and `mix_parameter_allowed`
            // keeps every `gate_*` key there (2046 is in the channel block).
            for category in ["aux", "bus", "main", "matrix", "dca", "fx"] {
                assert!(
                    resolve_basic_addresses(&target(category, "1", "gate_ratio")).is_empty(),
                    "{category} has no gate node"
                );
            }
            // The model decides whether the leaf is there at all: GATE has `ratio`, DEQ2 has not.
            assert!(model_parameter_problem("gate", "ratio", "GATE").is_none());
            let problem = model_parameter_problem("gate", "ratio", "DEQ2").expect("refused");
            assert!(problem.contains("1-ratio"), "{problem}");
            assert_eq!(
                model_leaf_for_parameter("ch", "gate_ratio"),
                Some(("gate", "ratio")),
                "the strip's gate model has to be consulted, as it is for `gate_thr`"
            );
            // The compressor's ratio, whose float range *is* settled (2455), is untouched.
            assert_eq!(
                resolve_basic_addresses(&target("ch", "1", "comp_ratio")),
                vec!["/ch/1/dyn/ratio".to_string()]
            );
        }

        /// The matrix direct input (2711-2715): four keys on the matrix alone, the five-source list
        /// the row prints, and the level bound. No other family has a `/dir` node, so the keys
        /// resolve to nothing on ch, aux, bus and main rather than to a path the console ignores.
        #[test]
        fn the_matrix_direct_input_keys_exist_on_the_matrix_alone() {
            let table: &[(&str, &str)] = &[
                ("dir_on", "/mtx/1/dir/on"),
                ("dir_level", "/mtx/1/dir/lvl"),
                ("dir_invert", "/mtx/1/dir/inv"),
                ("dir_source", "/mtx/1/dir/in"),
            ];
            let triggers = trigger_parameters_for_category("matrix");
            for (key, address) in table {
                assert_eq!(
                    resolve_basic_addresses(&target("matrix", "1", key)),
                    vec![(*address).to_string()],
                    "matrix/{key} must resolve to {address}"
                );
                // Writable *and* watchable: the console reports the whole `/dir` node.
                let rule = watch_rule("matrix", key)
                    .unwrap_or_else(|| panic!("matrix/{key} must be in the catalogue"));
                assert!(rule.can_trigger, "matrix/{key} is reported by the console");
                assert!(
                    triggers.iter().any(|listed| listed.key == *key),
                    "matrix/{key} must be in the matrix's watch list"
                );
                for category in ["ch", "aux", "bus", "main"] {
                    assert!(
                        resolve_basic_addresses(&target(category, "1", key)).is_empty(),
                        "{category}/{key}: no `/dir` node exists outside the matrix (2711-2715)"
                    );
                }
            }
            let source = watch_rule("matrix", "dir_source").expect("the matrix offers dir_source");
            assert_eq!(source.value_kind, "enum");
            assert_eq!(source.arg_kind, "string", "a list is written as text");
            assert_eq!(
                source.options,
                ["OFF", "AES", "MON.PH", "MON.SPK", "MON.BUS"],
                "Maillot 2714-2715"
            );
            assert_eq!(source.options.len(), 5);
            for option in source.options {
                assert!(
                    value_problem("matrix", "dir_source", option).is_none(),
                    "{option} is one of the five documented sources"
                );
            }
            assert!(value_problem("matrix", "dir_source", "MON").is_some());
            assert!(value_problem("matrix", "dir_source", "AES50").is_some());
            let level = watch_rule("matrix", "dir_level").expect("the matrix offers dir_level");
            assert_eq!((level.min, level.max), (-144.0, 10.0), "Maillot 2712");
            assert!(value_problem("matrix", "dir_level", "-144").is_none());
            assert!(value_problem("matrix", "dir_level", "10").is_none());
            assert!(value_problem("matrix", "dir_level", "-145").is_some());
            assert!(value_problem("matrix", "dir_level", "11").is_some());
        }

        /// The family gates of the batch, one list per documented answer: the channel-only nodes,
        /// the three output families' mono switch, the two input-set leaves, the four families that
        /// document the detector, the five that document the sidechain node, and the EQ tilt a bus,
        /// a main and a matrix add.
        #[test]
        fn the_strip_long_tail_family_gates_are_right() {
            const CHANNEL_ONLY: &[&str] = &[
                "peq_on",
                "peq_1_gain",
                "peq_1_freq",
                "peq_1_q",
                "peq_2_gain",
                "peq_2_freq",
                "peq_2_q",
                "peq_3_gain",
                "peq_3_freq",
                "peq_3_q",
                "flt_low_slope",
                "flt_high_slope",
                "flt_tool",
                "flt_model",
                "flt_tilt",
                "gate_mix",
                "gate_gain",
                "gate_accent",
                "gate_sc_type",
                "gate_sc_freq",
                "gate_sc_q",
                "gate_sc_source",
                "gate_sc_tap",
                "proc_order",
            ];
            const OUTPUT_FAMILIES: &[&str] = &["bus_mono", "eq_tilt"];
            const MATRIX_ONLY: &[&str] = &["dir_on", "dir_level", "dir_invert", "dir_source"];
            const INPUT_SET: &[&str] = &["input_balance", "source_auto"];
            const FOUR_FAMILIES: &[&str] = &["dyn_detector", "dyn_envelope", "dyn_auto"];
            const EVERY_FAMILY: &[&str] = &[
                "tags",
                "eq_model",
                "eq_mix",
                "eq_low_type",
                "eq_high_type",
                "dyn_sc_type",
                "dyn_sc_freq",
                "dyn_sc_q",
                "dyn_sc_source",
                "dyn_sc_tap",
            ];
            let resolves = |category: &str, key: &str| {
                !resolve_basic_addresses(&target(category, "1", key)).is_empty()
            };
            for category in ["ch", "aux", "bus", "main", "matrix"] {
                for key in CHANNEL_ONLY {
                    assert_eq!(
                        resolves(category, key),
                        category == "ch",
                        "{category}/{key}: the node is documented on a channel only"
                    );
                }
                for key in OUTPUT_FAMILIES {
                    assert_eq!(
                        resolves(category, key),
                        matches!(category, "bus" | "main" | "matrix"),
                        "{category}/{key} (2389, 2441, 2560, 2612, 2727, 2782)"
                    );
                }
                for key in MATRIX_ONLY {
                    assert_eq!(
                        resolves(category, key),
                        category == "matrix",
                        "{category}/{key}: the direct input is the matrix's own node (2711-2715)"
                    );
                }
                for key in INPUT_SET {
                    assert_eq!(
                        resolves(category, key),
                        matches!(category, "ch" | "aux"),
                        "{category}/{key} (1937-1941, 2210-2214)"
                    );
                }
                for key in FOUR_FAMILIES {
                    assert_eq!(
                        resolves(category, key),
                        category != "aux",
                        "{category}/{key} (2113-2118, 2457-2462, 2629-2634, 2799-2810; the aux dynamics block stops at `mix` and `gain`)"
                    );
                }
                for key in EVERY_FAMILY {
                    assert!(
                        resolves(category, key),
                        "{category}/{key} is documented on every mix family"
                    );
                }
            }
        }

        /// The closed lists the batch adds, byte for byte the document's rows — the 24 process
        /// orders above all, which are every permutation of the gate, EQ, dynamics and insert
        /// stages (2003-2008).
        #[test]
        fn the_strip_long_tail_option_lists_are_the_documented_ones() {
            let options = |category: &str, key: &str| {
                watch_rule(category, key)
                    .unwrap_or_else(|| panic!("{category} must offer {key}"))
                    .options
            };

            let orders = options("ch", "proc_order");
            assert_eq!(
                orders,
                [
                    "GEDI", "GEID", "GIED", "IGED", "GDEI", "GDIE", "GIDE", "IGDE", "EGDI",
                    "EGID", "EIGD", "IEGD", "EDGI", "EDIG", "EIDG", "IEDG", "DEGI", "DEIG",
                    "DIEG", "IDEG", "DGEI", "DGIE", "DIGE", "IDGE",
                ],
                "the 24 orders of 2003-2008, in the document's order"
            );
            assert_eq!(orders.len(), 24);
            let mut sorted = orders.to_vec();
            sorted.sort_unstable();
            let mut unique = sorted.clone();
            unique.dedup();
            assert_eq!(unique.len(), 24, "an order is listed twice");
            for order in &sorted {
                assert_eq!(order.len(), 4, "{order} does not name four stages");
                let mut letters = order.chars().collect::<Vec<_>>();
                letters.sort_unstable();
                assert_eq!(letters, vec!['D', 'E', 'G', 'I'], "{order} is not a permutation");
            }

            assert_eq!(options("ch", "flt_low_slope"), ["6", "12", "18", "24"], "1970");
            assert_eq!(
                options("ch", "flt_high_slope"),
                ["6", "12"],
                "1973: two slopes, where the low cut has four"
            );
            assert_eq!(options("ch", "flt_model"), ["TILT", "MAX", "AP1", "AP2"], "1975");
            assert_eq!(options("ch", "dyn_detector"), ["PEAK", "RMS"], "2113");
            assert_eq!(options("ch", "dyn_envelope"), ["LIN", "LOG"], "2117");
            // One sidechain type list for both nodes. Row 2049 prints the switch `Off`, but 2131,
            // the four other family rows and the console's own `/ch/1` dump (958) print `OFF`, and a
            // comparison value the console never reports can never fire.
            for (category, key, line) in [
                ("ch", "gate_sc_type", "2049"),
                ("ch", "dyn_sc_type", "2131"),
                ("aux", "dyn_sc_type", "2316"),
                ("bus", "dyn_sc_type", "2479"),
                ("main", "dyn_sc_type", "2654"),
                ("matrix", "dyn_sc_type", "2824"),
            ] {
                assert_eq!(
                    options(category, key),
                    ["OFF", "LP12", "HP12", "BP", "NOTCH"],
                    "{category}/{key} ({line})"
                );
            }
            // The on/off leaves are on/off and offer no list at all.
            for (category, key) in [
                ("bus", "bus_mono"),
                ("ch", "source_auto"),
                ("ch", "peq_on"),
                ("ch", "flt_tool"),
                ("ch", "dyn_auto"),
            ] {
                let rule = watch_rule(category, key)
                    .unwrap_or_else(|| panic!("{category} must offer {key}"));
                assert_eq!(rule.value_kind, "toggle", "{category}/{key}");
                assert!(rule.options.is_empty(), "{category}/{key}");
            }
        }

        /// The overlay is one table and the channel row is the shared default: no override names
        /// `ch`, each row really changes the family it names, and a row the document does not vary
        /// keeps one value on every family.
        #[test]
        fn the_family_overlay_keeps_the_channel_row_as_the_shared_default() {
            assert!(
                MIX_FAMILY_OVERRIDES.iter().all(|row| row.category != "ch"),
                "the channel row is the shared default, so no override may name it"
            );
            for row in MIX_FAMILY_OVERRIDES {
                assert!(
                    matches!(row.category, "aux" | "bus" | "main" | "matrix"),
                    "{} is not a mix family",
                    row.category
                );
                assert!(
                    row.min.is_finite()
                        || row.max.is_finite()
                        || !row.options.is_empty()
                        || !row.hint.is_empty(),
                    "{}/{} overrides nothing",
                    row.category,
                    row.key
                );
                let rule = watch_rule(row.category, row.key).unwrap_or_else(|| {
                    panic!("{}/{} must be in the catalogue", row.category, row.key)
                });
                if row.min.is_finite() {
                    assert_eq!(rule.min, row.min, "{}/{}", row.category, row.key);
                }
                if row.max.is_finite() {
                    assert_eq!(rule.max, row.max, "{}/{}", row.category, row.key);
                }
                if !row.options.is_empty() {
                    assert_eq!(rule.options, row.options, "{}/{}", row.category, row.key);
                }
                if !row.hint.is_empty() {
                    assert_eq!(rule.hint, row.hint, "{}/{}", row.category, row.key);
                }
            }
            // The shared row survives where the document does not change it: the sidechain filter's
            // own range is the same on all five families (2132, 2317, 2480, 2655, 2825).
            for category in ["ch", "aux", "bus", "main", "matrix"] {
                let rule = watch_rule(category, "dyn_sc_freq")
                    .unwrap_or_else(|| panic!("{category} must offer dyn_sc_freq"));
                assert_eq!((rule.min, rule.max), (20.0, 20000.0), "{category}");
            }
            // …and the channel keeps the shared range, list and hint of every overridden key.
            assert_eq!(
                watch_rule("ch", "eq_mix").map(|rule| (rule.min, rule.max)),
                Some((0.0, 125.0))
            );
            assert_eq!(
                watch_rule("ch", "eq_low_type").map(|rule| rule.options),
                Some(&["PEQ", "SHV"][..])
            );
            assert_eq!(
                watch_rule("ch", "dyn_sc_tap").map(|rule| rule.options.len()),
                Some(8)
            );
            assert_eq!(
                watch_rule("ch", "eq_model").map(|rule| rule.options),
                Some(crate::plugin_models::CHANNEL_EQ_MODELS)
            );
        }

        // ── Batch 6: the desk level ───────────────────────────────────────────────────────────────

        /// Every key the batch adds resolves to the leaf its block of the reference prints, with the
        /// id segment the category documents: a letter for the AES50 ports (`/$stat/A/stat`, never
        /// `/$stat/1/stat`), a number for the monitor buses and the W-Live cards, and **no** segment
        /// for the six index-less nodes.
        ///
        /// The table is walked in both directions: every key of every new category must be here (so a
        /// key added to a list without a leaf fails), and every row must resolve (so a leaf without a
        /// key fails). `safes_output_a` is the row that needs a word: the extraction prints it as
        /// `/$ctl/safes/outpu/A` (4044), a typo, and the address is the consistent one.
        #[test]
        fn every_desk_level_key_resolves_to_its_documented_path() {
            let table: &[(&str, &str, &str, &str)] = &[
                // The desk lights (3128-3145), the node's eleven rows.
                ("lights", "1", "lights_btns", "/$ctl/cfg/lights/btns"),
                ("lights", "1", "lights_leds", "/$ctl/cfg/lights/leds"),
                ("lights", "1", "lights_meters", "/$ctl/cfg/lights/meters"),
                ("lights", "1", "lights_rgbleds", "/$ctl/cfg/lights/rgbleds"),
                ("lights", "1", "lights_chlcds", "/$ctl/cfg/lights/chlcds"),
                ("lights", "1", "lights_chlcdctr", "/$ctl/cfg/lights/chlcdctr"),
                ("lights", "1", "lights_chedit", "/$ctl/cfg/lights/chedit"),
                ("lights", "1", "lights_main", "/$ctl/cfg/lights/main"),
                ("lights", "1", "lights_glow", "/$ctl/cfg/lights/glow"),
                ("lights", "1", "lights_patch", "/$ctl/cfg/lights/patch"),
                ("lights", "1", "lights_lamp", "/$ctl/cfg/lights/lamp"),
                // The safes (4017-4067), all forty-one documented rows.
                ("safes", "1", "safes_ch", "/$ctl/safes/ch"),
                ("safes", "1", "safes_aux", "/$ctl/safes/aux"),
                ("safes", "1", "safes_bus", "/$ctl/safes/bus"),
                ("safes", "1", "safes_main", "/$ctl/safes/main"),
                ("safes", "1", "safes_mtx", "/$ctl/safes/mtx"),
                ("safes", "1", "safes_dca", "/$ctl/safes/dca"),
                ("safes", "1", "safes_mute", "/$ctl/safes/mute"),
                ("safes", "1", "safes_fx", "/$ctl/safes/fx"),
                ("safes", "1", "safes_source_lcl", "/$ctl/safes/source/LCL"),
                ("safes", "1", "safes_source_aux", "/$ctl/safes/source/AUX"),
                ("safes", "1", "safes_source_a", "/$ctl/safes/source/A"),
                ("safes", "1", "safes_source_b", "/$ctl/safes/source/B"),
                ("safes", "1", "safes_source_c", "/$ctl/safes/source/C"),
                ("safes", "1", "safes_source_sc", "/$ctl/safes/source/SC"),
                ("safes", "1", "safes_source_usb", "/$ctl/safes/source/USB"),
                ("safes", "1", "safes_source_crd", "/$ctl/safes/source/CRD"),
                ("safes", "1", "safes_source_mod", "/$ctl/safes/source/MOD"),
                ("safes", "1", "safes_source_play", "/$ctl/safes/source/PLAY"),
                ("safes", "1", "safes_source_aes", "/$ctl/safes/source/AES"),
                ("safes", "1", "safes_source_usr", "/$ctl/safes/source/USR"),
                ("safes", "1", "safes_source_osc", "/$ctl/safes/source/OSC"),
                ("safes", "1", "safes_output_lcl", "/$ctl/safes/output/LCL"),
                ("safes", "1", "safes_output_aux", "/$ctl/safes/output/AUX"),
                ("safes", "1", "safes_output_a", "/$ctl/safes/output/A"),
                ("safes", "1", "safes_output_b", "/$ctl/safes/output/B"),
                ("safes", "1", "safes_output_c", "/$ctl/safes/output/C"),
                ("safes", "1", "safes_output_sc", "/$ctl/safes/output/SC"),
                ("safes", "1", "safes_output_usb", "/$ctl/safes/output/USB"),
                ("safes", "1", "safes_output_crd", "/$ctl/safes/output/CRD"),
                ("safes", "1", "safes_output_mod", "/$ctl/safes/output/MOD"),
                ("safes", "1", "safes_output_rec", "/$ctl/safes/output/REC"),
                ("safes", "1", "safes_output_aes", "/$ctl/safes/output/AES"),
                ("safes", "1", "safes_area_left", "/$ctl/safes/area/LEFT"),
                ("safes", "1", "safes_area_center", "/$ctl/safes/area/CENTER"),
                ("safes", "1", "safes_area_right", "/$ctl/safes/area/RIGHT"),
                ("safes", "1", "safes_area_compact", "/$ctl/safes/area/COMPACT"),
                ("safes", "1", "safes_area_rack", "/$ctl/safes/area/RACK"),
                ("safes", "1", "safes_area_extern", "/$ctl/safes/area/EXTERN"),
                ("safes", "1", "safes_area_virtual", "/$ctl/safes/area/VIRTUAL"),
                ("safes", "1", "safes_custom", "/$ctl/safes/custom"),
                ("safes", "1", "safes_setup", "/$ctl/safes/setup"),
                // The first monitor bus (1316-1378), read-only rows included.
                ("monbus", "1", "monitor_level", "/cfg/mon/1/$lvl"),
                ("monbus", "1", "monitor_invert", "/cfg/mon/1/inv"),
                ("monbus", "1", "monitor_pan", "/cfg/mon/1/pan"),
                ("monbus", "1", "monitor_width", "/cfg/mon/1/wid"),
                ("monbus", "1", "monitor_eq_on", "/cfg/mon/1/eq/on"),
                ("monbus", "1", "monitor_eq_low_gain", "/cfg/mon/1/eq/lsg"),
                ("monbus", "1", "monitor_eq_low_freq", "/cfg/mon/1/eq/lsf"),
                ("monbus", "1", "monitor_eq_1_gain", "/cfg/mon/1/eq/1g"),
                ("monbus", "1", "monitor_eq_1_freq", "/cfg/mon/1/eq/1f"),
                ("monbus", "1", "monitor_eq_1_q", "/cfg/mon/1/eq/1q"),
                ("monbus", "1", "monitor_eq_2_gain", "/cfg/mon/1/eq/2g"),
                ("monbus", "1", "monitor_eq_2_freq", "/cfg/mon/1/eq/2f"),
                ("monbus", "1", "monitor_eq_2_q", "/cfg/mon/1/eq/2q"),
                ("monbus", "1", "monitor_eq_3_gain", "/cfg/mon/1/eq/3g"),
                ("monbus", "1", "monitor_eq_3_freq", "/cfg/mon/1/eq/3f"),
                ("monbus", "1", "monitor_eq_3_q", "/cfg/mon/1/eq/3q"),
                ("monbus", "1", "monitor_eq_4_gain", "/cfg/mon/1/eq/4g"),
                ("monbus", "1", "monitor_eq_4_freq", "/cfg/mon/1/eq/4f"),
                ("monbus", "1", "monitor_eq_4_q", "/cfg/mon/1/eq/4q"),
                ("monbus", "1", "monitor_eq_5_gain", "/cfg/mon/1/eq/5g"),
                ("monbus", "1", "monitor_eq_5_freq", "/cfg/mon/1/eq/5f"),
                ("monbus", "1", "monitor_eq_5_q", "/cfg/mon/1/eq/5q"),
                ("monbus", "1", "monitor_eq_6_gain", "/cfg/mon/1/eq/6g"),
                ("monbus", "1", "monitor_eq_6_freq", "/cfg/mon/1/eq/6f"),
                ("monbus", "1", "monitor_eq_6_q", "/cfg/mon/1/eq/6q"),
                ("monbus", "1", "monitor_eq_high_gain", "/cfg/mon/1/eq/hsg"),
                ("monbus", "1", "monitor_eq_high_freq", "/cfg/mon/1/eq/hsf"),
                ("monbus", "1", "monitor_limiter", "/cfg/mon/1/lim"),
                ("monbus", "1", "monitor_delay_on", "/cfg/mon/1/dly/on"),
                ("monbus", "1", "monitor_delay", "/cfg/mon/1/dly/m"),
                ("monbus", "1", "monitor_dim", "/cfg/mon/1/dim"),
                ("monbus", "1", "monitor_pfl_dim", "/cfg/mon/1/pfldim"),
                ("monbus", "1", "monitor_band_solo_trim", "/cfg/mon/1/eqbdtrim"),
                ("monbus", "1", "monitor_source_level", "/cfg/mon/1/srclvl"),
                ("monbus", "1", "monitor_source_mix", "/cfg/mon/1/srcmix"),
                ("monbus", "1", "monitor_source", "/cfg/mon/1/src"),
                ("monbus", "1", "monitor_direct_in", "/cfg/mon/1/dirin"),
                ("monbus", "1", "monitor_active_level", "/cfg/mon/1/$lvlact"),
                ("monbus", "1", "monitor_tags", "/cfg/mon/1/tags"),
                // The second bus is the same node under another id (1315 documents 1…2).
                ("monbus", "2", "monitor_pan", "/cfg/mon/2/pan"),
                ("monbus", "2", "monitor_source", "/cfg/mon/2/src"),
                // The solo configuration (1381-1394), the `$`-prefixed rows included.
                ("solocfg", "1", "solo_mode", "/cfg/solo/mode"),
                ("solocfg", "1", "solo_monitor", "/cfg/solo/mon"),
                ("solocfg", "1", "solo_mute", "/cfg/solo/mute"),
                ("solocfg", "1", "solo_dim", "/cfg/solo/$dim"),
                ("solocfg", "1", "solo_mono", "/cfg/solo/$mono"),
                ("solocfg", "1", "solo_flip", "/cfg/solo/$flip"),
                ("solocfg", "1", "solo_channel_tap", "/cfg/solo/chtap"),
                ("solocfg", "1", "solo_bus_tap", "/cfg/solo/bustap"),
                ("solocfg", "1", "solo_main_tap", "/cfg/solo/maintap"),
                ("solocfg", "1", "solo_matrix_tap", "/cfg/solo/mtxtap"),
                ("solocfg", "1", "solo_source", "/cfg/solo/srcsolo"),
                ("solocfg", "1", "solo_source_state", "/cfg/solo/$srcsolo"),
                ("solocfg", "1", "solo_source_group", "/cfg/solo/$srcsgrp"),
                ("solocfg", "1", "solo_source_input", "/cfg/solo/$srcsin"),
                // The AES50 ports, whose id is the letter (1253-1272).
                ("aes50", "1", "aes50_state", "/$stat/A/stat"),
                ("aes50", "2", "aes50_state", "/$stat/B/stat"),
                ("aes50", "3", "aes50_state", "/$stat/C/stat"),
                ("aes50", "1", "aes50_device", "/$stat/A/dev"),
                ("aes50", "1", "aes50_errors_corrected", "/$stat/A/errorsc"),
                ("aes50", "1", "aes50_errors_uncorrected", "/$stat/A/errorsu"),
                ("aes50", "1", "aes50_clear_errors", "/$stat/A/clrerr"),
                ("aes50", "3", "aes50_clear_errors", "/$stat/C/clrerr"),
                // The desk status (1274-1275).
                ("deskstatus", "1", "desk_lock", "/$stat/lock"),
                ("deskstatus", "1", "desk_ppm", "/$stat/ppm"),
                // The W-Live card (2967-2991) and the second slot (2966 documents 1…2).
                ("wlive", "1", "wlive_control", "/cards/wlive/1/$ctl/control"),
                ("wlive", "1", "wlive_open_session", "/cards/wlive/1/$ctl/opensession"),
                ("wlive", "1", "wlive_marker_edit", "/cards/wlive/1/$ctl/editmarker"),
                ("wlive", "1", "wlive_marker_goto", "/cards/wlive/1/$ctl/gotomarker"),
                ("wlive", "1", "wlive_marker_delete", "/cards/wlive/1/$ctl/deletemarker"),
                ("wlive", "1", "wlive_session_delete", "/cards/wlive/1/$ctl/deletesession"),
                ("wlive", "1", "wlive_time", "/cards/wlive/1/$ctl/stime"),
                ("wlive", "1", "wlive_session_name", "/cards/wlive/1/$ctl/namesession"),
                ("wlive", "1", "wlive_marker_set", "/cards/wlive/1/$ctl/setmarker"),
                ("wlive", "1", "wlive_format_card", "/cards/wlive/1/$ctl/formatsdcard"),
                ("wlive", "1", "wlive_state", "/cards/wlive/1/$stat/state"),
                ("wlive", "2", "wlive_control", "/cards/wlive/2/$ctl/control"),
                ("wlive", "2", "wlive_state", "/cards/wlive/2/$stat/state"),
                // The card in the slot (2951-2954) and the clock (4171-4186).
                ("cards", "1", "cards_type", "/cards/$type"),
                ("cards", "1", "cards_version", "/cards/$ver"),
                ("globals", "1", "global_clock_rate", "/$globals/clkrate"),
                ("globals", "1", "global_clock_source", "/$globals/clksrc"),
                ("globals", "1", "global_start_mute", "/$globals/startmute"),
                ("globals", "1", "global_usb_config", "/$globals/usbacfg"),
                (
                    "globals",
                    "1",
                    "global_stageconnect_config",
                    "/$globals/sccfg",
                ),
            ];

            for (category, id, key, expected) in table {
                assert_eq!(
                    resolve_basic_addresses(&target(category, id, key)),
                    vec![(*expected).to_string()],
                    "{category}/{key} (id {id}) must resolve to {expected}"
                );
                assert!(
                    watch_rule(category, key).is_some(),
                    "{category}/{key} must be in the catalogue, not only in the resolver"
                );
            }

            // Nothing in the nine blocks is left without a leaf: every key either list offers has a
            // row above, so a key added to a table without an address fails here.
            for category in [
                "lights", "safes", "monbus", "solocfg", "aes50", "deskstatus", "wlive", "cards",
                "globals",
            ] {
                let mut keys = target_parameters_for_category(category);
                for parameter in trigger_parameters_for_category(category) {
                    if !keys.iter().any(|listed| listed.key == parameter.key) {
                        keys.push(parameter);
                    }
                }
                assert!(!keys.is_empty(), "{category} offers nothing at all");
                for parameter in keys {
                    assert!(
                        table.iter().any(|(row_category, _, key, _)| {
                            *row_category == category && *key == parameter.key
                        }),
                        "{category}/{} resolves but has no documented address in this table",
                        parameter.key
                    );
                }
            }
        }

        /// The shape every new category declares: the console node's prefix, the documented entry
        /// count, which way the category can be used, and the id segment its paths are built with.
        #[test]
        fn the_desk_level_categories_declare_their_documented_shape() {
            let expected: &[(&str, &str, u16, &str, bool, bool, CategoryIdSegment)] = &[
                (
                    "lights",
                    "Desk Lights",
                    1,
                    "/$ctl/cfg/lights",
                    true,
                    true,
                    CategoryIdSegment::Absent,
                ),
                (
                    "safes",
                    "Safes",
                    1,
                    "/$ctl/safes",
                    true,
                    true,
                    CategoryIdSegment::Absent,
                ),
                (
                    "monbus",
                    "Monitor Buses",
                    2,
                    "/cfg/mon",
                    true,
                    true,
                    CategoryIdSegment::Index,
                ),
                (
                    "solocfg",
                    "Solo Configuration",
                    1,
                    "/cfg/solo",
                    true,
                    true,
                    CategoryIdSegment::Absent,
                ),
                (
                    "aes50",
                    "AES50 Status",
                    3,
                    "/$stat",
                    true,
                    true,
                    CategoryIdSegment::Letter,
                ),
                (
                    "deskstatus",
                    "Desk Status",
                    1,
                    "/$stat",
                    true,
                    false,
                    CategoryIdSegment::Absent,
                ),
                (
                    "wlive",
                    "W-Live Multitrack",
                    2,
                    "/cards/wlive",
                    true,
                    true,
                    CategoryIdSegment::Index,
                ),
                (
                    "cards",
                    "Cards",
                    1,
                    "/cards",
                    true,
                    false,
                    CategoryIdSegment::Absent,
                ),
                (
                    "globals",
                    "Global Settings",
                    1,
                    "/$globals",
                    true,
                    true,
                    CategoryIdSegment::Absent,
                ),
            ];
            for (key, label, count, prefix, can_trigger, can_target, segment) in expected {
                let info = target_categories()
                    .iter()
                    .find(|info| info.key == *key)
                    .unwrap_or_else(|| panic!("{key} must be a category"));
                assert_eq!(info.label, *label, "{key} label");
                assert_eq!(info.count, *count, "{key} entry count");
                assert_eq!(info.prefix, *prefix, "{key} prefix");
                assert_eq!(
                    (info.can_trigger, info.can_target),
                    (*can_trigger, *can_target),
                    "{key} flags"
                );
                assert!(!info.group.trim().is_empty(), "{key} has no picker group");
                assert_eq!(prefix_for_category(key), Some(*prefix), "{key} prefix helper");
                assert_eq!(category_id_segment(key), *segment, "{key} id segment");
            }
            // The ids themselves: the monitor buses and the W-Live cards have two entries, the AES50
            // node three, and an id past the documented count names nothing.
            for id in [1_u16, 2] {
                assert!(category_has_id("monbus", id), "monitor bus {id}");
                assert!(category_has_id("wlive", id), "W-Live card {id}");
            }
            for id in [1_u16, 2, 3] {
                assert!(category_has_id("aes50", id), "AES50 port {id}");
            }
            assert!(!category_has_id("monbus", 3));
            assert!(!category_has_id("wlive", 3));
            assert!(!category_has_id("aes50", 4));
            // The index-less categories take any id they are handed: the id never reaches the path.
            for key in ["lights", "safes", "solocfg", "deskstatus", "cards", "globals"] {
                assert!(category_has_id(key, 1), "{key}");
                assert!(category_has_id(key, 9), "{key} must be index-less");
            }
        }

        /// The AES50 status node is the catalogue's third **letter** category: id 1 renders `A`, 2
        /// `B`, 3 `C` (Maillot 1253, 1260, 1267), and a fourth id renders nothing at all rather than
        /// the number the console would ignore.
        #[test]
        fn the_aes50_letter_segment_renders_a_b_c_and_never_the_number() {
            assert_eq!(category_id_segment("aes50"), CategoryIdSegment::Letter);
            for (id, letter) in [("1", "A"), ("2", "B"), ("3", "C")] {
                assert_eq!(
                    resolve_basic_addresses(&target("aes50", id, "aes50_state")),
                    vec![format!("/$stat/{letter}/stat")],
                    "port {id}"
                );
                assert_eq!(
                    resolve_basic_addresses(&target("aes50", id, "aes50_errors_uncorrected")),
                    vec![format!("/$stat/{letter}/errorsu")],
                    "port {id}"
                );
            }
            assert!(
                resolve_basic_addresses(&target("aes50", "4", "aes50_state")).is_empty(),
                "there is no fourth AES50 port"
            );
            assert!(
                resolve_basic_addresses(&target("aes50", "0", "aes50_state")).is_empty(),
                "port 0 is not an entry"
            );
            // The number is never a fallback: `/$stat/1/stat` is not a path the console has.
            for id in ["1", "2", "3"] {
                for address in resolve_basic_addresses(&target("aes50", id, "aes50_device")) {
                    assert!(
                        !address.contains("/1/") && !address.contains("/2/") && !address.contains("/3/"),
                        "the id reached the path as a number: {address}"
                    );
                }
            }
        }

        /// The two families that are too long to read in one go carry a second level, and nothing else
        /// does: "Sources" is sixteen entries and "Outputs" eleven (Maillot 1955-1965 and 1844-1846),
        /// while every other group is one screenful.
        ///
        /// The order is the document's own (`Local, Aux, AES50 A/B/C, StageConnect, USB, Card, Module,
        /// Player, AES/EBU, User, Oscillator, Bus, Main, Matrix`), so the second level is a reading of
        /// the list rather than a reordering of it, and an empty subgroup anywhere else keeps the
        /// drawn list to one heading per group.
        #[test]
        fn the_source_and_output_families_carry_a_second_level() {
            fn levels(group: &str) -> Vec<&'static str> {
                let mut seen = Vec::new();
                for info in target_categories().iter().filter(|info| info.group == group) {
                    assert!(
                        !info.subgroup.is_empty(),
                        "{} in {group} has no second level",
                        info.key
                    );
                    if !seen.contains(&info.subgroup) {
                        seen.push(info.subgroup);
                    }
                }
                seen
            }
            assert_eq!(
                target_categories()
                    .iter()
                    .filter(|info| info.group == "Sources")
                    .count(),
                16,
                "the source family"
            );
            assert_eq!(
                levels("Sources"),
                vec!["Local", "Stage box", "Card & USB", "Internal", "Bus meters"]
            );
            assert_eq!(
                target_categories()
                    .iter()
                    .filter(|info| info.group == "Outputs")
                    .count(),
                11,
                "the output family"
            );
            assert_eq!(levels("Outputs"), vec!["Local", "Stage box", "Card & USB"]);
            for info in target_categories()
                .iter()
                .filter(|info| info.group != "Sources" && info.group != "Outputs")
            {
                assert!(
                    info.subgroup.is_empty(),
                    "{} in {} needs no second level; a lone subheading over one family reads as a mistake",
                    info.key,
                    info.group
                );
            }
            // The two labels that would collide: the auxiliary *channels* are "Aux Inputs" in the Mix
            // family and the auxiliary *sockets* are "Aux Sources" in the source family.
            let mixer = target_categories()
                .iter()
                .find(|info| info.key == "aux")
                .expect("the aux channels");
            let socket = target_categories()
                .iter()
                .find(|info| info.key == "preamp_aux")
                .expect("the aux sockets");
            assert_eq!((mixer.label, socket.label), ("Aux Inputs", "Aux Sources"));
        }

        /// The monitor buses and the W-Live cards are numbered, and their documented series stop at
        /// two: Maillot 1315 (`/cfg/mon/1 N 1..2`) and 2966 (`/cards/wlive/1 N 1..2`). A third id —
        /// and a fourth, which the batch spec had assumed for the card — resolves to nothing instead
        /// of to a path the console ignores in silence.
        #[test]
        fn an_id_outside_the_monitor_bus_or_the_card_slot_is_refused() {
            assert_eq!(
                resolve_basic_addresses(&target("monbus", "2", "monitor_dim")),
                vec!["/cfg/mon/2/dim".to_string()]
            );
            assert!(
                resolve_basic_addresses(&target("monbus", "3", "monitor_dim")).is_empty(),
                "the desk has two monitor buses (1315)"
            );
            assert_eq!(
                resolve_basic_addresses(&target("wlive", "2", "wlive_control")),
                vec!["/cards/wlive/2/$ctl/control".to_string()]
            );
            for id in ["3", "4"] {
                assert!(
                    resolve_basic_addresses(&target("wlive", id, "wlive_control")).is_empty(),
                    "card {id} does not exist: `/cards/wlive/1 N 1..2` (2966)"
                );
                assert!(
                    resolve_basic_addresses(&target("wlive", id, "wlive_state")).is_empty(),
                    "card {id} does not exist"
                );
            }
        }

        /// The write/watch split of the four desk-level nodes that carry both directions.
        ///
        /// A `[RO]` row is offered as a watch and is **absent** from the step list — the rule that
        /// kept the oscillator's `mode` out of batch 3 — while a writable key the console reports is
        /// on both sides, and a write-only command (the W-Live transport, the AES50 reset) is on the
        /// step side alone. The category flags are one pair for the whole node, which is why the split
        /// has to hold key by key in these two lists.
        #[test]
        fn only_the_writable_desk_level_keys_are_targets_and_only_the_read_only_ones_are_watched() {
            let cases: &[(&str, &[&str])] = &[
                ("monbus", &["monitor_level", "monitor_active_level"]),
                (
                    "solocfg",
                    // The three source-solo reports. `$dim`, `$mono` and `$flip` are `$` rows too,
                    // but a write on hardware latches (WING Rack, FW 3.1.1), so they are
                    // targets — see `the_dollar_prefixed_solo_leaves_split_by_what_the_desk_takes`.
                    &["solo_source_state", "solo_source_group", "solo_source_input"],
                ),
                (
                    "aes50",
                    &[
                        "aes50_state",
                        "aes50_device",
                        "aes50_errors_corrected",
                        "aes50_errors_uncorrected",
                    ],
                ),
                ("wlive", &["wlive_state"]),
                ("deskstatus", &["desk_lock", "desk_ppm"]),
                ("cards", &["cards_type", "cards_version"]),
            ];
            for (category, read_only) in cases {
                let targets: Vec<&str> = target_parameters_for_category(category)
                    .iter()
                    .map(|parameter| parameter.key)
                    .collect();
                let watches: Vec<&str> = trigger_parameters_for_category(category)
                    .iter()
                    .map(|parameter| parameter.key)
                    .collect();
                assert!(!watches.is_empty(), "{category} has no watch list");
                for key in *read_only {
                    assert!(
                        watches.contains(key),
                        "{category}/{key} is [RO] and must still be offered as a watch"
                    );
                    assert!(
                        !targets.contains(key),
                        "{category}/{key} is [RO]: a step must not be able to write it"
                    );
                    // …and the rule a step has to pass says so itself, because the lists alone do not
                    // stop a hand-edited show file from arming a step at the key.
                    let problem = target_problem(category, key).unwrap_or_else(|| {
                        panic!("{category}/{key} is a watch and target_problem must refuse a step at it")
                    });
                    assert!(
                        problem.contains("read-only"),
                        "{category}/{key}: the refusal must say why, got {problem:?}"
                    );
                    let rule = watch_rule(category, key)
                        .unwrap_or_else(|| panic!("{category}/{key} is not in the catalogue"));
                    assert!(rule.can_trigger, "{category}/{key} must be watchable");
                }
                for key in &targets {
                    assert!(
                        target_problem(category, key).is_none(),
                        "{category}/{key} is offered as a step, so target_problem must accept it"
                    );
                }
                // Every key of the target list is a watch exactly when the console reports it, so a
                // command can never be compared and a reported value can never leave the watch list.
                for parameter in target_parameters_for_category(category) {
                    if parameter.can_trigger {
                        assert!(
                            watches.contains(&parameter.key),
                            "{category}/{} is written and reported, so it must be a watch too",
                            parameter.key
                        );
                    } else {
                        assert!(
                            !watches.contains(&parameter.key),
                            "{category}/{} is a command the console does not report",
                            parameter.key
                        );
                    }
                }
                // And the list that carries a read-only key carries nothing else: the target half
                // must not have grown a key only the watch half may use.
                for key in watches {
                    if !targets.contains(&key) {
                        assert!(
                            read_only.contains(&key),
                            "{category}/{key} is a watch that no documented rule makes read-only"
                        );
                    }
                }
            }
        }

        /// The rule that keeps a step away from a watch, catalogue-wide: a key in a target list is a
        /// step target, a key only a trigger list carries is refused with the reason, and a key the
        /// catalogue does not know is not this rule's business (a raw custom address never reaches it,
        /// and the dead `load_snapshot` entries resolve to no address at all).
        ///
        /// The lists alone cannot do this: `resolve_basic_addresses` builds the address of a
        /// read-only leaf like any other, and `watch_rule` deliberately finds it, so a hand-edited
        /// show file could arm a step at `/$stat/lock` and the console would ignore the write while
        /// the macro reported success.
        #[test]
        fn a_read_only_key_is_never_a_step_target() {
            let mut refused = 0_usize;
            for category in target_categories() {
                let targets: Vec<&str> = target_parameters_for_category(category.key)
                    .iter()
                    .map(|parameter| parameter.key)
                    .collect();
                for parameter in trigger_parameters_for_category(category.key) {
                    let problem = target_problem(category.key, parameter.key);
                    if targets.contains(&parameter.key) {
                        assert!(
                            problem.is_none(),
                            "{}/{}: a step target must pass target_problem, got {problem:?}",
                            category.key,
                            parameter.key
                        );
                    } else {
                        assert!(
                            problem.is_some(),
                            "{}/{}: a watch-only key must not be a step target",
                            category.key,
                            parameter.key
                        );
                        assert!(
                            parameter.can_trigger,
                            "{}/{}: a key only the watch list carries must be a reported value",
                            category.key,
                            parameter.key
                        );
                        refused += 1;
                    }
                }
                for parameter in target_parameters_for_category(category.key) {
                    assert!(
                        target_problem(category.key, parameter.key).is_none(),
                        "{}/{}: every entry of a target list must pass target_problem",
                        category.key,
                        parameter.key
                    );
                }
            }
            assert!(
                refused > 0,
                "the catalogue must carry at least one watch-only key for this rule to be tested"
            );
            // An unknown key and an unknown category are not refused by this rule: the caller that
            // owns them (the raw custom address) is the one that judges them.
            assert_eq!(target_problem("monbus", "monitor_nonsense"), None);
            assert_eq!(target_problem("nonsense", "monitor_level"), None);
        }

        /// The two monitor rows the document marks read-only: `$lvl` under footnote 13 (the full-size
        /// WING will not take the write) and `$lvlact` in so many words (1377). Both resolve — a watch
        /// is a comparison against a real address — and neither is in the step list, while the rest of
        /// the node is written normally.
        #[test]
        fn the_read_only_monitor_leaves_are_watched_and_not_written() {
            let level = watch_rule("monbus", "monitor_level").expect("the level is in the catalogue");
            assert_eq!((level.min, level.max), (-144.0, 10.0), "Maillot 1316");
            assert!(
                level.hint.contains("footnote 13"),
                "the level hint must carry the read-only caveat: {}",
                level.hint
            );
            assert_eq!(
                resolve_basic_addresses(&target("monbus", "1", "monitor_level")),
                vec!["/cfg/mon/1/$lvl".to_string()],
                "the watch needs the address the read-only row documents"
            );
            // A value of the right kind is accepted for a watch, and the row is still not a step on a
            // desk whose model is not known: the write is model-restricted (see the test below).
            assert!(value_problem("monbus", "monitor_level", "-20").is_none());
            assert!(watch_problem("monbus", "monitor_level", "<", "-20").is_none());
            assert!(
                !target_parameters_for_category("monbus")
                    .iter()
                    .any(|parameter| parameter.key == "monitor_level"),
                "the write is withheld until the desk's model is known"
            );

            let active = watch_rule("monbus", "monitor_active_level")
                .expect("the reported fader level is in the catalogue");
            assert_eq!((active.min, active.max), (-144.0, 10.0), "Maillot 1377");
            assert!(
                active.hint.contains("[RO]"),
                "the active level is the console's report: {}",
                active.hint
            );
            assert_eq!(
                resolve_basic_addresses(&target("monbus", "2", "monitor_active_level")),
                vec!["/cfg/mon/2/$lvlact".to_string()]
            );

            // The writable rows of the same node are untouched by the caveat.
            for key in [
                "monitor_invert",
                "monitor_pan",
                "monitor_dim",
                "monitor_source",
                "monitor_tags",
            ] {
                assert!(
                    target_parameters_for_category("monbus")
                        .iter()
                        .any(|parameter| parameter.key == key),
                    "{key} must be a step target"
                );
            }
        }

        /// Footnote 13 (1357-1359), glued to the monitor bus level row (1316): *"This command is
        /// considered RO on the full-size WING, and can be set for other devices where the actual
        /// surface control potentiometer is not present."* The document therefore grants the write
        /// to a Rack and a Compact, and a WING Rack was **measured on 2026-09-27** to ignore it in
        /// every spelling while the rest of its monitor node answered — so the Rack follows the
        /// full-size desk into the read-only side and only the Compact, which no desk here can
        /// measure, is offered the write. The owner's rule that no capability may be tied to one
        /// unit (master plan 2026-09-22, §12) is what keeps this a table and not a hardcoded refusal.
        #[test]
        fn the_monitor_level_write_follows_the_announced_model() {
            let level = |model: DeskModel| {
                target_parameters_for_category_for_model("monbus", model)
                    .into_iter()
                    .any(|parameter| parameter.key == "monitor_level")
            };
            // The Compact has no monitor level potentiometer: the write is its alone.
            assert!(level(DeskModel::Compact));
            // The full-size WING has one, and the Rack was measured to ignore the write.
            assert!(!level(DeskModel::Full));
            assert!(!level(DeskModel::Rack));
            // A model nobody announced takes the conservative answer, and the refusal says why.
            assert!(!level(DeskModel::Unknown));

            assert!(target_problem_for_model("monbus", "monitor_level", DeskModel::Compact).is_none());
            let rack = target_problem_for_model("monbus", "monitor_level", DeskModel::Rack)
                .expect("a Rack was measured to ignore a write to $lvl");
            assert!(rack.contains("read-only"), "{rack}");
            assert!(rack.contains("WING Rack"), "{rack}");
            assert!(
                rack.contains("2026-09-27"),
                "the refusal cites the measurement that closed the document's grant: {rack}"
            );
            let refused = target_problem_for_model("monbus", "monitor_level", DeskModel::Full)
                .expect("the full-size desk ignores a write to $lvl");
            assert!(refused.contains("read-only"), "{refused}");
            assert!(refused.contains("full-size WING"), "{refused}");
            let unknown = target_problem_for_model("monbus", "monitor_level", DeskModel::Unknown)
                .expect("an unannounced model cannot be granted a model-specific write");
            assert!(unknown.contains("read-only"), "{unknown}");
            assert!(unknown.contains("model"), "{unknown}");

            // Every model still *watches* the level: the console reports it and footnote 13 only
            // takes the write away.
            for model in [
                DeskModel::Full,
                DeskModel::Rack,
                DeskModel::Compact,
                DeskModel::Unknown,
            ] {
                assert!(
                    trigger_parameters_for_category("monbus")
                        .iter()
                        .any(|parameter| parameter.key == "monitor_level"),
                    "{model:?} must be able to watch the monitor level"
                );
            }

            // The two write lists differ in this one key and in nothing else **on the model that
            // takes the write**: the Compact's list is the unknown-model list plus `monitor_level`.
            // The Rack's is the unknown-model list exactly, because the measurement moved its level
            // to the read-only side — that is the other half of the same auditable rule, and a second
            // model-restricted key would have to be named here.
            let unknown_keys = target_parameters_for_category("monbus")
                .into_iter()
                .map(|parameter| parameter.key)
                .collect::<Vec<_>>();
            let compact_keys = target_parameters_for_category_for_model("monbus", DeskModel::Compact)
                .into_iter()
                .map(|parameter| parameter.key)
                .collect::<Vec<_>>();
            assert_eq!(compact_keys.len(), unknown_keys.len() + 1);
            assert!(compact_keys.contains(&"monitor_level"));
            for key in &unknown_keys {
                assert!(compact_keys.contains(key), "{key} must stay writable on a Compact");
            }
            let rack_keys = target_parameters_for_category_for_model("monbus", DeskModel::Rack)
                .into_iter()
                .map(|parameter| parameter.key)
                .collect::<Vec<_>>();
            assert_eq!(
                rack_keys, unknown_keys,
                "a Rack's step list is the unannounced model's: the level is a watch there"
            );
            assert!(!rack_keys.contains(&"monitor_level"));
        }

        /// The six `$`-prefixed rows of the solo node are the console's own report (1384-1386,
        /// 1392-1394): a watch, never a step. `solo_mute` — the one solo switch without the mark — is
        /// the writable half of the same node, so the split is the `$` and nothing else.
        #[test]
        fn the_dollar_prefixed_solo_leaves_split_by_what_the_desk_takes() {
            // A write was tried on the desk (WING Rack, FW 3.1.1): `$dim`, `$mono` and
            // `$flip` latch the value written, the three source-solo reports do not. The split
            // follows that measurement, and every one of the six is still a watch.
            let read_only = ["solo_source_state", "solo_source_group", "solo_source_input"];
            let writable = ["solo_dim", "solo_mono", "solo_flip"];
            let targets: Vec<&str> = target_parameters_for_category("solocfg")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            let watches: Vec<&str> = trigger_parameters_for_category("solocfg")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            for key in read_only {
                assert!(watches.contains(&key), "{key} must be a watch");
                assert!(!targets.contains(&key), "{key} must not be a step");
                let address = resolve_basic_addresses(&target("solocfg", "1", key));
                assert_eq!(address.len(), 1, "{key} must resolve once");
                assert!(
                    address[0].contains("/$"),
                    "{key} is a `$`-prefixed row: {}",
                    address[0]
                );
            }
            for key in writable {
                assert!(watches.contains(&key), "{key} must stay a watch");
                assert!(targets.contains(&key), "{key} takes a write on hardware");
                assert!(
                    target_problem("solocfg", key).is_none(),
                    "{key} is a target, so a step at it must pass the rule"
                );
            }
            assert!(targets.contains(&"solo_mute"), "solo_mute is writable (1383)");
            assert!(watches.contains(&"solo_mute"), "and reported");
            for key in ["solo_mode", "solo_monitor", "solo_source"] {
                assert!(targets.contains(&key), "{key} is writable");
            }
        }

        /// The AES50 health rows are watches — "the link dropped", "the error count is climbing" —
        /// and the one settable row of the node, `clrerr`, is a command: a step writes it and no
        /// watch is offered for it, because what it changes is the two counters beside it.
        #[test]
        fn the_aes50_state_keys_are_watched_while_clrerr_is_writable() {
            let targets: Vec<&str> = target_parameters_for_category("aes50")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert_eq!(targets, vec!["aes50_clear_errors"]);
            let watches: Vec<&str> = trigger_parameters_for_category("aes50")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert_eq!(
                watches,
                vec![
                    "aes50_state",
                    "aes50_device",
                    "aes50_errors_corrected",
                    "aes50_errors_uncorrected"
                ]
            );

            let clear = watch_rule("aes50", "aes50_clear_errors").expect("the reset is in the catalogue");
            assert!(
                !clear.can_trigger,
                "a command is written, not compared: {}",
                clear.hint
            );
            assert!(value_problem("aes50", "aes50_clear_errors", "1").is_none());
            assert!(value_problem("aes50", "aes50_clear_errors", "2").is_some());
            assert!(
                watch_problem("aes50", "aes50_clear_errors", "==", "1").is_some(),
                "a watch of the reset command can never mean anything"
            );
            // The state rows keep their documented values and stay out of the step list.
            assert!(value_problem("aes50", "aes50_state", "OK").is_none());
            assert!(value_problem("aes50", "aes50_state", "-").is_none());
            assert!(
                watch_rule("aes50", "aes50_errors_corrected").map(|rule| (rule.min, rule.max))
                    == Some((0.0, 9999.0))
            );
        }

        /// The two nodes the console only reports: no step list at all, and the identity of the card
        /// in the slot is how a macro tells whether a W-Live card is there before arming a transport.
        #[test]
        fn the_desk_status_and_card_identity_keys_are_watch_only() {
            for (category, keys) in [
                ("deskstatus", vec!["desk_lock", "desk_ppm"]),
                ("cards", vec!["cards_type", "cards_version"]),
            ] {
                let info = target_categories()
                    .iter()
                    .find(|info| info.key == category)
                    .expect("the category exists");
                assert!(info.can_trigger && !info.can_target, "{category} flags");
                assert!(
                    target_parameters_for_category(category).is_empty(),
                    "{category} must refuse every write"
                );
                let watches: Vec<&str> = trigger_parameters_for_category(category)
                    .iter()
                    .map(|parameter| parameter.key)
                    .collect();
                assert_eq!(watches, keys, "{category} watch list");
            }
            assert_eq!(
                watch_rule("cards", "cards_type").map(|rule| rule.options),
                Some(&["NONE", "WLIVE", "WDANTE", "WMADI", "WDWSG"][..]),
                "cards_type tells a W-Live card from the others (2951)"
            );
            assert_eq!(
                watch_rule("cards", "cards_version").map(|rule| rule.max_len),
                Some(32),
                "32 characters maximum (2954)"
            );
        }

        /// The W-Live card: the ten `$ctl` commands are steps, the state is the one watch, and each
        /// command is written without being read back — the shape the USB recorder's `$action` has.
        #[test]
        fn the_wlive_state_is_a_watch_and_the_transport_commands_are_writes() {
            let targets: Vec<&str> = target_parameters_for_category("wlive")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert_eq!(
                targets,
                vec![
                    "wlive_control",
                    "wlive_open_session",
                    "wlive_marker_edit",
                    "wlive_marker_goto",
                    "wlive_marker_delete",
                    "wlive_session_delete",
                    "wlive_time",
                    "wlive_session_name",
                    "wlive_marker_set",
                    "wlive_format_card",
                ]
            );
            let watches: Vec<&str> = trigger_parameters_for_category("wlive")
                .iter()
                .map(|parameter| parameter.key)
                .collect();
            assert_eq!(watches, vec!["wlive_state"]);
            for parameter in target_parameters_for_category("wlive") {
                assert!(
                    !parameter.can_trigger,
                    "{} is a command: the card reports its state on `$stat/state`",
                    parameter.key
                );
            }
            assert!(
                watch_rule("wlive", "wlive_state")
                    .expect("the state is in the catalogue")
                    .hint
                    .contains("[RO]")
            );
        }

        /// The new `wlive` category is the multitrack card, and the bare name is no longer an alias
        /// for the card *input* source's meters: one key cannot mean two nodes. The card source keeps
        /// every other spelling, `preamp_wlive` included.
        #[test]
        fn the_wlive_category_is_not_the_card_meter_alias() {
            assert!(
                resolve_meter_targets(&target("wlive", "1", "meter")).is_empty(),
                "the W-Live card node has no meters in the catalogue"
            );
            assert_eq!(
                resolve_basic_addresses(&target("wlive", "1", "wlive_control")),
                vec!["/cards/wlive/1/$ctl/control".to_string()]
            );
            for category in ["preamp_card", "card", "crd", "dante", "preamp_wlive"] {
                assert!(
                    !resolve_meter_targets(&target(category, "1", "meter")).is_empty(),
                    "{category} still names the card input's meters"
                );
            }
        }

        /// The eleven desk-light rows and their documented ranges (3128-3145). Four of them start at
        /// 5 rather than 0 — `leds`, `chlcds`, `chedit` and `main` — and that minimum is the point of
        /// the test: the row is what the block prints, not a shared 0…100.
        #[test]
        fn the_desk_light_rows_keep_their_documented_ranges() {
            let rows: &[(&str, f32, f32)] = &[
                ("lights_btns", 0.0, 100.0),
                ("lights_leds", 5.0, 100.0),
                ("lights_meters", 0.0, 100.0),
                ("lights_rgbleds", 0.0, 100.0),
                ("lights_chlcds", 5.0, 100.0),
                ("lights_chlcdctr", 0.0, 100.0),
                ("lights_chedit", 5.0, 100.0),
                ("lights_main", 5.0, 100.0),
                ("lights_glow", 0.0, 100.0),
                ("lights_patch", 0.0, 100.0),
                ("lights_lamp", 0.0, 100.0),
            ];
            let mut starting_at_five = 0;
            for (key, min, max) in rows {
                let rule = watch_rule("lights", key)
                    .unwrap_or_else(|| panic!("lights/{key} is in the catalogue"));
                assert_eq!((rule.min, rule.max), (*min, *max), "lights/{key}");
                assert_eq!(
                    (rule.arg_kind, rule.value_kind),
                    ("int", "number"),
                    "lights/{key} is an integer leaf"
                );
                assert!(rule.unit.is_empty(), "lights/{key}: no unit is documented");
                assert!(value_problem("lights", key, &trim_number(*min)).is_none());
                assert!(value_problem("lights", key, "100").is_none());
                assert!(
                    value_problem("lights", key, "101").is_some(),
                    "lights/{key} stops at 100"
                );
                if *min > 0.0 {
                    starting_at_five += 1;
                    assert!(
                        value_problem("lights", key, "0").is_some(),
                        "lights/{key} has no off position: 0 is refused"
                    );
                } else {
                    assert!(value_problem("lights", key, "0").is_none());
                    assert!(value_problem("lights", key, "-1").is_some());
                }
            }
            assert_eq!(
                starting_at_five, 4,
                "leds, chlcds, chedit and main are the rows that start at 5 (3129, 3132, 3141, 3142)"
            );
            // The eleven rows are all of them: a tenth or a twelfth would have to be named here.
            assert_eq!(rows.len(), 11);
        }

        /// `/$stat/ppm` is the batch's one signed range (1274-1275): the clock deviation runs from
        /// -200 to 200, and the lock beside it is an on/off value. Both are watches.
        #[test]
        fn the_desk_ppm_goes_negative_and_the_lock_is_a_toggle() {
            let ppm = watch_rule("deskstatus", "desk_ppm").expect("ppm is in the catalogue");
            assert_eq!((ppm.min, ppm.max), (-200.0, 200.0), "Maillot 1275");
            assert_eq!((ppm.arg_kind, ppm.value_kind), ("int", "number"));
            assert_eq!(ppm.unit, "ppm");
            for accepted in ["-200", "-1", "0", "200"] {
                assert!(
                    value_problem("deskstatus", "desk_ppm", accepted).is_none(),
                    "{accepted} ppm is inside the documented range"
                );
            }
            for refused in ["-201", "201"] {
                assert!(
                    value_problem("deskstatus", "desk_ppm", refused).is_some(),
                    "{refused} ppm is outside the documented range"
                );
            }

            let lock = watch_rule("deskstatus", "desk_lock").expect("the lock is in the catalogue");
            assert_eq!(lock.value_kind, "toggle");
            assert_eq!((lock.min, lock.max), (0.0, 1.0));
            assert!(watch_problem("deskstatus", "desk_lock", "==", "1").is_none());
            assert!(watch_problem("deskstatus", "desk_lock", ">", "1").is_some());
        }

        /// The clock: two rates (4171), seven sources (4172-4173), the startup mute (4174) and the two
        /// bus configurations (4175-4186). The StageConnect list is the longest in the catalogue and
        /// is checked as a whole — `AUTO` plus every upstream/downstream split that adds up to 32.
        #[test]
        fn the_clock_option_lists_are_the_documented_ones() {
            let rate = watch_rule("globals", "global_clock_rate").expect("the rate is offered");
            assert_eq!(rate.options, &["48000.0", "44100.0"][..], "Maillot 4171");
            assert_eq!((rate.arg_kind, rate.value_kind), ("string", "enum"));
            assert!(value_problem("globals", "global_clock_rate", "48000.0").is_none());
            assert!(value_problem("globals", "global_clock_rate", "48000").is_some());
            assert!(value_problem("globals", "global_clock_rate", "96000.0").is_some());

            let source = watch_rule("globals", "global_clock_source").expect("the source is offered");
            assert_eq!(
                source.options,
                &["INT", "A", "B", "C", "AES", "CARD", "MOD"][..],
                "Maillot 4172-4173"
            );
            assert!(value_problem("globals", "global_clock_source", "MOD").is_none());
            assert!(value_problem("globals", "global_clock_source", "USB").is_some());

            let mute = watch_rule("globals", "global_start_mute").expect("the mute is offered");
            assert_eq!(mute.value_kind, "toggle", "Maillot 4174");

            let usb = watch_rule("globals", "global_usb_config").expect("the USB config is offered");
            assert_eq!(
                usb.options,
                &["2/2", "8/8", "16/16", "32/32", "48/48"][..],
                "Maillot 4175-4176"
            );

            let stage = watch_rule("globals", "global_stageconnect_config")
                .expect("the StageConnect config is offered");
            assert_eq!(stage.options.len(), 34, "AUTO plus the 33 splits (4177-4186)");
            assert_eq!(stage.options.first().copied(), Some("AUTO"));
            assert_eq!(stage.options.last().copied(), Some("32/0"));
            let mut upstreams = Vec::new();
            for option in stage.options.iter().filter(|option| **option != "AUTO") {
                let (up, down) = option
                    .split_once('/')
                    .unwrap_or_else(|| panic!("{option} is not an up/down split"));
                let up: u32 = up.parse().expect("an upstream count");
                let down: u32 = down.parse().expect("a downstream count");
                assert_eq!(up + down, 32, "{option} must split the 32 channels");
                upstreams.push(up);
            }
            upstreams.sort_unstable();
            assert_eq!(upstreams, (0..=32).collect::<Vec<u32>>(), "every split is listed once");
            assert!(value_problem("globals", "global_stageconnect_config", "16/16").is_none());
            assert!(value_problem("globals", "global_stageconnect_config", "16/17").is_some());
        }

        /// The W-Live transport: the four states (2968, 2991), the marker and session indices
        /// (2970-2977), the time in milliseconds with its `gotomarker 101` precondition (2978-2980),
        /// the 19-character session name and the two switches (2983-2984).
        #[test]
        fn the_wlive_option_list_and_ranges_are_the_documented_ones() {
            let control = watch_rule("wlive", "wlive_control").expect("the transport is offered");
            assert_eq!(control.options, &["STOP", "PPAUSE", "PLAY", "REC"][..], "Maillot 2968");
            assert!(value_problem("wlive", "wlive_control", "REC").is_none());
            assert!(
                value_problem("wlive", "wlive_control", "PAUSE").is_some(),
                "the document's pause is PPAUSE, not PAUSE"
            );
            assert_eq!(
                watch_rule("wlive", "wlive_state").map(|rule| rule.options),
                Some(&["STOP", "PPAUSE", "PLAY", "REC"][..]),
                "Maillot 2991"
            );

            for key in [
                "wlive_open_session",
                "wlive_marker_edit",
                "wlive_marker_delete",
                "wlive_session_delete",
            ] {
                let rule = watch_rule("wlive", key).unwrap_or_else(|| panic!("{key} is offered"));
                assert_eq!((rule.min, rule.max), (0.0, 100.0), "{key}");
                assert_eq!((rule.arg_kind, rule.value_kind), ("int", "number"), "{key}");
                assert!(value_problem("wlive", key, "0").is_none());
                assert!(value_problem("wlive", key, "100").is_none());
                assert!(value_problem("wlive", key, "101").is_some(), "{key} stops at 100");
            }

            let goto = watch_rule("wlive", "wlive_marker_goto").expect("goto is offered");
            assert_eq!((goto.min, goto.max), (0.0, 101.0), "Maillot 2974");
            assert!(value_problem("wlive", "wlive_marker_goto", "101").is_none());
            assert!(value_problem("wlive", "wlive_marker_goto", "102").is_some());
            assert!(
                goto.hint.contains("101"),
                "101 is not a marker, it validates the time: {}",
                goto.hint
            );

            let time = watch_rule("wlive", "wlive_time").expect("the time is offered");
            assert_eq!((time.min, time.max), (0.0, 36_000_000.0), "Maillot 2978");
            assert_eq!((time.arg_kind, time.value_kind, time.unit), ("float", "ms", "ms"));
            assert!(value_problem("wlive", "wlive_time", "36000000").is_none());
            // 37 million, not 36000001: the value is compared as an `f32`, whose spacing at 3.6e7 is
            // 4, so a one-step-over value would round back onto the documented maximum.
            assert!(value_problem("wlive", "wlive_time", "37000000").is_some());
            assert!(
                time.hint.contains("101") && time.hint.contains("ignored"),
                "the time only takes effect with a goto 101: {}",
                time.hint
            );

            let name = watch_rule("wlive", "wlive_session_name").expect("the name is offered");
            assert_eq!(name.max_len, 19, "Maillot 2981");
            assert!(value_problem("wlive", "wlive_session_name", &"+".repeat(19)).is_none());
            assert!(value_problem("wlive", "wlive_session_name", &"+".repeat(20)).is_some());
            assert!(
                name.hint.contains("STOP"),
                "naming works only in STOP mode: {}",
                name.hint
            );

            for key in ["wlive_marker_set", "wlive_format_card"] {
                assert_eq!(
                    watch_rule("wlive", key).map(|rule| rule.value_kind),
                    Some("toggle"),
                    "{key} (2983-2984)"
                );
            }
        }

        /// The monitor bus: the level rows (-144…10, 1024 steps), pan and width in percent, the six
        /// EQ bands with the shelf rows, the limiter, the delay in metres, the two 40…0 dims, the
        /// band solo trim and the two 37- and 77-entry source lists (1316-1378).
        #[test]
        fn the_monitor_bus_ranges_and_source_lists_are_the_documented_ones() {
            let range = |key: &str| {
                watch_rule("monbus", key)
                    .unwrap_or_else(|| panic!("monbus/{key} is in the catalogue"))
            };
            assert_eq!((range("monitor_pan").min, range("monitor_pan").max), (-100.0, 100.0), "1318");
            assert_eq!(range("monitor_pan").unit, "%");
            assert_eq!(
                (range("monitor_width").min, range("monitor_width").max),
                (-150.0, 150.0),
                "1319"
            );
            assert_eq!(
                (range("monitor_limiter").min, range("monitor_limiter").max),
                (-40.0, 0.0),
                "1361"
            );
            assert_eq!(
                (range("monitor_source_level").min, range("monitor_source_level").max),
                (-144.0, 10.0),
                "1369"
            );
            assert_eq!(
                (range("monitor_band_solo_trim").min, range("monitor_band_solo_trim").max),
                (0.0, 24.0),
                "1368"
            );
            // The two dims are printed `40..0` like the talkback ones: the range is 0…40 and 40 is
            // the most attenuation (1366-1367).
            for key in ["monitor_dim", "monitor_pfl_dim"] {
                assert_eq!((range(key).min, range(key).max), (0.0, 40.0), "{key}");
                assert!(value_problem("monbus", key, "40").is_none());
                assert!(value_problem("monbus", key, "41").is_some());
            }
            // The delay has no mode selector on this node: the unit is metres (1365).
            let delay = range("monitor_delay");
            assert_eq!((delay.min, delay.max, delay.unit), (0.1, 100.0, "m"));
            assert!(value_problem("monbus", "monitor_delay", "0.1").is_none());
            assert!(value_problem("monbus", "monitor_delay", "0").is_some());
            assert!(value_problem("monbus", "monitor_delay", "101").is_some());
            // The EQ: gains ±15, the low shelf 20…2000, the high shelf 50…20000, the bands 20…20000
            // and Q 0.44…10 (1323-1353).
            assert_eq!(
                (range("monitor_eq_low_gain").min, range("monitor_eq_low_gain").max),
                (-15.0, 15.0)
            );
            assert_eq!(
                (range("monitor_eq_low_freq").min, range("monitor_eq_low_freq").max),
                (20.0, 2000.0)
            );
            assert_eq!(
                (range("monitor_eq_high_freq").min, range("monitor_eq_high_freq").max),
                (50.0, 20000.0)
            );
            for band in 1..=6 {
                let gain = range(&format!("monitor_eq_{band}_gain"));
                let freq = range(&format!("monitor_eq_{band}_freq"));
                let q = range(&format!("monitor_eq_{band}_q"));
                assert_eq!((gain.min, gain.max, gain.unit), (-15.0, 15.0, "dB"), "band {band} gain");
                assert_eq!((freq.min, freq.max, freq.unit), (20.0, 20000.0, "Hz"), "band {band} freq");
                assert_eq!((q.min, q.max), (0.44, 10.0), "band {band} Q");
            }
            assert_eq!(range("monitor_tags").max_len, 80, "1378");

            // The source list is OFF, the four mains, the eight matrices, the sixteen buses and the
            // eight auxes (1371-1373); the direct input is a different list that opens with the forty
            // channels (1374-1376). A channel is not a source here, and a bus is not a direct input.
            let source = range("monitor_source");
            assert_eq!(source.options.len(), 37, "1 + 4 + 8 + 16 + 8");
            assert_eq!(source.options.first().copied(), Some("OFF"));
            for option in ["MAIN.4", "MTX.8", "BUS.16", "AUX.8"] {
                assert!(source.options.contains(&option), "the source list must hold {option}");
            }
            assert!(!source.options.contains(&"CH.1"));
            assert!(value_problem("monbus", "monitor_source", "BUS.7").is_none());
            assert!(value_problem("monbus", "monitor_source", "CH.7").is_some());

            let direct = range("monitor_direct_in");
            assert_eq!(direct.options.len(), 77, "1 + 40 + 8 + 16 + 4 + 8");
            for option in ["CH.1", "CH.40", "AUX.8", "BUS.16", "MAIN.4", "MTX.8"] {
                assert!(direct.options.contains(&option), "the direct list must hold {option}");
            }
            assert!(value_problem("monbus", "monitor_direct_in", "CH.40").is_none());
            assert!(value_problem("monbus", "monitor_direct_in", "CH.41").is_some());
        }

        /// The solo configuration: three modes (1381), three monitor destinations (1382), the same
        /// two taps on all four families (1387-1390) and the source-solo value (1391) with the three
        /// strings the block prints. The read-back trio keeps its documented bounds (1393-1394).
        #[test]
        fn the_solo_option_lists_are_the_documented_ones() {
            let rule = |key: &str| {
                watch_rule("solocfg", key)
                    .unwrap_or_else(|| panic!("solocfg/{key} is in the catalogue"))
            };
            assert_eq!(rule("solo_mode").options, &["LIVE", "STUDIO", "SIP"][..], "1381");
            assert_eq!(rule("solo_monitor").options, &["PH", "SPK", "PH+SPK"][..], "1382");
            for key in [
                "solo_channel_tap",
                "solo_bus_tap",
                "solo_main_tap",
                "solo_matrix_tap",
            ] {
                assert_eq!(rule(key).options, &["PFL", "AFL"][..], "{key} (1387-1390)");
                assert!(value_problem("solocfg", key, "POST").is_some());
            }
            assert_eq!(
                rule("solo_source").options,
                &["OFF", "CH39", "AUX7"][..],
                "the row prints exactly these three (1391)"
            );
            assert!(
                rule("solo_source").hint.contains("CH39") && rule("solo_source").hint.contains("$srcsgrp"),
                "the hint must say what the three are and where the real state is reported: {}",
                rule("solo_source").hint
            );
            assert_eq!(
                (rule("solo_source_group").min, rule("solo_source_group").max),
                (1.0, 13.0),
                "1393"
            );
            assert_eq!(
                (rule("solo_source_input").min, rule("solo_source_input").max),
                (1.0, 64.0),
                "1394"
            );
            assert!(value_problem("solocfg", "solo_source_group", "13").is_none());
            assert!(value_problem("solocfg", "solo_source_group", "14").is_some());
            assert!(value_problem("solocfg", "solo_source_input", "64").is_none());
            assert!(value_problem("solocfg", "solo_source_input", "65").is_some());
        }

        /// Every safes leaf keeps the length its own row documents (4017-4067): the masks are not one
        /// shared length, they are 40 for the channels, 48 for an AES50 port's inputs, 64 for the card
        /// and the module, 2 for AES/EBU and the oscillator, and so on down to the 3-character setup
        /// mask. The string is `+` or space, so a `+` mask of exactly `max_len` is the longest value
        /// the console takes.
        #[test]
        fn the_safes_leaves_keep_their_documented_length() {
            let lengths: &[(&str, u16)] = &[
                ("safes_ch", 40),
                ("safes_aux", 8),
                ("safes_bus", 16),
                ("safes_main", 4),
                ("safes_mtx", 8),
                ("safes_dca", 16),
                ("safes_mute", 8),
                ("safes_fx", 16),
                ("safes_source_lcl", 24),
                ("safes_source_aux", 8),
                ("safes_source_a", 48),
                ("safes_source_b", 48),
                ("safes_source_c", 48),
                ("safes_source_sc", 32),
                ("safes_source_usb", 48),
                ("safes_source_crd", 64),
                ("safes_source_mod", 64),
                ("safes_source_play", 4),
                ("safes_source_aes", 2),
                ("safes_source_usr", 48),
                ("safes_source_osc", 2),
                ("safes_output_lcl", 8),
                ("safes_output_aux", 8),
                ("safes_output_a", 48),
                ("safes_output_b", 48),
                ("safes_output_c", 48),
                ("safes_output_sc", 32),
                ("safes_output_usb", 48),
                ("safes_output_crd", 64),
                ("safes_output_mod", 64),
                ("safes_output_rec", 4),
                ("safes_output_aes", 2),
                ("safes_area_left", 7),
                ("safes_area_center", 6),
                ("safes_area_right", 7),
                ("safes_area_compact", 9),
                ("safes_area_rack", 5),
                ("safes_area_extern", 8),
                ("safes_area_virtual", 8),
                ("safes_custom", 31),
                ("safes_setup", 3),
            ];
            let offered = target_parameters_for_category("safes");
            let watched = trigger_parameters_for_category("safes");
            assert_eq!(offered.len(), 41, "the node documents forty-one rows");
            for (key, max_len) in lengths {
                let rule = watch_rule("safes", key)
                    .unwrap_or_else(|| panic!("safes/{key} is in the catalogue"));
                assert_eq!(rule.max_len, *max_len, "safes/{key}");
                assert_eq!(
                    (rule.arg_kind, rule.value_kind),
                    ("string", "text"),
                    "safes/{key} is a string of `+` or space"
                );
                assert!(
                    rule.hint.contains("`+`"),
                    "safes/{key} must say what the alphabet is: {}",
                    rule.hint
                );
                let longest = "+".repeat(usize::from(*max_len));
                assert!(
                    value_problem("safes", key, &longest).is_none(),
                    "safes/{key} takes {max_len} characters"
                );
                assert!(
                    value_problem("safes", key, &format!("{longest}+")).is_some(),
                    "safes/{key} stops at {max_len} characters"
                );
                // The two forms of "nothing": an empty field and a mask of spaces. The document
                // gives one character per item (`+` or space) and no clear form, so both are
                // refused, and the messages tell the operator which one they typed. Without this an
                // empty value slipped past the step check (the exemption is for an address-only
                // write) and `,s ""` went out unverified.
                let empty = value_problem("safes", key, "").expect("an empty mask is not a value");
                assert!(empty.contains("needs a value"), "safes/{key}: {empty}");
                let spaces = value_problem("safes", key, &" ".repeat(usize::from(*max_len)))
                    .expect("a mask of spaces is not a value");
                assert!(
                    spaces.contains("character per item"),
                    "safes/{key} must explain the alphabet: {spaces}"
                );
                // Both halves: a safes mask is written by a step and reported to a watch.
                assert!(offered.iter().any(|parameter| parameter.key == *key));
                assert!(watched.iter().any(|parameter| parameter.key == *key));
            }
            assert_eq!(lengths.len(), 41, "no row may be left out of this table");
        }

        /// The caveats the hints have to carry, because they are the difference between a macro that
        /// works and one the console ignores without a word: footnote 13's read-only monitor level,
        /// the `gotomarker 101` that validates a W-Live time, the STOP mode a session name needs, the
        /// extraction space in three safes rows and the `outpu/A` typo.
        #[test]
        fn the_desk_level_hints_carry_the_documented_caveats() {
            let hint = |category: &str, key: &str| {
                watch_rule(category, key)
                    .unwrap_or_else(|| panic!("{category}/{key} is in the catalogue"))
                    .hint
            };
            assert!(hint("monbus", "monitor_level").contains("footnote 13"));
            assert!(hint("monbus", "monitor_active_level").contains("[RO]"));
            assert!(hint("aes50", "aes50_state").contains("[RO]"));
            assert!(hint("aes50", "aes50_errors_uncorrected").contains("[RO]"));
            assert!(hint("wlive", "wlive_time").contains("101"));
            assert!(hint("wlive", "wlive_session_name").contains("STOP"));
            assert!(hint("wlive", "wlive_marker_edit").contains("PAUSE"));
            assert!(hint("wlive", "wlive_format_card").contains("Destructive"));
            assert!(hint("lights", "lights_leds").contains("5…100"));
            assert!(hint("lights", "lights_chedit").contains("3141"));
            assert!(hint("safes", "safes_output_a").contains("outpu/A"));
            assert!(hint("safes", "safes_area_right").contains("space"));
            assert!(hint("solocfg", "solo_source").contains("AUX7"));
            assert!(hint("deskstatus", "desk_lock").contains("[RO]"));
            assert!(hint("cards", "cards_type").contains("WLIVE"));
        }

        /// The two families this batch deliberately leaves out: `/$ctl/midi/*` (4089-4097) and
        /// `/$ctl/$globals/*` (4128-4145) are desk preferences — which port MIDI control comes from,
        /// fader resolution, mouse speed, the auto-save switch — and a show macro has no business
        /// changing them mid-show. The sweep ranked them last, and they stay in `docs/MACRO_TARGET_
        /// COVERAGE.md` §7 with that reason: there is no category for either node here, so a key of
        /// theirs resolves to nothing.
        #[test]
        fn the_deferred_desk_preference_families_stay_absent() {
            for category in target_categories() {
                assert!(
                    !category.prefix.starts_with("/$ctl/midi"),
                    "{} would offer the MIDI preferences",
                    category.key
                );
                assert!(
                    !category.prefix.starts_with("/$ctl/$globals"),
                    "{} would offer the console preferences",
                    category.key
                );
            }
            // Their documented keys resolve to nothing, under both names a caller might try: the
            // catalogue has one node per address, and the clock node is `/$globals`, not
            // `/$ctl/$globals`.
            for key in ["enchctl", "enmidicc", "enscenes", "fdrsel", "fdrres", "timefmt", "savenow"] {
                assert!(watch_rule("globals", key).is_none(), "{key} must stay out");
                assert!(
                    resolve_basic_addresses(&target("globals", "1", key)).is_empty(),
                    "{key} must not resolve"
                );
            }
            assert_eq!(prefix_for_category("globals"), Some("/$globals"));

            // The clock node's own two sub-nodes stay out as well, and for a different reason: the HA
            // remote and the custom sync are letter-indexed children (`/$globals/harmt/<A|B|C>`,
            // 4188-4191, and `/$globals/custsync/<a|b|c>`, 4193-4196) that the batch's frozen key list
            // does not name, and they are desk wiring rather than a cue. Five keys, five addresses,
            // none of them under a sub-node.
            let addresses = target_parameters_for_category("globals")
                .iter()
                .flat_map(|parameter| {
                    resolve_basic_addresses(&target("globals", "1", parameter.key))
                })
                .collect::<Vec<_>>();
            assert_eq!(addresses.len(), 5, "{addresses:?}");
            for address in addresses {
                assert!(
                    !address.contains("/harmt/") && !address.contains("/custsync/"),
                    "{address} is a sub-node this batch does not offer"
                );
            }
        }
    }
}

pub mod meters {
    use std::fmt;

    use crate::DeskModel;

    pub const NATIVE_FRAME_PREFIX: [u8; 2] = [0xdf, 0xd3];
    pub const TOKEN_LISTEN_PORT: u8 = 0xd3;
    pub const TOKEN_REPORT_ID: u8 = 0xd4;
    pub const TOKEN_COLLECTION_START: u8 = 0xdc;
    pub const TOKEN_COLLECTION_END: u8 = 0xde;

    pub const TOKEN_CH: u8 = 0xa0;
    pub const TOKEN_AUX: u8 = 0xa1;
    pub const TOKEN_BUS: u8 = 0xa2;
    pub const TOKEN_MAIN: u8 = 0xa3;
    pub const TOKEN_MATRIX: u8 = 0xa4;
    pub const TOKEN_DCA: u8 = 0xa5;
    pub const TOKEN_FX: u8 = 0xa6;
    pub const TOKEN_SOURCE: u8 = 0xa7;
    pub const TOKEN_OUTPUT: u8 = 0xa8;
    pub const TOKEN_MONITOR: u8 = 0xa9;
    pub const TOKEN_RTA: u8 = 0xaa;
    pub const TOKEN_CH_V2: u8 = 0xab;
    pub const TOKEN_AUX_V2: u8 = 0xac;
    pub const TOKEN_BUS_V2: u8 = 0xad;
    pub const TOKEN_MAIN_V2: u8 = 0xae;
    pub const TOKEN_MATRIX_V2: u8 = 0xaf;
    pub const SOURCE_USB_DEVICE_ID: u8 = 7;
    pub const OUTPUT_USB_DEVICE_ID: u8 = 7;

    #[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord)]
    pub enum MeterFamily {
        Ch,
        Aux,
        Bus,
        Main,
        Matrix,
        Dca,
        Fx,
        Source,
        Output,
        Monitor,
        Rta,
        ChV2,
        AuxV2,
        BusV2,
        MainV2,
        MatrixV2,
    }

    impl MeterFamily {
        pub fn token(self) -> u8 {
            match self {
                MeterFamily::Ch => TOKEN_CH,
                MeterFamily::Aux => TOKEN_AUX,
                MeterFamily::Bus => TOKEN_BUS,
                MeterFamily::Main => TOKEN_MAIN,
                MeterFamily::Matrix => TOKEN_MATRIX,
                MeterFamily::Dca => TOKEN_DCA,
                MeterFamily::Fx => TOKEN_FX,
                MeterFamily::Source => TOKEN_SOURCE,
                MeterFamily::Output => TOKEN_OUTPUT,
                MeterFamily::Monitor => TOKEN_MONITOR,
                MeterFamily::Rta => TOKEN_RTA,
                MeterFamily::ChV2 => TOKEN_CH_V2,
                MeterFamily::AuxV2 => TOKEN_AUX_V2,
                MeterFamily::BusV2 => TOKEN_BUS_V2,
                MeterFamily::MainV2 => TOKEN_MAIN_V2,
                MeterFamily::MatrixV2 => TOKEN_MATRIX_V2,
            }
        }

        pub fn value_count(self) -> usize {
            match self {
                MeterFamily::Ch
                | MeterFamily::Aux
                | MeterFamily::Bus
                | MeterFamily::Main
                | MeterFamily::Matrix => 8,
                MeterFamily::ChV2
                | MeterFamily::AuxV2
                | MeterFamily::BusV2
                | MeterFamily::MainV2
                | MeterFamily::MatrixV2 => 11,
                MeterFamily::Dca => 4,
                MeterFamily::Fx => 10,
                _ => 1,
            }
        }

        pub fn token_has_no_indices(self) -> bool {
            matches!(self, MeterFamily::Monitor | MeterFamily::Rta)
        }

        /// Suscripciones `* V2` (Maillot 3.1.0, tabla 5).
        pub fn is_v2(self) -> bool {
            matches!(
                self,
                MeterFamily::ChV2
                    | MeterFamily::AuxV2
                    | MeterFamily::BusV2
                    | MeterFamily::MainV2
                    | MeterFamily::MatrixV2
            )
        }
    }

    /// How many words one reply group of a descriptor holds.
    ///
    /// Maillot's Channel 3 reply is a bare concatenation of groups — `<report id (4 bytes)><Meter Data
    /// (n words)>` (4455) — with no length and no separator between them, so the only thing that
    /// keeps a frame aligned is knowing each group's word count. A group read one word short
    /// silently shifts every group after it in the same datagram.
    #[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
    pub enum GroupWords {
        /// The descriptor names its own indices (a `Ch` subscription, or the indexed form of a
        /// source probe) and the console answers exactly those, in order.
        PerIndex,
        /// A source or output device group whose length the desk has settled: exactly this many
        /// words, all of them or none. Below this many the frame is truncated, never re-read at a
        /// guessed boundary.
        Fixed(usize),
        /// A source or output device group whose length the document ties to the console model and
        /// the model is not known. The decoder stops at it — the groups that follow are lost, and
        /// that is the point: they would be *wrong* otherwise, and a wrong meter fires macros.
        NotSettled,
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct MeterDescriptor {
        pub family: MeterFamily,
        pub indices: Vec<u8>,
        pub device_id: Option<u8>,
        /// The group length this descriptor's reply is decoded with. See [`GroupWords`].
        pub group_words: GroupWords,
    }

    impl MeterDescriptor {
        pub fn indexed(family: MeterFamily, indices_one_based: impl Into<Vec<u8>>) -> Self {
            Self {
                family,
                indices: indices_one_based.into(),
                device_id: None,
                group_words: GroupWords::PerIndex,
            }
        }

        /// A whole source device group, with the length the family table gives it. It is the form the
        /// probes and the self-tests use; a *live* subscription knows the desk's model and asks
        /// [`MeterDescriptor::source_for_model`] instead.
        pub fn source(device_id: u8) -> Self {
            Self {
                family: MeterFamily::Source,
                indices: Vec::new(),
                device_id: Some(device_id),
                group_words: group_words_for_unknown_model(Device::Source, device_id),
            }
        }

        /// The whole `0xa7` group of one source device, sized by the model the desk announced.
        pub fn source_for_model(model: DeskModel, device_id: u8) -> Self {
            Self {
                family: MeterFamily::Source,
                indices: Vec::new(),
                device_id: Some(device_id),
                group_words: match source_group_words(model, device_id) {
                    Some(words) => GroupWords::Fixed(words),
                    None => GroupWords::NotSettled,
                },
            }
        }

        /// The same, for a descriptor that names the indices it wants: the count is the list's own
        /// length, so no model enters into it.
        pub fn source_with_indices(device_id: u8, indices_one_based: impl Into<Vec<u8>>) -> Self {
            Self {
                family: MeterFamily::Source,
                indices: indices_one_based.into(),
                device_id: Some(device_id),
                group_words: GroupWords::PerIndex,
            }
        }

        pub fn output(device_id: u8) -> Self {
            Self {
                family: MeterFamily::Output,
                indices: Vec::new(),
                device_id: Some(device_id),
                group_words: group_words_for_unknown_model(Device::Output, device_id),
            }
        }

        /// The whole `0xa8` group of one output device, sized by the model the desk announced.
        pub fn output_for_model(model: DeskModel, device_id: u8) -> Self {
            Self {
                family: MeterFamily::Output,
                indices: Vec::new(),
                device_id: Some(device_id),
                group_words: match output_group_words(model, device_id) {
                    Some(words) => GroupWords::Fixed(words),
                    None => GroupWords::NotSettled,
                },
            }
        }

        pub fn output_with_indices(device_id: u8, indices_one_based: impl Into<Vec<u8>>) -> Self {
            Self {
                family: MeterFamily::Output,
                indices: indices_one_based.into(),
                device_id: Some(device_id),
                group_words: GroupWords::PerIndex,
            }
        }

        /// The same descriptor, sized for the desk's model. Everything that is not a source or an
        /// output group is untouched: only those two families carry a whole-group reply whose length
        /// the model decides.
        pub fn for_model(&self, model: DeskModel) -> Self {
            match (self.family, self.device_id, self.indices.is_empty()) {
                (MeterFamily::Source, Some(device_id), true) => {
                    Self::source_for_model(model, device_id)
                }
                (MeterFamily::Output, Some(device_id), true) => {
                    Self::output_for_model(model, device_id)
                }
                _ => self.clone(),
            }
        }
    }

    /// Which of the two device tables a group length is read from.
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub enum Device {
        Source,
        Output,
    }

    /// The group length the family table gives a device when no model is known. Device 1 is the one
    /// the table cannot answer for (8 or 24, footnote 17), so a descriptor built without a model
    /// says so instead of picking one (`GroupWords::NotSettled`).
    fn group_words_for_unknown_model(device: Device, device_id: u8) -> GroupWords {
        match device {
            Device::Source => match source_group_words(DeskModel::Unknown, device_id) {
                Some(words) => GroupWords::Fixed(words),
                None => GroupWords::NotSettled,
            },
            Device::Output => match output_group_words(DeskModel::Unknown, device_id) {
                Some(words) => GroupWords::Fixed(words),
                None => GroupWords::NotSettled,
            },
        }
    }

    #[derive(Clone, Debug, PartialEq)]
    pub struct DecodedMeterEvent {
        pub descriptor_index: usize,
        pub family: MeterFamily,
        pub device_id: Option<u8>,
        pub index: u8,
        pub raw_values: Vec<i16>,
        pub values: Vec<f32>,
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum DecodeError {
        PacketTooShort { len: usize },
    }

    impl fmt::Display for DecodeError {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            match self {
                DecodeError::PacketTooShort { len } => {
                    write!(f, "meter packet too short: {len} bytes")
                }
            }
        }
    }

    impl std::error::Error for DecodeError {}

    /// The largest group a source device of this family can send, in 2-byte words.
    ///
    /// It is a **bound**, never a decode length: device 1 is the one group whose size the document
    /// ties to the model (8 on the full-size console, 24 on a Rack or a Compact — 344, 402, 421, 448
    /// and footnote 17 at 1641), so the table carries the family maximum and every reader that has
    /// to know how many words the console really puts in the group asks [`source_group_words`] with
    /// the model it learned from discovery instead (master plan 2026-09-22, §5.1 item 2).
    ///
    /// Everything from device 2 on is a property of the hardware behind the node rather than of the
    /// surface — 48 per AES50 port, 64 for a card, 2 for the AES/EBU pair — and the values below are
    /// the ones the tree has always used. **Measured on a WING Rack, 2026-09-27** (read-only probes,
    /// a parent node read answers the child keys): the local group is 24 (device 1), the auxiliary
    /// group 8 (device 2), AES50-A 48 (device 3), StageConnect 32 (device 6), USB 48 (device 7), the
    /// card 64 (device 8), the module 64 (device 9), the player 4 (device 10), the AES/EBU pair 2
    /// (device 11), the user signals 56 (device 12) and the oscillator 2 (device 13) — every value
    /// below that a `/io/in` group sizes, confirmed key by key. The output side was measured the
    /// same day: local 8, AES50-A 48, USB 48, card 64, module 64.
    ///
    /// What remains unmeasured keeps the document and says so: the **full-size** console's
    /// eight-value local group (device 1 with [`DeskModel::Full`] — the document's 344 and footnote
    /// 17, which no desk here can answer), the AES50-B and -C groups, the bus/main/matrix source
    /// groups (devices 14-16) and the output aux, B, C, StageConnect, REC and AES groups. A wrong
    /// one now costs a truncated frame instead of a shifted one.
    pub fn source_device_meter_count(device_id: u8) -> usize {
        match device_id {
            1 => 24,
            2 => 8,
            3 => 48,
            4 => 48,
            5 => 48,
            6 => 32,
            SOURCE_USB_DEVICE_ID => 48,
            8 => 64,
            9 => 64,
            10 => 4,
            11 => 2,
            12 => 56,
            13 => 2,
            14 => 32,
            15 => 8,
            16 => 16,
            _ => 0,
        }
    }

    pub fn output_device_meter_count(device_id: u8) -> usize {
        match device_id {
            1 => 8,
            2 => 8,
            3 => 48,
            4 => 48,
            5 => 48,
            6 => 32,
            OUTPUT_USB_DEVICE_ID => 48,
            8 => 64,
            9 => 64,
            10 => 4,
            11 => 2,
            _ => 0,
        }
    }

    /// How many words one `0xa7` reply group of this source device carries **on this desk**.
    ///
    /// Maillot's table 5 describes a source group as "source group levels (i.e. local ins: 8
    /// meters)" (4478) — eight, the full-size console — and footnote 17 (1641) is the warning that
    /// the number is not the same on every device of the family: *"All 24 local inputs may not be
    /// available depending on the console model"*. The groups are concatenated in the datagram in
    /// request order (4455-4460), so a group read with the wrong length does not only spoil its own
    /// meters: every group after it in the same frame is read at the wrong offset.
    ///
    /// `None` means the document ties the length to the model and the desk has not announced one. It
    /// is not an error and it is not a licence to guess: the decoder truncates the frame there
    /// (`MeterDescriptor::group_words`), which loses the groups that follow instead of inventing
    /// values for them.
    pub fn source_group_words(model: DeskModel, device_id: u8) -> Option<usize> {
        match device_id {
            // Local inputs: the one source group the document sizes by model. Measured on a WING
            // Rack, 2026-09-27: the group is 24 there, which is what `local_inputs` answers for it.
            // The full-size console's eight-value group is the document's (344 and footnote 17) and
            // stays **unmeasured** — no such desk here — so it is the model and never the bench unit
            // that decides.
            1 => model.local_inputs().map(usize::from),
            // Aux inputs: the documented group of 8, **settled on 2026-09-27** — a WING Rack's
            // `/io/in` answered its AUX group with eight values, the documented number, even though
            // the two smaller models are the ones with "No local Aux IO" (422, 449). The node prints
            // no model note, so the model is still not consulted here: the document and the
            // measurement agree on eight.
            2 => Some(8),
            // The rest are the hardware table, confirmed key by key on the same desk and the same
            // day for the groups it lists; what it did not list keeps the document (see
            // [`source_device_meter_count`]). 0 means "the document lists no such device".
            id => match source_device_meter_count(id) {
                0 => None,
                count => Some(count),
            },
        }
    }

    /// The output half of [`source_group_words`] (`0xa8`). `/io/out/LCL/1` prints `1..8` with no
    /// model note (1843) and the Rack maps four headphone outputs onto those same eight (423-424),
    /// so the local output group is a property of the family; table 5 says "output group levels
    /// (i.e. local outs: 8 meters)" (4479).
    pub fn output_group_words(model: DeskModel, device_id: u8) -> Option<usize> {
        match device_id {
            // Not model-dependent, unlike the input side: the document sizes the local output node
            // once and the Rack maps its four headphone outputs onto the same eight, so the model is
            // read for symmetry with `local_outputs` and the answer is the family's eight even when
            // the desk has announced no model. The parameter stays because a future model that
            // changed it would have to be answered here.
            1 => model.local_outputs().map(usize::from).or(Some(8)),
            id => match output_device_meter_count(id) {
                0 => None,
                count => Some(count),
            },
        }
    }

    pub fn native_frame(payload: &[u8]) -> Vec<u8> {
        // The channel selection itself is written straight to the wire (`0xdf, 0xd0 + channel`, Maillot
        // 4295-4296); only the payload is escaped.
        let escaped = escape_payload(payload);
        let mut frame = Vec::with_capacity(NATIVE_FRAME_PREFIX.len() + escaped.len());
        frame.extend_from_slice(&NATIVE_FRAME_PREFIX);
        frame.extend_from_slice(&escaped);
        frame
    }

    /// The channel selection's introducer (Maillot 4245-4246: `0xdf, 0xd<ChID>`): a literal `0xdf` in
    /// the data would otherwise be read as the start of one, which is why the protocol escapes it.
    pub const ESCAPE_CODE: u8 = 0xdf;
    /// What a literal escape is written as (Maillot 4268, 4307, 4315: `NRP_ESCAPE_CODE - 1`).
    pub const ESCAPED_ESCAPE_CODE: u8 = 0xde;
    /// The first channel-selection byte and how many channel ids there are (Maillot 4258-4259:
    /// `NRP_CHANNEL_ID_BASE 0xd0`, `NRP_NUM_CHANNELS 14`), so the ids are `0xd0…0xdd`.
    pub const CHANNEL_ID_BASE: u8 = 0xd0;
    pub const NUM_CHANNELS: u8 = 14;

    /// Maillot's transmit rule for the native/binary protocol (4287-4316): what a payload must look
    /// like on the wire.
    ///
    /// "When communicating with WING, the escape byte 0xdf should be handled carefully" (4249-4251).
    /// A literal `0xdf` is written as `0xdf 0xde`; and because `0xdf 0xd<ChID>` means "select channel",
    /// a data byte in the channel-id range right after a literal escape has the escape closed first
    /// (`0xdf 0xde` then the byte, 4299-4312). The document's own example is the receive half of the
    /// same pair: `D702DFDEAF0E02` represents `D702DFAF0E02` (4284).
    ///
    /// This is what keeps a request whose listen port lands in `0xDFD0…0xDFDE` — or a report id
    /// containing `0xdf` — from being read as a channel selection by the console.
    ///
    /// Measured on hardware (WING Rack, FW 3.1.1, meter subscription only): a request whose report id
    /// is `0xDFD30000` is answered when it goes out escaped, and the *same* request written raw is
    /// never answered at all — the desk reads the unescaped `0xdf 0xd3` as a channel selection and the
    /// rest of the collection is lost. So the escape is required on this side, not decorative.
    pub fn escape_payload(payload: &[u8]) -> Vec<u8> {
        let mut wire = Vec::with_capacity(payload.len());
        let mut escaped = false;
        for &byte in payload {
            if byte == ESCAPE_CODE {
                escaped = true;
                wire.push(byte);
                continue;
            }
            if escaped && (CHANNEL_ID_BASE..=ESCAPED_ESCAPE_CODE).contains(&byte) {
                wire.push(ESCAPED_ESCAPE_CODE);
            }
            escaped = false;
            wire.push(byte);
        }
        if escaped {
            wire.push(ESCAPED_ESCAPE_CODE);
        }
        wire
    }

    /// The receive half of the same rule (4261-4280): the data a channel stream really carries.
    ///
    /// `0xdf 0xde` is a literal `0xdf`, `0xdf 0xd0…0xdd` is a channel selection (framing, never data,
    /// 4269-4274), `0xdf 0xdf` keeps the stream escaped and yields one `0xdf` (4273-4275), and any
    /// other byte after an escape means the escape was data after all. The channel selections are
    /// dropped, because they are not part of the payload a caller decodes.
    ///
    /// A datagram body is the other shape: "Meter Data Packet Structure := <report id (4 bytes)><Meter
    /// Data (n words)>" (4455), with the values coded as plain big-endian words (4407), so
    /// [`decode_report`] takes the body as it arrives and a caller reading a *channel stream* passes it
    /// through here first.
    ///
    /// The desk was asked directly (WING Rack, FW 3.1.1, meter subscription only): a subscription whose
    /// report id is `0xDFD30000` comes back with those four bytes *raw* (`df d3 00 00`), every datagram
    /// exactly `4 + 48·2 = 100` bytes and no `0xdf 0xde` pair in 63 of them. The console therefore does
    /// not escape this body, and unescaping it here would corrupt a meter whose value holds `0xdf`.
    pub fn unescape_payload(wire: &[u8]) -> Vec<u8> {
        let mut data = Vec::with_capacity(wire.len());
        let mut escaped = false;
        for &byte in wire {
            if byte == ESCAPE_CODE && !escaped {
                escaped = true;
                continue;
            }
            if escaped {
                if byte == ESCAPE_CODE {
                    data.push(ESCAPE_CODE);
                    continue;
                }
                escaped = false;
                if byte == ESCAPED_ESCAPE_CODE {
                    data.push(ESCAPE_CODE);
                    continue;
                }
                if (CHANNEL_ID_BASE..CHANNEL_ID_BASE + NUM_CHANNELS).contains(&byte) {
                    continue;
                }
                data.push(ESCAPE_CODE);
            }
            data.push(byte);
        }
        data
    }

    pub fn renew_payload(report_id: u32) -> Vec<u8> {
        let mut payload = Vec::with_capacity(5);
        payload.push(TOKEN_REPORT_ID);
        payload.extend_from_slice(&report_id.to_be_bytes());
        payload
    }

    pub fn request_payload(
        listen_port: u16,
        report_id: u32,
        descriptors: &[MeterDescriptor],
    ) -> Vec<u8> {
        let mut payload = Vec::new();
        payload.push(TOKEN_LISTEN_PORT);
        payload.extend_from_slice(&listen_port.to_be_bytes());
        payload.push(TOKEN_REPORT_ID);
        payload.extend_from_slice(&report_id.to_be_bytes());
        payload.push(TOKEN_COLLECTION_START);

        let mut source_token_added = false;
        let mut output_token_added = false;

        for descriptor in descriptors {
            match descriptor.family {
                // Maillot Channel 3 source/output groups use token `0xa7`/`0xa8`
                // once, followed by zero-based device bytes (`0x00..0x0f` for
                // logical devices 1..16) in stable request/decode order.
                MeterFamily::Source => {
                    if !source_token_added {
                        payload.push(TOKEN_SOURCE);
                        source_token_added = true;
                    }
                    if let Some(device_id) = descriptor.device_id {
                        payload.push(device_id.saturating_sub(1));
                    }
                }
                MeterFamily::Output => {
                    if !output_token_added {
                        payload.push(TOKEN_OUTPUT);
                        output_token_added = true;
                    }
                    if let Some(device_id) = descriptor.device_id {
                        payload.push(device_id.saturating_sub(1));
                    }
                }
                family if family.token_has_no_indices() => {
                    payload.push(family.token());
                }
                family => {
                    payload.push(family.token());
                    for index in &descriptor.indices {
                        payload.push(index.saturating_sub(1));
                    }
                }
            }
        }

        payload.push(TOKEN_COLLECTION_END);
        payload
    }

    /// Scale of a meter value, according to Maillot's 3.1.0 document.
    ///
    /// - `* V2` subscriptions return 11 values (table 5, lines 4487-4497). Slots 6 (`gate led`) and
    ///   9 (`dyn state`) are **booleans**: *"Gate LED and Dyn State in `* V2` subscriptions return a
    ///   value of 0 or 1"* (lines 4415-4416 and 5619-5620). They were falling into the general
    ///   division by 256, so a `1` read as 0.0039 and a condition `== 1` — the default value in the
    ///   interface — never came true.
    /// - An FX subscription returns 4 levels and 6 "state meters" (lines 4413-4414): the four levels
    ///   are in 1/256 dB like any other level (line 4407) and the band gain reduction — the first 5
    ///   state meters — uses `value * 6.0 / 2048.0` (line 5674). The `×6/2048` scale was being
    ///   applied to the 4 levels, which came out 6/8 = 0.75 times too small.
    pub fn normalize_meter_value(raw_value: i16, family: MeterFamily, slot_index: usize) -> f32 {
        if family.is_v2() && matches!(slot_index, 6 | 9) {
            return raw_value as f32;
        }
        if family == MeterFamily::Fx && (4..9).contains(&slot_index) {
            round_2((raw_value as f32 * 6.0) / 2048.0)
        } else {
            round_2(raw_value as f32 / 256.0)
        }
    }

    /// Decodes one meter report: `<report id (4 bytes)><Meter Data (n words)>` (Maillot 4455), the
    /// values plain big-endian words in 1/256 dB (4407).
    ///
    /// `packet` is that body as it arrives. A caller reading a *channel stream* instead — the framing
    /// whose `0xdf` escape the document spells out at 4261-4280 — passes it through
    /// [`unescape_payload`] first, because a literal escape byte grows the stream and every value
    /// after it would otherwise be read one byte out of step.
    pub fn decode_report(
        report_id: u32,
        active_request: &[MeterDescriptor],
        packet: &[u8],
    ) -> Result<Vec<DecodedMeterEvent>, DecodeError> {
        if packet.len() < 4 {
            return Err(DecodeError::PacketTooShort { len: packet.len() });
        }

        let packet_report_id = u32::from_be_bytes([packet[0], packet[1], packet[2], packet[3]]);
        if packet_report_id != report_id {
            return Ok(Vec::new());
        }

        let mut offset = 4;
        let mut events = Vec::new();

        'descriptors: for (descriptor_index, descriptor) in active_request.iter().enumerate() {
            let value_count = descriptor.family.value_count();
            let Some(decode_indices) =
                resolve_decode_indices(active_request, descriptor_index, offset, packet.len())
            else {
                // The frame does not carry this group as the desk sizes it: either it ends here or
                // the subscription asked for something this model does not send. Nothing after this
                // point belongs to a boundary we know, so the frame is cut — the events already
                // decoded are kept, and no value is invented from a shifted offset.
                break 'descriptors;
            };

            for index in decode_indices {
                if offset + value_count * 2 > packet.len() {
                    // The datagram ends in the middle of this group: either it ended right here
                    // (everything consumed) or it is short. It used to break only the inner loop and
                    // the next descriptor was decoded from a boundary that was no longer its own, so
                    // the rest of the frame came out misaligned and without any error — false values
                    // that also evaluate macro triggers —. The events already decoded are fine: the
                    // whole frame is cut short and they are kept.
                    break 'descriptors;
                }

                let mut raw_values = Vec::with_capacity(value_count);
                let mut values = Vec::with_capacity(value_count);
                for slot_index in 0..value_count {
                    let raw_value = i16::from_be_bytes([packet[offset], packet[offset + 1]]);
                    offset += 2;
                    raw_values.push(raw_value);
                    values.push(normalize_meter_value(
                        raw_value,
                        descriptor.family,
                        slot_index,
                    ));
                }

                events.push(DecodedMeterEvent {
                    descriptor_index,
                    family: descriptor.family,
                    device_id: descriptor.device_id,
                    index,
                    raw_values,
                    values,
                });
            }
        }

        Ok(events)
    }

    fn resolve_decode_indices(
        active_request: &[MeterDescriptor],
        descriptor_index: usize,
        offset: usize,
        packet_len: usize,
    ) -> Option<Vec<u8>> {
        let descriptor = &active_request[descriptor_index];
        let words_remaining = packet_len.saturating_sub(offset) / 2;

        // A group whose length the desk has settled is all-or-nothing. Maillot's reply carries no
        // group lengths (4455), so a group read from a frame that does not contain it is not a short
        // group — it is every following group read at the wrong offset. Below the count the frame is
        // cut here and the events already decoded are kept (`decode_report`), which is what master
        // plan 2026-09-22 §5.1 item 2 asks for: truncate the frame, never shift it.
        if let GroupWords::Fixed(group_words) = descriptor.group_words {
            if words_remaining < group_words {
                return None;
            }
            return Some(one_based_indices(group_words));
        }
        if descriptor.group_words == GroupWords::NotSettled {
            // The length is the model's and the model is not known (footnote 17's local inputs on a
            // desk that has not announced itself). Guessing 8 or 24 is exactly the defect — but the
            // frame itself can still answer: every other group in it has a length the catalogue
            // knows, so what is left over after them *is* this group's length. The console is the
            // authority either way; a remainder that cannot be a group of this device is refused.
            return derived_group_words(active_request, descriptor_index, packet_len)
                .map(one_based_indices);
        }

        let requested = requested_indices_or_default(descriptor);
        let full_count = descriptor_full_meter_count(descriptor);
        let min_words_for_rest = active_request
            .iter()
            .skip(descriptor_index + 1)
            .map(descriptor_word_count_minimum)
            .sum::<usize>();
        let words_for_current = words_remaining.saturating_sub(min_words_for_rest);
        let is_last_descriptor = descriptor_index + 1 == active_request.len();

        match descriptor.family {
            // Maillot Channel 3 `0xa7`/`0xa8` replies are fixed group streams.
            // Decode in the same descriptor order used by request construction.
            MeterFamily::Source | MeterFamily::Output => {
                if full_count > 0 && words_for_current >= full_count {
                    return Some(one_based_indices(full_count));
                }
                if is_last_descriptor && words_for_current > requested.len() {
                    return Some(one_based_indices(words_for_current));
                }
            }
            MeterFamily::Monitor | MeterFamily::Rta => {}
            _ => {}
        }

        let indexed_count = words_for_current.min(requested.len());
        Some(requested.into_iter().take(indexed_count).collect())
    }

    /// The length of a source or output group the model did not settle, read out of the frame: the
    /// words the datagram carries minus the groups the catalogue sizes exactly. `None` when any other
    /// descriptor's own length is unknown too (two unknowns cannot be told apart) or when the
    /// remainder cannot be a group of this device.
    fn derived_group_words(
        active_request: &[MeterDescriptor],
        descriptor_index: usize,
        packet_len: usize,
    ) -> Option<usize> {
        let descriptor = &active_request[descriptor_index];
        let device_id = descriptor.device_id?;
        let family_max = match descriptor.family {
            MeterFamily::Source => source_device_meter_count(device_id),
            MeterFamily::Output => output_device_meter_count(device_id),
            _ => 0,
        };
        if family_max == 0 {
            return None;
        }
        let mut words_total = packet_len.saturating_sub(4) / 2;
        for (index, other) in active_request.iter().enumerate() {
            if index == descriptor_index {
                continue;
            }
            words_total = words_total.checked_sub(exact_group_words(other)?)?;
        }
        // A group of zero words is not a group, and more words than the family's largest group of
        // this device means the frame is not the shape the request describes.
        (words_total > 0 && words_total <= family_max).then_some(words_total)
    }

    /// The words a descriptor's reply group holds, when the catalogue knows it without looking at the
    /// frame: an exact source or output group, or a family whose slots were named (or defaulted) and
    /// whose per-slot value count is fixed. `None` for the form whose length is the desk's alone.
    fn exact_group_words(descriptor: &MeterDescriptor) -> Option<usize> {
        match descriptor.group_words {
            GroupWords::Fixed(words) => Some(words),
            GroupWords::NotSettled => None,
            // A source or an output device answers a whole group however it was asked, so its reply
            // length is not the index list's length.
            GroupWords::PerIndex => match descriptor.family {
                MeterFamily::Source | MeterFamily::Output => None,
                _ => Some(
                    requested_indices_or_default(descriptor).len()
                        * descriptor.family.value_count(),
                ),
            },
        }
    }

    fn requested_indices_or_default(descriptor: &MeterDescriptor) -> Vec<u8> {
        if !descriptor.indices.is_empty() {
            return descriptor.indices.clone();
        }
        if descriptor.family == MeterFamily::Monitor {
            return one_based_indices(6);
        }
        if descriptor.family == MeterFamily::Rta {
            return one_based_indices(120);
        }
        vec![1]
    }

    /// The family-sized group of a descriptor, used by the legacy (index-named) source and output
    /// branches of [`resolve_decode_indices`]. A descriptor that knows the desk's model carries its
    /// length in `group_words` and never reaches this: device 1's length is the model's (footnote 17)
    /// and this table's 24 is a bound, not an answer.
    fn descriptor_full_meter_count(descriptor: &MeterDescriptor) -> usize {
        match descriptor.family {
            MeterFamily::Source => descriptor
                .device_id
                .map(source_device_meter_count)
                .unwrap_or_default(),
            MeterFamily::Output => descriptor
                .device_id
                .map(output_device_meter_count)
                .unwrap_or_default(),
            _ => 0,
        }
    }

    fn descriptor_word_count_minimum(descriptor: &MeterDescriptor) -> usize {
        match descriptor.family {
            MeterFamily::Source | MeterFamily::Output => usize::max(1, descriptor.indices.len()),
            MeterFamily::Monitor | MeterFamily::Rta => descriptor.indices.len(),
            family => descriptor.indices.len() * family.value_count(),
        }
    }

    fn one_based_indices(count: usize) -> Vec<u8> {
        (1..=count)
            .filter_map(|index| u8::try_from(index).ok())
            .collect()
    }

    fn round_2(value: f32) -> f32 {
        (value * 100.0).round() / 100.0
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn builds_native_request_frame_in_maillot_order() {
            let descriptors = vec![
                MeterDescriptor::indexed(MeterFamily::Ch, vec![1, 2]),
                MeterDescriptor::source(6),
                MeterDescriptor::source(7),
                MeterDescriptor::indexed(MeterFamily::Monitor, vec![1, 2, 3, 4, 5, 6]),
                MeterDescriptor::output(2),
            ];

            let payload = request_payload(23_456, 0x0102_0304, &descriptors);
            let frame = native_frame(&payload);

            assert_eq!(
                frame,
                vec![
                    0xdf, 0xd3, 0xd3, 0x5b, 0xa0, 0xd4, 0x01, 0x02, 0x03, 0x04, 0xdc, 0xa0, 0x00,
                    0x01, 0xa7, 0x05, 0x06, 0xa9, 0xa8, 0x01, 0xde,
                ],
            );
        }

        #[test]
        fn encodes_logical_usb_source_and_output_as_zero_based_device_six() {
            let request = request_payload(
                23_456,
                1,
                &[
                    MeterDescriptor::source(SOURCE_USB_DEVICE_ID),
                    MeterDescriptor::output(OUTPUT_USB_DEVICE_ID),
                ],
            );
            assert_eq!(
                request,
                vec![
                    0xd3, 0x5b, 0xa0, 0xd4, 0, 0, 0, 1, 0xdc, 0xa7, 0x06, 0xa8, 0x06,
                    0xde,
                ]
            );
        }

        #[test]
        fn builds_renew_payload() {
            assert_eq!(
                renew_payload(0x0102_0304),
                vec![0xd4, 0x01, 0x02, 0x03, 0x04]
            );
        }

        /// Maillot's transmit rule (4287-4316). The wire only grows where it must: a data byte that
        /// would read as a channel selection right after a literal escape gets the escape closed first
        /// (`0xdf 0xd3` would mean "select channel 3", 4245-4246), and an escape that ends the payload
        /// is closed too, so the next message cannot be swallowed by it. Everything else is untouched,
        /// which is why an ordinary request's tokens and indices are the bytes they always were.
        #[test]
        fn the_escape_byte_is_escaped_on_the_wire() {
            assert_eq!(escape_payload(&[0xdf, 0xd3]), vec![0xdf, 0xde, 0xd3]);
            assert_eq!(escape_payload(&[0xdf, 0xdd]), vec![0xdf, 0xde, 0xdd]);
            // `0xdf 0x00` already reads back as those two data bytes, so nothing is inserted (4263-4278).
            assert_eq!(
                escape_payload(&[0x01, 0xdf, 0x02]),
                vec![0x01, 0xdf, 0x02]
            );
            assert_eq!(escape_payload(&[0xdf]), vec![0xdf, 0xde]);
            assert_eq!(escape_payload(&[0xdf, 0xdf]), vec![0xdf, 0xdf, 0xde]);
            assert_eq!(
                escape_payload(&[0xd3, 0x5b, 0xa0, 0xdc, 0xde]),
                vec![0xd3, 0x5b, 0xa0, 0xdc, 0xde]
            );
        }

        /// The receive half of the rule (4261-4280), with the document's own example at 4284: the bytes
        /// `D7 02 DF DE AF 0E 02` represent `D7 02 DF AF 0E 02`. A channel selection is framing and
        /// never data, and the frame the app builds round-trips through the pair.
        #[test]
        fn the_escape_byte_is_unescaped_on_receive() {
            assert_eq!(
                unescape_payload(&[0xd7, 0x02, 0xdf, 0xde, 0xaf, 0x0e, 0x02]),
                vec![0xd7, 0x02, 0xdf, 0xaf, 0x0e, 0x02]
            );
            assert_eq!(unescape_payload(&[0xdf, 0xd3, 0x01, 0x02]), vec![0x01, 0x02]);
            // A byte that is not a channel id after an escape means the escape was data after all.
            assert_eq!(unescape_payload(&[0xdf, 0x01]), vec![0xdf, 0x01]);
            for payload in [
                vec![0xd4, 0x01, 0x02, 0x03, 0x04],
                vec![0xdf, 0xd0, 0xde, 0xdf],
                vec![0xd3, 0xdf, 0xd3, 0xd4, 0xdf],
            ] {
                assert_eq!(
                    unescape_payload(&native_frame(&payload)),
                    payload,
                    "{payload:?} must survive the frame and the escape"
                );
            }
        }

        /// Why the escape matters for the meters: a raw value whose bytes contain `0xdf` followed by a
        /// byte in the channel-id range grows on the wire (`0xdf 0xde 0xdd`), and a decoder that does
        /// not know the rule reads every value after it one byte out of step — the meters lie and a
        /// macro compares the wrong level. The values come out right once the wire bytes have gone
        /// through [`unescape_payload`], and the counter-proof shows what the same bytes decode to
        /// without it. `0xdf 0xdd` is −32.18 dB in 1/256 dB, an ordinary level.
        #[test]
        fn values_after_an_escaped_escape_byte_are_still_decoded() {
            let descriptors = vec![MeterDescriptor::indexed(MeterFamily::Ch, vec![1])];
            let mut payload = 0x0102_0304_u32.to_be_bytes().to_vec();
            let mut expected = Vec::new();
            for slot in 0..MeterFamily::Ch.value_count() {
                let raw: i16 = match slot {
                    // `0xdf 0xd3` is −32.18 dB in 1/256 dB, an ordinary level whose bytes need the
                    // escape closed before them …
                    1 => -8237,
                    // … and this one carries the escape byte itself.
                    2 => 0x00df,
                    _ => 0x0100,
                };
                payload.extend_from_slice(&raw.to_be_bytes());
                expected.push(normalize_meter_value(raw, MeterFamily::Ch, slot));
            }
            let wire = native_frame(&payload);
            assert!(
                wire.windows(3).any(|triple| triple == [0xdf, 0xde, 0xd3]),
                "the escape is closed before the channel-range byte: {wire:02x?}"
            );
            let decoded = decode_report(0x0102_0304, &descriptors, &unescape_payload(&wire))
                .expect("the unescaped payload decodes");
            let values = decoded
                .iter()
                .flat_map(|event| event.values.clone())
                .collect::<Vec<_>>();
            assert_eq!(values, expected);

            let naive = decode_report(0x0102_0304, &descriptors, &escape_payload(&payload))
                .unwrap_or_default();
            let naive_values = naive
                .iter()
                .flat_map(|event| event.values.clone())
                .collect::<Vec<_>>();
            assert_ne!(
                naive_values, values,
                "without the escape removed the same bytes are not the values"
            );
        }

        #[test]
        fn normalizes_meter_values_to_existing_js_contract() {
            assert_eq!(normalize_meter_value(256, MeterFamily::Source, 0), 1.0);
            assert_eq!(normalize_meter_value(512, MeterFamily::Output, 0), 2.0);
            assert_eq!(normalize_meter_value(-256, MeterFamily::Ch, 0), -1.0);
            // The 4 FX levels are in 1/256 dB like any other level (Maillot 4407).
            assert_eq!(normalize_meter_value(1024, MeterFamily::Fx, 0), 4.0);
            assert_eq!(normalize_meter_value(1024, MeterFamily::Fx, 3), 4.0);
            // The band gain reduction — the first 5 "state meters" — uses ×6/2048
            // (Maillot 4413-4414 and 5674).
            assert_eq!(normalize_meter_value(1024, MeterFamily::Fx, 4), 3.0);
            assert_eq!(normalize_meter_value(1024, MeterFamily::Fx, 8), 3.0);
            // Gate LED and Dyn State of `* V2` return 0 or 1, not 1/256 dB (Maillot 4415-4416,
            // 5619-5620): dividing them by 256 meant a condition `== 1` never came true.
            assert_eq!(normalize_meter_value(1, MeterFamily::ChV2, 6), 1.0);
            assert_eq!(normalize_meter_value(0, MeterFamily::ChV2, 6), 0.0);
            assert_eq!(normalize_meter_value(1, MeterFamily::AuxV2, 9), 1.0);
            // The rest of the V2 table is still in 1/256 dB: gate gain, dyn gain and automix gain.
            assert_eq!(normalize_meter_value(256, MeterFamily::ChV2, 5), 1.0);
            assert_eq!(normalize_meter_value(256, MeterFamily::ChV2, 8), 1.0);
            assert_eq!(normalize_meter_value(256, MeterFamily::ChV2, 10), 1.0);
        }

        /// Maillot tabla 5: input L/R, output L/R, gate key, gate gain, **gate led**, dyn key,
        /// dyn gain, dyn state, automix gain. El gate LED es el slot 6; el 8 es dyn gain.
        #[test]
        fn maps_v2_state_slots_to_the_documented_table() {
            assert_eq!(
                crate::targets::v2_meter_family_and_slot("ch", "meter_v2_gate_led"),
                Some((MeterFamily::ChV2, "chv2", 6))
            );
            assert_eq!(
                crate::targets::v2_meter_family_and_slot("main", "meter_v2_dyn_state"),
                Some((MeterFamily::MainV2, "mainv2", 9))
            );
            assert_eq!(
                crate::targets::v2_meter_family_and_slot("matrix", "meter_v2_automix"),
                Some((MeterFamily::MatrixV2, "matrixv2", 10))
            );
            assert_eq!(crate::targets::v2_meter_family_and_slot("dca", "meter_v2_gate_led"), None);
            assert_eq!(crate::targets::v2_meter_family_and_slot("ch", "meter_v2_nope"), None);
        }

        #[test]
        fn exposes_value_counts_matching_android_runtime() {
            assert_eq!(MeterFamily::Ch.value_count(), 8);
            assert_eq!(MeterFamily::ChV2.value_count(), 11);
            assert_eq!(MeterFamily::Dca.value_count(), 4);
            assert_eq!(MeterFamily::Fx.value_count(), 10);
            assert_eq!(MeterFamily::Source.value_count(), 1);
            assert_eq!(MeterFamily::Output.value_count(), 1);
        }

        #[test]
        fn decodes_source_usb_transients_without_visual_throttle() {
            let request = vec![MeterDescriptor::source_with_indices(
                SOURCE_USB_DEVICE_ID,
                vec![1],
            )];
            let first = [0x00, 0x00, 0x00, 0x01, 0x01, 0x00];
            let second = [0x00, 0x00, 0x00, 0x01, 0x02, 0x00];

            let first_events = decode_report(1, &request, &first).expect("first decode");
            let second_events = decode_report(1, &request, &second).expect("second decode");

            assert_eq!(first_events.len(), 1);
            assert_eq!(second_events.len(), 1);
            assert_eq!(first_events[0].family, MeterFamily::Source);
            assert_eq!(first_events[0].device_id, Some(SOURCE_USB_DEVICE_ID));
            assert_eq!(first_events[0].index, 1);
            assert_eq!(first_events[0].values, vec![1.0]);
            assert_eq!(second_events[0].values, vec![2.0]);
        }

        #[test]
        fn decodes_full_source_usb_group_when_packet_contains_all_values() {
            let request = vec![MeterDescriptor::source(SOURCE_USB_DEVICE_ID)];
            let mut packet = vec![0x00, 0x00, 0x00, 0x01];
            for index in 1..=48_i16 {
                packet.extend_from_slice(&(index * 256).to_be_bytes());
            }

            let events = decode_report(1, &request, &packet).expect("decode");

            assert_eq!(events.len(), 48);
            assert_eq!(events[0].index, 1);
            assert_eq!(events[0].values, vec![1.0]);
            assert_eq!(events[47].index, 48);
            assert_eq!(events[47].values, vec![48.0]);
        }

        #[test]
        fn ignores_stale_meter_report_ids() {
            let request = vec![MeterDescriptor::indexed(MeterFamily::Ch, vec![1])];
            let packet = [0x00, 0x00, 0x00, 0x02, 0x01, 0x00];

            let events = decode_report(1, &request, &packet).expect("decode");

            assert!(events.is_empty());
        }

        #[test]
        fn preserves_descriptor_order_when_decoding_mixed_groups() {
            let request = vec![
                MeterDescriptor::indexed(MeterFamily::Ch, vec![1]),
                MeterDescriptor::source_with_indices(SOURCE_USB_DEVICE_ID, vec![1]),
            ];
            let mut packet = vec![0x00, 0x00, 0x00, 0x01];
            for raw in [256_i16, 512, 768, 1024, 1280, 1536, 1792, 2048] {
                packet.extend_from_slice(&raw.to_be_bytes());
            }
            packet.extend_from_slice(&4096_i16.to_be_bytes());

            let events = decode_report(1, &request, &packet).expect("decode");

            assert_eq!(events.len(), 2);
            assert_eq!(events[0].family, MeterFamily::Ch);
            assert_eq!(events[0].values[0], 1.0);
            assert_eq!(events[1].family, MeterFamily::Source);
            assert_eq!(events[1].values[0], 16.0);
        }

        /// A frame that ends in the middle of a group must not keep decoding the next descriptor
        /// from a false boundary: it used to emit garbage values (which could fire macros) without
        /// any error. The events already complete are kept.
        #[test]
        fn stops_at_a_truncated_group_instead_of_decoding_garbage() {
            let request = vec![
                MeterDescriptor::indexed(MeterFamily::Ch, vec![1]),
                MeterDescriptor::indexed(MeterFamily::Aux, vec![1]),
            ];
            let mut packet = vec![0x00, 0x00, 0x00, 0x01];
            // A complete channel group…
            for raw in [256_i16, 512, 768, 1024, 1280, 1536, 1792, 2048] {
                packet.extend_from_slice(&raw.to_be_bytes());
            }
            // …and only 3 of the 8 values of the aux group.
            for raw in [256_i16, 512, 768] {
                packet.extend_from_slice(&raw.to_be_bytes());
            }

            let events = decode_report(1, &request, &packet).expect("decode");

            assert_eq!(events.len(), 1, "only the first group is complete");
            assert_eq!(events[0].family, MeterFamily::Ch);
            assert_eq!(events[0].values[0], 1.0);
        }

        /// The console's model, as the desk announces it: the discovery reply's `mdl` field is the
        /// document's `[c_model]` (Maillot 563-567) and `/$syscfg/$cnsmdl` prints the same families in
        /// the "wing…" spelling (1565-1570). Anything else is `Unknown`, which is an answer and not a
        /// default — see `the_local_source_group_length_comes_from_the_desk_not_from_a_table`.
        #[test]
        fn the_desk_model_comes_from_the_announcement_and_the_discovery_reply() {
            assert_eq!(DeskModel::from_announcement("ngc-full"), DeskModel::Full);
            assert_eq!(DeskModel::from_announcement("WING"), DeskModel::Full);
            assert_eq!(DeskModel::from_announcement("wing-bk"), DeskModel::Full);
            assert_eq!(DeskModel::from_announcement("wing-rack"), DeskModel::Rack);
            assert_eq!(DeskModel::from_announcement("ngc-rack"), DeskModel::Rack);
            assert_eq!(DeskModel::from_announcement("wing-compact"), DeskModel::Compact);
            assert_eq!(DeskModel::from_announcement("WING-CMPCT"), DeskModel::Compact);
            assert_eq!(DeskModel::from_announcement(""), DeskModel::Unknown);
            assert_eq!(DeskModel::from_announcement("ngc-unknown"), DeskModel::Unknown);

            // `WING,<ip>,<name>,<mdl>,<serial>,<firmware>` — the model is the fourth field, and a
            // reply that stops before it says nothing about the desk.
            assert_eq!(
                DeskModel::from_discovery_reply(
                    "WING,10.0.0.9,a desk,ngc-full,SN,fw:release"
                ),
                DeskModel::Full
            );
            assert_eq!(
                DeskModel::from_discovery_reply("WING,10.0.0.9,a desk,wing-rack,SN,fw"),
                DeskModel::Rack
            );
            assert_eq!(
                DeskModel::from_discovery_reply("WING,10.0.0.9,a desk"),
                DeskModel::Unknown
            );
            assert_eq!(DeskModel::from_discovery_reply(""), DeskModel::Unknown);

            // The counts the document ties to the model (344, 402, 421, 448; footnote 17 at 1641).
            assert_eq!(DeskModel::Full.local_inputs(), Some(8));
            assert_eq!(DeskModel::Rack.local_inputs(), Some(24));
            assert_eq!(DeskModel::Compact.local_inputs(), Some(24));
            assert_eq!(DeskModel::Unknown.local_inputs(), None);
            // Four GPIOs on the full-size console and the Rack, two on a Compact (408, 433, 453 and
            // footnote 122 at 11536).
            assert_eq!(DeskModel::Full.gpio_count(), 4);
            assert_eq!(DeskModel::Rack.gpio_count(), 4);
            assert_eq!(DeskModel::Compact.gpio_count(), 2);
        }

        /// The length of the local input meter group is the desk's, not a table's: 8 on a full-size
        /// WING and 24 on a Rack or a Compact (344, 402, 421, 448; footnote 17 at 1641). A desk that
        /// has announced no model leaves it unsettled, and unsettled is not 24.
        #[test]
        fn the_local_source_group_length_comes_from_the_desk_not_from_a_table() {
            assert_eq!(source_group_words(DeskModel::Full, 1), Some(8));
            assert_eq!(source_group_words(DeskModel::Rack, 1), Some(24));
            assert_eq!(source_group_words(DeskModel::Compact, 1), Some(24));
            assert_eq!(source_group_words(DeskModel::Unknown, 1), None);

            // Every other group is a property of the hardware behind the node, so the model does not
            // enter into it: 48 per AES50 port, 64 for a card, 2 for the AES/EBU pair.
            for model in [
                DeskModel::Full,
                DeskModel::Rack,
                DeskModel::Compact,
                DeskModel::Unknown,
            ] {
                assert_eq!(source_group_words(model, 3), Some(48));
                assert_eq!(source_group_words(model, 8), Some(64));
                assert_eq!(source_group_words(model, 11), Some(2));
                assert_eq!(output_group_words(model, 1), Some(8));
                assert_eq!(output_group_words(model, 11), Some(2));
            }

            assert_eq!(
                MeterDescriptor::source_for_model(DeskModel::Full, 1).group_words,
                GroupWords::Fixed(8)
            );
            assert_eq!(
                MeterDescriptor::source_for_model(DeskModel::Rack, 1).group_words,
                GroupWords::Fixed(24)
            );
            assert_eq!(
                MeterDescriptor::source_for_model(DeskModel::Unknown, 1).group_words,
                GroupWords::NotSettled
            );
            // The family table keeps answering 24 for a bound; it is not a decode length.
            assert_eq!(source_device_meter_count(1), 24);
        }

        /// The group lengths a WING Rack answered on 2026-09-27, pinned one by one against the table
        /// the decoder reads (`docs/MACRO_TARGET_PLAN_2026-09-24.md`, "Measured on the console,
        /// 2026-09-27"). They settle what the tree had marked hardware-pending — the auxiliary group
        /// of 8 above all — and they close the "the rest are hardware-pending" caveat for every group
        /// the desk listed. What the desk did **not** list keeps the document: the full-size
        /// console's eight-value local group, the AES50-B and -C groups, the bus/main/matrix source
        /// groups and the output aux, B, C, StageConnect, REC and AES groups are asserted here as the
        /// documented table, not as a measurement.
        #[test]
        fn the_measured_group_lengths_match_the_table_the_decoder_reads() {
            // `/io/in`, exactly as the read-only probe reported them: LCL 24, AUX 8, A 48, SC 32,
            // USB 48, CRD 64, MOD 64, PLAY 4, AES 2, USR 56, OSC 2.
            for (device_id, expected) in [
                (1_u8, 24_usize),
                (2, 8),
                (3, 48),
                (6, 32),
                (7, 48),
                (8, 64),
                (9, 64),
                (10, 4),
                (11, 2),
                (12, 56),
                (13, 2),
            ] {
                assert_eq!(
                    source_device_meter_count(device_id),
                    expected,
                    "the input group the desk measured must keep its length in the table"
                );
                assert_eq!(
                    source_group_words(DeskModel::Rack, device_id),
                    Some(expected),
                    "a Rack decodes group {device_id} at the measured length"
                );
            }

            // `/io/out`, the same day and the same probe: LCL 8, A 48, USB 48, CRD 64, MOD 64.
            for (device_id, expected) in [(1_u8, 8_usize), (3, 48), (7, 48), (8, 64), (9, 64)] {
                assert_eq!(output_device_meter_count(device_id), expected);
                assert_eq!(output_group_words(DeskModel::Rack, device_id), Some(expected));
            }

            // The groups the desk did not list keep the documented table — asserted so a future
            // measurement has one place to change and a silent edit to a guess fails here.
            for (device_id, expected) in [(4_u8, 48_usize), (5, 48), (14, 32), (15, 8), (16, 16)] {
                assert_eq!(
                    source_device_meter_count(device_id),
                    expected,
                    "unmeasured: the document's number is what the table carries"
                );
            }
            for (device_id, expected) in [(2_u8, 8_usize), (4, 48), (5, 48), (6, 32), (10, 4), (11, 2)]
            {
                assert_eq!(output_device_meter_count(device_id), expected);
            }
        }

        /// The defect master plan 2026-09-22 §5.1 item 2 names: a full-size desk sends 8 values for
        /// the local group while the table expects 24, and every group after it in the same datagram
        /// was decoded at the wrong offset. With the length taken from the model the frame walks
        /// group by group correctly.
        #[test]
        fn a_full_size_frame_decodes_every_group_at_its_own_offset() {
            let request = vec![
                MeterDescriptor::source_for_model(DeskModel::Full, 1),
                MeterDescriptor::indexed(MeterFamily::Ch, vec![1, 2, 3]),
            ];
            let mut packet = vec![0x00, 0x00, 0x00, 0x01];
            // Eight local input meters…
            for index in 1..=8_i16 {
                packet.extend_from_slice(&(index * 256).to_be_bytes());
            }
            // …then three channel strips, each 8 slots, with a recognisable first slot.
            for strip in 1..=3_i16 {
                packet.extend_from_slice(&((100 + strip) * 256).to_be_bytes());
                for _ in 1..8 {
                    packet.extend_from_slice(&0_i16.to_be_bytes());
                }
            }

            let events = decode_report(1, &request, &packet).expect("decode");

            let sources = events
                .iter()
                .filter(|event| event.family == MeterFamily::Source)
                .collect::<Vec<_>>();
            assert_eq!(sources.len(), 8, "a full-size desk sends eight local meters");
            assert_eq!(sources[7].index, 8);
            assert_eq!(sources[7].values, vec![8.0]);

            let channels = events
                .iter()
                .filter(|event| event.family == MeterFamily::Ch)
                .collect::<Vec<_>>();
            assert_eq!(channels.len(), 3, "the channel groups stay aligned");
            assert_eq!(channels[0].index, 1);
            assert_eq!(channels[0].values[0], 101.0);
            assert_eq!(channels[1].values[0], 102.0);
            assert_eq!(channels[2].values[0], 103.0);
        }

        /// A Rack sends 24 local meters where the full-size desk sends 8, and the same frame decodes
        /// with its own length: the model is read, never the desk that happened to be on the bench.
        #[test]
        fn a_rack_frame_decodes_its_own_local_group_length() {
            let request = vec![
                MeterDescriptor::source_for_model(DeskModel::Rack, 1),
                MeterDescriptor::indexed(MeterFamily::Ch, vec![1]),
            ];
            let mut packet = vec![0x00, 0x00, 0x00, 0x01];
            for index in 1..=24_i16 {
                packet.extend_from_slice(&(index * 256).to_be_bytes());
            }
            packet.extend_from_slice(&(200_i16 * 128).to_be_bytes());
            for _ in 1..8 {
                packet.extend_from_slice(&0_i16.to_be_bytes());
            }

            let events = decode_report(1, &request, &packet).expect("decode");

            assert_eq!(events.len(), 25);
            assert_eq!(events[23].family, MeterFamily::Source);
            assert_eq!(events[23].values, vec![24.0]);
            assert_eq!(events[24].family, MeterFamily::Ch);
            assert_eq!(events[24].values[0], 100.0);
        }

        /// A desk whose model the app does not know still has its frame read correctly: the group the
        /// document sizes by model is the one left over once the groups the catalogue *does* size are
        /// taken out, so the length comes from the console on this path too.
        #[test]
        fn an_unknown_model_derives_the_group_length_from_the_frame_itself() {
            let request = vec![
                MeterDescriptor::source_for_model(DeskModel::Unknown, 1),
                MeterDescriptor::indexed(MeterFamily::Ch, vec![1]),
            ];
            let mut packet = vec![0x00, 0x00, 0x00, 0x01];
            for index in 1..=8_i16 {
                packet.extend_from_slice(&(index * 256).to_be_bytes());
            }
            packet.extend_from_slice(&(200_i16 * 128).to_be_bytes());
            for _ in 1..8 {
                packet.extend_from_slice(&0_i16.to_be_bytes());
            }

            let events = decode_report(1, &request, &packet).expect("decode");

            assert_eq!(events.len(), 9, "eight local meters and one channel strip");
            assert_eq!(events[7].values, vec![8.0]);
            assert_eq!(events[8].family, MeterFamily::Ch);
            assert_eq!(events[8].values[0], 100.0);
        }

        /// And when the remainder cannot be a group of that device — nothing left for it, or more
        /// than the family's largest group — the frame is cut at that group instead of inventing one.
        #[test]
        fn an_impossible_remainder_truncates_instead_of_inventing_a_group() {
            let request = vec![
                MeterDescriptor::source_for_model(DeskModel::Unknown, 1),
                MeterDescriptor::indexed(MeterFamily::Ch, vec![1]),
            ];
            // Exactly the channel group: the local group would be zero words long.
            let mut packet = vec![0x00, 0x00, 0x00, 0x01];
            for _ in 0..8 {
                packet.extend_from_slice(&0_i16.to_be_bytes());
            }
            assert!(
                decode_report(1, &request, &packet)
                    .expect("decode")
                    .is_empty(),
                "a frame with no room for the local group cannot be walked"
            );

            // 25 local meters where the family's largest local group is 24: not a desk this app knows.
            let mut packet = vec![0x00, 0x00, 0x00, 0x01];
            for _ in 0..25 {
                packet.extend_from_slice(&0_i16.to_be_bytes());
            }
            for _ in 0..8 {
                packet.extend_from_slice(&0_i16.to_be_bytes());
            }
            assert!(
                decode_report(1, &request, &packet)
                    .expect("decode")
                    .is_empty(),
                "a remainder larger than the family's largest group is not a group"
            );
        }
    }
}

#[cfg(test)]
mod plugin_model_tests {
    use super::plugin_models::{
        plugin_model, plugin_model_has_parameter, plugin_parameter_names, CHANNEL_DYN_MODELS,
        CHANNEL_EQ_MODELS, CHANNEL_GATE_MODELS, PLUGIN_MODELS,
    };

    /// Every name the channel sections accept must resolve to an appendix table, or the catalogue
    /// would offer a model whose parameters nobody knows.
    #[test]
    fn every_channel_model_resolves_to_a_table() {
        for model in CHANNEL_GATE_MODELS.iter().chain(CHANNEL_DYN_MODELS).chain(CHANNEL_EQ_MODELS) {
            assert!(plugin_model(model).is_some(), "{model} has no appendix table");
        }
    }

    /// The variants the routing tables name (D241G, D241C) and the footnote-glued names (ONEC22) have
    /// to land on the same table as the appendix model.
    #[test]
    fn variant_and_footnote_names_resolve_through_aliases() {
        assert_eq!(plugin_model("D241G").map(|m| m.model), Some("D241"));
        assert_eq!(plugin_model("D241C").map(|m| m.model), Some("D241"));
    }

    /// The appendix's Standard EQ table prints its band 6 Q row as `7q` with the description "q 6"
    /// (`scratch/wing_protocols.txt:8658`, the band digit mangled on extraction), while the leaves
    /// `/bus/1/eq/6q` (2434), `/main/1/eq/6q` (2605) and `/mtx/1/eq/6q` (2775) are the ones the
    /// console has. `PLUGIN_PARAMETER_ALIASES` teaches the tables that one row, so `STD` has `6q`.
    ///
    /// `7q` is deliberately **not** a name: it is the document's typo, no console leaf is called
    /// that, and accepting it would let `eq:7q` through the model check into a write the console
    /// ignores in silence. The alias is one row in one direction; a name that is genuinely absent
    /// (`WARM` has no `thr`) stays absent, so a blanket rule cannot hide a real mismatch.
    #[test]
    fn the_standard_eq_band_six_q_alias_teaches_the_console_name() {
        assert!(plugin_model_has_parameter("STD", "6q"));
        assert!(
            !plugin_model_has_parameter("STD", "7q"),
            "the printed spelling is the extraction's typo, not a parameter"
        );
        assert!(!plugin_model_has_parameter("WARM", "thr"));
        assert!(!plugin_model_has_parameter("LMT", "thr"));
        assert!(plugin_model_has_parameter("STD", "6g"));
        assert!(plugin_model_has_parameter("STD", "5q"));
        // The alias applies to that one model only.
        assert!(!plugin_model_has_parameter("SOUL", "6q"));
        assert!(!plugin_model_has_parameter("E88", "6q"));
        assert!(!plugin_model_has_parameter("STD", "not-a-parameter"));

        // A caller listing the names sees the console's spelling, in appendix order, once.
        let names = plugin_parameter_names("STD").expect("STD is documented");
        assert!(names.contains(&"6q"), "{names:?}");
        assert!(!names.contains(&"7q"), "{names:?}");
        let mut sorted = names.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), names.len(), "the alias must not create a duplicate");

        // And the name is documented by some model, which is what a `section:name` target asks.
        assert!(crate::plugin_models::plugin_parameter_is_documented("6q"));
        assert!(!crate::plugin_models::plugin_parameter_is_documented("7q"));
        assert!(crate::plugin_models::plugin_parameter_is_documented("thr"));
        assert!(!crate::plugin_models::plugin_parameter_is_documented("nope"));

        // A caller building one UI entry per parameter gets the console name next to the row, so the
        // editor cannot offer a spelling the resolver refuses.
        let parameters = crate::plugin_models::plugin_parameters("STD").expect("STD is documented");
        let band_six_q = parameters
            .iter()
            .find(|(name, _)| *name == "6q")
            .expect("STD must offer band 6's Q under the console name");
        assert_eq!(band_six_q.1.spec, "logf [0.442, 10, 181] q 6");
        assert_eq!(
            parameters.len(),
            plugin_model("STD").expect("STD is documented").parameters.len(),
            "the alias renames a row, it does not add or drop one"
        );
    }

    /// The alias reaches the two consumers the model check uses: the per-model question `main.rs`
    /// asks before a write leaves the app, and the resolver that builds a `section:name` address.
    #[test]
    fn the_band_six_q_alias_reaches_the_model_check_and_the_resolver() {
        // Without the alias this was the one name the map handed out that the tables refused.
        assert!(crate::targets::model_parameter_problem("eq", "6q", "STD").is_none());
        // The printed spelling is still refused: the console has no `/eq/7q`.
        let problem = crate::targets::model_parameter_problem("eq", "7q", "STD")
            .expect("7q is not a parameter of anything");
        assert!(problem.contains("STD"), "{problem}");
        // A real mismatch still fails, so the alias did not soften the check.
        assert!(crate::targets::model_parameter_problem("dyn", "thr", "WARM").is_some());
        // The qualified target resolves to the leaf the routing tables document.
        assert_eq!(
            crate::targets::resolve_basic_addresses(&crate::targets::BasicTargetSpec {
                category: "bus".to_string(),
                ids: "1".to_string(),
                parameter: "eq:6q".to_string(),
                send_id: None,
                custom_address: None,
            }),
            vec!["/bus/1/eq/6q".to_string()]
        );
        // …and the typo resolves to nothing rather than to a path the console ignores.
        assert!(crate::targets::resolve_basic_addresses(&crate::targets::BasicTargetSpec {
            category: "bus".to_string(),
            ids: "1".to_string(),
            parameter: "eq:7q".to_string(),
            send_id: None,
            custom_address: None,
        })
        .is_empty());
    }

    /// Cross-check against what the test console answered read-only (WING Rack, FW 3.1.1):
    /// `/ch/1/gate/mdl` = DEQ2, `/ch/36/gate/mdl` = GATE, `/main/1/dyn/mdl` = WARM and
    /// `/mtx/1/dyn/mdl` = LMT, and those strips answered exactly these parameter names.
    #[test]
    fn hardware_verified_models_expose_their_parameters() {
        for (model, expected) in [
            ("GATE", &["thr", "range", "att", "hld", "rel", "acc", "ratio"][..]),
            ("DEQ2", &["1-thr", "2-thr", "1-g", "2-g", "1-f", "2-f"][..]),
            ("WARM", &["drv", "hrm", "col", "trim", "mix"][..]),
            (
                "LMT",
                &["mix", "gain", "tspd", "trans", "tgain", "ton", "comp", "cgain", "con"][..],
            ),
            ("E88C", &["mix", "gain", "knee", "thr", "ratio", "att", "rel"][..]),
        ] {
            let names = plugin_parameter_names(model).unwrap_or_else(|| panic!("{model} is missing"));
            for parameter in expected {
                assert!(
                    names.contains(parameter),
                    "{model} must expose {parameter}, it exposes {names:?}"
                );
            }
        }
    }

    /// The generic compressor names do not exist on a strip running LMT or WARM: that is exactly why
    /// the catalogue has to be model-aware.
    #[test]
    fn generic_names_are_not_claimed_for_models_that_lack_them() {
        assert!(!plugin_model_has_parameter("LMT", "thr"));
        assert!(!plugin_model_has_parameter("WARM", "thr"));
        assert!(plugin_model_has_parameter("GATE", "thr"));
    }

    /// A model is documented once; the generated table must not carry duplicates.
    #[test]
    fn models_are_unique_and_parameter_names_are_too() {
        let mut seen = std::collections::HashSet::new();
        for entry in PLUGIN_MODELS {
            assert!(seen.insert(entry.model), "{} appears twice", entry.model);
            let mut parameters = std::collections::HashSet::new();
            for parameter in entry.parameters {
                assert!(
                    parameters.insert(parameter.name),
                    "{}.{} is listed twice",
                    entry.model,
                    parameter.name
                );
            }
            // The names a caller is offered are the console's spellings, with the mangled appendix
            // rows reported under their real name: the alias must not collide with a name the same
            // table already carries.
            let mut console_names = std::collections::HashSet::new();
            for name in plugin_parameter_names(entry.model).unwrap_or_default() {
                assert!(
                    console_names.insert(name),
                    "{}: the console name {name} is listed twice after the alias",
                    entry.model
                );
            }
        }
    }

    /// Every table carries a label, and every model a channel section can select carries parameters
    /// (`NONE`, the empty effect slot, legitimately has none).
    #[test]
    fn every_channel_table_has_parameters_and_a_label() {
        for entry in PLUGIN_MODELS {
            assert!(!entry.label.is_empty(), "{} has no label", entry.model);
        }
        for model in CHANNEL_GATE_MODELS.iter().chain(CHANNEL_DYN_MODELS).chain(CHANNEL_EQ_MODELS) {
            let entry = plugin_model(model).unwrap_or_else(|| panic!("{model} is missing"));
            assert!(!entry.parameters.is_empty(), "{model} has no parameters");
        }
    }
}
