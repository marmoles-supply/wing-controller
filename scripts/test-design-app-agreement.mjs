// **This file is the ORACLE for `scripts/test-design-app-agreement-live.mjs`, and it is not that file.** The two share
// a subject and nothing else: the **live** one (`-live`) is the gate member that measures the application's tree
// against the design kit and goes red when a window drifts; this one measures **the live one** - its behaviour on
// fixtures this test owns, the running total it must keep seeing, and the drift it must fail on. The obvious `test-*`
// name was this file before the link finished, which is why the gate member had to be named around it
// (`-live`); the distinction is written in both headers so one line each is enough.
//
// A checker whose output includes a value the file does not contain cannot be the gate that proves the link changed
// nothing. `docs/DESIGN_DISAGREEMENTS_2026-10-08.md` §3 measured that twelve of the checker's 44 rows were defects in
// the instrument, not disagreements in the application: ten aliases compared as values, one `1.0` against `1`, and one
// CSS comment printed as the value of `meters.html`'s dark `--face`.
//
// This test pins the cure in layers, because each alone would pass while the defect returned:
//
//   1. **Synthetic fixtures this test controls**, so "an alias is skipped" cannot pass because the tree happens to
//      contain no aliases: a kit and a window are built here, each bug class is injected, and it must be gone while a
//      real colour drift beside it stays reported. The same layer pins the **dark fallback**: a window that links the
//      kit and declares a token only in `:root` takes the kit's dark value, a window that does not link it keeps its
//      own, and the `:root` fallback survives where the kit does not re-declare the token for dark.
//   2. **The real tree, through the real command line** (`--root`, `--no-allow`, `--json`): a false reading the tree
//      still carries must be exactly a skipped declaration (the twelve §3 named are gone from it, so that list is
//      empty today), and the written tree must keep exactly the number of unexplained
//      disagreements the link has reached - **a running total, lowered deliberately in the change that lowers it**,
//      never a floor. That count is the oracle (`RUNNING_TOTAL` below) and it is asserted **exactly** - a fix that
//      swallowed one real disagreement would show up one below this total and fail here. The message's "and N more"
//      tail is computed from that same constant rather than copied by hand, because the hand copy is what went stale
//      when the total moved.
//   3. **The allowance reader**, the capability §3 point 5 says the checker lacks: a declaration is reported as
//      declared with its reason, a declaration that matched nothing is named, and `--no-allow` proves a declaration is
//      a decision and never a mute button.
//   4. **The gate member's teeth, on a copy of the real tree** (`--root`, section 9): the live tree's own kit, windows
//      and allowance are copied to `/tmp`, one token is broken at a time, and the gate member must exit **1** with the
//      sentence that names the file, the theme, the token and both values. A contract that only asserts a green run
//      proves nothing about the run that matters.
//   5. **The gate member actually runs** (section 10): invoked through a symlink - which `/tmp` and `/var` are on this
//      machine - it must still print its report. The guard at the bottom of the live file once compared two spellings
//      of the same path literally, skipped `main()` and exited **0 having measured nothing**, which the gate books as
//      PASS. That is the one failure a gate member must not have, so a symlinked run is pinned.
//
// Run: node scripts/test-design-app-agreement.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyAllow, compareDesign, DEFAULT_ALLOW, linksDesignKit, readAllow, readWindow, sameNumber, stripCssComments } from './test-design-app-agreement-live.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CHECKER = join(REPO, 'scripts/test-design-app-agreement-live.mjs');
const root = mkdtempSync(join(tmpdir(), 'wing-design-agreement-'));
// Section 9's copies of the live tree, removed in the `finally` whatever happens: a `/tmp` copy that survives a failed
// run is the next reader's confusing evidence, and the marker grep for the mutation proof reads the tracked tree, not
// these.
const realCopyRoots = [];
// The oracle's running total, with one home: the number of unexplained disagreements the design kit's link has
// reached. It is lowered **in the same change as the window that lowers it**, never relaxed to a floor - an oracle
// that accepts any number above a floor stops telling you when it has stopped seeing. The link landed one window at a
// time (44 read, the twelve false positives removed, then the guide window's link took 32 to 30, then the checker's
// own dark fallback was corrected and the false meters dark `--field` row took 23 to 22), and the message's "and N
// more" tail is computed from this constant below instead of being written by hand: the hand copy of that arithmetic
// is exactly what went stale when the total moved.
//
// **The total moved under this session rather than by it**: the `ltc` and `index` links landed while this wiring work
// was measuring something else, taking the count 22 -> 11 -> 9 - the nine rows that remain are all declared in
// `desktop/ui/allow.mjs`, so a plain run now exits 0. Lowering this constant to the measured value is what a running
// total is for; keeping 22 would have been the fight, and a floor would have been the lie.
const RUNNING_TOTAL = 9; // lowered when the ltc and index links landed under this session (22 -> 11 when ltc and index landed, then 11 -> 9 when meters adopted the kit's --red and dropped its own #e74c3c) - a RUNNING TOTAL, and an oracle
// The checker was being edited while another session ran the gate once, and the gate reported this test failing
// against a half-written revision (the test passed before and after). The assertion below is what makes that
// impossible to misread: if the checker's size or modification time changes during this test, the run is a
// COULD-NOT-RUN and not a verdict on the checker's contents.
const checkerBefore = statSync(CHECKER);

