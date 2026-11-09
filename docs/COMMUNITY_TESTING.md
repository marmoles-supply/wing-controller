# Community testing and feedback

WING CONTROLLER is a community beta. Many hardware, integration and failure paths
still need independent testing. A feature being present is not a compatibility
claim. Good results, partial results, failures and tests you could not complete
are all useful. You do not need to contribute code.

Reports can be written in **English or Spanish**. A GitHub account is needed.

| What you want to share | Form |
| --- | --- |
| Something behaved incorrectly | [Bug report / Error](https://github.com/marmoles-supply/wing-controller/issues/new?template=01-bug-report.yml) |
| A change would improve your workflow | [Improvement / Mejora](https://github.com/marmoles-supply/wing-controller/issues/new?template=02-improvement.yml) |
| You tried a defined procedure, with any outcome | [Test report / Prueba](https://github.com/marmoles-supply/wing-controller/issues/new?template=03-test-report.yml) |
| Something worked, failed or felt awkward during use | [Experience / Experiencia](https://github.com/marmoles-supply/wing-controller/issues/new?template=04-experience.yml) |

[All reports](https://github.com/marmoles-supply/wing-controller/issues) ·
[Reports awaiting review](https://github.com/marmoles-supply/wing-controller/issues?q=is%3Aissue%20is%3Aopen%20label%3Aneeds-triage) ·
[Test reports](https://github.com/marmoles-supply/wing-controller/issues?q=is%3Aissue%20label%3Atesting) ·
[Experiences](https://github.com/marmoles-supply/wing-controller/issues?q=is%3Aissue%20label%3Afeedback)

## A useful test report

1. Find the **version/build in Properties → About**. A source checkout should name
   its commit too; a source fix does not change an older installed release.
2. Describe the setup: Mac chip/model family, macOS and relevant console
   model/firmware, audio interface or other application's version. State what was
   connected and whether this was offline or a physical test.
3. Describe one procedure and expected result. Record actual observations,
   duration/repetitions and anything you could not establish.
4. Choose **Worked as expected**, **Partly worked**, **Failed** or
   **Could not complete / inconclusive**. Attach only reviewed, redacted evidence.

Test away from an active show with disposable configurations and independent
backups. Do not deliberately interrupt a real show or corrupt working data to
exercise recovery. Read the [disclaimer](../DISCLAIMER.md),
[operator guide](guide/README.md) and [known limitations](KNOWN_LIMITATIONS.md).

A software fixture, a physical-console observation and an account of show use
are different kinds of evidence. For a console write, distinguish an app's
“sent” indication, a read-back result and the change you directly observed on
the console. A good report is specific about what it proves.

## What needs testing

The [roadmap](ROADMAP.md) records detailed acceptance tasks. Useful starting points:

| Area | Useful evidence |
| --- | --- |
| Install / update | First download and app-specific macOS approval on another Apple Silicon Mac; installed version, permissions and subsequent update behaviour |
| Save / load | Export and restore disposable station data; compare the chosen scopes; isolated failure/recovery tests by contributors equipped to perform them |
| Macros | Meter and console-state triggers, IF true/false cases, waits, relative/current-value fades, overlap and stop behaviour |
| Meters | Available sources on a stated console model/firmware; banks, selectors, reconnects and displayed values |
| Inter-app MIDI / OSC | Actual message flow in both directions with stated application versions and bindings |
| LTC / MTC | Independent generators/receivers, physical audio interfaces, rates, interruptions and cue behaviour |
| Interface / HUD | Both themes, display sizes, keyboard access, notices and target windows |

A successful test applies to its **version, setup, feature and procedure**. It
never marks the entire app, every console or every third-party application as
validated. Personal experiences are welcome without being presented as
benchmarks or certification.

## How reports are handled

Every form applies `needs-triage` plus a category: `bug`, `enhancement`, `testing`
or `feedback`. The outcome selected in a form is stored in the report body;
it does **not** automatically add an outcome label or certify the result.

The intended maintainer process is:

1. Review the scope, version and evidence; remove `needs-triage` after review.
2. Ask for missing information with `needs-info`, or mark a hardware-dependent
   follow-up `needs-hardware`. Link duplicates instead of losing their evidence.
3. Use `reproduced` only when a maintainer has reproduced a defect, and record
   where/how. This is separate from a console write's “confirmed” status.
4. For tests, manually add `result:worked`, `result:partial`, `result:failed` or
   `result:inconclusive` after reviewing what the reporter actually observed.
   These classify a report; they do not mean independent certification.
5. Link actionable bugs/improvements to focused PRs and roadmap tasks. Name the
   fix/release and request a new result when retesting is needed.
6. Close an experience/test report once its evidence has been recorded or linked,
   explaining why. Closure alone does not mean a bug was fixed or acceptance passed.

This is a workflow for a community project, not a response-time or support
promise. Reports remain searchable after closure. Code contributions follow
[CONTRIBUTING](../CONTRIBUTING.md).

## Keep private information out

Issues and attachments are public. Remove credentials, serials, console discovery
names, private IP addresses, filesystem account names and show/customer/personal
data. Do not upload complete station backups or packet captures just to provide
an example. Use the smallest synthetic configuration that explains the result.

For exploitable vulnerabilities or exposed credentials, use
[private security reporting](../SECURITY.md), rather than any public feedback form.

The forms use GitHub's native issue interface. The application does not collect
or automatically upload reports through this process.
