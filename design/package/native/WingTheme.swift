// WING CONTROLLER design kit — the native (SwiftUI) form. Version 1.5.0.
//
// GENERATED FILE — do not edit. The one file a human edits is `design/tokens.json`; this Swift is rendered from it
// by `scripts/generate-design-tokens-swift.mjs`, and `scripts/test-design-tokens-swift.mjs` fails when the two
// disagree. The same JSON renders `design/tokens.css` (`scripts/generate-design-tokens.mjs`), so a colour is
// changed once and both forms follow.
//
// Source: extracted from desktop/ui/*.html (2026-10-07, v0.2.92)
//
// -----------------------------------------------------------------------------------------------------------------
// THE HONEST LIMIT — read this before quoting anything below as verified
// -----------------------------------------------------------------------------------------------------------------
// **This kit's conformance suite judges a rendered web page.** It measures computed styles and geometry in a browser
// (`design/conformance/run.mjs`, the points of `design/UI_SYSTEM.md` §11). It **cannot** judge a SwiftUI
// view, and nothing in this file claims it does. The status of a native screen built on this theme today is
// **"declared, not verified"**: the values below are declared here and rendered from the same JSON the web side
// uses, and whether a particular panel draws them correctly has not been measured by any tool in this repository.
// What *has* been checked is the form itself — byte-identity against the JSON, and that this file compiles.
//
// The rules of §11 still apply to a native view, and they are the point of adopting the kit rather than a
// colour table: a control works or it is absent; both themes are looked at and nothing freezes to the light one;
// figures the operator reads are monospaced and sit in a well; every text size is one of the kit's five steps,
// moved only by the scale knob; a refusal names its cause. Those are review discipline here, not a machine check.
//
// -----------------------------------------------------------------------------------------------------------------
// What this file provides
// -----------------------------------------------------------------------------------------------------------------
//   * `WingColor`     — every token of `design/tokens.css`, both themes, under the **same names**: the member is
//                       the CSS custom property without its leading dashes (`--win-btn-face` ->
//                       `WingColor.winBtnFace`, `--line-light` -> `WingColor.lineLight`).
//   * `WingColor.<name>(for:)` — the value for the scheme the view is in. This is the one thing a view has to do
//                       that the CSS does automatically: SwiftUI hands the scheme to a view, it does not resolve a
//                       palette for it. One function per token, with no default for `scheme`, so a view cannot
//                       acquire a palette by forgetting to ask which theme it is in.
//   * `WingTheme`     — the type scale (`--font-*`), the two font family names (`--win-font`, `--mono`), the
//                       four-pixel spacing grid (`--space-*`) and the scale knob (`--meter-scale`).
//   * `WingGradient` — the meter ramp (`--meter-ramp`), a MEASURED value rather than a chosen one, deliberately the
//                       same in both themes (see `design/tokens.css`).
//
// Theme-independent in the kit, so both themes carry the same value here: \`--amber\`, \`--gold\`, \`--green\`, \`--green-dim\`, \`--red\`, \`--red-bright\`, \`--win-window-frame\`, \`--yellow\`.
//
// The bevel is geometry rather than a value, so `design/tokens.json` carries it as prose: A control is raised and a well is sunken. Never both on one element, and never a raised control without the light-before-dark pair. The pair is ONE step: the second inner step this application's own controls draw (`desktop/ui/index.html:1305-1318`, the light `--face-3` over the dark `--line-mid`) is a declared deviation of that window (`design/conformance/allow.mjs`, rule 1 `two-shapes`), not a second bevel the kit names — see `design/adopt/README.md` step 6 for the measurement and the reason the drawing was left alone.
// In SwiftUI the raised pair is a stroke in `WingColor.lineLight` on the top-left and `WingColor.lineDark` on the
// bottom-right, and a well is the same pair reversed. Nothing here draws it for you: a generated shape would have to
// decide a corner radius and a stroke width that `tokens.json` does not carry.
//

#if canImport(SwiftUI)
import SwiftUI

