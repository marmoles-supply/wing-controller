// `report.mjs` — the drift dashboard: *app · kit version · how far behind · deviations declared · last conformance
// run*, as one command.
//
// It is the third mechanism of `DESIGN-SYSTEM-ROADMAP.md` §4 ITEM 5, and the one that turns "all my apps look the
// same" from a wish into **a number**. `run.mjs` judges one app against the copy of the kit beside it; this file
// answers the fleet question that per-app judgement cannot: which app is behind, and what did each one deviate on.
//
//   node design/conformance/report.mjs [--root <dir>] [--json [file]] [--kit <dir>]
//                                     [--fail-on-behind] [--fail-on-missing-declaration] [--quiet]
//
// Nothing is configured. The report reads the declared files:
//
//   * **an app declares itself** in one of three homes, all of them read with no configuration: its own
//     `design/conformance/allow.mjs` (or `conformance/allow.mjs`), or — where this application keeps it — an
//     `allow.mjs` **beside the copy of the kit it shipped** (`desktop/ui/design-tokens.css` next to
//     `desktop/ui/allow.mjs`). `kitVersion` is the truth about the copy the app took (`run.mjs` checks it against the
//     copy beside it), `allowApp` is where that app's window lives, and `deviations` are the differences it is
//     allowed to have — each with a reason. The report prints them, with their reasons, so a declared deviation is
//     *reported as declared* on the fleet view too, never silently allowed.
//   * **the last conformance run** is the sibling file `run.json`, written by
//     `run.mjs ... --record [path]` (see `CONFORMANCE_RUN_FILE` below). An app that has never recorded one says
//     `never` — out loud, rather than looking checked.
//   * **the kit's version** is `design/VERSION` (the authority, roadmap §4 ITEM 1): the copy beside this report, or
//     the directory named by `--kit`.
//
// "How far behind" is measured against the **newest version any app or the kit declares**, from the declared files
// alone. It is deliberately not measured against a registry that does not exist, and it does not need the network:
// if every consumer is at 1.0.0 and one is at 0.9.0, the fleet itself says which one is behind. The limit of that
// reading is stated where it belongs, in the `NOTES` at the foot of every report: a fleet where every app is equally
// stale looks up to date, and only a human reading the kit's history can say otherwise.
//
// Exit codes: 0 the report was produced · 1 the caller asked to be failed on something it found
// (`--fail-on-behind`, `--fail-on-missing-declaration`) · 2 the report could not run (the root does not exist, the
// command line is wrong). The same 0/1/2/3 discipline as `run.mjs`, and for the same reason: a report that could not
// run must never be read as a fleet that is fine.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CONFORMANCE_DIR = dirname(fileURLToPath(import.meta.url));
/// The kit as seen from this file (`design/conformance/` -> `design/`).
export const KIT_DIR = resolve(CONFORMANCE_DIR, '..');
export const ALLOW_FILE = 'allow.mjs';
/// The last runs of one app, written beside its allowance: `{ "runs": [ { at, app, kitVersion, code, failures,
/// declared } ] }`, newest first. It is a *record*, not a declaration — an app that has never run the suite has no
/// file, and the report says `never` rather than guessing.
export const CONFORMANCE_RUN_FILE = 'run.json';
export const MAX_RECORDED_RUNS = 20;

/// Directories a fleet walk never descends into: build output and vendored trees hold copies of the kit that nobody
/// declares, and finding them would be noise the row-per-app table cannot carry.
const PRUNE = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'target', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.venv', 'venv', '__pycache__', '.cache', 'Pods',
]);

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------
/// `1.0.0` -> `[1, 0, 0]`. Anything that is not a dotted numeric version returns null and is compared as text only,
/// so a pre-release label never silently reads as a number.
export function versionParts(version) {
  const text = String(version == null ? '' : version).trim();
  if (!/^\d+(\.\d+)*$/.test(text)) return null;
  return text.split('.').map((part) => Number(part));
}

/// -1 / 0 / 1, numeric segment by numeric segment (`1.0.0` is newer than `0.9.0`, which text comparison gets wrong).
/// A version that is not dotted-numeric sorts below one that is; two such versions fall back to text.
export function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  if (left && right) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const one = left[index] || 0;
      const other = right[index] || 0;
      if (one !== other) return one < other ? -1 : 1;
    }
    return 0;
  }
  if (left && !right) return 1;
  if (!left && right) return -1;
  return String(a).localeCompare(String(b));
}

