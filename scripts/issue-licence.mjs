#!/usr/bin/env node
// Issues one licence (2026-10-09). The owner's tool: it is the only thing that can create one, because it is
// the only thing that holds the signing key.
//
// THE FILE, AND WHY IT IS SHAPED THIS WAY
//
//     <base64url of the payload bytes> "." <base64url of the Ed25519 signature over those bytes>
//
// The signature is over **the exact bytes stored in the file**, not over a re-serialisation of the parsed
// JSON. That is the whole trick: canonical JSON is a swamp — key order, whitespace, number formatting, unicode
// escaping — and every implementation that signs a *re-serialised* payload eventually disagrees with its
// verifier about some byte and starts rejecting honest licences. Here the verifier decodes the bytes,
// verifies them, and only then parses them, so there is nothing to canonicalise and nothing to disagree about.
//
// The payload is deliberately readable to a human who base64-decodes it, because an operator who is told
// "licence expired" is entitled to see what their licence actually says.
//
// Usage:
//   node scripts/issue-licence.mjs --machine                          print this machine's id, for testing
//   node scripts/issue-licence.mjs --holder "Name" --machine <id>     a perpetual licence
//   node scripts/issue-licence.mjs --holder "Name" --machine <id> --days 33 --kind trial
//   node scripts/issue-licence.mjs --verify <file>                    check one you just issued
//
// It never prints private key material.

import { createHash, createPrivateKey, createPublicKey, randomUUID, sign as edSign, verify as edVerify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEY_DIR = join(process.env.WING_LICENCE_KEY_DIR ?? join(homedir(), ".wingcontroller"));
const PRIVATE_KEY_PATH = join(KEY_DIR, "licence-signing.key");
const PUBLIC_KEY_PATH = join(KEY_DIR, "licence-signing.pub");
const TRIAL_DAYS = 33;
const MAX_PAYLOAD_BYTES = 4096;

function flag(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function has(name) {
  return process.argv.includes(`--${name}`);
}

function fail(message) {
  console.error(`issue-licence: ${message}`);
  process.exit(1);
}

/** This machine's stable hardware UUID. The same value the application reads to anchor a licence. */
function machineId() {
  const out = execFileSync("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" });
  const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out);
  if (!match) fail("could not read IOPlatformUUID from ioreg; that is the machine anchor, so refusing to guess");
  return match[1];
}

function signingKey() {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    fail(
      `there is no signing key at ${PRIVATE_KEY_PATH}. Mint one first:\n` +
        `  node scripts/licence-keygen.mjs`,
    );
  }
  return createPrivateKey(readFileSync(PRIVATE_KEY_PATH, "utf8"));
}

function encode(payloadBytes, signatureBytes) {
  return `${payloadBytes.toString("base64url")}.${signatureBytes.toString("base64url")}\n`;
}

/** Decode and verify a licence file's own bytes. Returns the payload object, or throws with the reason. */
function openLicence(text, publicKey) {
  const trimmed = text.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 2) fail("a licence is two base64url parts joined by a dot, and this file is not that");
  const [payloadB64, signatureB64] = parts;
  let payloadBytes;
  let signatureBytes;
  try {
    payloadBytes = Buffer.from(payloadB64, "base64url");
    signatureBytes = Buffer.from(signatureB64, "base64url");
  } catch {
    fail("the licence is not valid base64url");
  }
  if (payloadBytes.length === 0 || payloadBytes.length > MAX_PAYLOAD_BYTES) {
    fail(`the payload is ${payloadBytes.length} bytes; refusing to look at that`);
  }
  if (signatureBytes.length !== 64) fail(`an Ed25519 signature is 64 bytes and this one is ${signatureBytes.length}`);
  if (!edVerify(null, payloadBytes, publicKey, signatureBytes)) {
    fail("the signature does not verify against this key pair — this file was not issued by it, or it was edited");
  }
  try {
    return JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    fail("the payload is signed but is not JSON, which means this tool wrote it wrong");
  }
}