/// Every colour token in the kit, as the CSS declares them. Light is `design/tokens.css`'s `:root`, dark is its
/// `body.theme-dark`, and a token the dark theme does not re-declare is the same value in both (the phosphor).
public enum WingColor {
  /// `:root` — the light theme, complete.
  public enum Light {
    /// `--accent` — 0x000080
    public static let accent = Color(red: 0.0 / 255.0, green: 0.0 / 255.0, blue: 128.0 / 255.0)
    /// `--amber` — 0xD0A84E (declared once: this token is the same in both themes)
    public static let amber = Color(red: 208.0 / 255.0, green: 168.0 / 255.0, blue: 78.0 / 255.0)
    /// `--crt` — 0x050A08
    public static let crt = Color(red: 5.0 / 255.0, green: 10.0 / 255.0, blue: 8.0 / 255.0)
    /// `--crt-ink` — 0x70E7A9
    public static let crtInk = Color(red: 112.0 / 255.0, green: 231.0 / 255.0, blue: 169.0 / 255.0)
    /// `--desk` — 0x008080
    public static let desk = Color(red: 0.0 / 255.0, green: 128.0 / 255.0, blue: 128.0 / 255.0)
    /// `--dim` — 0x4A4A4A
    public static let dim = Color(red: 74.0 / 255.0, green: 74.0 / 255.0, blue: 74.0 / 255.0)
    /// `--face` — 0xC0C0C0
    public static let face = Color(red: 192.0 / 255.0, green: 192.0 / 255.0, blue: 192.0 / 255.0)
    /// `--face-2` — 0xD4D0C8
    public static let face2 = Color(red: 212.0 / 255.0, green: 208.0 / 255.0, blue: 200.0 / 255.0)
    /// `--face-3` — 0xFFFFFF
    public static let face3 = Color(red: 255.0 / 255.0, green: 255.0 / 255.0, blue: 255.0 / 255.0)
    /// `--field` — 0xFFFFFF
    public static let field = Color(red: 255.0 / 255.0, green: 255.0 / 255.0, blue: 255.0 / 255.0)
    /// `--gold` — 0xFFD700 (declared once: this token is the same in both themes)
    public static let gold = Color(red: 255.0 / 255.0, green: 215.0 / 255.0, blue: 0.0 / 255.0)
    /// `--green` — 0x2ECC71 (declared once: this token is the same in both themes)
    public static let green = Color(red: 46.0 / 255.0, green: 204.0 / 255.0, blue: 113.0 / 255.0)
    /// `--green-dim` — 0x1B5E39 (declared once: this token is the same in both themes)
    public static let greenDim = Color(red: 27.0 / 255.0, green: 94.0 / 255.0, blue: 57.0 / 255.0)
    /// `--ink` — 0x000000
    public static let ink = Color(red: 0.0 / 255.0, green: 0.0 / 255.0, blue: 0.0 / 255.0)
    /// `--line` — 0x808080
    public static let line = Color(red: 128.0 / 255.0, green: 128.0 / 255.0, blue: 128.0 / 255.0)
    /// `--line-dark` — 0x000000
    public static let lineDark = Color(red: 0.0 / 255.0, green: 0.0 / 255.0, blue: 0.0 / 255.0)
    /// `--line-light` — 0xFFFFFF
    public static let lineLight = Color(red: 255.0 / 255.0, green: 255.0 / 255.0, blue: 255.0 / 255.0)
    /// `--line-mid` — 0x808080
    public static let lineMid = Color(red: 128.0 / 255.0, green: 128.0 / 255.0, blue: 128.0 / 255.0)
    /// `--maroon` — 0x800000
    public static let maroon = Color(red: 128.0 / 255.0, green: 0.0 / 255.0, blue: 0.0 / 255.0)
    /// `--muted` — 0x404040
    public static let muted = Color(red: 64.0 / 255.0, green: 64.0 / 255.0, blue: 64.0 / 255.0)
    /// `--red` — 0xB94444 (declared once: this token is the same in both themes)
    public static let red = Color(red: 185.0 / 255.0, green: 68.0 / 255.0, blue: 68.0 / 255.0)
    /// `--red-bright` — 0xFF1A1A (declared once: this token is the same in both themes)
    public static let redBright = Color(red: 255.0 / 255.0, green: 26.0 / 255.0, blue: 26.0 / 255.0)
    /// `--win-btn-dark-shadow` — 0x000000
    public static let winBtnDarkShadow = Color(red: 0.0 / 255.0, green: 0.0 / 255.0, blue: 0.0 / 255.0)
    /// `--win-btn-face` — 0xC0C0C0
    public static let winBtnFace = Color(red: 192.0 / 255.0, green: 192.0 / 255.0, blue: 192.0 / 255.0)
    /// `--win-btn-highlight` — 0xFFFFFF
    public static let winBtnHighlight = Color(red: 255.0 / 255.0, green: 255.0 / 255.0, blue: 255.0 / 255.0)
    /// `--win-btn-shadow` — 0x808080
    public static let winBtnShadow = Color(red: 128.0 / 255.0, green: 128.0 / 255.0, blue: 128.0 / 255.0)
    /// `--win-gray` — 0xC0C0C0
    public static let winGray = Color(red: 192.0 / 255.0, green: 192.0 / 255.0, blue: 192.0 / 255.0)
    /// `--win-text` — 0x000000
    public static let winText = Color(red: 0.0 / 255.0, green: 0.0 / 255.0, blue: 0.0 / 255.0)
    /// `--win-title-bg` — 0x000080
    public static let winTitleBg = Color(red: 0.0 / 255.0, green: 0.0 / 255.0, blue: 128.0 / 255.0)
    /// `--win-title-text` — 0xFFFFFF
    public static let winTitleText = Color(red: 255.0 / 255.0, green: 255.0 / 255.0, blue: 255.0 / 255.0)
    /// `--win-window-frame` — 0x000000 (declared once: this token is the same in both themes)
    public static let winWindowFrame = Color(red: 0.0 / 255.0, green: 0.0 / 255.0, blue: 0.0 / 255.0)
    /// `--yellow` — 0xF1C40F (declared once: this token is the same in both themes)
    public static let yellow = Color(red: 241.0 / 255.0, green: 196.0 / 255.0, blue: 15.0 / 255.0)
  }

