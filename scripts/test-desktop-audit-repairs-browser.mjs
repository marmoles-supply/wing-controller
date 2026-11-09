// Regression contracts from the audit: real production pages, isolated IPC fixtures.
// No console or user files. The gate runs this suite serially with the other browser suites.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureBrowser, openTab, navigate, setViewport } from '../design/conformance/collect.mjs';
const root = new URL('../', import.meta.url);
const fixture = (file) => {
  const src = readFileSync(new URL(file, root), 'utf8');
  const a = src.indexOf('const STUB = `') + 'const STUB = '.length;
  const b = src.indexOf('\n`;', a) + 2;
  if (a < 13 || b < a) throw new Error('Fixture shape changed: ' + file);
  return Function('return ' + src.slice(a, b))();
};
const port = Number(process.env.WING_CHROME_PORT || 9223);
const browser = await ensureBrowser(port);
if (!browser.alive) throw new Error(browser.reason);
let tab;
const report = (name, observation) => {
  console.log(JSON.stringify({name,observation}));
  if(name==='confirm-cancel-enter-result') assert.equal(observation,false);
  if(name==='floating-properties') assert.equal(observation.blocksWorkspace,false);
  if(name==='cancelled-fire-and-destination') {assert.equal(observation.returned,'cancelled');assert.equal(observation.requestedDestination,observation.currentField)}
  if(name==='ltc-after-failed-polls') {assert.match(observation.state,/unavailable/i);assert.equal(observation.visibleError,true);assert.ok(observation.options.some(x=>x.includes('AUDIT NEW MACRO')))}
};
try {
  tab = await openTab(port);
  await tab.call('Page.bringToFront');
  await setViewport(tab, { width:1440, height:900 });
  await tab.call('Page.addScriptToEvaluateOnNewDocument', { source: fixture('scripts/test-desktop-interapp-smoke-browser.mjs').replace('event: { listen: async () => () => {} }', 'event: { listen: async (name, fn) => { (window.__LISTENERS ||= {}); (window.__LISTENERS[name] ||= []).push(fn); return () => {}; } }').replace('onCloseRequested: async () => () => {}', 'onCloseRequested: async (fn) => { window.__auditClose = fn; return () => {}; }') });
  await navigate(tab, new URL('desktop/ui/index.html', root).href);
  await tab.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+10000;function tick(){if(typeof openSettingsModal==='function')return resolve(true);if(Date.now()>end)return reject(Error('boot'));setTimeout(tick,25)}tick()})`);
  await tab.evaluate(`window.__auditAnswer='pending'; win95Confirm({title:'Audit only', message:'No operation is attached',confirmLabel:'Delete',danger:true}).then(v=>window.__auditAnswer=v); true`);
  await tab.evaluate(`document.getElementById('win95-confirm-cancel').focus()`);
  report('confirm-focused-control', await tab.evaluate('document.activeElement.id'));
  await tab.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
  await tab.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  report('confirm-cancel-enter-result',await tab.evaluate('window.__auditAnswer'));
  await tab.evaluate(`openSettingsModal('general');if(!document.getElementById('settings-modal-backdrop').classList.contains('is-floating'))document.getElementById('btn-toggle-float-settings').click();document.activeElement?.blur();document.body.focus()`);
  report('floating-properties',await tab.evaluate(`({floating:document.getElementById('settings-modal-backdrop').classList.contains('is-floating'),ariaModal:document.getElementById('settings-modal').getAttribute('aria-modal'),blocksWorkspace:modalLayerIsOpen(),focus:document.activeElement.tagName})`));
  await tab.evaluate(`document.getElementById('btn-close-settings').click()`);
  report('cancelled-fire-and-destination',await tab.evaluate(`(async()=>{macroLibrary={macros:[{id:'audit',name:'Audit only',wingIp:'203.0.113.10',enabled:true,actionSteps:[{enabled:true,actionMode:'set',actionAddress:'/ch/1/mute',actionArgKind:'int',actionValue:'1'}]}]};document.getElementById('wing-ip').value='203.0.113.20';window.__setStub('fire_macro',()=>({status:'cancelled',steps:[]}));const returned=await fireMacroNow(0);const call=window.__INVOKES.filter(x=>x.cmd==='fire_macro').at(-1);return{returned,requestedDestination:call?.args?.wingIp,currentField:document.getElementById('wing-ip').value}})()`));
  // Native keyboard activation, containment and focus return in the actual dialog.
  const key = async (key, code, vk, text) => {
    await tab.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,...(text?{text}:{})});
    await tab.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk});
  };
  await tab.evaluate(`document.getElementById('wing-ip').focus();window.__auditAnswer='pending';win95Prompt({value:'Keep me'}).then(v=>window.__auditAnswer=v);true`);
  await tab.evaluate(`document.getElementById('win95-prompt-cancel').focus()`);
  await key('Enter','Enter',13,'\r');
  assert.equal(await tab.evaluate('window.__auditAnswer'),null);
  assert.equal(await tab.evaluate('document.activeElement.id'),'wing-ip');
  await tab.evaluate(`window.__auditAnswer='pending';win95Confirm({}).then(v=>window.__auditAnswer=v);document.getElementById('win95-confirm-accept').focus();true`);
  await key('Tab','Tab',9);
  assert.equal(await tab.evaluate('document.activeElement.id'),'win95-confirm-cancel');
  await key('Escape','Escape',27);
  assert.equal(await tab.evaluate('window.__auditAnswer'),false);
  // A delayed old-stream event cannot turn a live replacement off, nor an operation
  // completed while a state reply was in flight.
  await tab.evaluate(`window.__setStub('ltc_input_is_running',()=>true);ltcInputOpen=true;(window.__LISTENERS['ltc-input-stream-dead']||[]).forEach(fn=>fn({payload:{message:'old stream'}}));true`);
  assert.equal(await tab.evaluate('ltcInputOpen'),true);
  await tab.evaluate(`window.__setStub('ltc_input_is_running',()=>new Promise(resolve=>window.__auditLiveness=resolve));(window.__LISTENERS['ltc-input-stream-dead']||[]).forEach(fn=>fn({payload:{message:'old stream'}}));ltcInputRevision++;window.__auditLiveness(false);true`);
  assert.equal(await tab.evaluate('ltcInputOpen'),true);
  // Closing is prevented until the backend's forced history flush permits exit.
  await tab.evaluate(`window.__auditPrevented=false;window.__setStub('quit_app',()=>{throw Error('Injected disk failure')});window.__auditClose({preventDefault(){window.__auditPrevented=true}});true`);
  assert.equal(await tab.evaluate('window.__auditPrevented'),true);
  await tab.evaluate(`document.getElementById('win95-confirm-accept').click();true`);
  await tab.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+5000;function tick(){if(document.getElementById('win95-confirm-title').textContent==='The application is still open')return resolve(true);if(Date.now()>end)return reject(Error('quit failure not reported'));setTimeout(tick,20)}tick()})`);
  assert.match(await tab.evaluate(`document.getElementById('win95-confirm-message').textContent`),/Injected disk failure/);
  await tab.evaluate(`document.getElementById('win95-confirm-accept').click();true`);
  // Restore failures at every persisted boundary; recovery failure must not stop
  // compensation of the other resources, and the saved copy must be importable.
  for (const failure of ['library','draft','cues','preferences','recovery','snapshot','library_reply','draft_reply','cues_reply']) {
    await tab.evaluate(`(() => {
      streamMode='idle';
      window.__restoreFailure=${JSON.stringify(failure)};
      window.__beforeRestore={library:{schemaVersion:1,selectedIndex:0,macros:[{id:'old',name:'Old macro',actionSteps:[]}]},draft:{name:'Old draft',actionSteps:[]},cues:{schema_version:1,cues:[],offset_frames:0,sort:'smpte',drive:'smpte'}};
      window.__restoreBackend=structuredClone(window.__beforeRestore);
      window.__restoreWrites={};window.__recoveryCopy=null;
      localStorage.setItem('wing_backup_show_name','Original show');
      localStorage.setItem('wing_backup_dirty','1');
      localStorage.setItem('wing_custom_meters','[]');
      localStorage.removeItem('wing_test_recovery_new');
      window.__setStub('load_macro_library',()=>structuredClone(window.__restoreBackend.library));
      window.__setStub('load_show_runner_config',()=>structuredClone(window.__restoreBackend.draft));
      window.__setStub('get_timecode_cues',()=>structuredClone(window.__restoreBackend.cues));
      window.__setStub('save_station_backup',(args)=>{window.__recoveryCopy=JSON.parse(args.contents);if(window.__restoreFailure==='snapshot')throw Error('Injected recovery-copy failure');return {path:'/tmp/restore-recovery.wcz'}});
      for(const [cmd,key,arg] of [['save_macro_library','library','library'],['save_show_runner_config','draft','config'],['set_timecode_cues','cues','cues']]) {
        window.__setStub(cmd,(args)=>{
          const count=window.__restoreWrites[key]=(window.__restoreWrites[key]||0)+1;
          if ((window.__restoreFailure===key&&count===1)||(window.__restoreFailure==='recovery'&&key==='library'&&count===2)) throw Error('Injected '+key+' failure');
          window.__restoreBackend[key]=structuredClone(args[arg]);if(window.__restoreFailure===key+'_reply'&&count===1)throw Error('Injected rejected reply after '+key+' commit');return structuredClone(args[arg]);
        });
      }
      window.__storageSet=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){
        if(this===localStorage&&key==='wing_custom_meters'&&['preferences','recovery'].includes(window.__restoreFailure)&&!window.__prefRefused){window.__prefRefused=true;throw Error('Injected preference failure')}
        return window.__storageSet.call(this,key,value);
      };
      window.__prefRefused=false;
      const incoming={app:'WING CONTROLLER',schemaVersion:3,scope:['macros','cues','meters','settings'],data:{
        macros:{library:{schemaVersion:1,selectedIndex:0,macros:[{id:'new',name:'New macro',actionSteps:[]}]},activeDraft:{name:'New draft',actionSteps:[]}},
        cues:{list:{schema_version:1,cues:[],offset_frames:5,sort:'smpte',drive:'smpte'}},
        meters:{customMetersWatchlist:[{key:'ch:9'}]},settings:{storage:{wing_test_recovery_new:'new'}}}};
      const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(incoming)],'restore-test.wcz',{type:'application/json'}));
      const input=document.getElementById('station-backup-file-input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await tab.evaluate(`new Promise((resolve,reject)=>{let end=Date.now()+5000;function tick(){if(document.querySelector('[data-scope="accept"]'))return resolve(true);if(Date.now()>end)return reject(Error('restore picker'));setTimeout(tick,20)}tick()})`);
    await tab.evaluate(`document.querySelectorAll('[data-scope-pick]').forEach(x=>x.checked=true);document.querySelector('[data-scope="accept"]').click();true`);
    await tab.evaluate(`new Promise((resolve,reject)=>{let end=Date.now()+5000;function tick(){if(getComputedStyle(document.getElementById('win95-confirm')).display!=='none')return resolve(true);if(Date.now()>end)return reject(Error('restore failure report'));setTimeout(tick,20)}tick()})`);
    const observed=await tab.evaluate(`({backend:window.__restoreBackend,original:window.__beforeRestore,message:document.getElementById('win95-confirm-message').textContent,recoveryProblem:window.__wingStationBackup.problem(window.__recoveryCopy),copy:window.__recoveryCopy})`);
    assert.equal(observed.recoveryProblem,null,JSON.stringify(observed));
    assert.equal(observed.backend.draft.name,observed.original.draft.name);
    assert.deepEqual(observed.backend.cues,observed.original.cues);
    if(failure==='recovery') {assert.match(observed.message,/could NOT/);assert.equal(observed.backend.library.macros[0].id,'new')}
    else assert.equal(observed.backend.library.macros[0].id,'old');
    assert.ok(observed.copy.recoveryRemoveKeys.includes('wing_test_recovery_new'));
    if(failure!=='snapshot') assert.doesNotMatch(observed.message,/nothing was changed/i);
    if(failure==='snapshot') assert.deepEqual(await tab.evaluate('window.__restoreWrites'),{});
    if(failure==='cues') assert.equal(await tab.evaluate('window.__restoreWrites.cues'),1,'a rejected validation must not reinstall unchanged cues');
    console.log('restore compensation: '+failure+' passed');
    await tab.evaluate(`Storage.prototype.setItem=window.__storageSet;document.getElementById('win95-confirm-accept').click();true`);
  }
  await tab.close(); tab=null;
  // The detached Meter Bridge uses the same policy, with its own production handlers.
  tab=await openTab(port);
  await setViewport(tab,{width:1180,height:760});
  await tab.call('Page.addScriptToEvaluateOnNewDocument',{source:fixture('scripts/test-desktop-interapp-smoke-browser.mjs')});
  await navigate(tab,new URL('desktop/ui/meters.html',root).href);
  for (const family of ['confirm','prompt']) {
    await tab.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+5000;function tick(){if(typeof metersConfirm==='function')return resolve(true);if(Date.now()>end)return reject(Error('meters boot'));setTimeout(tick,20)}tick()})`);
    await tab.evaluate(`window.__auditAnswer='pending';${family==='confirm'?'metersConfirm({danger:true})':'metersPrompt({value:"Name"})'}.then(v=>window.__auditAnswer=v);document.getElementById('meters-${family}-cancel').focus();true`);
    await key('Enter','Enter',13,'\r');
    assert.equal(await tab.evaluate('window.__auditAnswer'),family==='confirm'?false:null);
  }
  await tab.close();tab=null;
  tab=await openTab(port);
  await tab.call('Page.bringToFront');
  await setViewport(tab,{width:1180,height:760});
  const ltcFixture=fixture('scripts/test-desktop-ltc-window-browser.mjs')+`\nconst originalInvoke=window.__TAURI__.core.invoke;window.__TAURI__.core.invoke=async(cmd,args)=>{if(cmd==='timecode_state'&&window.__auditFailClock){window.__auditClockFailures=(window.__auditClockFailures||0)+1;throw Error('Audit simulated IPC failure')}if(cmd==='load_macro_library'&&window.__auditNewLibrary)return structuredClone(window.__auditNewLibrary);return structuredClone(await originalInvoke(cmd,args));};`;
  await tab.call('Page.addScriptToEvaluateOnNewDocument',{source:ltcFixture});
  await navigate(tab,new URL('desktop/ui/ltc.html',root).href);
  await tab.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+10000;function tick(){if(document.querySelector('select.cue-macro'))return resolve(true);if(Date.now()>end)return reject(Error('LTC boot'));setTimeout(tick,25)}tick()})`);
  report('ltc-before',await tab.evaluate(`({options:Array.from(document.querySelector('select.cue-macro').options).map(x=>x.textContent),state:document.getElementById('state')?.textContent,clock:document.getElementById('position')?.textContent})`));
  await tab.evaluate(`const field=document.querySelector('.dense-label');field.focus();field.value='Unsaved audit edit';field.setSelectionRange(7,7);field.dispatchEvent(new Event('input',{bubbles:true}));rehearsing=true;document.getElementById('rehearsal').checked=true;true`);
  await tab.evaluate(`window.__auditFailClock=true;window.__auditNewLibrary={schemaVersion:1,selectedIndex:0,macros:[{id:'audit-new',name:'AUDIT NEW MACRO',enabled:true,actionSteps:[]}]};(window.__LISTENERS['macro-library-changed']||[]).forEach(fn=>fn({payload:null}));true`);
  await tab.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+5000;function tick(){if(window.__auditClockFailures>=3)return resolve(true);if(Date.now()>end)return reject(Error('poll not exercised'));setTimeout(tick,50)}tick()})`);
  report('ltc-after-failed-polls',await tab.evaluate(`({failures:window.__auditClockFailures,options:Array.from(document.querySelector('select.cue-macro').options).map(x=>x.textContent),state:document.getElementById('state')?.textContent,clock:document.getElementById('position')?.textContent,visibleError:/Audit simulated IPC failure/.test(document.body.innerText),libraryReadCalls:window.__INVOKES.filter(x=>x.cmd==='load_macro_library').length})`));
  assert.equal(await tab.evaluate(`document.querySelector('.dense-label').value`),'Unsaved audit edit');
  assert.equal(await tab.evaluate(`document.querySelector('.dense-label').selectionStart`),7);
  assert.equal(await tab.evaluate(`document.getElementById('rehearsal').checked`),true);
  assert.equal(await tab.evaluate(`document.getElementById('rehearsal').disabled`),true);
  await tab.evaluate(`document.querySelector('.dense-label').dispatchEvent(new Event('change',{bubbles:true}));true`);
  assert.equal(await tab.evaluate(`cues[0].label`),'Unsaved audit edit');
  await tab.evaluate(`window.__auditFailClock=false;true`);
  await tab.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+5000;function tick(){if(!document.getElementById('state').textContent.includes('unavailable'))return resolve(true);if(Date.now()>end)return reject(Error('clock did not recover'));setTimeout(tick,50)}tick()})`);
  await tab.evaluate(`renderLastRun(['delivered','cancelled','dropped','superseded','unconfirmed',null].map((outcome,i)=>({id:String(i),at:'01:00:00:00',spent:'fired',outcome})));true`);
  const history=await tab.evaluate(`Array.from(document.querySelectorAll('.last-run-line')).map(row=>row.textContent)`);
  for(const [i,expected] of ['executed','cancelled','dropped','superseded','writes unconfirmed','outcome unknown'].entries()) assert.ok(history[i].includes(expected),history[i]);
  console.log('WING_BROWSER_SUITE_OK');
} finally { if(tab) await tab.close(); browser.close(); }
