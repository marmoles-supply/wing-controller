// A **text-level** smoke check over the parked Expo/Android tree: does the source still carry the calls the
// safety design depends on? It cannot prove behaviour — a call moved into a comment would still match — and
// the two contracts that matter behaviourally (a disconnect stops pending macro execution; an offline
// runtime releases its watched addresses) are asserted where the real engine runs, in
// `scripts/test-macro-runtime-policy.mjs` and `scripts/test-meter-runtime-safety.mjs`, by loading
// `src/osc/MacroEngine.js` in a vm and counting the packets it sends (test-suite audit, S17).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const macroEngine = await readFile(new URL('../src/osc/MacroEngine.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/app/index.tsx', import.meta.url), 'utf8');
const targetResolver = await readFile(new URL('../src/domain/targetResolver.ts', import.meta.url), 'utf8');
const nativeTransport = await readFile(
  new URL('../native/wing-osc/android/WingOscModule.kt', import.meta.url),
  'utf8',
);
const haEngine = await readFile(new URL('../src/ha/HaCompensationEngine.js', import.meta.url), 'utf8');
const wingSession = await readFile(new URL('../src/osc/WingSession.js', import.meta.url), 'utf8');
const wingDriver = await readFile(
  new URL('../src/osc/drivers/WingConsoleDriver.js', import.meta.url),
  'utf8',
);

