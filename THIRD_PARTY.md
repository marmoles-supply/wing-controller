# Third-party materials and rights review

The project licence covers only original material that its licensors
are entitled to license. It does not replace any dependency licence or grant
rights over third-party manuals, logos or trademarks.

## Measured dependency metadata — 9 November 2026

`package-lock.json` contains 979 dependency entries, all declaring licence
metadata. This is an inventory, not legal clearance of their source contents.
Most entries offer permissive terms; 12 entries are MPL-2.0 (`lightningcss` and
platform variants). `caniuse-lite` declares CC-BY-4.0. `node-forge` offers a
BSD-3-Clause alternative to GPL-2.0.

The locked Cargo graph for `aarch64-apple-darwin`, resolved offline, contains 297
packages: 292 external packages with declared licences and five project crates
whose manifests now refer to the adopted project LICENSE. The MPL-2.0 packages in that graph are `cssparser`,
`cssparser-macros`, `dtoa-short`, `option-ext` and `selectors`. Of 535 registry
packages in Cargo.lock, 78 had no cached manifest available during this review.
Other platforms and future dependency changes require their own inventory.

Do not apply a project-wide no-sale restriction to these independently licensed
components. Distribution must meet their original notice, attribution and, where
applicable, covered-source obligations. Before distributing a binary, generate
and verify the actual dependency notice bundle and corresponding source
information. This overview alone is not that bundle. The public binary packages
include **Legal/** beside the app and inside its Resources: preserved dependency
notices, exact package inventory/checksums, Rust standard-library notices,
MPL-covered pristine crate sources and release-specific source instructions.
The same release also provides `THIRD_PARTY_SOURCES_v0.3.0.tar.gz`, containing
all 292 original crate archives verified against Cargo.lock, including conservative
build/proc-macro dependencies. Their own terms remain unchanged. Upstream objc2
licensing explanations, including its stated SDK-binding uncertainty, are retained;
this inventory does not establish legal clearance for every upstream source file.

## Manuals and assets

Full Maillot manuals and extracted text are excluded. Public availability is not
evidence that this project may redistribute them. Obtain the reference from
[the author's resource](https://x32ram.com/) for local development. The exact
[pinned acquisition procedure](docs/PROTOCOL_REFERENCE.md) reproduces the existing
audit input without redistributing the complete manual.

On 9 November 2026 the owner confirmed MÁRMOLES SUPPLY CO. as copyright holder and
authority to publish the original code, icons and logos. Original project artwork
is covered by LICENSE; third-party Expo/React starter assets and trademarks retain
their upstream terms. Reviewed design renders depict local specimen/demo/offline
fixtures; personal mock labels were generalised before regenerating affected
renders. No manufacturer endorsement or third-party trademark rights are granted.

### Expo starter assets (0BSD)

Seventeen retained assets match the published `expo-template-default@55.1.32`
artefact byte-for-byte: `assets/expo.icon/**`, the React-logo and Expo-badge PNGs,
`expo-logo.png`, `logo-glow.png`, `tutorial-web.png`, and the six PNGs under
`assets/images/tabIcons/`. The more specific template licence is **0BSD**, not the
Expo repository's general MIT licence. Those upstream materials are excluded
from this project's no-sale condition and retain the upstream permissions.

Evidence: [official SDK 55 template licence declaration](https://raw.githubusercontent.com/expo/expo/sdk-55/templates/expo-template-default/package.json),
[npm artefact](https://registry.npmjs.org/expo-template-default/-/expo-template-default-55.1.32.tgz),
SHA-256 `4ef67dd1ac38de13ab53ba165091bc0f114054de106759fd872d23696e3b6e56`.
The exact original generator version is unknown; this identifies a measured
matching upstream distribution. [0BSD licence text](https://opensource.org/license/0bsd).
The Expo and React names/logos remain their respective owners' marks; no endorsement
or trademark permission is granted by this project.
