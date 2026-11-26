import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createLocalIdentity } from "../src/crypto.ts";
import { createPairingRequest, verifyPairing } from "../portal/pairing.ts";

const dir = await mkdtemp(join(tmpdir(), "agent-talk-owner-test-"));
const client = new Client({ name: "synthetic-owner", version: "1" }, { capabilities: { elicitation: { form: {} } } });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "adapter/mcp-adapter.ts", "--relay", "http://127.0.0.1:9", "--state", join(dir, "state.json")],
  cwd: process.cwd(), stderr: "pipe",
});
transport.stderr.resume();
let approved = false;
client.setRequestHandler(ElicitRequestSchema, async () =>
  approved ? { action: "accept", content: { approve: true } } : { action: "decline" });
try {
  await client.connect(transport);
  const status = await client.callTool({ name: "adapter_status", arguments: {} });
  const agentId = JSON.parse(status.content[0].text).agentId;
  const device = await createLocalIdentity();
  const request = createPairingRequest("12345", agentId, device);
  const denied = await client.callTool({ name: "owner_device_approve", arguments: { request } });
  assert.equal(denied.isError, true);
  approved = true;
  const accepted = await client.callTool({ name: "owner_device_approve", arguments: { request } });
  assert.notEqual(accepted.isError, true);
  const approval = JSON.parse(accepted.content[0].text);
  await verifyPairing(approval, "12345", { agentId, signingPublicKey: agentId.slice(4), encryptionPublicKey: "" });
  assert.equal(JSON.stringify(approval).includes(device.signingSecretKey), false);
  console.log("MCP owner denial and explicit device approval passed.");
} finally {
  await client.close();
  await rm(dir, { recursive: true, force: true });
}