assert.ok(!macroEngine.includes('Duck USB & LPF Filter Sweep'), 'fresh install demo macro must not return');
assert.match(macroEngine, /this\.macros = \[\];\s+await this\.saveMacros\(\)/, 'fresh install must persist an empty macro list');
assert.match(macroEngine, /stopAllExecutions\(reason = 'safety stop'\)/, 'macro execution cancellation must exist');
assert.match(app, /enabled: false,\s+mode: 'inverse'/, 'new automations must start disabled');
assert.match(app, /MacroEngine\.executeMacro\(macro\)/, 'manual RUN must use normal macro validation');
assert.match(app, /stopAllExecutions\?\.\('console disconnected'\)/, 'disconnect must stop pending macro execution');
assert.match(app, /isCompleteBackupPayloadValid\(parsed\)/, 'complete backups must be validated before restore');
assert.match(app, /collectMacroTargetResolutionReport/, 'macro preflight must use the shared target resolution report');
assert.match(targetResolver, /Select at least one target object/, 'shared target resolver must reject blank fixed targets instead of defaulting to channel 1');
assert.match(targetResolver, /Target does not resolve to any OSC address/, 'shared target resolver must reject non-resolving macro targets');
assert.match(app, /addActionWithType = \(type: 'osc' \| 'delay' \| 'fade' \| 'automation_cue' \| 'automization_control'\)/, 'macro action picker must expose refined automation action types');
assert.match(app, /selectedPresetExportIds\.length > 0 \? 'EXPORT SELECTED' : 'EXPORT ALL'/, 'show preset export must support selected-preset mode');
assert.match(app, /buildAutomizationPreflight\(item\)\.errors\.length === 0/, 'invalid enabled automations must be excluded from runtime');
assert.ok(!app.includes('[...mergedItems, ...appPresets].slice(0, MAX_APP_PRESETS)'), 'preset imports must not silently evict saved presets');
assert.match(macroEngine, /this\.macros\.length >= MAX_MACROS/, 'macro creation and duplication must respect the storage limit');
assert.match(macroEngine, /executeAutomationCue\(address, cue = \{\}, generation = this\.executionGeneration, context = null\)/, 'macro engine must run refined automation cues with runtime context');
assert.match(macroEngine, /action\.type === 'automization_control'/, 'macro engine must dispatch saved automation control actions');
assert.match(macroEngine, /cue\.curve === 'legacy'\s+\?\s+\(isFaderFade \? 'smooth' : 'linear'\)/, 'legacy fade behavior must remain compatible while automation cues can use explicit curves');
assert.match(macroEngine, /getTriggerStateKey\(macro, address\)/, 'meter trigger edge state must be scoped by macro and address');
assert.match(macroEngine, /triggerMeterMode === 'transient'/, 'meter triggers must support explicit FAST/transient profile');
// This used to assert a comment in the parked Android engine ("tokens 0xa7 request / 0xa8
// response"), which is wrong: 0xA7/0xA8 are the *request* group tokens for source and output
// devices, and the frame comes back as meter data. Assert the shipping constants instead.
const wingCore = await readFile(new URL('../crates/wing-core/src/lib.rs', import.meta.url), 'utf8');
assert.match(
  wingCore,
  /TOKEN_SOURCE(:\s*\w+)?\s*=\s*0x[aA]7/,
  'the Channel 3 source-group request token must stay 0xA7 (Maillot)',
);
assert.match(
  wingCore,
  /TOKEN_OUTPUT(:\s*\w+)?\s*=\s*0x[aA]8/,
  'the Channel 3 output-group request token must stay 0xA8 (Maillot)',
);
assert.match(macroEngine, /normalizeExecutionPolicy/, 'macros must normalize an explicit execution policy');
assert.match(macroEngine, /activeMacroRuns = new Map/, 'macro engine must track per-macro runtime state');
assert.match(macroEngine, /getMacroRuntimeSnapshot/, 'macro engine must expose operator-visible runtime counters');
assert.match(macroEngine, /notifyRuntimeListeners/, 'runtime counter changes must notify UI without rebuilding watched addresses');
assert.match(macroEngine, /overlapStrategy === 'drop'/, 'macro execution policy must support drop overlap mode');
assert.match(macroEngine, /baseline established/i, 'trigger evaluation must suppress initial sync/baseline edges');
assert.match(macroEngine, /triggerMeterStaleAfterMs/, 'meter triggers must track stale gaps before firing again');
assert.match(macroEngine, /this\.runtimeSuspended \|\| !this\.consoleOnline/, 'background or offline macro runtime must release its watched addresses');
assert.match(app, /macroOverlapStrategy/, 'macro editor must persist overlap policy');
assert.match(app, /macroRuntimeMap/, 'macro UI must retain runtime counter snapshots');
assert.match(app, /formatMacroRuntimeSummary/, 'macro UI must render operator-readable runtime counters');
assert.match(app, /triggerMeterDwellMs/, 'macro editor must expose meter dwell tuning');
assert.match(app, /triggerMeterStaleAfterMs/, 'macro editor must expose meter stale tuning');
assert.match(app, /const macroPreviewItems = macros;/, 'workspace macro quick list must not silently stop after three items');
assert.match(app, /macro\.enabled === true/, 'macro UI must match the engine enabled-state contract');
assert.match(app, /MeterRows[\s\S]+entry\.value !== null[\s\S]+Waiting for meter packets[\s\S]+onActionPress/, 'meter rows must remain editable while waiting for offline/live packets');
assert.ok(!app.includes('NEW CUSTOM'), 'meter workspace must not create empty custom groups from ambiguous NEW CUSTOM buttons');
assert.match(app, /customMeterNameModalVisible/, 'custom meter groups must have a naming modal');
assert.match(app, /RENAME METER GROUP/, 'custom meter groups must support renaming');
assert.match(app, /GROUP NAME/, 'custom meter group creation must collect a show/operator name');
assert.match(app, /CREATE FROM VIEW/, 'meter workspace must create custom groups from a concrete meter view');
assert.match(app, /openCustomMeterNameModal\(\[entry\.address\]\)/, 'row-level meter ADD must seed a named custom group from a concrete meter address');
assert.match(app, /addresses\.length === 0 && \/\^Custom Meters/, 'legacy empty auto-named custom meter groups must be filtered on load');
assert.match(app, /meterSelectionMode/, 'meter workspace must expose an explicit multi-select mode');
assert.match(app, /PanResponder\.create/, 'meter rows must support touch drag selection for adjacent meters');
assert.match(app, /meterSelectionDragRail/, 'drag selection must be constrained to a visible rail so normal scrolling remains usable');
assert.match(app, /ADD SELECTED TO/, 'selected meters must be addable to the active named custom group');
assert.match(app, /REMOVE SELECTED/, 'custom meter groups must support removing selected meters in bulk');
assert.match(app, /openCustomMeterNameModal\(meterSelectedDraftAddresses\)/, 'selected meters must seed the named custom group flow');
assert.match(app, /meterSelectionRangePresets/, 'meter selection mode must expose quick adjacent range presets');
assert.match(app, /SELECTED FROM/, 'meter selection counter must name the current meter view context');
assert.match(app, /duplicateCustomMeterGroup/, 'custom meter groups must be duplicable for show variants');
assert.match(app, /MOVE UP/, 'custom meter group selected meters must be reorderable upward');
assert.match(app, /MOVE DOWN/, 'custom meter group selected meters must be reorderable downward');
assert.match(app, /GLOBAL_METER_OVERVIEW_SAMPLE_PER_GROUP = 1/, 'global meter overview must keep its network footprint small');
assert.match(app, /METER_UI_RATE_OPTIONS[\s\S]+smooth[\s\S]+intervalMs: 16/, 'meter UI rate settings must keep a smooth 60 fps profile');
assert.match(app, /setMeterVisualPublishIntervalMs\?\.\(meterUiUpdateIntervalMs\)/, 'meter UI rate settings must reach the OSC session');
assert.match(wingSession, /maxVisualMeterRequestValueBudget \|\| 96/, 'visual meters must have a lower request budget than trigger-critical meters');
assert.match(wingSession, /isRuntimeCriticalMeterAddress\(address\)/, 'runtime-critical meter triggers must bypass visual coalescing');
assert.match(wingSession, /watchedStateRefreshIntervalMs \|\| 20/, 'watched-state refreshes must be paced');
assert.match(wingDriver, /scheduleWatchedStateRefresh\(mergedAddresses\)/, 'WING keepalive must use paced watched-state refreshes');
assert.ok(!wingDriver.includes('mergedAddresses.forEach'), 'WING keepalive must not restore synchronous refresh bursts');
assert.match(haEngine, /this\.persistenceBlocked \|\| this\.pairs\.length >= MAX_HA_PAIRS/, 'HA creation must stop when storage is blocked or full');
assert.match(nativeTransport, /Executors\.newSingleThreadExecutor\(\)/, 'native writes must use serial executors');
assert.match(nativeTransport, /pendingSocket\?\.close\(\)/, 'failed native TCP connects must close their pending socket');
assert.ok(!nativeTransport.includes('fun startProxy('), 'unused native TCP proxy must remain removed');

console.log('Live safety contract tests passed.');