  /// `body.theme-dark` — only what changes, with the theme-independent tokens restated so a dark-only call site
  /// cannot fall through to nothing. **Never alias a token to another token inside a theme**: that is the trap that
  /// once froze a window to the light palette (see `design/tokens.css`, "The dark theme").
  public enum Dark {
    /// `--accent` — 0x2F9BD8
    public static let accent = Color(red: 47.0 / 255.0, green: 155.0 / 255.0, blue: 216.0 / 255.0)
    /// `--amber` — 0xD0A84E (the kit declares this token in one theme only)
    public static let amber = Color(red: 208.0 / 255.0, green: 168.0 / 255.0, blue: 78.0 / 255.0)
    /// `--crt` — 0x030806
    public static let crt = Color(red: 3.0 / 255.0, green: 8.0 / 255.0, blue: 6.0 / 255.0)
    /// `--crt-ink` — 0x70E7A9
    public static let crtInk = Color(red: 112.0 / 255.0, green: 231.0 / 255.0, blue: 169.0 / 255.0)
    /// `--desk` — 0x0E1111
    public static let desk = Color(red: 14.0 / 255.0, green: 17.0 / 255.0, blue: 17.0 / 255.0)
    /// `--dim` — 0x9AA8A2
    public static let dim = Color(red: 154.0 / 255.0, green: 168.0 / 255.0, blue: 162.0 / 255.0)
    /// `--face` — 0x222726
    public static let face = Color(red: 34.0 / 255.0, green: 39.0 / 255.0, blue: 38.0 / 255.0)
    /// `--face-2` — 0x2B3230
    public static let face2 = Color(red: 43.0 / 255.0, green: 50.0 / 255.0, blue: 48.0 / 255.0)
    /// `--face-3` — 0x1A1E1D
    public static let face3 = Color(red: 26.0 / 255.0, green: 30.0 / 255.0, blue: 29.0 / 255.0)
    /// `--field` — 0x0F1614
    public static let field = Color(red: 15.0 / 255.0, green: 22.0 / 255.0, blue: 20.0 / 255.0)
    /// `--gold` — 0xFFD700 (the kit declares this token in one theme only)
    public static let gold = Color(red: 255.0 / 255.0, green: 215.0 / 255.0, blue: 0.0 / 255.0)
    /// `--green` — 0x2ECC71 (the kit declares this token in one theme only)
    public static let green = Color(red: 46.0 / 255.0, green: 204.0 / 255.0, blue: 113.0 / 255.0)
    /// `--green-dim` — 0x1B5E39 (the kit declares this token in one theme only)
    public static let greenDim = Color(red: 27.0 / 255.0, green: 94.0 / 255.0, blue: 57.0 / 255.0)
    /// `--ink` — 0xE0E8E4
    public static let ink = Color(red: 224.0 / 255.0, green: 232.0 / 255.0, blue: 228.0 / 255.0)
    /// `--line` — 0x343C3A
    public static let line = Color(red: 52.0 / 255.0, green: 60.0 / 255.0, blue: 58.0 / 255.0)
    /// `--line-dark` — 0x0D100F
    public static let lineDark = Color(red: 13.0 / 255.0, green: 16.0 / 255.0, blue: 15.0 / 255.0)
    /// `--line-light` — 0x44504C
    public static let lineLight = Color(red: 68.0 / 255.0, green: 80.0 / 255.0, blue: 76.0 / 255.0)
    /// `--line-mid` — 0x343C3A
    public static let lineMid = Color(red: 52.0 / 255.0, green: 60.0 / 255.0, blue: 58.0 / 255.0)
    /// `--maroon` — 0xFFAB40
    public static let maroon = Color(red: 255.0 / 255.0, green: 171.0 / 255.0, blue: 64.0 / 255.0)
    /// `--muted` — 0x93A49D
    public static let muted = Color(red: 147.0 / 255.0, green: 164.0 / 255.0, blue: 157.0 / 255.0)
    /// `--red` — 0xB94444 (the kit declares this token in one theme only)
    public static let red = Color(red: 185.0 / 255.0, green: 68.0 / 255.0, blue: 68.0 / 255.0)
    /// `--red-bright` — 0xFF1A1A (the kit declares this token in one theme only)
    public static let redBright = Color(red: 255.0 / 255.0, green: 26.0 / 255.0, blue: 26.0 / 255.0)
    /// `--win-btn-dark-shadow` — 0x08090A
    public static let winBtnDarkShadow = Color(red: 8.0 / 255.0, green: 9.0 / 255.0, blue: 10.0 / 255.0)
    /// `--win-btn-face` — 0x222527
    public static let winBtnFace = Color(red: 34.0 / 255.0, green: 37.0 / 255.0, blue: 39.0 / 255.0)
    /// `--win-btn-highlight` — 0x3A3F42
    public static let winBtnHighlight = Color(red: 58.0 / 255.0, green: 63.0 / 255.0, blue: 66.0 / 255.0)
    /// `--win-btn-shadow` — 0x121415
    public static let winBtnShadow = Color(red: 18.0 / 255.0, green: 20.0 / 255.0, blue: 21.0 / 255.0)
    /// `--win-gray` — 0x181A1B
    public static let winGray = Color(red: 24.0 / 255.0, green: 26.0 / 255.0, blue: 27.0 / 255.0)
    /// `--win-text` — 0xE0E6ED
    public static let winText = Color(red: 224.0 / 255.0, green: 230.0 / 255.0, blue: 237.0 / 255.0)
    /// `--win-title-bg` — 0x153243
    public static let winTitleBg = Color(red: 21.0 / 255.0, green: 50.0 / 255.0, blue: 67.0 / 255.0)
    /// `--win-title-text` — 0x70E7A9
    public static let winTitleText = Color(red: 112.0 / 255.0, green: 231.0 / 255.0, blue: 169.0 / 255.0)
    /// `--win-window-frame` — 0x000000 (the kit declares this token in one theme only)
    public static let winWindowFrame = Color(red: 0.0 / 255.0, green: 0.0 / 255.0, blue: 0.0 / 255.0)
    /// `--yellow` — 0xF1C40F (the kit declares this token in one theme only)
    public static let yellow = Color(red: 241.0 / 255.0, green: 196.0 / 255.0, blue: 15.0 / 255.0)
  }

