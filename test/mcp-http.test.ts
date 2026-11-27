import { SELF, env } from "cloudflare:test";
import { beforeAll, afterAll, expect, it, vi } from "vite-plus/test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const issuer = "https://synthetic-issuer.invalid/";
const resource = "https://agent-talk.test/mcp";
let accessToken = "";
let wrongAudience = "";
let wrongScope = "";
beforeAll(async () => {
  const keys = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "synthetic", alg: "ES256", use: "sig" };
  accessToken = await new SignJWT({ scope: "agent-talk:relay" }).setProtectedHeader({ alg: "ES256", kid: "synthetic" }).setIssuer(issuer).setAudience(resource).setSubject("synthetic-owner").setIssuedAt().setExpirationTime("2m").sign(keys.privateKey);
  wrongAudience = await new SignJWT({ scope: "agent-talk:relay" }).setProtectedHeader({ alg: "ES256", kid: "synthetic" }).setIssuer(issuer).setAudience("https://other.invalid/mcp").setSubject("synthetic-owner").setIssuedAt().setExpirationTime("2m").sign(keys.privateKey);
  wrongScope = await new SignJWT({ scope: "other" }).setProtectedHeader({ alg: "ES256", kid: "synthetic" }).setIssuer(issuer).setAudience(resource).setSubject("synthetic-owner").setIssuedAt().setExpirationTime("2m").sign(keys.privateKey);
  Object.assign(env, { MCP_OAUTH_ISSUER: issuer, MCP_OAUTH_RESOURCE: resource, MCP_OAUTH_JWKS_URI: issuer + "jwks" });
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === issuer + "jwks") return Response.json({ keys: [jwk] });
    return original(input, init);
  });
});
afterAll(() => vi.unstubAllGlobals());
const oauthFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer " + accessToken);
  return SELF.fetch(input, { ...init, headers });
};

it("requires OAuth on the real Worker route and publishes discovery metadata", async () => {
  const meta = await SELF.fetch("https://agent-talk.test/.well-known/oauth-protected-resource/mcp");
  expect(meta.status).toBe(200);
  expect(await meta.json()).toMatchObject({ resource, authorization_servers: [issuer], scopes_supported: ["agent-talk:relay"] });
  for (const token of ["", "not-a-token", wrongAudience, wrongScope]) {
    const response = await SELF.fetch(resource, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: "Bearer " + token } : {}) }, body: "{}" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('resource_metadata="https://agent-talk.test/.well-known/oauth-protected-resource/mcp"');
  }
  expect((await SELF.fetch("http://agent-talk.test/mcp", { method: "POST" })).status).toBe(403);
});

it("exposes a real stateless MCP endpoint and refuses unsigned envelope sends", async () => {
  const transport = new StreamableHTTPClientTransport(new URL("https://agent-talk.test/mcp"), {
    fetch: oauthFetch,
  });
  const client = new Client({ name: "synthetic-test", version: "1" });
  await client.connect(transport);
  const tools = await client.listTools();
  expect(tools.tools.map(tool => tool.name)).toContain("relay_send_envelope");
  const response = await client.callTool({ name: "relay_send_envelope", arguments: {
    agentId: "at1_" + "A".repeat(43), timestamp: String(Date.now()), signature: "A".repeat(86),
    envelope: { version: 1, id: crypto.randomUUID(), senderId: "at1_" + "A".repeat(43),
      recipientId: "at1_" + "B".repeat(43), createdAt: Date.now(), enc: "A".repeat(43), ciphertext: "A".repeat(43) },
  } });
  expect(response.isError).toBe(true);
  await client.close();
});

