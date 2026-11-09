# `design/reference/` — the visual reference, and what is honestly missing from it

The design roadmap (`design/DESIGN-SYSTEM-ROADMAP.md`, ITEM 4) asks this folder for **captioned screenshots of the real
application under both themes**. This README records exactly what is here and exactly what is not, because a reference
folder that looks complete without saying so is the defect the kit itself is written against.

## What is here

Screenshots of **`design/specimen.html`** — not of the application. Each one shows the two themes side by side, and each
token sample prints its name and the value it resolves to in the column beside it. Each image is one **band** of the
page, cut at a section boundary, and the band's page coordinates are part of the record: they are the authority in
`scripts/capture-design-reference.mjs` (`BANDS`), reproduced here so a reader of the images does not have to open a
script.

| File | Page band (y + height at 1600 px wide) | What it shows |
|---|---|---|
| `specimen-components-both-themes.png` | y 0 + 1412 | How to read the page, every component of `UI_SYSTEM.md` §8 — window, panel, card, row, well, field, chip, badge, band, rail, and the `meter` the layer gained on the night of 2026-10-08 — including the `select` with the arrow `components.css` draws, the button in both its states, the card whose head carries a live `Follow` control on the kit's own `card-head-row`, and the two bevels with the `--line-*` step each edge resolves to |
| `specimen-colour-tokens-both-themes.png` | y 1412 + 1632 | The face and the window furniture, the three weights of ink, and the four bevel line steps — one card per token, the light value beside the dark |
| `specimen-instrument-and-type-both-themes.png` | y 3044 + 1052 | The meaning colours of §5, and the instrument: the `--crt` well and its phosphor, the meter ramp, and the `--meter-scale` knob (1.25) |
| `specimen-type-and-space-both-themes.png` | y 4096 + 1337 | The type section — the two families and every step the kit declares with the size it measured, including the `--leading-base` line box drawn on three wrapped lines — the space grid, and the composition layer's two values: the desktop the windows stand on (`--desk`) and the operator column's width (`--ops-col-width`), down to the foot of the page |

The four bands cover the page exactly: 0 → 5433 px, no gap and no overlap. The kit was **1.2.0** when this set was
first taken, **1.4.0** at the re-cut that grew the page by 178 px at the foot — where the first three bands came out
**byte-identical**, which is the measurement that says the growth was only at the foot — and **1.4.1** at the evening
re-cut recorded next.

**The re-cut of 2026-10-08 (evening): 5131 → 5433 px, +302, and all four images changed.** The specimen gained three
samples in the hours after the morning's set was committed, and each one is named here so a reader can tell why the
pictures differ from the ones committed that morning:

1. **The meter sample** (`design/components.css` gained `.c-meter`, `.c-meter-mask`; commit `f55a2ec1`) — three
   readings on the meter, sampled in the **Components** section. It grew band 1 by **162 px**.
2. **The card-head row sample** (`.card-head-row`; commit `52b76abf`) — the card sample's head now carries a live
   `Follow` control on the kit's own head row, also in the **Components** section. It grew band 1 by a further
   **31 px**.
3. **The `--leading-base` sample** (the line box, commit `f49878d5`) — a paragraph wrapped onto three lines, sampled
   in the **Type** section. It grew band 4 by **109 px**.

Bands 2 and 3 keep the heights they had (1632 and 1052): nothing was added inside them, and their `y` moved by the
193 px that bands 1's two additions put above them. All four images are therefore new files, not a refresh of three —
this is the opposite of the morning's re-cut and says the same thing: a page that grows **above** a band re-cuts that
band too, which is the cost of cutting at page coordinates rather than at scroll offsets.

**And that number is the whole point of this file: these images are a dated photograph, and the code wins.** They show
`design/specimen.html` **as it was at the version of the latest re-cut above (1.4.1)**. **The guard is the page, not the kit's version number.** `design/VERSION`
moved to 1.4.2 on the same day the artefact did, and that move changed no token value and nothing `specimen.html`
renders, so these pictures are current at 1.4.2: the `1.4.1` above is the version *at the re-cut*, and a newer
`VERSION` on its own does not make them older than the kit. **What does** is a change to `tokens.json`,
`components.css`, `layout.css` or this page itself - none of which has happened since the re-cut. **When the page
and the pictures disagree, the code is right and the picture is stale** - refresh it with the command below rather
than matching it. Before comparing anything with them, read this date and
that version. It is not hypothetical: this set replaced one taken earlier the same day, because the page gained the four
instrument steps and the base moved to `--meter-scale: 1.25`, and an application that compared against the older
pictures spent an afternoon describing a design the kit no longer had. **When the picture and `VERSION` disagree, the
code is right and the picture is stale** — refresh it with the command below rather than matching it. The same set was
re-cut later on 2026-10-08 when the component layer landed and the page grew from 4891 px to 4953 px: the bands are
page coordinates precisely so that a page which grows cannot leave the foot of the document out of the record. It was
re-cut a third time the same day, from 4953 px to 5131 px, when the composition layer's two samples were added at the
foot — and that is also why the samples went there rather than into the colour section: a page that grows at its foot
re-cuts one band, and a page that grows in the middle re-cuts all of them. It was re-cut a fourth time that evening,
from 5131 px to 5433 px, when the three samples named above landed — and that re-cut is the counter-example to the
third's lesson, because two of the three went into the **first** band and moved all four images. The kit was
**1.4.1** at this re-cut.