/// How far behind, in the operator's words. The level is the **first segment that differs** (`0.9.0` against `1.0.0`
/// differs at the major segment, because 0.9.0 is the last of the 0 line), and the count is how many steps are missing
/// at that level: within the same major, patch releases are counted by their own number (`1.0.0` -> `1.0.3` is three
/// patch releases); a different minor or major is one release, because that is the step the notes describe. It is
/// deliberately not invented beyond that: a precise-looking number over an imprecise comparison is a lie this project
/// keeps finding.
export function versionsBehind(version, target) {
  if (!version || !target) return null;
  if (compareVersions(version, target) >= 0) return 0;
  const left = versionParts(version);
  const right = versionParts(target);
  if (!left || !right) return null;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const one = left[index] || 0;
    const other = right[index] || 0;
    if (one === other) continue;
    return {
      releases: index === 2 ? other - one : 1,
      level: index === 0 ? 'major' : index === 1 ? 'minor' : 'patch',
      from: left.slice(0, index + 1).join('.'),
      to: right.slice(0, index + 1).join('.'),
    };
  }
  return null;
}

/// `a minor release behind (1.0 -> 1.1)`, the phrase the table prints. A bare number is never printed for a minor or
/// major step: "1 release behind" would hide *which* release is missing, and the reader is an agent that has to fetch
/// the right copy.
export function behindPhrase(behind) {
  if (behind === null || behind === undefined) return 'unknown (no kitVersion declared)';
  if (!behind.releases) return 'up to date';
  const releases = behind.level === 'patch'
    ? `${behind.releases} patch release${behind.releases === 1 ? '' : 's'}`
    : behind.level === 'major'
      ? 'a major release'
      : 'a minor release';
  return `${releases} behind (${behind.from} -> ${behind.to})`;
}

// ---------------------------------------------------------------------------
// Reading the declared files
// ---------------------------------------------------------------------------
function readJson(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { error: `could not be read as JSON: ${error.message}` };
  }
}

/// The real (symlink-free) directory, so every `existsSync` after it looks at the path the filesystem actually has.
function realDirectory(path) {
  try {
    return realpathSync(path);
  } catch (_) {
    return path;
  }
}

/// The kit's version: `design/VERSION` is the authority (roadmap §4 ITEM 1). `tokens.json` is only consulted when
/// `VERSION` has gone missing, and the fallback is reported rather than hidden.
export function readKitVersion(kitDir = KIT_DIR) {
  const versionPath = join(kitDir, 'VERSION');
  if (existsSync(versionPath)) return { version: readFileSync(versionPath, 'utf8').trim(), source: versionPath };
  const jsonPath = join(kitDir, 'tokens.json');
  if (existsSync(jsonPath)) {
    const parsed = readJson(jsonPath);
    if (!parsed.error && parsed.value && parsed.value.version) {
      return { version: String(parsed.value.version).trim(), source: jsonPath, note: `there is no ${versionPath}; the version came from tokens.json` };
    }
  }
  return { version: null, source: versionPath };
}

