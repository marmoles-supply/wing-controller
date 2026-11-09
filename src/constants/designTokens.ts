/**
 * Design tokens — single source of truth for the app's surface/border hierarchy.
 *
 * Philosophy: a true NEUTRAL dark-mode base (near-black greys, like zinc) so the
 * app reads as a professional dark tool. Warmth comes ONLY from the accents,
 * which pop against the neutral surfaces — the chrome itself is not tinted.
 * Flat solid colors only (no gradients/shadows) to stay cheap to render.
 *
 * Changing the whole app's chrome is a 7-constant edit here.
 */

// Surfaces, deepest -> raised. Neutral graphite keeps long show sessions calm
// and lets operational color retain meaning.
export const surface0 = '#0B0C0E'; // app background / deepest
export const surface1 = '#121417'; // panels, sidebar panes
export const surface2 = '#191C20'; // cards
export const surface3 = '#23272D'; // raised elements, inputs, pressed rows

// Borders, subtle -> strong. Neutral, tuned to read as hairlines on the surfaces.
export const border0 = '#202329'; // subtle hairline / divider
export const border1 = '#30343C'; // default card/control border
export const border2 = '#454B56'; // strong / emphasized neutral border

// Domain accents — one warm hue per workspace, used sparingly (text, borders,
// dots, active states) AGAINST the neutral surfaces. Never as a fill base.
export const accentMacro = '#F2B45D';      // amber: cues and discrete actions
export const accentAutomation = '#55D6BE'; // teal: continuous mappings
export const accentHa = '#9DB7FF';         // periwinkle: infrastructure and HA
export const accentPrimary = '#72C7F4';    // cool blue: shell selection and focus

// Text hierarchy — three neutral levels. The single biggest driver of legible
// hierarchy: values/titles read bright, labels recede, captions/help recede more.
export const textPrimary = '#F4F5F7';   // key values, titles, primary content
export const textSecondary = '#AEB3BC'; // field labels, secondary info
export const textMuted = '#747A85';     // captions, helper microcopy, hints, disabled

// Semantic state colors (domain-independent).
export const success = '#48D17A'; // green
export const warning = '#F4C95D'; // yellow
export const danger = '#F06A6A';  // red
