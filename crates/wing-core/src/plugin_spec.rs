//! Parses the appendix's value descriptions into something the catalogue can offer.
//!
//! The Maillot appendix describes every plugin parameter with a compact spec, e.g.
//! `linf [-80, 0, 161] dB, thr`, `logf [4, 4000, 121] ms, release`, `int [0..1] shaper on` or
//! `str [OFF, BP, LP6, LP12]`. Those strings are the authority for a model parameter's range, unit and
//! legal values, and the generated [`crate::plugin_models`] table keeps them verbatim. This module
//! turns them into numbers the UI can use for its fields, so a model-specific parameter gets the same
//! kind of editing metadata as the generic catalogue entries.

/// How a plugin parameter's value behaves when the operator edits it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum PluginValueKind {
    /// A continuous number (`linf`, `logf`).
    Float,
    /// A whole number (`int`).
    Integer,
    /// A switch, when an integer is documented as the `0..1` range.
    Toggle,
    /// One of a fixed list (`str`, `flt`).
    Choice,
    /// The spec could not be understood; treat the value as raw text.
    Unknown,
}

/// A parsed parameter spec: everything the UI needs to build the right field.
#[derive(Clone, Debug, PartialEq)]
pub struct PluginSpec {
    pub kind: PluginValueKind,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// Number of steps the console documents, when it documents one.
    pub steps: Option<u32>,
    /// `true` for the `log` variants of the numeric specs.
    pub logarithmic: bool,
    pub unit: Option<String>,
    pub options: Vec<String>,
    /// The appendix's own words after the first comma (`dB, thr` keeps `thr`).
    pub description: Option<String>,
}

impl PluginSpec {
    fn unknown() -> Self {
        Self {
            kind: PluginValueKind::Unknown,
            min: None,
            max: None,
            steps: None,
            logarithmic: false,
            unit: None,
            options: Vec::new(),
            description: None,
        }
    }

    /// The value the console treats as "off" for a switch, as the generic catalogue does.
    pub fn is_toggle(&self) -> bool {
        self.kind == PluginValueKind::Toggle
    }

    /// How the catalogue describes this value's behaviour: one of `crate::targets::VALUE_KINDS`, which
    /// is what decides the comparators ([`crate::targets::operators_for_value_kind`]), the field the
    /// editor draws and the unit it shows.
    ///
    /// This is the one mapping from the appendix's vocabulary to the catalogue's, shared by the DTO the
    /// window reads and by the watch rules a model-qualified key is validated against. Were they two
    /// mappings, the editor could offer a comparison the backend refuses.
    pub fn catalogue_value_kind(&self) -> &'static str {
        match self.kind {
            PluginValueKind::Toggle => "toggle",
            PluginValueKind::Choice => "text",
            PluginValueKind::Integer => "number",
            PluginValueKind::Float | PluginValueKind::Unknown => match self.unit.as_deref() {
                Some("dB") => "db",
                Some("Hz") => "hz",
                _ => "number",
            },
        }
    }

    /// How the value is written on the wire (`int`, `float` or `string`), in the catalogue's own words:
    /// the argument kind, which is what a fade's series of numbers is checked against.
    pub fn catalogue_arg_kind(&self) -> &'static str {
        match self.kind {
            PluginValueKind::Toggle | PluginValueKind::Integer => "int",
            PluginValueKind::Choice | PluginValueKind::Unknown => "string",
            PluginValueKind::Float => "float",
        }
    }
}

/// Units the appendix uses after a range; everything else there is prose.
const KNOWN_UNITS: &[&str] = &["db", "%", "ms", "s", "hz", "khz", "m", "x", ":1", "l/h"];

/// A number as the tables write it: sometimes with the unit glued on ("125 %", "121ms").
fn leading_number(part: &str) -> Option<f64> {
    let cleaned: String = part
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-' || *c == '+')
        .collect();
    cleaned.parse::<f64>().ok()
}

/// `[a, b, c]`, `[a..b]` and `[a…b]` are all the same idea: a numeric range, optionally stepped.
fn numbers_in_brackets(body: &str) -> Option<(f64, f64, Option<u32>)> {
    let cleaned = body.replace('\u{2026}', "..").replace('\u{2013}', "-");
    let parts = cleaned
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let range = if parts.len() == 1 && parts[0].contains("..") {
        let (low, high) = parts[0].split_once("..")?;
        vec![low.trim(), high.trim()]
    } else {
        parts.clone()
    };
    if range.len() < 2 {
        return None;
    }
    let min = leading_number(range[0])?;
    let max = leading_number(range[1])?;
    let steps = if parts.len() >= 3 {
        let digits: String = parts[2].chars().take_while(|c| c.is_ascii_digit()).collect();
        digits.parse::<u32>().ok()
    } else {
        None
    };
    Some((min, max, steps))
}

