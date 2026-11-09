//! Build script for the desktop application.
//!
//! Two jobs:
//!
//! 1. [`tauri_build::build`] — the normal Tauri build step (config validation, ACL manifests, the
//!    capabilities schema). Unchanged.
//! 2. The interface vault — `scripts/build-ui-vault.mjs` reads `desktop/ui/**` and encrypts it into this
//!    crate's `OUT_DIR`, where `src/ui_vault.rs` picks it up with `include_bytes!`. That is what stops the
//!    interface travelling in the release binary as readable text; the reasoning is in the generator's
//!    header and in `docs/BINARY_PROTECTION_PLAN_2026-10-09.md`.
//!
//! The vault is built here rather than in `desktop/build-dist.sh` on purpose: `cargo build`, `cargo run`
//! and `cargo test` all go through this file, so none of them can hand out a stale interface or a
//! missing vault. A build that cannot produce the vault fails here, loudly, instead of shipping a binary
//! whose window would open on the damaged-installation page.

use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    tauri_build::build();

    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"));
    let ui_dir = manifest_dir.join("../ui");
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
    let generator = manifest_dir.join("../../scripts/build-ui-vault.mjs");

    // Cargo walks a directory recursively, so one line covers every file the interface is made of: edit
    // `desktop/ui/index.html` and the vault is rebuilt before this crate is recompiled.
    println!("cargo:rerun-if-changed={}", ui_dir.display());
    // The other two halves of the pair, and they are not optional. The vault and the code that reads it are
    // one format: if the generator changes its layout, or `ui_vault.rs` changes how it reads, the vault in
    // `OUT_DIR` is stale and a recompiled reader would meet a vault it cannot decrypt — which is the
    // damaged-installation page in a shipped build. Watching both means any change to either half rebuilds
    // the vault first. (Leaving only the interface watched is a footgun that a gate failure, not a user,
    // would eventually find: the round-trip test reads the same stale vault the binary would.)
    println!("cargo:rerun-if-changed={}", generator.display());
    println!("cargo:rerun-if-changed={}", manifest_dir.join("src/ui_vault.rs").display());

    let output = Command::new("node")
        .arg(&generator)
        .arg(&ui_dir)
        .arg(&out_dir)
        .output()
        .unwrap_or_else(|error| {
            panic!(
                "could not run `node {}`: {error}. Node.js is required to build this application, because \
                 the interface is encrypted at build time (scripts/build-ui-vault.mjs).",
                generator.display()
            )
        });

    if !output.status.success() {
        panic!(
            "the interface vault could not be built, so this binary would ship without its interface.\n\
             command: node {} {} {}\n\
             status: {}\n\
             stdout: {}\n\
             stderr: {}",
            generator.display(),
            ui_dir.display(),
            out_dir.display(),
            output.status,
            String::from_utf8_lossy(&output.stdout).trim(),
            String::from_utf8_lossy(&output.stderr).trim(),
        );
    }
}