/// Read one app's declaration. A file that exists and cannot be read is reported as a **problem**, not skipped:
/// the whole point of the dashboard is that a stale or broken declaration is visible from outside the app.
export async function readAppDeclaration(allowPath, { kitDir = KIT_DIR, root = null } = {}) {
  const entry = {
    allowPath,
    label: null,
    kitVersion: null,
    declaredApp: null,
    appSource: null,
    deviations: [],
    problems: [],
    run: { status: 'never', last: null, count: 0 },
  };
  let module;
  try {
    module = await import(pathToFileURL(allowPath).href + `?t=${Date.now()}`);
  } catch (error) {
    entry.problems.push(`the declaration could not be read: ${error.message}`);
    entry.label = labelFor(allowPath, root);
    return entry;
  }
  const value = module.default || {};
  entry.kitVersion = value.kitVersion === undefined ? null : String(value.kitVersion).trim();
  if (!entry.kitVersion) entry.problems.push('no kitVersion is declared, so the fleet cannot tell which kit it took');

  // Where the app is. Two spellings are accepted, and both are *declarations*: `allowApp` names a file or directory,
  // `app` names the display name. Absent, the app is still a row — a declaration without a window is a fact about
  // the fleet too, and hiding it would be the silent failure this project keeps paying for.
  const appPath = value.allowApp || value.appPath;
  if (typeof appPath === 'string' && appPath.trim()) {
    // `realpathSync`, not a plain join: a fleet root reached through a symlink (`/tmp` on macOS is `/private/tmp`)
    // gives a path that `existsSync` refuses even though the file is there — measured on this machine, and the
    // failure mode was a real window reported as missing. Resolve the declaration against the directory the
    // declaration was *actually* read from.
    const absolute = isAbsolute(appPath) ? appPath : resolve(realDirectory(dirname(allowPath)), appPath);
    entry.declaredApp = absolute;
    entry.appSource = appPath.trim();
    if (existsSync(absolute)) {
      const stats = statSync(absolute);
      const index = stats.isDirectory() ? join(absolute, 'index.html') : absolute;
      entry.appWindow = existsSync(index) ? index : null;
      if (stats.isDirectory() && !entry.appWindow) entry.problems.push(`${appPath.trim()} is a directory with no index.html in it`);
    } else {
      entry.problems.push(`allowApp points at ${appPath.trim()}, which does not exist`);
    }
  } else {
    entry.problems.push('the app is not declared: add allowApp: "index.html" (or the window it lives in) to the allowance');
  }

  const deviations = Array.isArray(value.deviations) ? value.deviations : [];
  entry.deviations = deviations.map((deviation, index) => ({
    index,
    rule: deviation && deviation.rule !== undefined ? deviation.rule : null,
    match: deviation && deviation.match !== undefined ? String(deviation.match) : '',
    reason: deviation && deviation.reason ? String(deviation.reason) : '',
  }));
  for (const deviation of entry.deviations) {
    if (!deviation.reason) entry.problems.push(`deviation ${JSON.stringify(deviation.match)} has no reason: a deviation without one is a mute button`);
  }

  entry.label = value.app && String(value.app).trim()
    ? String(value.app).trim()
    : labelFor(allowPath, root);

  // The last conformance run, if one was recorded.
  const runPath = join(dirname(allowPath), CONFORMANCE_RUN_FILE);
  if (existsSync(runPath)) {
    const parsed = readJson(runPath);
    if (parsed.error) {
      entry.problems.push(`${CONFORMANCE_RUN_FILE} ${parsed.error}`);
    } else {
      const runs = Array.isArray(parsed.value.runs) ? parsed.value.runs : [];
      const last = runs[0] || null;
      entry.run = last
        ? { status: 'recorded', last, count: runs.length, path: runPath }
        : { status: 'never', last: null, count: 0, path: runPath };
    }
  }
  return entry;
}

/// A stable, readable name for an allowance file: its directory relative to the fleet root, or the file's own
/// directory when it is outside it. Never an absolute path in a table an operator reads.
function labelFor(allowPath, root) {
  const directory = dirname(allowPath);
  if (root) {
    const rel = relative(root, directory);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/') || '.';
  }
  return directory.split(sep).slice(-2).join('/') || directory;
}

// ---------------------------------------------------------------------------
// Finding the declared files
// ---------------------------------------------------------------------------
/// The three homes a declaration is read from, in the order a directory is asked for its own:
///
///   1. `design/conformance/allow.mjs` — the kit's own home, and the first shape a consumer copied (`design/` holds
///      the kit's copy);
///   2. `conformance/allow.mjs` — the shorter spelling of the same idea;
///   3. `allow.mjs` **beside the shipped kit stylesheet** — where a window folder declares itself. A folder that
///      carries `design-tokens.css` is a folder that took the kit and renders the app, so an `allow.mjs` next to it
///      is that app's declaration. Measured 2026-10-08: `desktop/ui/allow.mjs` is exactly this shape, and homes 1-2
///      never saw it, which is why this dashboard's only row was the kit's own.
const ALLOW_HOMES = [['design', 'conformance', ALLOW_FILE], ['conformance', ALLOW_FILE], [ALLOW_FILE]];
/// The marker for home 3: the copy of the kit an application's window folder ships (`design-tokens.css`). A bare
/// `allow.mjs` with no such copy beside it is some other file of that name, and reading it as a declaration would
/// invent a fleet row out of it.
const APP_HOME_MARKER = 'design-tokens.css';

