// The stable signing identity contract (2026-10-05).
//
// macOS anchors a microphone grant to the code requirement of the build it was granted for. An ad-hoc
// signature's requirement is a per-build `cdhash`, so every build was a new code identity: the TCC row still
// said "granted", the grant no longer applied to the next build, and macOS never asked again — the app was
// told there were zero input devices (measured 2026-10-05; AGENTS.md, "Re-signing Ad-Hoc Loses The
// Microphone Grant"). The fix is one stable, certificate-anchored identity, minted by
// `scripts/create-signing-identity.sh` and required by `desktop/build-dist.sh`.
//
// This file is where that is defended, and it defends both halves:
//
//   * the pipeline — no ad-hoc signing path is left in the build, the identity is checked *before* anything
//     is compiled, and verify-install.sh really asserts the identity and the requirement on the shipped
//     copies (a comment claiming it does would pass any test that only greps for words, so the checks below
//     look for the calls that run);
//   * the script — a missing identity is refused with a pointer to the script that creates it and no ad-hoc
//     offer, and the script itself is measured by running it against a throwaway keychain: it creates one
//     usable identity, a second run is a no-op, and it never prints key material.
//
// The throwaway keychain is the point: it measures creation and idempotency without touching the login
// keychain the owner builds with, and without adding any trust setting.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BUILD = `${ROOT}desktop/build-dist.sh`;
const VERIFY = `${ROOT}scripts/verify-install.sh`;
const CREATE = `${ROOT}scripts/create-signing-identity.sh`;
const CHECK = `${ROOT}scripts/check-signing-identity.sh`;

// ---------------------------------------------------------------------------
// 1. The build must not be able to sign ad-hoc, and must not compile before it has looked for the identity.
// ---------------------------------------------------------------------------
assert.ok(existsSync(BUILD), "desktop/build-dist.sh must exist: it is where the application is signed");
assert.ok(existsSync(CREATE), "scripts/create-signing-identity.sh must exist: it is how the identity is made");
assert.ok(existsSync(CHECK), "scripts/check-signing-identity.sh must exist: it is the build's preflight");

const buildSource = readFileSync(BUILD, "utf8");
// Comments are dropped on purpose: the build documents *why* it no longer signs ad-hoc, and that sentence
// mentions the flag. What must not exist is an executable ad-hoc signing call.
const buildCode = buildSource
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");
assert.doesNotMatch(
  buildCode,
  /--sign[= ]+-(\s|$)/m,
  "desktop/build-dist.sh must never sign ad-hoc: an ad-hoc signature is a new code identity on every build, and the microphone grant stops applying to the next one",
);
assert.match(
  buildCode,
  /check-signing-identity\.sh/,
  "the build has to run scripts/check-signing-identity.sh so a machine with no identity finds out before a full compile",
);
assert.match(
  buildCode,
  /WING_SIGNING_IDENTITY/,
  "the build has to sign with the project's identity, resolved through scripts/signing-identity.sh",
);
assert.match(
  buildCode,
  /wing_signing_requirement_pins_certificate|wing_signing_requirement_is_per_build_hash/,
  "the build has to refuse a requirement that is not anchored to the certificate: a signature that verifies is not proof that it is the right identity",
);
const checkIndex = buildCode.indexOf("check-signing-identity.sh");
const compileIndex = buildCode.search(/cargo build/);
assert.ok(checkIndex > -1 && compileIndex > -1 && checkIndex < compileIndex,
  "the identity has to be checked before the compile, not after it");

// The same rule everywhere else in the pipeline, with one deliberate exception: verify-install.sh compiles and
// ad-hoc signs a two-line Mach-O of its own *in a sandbox*, because the unlock helper it tests compares a
// candidate's signature and CDHash and a shell script has neither. That fixture must stay ad-hoc (it is not
// the application, it must not need the owner's keychain, and it must work on a machine with no identity), so
// the contract is: exactly that one call, and no ad-hoc signing of the application or the image anywhere.
const nonComment = (path) => readFileSync(path, "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");
for (const script of [CREATE, CHECK, `${ROOT}scripts/release.sh`]) {
  assert.doesNotMatch(nonComment(script), /--sign[= ]+-(\s|$)/m,
    `${script.replace(ROOT, "")} must not sign ad-hoc`);
}
const verifyCode = nonComment(VERIFY);
const adhocCalls = verifyCode.split("\n").filter((line) => /--sign[= ]+-(\s|$)/.test(line));
assert.deepEqual(adhocCalls.map((line) => line.trim()), ['codesign --force --sign - "$out" > /dev/null 2>&1 || return 1'],
  "verify-install.sh may sign ad-hoc only its own sandbox fixture, never the application or the DMG");
assert.doesNotMatch(verifyCode, /--sign[= ]+-[^\n]*\$(APP_BUILT|APP_INSTALLED|DMG|VOLUME|DMG_RELEASE|ZIP)/,
  "the application, the installed copy and the image must never be signed ad-hoc");

// ---------------------------------------------------------------------------
// 2. verify-install.sh must measure the identity and the requirement on the copies that ship and are installed.
// ---------------------------------------------------------------------------
const verifySource = readFileSync(VERIFY, "utf8");
for (const [pattern, why] of [
  [/check_stable_signature "the app inside the DMG"/, "the app inside the image must be measured, not assumed"],
  [/check_stable_signature "installed copy"/, "the installed copy is the one the operator runs"],
  [/check_stable_signature "the ZIP's executable"/, "the archive's own copy must be measured too"],
  [/Authority=\$\{WING_SIGNING_IDENTITY\}/, "the signature must be compared with the identity by name"],
  [/certificate leaf/, "the requirement must be checked for being anchored to a certificate"],
  [/one designated requirement/, "every copy must carry the same requirement, which is what a grant is matched against"],
]) {
  assert.match(verifySource, pattern, `verify-install.sh: ${why}`);
}

