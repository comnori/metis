import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
const require=createRequire(import.meta.url), adoc=require('@asciidoctor/core');
const root=path.resolve('../..'), measurements=[];
for(const profile of ['small','medium','large']){
 const dir=path.join(root,'.pre02-runs','audit-'+profile);
 if(!fs.existsSync(dir))throw Error('Generate PRE-02 audit-'+profile+' first');
 const db=new DatabaseSync(':memory:');db.exec('CREATE VIRTUAL TABLE docs USING fts5(path UNINDEXED,body)');
 const insert=db.prepare('INSERT INTO docs VALUES (?,?)');
 let t=performance.now();let documents=0;
 db.exec('BEGIN');
 for(const name of fs.readdirSync(path.join(dir,'nodes'))){insert.run(name,fs.readFileSync(path.join(dir,'nodes',name),'utf8'));documents++;}
 db.exec('COMMIT');
 const indexMs=performance.now()-t;
 t=performance.now();const matches=db.prepare('SELECT path FROM docs WHERE docs MATCH ?').all('"TOKEN-00042"');
 const searchMs=performance.now()-t;if(matches.length!==1)throw Error('Search mismatch');db.close();
 const renders=[];
 for(let repetition=0;repetition<2;repetition++){
  t=performance.now();const html=await adoc.convertFile(path.join(dir,'large.adoc'),{safe:'secure',to_file:false});
  renders.push({milliseconds:performance.now()-t,outputBytes:Buffer.byteLength(html)});
 }
 measurements.push({profile,documents,indexMs,searchMs,renders,nodeRssBytes:process.memoryUsage().rss});
}
const result={platform:process.platform,arch:process.arch,node:process.versions.node,cpu:os.cpus()[0].model,totalMemoryBytes:os.totalmem(),measurements,limitations:['Single process, two renders per profile; not cold-start isolation','In-memory FTS index, not production index or graph','No performance acceptance thresholds applied']};
fs.writeFileSync(path.join(root,'docs/pre-03/benchmark.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
