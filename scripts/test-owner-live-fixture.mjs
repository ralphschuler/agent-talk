// Local-only: never accept a remote relay or generate release evidence.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { checkOfflineReplay, inspectOfflineSyntheticStorage, prepareSyntheticScenario } from "./owner-live-fixture.mjs";
const relay = process.env.AGENT_TALK_TEST_RELAY;
assert.equal(relay, "http://localhost:5173", "This fixture can only contact the local test relay.");
const dir = await mkdtemp(join(tmpdir(), "agent-talk-local-live-fixture-"));
const clients = [];
async function agent(name) {
  const client = new Client({ name: "local-synthetic-fixture", version: "1" }, { capabilities: { elicitation: { form: {} } } });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", "tsx", "adapter/mcp-adapter.ts", "--relay", relay, "--state", join(dir, name)], cwd: process.cwd(), stderr: "pipe" });
  transport.stderr.resume();
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: { approve: true } }));
  await client.connect(transport);
  clients.push(client);
  return client;
}
async function invoke(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error("Local synthetic operation failed: " + name);
  return JSON.parse(result.content[0].text);
}
async function waitForValue(fn, message) {
  for (let n = 0; n < 200; n++) {
    if (await fn()) return;
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(message + " timed out");
}
try {
  const a1 = await agent("a1");
  const a2 = await agent("a2");
  const b3 = await agent("b3");
  const fixture = await prepareSyntheticScenario({ a1, a2, b3, invoke, waitForValue });
  const restarted = await checkOfflineReplay({ sender: a2, receiver: b3, receiverId: fixture.three.agentId,
    restart: () => agent("b3"), invoke, waitForValue });
  await waitForValue(async () => (await invoke(a2, "direct_thread", { peerId: fixture.one.agentId, threadId: fixture.second.threadId })).messages.length === 2, "Second thread");
  const first = await invoke(a1, "direct_thread", { peerId: fixture.two.agentId, threadId: fixture.first.threadId });
  assert.equal(first.messages.length, 2);
  assert.ok(first.messages.some(item => item.text.includes("A second synthetic message")));
  const group = await invoke(a1, "group_read", { groupId: fixture.groupId });
  assert.equal(group.length, 2);
  assert.ok(group.some(item => item.text === "Synthetic private group reply"));
  const fakeDevice = "at1_" + "A".repeat(43);
  const localOnly = await inspectOfflineSyntheticStorage({ sender: a1, receiver: restarted,
    senderId: fixture.one.agentId, recipientId: fixture.three.agentId, deviceId: fakeDevice, groupId: fixture.groupId,
    statePaths: [join(dir, "a1"), join(dir, "a2")], invoke, waitForValue,
    checkStorage: async input => {
      assert.equal(input.agentId, fixture.one.agentId);
      assert.equal(input.recipientId, fixture.three.agentId);
      assert.equal(input.privateKeys.length, 4);
      assert.equal(input.messageMarkers.length, 2);
      assert.notEqual(input.offlineMessageId, input.groupMessageId);
      return { mode: "synthetic-fixture", productionApproval: false };
    },
  });
  assert.deepEqual(localOnly.result, { mode: "synthetic-fixture", productionApproval: false });
  assert.equal(localOnly.routing.agentId, fixture.one.agentId);
  assert.equal(localOnly.materialDigests.length, 18);
  console.log("Local-only staging fixture generated and verified real direct and group traffic with three disposable MCP agents.");
} finally {
  await Promise.allSettled(clients.map(client => client.close()));
  await rm(dir, { recursive: true, force: true });
}
