# `design/screens/` — the visual record of this application, and its lock

Ten images: every window of WING CONTROLLER, in both themes, at a fixed viewport. They are the picture a person
reviews, and `scripts/test-design-screens.mjs` is what keeps them from going stale. `design/reference/` holds the
kit's own specimen; **this folder holds the application**, and the two are meant to be looked at side by side.

| Image | Window | Theme | Size |
|---|---|---|---|
| `index-light.png` · `index-dark.png` | Main control window (`desktop/ui/index.html`) — connection, macro library, macro editor, inspector | light · dark | 1600×1000 |
| `meters-light.png` · `meters-dark.png` | Live meter bridge (`desktop/ui/meters.html`) | light · dark | 1600×1000 |
| `timecode-light.png` · `timecode-dark.png` | Timecode (MTC) clock (`desktop/ui/timecode.html`) | light · dark | 1600×1000 |
| `ltc-light.png` · `ltc-dark.png` | LTC cue list and inspector (`desktop/ui/ltc.html`) | light · dark | 1600×1000 |
| `guide-light.png` · `guide-dark.png` | Complete guide (`desktop/ui/guide.html`) | light · dark | 1600×1000 |

The file name is the window and the theme, so a reader knows both without opening anything.

**Current renderer record, 2026-11-10:** the exact screenshot test explicitly uses
software compositing (`--disable-gpu`). Automatic compositing produced two different
images from the same bitmap and geometry. Five complete captures on each of two
Macs repeated exactly (100 images); eight images also match between machines and
two native numeric-input variants live in `github-macos26/`. See
`SOFTWARE_RENDERER_REVIEW_2026-11-10.json`, `renderer-profiles.json` and
the [test audit](../../docs/TEST_AUDIT_2026-11-09.md). This affects the screenshot
test's own browser; the application and other browser callers retain their renderer.

**Historical measurement, 2026-10-08:** these ten were refreshed and checked against the tree at that date: `node scripts/test-design-screens.mjs` reported **all ten byte-identical to a fresh render at 1600 px in
both themes** (1,092,300 bytes, `design-screens: 10 image(s) in design/screens/ are exactly what this tree renders
today`). That matters to a consumer for a reason this folder exists to make visible: the images a consumer is sent to
look at are only worth looking at while they are current, and **a consumer who reads only the pictures learns an
application that may already have moved.** They are a photograph of this tree at the commit that wrote them, not a
promise about the next one.

## What was captured, and how

