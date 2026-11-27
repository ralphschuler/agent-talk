import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('canonical Worker routes dashboard login, atomically rejects replay and keeps MCP closed', async () => {
  const bundle = await build({entryPoints:['src/index.ts'],bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],write:false});
  const mock = `export default {async fetch(request) { const u = new URL(request.url); if (u.hostname === 'github.com') { const b=await request.json(); if (b.code !== 'synthetic-code' || !b.code_verifier) return new Response('',{status:400}); return Response.json({access_token:'synthetic-token',scope:''}); } if (u.hostname === 'api.github.com') return Response.json({id:123}); return new Response('',{status:404}); }}`;
  const mf = new Miniflare({...convertV4MiniflareOptions({workers:[
    {name:'main',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-26',bindings:{PORTAL_ORIGIN:'https://agent-talk.test',GITHUB_CLIENT_ID:'synthetic-client',GITHUB_CLIENT_SECRET:'synthetic-secret'},durableObjects:{PORTAL_STORE:{className:'PortalStore',useSQLite:true},DIRECTORY:{className:'Directory',useSQLite:true},MAILBOX:{className:'Mailbox',useSQLite:true}},serviceBindings:{OAUTH_TEST_PROVIDER:'github-mock'}},
    {name:'github-mock',modules:true,script:mock,compatibilityDate:'2026-11-26'}
  ]})});
  try {
    const base='https://agent-talk.test';
    const start=await mf.dispatchFetch(base+'/auth/login',{method:'POST',headers:{origin:base}});
    assert.equal(start.status,200);
    const auth = await start.json(); const state = new URL(auth.url).searchParams.get('state');
    const cookie=start.headers.get('set-cookie').split(';')[0];
    assert.equal((await mf.dispatchFetch(base+'/auth/callback?state='+state+'&code=synthetic-code',{headers:{cookie:'__Host-at_auth='+ 'A'.repeat(43)}})).status,400);
    const callback=await mf.dispatchFetch(base+'/auth/callback?state='+state+'&code=synthetic-code',{headers:{cookie},redirect:'manual'});
    assert.equal(callback.status,303);
    assert.match(callback.headers.get('set-cookie'),/__Host-at_session=/);
    assert.equal((await mf.dispatchFetch(base+'/auth/callback?state='+state+'&code=synthetic-code',{headers:{cookie}})).status,400);
    assert.equal((await mf.dispatchFetch(base+'/auth/mcp/login',{method:'POST',headers:{origin:base}})).status,503);
  } finally { await mf.dispose(); }
});