// ---------------------------------------------------------------------------
// 3. A missing identity is refused, loudly, with no ad-hoc offer.
// ---------------------------------------------------------------------------
const refused = spawnSync("bash", [CHECK], {
  env: { ...process.env, WING_SIGNING_IDENTITY: "WING CONTROLLER identity this test invented" },
  encoding: "utf8",
});
assert.notEqual(refused.status, 0, "check-signing-identity.sh must fail when the identity is not in the keychain");
assert.match(refused.stderr, /create-signing-identity\.sh/,
  "the refusal has to say how to create the identity, or the next person is left with a red build and no way forward");
assert.match(refused.stderr, /does NOT fall back to an ad-hoc signature/,
  "the refusal has to say out loud that there is no ad-hoc fallback");
assert.doesNotMatch(`${refused.stdout}${refused.stderr}`, /--sign[= ]+-|ALLOW_ADHOC|fall back to ad-hoc/,
  "the refusal must not leave ad-hoc as an option: ad-hoc is the failure mode this identity exists to remove, not a fallback");

// ---------------------------------------------------------------------------
// 4. Measure the script itself, against a keychain this test creates and deletes.
// ---------------------------------------------------------------------------
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return result;
};
const searchList = () => run("security", ["list-keychains", "-d", "user"]).stdout
  .split("\n").map((line) => line.trim().replace(/^"|"$/g, "")).filter(Boolean);

const work = mkdtempSync(join(tmpdir(), "wing-signing-test."));
const keychain = join(work, "test.keychain-db");
const password = "wing-signing-test";
// A name of its own, deliberately: `codesign --sign <name>` refuses with "ambiguous" when the same Common
// Name exists in two keychains on the search list, and the real identity is in the login keychain while the
// script puts this throwaway one on the list for the duration of the run. That failure is real (it is
// reported by check-signing-identity.sh and by create-signing-identity.sh), and this test must not trip it.
const identityName = `WING CONTROLLER Test Identity ${process.pid}`;
const searchBefore = searchList();
let created = false;
try {
  const make = run("security", ["create-keychain", "-p", password, keychain]);
  assert.equal(make.status, 0, `a throwaway keychain could not be created: ${make.stderr}`);
  created = true;
  run("security", ["unlock-keychain", "-p", password, keychain]);

  const env = {
    ...process.env,
    WING_SIGNING_IDENTITY: identityName,
    WING_SIGNING_KEYCHAIN: keychain,
    WING_SIGNING_KEYCHAIN_PASSWORD: password,
  };
  const first = run("bash", [CREATE, "--no-trust"], { env });
  assert.equal(first.status, 0, `create-signing-identity.sh failed: ${first.stderr || first.stdout}`);
  assert.match(first.stdout, /security delete-identity/,
    "the script has to print the commands that remove the identity it made");
  assert.match(first.stdout, /certificate leaf/,
    "the script has to prove the identity's requirement is anchored to the certificate");
  assert.doesNotMatch(`${first.stdout}${first.stderr}`, /BEGIN [A-Z ]*PRIVATE KEY/,
    "the script must never print the private key");

  const second = run("bash", [CREATE, "--no-trust"], { env });
  assert.equal(second.status, 0, "running the script twice has to be safe");
  assert.match(second.stdout, /already in/,
    "the second run has to report that the identity already exists rather than create a second one");

  const identities = run("security", ["find-identity", "-p", "codesigning", keychain]).stdout;
  assert.equal((identities.match(new RegExp(identityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 1,
    "two runs must leave exactly one identity: a second certificate with the same name would make `codesign --sign <name>` ambiguous");

  // The identity has to be usable, which is what the build actually needs it for. `codesign` resolves a name
  // through the keychain *search list* — `--keychain` alone does not find it (measured 2026-10-05) — so the
  // throwaway keychain is put on the list for this one signing call and the list is put back immediately.
  const probe = join(work, "probe");
  run("cp", ["/usr/bin/true", probe]);
  run("security", ["list-keychains", "-d", "user", "-s", keychain, ...searchBefore]);
  const signed = run("codesign", ["--force", "--sign", identityName, "--keychain", keychain, probe]);
  run("security", ["list-keychains", "-d", "user", "-s", ...searchBefore]);
  assert.equal(signed.status, 0, `codesign could not use the identity the script created: ${signed.stderr}`);
  // `codesign -d -r-` splits its report over both streams, so both are read.
  const requirementOutput = run("codesign", ["-d", "-r-", probe]);
  const requirement = `${requirementOutput.stdout}${requirementOutput.stderr}`;
  assert.match(requirement, /certificate leaf = H"/,
    "the requirement the identity produces has to name the certificate, not a per-build cdhash");
  assert.doesNotMatch(requirement, /cdhash/,
    "a cdhash requirement is the ad-hoc identity this whole contract exists to avoid");

  // Creating and proving an identity must not change where the owner's keychains are looked for.
  const searchAfter = searchList();
  assert.deepEqual(searchAfter, searchBefore,
    `the script must leave the user's keychain search list exactly as it found it (had ${searchAfter.join(", ")})`);
} finally {
  if (created) run("security", ["delete-keychain", keychain]);
  rmSync(work, { recursive: true, force: true });
  // Belt and braces: if a script was killed between adding its keychain and its exit trap, the list is
  // restored here instead of being left pointing at a keychain this test has just deleted.
  if (searchBefore.length > 0) run("security", ["list-keychains", "-d", "user", "-s", ...searchBefore]);
}

console.log("signing identity contract passed: no ad-hoc path in the pipeline, identity created once and only once");