  /// `--accent` for the scheme a view is in.
  public static func accent(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.accent : Light.accent
  }

  /// `--amber` for the scheme a view is in.
  public static func amber(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.amber : Light.amber
  }

  /// `--crt` for the scheme a view is in.
  public static func crt(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.crt : Light.crt
  }

  /// `--crt-ink` for the scheme a view is in.
  public static func crtInk(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.crtInk : Light.crtInk
  }

  /// `--desk` for the scheme a view is in.
  public static func desk(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.desk : Light.desk
  }

  /// `--dim` for the scheme a view is in.
  public static func dim(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.dim : Light.dim
  }

  /// `--face` for the scheme a view is in.
  public static func face(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.face : Light.face
  }

  /// `--face-2` for the scheme a view is in.
  public static func face2(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.face2 : Light.face2
  }

  /// `--face-3` for the scheme a view is in.
  public static func face3(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.face3 : Light.face3
  }

  /// `--field` for the scheme a view is in.
  public static func field(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.field : Light.field
  }

  /// `--gold` for the scheme a view is in.
  public static func gold(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.gold : Light.gold
  }

  /// `--green` for the scheme a view is in.
  public static func green(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.green : Light.green
  }

  /// `--green-dim` for the scheme a view is in.
  public static func greenDim(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.greenDim : Light.greenDim
  }