/// Every declaration under `root`, sorted. A directory is asked for its own declaration first (one of the three homes
/// above; the first home that exists is that directory's own), and the walk then **keeps descending** into every
/// non-pruned, non-hidden child. Not stopping at the first declaration is the point: the kit's own home sits at the
/// top of this repository and an application's beside its windows, and the earlier version's early `return` pruned the
/// whole subtree below the kit's allowance — which is how the application stayed invisible. Two paths to the same file
/// (`design/conformance/allow.mjs` reached from the root and again from `design/`) collapse in the `Set`, and the walk
/// skips build and vendored directories.
export function findAllowFiles(root) {
  const found = [];
  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const patterns of ALLOW_HOMES) {
      const candidate = join(directory, ...patterns);
      if (!existsSync(candidate)) continue;
      // Home 3 only counts where the app's copy of the kit is: the marker is what makes it a declaration.
      if (patterns.length === 1 && !existsSync(join(directory, APP_HOME_MARKER))) continue;
      found.push(candidate);
      break;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (PRUNE.has(entry.name) || entry.name.startsWith('.')) continue;
      visit(join(directory, entry.name));
    }
  };
  visit(root);
  return [...new Set(found)].sort();
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------
/// Read the fleet and answer the roadmap's five columns, plus the problems that stop a row from being trustworthy.
/// Pure with respect to the tree (it reads, it never writes), so a caller can assert on the object instead of on
/// printed text — which is what `scripts/test-design-drift-report.mjs` does.
export async function buildFleetReport(options = {}) {
  const root = resolve(options.root || process.cwd());
  const kitDir = resolve(options.kitDir || KIT_DIR);
  const report = {
    root, kitDir,
    kitVersion: null,
    allowFiles: [], rows: [], behind: [], undeclared: [], problems: [], notes: [],
  };
  if (!existsSync(root)) {
    return { ...report, error: `the fleet root does not exist: ${root}` };
  }
  const kit = readKitVersion(kitDir);
  report.kitVersion = kit.version;
  if (!kit.version) report.problems.push(`the kit beside this report declares no version (${kit.source})`);
  if (kit.note) report.notes.push(kit.note);

  report.allowFiles = findAllowFiles(root);
  const entries = [];
  for (const allowPath of report.allowFiles) {
    entries.push(await readAppDeclaration(allowPath, { kitDir, root }));
  }

  // The newest declared version: the fleet's own answer to "which kit should I be on". The kit counts, because a
  // copy of the kit is one of the things a consumer can have taken.
  const declared = entries.map((entry) => entry.kitVersion).filter(Boolean);
  const candidates = kit.version ? [...declared, kit.version] : [...declared];
  let fleetVersion = null;
  for (const version of candidates) {
    if (fleetVersion === null || compareVersions(version, fleetVersion) > 0) fleetVersion = version;
  }
  report.fleetVersion = fleetVersion;

  for (const entry of entries) {
    const behind = entry.kitVersion && fleetVersion ? versionsBehind(entry.kitVersion, fleetVersion) : null;
    const row = {
      label: entry.label,
      kitVersion: entry.kitVersion,
      fleetVersion,
      behind: Boolean(behind && behind.releases),
      behindPhrase: entry.kitVersion
        ? behindPhrase(behind)
        : 'unknown (no kitVersion declared)',
      deviations: entry.deviations,
      run: entry.run,
      problems: entry.problems,
      allowPath: entry.allowPath,
      appWindow: entry.appWindow || null,
      appSource: entry.appSource || null,
    };
    report.rows.push(row);
    if (row.behind) report.behind.push(row);
    if (!entry.kitVersion || !entry.appSource) report.undeclared.push(row);
    for (const problem of entry.problems) report.problems.push(`${row.label}: ${problem}`);
  }
  report.rows.sort((a, b) => a.label.localeCompare(b.label));
  report.behind.sort((a, b) => a.label.localeCompare(b.label));
  report.undeclared.sort((a, b) => a.label.localeCompare(b.label));
  return report;
}

