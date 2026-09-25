const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function revision(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function confined(root, input) {
  if (typeof input !== 'string' || !input || path.isAbsolute(input)) throw Error('invalid-path');
  const realRoot = fs.realpathSync(root);
  const actual = fs.realpathSync(path.resolve(root, input));
  const relative = path.relative(realRoot, actual);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw Error('outside-workspace');
  return actual;
}
function read(root, input) {
  const file = confined(root, input);
  const bytes = fs.readFileSync(file);
  const bom = bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191]));
  const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes.subarray(bom ? 3 : 0));
  const crlf = text.includes('\r\n');
  if (text.replaceAll('\r\n', '').includes('\r') || (crlf && text.replaceAll('\r\n', '').includes('\n'))) throw Error('unsupported-line-endings');
  return {text: text.replaceAll('\r\n', '\n'), eol: crlf ? '\r\n' : '\n', bom, revision: revision(bytes)};
}
function encode(text, snapshot) {
  return Buffer.concat([snapshot.bom ? Buffer.from([239, 187, 191]) : Buffer.alloc(0), Buffer.from(text.replaceAll('\n', snapshot.eol), 'utf8')]);
}
// Probe only: external changes between final check and rename remain a known race.
function save(root, input, snapshot, text, beforeRecheck = () => {}) {
  const file = confined(root, input);
  if (revision(fs.readFileSync(file)) !== snapshot.revision) throw Error('conflict');
  const temp = file + '.pre03-' + crypto.randomUUID();
  try {
    fs.writeFileSync(temp, encode(text, snapshot), {flag: 'wx'});
    beforeRecheck();
    if (revision(fs.readFileSync(file)) !== snapshot.revision) throw Error('conflict');
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
module.exports = {revision, confined, read, encode, save};
