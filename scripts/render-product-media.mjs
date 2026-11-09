#!/usr/bin/env node
// Product assets use the real UI in an isolated offline browser. They are examples,
// never live-console or audio-performance evidence. No operator files are read.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { startPrivateBrowser, openTab, requireStableDoubleCapture } from './lib/design-screens.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'assets/product');
await fs.mkdir(out, { recursive: true });
await fs.copyFile(path.join(root, 'desktop/ui/logo-marble-w.png'), path.join(out, 'mark.png'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await startPrivateBrowser();
let tab;
const records = [];
const base = {
  wingIp: '192.168.1.10', triggerCategory: 'ch', triggerIds: '1', triggerParameter: 'meter',
  triggerOperator: '<', triggerThreshold: -42, triggerEdgeMode: 'on', triggerMeterMode: 'transient',
  triggerMeterCooldownMs: 250, triggerMeterRearmDb: 3, triggerMeterDwellMs: 0,
  triggerMeterStaleAfterMs: 1500, macroOverlapStrategy: 'drop', logicalOperator: 'AND',
  conditions: [], enabled: false, armed: false, courtesyNotice: true,
};
const step = (label, channel, parameter, value, mode = 'set') => ({
  label, enabled: true, targetCategory: 'ch', targetIds: String(channel), targetParameter: parameter,
  sendId: 1, actionAddress: `/ch/${channel}/${parameter === 'fader' ? 'fdr' : 'mute'}`,
  actionArgKind: parameter === 'fader' ? 'float' : 'int', actionValue: String(value), actionMode: mode,
  delayMs: 0, fadeFrom: 'current', fadeTo: 'value', fadeStartValue: 0, fadeEndValue: Number(value), fadeDurationMs: 1800,
});
const inertStep = {enabled:true,targetCategory:'',targetIds:'',targetParameter:'',targetModel:'',
  sendId:1,actionAddress:'/',actionArgKind:'none',actionValue:'',delayMs:0,
  fadeFrom:'value',fadeTo:'value',fadeStartValue:0,fadeEndValue:0,fadeDurationMs:1000};
const hud = (title,message,target='main') => ({...inertStep,label:title,actionMode:'hud_alert',
  alertTitle:title,alertMessage:message,alertUrgency:'cue',alertFlash:'static',alertDisplay:'center_hud',
  alertDurationMs:5000,alertSound:'none',alertIcon:'[>]',alertCardSize:'large',alertScale:1,
  alertFontSizeTitle:22,alertFontSizeMsg:16,alertTargetWindow:target});
const gate = (ids,value,label) => ({label,targetCategory:'ch',targetIds:ids,targetParameter:'mute',
  targetModel:'',operator:'==',value,sendId:1,enabled:true});
// An illustrative editor configuration, not a tested show preset or safety interlock.
// Conditions are sampled at the automatic trigger; no continuous supervision is implied.
const richMacro = {...base,key:'demo-intro',name:'INTRO CHANGEOVER',colorTag:'blue',
  triggerIds:'40',triggerOperator:'>',triggerThreshold:-24,triggerMeterCooldownMs:1200,
  triggerMeterRearmDb:6,triggerMeterDwellMs:60,triggerMeterStaleAfterMs:2000,
  conditions:[gate('39','0','Playback is unmuted'),gate('1','1','Lead vocal is muted')],
  actionSteps:[hud('STAND BY','Preparing the changeover.'),
    {...inertStep,label:'Lower playback by 12 dB over 1500 ms',actionMode:'automation_cue',
      targetCategory:'ch',targetIds:'39',targetParameter:'fader',actionAddress:'/ch/39/fdr',
      actionArgKind:'float',actionValue:'-12',fadeFrom:'current',fadeTo:'relative',
      fadeStartValue:0,fadeEndValue:-12,fadeDurationMs:1500},
    {...inertStep,label:'Wait 500 ms',actionMode:'delay',delayMs:500},
    {...inertStep,label:'Unmute vocal channels 1-4',actionMode:'set',targetCategory:'ch',
      targetIds:'1-4',targetParameter:'mute',actionAddress:'/ch/1/mute',actionArgKind:'int',actionValue:'0'},
    hud('INTRO','Check the next cue.','meters')]};
const macros = [
  richMacro,
  { ...base, key: 'demo-2', name: 'WALK-IN FADE', colorTag: 'amber', triggerIds: '39', triggerOperator: '>', triggerThreshold: -24, actionSteps: [step('Fade walk-in music', 39, 'fader', -36, 'fade')] },
  { ...base, key: 'demo-3', name: 'SHOW CHANGEOVER', colorTag: 'blue', triggerIds: '40', triggerOperator: '>', triggerThreshold: -18,
    actionSteps: [step('Mute walk-in music', 39, 'mute', 1), { ...step('Wait 250 ms, then open vocal', 1, 'mute', 0, 'delay_set'), delayMs: 250 }] },
];
const namedMeters = ['KICK', 'SNARE', 'BASS', 'GUITAR', 'VOX 1', 'VOX 2', 'TALK', 'FX RETURN'];
const meterNames = Array.from({length:40},(_,i)=>namedMeters[i] || `CH ${i+1}`);
const seed = theme => `(() => {
  localStorage.clear();
  localStorage.setItem('wing_theme', ${JSON.stringify(theme)});
  localStorage.setItem('wing_macro_summary', 'blocks');
  localStorage.setItem('wing_mock_macro_library', ${JSON.stringify(JSON.stringify({ schemaVersion: 1, selectedIndex: 0, macros }))});
  localStorage.setItem('wing_custom_meters', ${JSON.stringify(JSON.stringify(meterNames.map((label, i) => ({key: 'ch:' + (i + 1), label}))))});
  localStorage.setItem('wing_meter_banks', ${JSON.stringify(JSON.stringify([{id:'vocals',name:'Vocals',keys:['ch:5','ch:6']},{id:'rhythm',name:'Rhythm',keys:['ch:1','ch:2','ch:3','ch:4']}]))});
})();`;
async function load(file) {
  const ready = tab.waitForEvent('Page.loadEventFired');
  await tab.call('Page.navigate', { url: new URL(file, 'file://' + root).href });
  await ready;
  await tab.evaluate('document.fonts.ready');
  await pause(650);
}
async function prepareEditor() {
  await tab.evaluate(`selectedStepIndex=1;applyStepToFields(actionSteps[1]);applyMacroSummary('blocks');syncState()`);
}
async function shot(name, clip = null, scale = 1) {
  const capture = async () => Buffer.from((await tab.call('Page.captureScreenshot', {
    format:'png', fromSurface:true, captureBeyondViewport: !!clip,
    ...(clip ? {clip:{...clip,scale}} : {}),
  })).data, 'base64');
  const bytes = await requireStableDoubleCapture(capture, {settleMs:150,what:name,attempts:3});
  await fs.writeFile(path.join(out,name),bytes);
  records.push({file:name,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  console.log(`${name}: ${bytes.length} bytes`);
}
async function elementShot(name, selector, scale = 1) {
  await pause(180);
  const rect = await tab.evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.floor(r.x+scrollX),y:Math.floor(r.y+scrollY),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
  if (rect.width < 10 || rect.height < 10) throw Error(`Missing preview: ${selector}`);
  await shot(name, rect, scale);
}
try {
  tab = await openTab(browser);
  await tab.call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  for (const theme of ['dark','light']) {
    const installed = await tab.call('Page.addScriptToEvaluateOnNewDocument',{source:seed(theme)});
    await load('desktop/ui/index.html');
    await prepareEditor();
    const text = await tab.evaluate('document.body.innerText');
    if (!text.includes('INTRO CHANGEOVER') || !text.includes('OFFLINE') || text.includes('meters (not in this catalogue)')) throw Error('Offline example did not load correctly');
    await shot(`workstation-${theme}.png`);
    await elementShot(`macro-recipe-${theme}.png`, '#macro-recipe');
    await tab.evaluate(`document.getElementById('meter-response-details').open=true;
      syncTriggerResponsePresetFromFields();updateTriggerKindUi()`);
    await elementShot(`macro-trigger-${theme}.png`, '.workflow-block:has(#trigger-category)');
    await elementShot(`macro-if-${theme}.png`, '.workflow-block:has(#condition-list)');
    for (const [name,selector] of [['type','label:has(#action-mode)'],['duration','#fade-ms-field'],
      ['from','#fade-from-mode-field'],['to','#fade-to-mode-field'],['amount','#fade-end-field']]) {
      await elementShot(`fade-${name}-${theme}.png`,selector,2);
    }
    await elementShot(`action-steps-${theme}.png`, '.workflow-block:has(#action-steps-list)');
    await load('desktop/ui/index.html');
    await prepareEditor();
    // Selection only: neither Apply nor any console/action command is called.
    await tab.evaluate(`(() => {
      const ids=document.getElementById('target-ids');ids.value='1-8,17,18';
      openChannelMatrix(ids,document.getElementById('target-category'));
    })()`);
    await elementShot(`channel-selection-${theme}.png`, '#channel-matrix-modal');
    await tab.evaluate('closeChannelMatrix()');
    await tab.evaluate(`openChannelMatrix(document.getElementById('meter-add-ids'),document.getElementById('meter-add-group'));
      selectBank(1,8);selectBank(17,24)`);
    await elementShot(`meter-selection-${theme}.png`, '#channel-matrix-modal');
    await tab.evaluate('closeChannelMatrix()');
    // Direct frontend renderers: no fake backend, MIDI event or console write.
    await tab.evaluate(`(() => {
      localStorage.setItem('wing_courtesy_notice_prefs',JSON.stringify({soundEnabled:false,durationMs:0,scale:1.3,flash:'off'}));
      showCourtesyNotice({name:'EXAMPLE NOTICE',triggerOperator:'>',triggerThreshold:-24,
        actionSteps:[{actionMode:'hud_alert',alertTitle:'CHANGEOVER',alertMessage:'Check the next cue.'}]},{});
    })()`);
    await elementShot(`notice-${theme}.png`, '.courtesy-notice-card');
    await tab.evaluate(`document.getElementById('courtesy-notice-container').innerHTML='';
      showHudAlert({title:'CHANGEOVER',message:'Stand by for the next section.',urgency:'cue',
        displayMode:'center_hud',flashStyle:'static',sound:'none',durationMs:0,
        cardSize:'large',scale:1,fontSizeTitle:26,fontSizeMsg:20})`);
    await elementShot(`hud-${theme}.png`, '#hud-alert-overlay .hud-alert-card');
    await tab.evaluate(`dismissHudAlert();window.openSettingsModal('hud')`);
    await elementShot(`hud-preferences-${theme}.png`, '#settings-modal');
    await tab.call('Emulation.setDeviceMetricsOverride',{width:1280,height:600,deviceScaleFactor:1,mobile:false});
    await load('desktop/ui/meters.html');
    await shot(`meter-bridge-${theme}.png`);
    await tab.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:installed.identifier});
    await tab.call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  }
  await tab.call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await load('assets/product/artboards.html');
  for (const [id,name] of [['hero','hero.png'],['library','macro-detail.png'],['selection','selection-detail.png'],['meters','meters-detail.png'],['messages','messages-detail.png'],['install','install.png'],['themes','themes.png'],['steps','steps-detail.png']]) {
    const rect = await tab.evaluate(`(() => {const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}})()`);
    await shot(name,rect);
  }
  const mark=await fs.readFile(path.join(out,'mark.png'));
  records.push({file:'mark.png',width:mark.readUInt32BE(16),height:mark.readUInt32BE(20),bytes:mark.length,sha256:createHash('sha256').update(mark).digest('hex')});
  await fs.writeFile(path.join(out,'media-manifest.json'),JSON.stringify({
    appVersion:JSON.parse(await fs.readFile(path.join(root,'version.json'),'utf8')).version,
    appBuild:JSON.parse(await fs.readFile(path.join(root,'version.json'),'utf8')).build,
    uiSha256:createHash('sha256').update(await fs.readFile(path.join(root,'desktop/ui/index.html'))).digest('hex'),
    sourceRevisionAtCapture:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    browser:browser.version.Browser,
    provenance:'Real production HTML/CSS rendered offline in an isolated browser with synthetic example configurations. No live session, console, audio signal or operator data. Element crops and CSS compositions of these renders.',
    colours:{desk:'#008080',face:'#c0c0c0',title:'#000080'},files:records,
  },null,2)+'\n');
} finally {if (tab) await tab.close();await browser.close();}