/// A line an agent can read and a reader can check: `app · kit version · how far behind · deviations declared ·
/// last conformance run`.
function tableRow(row) {
  const version = row.kitVersion || '(not declared)';
  const deviations = row.deviations.length === 0
    ? 'none'
    : `${row.deviations.length}`;
  const last = row.run && row.run.status === 'recorded' && row.run.last
    ? `${row.run.last.at || '(no time)'}${row.run.last.code === 0 ? '' : ` · exit ${row.run.last.code}`}`
    : 'never';
  return [row.label, version, row.behindPhrase, deviations, last];
}

const COLUMNS = ['app', 'kit version', 'how far behind', 'deviations declared', 'last conformance run'];

function printTable(rows, out) {
  const cells = rows.map(tableRow);
  const widths = COLUMNS.map((title, index) => Math.max(title.length, ...cells.map((cell) => String(cell[index]).length)));
  const line = (values) => values.map((value, index) => String(value).padEnd(widths[index])).join('  ').trimEnd();
  out('');
  out(`  ${line(COLUMNS)}`);
  out(`  ${widths.map((width) => '-'.repeat(width)).join('  ')}`);
  for (const cell of cells) out(`  ${line(cell)}`);
}

export function printFleetReport(report, out = console.log) {
  out('');
  out('WING CONTROLLER · design-system drift');
  out(`  fleet root:   ${report.root}`);
  out(`  kit:          ${report.kitVersion ? `${report.kitVersion}  (${report.kitDir}/VERSION)` : `no version declared in ${report.kitDir}`}`);
  out(`  newest seen:  ${report.fleetVersion || '(nothing declares a version)'} — the newest of the kit and every app's declaration`);
  out(`  apps found:   ${report.rows.length} declaration(s), ${report.behind.length} behind`);

  if (report.error) {
    out('');
    out(`DRIFT REPORT NOT RUN · ${report.error}`);
    return;
  }

  if (!report.rows.length) {
    out('');
    out('  No app declares itself. A declaration is found with no configuration, in one of three homes:');
    out('  `design/conformance/allow.mjs`, `conformance/allow.mjs`, or an `allow.mjs` beside the copy of the kit an');
    out('  app shipped (`design-tokens.css`). It carries `kitVersion` and `allowApp`, so the dashboard needs none.');
  } else {
    printTable(report.rows, out);
    out('');
    out('  `how far behind` is measured against the newest version any declared file names, never against a registry.');
  }

  if (report.behind.length) {
    out('');
    out(`BEHIND (${report.behind.length})`);
    for (const row of report.behind) {
      out(`  · ${row.label} built against ${row.kitVersion}, ${row.behindPhrase}`);
      out(`      the copy it should take is the one at ${report.fleetVersion}`);
      out(`      declared in ${row.allowPath}`);
    }
  }

  out('');
  out('DEVIATIONS DECLARED');
  if (!report.rows.some((row) => row.deviations.length)) {
    out('  none: no app in this fleet has declared a difference, which is a fact about the declarations, not a proof of sameness');
  }
  for (const row of report.rows) {
    if (!row.deviations.length) {
      out(`  ${row.label} · none declared`);
      continue;
    }
    out(`  ${row.label} · ${row.deviations.length} declared`);
    for (const deviation of row.deviations) {
      const rule = deviation.rule === null ? 'any rule' : `rule ${deviation.rule}`;
      out(`    · ${rule} · ${deviation.match || '(nothing named)'}`);
      out(`        reason: ${deviation.reason || '(no reason given — a deviation without a reason is not a decision)'}`);
    }
  }

  if (report.undeclared.length) {
    out('');
    out(`NOT FULLY DECLARED (${report.undeclared.length})`);
    for (const row of report.undeclared) {
      const missing = [
        !row.kitVersion ? 'no kitVersion' : null,
        !row.appSource ? 'no allowApp (the window it is about)' : null,
      ].filter(Boolean);
      out(`  · ${row.label}: ${missing.join(' and ')} — declared in ${row.allowPath}`);
    }
  }

  if (report.notes.length) {
    out('');
    out('NOTES (what this reading cannot see, said out loud)');
    for (const note of report.notes) out(`  · ${note}`);
  }
  out('');
  out('  · a fleet in which every app is equally stale reports `up to date`: the dashboard compares declarations');
  out('    with each other, and only the kit\'s own history can say that the newest declaration is itself old.');
  out('  · a declaration with no recorded run says `never`; that is not a pass, and the row will say so until the');
  out('    app runs `run.mjs --record`.');

  if (report.problems.length) {
    out('');
    out(`PROBLEMS (${report.problems.length})`);
    for (const problem of report.problems) out(`  · ${problem}`);
  }

  out('');
  if (report.behind.length) {
    out(`DRIFT · ${report.rows.length} app(s) · ${report.behind.length} behind · newest declared ${report.fleetVersion}`);
  } else {
    out(`DRIFT · ${report.rows.length} app(s) · none behind · newest declared ${report.fleetVersion}`);
  }
}