/// Parses one appendix value description.
pub fn parse_plugin_spec(spec: &str) -> PluginSpec {
    let mut parsed = PluginSpec::unknown();
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return parsed;
    }
    // The type is the first word (`linf`, `int`, `str`, `fader`); a spec without a bracket keeps the
    // rest of the line as its unit/description text (`fader lvl dB, echo left`).
    let (head_text, rest) = match trimmed.split_once('[') {
        Some((head, rest)) => (head.trim(), rest),
        None => (trimmed, ""),
    };
    let mut head_words = head_text.split_whitespace();
    let head = head_words.next().unwrap_or("");
    let head_remainder = head_words.collect::<Vec<_>>().join(" ");
    let (body, tail_after_bracket) = match rest.split_once(']') {
        // One row repeats its type token inside the bracket, because the printed column wrapped and the
        // extraction doubled the head (`linf [linf [0, 10, 101] %, lfo`, the Mood Filter `lfo` row at
        // 7191). The range is what follows the last opening bracket; without this the row would be
        // unreadable and the parameter's range lost.
        Some((body, tail)) => (
            body.rsplit_once('[').map_or(body, |(_, range)| range),
            tail.trim(),
        ),
        None => (rest, ""),
    };
    let tail = if tail_after_bracket.is_empty() {
        head_remainder.as_str()
    } else {
        tail_after_bracket
    };
    // The extracted tables contain a few typos: `linf>` keeps a stray bracket character and one row
    // lost its type token entirely. Normalising the token and inferring the kind from a readable range
    // is honest about what the text says.
    let type_token: String = head
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_lowercase();
    parsed.kind = match type_token.as_str() {
        "linf" | "lin" => PluginValueKind::Float,
        "logf" | "log" => {
            parsed.logarithmic = true;
            PluginValueKind::Float
        }
        "int" => PluginValueKind::Integer,
        // `inf [0, 1] ...` is how the tables spell a switch in a couple of rows.
        "inf" => PluginValueKind::Integer,
        "str" => PluginValueKind::Choice,
        "flt" => PluginValueKind::Choice,
        // `fader <name> dB` is a level control the appendix documents without a range.
        "fader" => PluginValueKind::Float,
        _ if numbers_in_brackets(body).is_some() => PluginValueKind::Float,
        _ => PluginValueKind::Unknown,
    };

    match parsed.kind {
        PluginValueKind::Float | PluginValueKind::Integer => {
            if let Some((min, max, steps)) = numbers_in_brackets(body) {
                parsed.min = Some(min);
                parsed.max = Some(max);
                parsed.steps = steps;
                if parsed.kind == PluginValueKind::Integer
                    && min == 0.0
                    && max == 1.0
                    && steps.is_none()
                {
                    parsed.kind = PluginValueKind::Toggle;
                }
            } else if !body.trim().is_empty() {
                // A bracket that cannot be read as a range is a documentation problem, not a number.
                parsed.kind = PluginValueKind::Unknown;
            }
            // No bracket at all (`fader lvl dB`) keeps the declared kind: the range is the strip's own.
        }
        PluginValueKind::Choice => {
            parsed.options = body
                .split(',')
                .map(|option| option.trim().to_string())
                .filter(|option| !option.is_empty())
                .collect();
            if parsed.options.is_empty() {
                parsed.kind = PluginValueKind::Unknown;
            }
        }
        _ => {}
    }

    // After the bracket comes "unit, description" or "unit description": the unit is one of the few
    // tokens the tables actually use, and any word that is not one of them is prose ("mode", "attack").
    let mut tail_parts = tail.splitn(2, ',');
    if let Some(first) = tail_parts.next() {
        let first = first.trim();
        if !first.is_empty() {
            let words = first.split_whitespace().collect::<Vec<_>>();
            let unit_index = words
                .iter()
                .position(|word| KNOWN_UNITS.contains(&word.to_ascii_lowercase().as_str()));
            match unit_index {
                Some(index) => {
                    parsed.unit = Some(words[index].to_string());
                    let rest = words
                        .iter()
                        .enumerate()
                        .filter(|(position, _)| *position != index)
                        .map(|(_, word)| *word)
                        .collect::<Vec<_>>()
                        .join(" ");
                    if !rest.is_empty() {
                        parsed.description = Some(rest);
                    }
                }
                None => parsed.description = Some(first.to_string()),
            }
        }
    }
    if let Some(description) = tail_parts.next() {
        let description = description.trim();
        if !description.is_empty() {
            parsed.description = Some(description.to_string());
        }
    }
    parsed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_stepped_float_with_unit() {
        let spec = parse_plugin_spec("linf [-80, 0, 161] dB, thr");
        assert_eq!(spec.kind, PluginValueKind::Float);
        assert_eq!(spec.min, Some(-80.0));
        assert_eq!(spec.max, Some(0.0));
        assert_eq!(spec.steps, Some(161));
        assert_eq!(spec.unit.as_deref(), Some("dB"));
        assert_eq!(spec.description.as_deref(), Some("thr"));
        assert!(!spec.logarithmic);
    }

    #[test]
    fn parses_a_logarithmic_spec() {
        let spec = parse_plugin_spec("logf [4, 4000, 121] ms, release");
        assert!(spec.logarithmic);
        assert_eq!(spec.unit.as_deref(), Some("ms"));
        assert_eq!(spec.steps, Some(121));
    }

    #[test]
    fn a_zero_to_one_integer_is_a_toggle() {
        let spec = parse_plugin_spec("int [0..1] shaper on");
        assert_eq!(spec.kind, PluginValueKind::Toggle);
        assert!(spec.is_toggle());
        assert_eq!(spec.min, Some(0.0));
        assert_eq!(spec.max, Some(1.0));
    }

    #[test]
    fn a_wider_integer_stays_an_integer() {
        let spec = parse_plugin_spec("int [1\u{2026}50] speed");
        assert_eq!(spec.kind, PluginValueKind::Integer);
        assert_eq!(spec.min, Some(1.0));
        assert_eq!(spec.max, Some(50.0));
        assert_eq!(spec.unit, None);
    }

    #[test]
    fn a_string_spec_lists_its_options() {
        let spec = parse_plugin_spec("str [OFF, BP, LP6, LP12, HP6, HP12]");
        assert_eq!(spec.kind, PluginValueKind::Choice);
        assert_eq!(spec.options, vec!["OFF", "BP", "LP6", "LP12", "HP6", "HP12"]);
    }

    #[test]
    fn a_float_list_is_a_choice_too() {
        let spec = parse_plugin_spec("flt [2.0, 4.0, 8.0] ratio");
        assert_eq!(spec.kind, PluginValueKind::Choice);
        assert_eq!(spec.options, vec!["2.0", "4.0", "8.0"]);
    }

    #[test]
    fn an_unreadable_spec_is_not_guessed() {
        let spec = parse_plugin_spec("something else entirely");
        assert_eq!(spec.kind, PluginValueKind::Unknown);
        assert_eq!(spec.min, None);
        assert!(spec.options.is_empty());
    }

    /// The Mood Filter's `lfo` row repeats its type token inside the bracket
    /// (`linf [linf [0, 10, 101] %, lfo`, `scratch/wing_protocols.txt:7191`): the range is the one the
    /// last opening bracket starts, and the parameter keeps the documented bounds, unit and meaning.
    #[test]
    fn a_doubled_head_still_gives_its_range() {
        let spec = parse_plugin_spec("linf [linf [0, 10, 101] %, lfo");
        assert_eq!(spec.kind, PluginValueKind::Float);
        assert_eq!(spec.min, Some(0.0));
        assert_eq!(spec.max, Some(10.0));
        assert_eq!(spec.steps, Some(101));
        assert_eq!(spec.unit.as_deref(), Some("%"));
        assert_eq!(spec.description.as_deref(), Some("lfo"));
    }

    /// Every spec in the generated appendix table parses to something usable: numeric specs get a
    /// range, list specs get options, and nothing is silently classified as a number without bounds.
    #[test]
    fn every_generated_parameter_parses_consistently() {
        let mut parsed_kinds = std::collections::BTreeMap::new();
        for model in crate::plugin_models::PLUGIN_MODELS {
            for parameter in model.parameters {
                let spec = parse_plugin_spec(parameter.spec);
                *parsed_kinds.entry(spec.kind).or_insert(0usize) += 1;
                match spec.kind {
                    PluginValueKind::Float | PluginValueKind::Integer | PluginValueKind::Toggle => {
                        // `fader` specs carry no bracket; everything else must give a range.
                        if parameter.spec.contains('[') {
                            assert!(
                                spec.min.is_some() && spec.max.is_some(),
                                "{}.{} has no range: {}",
                                model.model,
                                parameter.name,
                                parameter.spec
                            );
                        }
                    }
                    PluginValueKind::Choice => {
                        assert!(
                            !spec.options.is_empty(),
                            "{}.{} has no options: {}",
                            model.model,
                            parameter.name,
                            parameter.spec
                        );
                    }
                    PluginValueKind::Unknown => {
                        panic!(
                            "{}.{} could not be parsed: {}",
                            model.model, parameter.name, parameter.spec
                        );
                    }
                }
            }
        }
        // A handful of specs in the extracted text are genuinely unreadable; they are counted here so
        // that a regression which pushes more of them into "unknown" is visible.
        assert!(
            parsed_kinds.values().sum::<usize>() > 900,
            "the appendix table should parse to ~1000 parameters, got {parsed_kinds:?}"
        );
    }
}
