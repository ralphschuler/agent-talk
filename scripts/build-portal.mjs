// Build the public browser asset with the exact third-party notices it carries.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const packages = {
  '@hpke/common': 'hpke-common.txt',
  '@hpke/chacha20poly1305': 'hpke-chacha20poly1305.txt',
  '@hpke/core': 'hpke-core.txt',
  '@hpke/dhkem-x25519': 'hpke-dhkem-x25519.txt',
  '@noble/ed25519': 'noble-ed25519.txt',
};
const extra = { 'noble-curves.txt':'4f221aee6e072336700c408c68ab3b96a3fc09f6aebe6f48f1bd99e5ef13faec', 'noble-ciphers.txt':'f36671a5487c9c5050efacb58011c37c24c55a889803cb036cf9d9a6347c1e2d' };
const texts = [];
for (const [name, file] of Object.entries(packages)) {
  const original = await readFile('node_modules/' + name + '/LICENSE', 'utf8');
  const tracked = await readFile('third_party/licenses/' + file, 'utf8');
  assert.equal(tracked, original, 'Review changed upstream license for ' + name);
  texts.push([name, tracked]);
}
for (const [file, digest] of Object.entries(extra)) {
  const text = await readFile('third_party/licenses/' + file, 'utf8');
  assert.equal(createHash('sha256').update(text).digest('hex'), digest, 'Review changed vendored license ' + file);
  texts.push([file.slice(0, -4), text]);
}
const notices = 'Third-party licenses for the Agent Talk portal browser bundle\n\n' + texts.map(([name,text]) => '===== ' + name + ' =====\n' + text.trimEnd() + '\n').join('\n');
assert.ok(!notices.includes('*/'), 'Cannot embed notices safely in a JavaScript comment');
const result = await build({ entryPoints:['portal/browser.ts'], bundle:true, format:'esm', platform:'browser', target:'es2022',
  outfile:'public/portal/app.js', write:false, metafile:true, legalComments:'eof', footer:{js:'/*\n' + notices + '\n*/'} });
const inputs = Object.entries(Object.values(result.metafile.outputs)[0].inputs).filter(([,details]) => details.bytesInOutput > 0).map(([name]) => name);
const found = new Set(inputs.filter(name => name.startsWith('node_modules/')).map(name => {
  const match = name.match(/^node_modules\/(?:@([^/]+)\/([^/]+)|([^/]+))/);
  assert.ok(match, 'Unexpected dependency path');
  return match[1] ? '@' + match[1] + '/' + match[2] : match[3];
}));
assert.deepEqual([...found].sort(), Object.keys(packages).sort(), 'Browser bundle dependencies changed; review their notices');
assert.ok(inputs.some(x => x.includes('@hpke/common/esm/src/curve/')) && inputs.some(x => x.includes('@hpke/chacha20poly1305/esm/src/chacha/')), 'Review vendored noble license assumptions');
const outputs = [['public/portal/app.js', result.outputFiles[0].contents], ['public/portal/THIRD_PARTY_LICENSES.txt', Buffer.from(notices)]];
for (const [path, data] of outputs) {
  if (process.argv.includes('--check')) assert.deepEqual(await readFile(path), Buffer.from(data), path + ' is out of date');
  else await writeFile(path, data);
}
console.log('Portal bundle dependencies and full license notices verified.');
