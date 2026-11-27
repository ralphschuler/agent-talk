import { SELF } from "cloudflare:test";
import { expect, it } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

it("exposes a real stateless MCP endpoint and refuses unsigned envelope sends", async () => {
  const transport = new StreamableHTTPClientTransport(new URL("https://agent-talk.test/mcp"), {
    fetch: (input, init) => SELF.fetch(input, init),
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
  await initialClient.connect(new StreamableHTTPClientTransport(new URL("https://agent-talk.test/mcp"), { fetch: (input, init) => SELF.fetch(input, init) }));
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
  await client.connect(new StreamableHTTPClientTransport(new URL("https://agent-talk.test/mcp"), { fetch: (input, init) => SELF.fetch(input, init) }));
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
