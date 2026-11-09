#!/usr/bin/env node
// Mints the ONE key pair that signs every licence this project ever issues (2026-10-09).
//
// WHY THE PRIVATE KEY IS NOT IN THIS REPOSITORY, AND NEVER WILL BE
//
// A licence is unforgeable exactly as long as the signing key is. If the key shipped inside the application
// — as a shared secret would — then anyone who extracted it could mint licences for ever, and the extraction
// would be silent and unrevocable. So the private key is generated on the owner's machine, written outside
// the working tree, and the application carries only the **public** key. Verifying needs nothing secret;
// issuing needs everything.
//
// The pair is minted once. Losing the private key is survivable and recovering from a leak is possible,
// because every licence names the key that signed it (`keyId`): a new pair can be minted, its public key
// added to the application beside the old one, and licences signed with either stay valid. That is the
// difference between an incident and an outage, and it is why the script refuses to overwrite an existing
// key rather than quietly replacing one.
//
// Usage:
//   node scripts/licence-keygen.mjs            mint it, if there is not one already
//   node scripts/licence-keygen.mjs --show     print the public key of the existing pair
//
// It never prints private key material, in any mode.

import { generateKeyPairSync, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const KEY_DIR = join(process.env.WING_LICENCE_KEY_DIR ?? join(homedir(), ".wingcontroller"));
const PRIVATE_KEY_PATH = join(KEY_DIR, "licence-signing.key");
const PUBLIC_KEY_PATH = join(KEY_DIR, "licence-signing.pub");

/** The raw 32 Ed25519 public key bytes out of a DER SubjectPublicKeyInfo. */
function rawPublicKey(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32);
}

/** A short, stable id for a public key, so a licence can name the key that signed it. */
function keyId(raw) {
  return createHash("sha256").update(raw).digest("hex").slice(0, 8);
}

function printPublicKey(raw) {
  const bytes = [...raw].map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(", ");
  console.log("");
  console.log("  Public key (paste into the application's verifier):");
  console.log("");
  console.log(`    pub const LICENCE_PUBLIC_KEY: [u8; 32] = [${bytes}];`);
  console.log("");
  console.log(`    key id: ${keyId(raw)}`);
  console.log("");
}

function main() {
  const show = process.argv.includes("--show");

  if (existsSync(PRIVATE_KEY_PATH)) {
    if (!show) {
      console.error(`A signing key already exists at ${PRIVATE_KEY_PATH}.`);
      console.error("Refusing to replace it: every licence issued with it is verified by the public key that");
      console.error("is already in the application, and a replacement would silently invalidate all of them.");
      console.error("Run with --show to print the public key of the existing pair.");
      process.exit(1);
    }
    const raw = readFileSync(PUBLIC_KEY_PATH, "utf8").trim();
    console.log(`The existing pair's public key, from ${PUBLIC_KEY_PATH}:`);
    printPublicKey(Buffer.from(raw, "base64"));
    return;
  }

  if (show) {
    console.error(`There is no signing key at ${PRIVATE_KEY_PATH} yet. Run without --show to mint one.`);
    process.exit(1);
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = rawPublicKey(publicKey);

  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  // `mode` above only applies when the directory is created; enforce it either way, because a key directory
  // somebody else can read is a key somebody else can read.
  chmodSync(KEY_DIR, 0o700);

  writeFileSync(PRIVATE_KEY_PATH, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  chmodSync(PRIVATE_KEY_PATH, 0o600);
  writeFileSync(PUBLIC_KEY_PATH, `${raw.toString("base64")}\n`, { mode: 0o644 });

  console.log("Minted the licence signing key pair.");
  console.log(`  private key: ${PRIVATE_KEY_PATH}  (mode 0600, outside the working tree — never commit it)`);
  console.log(`  public key:  ${PUBLIC_KEY_PATH}`);
  printPublicKey(raw);
  console.log("  Back it up somewhere you control, now, before you sell anything signed with it.");
  console.log("  Losing it is survivable — mint a new pair, add its public key beside this one in the");
  console.log("  application, and licences signed with either keep verifying. Leaking it is the worse case:");
  console.log("  anyone holding it can mint licences that verify, and the only cure is a new key id that the");
  console.log("  application stops accepting — which revokes the honest customers of that key too.");
  console.log("");
  console.log(`  A fresh random marker for your records: ${randomBytes(4).toString("hex")}`);
}

main();