  /// `--ink` for the scheme a view is in.
  public static func ink(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.ink : Light.ink
  }

  /// `--line` for the scheme a view is in.
  public static func line(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.line : Light.line
  }

  /// `--line-dark` for the scheme a view is in.
  public static func lineDark(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.lineDark : Light.lineDark
  }

  /// `--line-light` for the scheme a view is in.
  public static func lineLight(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.lineLight : Light.lineLight
  }

  /// `--line-mid` for the scheme a view is in.
  public static func lineMid(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.lineMid : Light.lineMid
  }

  /// `--maroon` for the scheme a view is in.
  public static func maroon(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.maroon : Light.maroon
  }

  /// `--muted` for the scheme a view is in.
  public static func muted(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.muted : Light.muted
  }

  /// `--red` for the scheme a view is in.
  public static func red(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.red : Light.red
  }

  /// `--red-bright` for the scheme a view is in.
  public static func redBright(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.redBright : Light.redBright
  }

  /// `--win-btn-dark-shadow` for the scheme a view is in.
  public static func winBtnDarkShadow(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.winBtnDarkShadow : Light.winBtnDarkShadow
  }

  /// `--win-btn-face` for the scheme a view is in.
  public static func winBtnFace(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.winBtnFace : Light.winBtnFace
  }

  /// `--win-btn-highlight` for the scheme a view is in.
  public static func winBtnHighlight(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.winBtnHighlight : Light.winBtnHighlight
  }

  /// `--win-btn-shadow` for the scheme a view is in.
  public static func winBtnShadow(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.winBtnShadow : Light.winBtnShadow
  }

  /// `--win-gray` for the scheme a view is in.
  public static func winGray(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.winGray : Light.winGray
  }

  /// `--win-text` for the scheme a view is in.
  public static func winText(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.winText : Light.winText
  }

