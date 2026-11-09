# Local protocol reference

Patrick-Gilles Maillot's *WING Remote Protocols* is the primary protocol authority.
The complete manual and extracted text are not redistributed in this repository.
The existing path and model-table checks use the **3.1-03** reference, not whichever
revision happens to be newest on a mutable download link.

Install Poppler (`brew install poppler` on macOS), then run from the source root:

```sh
node scripts/setup-protocol-reference.mjs
node scripts/setup-protocol-reference.mjs --check
```

The setup command uses macOS's proxy-aware `curl` to download the
[manufacturer-hosted reference](https://cdn-media.empowertribe.com/2106004e217b8eb2639d93672823eef5/WING_Remote-Protocols-3.1-03.pdf),
checks its SHA-256, extracts locally with `pdftotext -layout`, and checks the text
SHA-256 before installing `scratch/wing_protocols.txt`. That local directory is
ignored by Git. No console connection or credentials are involved. A different
existing reference is preserved and refused, not replaced silently.

If you obtained the same PDF separately, use
`node scripts/setup-protocol-reference.mjs --pdf /path/to/reference.pdf`.
Poppler 26.08.0 was measured to reproduce the exact text; another version is
accepted only if its output has the identical checksum.

| Input | SHA-256 |
| --- | --- |
| PDF (38,245,609 bytes) | `b4496d27440e47b63729ac16786a631224e4c0a21efb9fda7f378d40ed6589ce` |
| Extracted text (758,869 bytes) | `f06099e4b75c56f4ec0a51c389cac5570de21ed5e2bb2405848e6c81d8cea01d` |

Both hashes and upstream availability were measured on 9 November 2026. Future
availability is outside this project's control. A changed upstream file fails
verification; do not substitute it merely to make the checks pass. An intentional
reference upgrade must review protocol differences, the generated model table
and the path audit together.

Author attribution: Patrick-Gilles Maillot. [Author's resources](https://x32ram.com/wapi/).
Availability for local reading is not a grant to redistribute the complete manual.
