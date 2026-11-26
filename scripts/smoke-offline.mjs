// Local stdio regression check. No relay, cloud account or existing profile is required.
import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer } from "ws";

const directory = await mkdtemp(join(tmpdir(), "agent-talk-offline-"));
const checkout = fileURLToPath(new URL("../", import.meta.url));
// Reserve and release an ephemeral port. No application accepts relay requests.
const reservation = createServer();
await new Promise((resolve, reject) => reservation.once("error", reject).listen(0, "127.0.0.1", resolve));
const relay = "http://127.0.0.1:" + reservation.address().port;
await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));

async function withAdapter(name, inspect) {
  const statePath = join(directory, name + ".json");
  const client = new Client({ name: "offline-smoke", version: "1" }, { capabilities: { elicitation: { form: {} } } });
  const transport = new StdioClientTransport({
    command: "npm", args: ["--silent", "run", "mcp", "--", "--relay", relay, "--state", statePath], cwd: checkout, stderr: "ignore",
  });
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: { approve: true } }));
  try {
    await client.connect(transport, { timeout: 5000 });
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) throw new Error(result.content[0].text);
      return JSON.parse(result.content[0].text);
    };
    return await inspect(call);
  } finally { await client.close(); }
}

async function checkRegistrationRecovery(recipientId) {
  // A loopback stub records only protocol calls, without any contacts or delivery.
  const requests = [];
  const envelopes = [];
  const sendResponses = [401, 201, 401, 401, 403, "dropped-response"];
  const server = createHttpServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(request.url);
    let status = 200;
    if (request.url === "/v1/send") {
      envelopes.push(JSON.parse(body).envelope);
      status = sendResponses.shift() ?? 500;
    } else if (request.url !== "/v1/register") {
      status = 404;
    }
    if (status === "dropped-response") response.destroy();
    else response.writeHead(status, { "content-type": "application/json" }).end("{}");
  });
  const sockets = new WebSocketServer({ server, path: "/v1/socket" });
  // Keep a working socket open while the test forgets the stored registration.
  const connected = once(sockets, "connection", { signal: AbortSignal.timeout(10000) });
  server.listen(Number(new URL(relay).port), "127.0.0.1");
  try {
    await once(server, "listening");
    await withAdapter("owner", async call => {
      await connected;
      const send = () => call("message_send", { recipientId, text: "Synthetic registration recovery" });
      assert.deepEqual(requests.splice(0), ["/v1/register"]);
      const result = await send();
      assert.deepEqual(requests.splice(0), ["/v1/send", "/v1/register", "/v1/send"]);
      assert.equal(result.id, envelopes[0].id);
      assert.deepEqual(envelopes[0], envelopes[1]);
      await assert.rejects(send(), /401/);
      assert.deepEqual(requests.splice(0), ["/v1/send", "/v1/register", "/v1/send"]);
      await assert.rejects(send(), /403/);
      assert.deepEqual(requests.splice(0), ["/v1/send"]);
      await assert.rejects(send(), /fetch failed|reach relay/i);
      assert.deepEqual(requests.splice(0), ["/v1/send"]);
      assert.equal(sendResponses.length, 0);
    });
  } finally {
    for (const peer of sockets.clients) peer.terminate();
    sockets.close();
    await new Promise(resolve => server.close(resolve));
  }
}

try {
  const shared = join(directory, "shared");
  await mkdir(shared);
  await chmod(shared, 0o755);
  await assert.rejects(withAdapter("shared/owner", () => assert.fail("unexpected connection")), /closed|disconnect/i);
  await assert.rejects(stat(join(shared, "owner.json")), { code: "ENOENT" });
  const invite = await withAdapter("peer", call => call("profile_export_invite", { displayName: "Offline peer" }));
  const ownerId = await withAdapter("owner", async call => {
    const status = await call("adapter_status");
    assert.equal(status.socket, "connecting");
    assert.deepEqual(await call("inbox_list"), []);
    assert.equal((await call("contact_preview", { invite: JSON.stringify(invite) })).agentId, invite.issuer.agentId);
    await assert.rejects(call("contact_confirm", { invite: JSON.stringify(invite) }), /fetch failed|reach relay/i);
    assert.equal((await call("adapter_status")).contacts, 0);
    return status.agentId;
  });
  const path = join(directory, "owner.json");
  for (const privateFile of [path, path + ".lock"]) assert.equal((await stat(privateFile)).mode & 0o777, 0o600);
  await chmod(path, 0o640);
  await assert.rejects(withAdapter("owner", () => assert.fail("unexpected connection")), /closed|disconnect/i);
  await chmod(path, 0o600);
  const stored = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(stored.consumedInviteIds, {});
  // Model an existing v1 profile that previously received a message while online.
  const remembered = { id: "stored-offline-test", senderId: invite.issuer.agentId, text: "Already received", receivedAt: Date.now() };
  stored.inbox.push(remembered);
  stored.seen[remembered.senderId + ":" + remembered.id] = true;
  stored.contacts[invite.issuer.agentId] = { ...invite.issuer, displayName: "Peer", confirmedAt: Date.now() };
  await writeFile(path, JSON.stringify(stored));
  await withAdapter("owner", async call => {
    assert.equal((await call("adapter_status")).agentId, ownerId);
    assert.deepEqual(await call("inbox_list"), [remembered]);
    await assert.rejects(call("message_send", { recipientId: invite.issuer.agentId, text: "Offline attempt" }), /fetch failed|reach relay/i);
  });
  await checkRegistrationRecovery(invite.issuer.agentId);
  console.log("PASS stdio MCP — private offline profile, stable identity and inbox, local invite preview/export; one recovery on 401 preserves the envelope; 403 and lost responses are never retried.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