  /// `--win-title-bg` for the scheme a view is in.
  public static func winTitleBg(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.winTitleBg : Light.winTitleBg
  }

  /// `--win-title-text` for the scheme a view is in.
  public static func winTitleText(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.winTitleText : Light.winTitleText
  }

  /// `--win-window-frame` for the scheme a view is in.
  public static func winWindowFrame(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.winWindowFrame : Light.winWindowFrame
  }

  /// `--yellow` for the scheme a view is in.
  public static func yellow(for scheme: ColorScheme) -> Color {
    scheme == .dark ? Dark.yellow : Light.yellow
  }
}

/// Type, spacing and the one scale knob — the values that are not colours.
public enum WingTheme {
  /// The CSS font stack the kit carries: "MS Sans Serif", "Microsoft Sans Serif", Tahoma, "Segoe UI", Geneva, sans-serif
  /// Swift names a family, not a stack, so the first family is exposed and the rest is the browser's fallback rung.
  public static let winFont: String = "MS Sans Serif"
  /// The CSS font stack the kit carries: "Lucida Console", "Courier New", Consolas, monospace
  public static let mono: String = "Lucida Console"

  /// `--meter-scale`: the base the type scale is measured from, in points. The JSON names the knob but not its
  /// value, so it lives here and in `scripts/generate-design-tokens.mjs` — and the two are asserted equal.
  public static let meterScaleBase: CGFloat = 1.25

  /// `--font-badge`, from the same `clamp()` in `tokens.css`: floor 8px, growth 1.2px per unit of `--meter-scale`, cap 10px.
  public static let fontBadge: CGFloat = 8
  public static func fontBadge(_ scale: CGFloat = WingTheme.meterScaleBase) -> CGFloat {
    min(10, 8 + (scale - WingTheme.meterScaleBase) * 1.2)
  }

  /// `--font-xs`, from the same `clamp()` in `tokens.css`: floor 8.5px, growth 3.2px per unit of `--meter-scale`, cap 16px.
  public static let fontXs: CGFloat = 8.5
  public static func fontXs(_ scale: CGFloat = WingTheme.meterScaleBase) -> CGFloat {
    min(16, 8.5 + (scale - WingTheme.meterScaleBase) * 3.2)
  }

  /// `--font-sm`, from the same `clamp()` in `tokens.css`: floor 9.5px, growth 3.6px per unit of `--meter-scale`, cap 18px.
  public static let fontSm: CGFloat = 9.5
  public static func fontSm(_ scale: CGFloat = WingTheme.meterScaleBase) -> CGFloat {
    min(18, 9.5 + (scale - WingTheme.meterScaleBase) * 3.6)
  }

  /// `--font-base`, from the same `clamp()` in `tokens.css`: floor 10.5px, growth 2px per unit of `--meter-scale`, cap 13px.
  public static let fontBase: CGFloat = 10.5
  public static func fontBase(_ scale: CGFloat = WingTheme.meterScaleBase) -> CGFloat {
    min(13, 10.5 + (scale - WingTheme.meterScaleBase) * 2)
  }

  /// `--font-lg`, from the same `clamp()` in `tokens.css`: floor 11.5px, growth 2.5px per unit of `--meter-scale`, cap 14px.
  public static let fontLg: CGFloat = 11.5
  public static func fontLg(_ scale: CGFloat = WingTheme.meterScaleBase) -> CGFloat {
    min(14, 11.5 + (scale - WingTheme.meterScaleBase) * 2.5)
  }

  /// `--font-readout`, from the same `clamp()` in `tokens.css`: floor 22px, growth 5.5px per unit of `--meter-scale`, cap 27.5px.
  public static let fontReadout: CGFloat = 22
  public static func fontReadout(_ scale: CGFloat = WingTheme.meterScaleBase) -> CGFloat {
    min(27.5, 22 + (scale - WingTheme.meterScaleBase) * 5.5)
  }

