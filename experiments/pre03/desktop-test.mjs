import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('../..');
const out=path.join(root,'docs/pre-03'); fs.mkdirSync(out,{recursive:true});
const packaged=process.env.PRE03_PACKAGED;
const start=performance.now();
const launchEnv={...process.env,PRE03_WORKSPACE:path.join(root,'docs/fixtures/pre-02/workspace'),PRE03_USERDATA:path.join(root,'.pre03-runs','profile-'+Date.now())};
delete launchEnv.ELECTRON_RUN_AS_NODE;
const instance=await electron.launch({...(packaged?{executablePath:packaged,args:[]}:{args:['.']}),env:launchEnv,timeout:30000});
const report={mode:packaged?'packaged':'development',checks:[]};
try {
 const page=await instance.firstWindow();
 await page.waitForFunction(()=>window.editor && document.querySelector('#worker').textContent.includes('sqlite'));
 report.startupMs=performance.now()-start;
 report.versions=await instance.evaluate(()=>process.versions);
 const check=(name,condition)=>{assert.ok(condition,name);report.checks.push(name);};
 check('renderer has no Node or raw IPC',await page.evaluate(()=>typeof window.require==='undefined' && typeof window.process==='undefined' && typeof window.probe==='object' && !('ipcRenderer' in window.probe)));
 const snap=await page.evaluate(()=>window.probe.readDocument('authoring.adoc'));
 check('validated IPC reads fixture',snap.text.includes('SEARCH-EXACT-7319'));
 for(const input of ['../errors/incomplete.adoc',42]) {
  check('invalid IPC argument rejected: '+input,await page.evaluate(async value=>{try{await window.probe.readDocument(value);return false;}catch{return true;}},input));
 }
 check('utility uses Asciidoctor and SQLite',await page.evaluate(()=>{const r=JSON.parse(document.querySelector('#worker').textContent);return r.html.includes('Preserve source.') && !!r.sqlite;}));
 report.worker=await page.evaluate(()=>JSON.parse(document.querySelector('#worker').textContent));
 check('CodeMirror edit undo redo',await page.evaluate(()=>{const before=window.editor.state.doc.toString();window.editor.dispatch({changes:{from:before.length,insert:'한글 편집'}});const after=window.editor.state.doc.toString();window.undoProbe();const undone=window.editor.state.doc.toString();window.redoProbe();return undone===before && window.editor.state.doc.toString()===after;}));
 check('DOMPurify strips script, handlers and javascript URL',await page.evaluate(()=>{const s=window.purifyProbe('<script>evil()</script><img src=x onerror="evil()"><a href="javascript:evil()">link</a>');return !/script|onerror|javascript:/i.test(s);}));
 check('iframe cannot script parent',await page.evaluate(()=>!window.__escaped));
 const frame=page.frames().find(f=>f!==page.mainFrame());
 check('iframe has no preload bridge',await frame.evaluate(()=>typeof window.probe==='undefined'));
 report.metrics=await instance.evaluate(({app})=>app.getAppMetrics().map(m=>({type:m.type,memory:m.memory})));
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error);throw error;}
finally{fs.writeFileSync(path.join(out,`desktop-${report.mode}.json`),JSON.stringify(report,null,2));await instance.close();}
