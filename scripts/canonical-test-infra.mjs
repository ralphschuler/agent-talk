// Trusted main-only workflow helper. Never prints credentials or response bodies.
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const NAME = 'agent-talk-canonical-test';
export const HOST = 'agent-talk-test.nyphon.de';
export const KV_TITLE = 'agent-talk-canonical-test-oauth-v1';
export const MARKER = 'ralphschuler/agent-talk:canonical-test:v1';

export function validateTarget({ zone, domains, records, workers }) {
  assert.equal(zone?.name, 'nyphon.de');
  assert.equal(zone.status, 'active');
  assert.ok(/^[a-f0-9]{32}$/i.test(zone.id));
  assert.ok(domains.every(d => d.hostname === HOST && d.service === NAME && d.zone_id === zone.id), 'Test Worker hostname collision');
  assert.ok(records.length === 0 || (domains.length === 1 && records.every(r => r.name === HOST && r.type === 'AAAA' && r.proxied === true)), 'Test DNS collision');
  assert.ok(workers.length <= 1, 'Multiple target Workers');
  return zone.id;
}

export async function run(command, env = process.env, fetcher = fetch) {
  assert.ok(['prepare', 'attach', 'verify'].includes(command));
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = env;
  assert.match(account ?? '', /^[a-f0-9]{32}$/i); assert.ok(token, 'Missing Cloudflare credential');
  const root = 'https://api.cloudflare.com/client/v4';
  async function request(path, options = {}) {
    const headers = new Headers({ authorization: 'Bearer ' + token });
    if (options.body !== undefined) headers.set('content-type', options.raw ? 'text/plain' : 'application/json');
    const response = await fetcher(root + path, { method: options.method ?? 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20000), body: options.body === undefined ? undefined : options.raw ? options.body : JSON.stringify(options.body) });
    if (options.allow404 && response.status === 404) return null;
    if (options.text) { assert.ok(response.ok, `Cloudflare HTTP ${response.status}`); return response.text(); }
    const body = await response.json();
    assert.ok(response.ok && body.success, `Cloudflare HTTP ${response.status}; codes ${(body.errors ?? []).map(e => e.code).join(',')}`);
    return body;
  }
  const accountPath = '/accounts/' + account;
  async function pages(path) {
    const result = []; let page = 1;
    while (true) { const batch = await request(path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page); result.push(...batch.result); if (page >= (batch.result_info?.total_pages ?? 1)) return result; page++; }
  }
  const zones = await pages('/zones?name=nyphon.de&account.id=' + account);
  assert.equal(zones.length, 1, 'Unique target zone required');
  const zone = zones[0]; assert.equal(zone.account?.id, account, 'Zone belongs to another account');
  const domains = await pages(accountPath + '/workers/domains?hostname=' + HOST);
  const records = await pages('/zones/' + zone.id + '/dns_records?name=' + HOST);
  const workers = (await pages(accountPath + '/workers/scripts')).filter(x => x.id === NAME);
  validateTarget({zone, domains, records, workers});
  async function owned() {
    const settings = await request(accountPath + '/workers/scripts/' + NAME + '/settings');
    assert.ok(settings.result.bindings?.some(b => b.name === 'PROJECT_OWNER' && b.type === 'plain_text' && b.text === MARKER.replace(':v1','')), 'Worker ownership marker missing');
  }
  if (workers.length) await owned();
  if (command === 'prepare') {
    const matches = (await pages(accountPath + '/storage/kv/namespaces')).filter(x => x.title === KV_TITLE);
    assert.ok(matches.length <= 1, 'Duplicate test OAuth namespaces');
    let id;
    if (matches.length) {
      id = matches[0].id;
      const marker = await request(accountPath + '/storage/kv/namespaces/' + id + '/values/__agent_talk_owner', { text: true, allow404: true });
      assert.equal(marker, MARKER, 'Refusing to adopt an unmarked namespace');
    } else {
      const result = await request(accountPath + '/storage/kv/namespaces', { method: 'POST', body: { title: KV_TITLE } });
      id = result.result.id; assert.match(id, /^[a-f0-9]{32}$/i);
      await request(accountPath + '/storage/kv/namespaces/' + id + '/values/__agent_talk_owner', {method:'PUT', body:MARKER, raw:true});
    }
    if (!workers.length) {
      const created = await request(accountPath + '/workers', { method:'POST', body:{name:NAME,tags:['agent-talk-canonical-test'],observability:{enabled:false}} });
      assert.equal(created.result.name, NAME, 'Worker reservation failed');
    }
    assert.ok(env.GITHUB_ENV, 'Missing workflow environment file');
    await appendFile(env.GITHUB_ENV, `AGENT_TALK_TEST_OAUTH_KV_ID=${id}\n`);
    console.log('Test resources prepared; unmarked partial resources require manual inspection.');
  } else {
    assert.equal(workers.length, 1, 'Worker not deployed');
    if (command === 'attach' && !domains.length) {
      assert.equal(records.length, 0, 'Refusing to replace an existing DNS record');
      await request(accountPath + '/workers/domains', { method:'PUT', body:{hostname:HOST,service:NAME,zone_id:zone.id} });
    }
    if (command === 'verify') assert.equal(domains.length, 1, 'Test domain is not attached');
    console.log('Canonical test target verified.');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run(process.argv[2]);
