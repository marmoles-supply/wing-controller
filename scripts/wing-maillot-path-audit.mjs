// Cross-checks every OSC address the wing-core target catalogue can resolve
// against the local Maillot reference. Read-only and console-free: it only runs
// `wing-probe paths` and reads `scratch/wing_protocols.txt`.
//
// Why this exists: the extracted PDF text glues footnote references to parameter
// names, so the document shows `/ch/1/gate/thr23` and `/ch/1/eq/lg24` while the
// console only knows `/gate/thr` and `/eq/lg`. Reading the document literally
// produced macOS actions that were silently ignored by the console. Reference
// tails are therefore normalised by stripping trailing digits from all-lowercase
// names before comparing.
//
// Usage: node scripts/wing-maillot-path-audit.mjs [--strict] [--protocols <file>]
//   --strict exits non-zero when any generated address is unknown to the
//   reference or carries a footnote artifact. Without it the script only reports,
//   because the remaining unknowns need read-only console confirmation first.
//   --protocols <file> audits against another copy of the document, so the catalogue can be
//   checked against the version being shipped (e.g. `scratch/wing_protocols_3.1.2.txt`, the
//   FW 3.12 revision) without replacing the reference the rest of the project reads.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProtocolReference } from './lib/protocol-reference.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = process.argv.slice(2);
const protocolsFlag = arguments_.indexOf("--protocols");
const referencePath =
  protocolsFlag >= 0 && arguments_[protocolsFlag + 1]
    ? path.resolve(repoRoot, arguments_[protocolsFlag + 1])
    : path.join(repoRoot, "scratch", "wing_protocols.txt");
const strict = arguments_.includes("--strict");

// A trailing-digit artifact looks like `thr23` or `lg24`: lowercase letters
// followed by digits. Legitimate segments such as `1g` (digit first) or `lvl`
// are untouched.
const normaliseSegment = (segment) => {
  const lower = segment.toLowerCase();
  const match = /^([a-z]+)\d+$/.exec(lower);
  return match ? match[1] : lower;
};
const normalisePath = (address) =>
  address
    .split("/")
    .map(normaliseSegment)
    .join("/");

const generatedRaw = execFileSync("cargo", ["run", "-q", "-p", "wing-probe", "--", "paths"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});

const generated = generatedRaw
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [category, parameter, address] = line.split("\t");
    return { category, parameter, address };
  })
  // `/meters/...` is the project's synthetic meter namespace; Maillot meters are
  // binary (Channel 3) and never OSC paths, so they are out of scope here.
  .filter((entry) => !entry.address.startsWith("/meters/"));

const reference = readProtocolReference(referencePath, { pinned: protocolsFlag < 0 });
const referencePaths = new Set();
const referenceTails = new Set();
for (const line of reference.split("\n")) {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) {
    // The plugin appendices list the model-dependent parameters as numbered names
    // (`0 "mdl":`, `1 "thr":`, `2 "drv":`...). They are the authority for the gate/compressor/EQ
    // paths of each model, so their names count as known tails too (AGENTS.md §6).
    // The extracted PDF uses curly quotes around the parameter names.
    const quoted = /^\s*\d+\s*[\u201c"]([^\u201d"]+)[\u201d"]:/.exec(line);
    if (quoted) referenceTails.add(normaliseSegment(quoted[1]));
    continue;
  }
  // The extraction sometimes breaks an address with a space where a segment separator belongs
  // (`/$ctl/safes /area/RIGHT`, `/$ctl/daw /$on`, `/$globals/custsync /a..c`). Taking the first
  // token alone reads that as the node `/$ctl/safes` and loses the leaf, so the path is rebuilt by
  // joining the tokens that continue it — only while they still start with a slash, which is what
  // keeps a description column from being swallowed.
  const tokens = trimmed.split(/\s+/);
  let token = tokens[0] || "";
  if (!token.startsWith("/")) continue;
  for (const next of tokens.slice(1)) {
    if (!next.startsWith("/")) break;
    token += next;
  }
  referencePaths.add(normalisePath(token));
  const segments = token.split("/");
  referenceTails.add(normaliseSegment(segments[segments.length - 1]));
}

const cleaned = generated.map((entry) => {
  const segments = entry.address.split("/");
  const rawTail = segments[segments.length - 1];
  const tail = normaliseSegment(rawTail);
  const artifact = rawTail !== tail && /^[a-z]+\d+$/.test(rawTail);
  return {
    ...entry,
    tail,
    artifact,
    exact: referencePaths.has(normalisePath(entry.address)),
    tailKnown: referenceTails.has(tail),
  };
});

const artifacts = cleaned.filter((entry) => entry.artifact);
const unknownTail = cleaned.filter((entry) => !entry.tailKnown);
const prefixOnly = cleaned.filter((entry) => entry.tailKnown && !entry.exact);

console.log("Maillot path audit");
console.log("==================");
console.log(`generated addresses : ${cleaned.length}`);
console.log(`known in reference  : ${cleaned.length - unknownTail.length}`);
console.log(`exact path match    : ${cleaned.filter((entry) => entry.exact).length}`);
console.log(`tail known, prefix differs : ${prefixOnly.length}`);
console.log(`unknown parameter   : ${unknownTail.length}`);
console.log(`footnote artifacts  : ${artifacts.length}`);