  /// `--font-readout-lg`, from the same `clamp()` in `tokens.css`: floor 26px, growth 6.5px per unit of `--meter-scale`, cap 32.5px.
  public static let fontReadoutLg: CGFloat = 26
  public static func fontReadoutLg(_ scale: CGFloat = WingTheme.meterScaleBase) -> CGFloat {
    min(32.5, 26 + (scale - WingTheme.meterScaleBase) * 6.5)
  }

  /// `--font-clock`, from the same `clamp()` in `tokens.css`: floor 30px, growth 7.5px per unit of `--meter-scale`, cap 37.5px.
  public static let fontClock: CGFloat = 30
  public static func fontClock(_ scale: CGFloat = WingTheme.meterScaleBase) -> CGFloat {
    min(37.5, 30 + (scale - WingTheme.meterScaleBase) * 7.5)
  }

  /// `--font-clock-lg`, from the same `clamp()` in `tokens.css`: floor 52px, growth 13px per unit of `--meter-scale`, cap 65px.
  public static let fontClockLg: CGFloat = 52
  public static func fontClockLg(_ scale: CGFloat = WingTheme.meterScaleBase) -> CGFloat {
    min(65, 52 + (scale - WingTheme.meterScaleBase) * 13)
  }

  /// `--space-1` — 2px in the CSS grid.
  public static let space1: CGFloat = 2
  /// `--space-2` — 4px in the CSS grid.
  public static let space2: CGFloat = 4
  /// `--space-3` — 6px in the CSS grid.
  public static let space3: CGFloat = 6
  /// `--space-4` — 8px in the CSS grid.
  public static let space4: CGFloat = 8
  /// `--space-5` — 12px in the CSS grid.
  public static let space5: CGFloat = 12
  /// `--space-6` — 16px in the CSS grid.
  public static let space6: CGFloat = 16
}

/// The meter ramp, as stops in the gradient's own order. The colours are NOT `WingColor` members: the ramp is one
/// MEASURED gradient of six stops in `tokens.json`, not six palette entries, and giving them token names would
/// invite a view to use the warning band as a status colour.
public struct WingGradientStop: Sendable {
  public let position: Double
  public let color: Color
}

public enum WingGradient {
  /// `--meter-ramp` — green to the reference, warning above it, red at the top.
  public static let meterRamp: [WingGradientStop] = [
    WingGradientStop(position: 0, color: Color(red: 0.0 / 255.0, green: 168.0 / 255.0, blue: 107.0 / 255.0)),
    WingGradientStop(position: 0.56, color: Color(red: 0.0 / 255.0, green: 230.0 / 255.0, blue: 118.0 / 255.0)),
    WingGradientStop(position: 0.56, color: Color(red: 255.0 / 255.0, green: 235.0 / 255.0, blue: 59.0 / 255.0)),
    WingGradientStop(position: 0.82, color: Color(red: 255.0 / 255.0, green: 152.0 / 255.0, blue: 0.0 / 255.0)),
    WingGradientStop(position: 0.82, color: Color(red: 244.0 / 255.0, green: 67.0 / 255.0, blue: 54.0 / 255.0)),
    WingGradientStop(position: 0.99, color: Color(red: 229.0 / 255.0, green: 57.0 / 255.0, blue: 53.0 / 255.0)),
    WingGradientStop(position: 1, color: Color(red: 255.0 / 255.0, green: 0.0 / 255.0, blue: 0.0 / 255.0)),
  ]
}

public extension LinearGradient {
  /// `--meter-ramp` as a gradient. The default direction is the CSS one (`to right`); pass another when the meter
  /// is vertical, which is a decision about the meter and not about the kit.
  static func wingRamp(
    _ stops: [WingGradientStop],
    startPoint: UnitPoint = .leading,
    endPoint: UnitPoint = .trailing
  ) -> LinearGradient {
    LinearGradient(
      stops: stops.map { Gradient.Stop(color: $0.color, location: $0.position) },
      startPoint: startPoint,
      endPoint: endPoint
    )
  }
}
#endif
