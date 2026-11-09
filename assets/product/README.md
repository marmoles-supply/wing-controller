# Repository images

These images present WING CONTROLLER 0.3.0 (build 20261109.2). The interface is
rendered from the production HTML/CSS in an isolated browser, without a Tauri
backend. Example macro configurations and labels are synthetic. No operator
files are read, no console is connected, no macro is executed and no audio or
meter signal is simulated. Notices and HUD cards are local visual previews, not
records of hardware actions.

## Files

| File | Purpose |
| --- | --- |
| `hero.png` | 1280 × 640 repository cover / social preview |
| `download-mac.svg` | Linked download control; update its version with the README |
| `workstation-light.png`, `workstation-dark.png` | Full offline workstation examples |
| `macro-detail.png` | Actual WHEN / IF / THEN summary of a five-step example |
| `channel-selection-*.png` | Actual target selector with an example selection |
| `meter-selection-*.png`, `selection-detail.png` | Actual meter picker and selection controls |
| `meter-bridge-*.png`, `meters-detail.png` | Silent Meter Bridge with synthetic labels |
| `notice-*.png`, `hud-*.png`, `messages-detail.png` | Silent local notice/HUD previews |
| `install.png` | Installation summary; instructions also exist as text |
| `action-steps-*.png`, `steps-detail.png` | Full action timeline and composed excerpts of the relative smooth-fade controls |
| `hud-preferences-*.png` | Actual HUD defaults/settings panel |
| `themes.png` | Classic Slate and FOH Low Glare side by side |
| `macro-recipe-*.png`, `macro-trigger-*.png`, `macro-if-*.png` | Same configured macro: summary, trigger tuning and IF editor |
| `fade-*-light.png`, `fade-*-dark.png` | Actual selected fade controls, captured separately for the detail figure |
| `mark.png` | Original project marble W, copied from the application |
| `artboards.html` | Editable HTML/CSS compositions, rather than a flattened design source |
| `media-manifest.json` | Dimensions, hashes, app version/build, UI hash and capture environment |

The `*` suffix denotes light/dark themes. The social preview also needs uploading
in GitHub repository Settings → Social preview; committing the PNG does not set
that image. GitHub recommends 1280 × 640 and a file below 1 MB.
[GitHub instructions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).

## Recreate and review

From the repository root after installing the development dependencies:

```sh
node scripts/render-product-media.mjs
```

Google Chrome is required; `WING_CHROME_BIN` can name another Chrome executable.
The script starts its own fresh browser profile and private port, freezes the
clock/motion and requires two byte-identical captures per output. Run it while
no source gate or other browser suite is running. It leaves the operator's
application, browser profile and saved shows alone. File hashes establish file
identity, not runtime behaviour or hardware compatibility. The manifest records
the source revision at capture; the exact UI file hash also identifies the UI
when the presentation changes are not yet committed.

Review every image visually at full size and at README/mobile width. Refresh
when interface/version labels, the fixture configuration, installation steps or
captions change. Check the README download, SVG version and release link together.
Use `design/screens/` for the separate default-window regression baselines;
product fixtures do not replace or rewrite that record. Never use a screenshot
of a private show or live console configuration without a separate privacy review.

Some detail figures arrange separate real control crops for readability; they
are component excerpts, rather than a second application layout. Full window
images show the interface in place.

## Presentation decisions — 9 November 2026

**D01 — use the app's classic visual language.** DOCUMENTED: the face, bevel,
navy titlebar, teal desktop and system fonts come from `design/tokens.css` and
`desktop/ui/index.html`; the owner explicitly requested the Win95 direction and
plain wording. Consequence: a modest window frame, original W and real UI crops
carry the presentation. Rejected alternative: the first graphite/mint poster with
a large sans-serif headline; the owner found it generic and unrelated to the app.
A future app design change or explicit owner preference would reopen this choice.

**D02 — use reproducible offline examples.** MEASURED: the renderer generates
actual UI crops in a fresh profile and checks stable capture pairs. Consequence:
meters are silent and notices explicitly described as previews. Rejected
alternative: fabricated active meters or captures from the operator's current
show; neither provides suitable public evidence and the latter risks private
data. Consented and redacted real-hardware captures could supplement this set.

Lesson from the first draft: restrained wording alone did not make a generic
promotional layout appropriate. Matching this application's own visual language
is part of making the documentation honest and recognisable.

The original mark, screenshots and compositions are project material under the
repository licence. Third-party names identify compatibility and grant no
trademark rights. The social card and README do not certify performance.
