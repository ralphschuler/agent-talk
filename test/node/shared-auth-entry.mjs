import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createLocalIdentity, signRequest, signInvite, sealEnvelope } from '../../src/crypto.ts';
import { approvePairing } from '../../portal/pairing.ts';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('canonical Worker issues agent-bound OAuth token after explicit owner consent', async () => {
  const bundle = await build({entryPoints:['src/index.ts'],bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],write:false});
  const mock = `export default {async fetch(request) { const u = new URL(request.url); if (u.hostname === 'github.com') { const b=await request.json(); if (b.code !== 'synthetic-code' || !b.code_verifier) return new Response('',{status:400}); return Response.json({access_token:'synthetic-token',scope:''}); } if (u.hostname === 'api.github.com') return Response.json({id:123}); return new Response('',{status:404}); }}`;
  const mf = new Miniflare({...convertV4MiniflareOptions({workers:[
    {name:'main',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-26',bindings:{PORTAL_ORIGIN:'https://agent-talk.test',GITHUB_CLIENT_ID:'synthetic-client',GITHUB_CLIENT_SECRET:'synthetic-secret',MCP_OAUTH_ISSUER:'https://agent-talk.test',MCP_OAUTH_RESOURCE:'https://agent-talk.test/mcp'},kvNamespaces:['OAUTH_KV'],durableObjects:{PORTAL_STORE:{className:'PortalStore',useSQLite:true},DIRECTORY:{className:'Directory',useSQLite:true},MAILBOX:{className:'Mailbox',useSQLite:true}},serviceBindings:{OAUTH_TEST_PROVIDER:'github-mock',AUTH_SERVER:{name:'main',entrypoint:'OAuthValidator'}}},
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
    const session = callback.headers.get('set-cookie').match(/__Host-at_session=[^;,]+/)[0];
    const agent = await createLocalIdentity(), device = await createLocalIdentity();
    const postJson = (path, value) => mf.dispatchFetch(base + path, {method:'POST',headers:{origin:base,cookie:session,'content-type':'application/json'},body:JSON.stringify(value)});
    const paired = await postJson('/pairing/start',{agentId:agent.agentId,device:{agentId:device.agentId,signingPublicKey:device.signingPublicKey,encryptionPublicKey:device.encryptionPublicKey}});
    assert.equal(paired.status,201);
    const pair=(await paired.json()).request;
    assert.equal((await postJson('/pairing/complete',{approval:await approvePairing(pair,agent)})).status,200);
    const discovery = await mf.dispatchFetch(base+'/.well-known/oauth-authorization-server');
    assert.equal(discovery.status,200);
    const registration = await mf.dispatchFetch(base+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Synthetic',redirect_uris:['http://127.0.0.1:33291/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']})});
    assert.equal(registration.status,201,await registration.clone().text());
    const client = await registration.json();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({client_id:client.client_id,redirect_uri:'http://127.0.0.1:33291/callback',response_type:'code',scope:'agent-talk:relay',state:'synthetic-state',resource:base+'/mcp',code_challenge:challenge,code_challenge_method:'S256'});
    const initial = await mf.dispatchFetch(base+'/authorize?'+query,{redirect:'manual'});
    assert.equal(initial.status,302);
    const github = new URL(initial.headers.get('location'));
    assert.equal(github.hostname,'github.com');
    const mcpState=github.searchParams.get('state');
    const mcpAuthCookie=initial.headers.get('set-cookie').split(';')[0];
    const resumed=await mf.dispatchFetch(base+'/auth/callback?state='+mcpState+'&code=synthetic-code',{headers:{cookie:mcpAuthCookie},redirect:'manual'});
    assert.equal(resumed.status,303,await resumed.clone().text());
    assert.equal((await mf.dispatchFetch(base+'/auth/callback?state='+mcpState+'&code=synthetic-code',{headers:{cookie:mcpAuthCookie}})).status,400);
    const mcpSession=resumed.headers.get('set-cookie').match(/__Host-at_mcp=[^;,]+/)[0];
    assert.equal((await mf.dispatchFetch(base+'/auth/account',{headers:{cookie:mcpSession}})).status,401);
    const consent = await mf.dispatchFetch(resumed.headers.get('location'),{headers:{cookie:mcpSession}});
    assert.equal(consent.status,200,await consent.clone().text());
    const page=await consent.text();
    assert.ok(page.includes(agent.agentId));
    const handle=page.match(/name="handle" value="([^"]+)"/)[1];
    const consentCookie=consent.headers.get('set-cookie').split(';')[0];
    const form=new URLSearchParams({handle,agent:agent.agentId,decision:'approve'}).toString();
    const forged=new URLSearchParams({handle,agent:'at1_'+ 'A'.repeat(43),decision:'approve'}).toString();
    const badConsent=await mf.dispatchFetch(base+'/oauth/consent',{method:'POST',headers:{origin:base,cookie:mcpSession+'; '+consentCookie,'content-type':'application/x-www-form-urlencoded','content-length':String(Buffer.byteLength(forged))},body:forged});
    assert.equal(badConsent.status,403);
    const consentResponse=await mf.dispatchFetch(base+'/oauth/consent',{method:'POST',headers:{origin:base,cookie:mcpSession+'; '+consentCookie,'content-type':'application/x-www-form-urlencoded','content-length':String(Buffer.byteLength(form))},body:form,redirect:'manual'});
    assert.equal(consentResponse.status,303,await consentResponse.clone().text());
    const replayConsent=await mf.dispatchFetch(base+'/oauth/consent',{method:'POST',headers:{origin:base,cookie:mcpSession+'; '+consentCookie,'content-type':'application/x-www-form-urlencoded','content-length':String(Buffer.byteLength(form))},body:form});
    assert.equal(replayConsent.status,401);
    const code=new URL(consentResponse.headers.get('location')).searchParams.get('code');
    assert.ok(code);
    const tokenResponse=await mf.dispatchFetch(base+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:'http://127.0.0.1:33291/callback',code,code_verifier:verifier,resource:base+'/mcp'}).toString()});
    assert.equal(tokenResponse.status,200,await tokenResponse.clone().text());
    const access=(await tokenResponse.json()).access_token;
    assert.ok(access);
    const mcp = await mf.dispatchFetch(base+'/mcp',{method:'POST',headers:{authorization:'Bearer '+access,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'synthetic',version:'1'}}})});
    assert.equal(mcp.status,200,await mcp.clone().text());
    const sdk = new Client({name:'synthetic',version:'1'});
    await sdk.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'), {fetch:(input, init) => {
      const headers = new Headers(init?.headers); headers.set('authorization','Bearer '+access);
      return mf.dispatchFetch(input, {...init,headers});
    }}));
    assert.ok((await sdk.listTools()).tools.some(tool => tool.name === 'relay_send_envelope'));

    const b = await createLocalIdentity();
    const relayPost = async (identity, action, payload) => {
      const timestamp=String(Date.now());
      return mf.dispatchFetch(base+'/v1/'+action,{method:'POST',headers:{'content-type':'application/json','x-agent-id':identity.agentId,'x-agent-timestamp':timestamp,'x-agent-signature':await signRequest(identity,action,timestamp,payload)},body:JSON.stringify(payload)});
    };
    for (const identity of [agent,b]) {
      assert.ok((await relayPost(identity,'register',{identity:{agentId:identity.agentId,signingPublicKey:identity.signingPublicKey,encryptionPublicKey:identity.encryptionPublicKey}})).ok);
    }
    const invite = identity => signInvite(identity,{kind:'agent-talk-invite',version:1,issuer:{agentId:identity.agentId,signingPublicKey:identity.signingPublicKey,encryptionPublicKey:identity.encryptionPublicKey},displayName:'Synthetic',inviteId:crypto.randomUUID(),expiresAt:Date.now()+60000,relay:base,mcp:{transport:'stdio',hint:'local adapter'}});
    assert.ok((await relayPost(agent,'contact/approve',{invite:await invite(b)})).ok);
    assert.ok((await relayPost(b,'contact/approve',{invite:await invite(agent)})).ok);
    const envelope=await sealEnvelope(agent,b,crypto.randomUUID(),'Synthetic encrypted question');
    const timestamp=String(Date.now());
    const signature=await signRequest(agent,'send',timestamp,{envelope});
    const call = async actor => {
      const response=await mf.dispatchFetch(base+'/mcp',{method:'POST',headers:{authorization:'Bearer '+access,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'relay_send_envelope',arguments:{agentId:actor,timestamp,signature,envelope}}})});
      assert.equal(response.status,200);
      return response.json();
    };
    assert.equal((await call(b.agentId)).result.isError,true);
    assert.notEqual((await call(agent.agentId)).result.isError,true);
    assert.equal((await call(agent.agentId)).result.isError,true);
    await sdk.close();

    assert.equal((await mf.dispatchFetch(base+'/auth/mcp/login',{method:'POST',headers:{origin:base}})).status,503);
  } finally { await mf.dispose(); }
});
