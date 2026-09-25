process.parentPort.on('message',async ({data})=>{
  try {
    const adoc=require('@asciidoctor/core');
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(':memory:');
    db.exec('CREATE VIRTUAL TABLE docs USING fts5(body)');
    db.prepare('INSERT INTO docs VALUES (?)').run('한글 source');
    const sqlite=db.prepare('select sqlite_version() as version').get().version;
    db.close();
    const html=await adoc.convert(data.text,{safe:'secure'});
    process.parentPort.postMessage({html,sqlite,node:process.versions.node});
  }catch(error){process.parentPort.postMessage({error:String(error)});}
});
