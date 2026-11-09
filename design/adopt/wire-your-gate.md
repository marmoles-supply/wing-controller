# Wire the judge into YOUR gate

The kit ships the judge; the exit code is what makes it a contract. **Put this in whatever runs before you ship** - your
`verify-all.sh`, your `Makefile`, your CI job.

```sh
# Adjust the paths to where you copied the kit and named your page.
node <kit>/conformance/run.mjs --app <your page> --port 9335
```

**The runnable version of this is `gate.sh.example`** — the smallest gate to copy, paste and run: the judge on your
pages, the kit's own self-test, and your screenshot lock, one line per check, each command marked as the kit's or yours,
exiting non-zero on the first failure with the four codes below.

## Exit codes, and what each means

| code | meaning | what to do |
|---|---|---|
| **0** | nothing found that is not declared | nothing |
| **1** | findings that are not declared | fix them, or declare each one **with a reason** |
| **2** | bad command line | read the usage line |
| **3** | **COULD-NOT-RUN** - no browser, no page, no tab | **never treat this as a pass**: it means nothing was measured |

`3` is the one that matters most. A suite that exits 0 without having measured anything is worse than no suite: it is a
green light nobody earned. If your gate cannot start a browser, **fail**, do not skip.

## Three rules that keep the check honest

1. **A private port, never someone else's.** If another process owns the debugging port, two runs can still fight over the browser — one may close a tab, or the browser itself, under the other's run, and a run killed that way measures nothing. What they no longer do is **lie about layout**: the suite forces its own declared viewport (`Emulation.setDeviceMetricsOverride`, 756 × 469) on every tab before a page is loaded, so a browser another run started cannot change what rule 11 sees. The private port is still the rule.
2. **The page must be the one you ship**, byte for byte. Judging a copy of a copy measures nothing.
3. **A native view cannot be judged by this suite**, which reads a rendered web page. Say **"declared, not verified"** and
   mean it; a claim of verification you cannot make is the defect this whole kit exists to remove.

## Where the contract lives, in one line each

- **The version you declare** tells the dashboard what you took.
- **The reasons you write** tell the next reader why you differ.
- **The red in your gate** is the only one of the three that works when nobody is looking.
