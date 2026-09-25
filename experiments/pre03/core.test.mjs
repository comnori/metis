import {test, expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const require = createRequire(import.meta.url);
const adoc = require('@asciidoctor/core');
const core = require('./core.cjs');
const root = path.resolve('../..');
const fixtures = path.join(root, 'docs/fixtures/pre-02');
const ws = path.join(fixtures, 'workspace');
const run = path.join(root, '.pre03-runs');
fs.mkdirSync(run, {recursive:true});

for (const kind of ['internal', 'public']) {
  test(`SPEC-03 trusted fixture ${kind}: nested includes, conditions, tags and source location`, async()=> {
    // Unsafe is used ONLY on reviewed, repository-owned fixture bytes, never user content.
    const d = await adoc.loadFile(path.join(ws, 'composition', kind+'.adoc'), {safe:'unsafe', sourcemap:true});
    const html = await d.convert();
    expect(html).toContain('AUDIENCE: '+kind);
    expect(html).toContain(kind === 'internal' ? 'INTERNAL-ONLY-8123' : 'PUBLIC-ONLY-8123');
    expect(html).not.toContain(kind === 'internal' ? 'PUBLIC-ONLY-8123' : 'INTERNAL-ONLY-8123');
    expect(html).toContain('GLOSSARY-SHARED-9123');
    expect(html).toContain('POLICY-SHARED-6123');
    expect(html).not.toContain('POLICY-OUTSIDE-TAG-6123');
    expect(d.getSections()[0].getSourceLocation().getFile().replaceAll('\\','/')).toContain('chapters/intro.adoc');
    expect(d.getSections()[0].getSourceLocation().getLineNumber()).toBe(1);
  });
}
test('SPEC-03 safe default exposes sibling include jail limitation', async()=> {
  const d = await adoc.loadFile(path.join(ws,'composition/internal.adoc'), {safe:'safe'});
  expect(await d.convert()).toContain('Unresolved directive');
});
test('SPEC-03 secure mode does not expand external includes', async()=> {
  const html = await adoc.convertFile(path.join(fixtures,'boundary/workspace/index.adoc'), {safe:'secure',to_file:false});
  expect(html).not.toContain('OUTSIDE-WORKSPACE-9100');
});
test('SPEC-03 missing include yields diagnostic, original unchanged', async()=> {
  const file = path.join(fixtures,'errors/missing-include.adoc');
  const before = fs.readFileSync(file);
  const logger = new adoc.MemoryLogger();
  adoc.LoggerManager.setLogger(logger);
  try {
    const d = await adoc.loadFile(file,{safe:'safe'});
    expect(await d.convert()).toContain('Unresolved directive');
    expect(logger.getMessages().length).toBeGreaterThan(0);
    expect(fs.readFileSync(file)).toEqual(before);
  } finally { adoc.LoggerManager.setLogger(new adoc.NullLogger()); }
});
test('SPEC-03 duplicate id emits a diagnostic', async()=> {
  const logger = new adoc.MemoryLogger(); adoc.LoggerManager.setLogger(logger);
  try {
    await adoc.loadFile(path.join(fixtures,'errors/duplicate-anchor.adoc'),{safe:'safe'});
    expect(JSON.stringify(logger.getMessages())).toContain('duplicate');
  } finally { adoc.LoggerManager.setLogger(new adoc.NullLogger()); }
});
test('SPEC-03 include cycle terminates with finite max depth', async()=> {
  const d = await adoc.loadFile(path.join(fixtures,'errors/cycle-a.adoc'),{safe:'safe',attributes:{'max-include-depth':5}});
  expect((await d.convert()).length).toBeLessThan(10000);
});
test('SPEC-03 unknown and incomplete source remain readable without rewriting', async()=> {
  for(const name of ['unknown-extension','incomplete']) {
    const file=path.join(fixtures,'errors',name+'.adoc'), before=fs.readFileSync(file);
    const doc=await adoc.loadFile(file,{safe:'secure'});
    expect(typeof await doc.convert()).toBe('string');
    expect(fs.readFileSync(file)).toEqual(before);
  }
});
for (const variant of ['lf','bom-crlf','no-newline']) {
  test(`SPEC-02/04 ${variant} UTF-8 byte-preserving save`, ()=> {
    const dir=fs.mkdtempSync(path.join(run,'bytes-'));
    const text='= 한글 café\n\nText  \n';
    const bytes=variant==='bom-crlf'?Buffer.concat([Buffer.from([239,187,191]),Buffer.from(text.replaceAll('\n','\r\n'))]):Buffer.from(variant==='no-newline'?text.slice(0,-1):text);
    fs.writeFileSync(path.join(dir,'공백 문서.adoc'),bytes);
    const snapshot=core.read(dir,'공백 문서.adoc');
    core.save(dir,'공백 문서.adoc',snapshot,snapshot.text);
    expect(fs.readFileSync(path.join(dir,'공백 문서.adoc'))).toEqual(bytes);
  });
}
test('SPEC-04 external change and change during save are rejected',()=> {
  const dir=fs.mkdtempSync(path.join(run,'conflict-')), file=path.join(dir,'doc.adoc');
  fs.writeFileSync(file,'BASE'); const snap=core.read(dir,'doc.adoc');
  fs.writeFileSync(file,'EXTERNAL');
  expect(()=>core.save(dir,'doc.adoc',snap,'LOCAL')).toThrow('conflict');
  const next=core.read(dir,'doc.adoc');
  expect(()=>core.save(dir,'doc.adoc',next,'LOCAL',()=>fs.writeFileSync(file,'V3'))).toThrow('conflict');
  expect(fs.readFileSync(file,'utf8')).toBe('V3');
  expect(fs.readdirSync(dir)).toEqual(['doc.adoc']);
});
test('SPEC-07 path escape, absolute path, invalid UTF-8 and mixed EOL rejected',()=> {
  expect(()=>core.confined(ws,'../errors/incomplete.adoc')).toThrow('outside-workspace');
  expect(()=>core.confined(ws,path.join(ws,'index.adoc'))).toThrow('invalid-path');
  const dir=fs.mkdtempSync(path.join(run,'invalid-'));
  fs.writeFileSync(path.join(dir,'bad.adoc'),Buffer.from([255]));
  expect(()=>core.read(dir,'bad.adoc')).toThrow();
  fs.writeFileSync(path.join(dir,'mixed.adoc'),'a\r\nb\n');
  expect(()=>core.read(dir,'mixed.adoc')).toThrow('unsupported-line-endings');
});
test('SPEC-07 symlink/junction escape rejected by realpath',()=> {
  const dir=fs.mkdtempSync(path.join(run,'links-'));
  fs.symlinkSync(path.join(fixtures,'errors'),path.join(dir,'outside'),'junction');
  expect(()=>core.confined(dir,'outside/incomplete.adoc')).toThrow('outside-workspace');
});
test('SPEC-05 FTS5 exact token, Korean token vs substring and rebuild',()=> {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('CREATE VIRTUAL TABLE docs USING fts5(path UNINDEXED, body)');
    const insert=db.prepare('INSERT INTO docs VALUES (?,?)');
    const rows=[['authoring.adoc','SEARCH-EXACT-7319 한글 문서'],['other.adoc','Other text']];
    for(const row of rows) insert.run(...row);
    const find=q=>db.prepare('SELECT path FROM docs WHERE docs MATCH ?').all(q).map(r=>r.path);
    expect(find('"SEARCH-EXACT-7319"')).toEqual(['authoring.adoc']);
    expect(find('한글')).toEqual(['authoring.adoc']);
    expect(find('글')).toEqual([]); // Not equivalent to arbitrary substring search.
    db.exec('DELETE FROM docs'); for(const row of rows) insert.run(...row);
    expect(find('문서')).toEqual(['authoring.adoc']);
  } finally { db.close(); }
});