// ---------------------------------------------------------------------------
// Recording a run — the one writer of `run.json`
// ---------------------------------------------------------------------------
/// Append one conformance run to `<directory>/run.json`, newest first, capped so the file cannot grow without bound.
/// Called by `run.mjs --record <path>` and by nobody else; a caller that never records gets `never`, which is the
/// honest default (see this file's header).
export function recordRun(path, run) {
  const file = resolve(path);
  const directory = dirname(file);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  let runs = [];
  if (existsSync(file)) {
    const parsed = readJson(file);
    if (!parsed.error && parsed.value && Array.isArray(parsed.value.runs)) runs = parsed.value.runs;
  }
  runs.unshift(run);
  const trimmed = runs.slice(0, MAX_RECORDED_RUNS);
  writeFileSync(file, `${JSON.stringify({ runs: trimmed }, null, 2)}\n`);
  return file;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function usage() {
  return [
    'usage: node design/conformance/report.mjs [options]',
    '',
    '  --root <dir>                     the fleet to read (default: the current directory). Every',
    '                                   declaration under it is one app: `design/conformance/allow.mjs`',
    '                                   (or `conformance/allow.mjs`), or an `allow.mjs` beside the copy of',
    '                                   the kit the app shipped (`design-tokens.css`).',
    '  --kit <dir>                      the kit whose VERSION is the authority (default: the one beside this file)',
    '  --json [file]                    print the report as JSON, or write it to a file',
    '  --fail-on-behind                 exit 1 when an app is behind the newest declared version',
    '  --fail-on-missing-declaration    exit 1 when an app declares no kitVersion or no allowApp',
    '  --quiet                          print nothing; the exit code carries the answer',
    '  --help                           this text',
  ].join('\n');
}

export function parseArgs(argv) {
  const options = { root: process.cwd(), kitDir: KIT_DIR, json: null, quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') options.root = argv[++index];
    else if (arg === '--kit') options.kitDir = argv[++index];
    else if (arg === '--json') {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) { options.json = next; index += 1; }
      else options.json = true;
    } else if (arg === '--fail-on-behind') options.failOnBehind = true;
    else if (arg === '--fail-on-missing-declaration') options.failOnMissingDeclaration = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else return { error: `unknown argument: ${arg}` };
  }
  if (!options.root) return { error: '--root needs a directory' };
  if (!options.kitDir) return { error: '--kit needs a directory' };
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) {
    console.error(`${options.error}\n\n${usage()}`);
    process.exit(2);
  }
  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  const report = await buildFleetReport(options);
  if (report.error) {
    console.error(`drift report could not run: ${report.error}`);
    process.exit(2);
  }
  // `--json <file>` writes the machine-readable report and still prints the operator's page; a bare `--json`
  // prints the JSON instead of the page, so one stream never carries two formats at once.
  if (options.json) {
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (typeof options.json === 'string') writeFileSync(resolve(options.json), text);
    else if (!options.quiet) process.stdout.write(text);
  }
  if (!options.quiet && options.json !== true) printFleetReport(report);

  let code = 0;
  if (options.failOnBehind && report.behind.length) code = 1;
  if (options.failOnMissingDeclaration && report.undeclared.length) code = 1;
  if (code) {
    if (!options.quiet) {
      const why = [];
      if (options.failOnBehind && report.behind.length) why.push(`${report.behind.length} app(s) behind`);
      if (options.failOnMissingDeclaration && report.undeclared.length) why.push(`${report.undeclared.length} app(s) not fully declared`);
      console.log(`\nDRIFT REPORT FAILED · ${why.join(' · ')}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`drift report could not run: ${error.stack || error.message}`);
    process.exit(2);
  });
}
