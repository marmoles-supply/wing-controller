#!/usr/bin/env bash
# Build-path sanitisation (2026-10-09).
#
# WHY THIS EXISTS
#
# rustc records the path of every source file in two places that end up inside a shipped binary: debug
# information, and the location string attached to anything that can panic (`unwrap`, `expect`, an indexing
# operation, an explicit `panic!`). Cargo compiles dependencies with the **absolute** path of the registry
# copy, so those strings carry whatever the build machine's home directory is called. Measured on
# `target/release/wing-controller-desktop` before this script existed, 2026-10-09: **261 strings containing
# `/Users/<account>`**, most of them `/Users/<account>/.cargo/registry/src/index.crates.io-…/<crate>/src/*.rs`,
# plus one from this repository. `strings` on the shipped application therefore told a reader the account
# name of the machine it was built on and where the project lived — a fingerprint of the builder, shipped to
# every customer.
#
# WHAT IT DOES
#
# `--remap-path-prefix` is rustc's own mechanism for exactly this: the path is rewritten before it is
# recorded, and nothing else about the build changes. The prefixes are read from the environment at build
# time (`$HOME`, the repository's own location, the Homebrew prefix when there is one) so that **no machine
# path is ever written into this repository** — a literal `/Users/<someone>` in a tracked file would be the
# same defect this script exists to remove.
#
# It is exported through `CARGO_ENCODED_RUSTFLAGS`, which separates entries with `\x1f` rather than spaces:
# `RUSTFLAGS` is split on whitespace, so a home directory containing a space would silently mangle the flags
# and the build would carry the path it was supposed to remove.
#
# WHAT IT CANNOT DO, measured rather than assumed
#
# The strings inside a **precompiled** standard library are already bytes in its rlib by the time this
# project is compiled, and rustc does not rewrite them. With Homebrew's Rust those paths are the Cellar's
# own (`/opt/homebrew/Cellar/rust/<version>/lib/rustlib/src/rust/library/…`); with a rustup toolchain they
# are already normalised by the Rust project to `/rustc/<commit>/library/…`. `scripts/audit-binary-shield.mjs`
# counts what survives either way, so the claim stays checkable instead of hopeful.
#
# Sourced, not executed: `. scripts/build-paths.sh` then call `wing_export_sanitised_build_paths`.

# Appends one `--remap-path-prefix` entry to an encoded flag list.
_wing_append_flag() {
  if [ -z "${WING_ENCODED_RUSTFLAGS:-}" ]; then
    WING_ENCODED_RUSTFLAGS="$1"
  else
    WING_ENCODED_RUSTFLAGS="${WING_ENCODED_RUSTFLAGS}$(printf '\x1f')$1"
  fi
}

# Exports the sanitised flags for the rest of this shell, keeping anything the caller already set.
wing_export_sanitised_build_paths() {
  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

  # Anything the caller already asked for stays first; rustc applies prefixes in the order it receives them.
  WING_ENCODED_RUSTFLAGS="${CARGO_ENCODED_RUSTFLAGS:-}"

  # The most specific prefix first: the repository lives under `$HOME`, and a general remap of `$HOME` would
  # otherwise swallow it and send every project path to the same place.
  _wing_append_flag "--remap-path-prefix=${repo_root}=/build/src"
  if [ -n "${HOME:-}" ]; then
    _wing_append_flag "--remap-path-prefix=${HOME}=/build"
  fi
  # A toolchain installed outside `$HOME` (Homebrew on Apple Silicon, or a Homebrew prefix elsewhere).
  if [ -n "${HOMEBREW_PREFIX:-}" ]; then
    _wing_append_flag "--remap-path-prefix=${HOMEBREW_PREFIX}=/toolchain"
  elif [ -d /opt/homebrew ]; then
    _wing_append_flag "--remap-path-prefix=/opt/homebrew=/toolchain"
  elif [ -d /usr/local/Homebrew ]; then
    _wing_append_flag "--remap-path-prefix=/usr/local/Homebrew=/toolchain"
  fi

  export CARGO_ENCODED_RUSTFLAGS="$WING_ENCODED_RUSTFLAGS"
  unset WING_ENCODED_RUSTFLAGS
}
