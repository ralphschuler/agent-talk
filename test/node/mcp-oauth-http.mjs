// Loopback-only transport fixture. It imports the production guard, but the
// synthetic issuer and key exist solely inside this test process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPair, SignJWT } from 'jose';
import { guardMcpRequest } from '../../src/mcp-oauth.ts';

test('loopback HTTP exercises OAuth guard with a synthetic HTTPS resource', async () => {
  const config = { issuer: 'https://issuer.example/', resource: 'https://relay.example/mcp', jwksUri: 'https://issuer.example/jwks' };
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const sign = (aud, scope) => new SignJWT({ scope }).setProtectedHeader({ alg: 'ES256' }).setIssuer(config.issuer).setAudience(aud).setSubject('synthetic').setIssuedAt().setExpirationTime('2m').sign(privateKey);
  const server = createServer(async (incoming, outgoing) => {
    const protocol = incoming.url === '/insecure' ? 'http:' : 'https:';
    const req = new Request(protocol + '//relay.example/mcp', { headers: incoming.headers });
    const denied = await guardMcpRequest(req, config, async () => publicKey);
    outgoing.writeHead(denied?.status ?? 204, denied ? Object.fromEntries(denied.headers) : {});
    outgoing.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const missing = await fetch(base + '/mcp');
    assert.equal(missing.status, 401);
    assert.match(missing.headers.get('www-authenticate'), /oauth-protected-resource/);
    assert.equal((await fetch(base + '/mcp', { headers: { authorization: 'Bearer ' + await sign(config.resource, 'agent-talk:relay') } })).status, 204);
    assert.equal((await fetch(base + '/mcp', { headers: { authorization: 'Bearer ' + await sign('https://wrong.example/mcp', 'agent-talk:relay') } })).status, 401);
    assert.equal((await fetch(base + '/mcp', { headers: { authorization: 'Bearer ' + await sign(config.resource, 'other') } })).status, 401);
    assert.equal((await fetch(base + '/insecure', { headers: { authorization: 'Bearer ' + await sign(config.resource, 'agent-talk:relay') } })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