if (artifacts.length > 0) {
  console.log("\nFootnote-suffixed paths (must be zero):");
  for (const entry of artifacts) console.log(`  ${entry.category}/${entry.parameter} -> ${entry.address}`);
}

if (unknownTail.length > 0) {
  console.log("\nUnknown to the reference (confirm by read-only leaf read before trusting):");
  for (const entry of unknownTail) console.log(`  ${entry.category}/${entry.parameter} -> ${entry.address}`);
}

// Reviewed by hand, and now checked against the review: a differing prefix is expected for the parameters
// the plugin appendices document under another family's table, but an **unreviewed** one must fail. Before
// this, all 88 were tolerated and only 40 were printed, so a new mismatch could hide in the bucket
// (test-suite audit, S6).
const reviewedPath = new URL("maillot-reviewed-prefix-diffs.txt", import.meta.url);
// A missing list is an empty list, not a crash: every prefix mismatch is then unreviewed and the audit fails
// with the message below, which is the useful outcome.
let reviewedText = "";
try {
  reviewedText = readFileSync(reviewedPath, "utf8");
} catch (_) {
  reviewedText = "";
}
const reviewed = new Set(
  reviewedText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")),
);
const rendered = (entry) => `${entry.category}/${entry.parameter} -> ${entry.address}`;
const unreviewed = prefixOnly.filter((entry) => !reviewed.has(rendered(entry)));
const nowExact = [...reviewed].filter(
  (line) => !prefixOnly.some((entry) => rendered(entry) === line),
);

if (prefixOnly.length > 0) {
  console.log("\nParameter documented, family prefix differs (reviewed, not an error):");
  for (const entry of prefixOnly) console.log(`  ${rendered(entry)}`);
  if (nowExact.length > 0) {
    console.log(
      `\n  note: ${nowExact.length} reviewed entr(ies) are no longer a prefix mismatch — they can be removed from`,
    );
    console.log("        scripts/maillot-reviewed-prefix-diffs.txt (not a failure: an exact match is better).");
  }
}
if (strict && unreviewed.length > 0) {
  console.error(
    `\n${unreviewed.length} address(es) differ from the reference and are not on the reviewed list:`,
  );
  for (const entry of unreviewed) console.error(`  ${rendered(entry)}`);
  console.error(
    "\nConfirm each with a read-only leaf read (scripts/wing-osc-gets.mjs) and either fix it or add it to",
  );
  console.error("scripts/maillot-reviewed-prefix-diffs.txt with the reason.");
  process.exit(1);
}

// 2) And it checks the hand-written OSC literals in both windows: the catalogue is the authority,
//    but a stray `"/ch/1/xxx"` in the frontend bypassed this whole audit.
const manualLiterals = [];
for (const file of ["desktop/ui/index.html", "desktop/ui/meters.html"]) {
  const content = fs.readFileSync(path.join(repoRoot, file), "utf8");
  const pattern = /"(\/[A-Za-z][A-Za-z0-9]*(?:\/[A-Za-z0-9$_.-]+)+)"/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const address = match[1];
    if (address.startsWith("/meters/")) continue;
    manualLiterals.push({ file, address, normalised: normalisePath(address) });
  }
}

const asTemplate = (address) =>
  address
    .split("/")
    .map((segment) => (/^[0-9]+$/.test(segment) ? "N" : segment))
    .join("/");

const knownAddresses = new Set(cleaned.map((entry) => asTemplate(normalisePath(entry.address))));
// A literal is not automatically an address: a category *prefix* (`/cfg/talk`, `/$ctl/lib`) is the
// documented **node** the window needs to build the leaves under it, and the reference lists it as
// such. Comparing it against the resolved leaves alone called a documented node an invented address
// the moment the talkback category arrived. A literal is unknown only when it is neither a leaf the
// catalogue resolves nor a node the reference documents.
const knownNodes = new Set([...referencePaths].map((address) => asTemplate(normalisePath(address))));
const literalIsKnown = (entry) =>
  knownAddresses.has(asTemplate(entry.normalised)) || knownNodes.has(asTemplate(entry.normalised));
const unknownLiterals = manualLiterals.filter((entry) => !literalIsKnown(entry));
const nodeLiterals = manualLiterals.filter(
  (entry) => !knownAddresses.has(asTemplate(entry.normalised)) && literalIsKnown(entry),
);

if (manualLiterals.length > 0) {
  const suffix =
    nodeLiterals.length > 0 ? ` (${nodeLiterals.length} of them documented nodes, not leaves)` : "";
  console.log(`OSC literals in the UI  : ${manualLiterals.length}${suffix}`);
}
if (unknownLiterals.length > 0) {
  console.log("\nUI literals the catalogue does not resolve (route them through target_catalog):");
  for (const entry of unknownLiterals) console.log(`  ${entry.file}: ${entry.address}`);
}

// A probe that prints nothing is not a clean audit, it is no audit: with no addresses every list below
// is empty and `--strict` used to exit 0 having judged nothing (audit 2026-10-02, S6).
if (cleaned.length < 100 || manualLiterals.length === 0) {
  console.error(
    `\nNothing was judged: ${cleaned.length} generated address(es), ${manualLiterals.length} hand-written ` +
      "literal(s). A run that inspects nothing must not pass.",
  );
  process.exit(1);
}

if (strict && (artifacts.length > 0 || unknownTail.length > 0 || unknownLiterals.length > 0)) {
  console.error("\nstrict mode: unresolved paths remain");
  process.exit(1);
}