**1600 × 1000, device scale factor 1**, the top of the window as it opens. 1600 px is the width `design/reference/`
already uses, so the two folders can be compared without rescaling. The main window and the guide scroll past one
screenful (the current main window's document is 2024 px tall); the image shows the window, not the document, and every
image is the same size so ten of them can be compared at a glance. A record taken at two different widths is a
record nobody can compare, which is why the size is fixed and why the lock refuses a file at another size.

**The window is rendered with no backend**, opened as `file://` with no Tauri process behind it. That is a
deliberate, honest choice rather than a shortcoming:

- the state is **deterministic** — no console identity, no serial, no IP that belongs to a machine, nothing that
  depends on what happened to be connected, and the timecode windows show `--:--:--:--` with their own sentence
  saying they are not running with the backend;
- it is the state the windows paint the **kit** in, which is what these images are for: the type scale, the
  bevels, the two palettes, the wells, the vocabulary;
- what it is **not** is a picture of a live session. Meters with signal on them, a populated cue list, a connected
  console and a log carrying real events are all one step beyond what a repository can reproduce offline, and a
  fabricated session would be exactly the kind of picture this project refuses to ship.

**The wall clock is frozen** to `2026-01-01T09:00:00Z` and the time zone is pinned to UTC for the render, so the
main window's session log reads `09:00:00 app_start …` instead of the minute the render happened. Without this the
index images differ between two runs of the same tree — measured: 119 pixels, in the log pane's timestamp, and that
alone would have made the lock fail on a tree nobody had changed.

**The version string is in the picture** (currently `v0.3.0`, with `build 20261109.2` in the guide footer;
the historical measurement below used `v0.2.95` / `build 20261008.2`). That is on
purpose: a new version is a new window, and the lock should say so rather than silently accepting a stale picture.
**Which makes a release a change to this folder** — eight of the ten images carry the string, and they move by 34–91
pixels when it changes. Measured on 2026-10-08, when `099bc56c` bumped `version.json` and did not refresh: each of the
eight differed inside the version badge or the build mark, `./scripts/verify-all.sh --quick` went red on this lock, and
the cause was **proved rather than inferred** — a scratch copy of `desktop/ui/` with **only** `version.js`'s `version`
and `build` put back renders all ten committed images byte-identical. The lock was telling the truth; the release had
left its own gate red.

## The rules that go with these files

> **A UI change arrives with its refreshed images in the same commit.**

Not in a follow-up commit, and not "when there is time". The images are the record a person reviews, and a stale
one is worse than none: it is a picture of an interface that no longer exists, presented as the present. That is why
the rule is a **test**, not a sentence in a document:

```sh
node scripts/test-design-screens.mjs          # 0 the record matches, 1 a screen moved, 3 nothing was measured
node scripts/test-design-screens.mjs --write  # refresh design/screens/ — read the failure first, then run this
```

`--write` is the deliberate act. It is not a way to make a red test green: read the failing sentence, look at the
window, look at `design/reference/` beside it, and only then refresh. A refreshed image is a **claim** that the
window is right, not evidence that it is.

> **A release that moves the version string refreshes `design/screens/` in the same change.**

The version badge and the build mark are drawn in these images, so bumping `version.json` is a change to this folder
whether or not a window was edited — and a release that skips it blocks its own gate, because `--quick` runs this lock.
The refresh is `node scripts/test-design-screens.mjs --write` in the release commit, and what it moves is only the
version text: that is checkable, and was checked, by rendering a copy whose `desktop/ui/version.js` is put back to the
previous `version`/`build`. `design/reference/` is outside this rule — it is the kit's specimen rather than the
application, and its own refresh is `node scripts/capture-design-reference.mjs`.

## What the lock catches, and what it honestly cannot

**How much movement is a failure: any movement, down to a single pixel — and the pixel count it prints is for the
reader, not a threshold.** `scripts/test-design-screens.mjs` compares the committed image with the fresh render **byte
for byte first** (`committed.equals(result.bytes)`), and a byte difference is a failure whatever the pixels say: the
special case it calls out by name is "the same pixels but not byte-identical" (the encoder changed, or the file is not
the one this tree produces), and even that is red. Only when the bytes differ does the pixel comparison run, and it
exists to turn "these differ" into a sentence a person can act on — which window, which theme, how many pixels and
where. **There is no tolerance, no percentage and no count below which a difference is accepted**: one pixel of
movement is a failure, and 412 pixels is a failure for the same reason, printed with its region so the reader can see
what moved. Two consequences worth knowing before you argue with it: an image that is one byte different but
pixel-identical still fails, and a run that mistakes the platform for the window (below) fails too — so the answer to
a red lock is to look at the fresh render and decide, never to look for a threshold to raise.

The test renders the whole record a second time, into a scratch directory under `/tmp` — **never** into
`design/screens/`, because a test that rewrites the artefact it checks is a test that can never fail — and compares
that fresh render with what is committed. It passes silently when they match. When they differ it names the window,
the theme and how much moved, in this shape:

```
index window, light theme: 412 of 1600000 pixels differ (0.026%), in the region x 1184..1215, y 1496..1531
(32x36); the recorded image is design/screens/index-light.png and the fresh render is
/tmp/wing-screens-test-XXXXXX/index-light.png
```

**And it catches the platform leaking in, which is not the same thing as a change.** Measured twice on 2026-10-08,
while the five windows were migrated to the kit's component layer: deleting a control rule can leave the element to the
user agent, and the browser draws its own control from **its** colour scheme rather than the page's — a bare `<input>`
painted `rgb(59, 59, 59)` with white ink *inside a light window*, and a `button` with no `font-size` anywhere painted
the platform's `400 13.3333px`. Neither is visible in a diff of the stylesheet; both were obvious the moment the fresh
render was put beside the recorded one. That is the second thing this lock is for: **when a control stops being drawn
by the kit, something else draws it, and that something else is usually the platform.**

**This lock catches change, not ugliness.** It can tell that a window was altered; it cannot tell whether the window
*resembles the kit*. Nothing here judges the type scale, the palette or the vocabulary — a window that replaced the
whole type scale and reassigned the kit's names would still pass, exactly as a real consumer passed the conformance
suite with 0 failures in both themes while looking nothing like the specimen. That question is answered by a person
or an agent **looking at these images beside `design/reference/`**, and a test that pretended otherwise would be the
same defect the suite already had. The lock's job is narrower and it does it exactly: it makes the picture arrive
with the code, so the person who looks has something true to look at.

## Determinism, and what would break it

Two independent renders of this tree produce **byte-identical** files — measured with `shasum -a 256` over both
whole sets, not by eye, and the renderer additionally refuses any image whose two consecutive captures disagree
rather than committing a picture that is still moving. What makes it true, and what would break it:

| Kept deterministic by | Broken by |
|---|---|
| A private Chrome, fresh profile, private port (never 9223), screenshot-only `--disable-gpu`, `--force-device-scale-factor=1`, `--font-render-hinting=none`, `TZ=UTC`, `--lang=en-US` | A changed renderer, or a machine whose font set or hinting differs; changed version strings alone are logged, not treated as a pixel change |
| Every animation, transition, caret and smooth-scroll disabled by injected CSS, and the page sampled twice | A new animation the freeze does not reach, or a page that renders from a live clock |
| The clock frozen and the time zone pinned; no network (`file://` only) | A date, a random value or a fetch in the UI; a locale-dependent format |
| A fixed 1600 × 1000 viewport, captured from the viewport | A CSS change that makes a window's own height part of the layout |
| The encoder: identical pixels produce identical bytes (Chrome 155.0.8059.40, measured) | A Chrome whose PNG encoder changes its output for the same pixels — the lock would report "same pixels, different bytes", which is its own sentence |

The version string is the one legitimate source of a byte difference between two days, and it is supposed to be.

## Cost, and whether it belongs in git

**1,184,122 bytes for the ten shared images**, plus109,251 bytes for the two
hosted native-input variants (measured2026-11-10). That is committed binary, and it is worth paying for here: the whole point of this record is that a
reviewer opens it **from the repository**, at the commit under review, without a build, a console or a desk. A
picture stored outside the history cannot answer "did this look like this before?" — and these ten files are
regenerated only after review when the UI or renderer changes, not on every run.

The honest alternative, if it ever becomes too expensive: capture only the **top 1000 px of the two largest
windows** (the main window and the guide are ~82 % of the total) or shrink the viewport to 1280 px, either of which
halves the folder. Both make the record less useful, so the trade is worth taking only if the size is actually
being felt. What is **not** an alternative is keeping the images out of git and promising to "share a screenshot":
that is a request that survives until the first deadline.

## Refreshing by hand

```sh
node scripts/test-design-screens.mjs --write   # renders every window in both themes and rewrites this folder
node scripts/test-design-screens.mjs --only meters   # one window, to check a change before the full run
git add design/screens && git commit           # in the same commit as the CSS or HTML change
```

The renderer is `scripts/lib/design-screens.mjs` — the viewport, the frozen clock, the private browser and the
comparison live there, in one place, so the lock and the refresh cannot disagree about what a screen image is.