Captured 2026-10-08 with headless Chrome 155.0.8059.40 at a 1600 px viewport (device scale factor 1), opening
`file://…/design/specimen.html` with no network. The evening set was written by
`node scripts/capture-design-reference.mjs` — the table above reproduces that script's own `BANDS`, which is the
authority — and the four PNGs were then verified to decode on this machine by `sips` and by a full chunk-CRC +
IDAT-inflate pass, because a consumer of the kit reported that on its machine macOS could not read an earlier set at
all. They carry no console identity: the sample text is invented for the page (`CH 12 · lead vocal`, `Scene 1`,
`01:02:03:04`), never a device name, serial or address.

**These images are of the specimen, not of the application. Never caption them as the application.**

**And this set replaced one that could not be refreshed.** The first four images were captured by hand earlier the same
day, at scroll offsets the README never recorded, so when the specimen changed — four instrument steps
(`DESIGN-SYSTEM-ROADMAP.md` §4l, D-TYPE-4) and the kit's base moving to `--meter-scale: 1.25` (D-TYPE-5) — they showed
five font steps at the older scale while the page carried nine, and a picture that is not refreshed with the code it
describes is a lie with a timestamp. The scroll offsets are what made that a new photograph rather than a refresh; that
is why the bands above are **page coordinates** and why the command that takes them is in the tree. The old set is
superseded, and its date and what it predated are the reason this paragraph is kept rather than deleted.

## What is missing, and why

**The application's own screenshots, in both themes, are not here.** This is a deliberate, measured omission rather than
an oversight, and it needs a person at the desk:

1. **The theme is inside the web view.** The windows read `wing_theme` from `localStorage`, and this project's rules
   forbid driving the packaged application's DOM: it is a `WKWebView`, macOS refuses synthetic clicks into it, and no
   CDP connection reaches it (`AGENTS.md`, "A Control Must Work, Or Say Why Not", point 6). Both themes therefore need
   somebody to switch the theme in the window and take a picture each time.
2. **The window is not capturable from here.** A capture needs a window id or an interactive pick. `pyobjc`/`Quartz` is
   not installed on this machine (`python3 -c "import Quartz"` → `ModuleNotFoundError: No module named 'Quartz'`),
   `screencapture -w` is an interactive selector, and a full-screen region capture would carry whatever else happens to
   be on the screen. **Status: could not establish a way to capture the window; not attempted with a region.**
3. **A live screenshot can carry an identity this project forbids in anything user-visible.** A window connected to a
   console shows that console's own name and address, and `AGENTS.md` forbids a console's identity or address in
   anything the operator reads — an image committed as a reference is read by the next agent as surely as a string is.
4. **The application is installed and was running during this session**, so this is a *needs the desk* item rather than
   a missing capability: measured 2026-10-08, `/Applications/WING CONTROLLER.app` is installed and
   `…/Contents/MacOS/wing-controller-desktop` was running. `version.json` said `0.2.93`. Whether the kit actually looks
   like the application is still **documented, not measured** — which is also what `UI_SYSTEM.md` §12 already says.

The specimen is the closest thing to the missing images: it renders every token and every component the kit defines.
It is no longer a picture of a future application — **all five windows link `design/tokens.css` as of 2026-10-08**, so
what it shows and what the windows draw come from one file, and `design/screens/` holds the windows themselves.

## Refreshing these images

One command, and no build step:

```sh
node scripts/capture-design-reference.mjs              # write the four bands into design/reference/
node scripts/capture-design-reference.mjs --dry-run    # render and report, write nothing
```

It uses the same private Chrome the window lock uses (`scripts/lib/design-screens.mjs`): a fresh profile, a free port
(never 9223), 1600 px wide, device scale factor 1, font hinting off, the time zone pinned to UTC and the clock frozen.
Each band is a **page coordinate** rather than a scroll offset, it is captured **twice** and the two images must be
byte-identical — an image that would differ on the next run is refused, not written — and the page's height is checked
against the last band's end, so a specimen that grew cannot leave its foot out of the record. When the page grows, the
command says so and names the band to re-cut; **the band table in this README and the `BANDS` table in the script are
updated together**, and the numbers above are the record of which part of the page each image is.

**A defect in that guarantee, measured 2026-10-08 while cutting the evening set, and not fixed here because the
writer is `scripts/lib/design-screens.mjs`.** The third band's (`specimen-instrument-and-type-both-themes.png`)
double capture was refused once with

```
Error: the band y=3044 h=1052 of …/design/specimen.html did not stop moving: 1438 of 1683200 pixels
differ (0.085%), in the region x 21..1578, y 934..947 (1558x14) between two captures 260 ms apart.
```

and the same command passed on the next run. The region is exactly `design/specimen.html`'s `.ramp-demo` swatch — the
`--meter-ramp` `linear-gradient` — and the differing pixels are **±1 in a single channel** (`rgb(0,172,107)` against
`rgb(0,172,108)`), which is Chrome's gradient dithering and not a layout change: measured with ten capture pairs of
that band, **1 of 10 pairs differed**. So "captured twice and required to be byte-identical" holds ~9 times in 10 for
the band holding that gradient, and the fix belongs in the writer (pin the gradient's rasterization, or exclude a
dither-only difference) rather than in this README. Nothing in the four images here is known to be stale for it: the
written set came from a run whose two captures agreed, and both this set and the set it replaced contain the same
swatch.
