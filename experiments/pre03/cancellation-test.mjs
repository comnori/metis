import {_electron as electron} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('../..');
const env={...process.env,PRE03_WORKSPACE:path.join(root,'docs/fixtures/pre-02/workspace'),PRE03_USERDATA:path.join(root,'.pre03-runs','cancel-'+Date.now())};
delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.'],env});
try{
 const page=await app.firstWindow();await page.waitForFunction(()=>window.editor);
 await app.evaluate(async({utilityProcess},worker)=>{
  const child=utilityProcess.fork(worker);globalThis.probeChild=child;
  globalThis.probeWatchdog=setTimeout(()=>child.kill(),10000);
  await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('exit',()=>reject(Error('premature exit')));child.postMessage('run');});
 },path.resolve('electron/stress.cjs'));
 const t=performance.now();
 assert.ok(await page.evaluate(()=>{window.editor.dispatch({changes:{from:0,insert:'RESPONSIVE\n'}});return window.editor.state.doc.toString().startsWith('RESPONSIVE');}));
 const inputMs=performance.now()-t;
 const cancellation=await app.evaluate(async()=>{
  const c=globalThis.probeChild;
  const exited=new Promise(resolve=>c.once('exit',code=>resolve(code)));
  const killed=c.kill();const code=await exited;clearTimeout(globalThis.probeWatchdog);return {killed,code};
 });
 assert.ok(cancellation.killed);
 assert.ok(await page.evaluate(()=>window.editor.state.doc.toString().startsWith('RESPONSIVE')));
 fs.writeFileSync(path.join(root,'docs/pre-03/cancellation.json'),JSON.stringify({inputMs,cancellation,status:'passed',limitations:['CPU-bound synthetic utility job, not cancellation of Asciidoctor itself','Workspace epoch response rejection not implemented']},null,2));
}finally{await app.close();}
