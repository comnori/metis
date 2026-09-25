const fs=require('node:fs'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const core=require('./core.cjs');
const assert=require('node:assert/strict');
async function main(){
 if(process.platform!=='win32')throw Error('Windows-only probe');
 const dir=fs.mkdtempSync(path.resolve('../../.pre03-runs/os-'));
 const file=path.join(dir,'document.adoc');fs.writeFileSync(file,'BASELINE');
 const snap=core.read(dir,'document.adoc');
 const report={platform:process.platform,checks:[]};
 try {
  execFileSync('attrib.exe',['+R',file],{windowsHide:true});
  let error;try{core.save(dir,'document.adoc',snap,'LOCAL');}catch(e){error=e.code||e.message;}
  assert.ok(error,'Read-only original unexpectedly replaced');
  assert.equal(fs.readFileSync(file,'utf8'),'BASELINE');
  report.checks.push({name:'read-only replacement blocked; original preserved',error});
 }finally{execFileSync('attrib.exe',['-R',file],{windowsHide:true});}
 const ready=path.join(dir,'ready'),release=path.join(dir,'release');
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('lock-file.ps1'),'-File',file,'-Ready',ready,'-Release',release],{windowsHide:true,stdio:'pipe'});
 let stderr='';child.stderr.on('data',x=>stderr+=x);
 const exit=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(stderr||'Lock helper exit '+code)));});
 try{
  const deadline=Date.now()+10000;
  while(!fs.existsSync(ready)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  assert.ok(fs.existsSync(ready),'Lock acquisition timed out');
  let error;try{core.save(dir,'document.adoc',snap,'LOCAL');}catch(e){error=e.code||e.message;}
  assert.ok(error,'Exclusive sharing lock did not block save');
  report.checks.push({name:'exclusive lock blocks save',error});
 }finally{fs.writeFileSync(release,'release');await exit;}
 assert.equal(fs.readFileSync(file,'utf8'),'BASELINE');
 core.save(dir,'document.adoc',snap,'AFTER-RELEASE');
 assert.equal(fs.readFileSync(file,'utf8'),'AFTER-RELEASE');
 report.checks.push({name:'retry after lock release succeeds'});
 report.limitations=['Not a multi-file transaction or crash recovery proof','No cross-platform or final check-to-rename race guarantee'];
 fs.writeFileSync(path.resolve('../../docs/pre-03/windows-files.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
