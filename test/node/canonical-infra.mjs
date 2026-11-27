import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTarget, NAME, HOST } from '../../scripts/canonical-test-infra.mjs';
const zone = {id:'a'.repeat(32),name:'nyphon.de',status:'active'};
test('canonical test preflight rejects DNS, Worker domain and zone collisions', () => {
  assert.equal(validateTarget({zone,domains:[],records:[],workers:[]}), zone.id);
  assert.throws(() => validateTarget({zone,domains:[{hostname:HOST,service:'other',zone_id:zone.id}],records:[],workers:[]}));
  assert.throws(() => validateTarget({zone,domains:[],records:[{name:HOST,type:'CNAME'}],workers:[]}));
  assert.throws(() => validateTarget({zone:{...zone,status:'pending'},domains:[],records:[],workers:[]}));
  assert.doesNotThrow(() => validateTarget({zone,domains:[{hostname:HOST,service:NAME,zone_id:zone.id}],records:[],workers:[{id:NAME}]}));
});

test('test resource preparation refuses unmarked namespaces and reserves a fresh Worker only after checks', async () => {
  const { run, KV_TITLE } = await import('../../scripts/canonical-test-infra.mjs');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const directory = await mkdtemp(join(tmpdir(), 'agent-talk-infra-'));
  const env = { CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32), CLOUDFLARE_API_TOKEN:'synthetic', GITHUB_ENV:join(directory,'env') };
  const zone = { id:'b'.repeat(32), name:'nyphon.de', status:'active', account:{id:env.CLOUDFLARE_ACCOUNT_ID} };
  const calls=[];
  let existingNamespace=false;
  const envelope = result => Response.json({success:true,result,result_info:{total_pages:1}});
  const fake=async (input, options={}) => {
    const u=new URL(input), method=options.method ?? 'GET'; calls.push([method,u.pathname]);
    if (u.pathname === '/client/v4/zones') return envelope([zone]);
    if (u.pathname.endsWith('/workers/domains')) return envelope([]);
    if (u.pathname.endsWith('/dns_records')) return envelope([]);
    if (u.pathname.endsWith('/workers/scripts')) return envelope([]);
    if (u.pathname.endsWith('/storage/kv/namespaces') && method === 'GET') return envelope(existingNamespace ? [{id:'c'.repeat(32),title:KV_TITLE}] : []);
    if (u.pathname.endsWith('/storage/kv/namespaces') && method === 'POST') return envelope({id:'c'.repeat(32)});
    if (u.pathname.endsWith('/values/__agent_talk_owner') && method === 'PUT') return envelope(null);
    if (u.pathname.endsWith('/values/__agent_talk_owner') && method === 'GET') return new Response('wrong marker');
    if (u.pathname.endsWith('/workers') && method === 'POST') return envelope({name:NAME});
    throw new Error('Unexpected synthetic request: '+method+' '+u.pathname);
  };
  try {
    await run('prepare',env,fake);
    assert.match(await readFile(env.GITHUB_ENV,'utf8'), /^AGENT_TALK_TEST_OAUTH_KV_ID=c{32}\n$/);
    assert.ok(calls.some(([method,path]) => method === 'POST' && path.endsWith('/workers')));
    calls.length=0; existingNamespace=true;
    await assert.rejects(run('prepare',env,fake), /unmarked namespace/);
    assert.ok(!calls.some(([method]) => method === 'POST' || method === 'PUT'));
  } finally { await rm(directory,{recursive:true,force:true}); }
});