it("rejects browser-origin requests", async () => {
  const response = await SELF.fetch("https://agent-talk.test/mcp", { method: "POST", headers: {
    origin: "https://attacker.example", "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  expect(response.status).toBe(403);
});

it("delivers only a mutually approved, signed ciphertext envelope through MCP", async () => {
  const { createLocalIdentity, openEnvelope, sealEnvelope, signInvite, signRequest } = await import("../src/crypto.ts");
  const { env, runInDurableObject } = await import("cloudflare:test");
  const a = await createLocalIdentity();
  const b = await createLocalIdentity();
  const post = async (identity: typeof a, action: string, payload: unknown) => {
    const timestamp = String(Date.now());
    return SELF.fetch("https://agent-talk.test/v1/" + action, { method: "POST", headers: {
      "content-type": "application/json", "x-agent-id": identity.agentId, "x-agent-timestamp": timestamp,
      "x-agent-signature": await signRequest(identity, action, timestamp, payload),
    }, body: JSON.stringify(payload) });
  };
  for (const identity of [a, b]) {
    const publicIdentity = { agentId: identity.agentId, signingPublicKey: identity.signingPublicKey, encryptionPublicKey: identity.encryptionPublicKey };
    expect((await post(identity, "register", { identity: publicIdentity })).ok).toBe(true);
  }
  const invite = (identity: typeof a) => signInvite(identity, { kind: "agent-talk-invite", version: 1,
    issuer: { agentId: identity.agentId, signingPublicKey: identity.signingPublicKey, encryptionPublicKey: identity.encryptionPublicKey },
    displayName: "Synthetic", inviteId: crypto.randomUUID(), expiresAt: Date.now() + 60000,
    relay: "https://agent-talk.test", mcp: { transport: "stdio", hint: "local adapter only" } });
  const unauthorizedEnvelope = await sealEnvelope(a, b, crypto.randomUUID(), "Synthetic unopened message");
  const unauthorizedTimestamp = String(Date.now());
  const unauthorizedSignature = await signRequest(a, "send", unauthorizedTimestamp, { envelope: unauthorizedEnvelope });
  const initialClient = new Client({ name: "synthetic-denied", version: "1" });
  await initialClient.connect(new StreamableHTTPClientTransport(new URL("https://agent-talk.test/mcp"), { fetch: oauthFetch }));
  const denied = await initialClient.callTool({ name: "relay_send_envelope", arguments: { agentId: a.agentId,
    timestamp: unauthorizedTimestamp, signature: unauthorizedSignature, envelope: unauthorizedEnvelope } });
  expect(denied.isError).toBe(true);
  await initialClient.close();
  expect((await post(a, "contact/approve", { invite: await invite(b) })).ok).toBe(true);
  expect((await post(b, "contact/approve", { invite: await invite(a) })).ok).toBe(true);
  const text = "Synthetic encrypted MCP question";
  const envelope = await sealEnvelope(a, b, crypto.randomUUID(), text);
  const timestamp = String(Date.now());
  const signature = await signRequest(a, "send", timestamp, { envelope });
  const client = new Client({ name: "synthetic-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("https://agent-talk.test/mcp"), { fetch: oauthFetch }));
  const tampered = { ...envelope, ciphertext: (envelope.ciphertext[0] === "A" ? "B" : "A") + envelope.ciphertext.slice(1) };
  const rejected = await client.callTool({ name: "relay_send_envelope", arguments: { agentId: a.agentId, timestamp, signature, envelope: tampered } });
  expect(rejected.isError).toBe(true);
  const result = await client.callTool({ name: "relay_send_envelope", arguments: { agentId: a.agentId, timestamp, signature, envelope } });
  expect(result.isError).not.toBe(true);
  const replay = await client.callTool({ name: "relay_send_envelope", arguments: { agentId: a.agentId, timestamp, signature, envelope } });
  expect(replay.isError).toBe(true);
  const rows = await runInDurableObject(env.MAILBOX.getByName(b.agentId), async (_instance, state) =>
    state.storage.sql.exec("SELECT envelope FROM queue WHERE id = ?", envelope.id).toArray());
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain(text);
  expect(await openEnvelope(b, a, JSON.parse(String(rows[0].envelope)))).toBe(text);
  await client.close();
});