try {
  // ---------------------------------------------------------------------------
  // A kit and a window this test owns: thirty light tokens, three dark re-declarations. `readCanonicalCss` needs a
  // theme, not a big one, and a small kit keeps a failure readable.
  // ---------------------------------------------------------------------------
  const light = [];
  for (let index = 0; index < 30; index += 1) light.push(`  --t${index}: #${String(index).padStart(2, '0')}0000;`);
  // Two numeric tokens, because `meters.html:46`'s `--meter-scale` is the number case: the kit spells `--scaled` as
  // `1` and the window spells it `1.0` (one number, two spellings), while `--scaled-other` is `1` against `2` and is a
  // real disagreement that must stay reported.
  light.push('  --scaled: 1;', '  --scaled-other: 1;');
  const KIT_CSS =
    `:root {\n${light.join('\n')}\n}\n` +
    'body.theme-dark {\n  --t0: #111111;\n  --t1: #222222;\n  --t2: #333333;\n}\n';
  mkdirSync(join(root, 'design'), { recursive: true });
  mkdirSync(join(root, 'desktop/ui'), { recursive: true });
  writeFileSync(join(root, 'design/tokens.css'), KIT_CSS);

  const windowHtml = (block) => `<!doctype html><html><head><style>\n${block}\n</style></head><body></body></html>\n`;
  const writeWindow = (name, block) => writeFileSync(join(root, 'desktop/ui', name), windowHtml(block));
  const cli = (args) => spawnSync(process.execPath, [CHECKER, '--root', root, ...args], { encoding: 'utf8' });
  const cliJson = (args) => {
    const run = cli(args);
    assert.equal(run.status, 1, `a tree with unexplained findings must exit 1; got ${run.status}: ${run.stderr}`);
    return JSON.parse(run.stdout);
  };

  // 1. **A comment is not a value.** `meters.html:82-86` carries an audit comment that contains the text
  //    "--face: var(--win-btn-face)" on its way to explaining the alias below it. The kit's parser reads `([^;]+);`
  //    and swallowed the comment into the value, so the tool printed a value that is not in the file. The declaration
  //    behind the comment is an alias, and an alias is a reference, not a value either (`tokens.css:103-104`).
  //    `--t0` is declared dark by the kit but not by this window, so the alias is what would be compared - and it
  //    resolves to `--t1`, which the window never declares, so no spelling of the reference is a colour.
  const COMMENT_CASE =
    ':root {\n  --t5: #ffffff;\n}\n' +
    'body.theme-dark {\n' +
    '  /* The audit comment that did this once:\n' +
    '     a custom property whose value is a var() froze on :root, so\n' +
    '     --t0: var(--t1) never reached the dark block. */\n' +
    '  --t0: var(--t1);\n' +
    '}';
  writeWindow('comment.html', COMMENT_CASE);
  const commentRun = compareDesign({ root, strict: false });
  assert.equal(
    commentRun.problems.find((problem) => problem.theme === 'dark' && problem.token === '--t0'),
    undefined,
    `dark --t0 is an alias behind a comment, so it must be skipped; got ${JSON.stringify(commentRun.problems)}`,
  );
  assert.ok(
    commentRun.skipped.some((item) => item.token === '--t0' && item.appValue === 'var(--t1)' && item.kind === 'alias'),
    `the dark --t0 must be read as the alias the file writes, not as the comment; skipped=${JSON.stringify(commentRun.skipped)}`,
  );
  // The blunt form of the same contract: a parse that still runs through a comment produces a "value" carrying the
  // comment terminator, which no declaration value in any file contains.
  for (const problem of commentRun.problems) {
    assert.ok(
      !String(problem.appValue).includes('*/'),
      `a reported value carrying "*/" is comment text: ${JSON.stringify(problem)}`,
    );
  }
  assert.ok(
    stripCssComments(COMMENT_CASE).includes('--t0: var(--t1)') && !stripCssComments(COMMENT_CASE).includes('/*'),
    'stripCssComments must remove the comment and leave every declaration behind it intact',
  );
  // The shape that actually produced the defect, `meters.html:82-87`: the real declaration sits immediately after a
  // comment whose last line looks like a declaration, and the parser's `([^;]+);` ran from the one **inside** the
  // comment to the real one's `;`. The value read must be the real declaration exactly.
  const AUDIT_COMMENT_CASE =
    'body.theme-dark {\n' +
    '  /* The aliases have to be re-declared here, not only on :root: a custom property whose value is a\n' +
    '     `var()` is substituted on the element that declares it, so\n' +
    '     --t6: var(--t7) on `:root` froze to the light #060000. */\n' +
    '  --t6: var(--t7);\n' +
    '}';
  writeWindow('audit-comment.html', ':root {\n  --t8: #080000;\n}\n' + AUDIT_COMMENT_CASE);
  const auditValue = readWindow('desktop/ui/audit-comment.html', root).dark.get('--t6');
  assert.equal(
    auditValue,
    'var(--t7)',
    `a declaration after an audit comment must read as itself, not as the comment; got ${JSON.stringify(auditValue)}`,
  );
  assert.ok(!String(auditValue).includes('*/'), 'the comment terminator must never reach a value');
  // And the literal colour beside the alias is still a disagreement: fixing the reader must not mute the checker.
  assert.ok(
    commentRun.problems.some((problem) => problem.token === '--t5' && problem.appValue === '#ffffff'),
    `a literal colour that differs must stay reported; got ${JSON.stringify(commentRun.problems)}`,
  );

  // 2. **A number is compared as a number.** `1.0` and `1` are one number in two spellings (`meters.html:46` vs
  //    `tokens.css:85`), while `1.0` against `2` is a real difference and stays reported in its own spelling.
  writeWindow('number.html', ':root {\n  --scaled: 1.0;\n  --scaled-other: 2.0;\n}');
  const numberRun = compareDesign({ root, strict: false });
  assert.ok(
    !numberRun.problems.some((problem) => problem.token === '--scaled'),
    `1.0 against the kit's 1 is the same number; got ${JSON.stringify(numberRun.problems.filter((p) => p.token === '--scaled'))}`,
  );
  assert.ok(
    numberRun.skipped.some((item) => item.token === '--scaled' && item.kind === 'number-spelling'),
    `the 1.0/1 pair must be skipped as a number spelling; skipped=${JSON.stringify(numberRun.skipped)}`,
  );
  assert.ok(
    numberRun.problems.some((problem) => problem.token === '--scaled-other' && problem.appValue === '2.0'),
    `2.0 against 1 is a real disagreement and must stay reported; got ${JSON.stringify(numberRun.problems)}`,
  );
  assert.ok(sameNumber('1.0', '1') && sameNumber('1', '1.0') && !sameNumber('1.0', '2'), 'sameNumber is equality only');

  // 3. **The dark fallback is decided by the link, and only by the link.** `meters.html` linked the kit, deleted its
  //    own dark `--field`, and the checker still reported `the kit says #0f1614; :root here says #ffffff`: the window
  //    declares that token only in `:root`, and the old fallback compared the light value against the kit's dark
  //    standard. For a window that links the kit the kit's `body.theme-dark` is what paints it, so the kit's dark
  //    value **is** the window's dark value. The `:root` fallback stays - and this is the case that must not be lost -
  //    when the kit does **not** re-declare the token for dark: there the kit's dark value is its light one and the
  //    window's `:root` declaration is a real disagreement, reported once per theme (`meters.html`'s `--red`, whose
  //    second declaration in `desktop/ui/allow.mjs` depends on the dark row surviving). A window that does **not**
  //    link the kit keeps its own `:root` value in dark, so the same shape there is real and must stay reported.
  const linkedWindow = 'desktop/ui/linked-dark.html';
  writeFileSync(
    join(root, linkedWindow),
    '<!doctype html><html><head>\n<link rel="stylesheet" href="design-tokens.css" />\n<style>\n' +
    ':root {\n  --t0: #ffffff;\n  --t3: #aabbcc;\n}\n' +
    '</style></head><body></body></html>\n',
  );
  writeWindow('unlinked-dark.html', ':root {\n  --t0: #ffffff;\n}');
  const linkRun = compareDesign({ root, strict: false });
  const darkRow = (file, token) =>
    linkRun.problems.filter((problem) => problem.file === file && problem.theme === 'dark' && problem.token === token);
  assert.deepEqual(
    darkRow(linkedWindow, '--t0'),
    [],
    `the kit re-declares --t0 for dark, so a linked window that declares it only in :root takes the kit's value; got ${JSON.stringify(darkRow(linkedWindow, '--t0'))}`,
  );
  assert.equal(
    darkRow(linkedWindow, '--t3').length,
    1,
    `the kit does NOT re-declare --t3 for dark, so the linked window's :root value is a real dark disagreement (the --red shape) and must survive; got ${JSON.stringify(darkRow(linkedWindow, '--t3'))}`,
  );
  assert.equal(
    darkRow('desktop/ui/unlinked-dark.html', '--t0').length,
    1,
    `a window that does not link the kit keeps its own :root value in dark, so the row must stay reported; got ${JSON.stringify(darkRow('desktop/ui/unlinked-dark.html', '--t0'))}`,
  );
  // The link itself is read from the HTML, not assumed: the marker is a stylesheet link to the kit's shipped file.
  assert.ok(linksDesignKit('<link rel="stylesheet" href="design-tokens.css" />'), 'a stylesheet link to the kit is a link');
  assert.ok(linksDesignKit("<link rel='stylesheet' href='./design-tokens.css?v=1'>"), 'a quoted href with a query is the same link');
  assert.ok(
    !linksDesignKit('<link rel="icon" href="design-tokens.css" />'),
    'a non-stylesheet link to that file is not the kit being loaded',
  );
  assert.ok(!linksDesignKit('<style>/* design-tokens.css */</style>'), 'a mention of the file in a comment is not a link');

  // 4. **The command line on this tree**, with no allowance read unless it is asked for. The oracle lives here: the
  //    real tree goes from 44 disagreements to `RUNNING_TOTAL`, and exactly the twelve false readings are what left.
  //    The link landed one window at a time, each time lowering this constant in the change that lowered it (30, then
  //    22 with the checker's dark fallback, then 11 when ltc and index landed, then 9 when meters adopted the kit's --red, under this session - see the constant's
  //    comment). It is asserted exactly and it is **not zero** while any window still declares its own value: what the
  //    fix delivers is that twelve of the forty-four were never disagreements, not that the application agrees with
  //    the kit - the nine rows below are the windows that declare rather than adopt, and each carries a reason.
  const real = spawnSync(process.execPath, [CHECKER, '--root', REPO, '--no-allow', '--json'], { encoding: 'utf8' });
  assert.equal(real.status, 1, `the check must still fail by design while the link is unsettled (exit ${real.status})`);
  const realJson = JSON.parse(real.stdout);
  assert.equal(
    realJson.unexplained.length,
    RUNNING_TOTAL,
    `the tree must keep exactly ${RUNNING_TOTAL} unexplained disagreements (the running total after the ltc and index ` +
    `links); got ${realJson.unexplained.length}: ` +
    realJson.unexplained.map((problem) => problem.sentence).join(' | '),
  );
  // Every window file the checker is supposed to read, read. A checker that quietly stopped looking at one file
  // would satisfy the three "false positive" contracts below while hiding real disagreements in that window.
  assert.deepEqual(
    realJson.windows.slice().sort(),
    ['desktop/ui/guide.html', 'desktop/ui/index.html', 'desktop/ui/meters.html', 'desktop/ui/timecode.html'],
    `every window with a palette must be inspected; got ${JSON.stringify(realJson.windows)}`,
  );
  // `ltc.html` is the fifth window and it is absent from this list on purpose (`0cd986bf`): it linked the kit and
  // adopted every value it used to declare, so it declares **no** token of its own and the checker's own rule - a
  // window is inspected when it has a palette (`w.light.size > 0`) - finds nothing in it to compare. Requiring a row
  // from a window that agrees with the kit would be requiring drift, and the link's whole point is that the row goes
  // away. What must not go away is the reason for the absence: this reads the file with the checker's **own** reader
  // and pins that ltc.html is still there, still linked, and still empty, so its absence from the list above is a
  // measurement about ltc rather than an assumption that a vanished window is fine. A deleted file must fail here by
  // name, not as a raw ENOENT: "a window that vanished from the report is drift hidden, not fixed" (the `thin` loop
  // below makes the same call for guide, index and meters).
  let ltcWindow;
  try {
    ltcWindow = readWindow('desktop/ui/ltc.html', REPO);
  } catch (error) {
    assert.fail(`desktop/ui/ltc.html must still exist and stay readable, or its absence from the inspected windows is drift hidden; got ${error.message}`);
  }
  assert.equal(
    ltcWindow.light.size + ltcWindow.dark.size,
    0,
    `ltc.html is not among the inspected windows because it declares no token of its own; it now declares ` +
    `${ltcWindow.light.size} light and ${ltcWindow.dark.size} dark - if it declares one again, the window list above ` +
    `is stale and it must be put back`,
  );
  assert.ok(
    ltcWindow.linksKit,
    "ltc.html must still link the kit: the window whose palette is the kit's is the one that has no rows of its own",
  );
  //
  // **`meters.html` joined `ltc.html` on the same terms on 2026-10-08** (`DESIGN-SYSTEM-ROADMAP.md` §4l, D-TYPE-5):
  // the split gave the metre-zoom slider its own property (`--meter-zoom`) and left `--meter-scale` as the kit's type
  // knob, so this window stopped declaring the knob and its five restated `--font-*` steps are the kit's own text.
  // It therefore has no `unexplained` and no `skipped` row, and the row that keeps it in the report is the `thin`
  // reading - "declares 5 of the kit's tokens" - which is asserted here as well, so a window that vanished from
  // the report is still caught rather than merely tolerated.
  for (const file of ['desktop/ui/guide.html', 'desktop/ui/index.html', 'desktop/ui/meters.html']) {
    assert.ok(
      realJson.unexplained.some((problem) => problem.file === file) ||
      realJson.skipped.some((item) => item.file === file) ||
      realJson.thin.some((item) => item.startsWith(`${file}:`)),
      `the checker must still report on ${file}: a window that vanished from the report is drift hidden, not fixed`,
    );
  }
  assert.deepEqual(
    realJson.declared,
    [],
    '--no-allow must report every disagreement as unexplained: no allowance is read without being asked for',
  );
  const expectedSkipped = [
    // TWELVE BECAME ONE when meters stopped copying the kit into its own :root - the ten aliases WERE those copies, so
    // removing the copies removed the aliases with them. **ONE BECAME NONE on 2026-10-08** (`DESIGN-SYSTEM-ROADMAP.md`
    // §4l, D-TYPE-5): the last one was `meters.html`'s `body.theme-dark { --meter-scale: 1.0 }`, a number-spelling of
    // the kit's `1`, and the split renamed that declaration to `--meter-zoom: 1.0` - the operator's geometry zoom, a
    // property the kit does not declare, so there is no kit value left for it to be a spelling of. The tree therefore
    // contains no skipped declaration at all today, and `RUNNING_TOTAL` is unchanged: the nine colour rows below are
    // what the application declares rather than adopts. The false-positive MACHINERY is still proved, on the synthetic
    // fixtures below (the alias fixture and the number-spelling one); this list is what the real tree contains TODAY,
    // and the difference between the two is the point: the fixture proves the rule, the tree says where it applies.
  ].sort();
  assert.deepEqual(
    realJson.skipped.map((item) => `${item.file} (${item.theme}) ${item.token}`).sort(),
    expectedSkipped,
    `the tree must skip exactly the false readings it still carries, and it carries none today (the twelve false ` +
    `positives §3 named are gone); got ${JSON.stringify(realJson.skipped)}`,
  );
  // `*/` appears only in comments, so no value the checker reports or skips may carry it. This is the sharp form of
  // "the tool printed a value that is not in the file".
  for (const item of [...realJson.unexplained, ...realJson.skipped]) {
    assert.ok(
      !String(item.appValue).includes('*/'),
      `a value carrying "*/" is comment text, not a declaration: ${JSON.stringify(item)}`,
    );
  }
  // The false readings are gone for the stated reason, and the genuine findings they sat beside survive.
  assert.ok(
    !realJson.unexplained.some((item) => item.kind === 'alias' || item.kind === 'number-spelling'),
    'no unexplained finding may be an alias or a number spelling',
  );
  assert.ok(
    realJson.unexplained.some((item) => item.token === '--ink' && item.appValue === '#e6efeb'),
    "a real dark-palette disagreement (guide.html's --ink) must still be reported",
  );
  assert.ok(
    realJson.unexplained.some((item) => item.token === '--win-title-bg' && item.appValue === '#70e7a9'),
    "and a second one in another window (index.html's --win-title-bg), so the contract is not tied to a single row",
  );

  // 5. **The message still states the total**, and says how many rows it lists. `report()` prints the rows and, only
  //    when there are more than `LISTED`, a "… and N more" tail; `formatProblems()` says the same in its failure
  //    message. Both numbers are computed here from the same `RUNNING_TOTAL` the oracle above pins instead of being
  //    written by hand: the hand-written copy of that arithmetic is what went stale when the total moved, and now
  //    that the total is **below** `LISTED` the wording itself has to follow it - "All 9 are listed", never "The
  //    first 12 are listed" over nine rows, and never "… and -1 more".
  const LISTED = 12;
  const listed = Math.min(LISTED, RUNNING_TOTAL);
  const printed = spawnSync(process.execPath, [CHECKER, '--root', REPO, '--no-allow'], { encoding: 'utf8' });
  const message = `${printed.stdout}\n${printed.stderr}`;
  // Quote the lines that carry these facts, not the last three lines of the output: the checker fails by design, so
  // the assertion text it prints is followed by Node's deep-equal diff, whose tail ("- []") says nothing about a
  // count. A failure here has to show the reader the numbers, not the diff.
  const summary = message
    .split('\n')
    .filter((line) => /disagree on|are listed|more|disagreement\(s\)/.test(line))
    .join(' / ');
  assert.ok(
    message.includes(`disagree on ${RUNNING_TOTAL} point(s)`),
    `the message must state the total (${RUNNING_TOTAL}); got: ${summary}`,
  );
  // The prose and the list are measured separately: the "how many are listed" phrase is a literal in the checker, so
  // a report that listed every row while still saying "The first 12" would satisfy a substring test and lie to its
  // reader.
  const listedRows = printed.stdout.split('\n').filter((line) => line.startsWith('  · ')).length;
  const howMany = listed === RUNNING_TOTAL ? `All ${RUNNING_TOTAL} are listed` : `The first ${LISTED} are listed`;
  assert.ok(
    message.includes(howMany) && listedRows === listed,
    `the message must say how many rows it lists and list that many (${listed}); it listed ${listedRows}; got: ${summary}`,
  );
  // The tail exists only when something is left over, and the rule is measured on each surface on its own: `report()`
  // on stdout and `formatProblems()` on stderr. A combined substring test accepts whichever copy happens to be right,
  // so one of the two could drift while the other carried the assertion. Below `LISTED` the contract is the opposite:
  // neither surface may invent a tail, and "… and -1 more" is exactly what a hand copy produces.
  if (RUNNING_TOTAL > LISTED) {
    const tail = `… and ${RUNNING_TOTAL - LISTED} more`;
    assert.ok(
      printed.stdout.includes(tail),
      `the message must still say how many rows are not listed (${RUNNING_TOTAL - LISTED}); got: ${summary}`,
    );
    assert.ok(
      printed.stderr.includes(tail),
      `the failure message must say the same (${RUNNING_TOTAL - LISTED}); got: ${summary}`,
    );
  } else {
    assert.ok(
      !printed.stdout.includes('… and ') && !printed.stderr.includes('… and '),
      `with ${RUNNING_TOTAL} rows and ${LISTED} listed there is nothing left over, so neither surface may print a tail; got: ${summary}`,
    );
  }

  // 6. **The allowance reader**, in the shape `design/conformance/allow.mjs` already has and `run.mjs` already
  //    reads: `{ deviations: [{ match, reason }] }`. The declaration below matches one synthetic finding; the second
  //    matches nothing and must be named so it cannot rot.
  const allowPath = join(root, 'allow.mjs');
  writeFileSync(
    allowPath,
    'export default {\n  deviations: [\n' +
    "    { match: '--t5', reason: 'the specimen paints white on purpose' },\n" +
    "    { match: 'matched-nothing-at-all', reason: 'left behind by a changed window' },\n" +
    '  ],\n};\n',
  );
  const declaredJson = cliJson(['--allow', allowPath, '--json']);
  assert.equal(
    declaredJson.declared.length,
    1,
    `the declaration must be reported as declared, not dropped; got ${JSON.stringify(declaredJson.declared)}`,
  );
  assert.equal(
    declaredJson.declared[0].reason,
    'the specimen paints white on purpose',
    'the declaration must carry its reason into the report',
  );
  assert.equal(
    declaredJson.unexplained.length + declaredJson.declared.length,
    declaredJson.problems.length,
    'every disagreement must be accounted for as declared or unexplained, never lost between the two',
  );
  assert.ok(
    declaredJson.unused.some((deviation) => deviation.match === 'matched-nothing-at-all'),
    `a declaration that matched nothing must be named; got ${JSON.stringify(declaredJson.unused)}`,
  );
  const declaredPrinted = cli(['--allow', allowPath]);
  assert.equal(declaredPrinted.status, 1, 'a declared disagreement is not a pass for the others');
  assert.ok(
    declaredPrinted.stdout.includes('DECLARED ·') &&
    declaredPrinted.stdout.includes('the specimen paints white on purpose'),
    `a declared deviation must be printed as declared, with its reason; got:\n${declaredPrinted.stdout}`,
  );
  assert.ok(
    declaredPrinted.stdout.includes('a declared deviation matched nothing: "matched-nothing-at-all"'),
    `the report must name the declaration that matched nothing; got:\n${declaredPrinted.stdout}`,
  );
  // And the other direction: without `--allow`, the same tree has no declared rows at all - the allowance is read
  // when it is asked for, not whenever a file happens to sit beside the checker.
  const noAllowJson = cliJson(['--no-allow', '--json']);
  assert.deepEqual(
    noAllowJson.declared,
    [],
    'a declaration must never apply unless the allowance carrying it was read',
  );
  assert.ok(
    noAllowJson.unexplained.some((problem) => problem.token === '--t5'),
    'the finding behind a declaration must be unexplained when the allowance is not read',
  );
  // The default is now the **application's own** allowance, `desktop/ui/allow.mjs` inside the tree `--root` names -
  // and the point of this assertion is the path, not only the presence of the phrase: the old default was
  // `design/conformance/allow.mjs`, the **rendered-page suite's** allowance, and it declares nothing here.
  const noFilePrinted = cli([]);
  assert.ok(
    noFilePrinted.stdout.includes(`no allowance file at`) &&
    noFilePrinted.stdout.includes(join('desktop', 'ui', 'allow.mjs')),
    `the report must say what allowance it read, and the default must be the application's own desktop/ui/allow.mjs ` +
    `under --root; got:\n${noFilePrinted.stdout}`,
  );
  // An allowance that cannot be read is a COULD-NOT-RUN (exit 3), never a green: "the file I could not parse had no
  // declarations" is the silently-skipped allowance this reader exists to prevent.
  const brokenAllow = join(root, 'broken-allow.mjs');
  writeFileSync(brokenAllow, 'export default { deviations: [ this is not javascript\n');
  const broken = cli(['--allow', brokenAllow]);
  assert.equal(
    broken.status,
    3,
    `an allowance that cannot be read must exit 3, not pass; got ${broken.status}: ${broken.stdout}${broken.stderr}`,
  );
  assert.ok(
    `${broken.stdout}${broken.stderr}`.includes('could not be read'),
    `the failure must say the allowance could not be read; got: ${broken.stdout}${broken.stderr}`,
  );

  // 7. **The default allowance is the application's own, and it cannot silently revert.** A plain run with no
  //    `--allow` reads `desktop/ui/allow.mjs` **inside the tree named by `--root`** - the declaration beside the
  //    windows this checker globs (`desktop/ui/*.html`). It must never read `design/conformance/allow.mjs`: that file
  //    is the **rendered-page suite's** allowance, a different consumer, and it declares nothing about token-theme
  //    disagreements, so defaulting to it reported the application's ten declared rows as unexplained. The synthetic
  //    tree below owns a `desktop/ui/allow.mjs`, so the default is proved by the run rather than by the constant's
  //    name; the real tree pins the file a plain run actually reads, so the churn of the link cannot hide a revert.
  const syntheticAllow = join(root, 'desktop/ui', 'allow.mjs');
  writeFileSync(
    syntheticAllow,
    'export default {\n' +
    "  app: 'synthetic',\n" +
    "  kitVersion: '1.0.0',\n" +
    "  allowApp: 'comment.html',\n" +
    '  deviations: [\n' +
    "    { rule: 4, match: '--t5', reason: \"the default allowance is the application's\" },\n" +
    '  ],\n};\n',
  );
  const plainJson = cliJson(['--json']);
  assert.equal(
    plainJson.allow.path,
    syntheticAllow,
    `a plain run must read the application's allowance beside its windows (${syntheticAllow}); got ${JSON.stringify(plainJson.allow)}`,
  );
  assert.equal(
    plainJson.declared.length,
    1,
    `the default declaration must be reported as declared; got ${JSON.stringify(plainJson.declared)}`,
  );
  assert.equal(
    plainJson.declared[0].reason,
    "the default allowance is the application's",
    'the declaration read must be the one from the default file, not from another allowance',
  );
  // `--allow <path>` still wins over the default, in the same run shape.
  const overriddenJson = cliJson(['--allow', allowPath, '--json']);
  assert.equal(
    overriddenJson.allow.path,
    allowPath,
    `--allow must still override the default; it read ${overriddenJson.allow.path} instead of ${allowPath}`,
  );
  assert.equal(
    overriddenJson.declared[0].reason,
    'the specimen paints white on purpose',
    'the file named on the command line is the one whose declarations apply',
  );
  // And `--no-allow` still reports everything as unexplained with no allowance read at all.
  const noAllowDefault = cliJson(['--no-allow', '--json']);
  assert.deepEqual(noAllowDefault.declared, [], '--no-allow must report every disagreement as unexplained');
  assert.equal(noAllowDefault.allow, null, '--no-allow must read no allowance file at all');
  // The literal in the shipped file, so the default cannot be changed to the suite's allowance without a red test
  // naming the defect. A literal is auditable structurally; the behavioural pins above are what prove it in a run.
  const shippedDefault = readFileSync(CHECKER, 'utf8');
  assert.ok(
    shippedDefault.includes("export const DEFAULT_ALLOW = 'desktop/ui/allow.mjs';"),
    'the shipped default must stay desktop/ui/allow.mjs (the APPLICATION\'s own, relative to the checked tree): a ' +
    'default of design/conformance/allow.mjs is the rendered-page suite\'s file and reports the application\'s ' +
    'declared rows as unexplained',
  );
  // The real tree, through the real default: the file a plain run reads must be the application's own, its
  // declarations must be the ones reported, and the run must be **green for the right reason**. The link is finished,
  // so "0 unexplained · RUNNING_TOTAL declared" is the contract now and a non-zero exit is drift, not a design.
  const realPlain = spawnSync(process.execPath, [CHECKER, '--root', REPO, '--json'], { encoding: 'utf8' });
  assert.equal(
    realPlain.status,
    0,
    `a plain run on the real tree must be green - the link is finished and every remaining disagreement is declared; ` +
    `got exit ${realPlain.status}: ${realPlain.stderr}`,
  );
  const realPlainJson = JSON.parse(realPlain.stdout);
  const realAllow = await readAllow(join(REPO, DEFAULT_ALLOW));
  assert.equal(realAllow.error, null, `the application's allowance must be readable: ${realAllow.error}`);
  assert.equal(
    realPlainJson.allow.path,
    join(REPO, DEFAULT_ALLOW),
    `a plain run must read the application's allowance (${join(REPO, DEFAULT_ALLOW)}); it read ${realPlainJson.allow.path}` +
    ' - if that is design/conformance/allow.mjs, the default has reverted and the application\'s declared rows are ' +
    'being reported as unexplained',
  );
  // The accounting is asserted against the **run's own** snapshot of the allowance, never against a second read of the
  // file: `desktop/ui/allow.mjs` belongs to the agent linking the windows, and it can be rewritten between two reads
  // of it. What must hold is that a plain run read declarations and reported them as DECLARED, not as unexplained.
  assert.ok(
    realPlainJson.allow.deviations.length > 0,
    `the application's allowance must hold declarations a plain run reads; got ${JSON.stringify(realPlainJson.allow)}`,
  );
  assert.equal(
    realPlainJson.declared.length + realPlainJson.unused.length,
    realPlainJson.allow.deviations.length,
    `every declaration the run read must be accounted for as declared or unused; got ` +
    `${realPlainJson.declared.length} declared + ${realPlainJson.unused.length} unused of ${realPlainJson.allow.deviations.length}`,
  );
  // Green for the right reason, and the reason is stated in full: not one row is unexplained, exactly the running
  // total is declared, and no declaration has rotted. A green run whose accounting is not read is how a checker that
  // stopped seeing a window would still be believed.
  assert.equal(
    realPlainJson.unexplained.length,
    0,
    `a plain run on the real tree must explain every disagreement through the allowance; got ` +
    `${realPlainJson.unexplained.length}: ${realPlainJson.unexplained.map((problem) => problem.sentence).join(' | ')}`,
  );
  assert.equal(
    realPlainJson.declared.length,
    RUNNING_TOTAL,
    `the real tree must declare exactly the running total (${RUNNING_TOTAL}); got ${realPlainJson.declared.length}`,
  );
  assert.equal(
    realPlainJson.unused.length,
    0,
    `every declaration on the real tree must match a row (one declaration per row holds); unused: ${JSON.stringify(realPlainJson.unused)}`,
  );

  // 8. **The shipped checker still contains the reader it claims.** This test's own copy of the names proves nothing
  //    about the file the gate runs, so the markers are read from that file.
  const shipped = readFileSync(CHECKER, 'utf8');
  for (const marker of ['isComparableValue(', 'sameNumber(', 'stripCssComments(', 'applyAllow(', 'readAllow(', 'linksDesignKit(']) {
    assert.ok(shipped.includes(marker), `the shipped checker must still call ${marker}`);
  }

  // 9. **The gate member has teeth on a copy of the real tree.** Every section above judges the checker on fixtures
  //    this test owns; this one copies the **live** kit, the five windows and the application's allowance into `/tmp`
  //    and breaks one declaration at a time, because "a plain run is green" is worth nothing unless the same command
  //    goes red on the drift it exists to find. `--root` is what makes that safe: nothing below touches a tracked file,
  //    and the copy is removed in the `finally`. Measured while writing this: without section 9 the only evidence that
  //    the gate member fails on a real drift was a hand-run experiment, and a hand-run experiment is not a contract.
  const copyRoot = mkdtempSync(join(tmpdir(), 'wing-design-agreement-copy-'));
  realCopyRoots.push(copyRoot);
  mkdirSync(join(copyRoot, 'design'), { recursive: true });
  mkdirSync(join(copyRoot, 'desktop/ui'), { recursive: true });
  copyFileSync(join(REPO, 'design/tokens.css'), join(copyRoot, 'design/tokens.css'));
  for (const file of ['guide.html', 'index.html', 'ltc.html', 'meters.html', 'timecode.html']) {
    copyFileSync(join(REPO, 'desktop/ui', file), join(copyRoot, 'desktop/ui', file));
  }
  copyFileSync(join(REPO, DEFAULT_ALLOW), join(copyRoot, DEFAULT_ALLOW));
  const gate = (args = []) => spawnSync(process.execPath, [CHECKER, '--root', copyRoot, ...args], { encoding: 'utf8' });
  const gateText = (run) => `${run.stdout}\n${run.stderr}`;
  const clean = gate();
  assert.equal(
    clean.status,
    0,
    `a copy of the live tree with nothing broken must be green; got exit ${clean.status}: ${gateText(clean)}`,
  );
  assert.ok(
    gateText(clean).includes(`0 unexplained disagreement(s) · ${RUNNING_TOTAL} declared`),
    `the green copy must say what it measured (0 unexplained, ${RUNNING_TOTAL} declared); got: ${gateText(clean)}`,
  );

  // (a) An **adopted** token drifts in a window the kit paints: the window's `:root` says one thing, the kit another.
  //     `guide.html` was this contract's target until `c7d1e5b4` deleted the nine light declarations it used to
  //     restate and left the kit to paint them, so an adopted **colour** no longer exists there to break - the same
  //     mutation has to be made in a window that still carries one. `index.html`'s `:root --face` is the kit's own
  //     #c0c0c0 restated by hand (`index.html:46`), so moving it one step is one drift in the light theme, and the
  //     target guard below is what says so out loud when a later family pass deletes that too.
  const guidePath = join(copyRoot, 'desktop/ui/guide.html');
  const guideClean = readFileSync(guidePath, 'utf8');
  const indexPath = join(copyRoot, 'desktop/ui/index.html');
  const indexClean = readFileSync(indexPath, 'utf8');
  const adoptedTarget = '--face: #c0c0c0;';
  assert.ok(
    indexClean.includes(adoptedTarget),
    `the mutation target ${adoptedTarget} must exist in index.html, or this contract is stale`,
  );
  writeFileSync(indexPath, indexClean.replace(adoptedTarget, '--face: #c0c0c1;'));
  const adoptedRun = gate();
  assert.equal(
    adoptedRun.status,
    1,
    `a copy whose adopted token drifts must fail the gate member (exit 1); got ${adoptedRun.status}: ${gateText(adoptedRun)}`,
  );
  assert.ok(
    gateText(adoptedRun).includes('desktop/ui/index.html (light): --face — the kit says #c0c0c0; :root here says #c0c0c1'),
    `the failure must name the window, the theme, the token and both values; got: ${gateText(adoptedRun)}`,
  );
  assert.ok(
    gateText(adoptedRun).includes('1 unexplained disagreement(s)'),
    `the drifted copy must count its one drift; got: ${gateText(adoptedRun)}`,
  );
  // Restore the copy before the next mutation, so the second one is measured on the tree it names.
  writeFileSync(indexPath, indexClean);

  // (b) A **declared** deviation drifts: the allowance's needles are the window's own values, so a declaration that no
  //     longer describes the tree stops matching, becomes unexplained, and is named as having matched nothing. This is
  //     the contract that keeps a declaration a decision rather than a mute button on a token name.
  writeFileSync(guidePath, guideClean);
  const declaredTarget = '--ink: #e6efeb;';
  assert.ok(
    readFileSync(guidePath, 'utf8').includes(declaredTarget),
    `the mutation target ${declaredTarget} must exist in guide.html, or this contract is stale`,
  );
  writeFileSync(guidePath, guideClean.replace(declaredTarget, '--ink: #123456;'));
  const declaredRun = gate();
  assert.equal(
    declaredRun.status,
    1,
    `a copy whose declared value moves must fail the gate member (exit 1); got ${declaredRun.status}: ${gateText(declaredRun)}`,
  );
  assert.ok(
    gateText(declaredRun).includes('desktop/ui/guide.html (dark): --ink — the kit says #e0e8e4; body.theme-dark here says #123456'),
    `the failure must name the new value; got: ${gateText(declaredRun)}`,
  );
  assert.ok(
    gateText(declaredRun).includes('a declared deviation matched nothing: "#e6efeb"'),
    `the declaration that no longer matches must be named, so it cannot rot silently; got: ${gateText(declaredRun)}`,
  );
  // And the copy is left as it was found, so a later section cannot measure a tree this one broke.
  writeFileSync(guidePath, guideClean);
  const restored = gate();
  assert.equal(restored.status, 0, `the copy must be green again once the mutation is removed; got ${restored.status}`);

  // 10. **The gate member must actually run when its own path goes through a symlink.** `/tmp` is `/private/tmp` and
  //     `/var` is `/private/var`, so a copy of the checker under either has an `import.meta.url` on the resolved path
  //     and an `argv[1]` on the unresolved one. A guard comparing those two literally is false, `main()` never runs,
  //     and the file **exits 0 having measured nothing** — the one failure mode a gate member must not have, because
  //     the gate books that as PASS. Measured while writing this: `node /tmp/…/test-design-app-agreement-live.mjs
  //     --root <tree>` printed nothing and exited 0. The guard resolves symlinks now, and this pins it.
  const symlink = join(root, 'checker-via-a-symlink.mjs');
  symlinkSync(CHECKER, symlink);
  const viaLink = spawnSync(process.execPath, [symlink, '--root', REPO], { encoding: 'utf8' });
  assert.equal(
    viaLink.status,
    0,
    `a plain run through a symlink must still be green; got exit ${viaLink.status}: ${viaLink.stdout}${viaLink.stderr}`,
  );
  assert.ok(
    viaLink.stdout.includes('design kit vs application:') && viaLink.stdout.includes('0 unexplained disagreement(s)'),
    `the gate member must actually run when it is invoked through a symlink, not exit 0 having measured nothing; ` +
    `got: ${JSON.stringify(viaLink.stdout.slice(0, 200))}`,
  );

  // The file this test just measured must be the file it started with: a checker edited mid-run makes every assertion
  // above a statement about a revision nobody can name. It is the last measurement in the test for that reason.
  const checkerAfter = statSync(CHECKER);
  assert.equal(
    `${checkerAfter.size}:${checkerAfter.mtimeMs}`,
    `${checkerBefore.size}:${checkerBefore.mtimeMs}`,
    'scripts/test-design-app-agreement-live.mjs changed while this test ran: re-run it, and do not read this run as a verdict',
  );

  console.log(
    `design-app agreement: ${RUNNING_TOTAL} unexplained + ${expectedSkipped.length} skipped (the number-spelling machinery is proved on the fixture below, and no alias is left in this tree) · ` +
    'the comment is not a value · a declaration is reported as declared, never silently allowed · a plain run reads ' +
    `the application's own allowance (${DEFAULT_ALLOW} under --root), and --allow still overrides it · ` +
    `the gate member goes red on a copy of the live tree, naming the window, the theme, the token and both values · ` +
    `and it still runs when its own path goes through a symlink`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
  for (const copyRoot of realCopyRoots) rmSync(copyRoot, { recursive: true, force: true });
}