function main() {
  // `--machine` on its own prints this machine's id, which is what the owner needs to prepare a test licence
  // here; `--machine <id>` names the customer's. They are told apart by what follows the flag, because a
  // presence test cannot tell them apart and reading `--machine <id>` as "print mine" would fail the one path
  // the tool exists for.
  const machineAt = process.argv.indexOf("--machine");
  const next = machineAt === -1 ? undefined : process.argv[machineAt + 1];
  if (machineAt !== -1 && (next === undefined || next.startsWith("--"))) {
    console.log(machineId());
    return;
  }

  if (!existsSync(PUBLIC_KEY_PATH)) {
    fail(`there is no public key at ${PUBLIC_KEY_PATH}. Mint the pair first:\n  node scripts/licence-keygen.mjs`);
  }
  const rawPublicKey = Buffer.from(readFileSync(PUBLIC_KEY_PATH, "utf8").trim(), "base64");
  if (rawPublicKey.length !== 32) {
    fail(`the public key file holds ${rawPublicKey.length} bytes; an Ed25519 public key is 32`);
  }
  // Node cannot be handed a bare 32-byte Ed25519 key: it needs a SubjectPublicKeyInfo, and the 12-byte prefix
  // for Ed25519 is fixed. Measured on this machine rather than assumed: rebuilt this way, the key verifies a
  // real signature and rejects a tampered payload.
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawPublicKey]),
    format: "der",
    type: "spki",
  });
  // The same short id `licence-keygen.mjs` prints, so a licence names the key that signed it and a rotation
  // can add a second accepted key instead of invalidating every licence already sold.
  const keyId = createHash("sha256").update(rawPublicKey).digest("hex").slice(0, 8);

  if (flag("verify")) {
    const payload = openLicence(readFileSync(flag("verify"), "utf8"), publicKey);
    console.log(`Verified. This licence says:\n${JSON.stringify(payload, null, 2)}`);
    return;
  }

  const holder = flag("holder");
  const machine = flag("machine");
  const kind = flag("kind") ?? "full";
  const days = flag("days");
  const perpetual = has("perpetual");

  if (!holder) fail('--holder "Name" is required: a licence that does not name who holds it cannot be supported');
  if (!machine) fail("--machine <id> is required: every licence is anchored to one Mac. Get the customer's with\n  node scripts/issue-licence.mjs --machine   (run on their machine)");
  if (kind !== "trial" && kind !== "full") fail(`--kind is "trial" or "full", not "${kind}"`);
  if (days && perpetual) fail("--days and --perpetual are different licences; pick one");
  if (kind === "trial" && perpetual) fail("a trial that never expires is not a trial");

  const issuedAt = new Date();
  let expiresAt = null;
  if (kind === "trial") {
    const length = days ? Number(days) : TRIAL_DAYS;
    if (!Number.isFinite(length) || length <= 0) fail(`--days must be a positive number, not "${days}"`);
    expiresAt = new Date(issuedAt.getTime() + length * 24 * 60 * 60 * 1000);
  } else if (days) {
    const length = Number(days);
    if (!Number.isFinite(length) || length <= 0) fail(`--days must be a positive number, not "${days}"`);
    expiresAt = new Date(issuedAt.getTime() + length * 24 * 60 * 60 * 1000);
  }

  // The times travel BOTH as RFC 3339 (what a human reads when they decode the file, and what a support
  // conversation quotes) and as Unix seconds (what the application compares). The integer is the one that
  // decides, because comparing date strings is only correct while every issuer writes the same format and
  // offset, and this application should not carry a date-parsing dependency to avoid that trap.
  const payload = JSON.stringify({
    v: 1,
    id: randomUUID(),
    kind,
    holder,
    machine,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    issuedAtUnix: Math.floor(issuedAt.getTime() / 1000),
    expiresAtUnix: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null,
    keyId,
  });
  const payloadBytes = Buffer.from(payload, "utf8");
  const signature = edSign(null, payloadBytes, signingKey());
  const text = encode(payloadBytes, signature);

  // Verify our own output before writing it. An issuing tool that can write a licence its own verifier
  // rejects is a support ticket waiting to happen, and the check costs microseconds.
  openLicence(text, publicKey);

  const slug = holder.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "licence";
  const out = flag("out") ?? `${slug}-${kind}.winglicence`;
  writeFileSync(out, text, { mode: 0o644 });

  console.log(`Issued a ${kind} licence for ${holder} on machine ${machine}.`);
  console.log(`  valid from ${issuedAt.toISOString()}`);
  console.log(`  expires    ${expiresAt ? expiresAt.toISOString() : "never (perpetual)"}`);
  console.log(`  written to ${out}`);
  console.log("");
  console.log("  Send that file to the customer. They add it in the application's licence panel.");
}

main();
