import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createLocalIdentity, openOwnerCopy, signRequest } from "../src/crypto.ts";
import { base64url } from "../src/protocol.ts";
import { approvePairing } from "../portal/pairing.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const bundle = await build({ entryPoints: ["portal/worker.ts"], bundle: true, format: "esm", platform: "browser", external: ["cloudflare:workers"], write: false });
const mock = `export default { async fetch(request) {
  const url = new URL(request.url);
  if (url.hostname === "github.com" && url.pathname === "/login/oauth/access_token") {
    const body = await request.json();
    if (!["synthetic-code", "synthetic-code2"].includes(body.code) || !body.code_verifier) return new Response("", { status: 400 });
    return Response.json({ access_token: body.code === "synthetic-code" ? "synthetic-token" : "synthetic-token2", scope: "" });
  }
  if (url.hostname === "api.github.com" && url.pathname === "/user") {
    if (request.headers.get("Authorization") === "Bearer synthetic-token") return Response.json({ id: 12345 });
    if (request.headers.get("Authorization") === "Bearer synthetic-token2") return Response.json({ id: 67890 });
  }
  return new Response("", { status: 404 });
} }`;
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
  { name: "portal", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-11-26",
    bindings: { PORTAL_ORIGIN: "https://portal.example.test", GITHUB_CLIENT_ID: "test", GITHUB_CLIENT_SECRET: "synthetic-secret" },
    durableObjects: { PORTAL_STORE: { className: "PortalStore", useSQLite: true } },
    serviceBindings: { OAUTH_TEST_PROVIDER: "github-mock" } },
  { name: "github-mock", modules: true, script: mock, compatibilityDate: "2026-11-26" },
] }));
const directory = await mkdtemp(join(tmpdir(), "agent-talk-portal-test-"));
const relayOrigin = process.env.AGENT_TALK_TEST_RELAY ?? "http://127.0.0.1:9";
const agentIdentity = await createLocalIdentity();
const sender = await createLocalIdentity();
const sample = "Is the development preview ready for review?";
await writeFile(join(directory, "state.json"), JSON.stringify({
  version: 2, relay: relayOrigin, identity: agentIdentity, contacts: {}, consumedInviteIds: {}, seen: {},
  inbox: [{ id: "synthetic-message", senderId: sender.agentId, text: sample, receivedAt: Date.now(),
    direct: { type: "ask", threadId: "synthetic-thread", replyTo: null } },
  { id: "second-message", senderId: sender.agentId, text: "<img src=x> A second synthetic message", receivedAt: Date.now(),
    direct: { type: "ask", threadId: "synthetic-thread", replyTo: null } }],
}), { mode: 0o600 });
let portalAvailable = true;
const proxy = createServer(async (req, res) => {
  if (!portalAvailable) { res.writeHead(503); res.end(); return; }
  if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/assets/"))) {
    const root = resolve("portal/.cloudflare/output/v1/workers/default/assets");
    const path = resolve(root, "." + (req.url === "/" ? "/index.html" : req.url));
    if (!path.startsWith(root + "/")) { res.writeHead(400); res.end(); return; }
    try {
      const bytes = await readFile(path);
      const type = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "text/javascript";
      res.writeHead(200, { "content-type": type }); res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = { ...req.headers };
  if (headers.origin) headers.origin = "https://portal.example.test";
  const target = await mf.dispatchFetch("https://portal.example.test" + req.url, {
    method: req.method, headers, ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: Buffer.concat(chunks) }),
  });
  res.writeHead(target.status, Object.fromEntries(target.headers));
  res.end(Buffer.from(await target.arrayBuffer()));
});
await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
const localPortal = "http://127.0.0.1:" + proxy.address().port;
let ownerApproved = false;
let mcp;
async function startMcp() {
  const client = new Client({ name: "synthetic-owner", version: "1" }, { capabilities: { elicitation: { form: {} } } });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", "tsx", "adapter/mcp-adapter.ts", "--relay", relayOrigin, "--state", join(directory, "state.json")],
    cwd: process.cwd(), stderr: "pipe",
    env: { ...process.env, NODE_OPTIONS: "--import=" + resolve("scripts/owner-ack-fixture.mjs"), OWNER_ACK_FILE: join(directory, "ack") } });
  transport.stderr.resume();
  client.setRequestHandler(ElicitRequestSchema, async () => ownerApproved
    ? { action: "accept", content: { approve: true } } : { action: "decline" });
  await client.connect(transport);
  return client;
}
let chrome;
let secondMcp;
async function browserSmoke(sessionCookie, agentId) {
  const chromeProfile = join(directory, "chrome");
  chrome = spawn(process.env.AGENT_TALK_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0",
    "--user-data-dir=" + chromeProfile, "about:blank",
  ], { stdio: "ignore" });
  let port;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { port = (await readFile(join(chromeProfile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!port) throw new Error("Chrome did not start.");
  const tab = await (await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", { method: "PUT" })).json();
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pendingCalls = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const pending = pendingCalls.get(message.id);
    if (!pending) return;
    pendingCalls.delete(message.id);
    message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pendingCalls.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Browser condition timed out: " + expression);
  };
  try {
    await call("Network.enable");
    const cookieValue = sessionCookie.slice(sessionCookie.indexOf("=") + 1);
    const cookieResult = await call("Network.setCookie", { name: "__Host-at_session", value: cookieValue,
      url: localPortal + "/", secure: true, httpOnly: true, sameSite: "Lax" });
    assert.equal(cookieResult.success, true);
    await call("Page.navigate", { url: localPortal + "/" });
    await waitFor('document.querySelector("#status")?.textContent?.startsWith("Signed in")');
    await evaluate('document.querySelector("#agent-id").value = ' + JSON.stringify(agentId));
    await evaluate('document.querySelector("#start-pairing").click()');
    await waitFor('document.querySelector("#pair-request")?.value?.length > 0');
    const request = JSON.parse(await evaluate('document.querySelector("#pair-request").value'));
    ownerApproved = true;
    const signed = await mcp.callTool({ name: "owner_device_approve", arguments: { request } });
    assert.notEqual(signed.isError, true);
    await evaluate('document.querySelector("#pair-approval").value = ' + JSON.stringify(signed.content[0].text));
    await evaluate('document.querySelector("#complete-pairing").click()');
    await waitFor('document.querySelector("#status")?.textContent === "Device paired."');
    const enable = await mcp.callTool({ name: "owner_device_enable", arguments: {
      portal: localPortal, deviceId: request.device.agentId, minutes: 30,
    } });
    assert.notEqual(enable.isError, true);
    const backfill = await mcp.callTool({ name: "owner_thread_backfill", arguments: {
      deviceId: request.device.agentId, peerId: sender.agentId, threadId: "synthetic-thread",
    } });
    assert.equal(JSON.parse(backfill.content[0].text).queued, 2);
    ownerApproved = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      await evaluate('Array.from(document.querySelectorAll("#agents button")).find(b => b.textContent === ' + JSON.stringify(agentId) + ')?.click()');
      await new Promise(resolve => setTimeout(resolve, 100));
      if (await evaluate('document.querySelectorAll("#messages article").length === 2')) break;
    }
    assert.equal(await evaluate('document.querySelectorAll("#messages article").length'), 2);
    assert.equal(await evaluate('document.querySelector("#messages").textContent.includes("A second synthetic message")'), true);
    assert.equal(await evaluate('document.querySelector("#messages img") === null'), true);
    console.log("Chrome paired a separate browser device and decrypted two inert thread messages.");
  } finally {
    socket.close();
    chrome.kill("SIGTERM");
    await new Promise(resolve => chrome.once("exit", resolve));
    chrome = undefined;
  }
}
try {
  mcp = await startMcp();
  const origin = "https://portal.example.test";
  const login = await mf.dispatchFetch(origin + "/auth/login", { method: "POST", headers: { origin } });
  assert.equal(login.status, 200);
  const authCookie = login.headers.get("set-cookie").split(";")[0];
  const authorizationUrl = new URL((await login.json()).url);
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  const state = authorizationUrl.searchParams.get("state");
  const callback = origin + "/auth/callback?code=synthetic-code&state=" + state;
  assert.equal((await mf.dispatchFetch(origin + "/auth/callback?code=synthetic-code&state=" + "x".repeat(43), { headers: { cookie: authCookie } })).status, 400);
  assert.equal((await mf.dispatchFetch(callback, { headers: { cookie: "__Host-at_auth=" + "x".repeat(43) } })).status, 400);
  const attempts = await Promise.all([
    mf.dispatchFetch(callback, { headers: { cookie: authCookie }, redirect: "manual" }),
    mf.dispatchFetch(callback, { headers: { cookie: authCookie }, redirect: "manual" }),
  ]);
  assert.deepEqual(attempts.map(item => item.status).sort(), [303, 400]);
  const accepted = attempts.find(item => item.status === 303);
  assert.equal(accepted.status, 303);
  const sessionCookie = accepted.headers.get("set-cookie").split(";")[0];
  assert.equal((await mf.dispatchFetch(callback, { headers: { cookie: authCookie } })).status, 400);
  const account = await mf.dispatchFetch(origin + "/auth/account", { headers: { cookie: sessionCookie } });
  assert.deepEqual(await account.json(), { accountId: "12345" });
  const secondLogin = await mf.dispatchFetch(origin + "/auth/login", { method: "POST", headers: { origin } });
  const secondCookie = secondLogin.headers.get("set-cookie").split(";")[0];
  const secondState = new URL((await secondLogin.json()).url).searchParams.get("state");
  const secondCallback = await mf.dispatchFetch(origin + "/auth/callback?code=synthetic-code2&state=" + secondState,
    { headers: { cookie: secondCookie }, redirect: "manual" });
  const secondSession = secondCallback.headers.get("set-cookie").split(";")[0];
  const anotherLogin = await mf.dispatchFetch(origin + "/auth/login", { method: "POST", headers: { origin } });
  const anotherCookie = anotherLogin.headers.get("set-cookie").split(";")[0];
  const anotherState = new URL((await anotherLogin.json()).url).searchParams.get("state");
  const anotherCallback = await mf.dispatchFetch(origin + "/auth/callback?code=synthetic-code&state=" + anotherState,
    { headers: { cookie: anotherCookie }, redirect: "manual" });
  const anotherSession = anotherCallback.headers.get("set-cookie").split(";")[0];
  const post = (path, cookie, body) => mf.dispatchFetch(origin + path, {
    method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const agentStatus = await mcp.callTool({ name: "adapter_status", arguments: {} });
  const agent = { agentId: JSON.parse(agentStatus.content[0].text).agentId };
  const otherAgent = await createLocalIdentity();
  const device = await createLocalIdentity();
  const publicDevice = { agentId: device.agentId, signingPublicKey: device.signingPublicKey, encryptionPublicKey: device.encryptionPublicKey };
  const start = await post("/pairing/start", sessionCookie, { agentId: agent.agentId, device: publicDevice });
  assert.equal(start.status, 201);
  const pair = (await start.json()).request;
  const deniedMcp = await mcp.callTool({ name: "owner_device_approve", arguments: { request: pair } });
  assert.equal(deniedMcp.isError, true);
  ownerApproved = true;
  const acceptedMcp = await mcp.callTool({ name: "owner_device_approve", arguments: { request: pair } });
  assert.notEqual(acceptedMcp.isError, true);
  const approval = JSON.parse(acceptedMcp.content[0].text);
  ownerApproved = false;
  assert.equal((await post("/pairing/complete", secondSession, { approval })).status, 403);
  assert.equal((await post("/pairing/complete", anotherSession, { approval })).status, 403);
  const tampered = { ...approval, signature: (approval.signature[0] === "A" ? "B" : "A") + approval.signature.slice(1) };
  assert.equal((await post("/pairing/complete", sessionCookie, { approval: tampered })).status, 403);
  const invalid = await approvePairing({ ...pair, agentId: otherAgent.agentId }, otherAgent);
  assert.equal((await post("/pairing/complete", sessionCookie, { approval: invalid })).status, 403);
  assert.equal((await post("/pairing/complete", sessionCookie, { approval })).status, 200);
  assert.equal((await post("/pairing/complete", sessionCookie, { approval })).status, 403);
  assert.equal((await post("/pairing/start", secondSession, { agentId: agent.agentId, device: publicDevice })).status, 403);
  const deniedStart = await post("/pairing/start", sessionCookie, { agentId: otherAgent.agentId, device: publicDevice });
  const deniedPair = (await deniedStart.json()).request;
  assert.equal((await post("/pairing/deny", sessionCookie, { nonce: deniedPair.nonce })).status, 200);
  assert.equal((await post("/pairing/complete", sessionCookie, { approval: await approvePairing(deniedPair, otherAgent) })).status, 403);
  const nextStart = await post("/pairing/start", sessionCookie, { agentId: otherAgent.agentId, device: publicDevice });
  assert.equal((await post("/pairing/complete", sessionCookie, { approval: await approvePairing((await nextStart.json()).request, otherAgent) })).status, 200);
  const listing = await (await mf.dispatchFetch(origin + "/agents", { headers: { cookie: sessionCookie } })).json();
  assert.equal(listing.agents.length, 2);
  assert.equal((await (await mf.dispatchFetch(origin + "/agents", { headers: { cookie: secondSession } })).json()).agents.length, 0);
  ownerApproved = true;
  const copyArgs = { portal: localPortal, deviceId: device.agentId, senderId: sender.agentId, messageId: "synthetic-message" };
  assert.notEqual((await mcp.callTool({ name: "owner_device_copy", arguments: copyArgs })).isError, true);
  assert.notEqual((await mcp.callTool({ name: "owner_device_copy", arguments: copyArgs })).isError, true);
  ownerApproved = false;
  const read = async (reader, account, cookie, nonce = base64url(randomBytes(32))) => {
    const body = { agentId: agent.agentId, deviceId: reader.agentId, nonce };
    const timestamp = String(Date.now());
    const signature = await signRequest(reader, "owner-copy-read-v1", timestamp, { ...body, accountId: account });
    return mf.dispatchFetch(origin + "/copy/read", { method: "POST", headers: {
      origin, cookie, "content-type": "application/json", "x-device-timestamp": timestamp, "x-device-signature": signature,
    }, body: JSON.stringify(body) });
  };
  const nonce = base64url(randomBytes(32));
  const readResponse = await read(device, "12345", sessionCookie, nonce);
  assert.equal(readResponse.status, 200);
  const copies = (await readResponse.json()).copies;
  assert.equal(copies.length, 1);
  assert.equal(JSON.stringify(copies).includes(sample), false);
  assert.equal(JSON.parse(await openOwnerCopy(device, agentIdentity, copies[0])).text, sample);
  assert.equal((await read(device, "12345", sessionCookie, nonce)).status, 403);
  assert.equal((await read(await createLocalIdentity(), "12345", sessionCookie)).status, 403);
  assert.equal((await read(device, "67890", secondSession)).status, 403);
  const grantArgs = { portal: localPortal, deviceId: device.agentId, minutes: 30 };
  assert.equal((await mcp.callTool({ name: "owner_device_enable", arguments: grantArgs })).isError, true);
  ownerApproved = true;
  assert.notEqual((await mcp.callTool({ name: "owner_device_enable", arguments: grantArgs })).isError, true);
  portalAvailable = false;
  const backfill = await mcp.callTool({ name: "owner_thread_backfill", arguments: {
    deviceId: device.agentId, peerId: sender.agentId, threadId: "synthetic-thread",
  } });
  assert.equal(JSON.parse(backfill.content[0].text).queued, 2);
  ownerApproved = false;
  await new Promise(resolve => setTimeout(resolve, 100));
  portalAvailable = true;
  await mcp.callTool({ name: "owner_copy_retry", arguments: {} });
  let replayed = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    replayed = (await (await read(device, "12345", sessionCookie)).json()).copies;
    if (replayed.length === 2) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(replayed.length, 2);
  assert.equal(JSON.stringify(replayed).includes("A second synthetic message"), false);
  const expiredPayload = { envelope: replayed[0], grantNonce: pair.nonce, grantExpiresAt: Date.now() - 1 };
  const expiredTimestamp = String(Date.now());
  const expiredSignature = await signRequest(agentIdentity, "owner-copy-v1", expiredTimestamp, expiredPayload);
  const expiredPublish = await mf.dispatchFetch(origin + "/copy/publish", { method: "POST", headers: {
    "content-type": "application/json", "x-agent-timestamp": expiredTimestamp, "x-agent-signature": expiredSignature,
  }, body: JSON.stringify(expiredPayload) });
  assert.equal(expiredPublish.status, 400);
  await browserSmoke(sessionCookie, agent.agentId);
  if (process.env.AGENT_TALK_TEST_RELAY) {
    secondMcp = new Client({ name: "synthetic-peer", version: "1" }, { capabilities: { elicitation: { form: {} } } });
    const peerTransport = new StdioClientTransport({ command: process.execPath,
      args: ["--import", "tsx", "adapter/mcp-adapter.ts", "--relay", relayOrigin, "--state", join(directory, "peer.json")],
      cwd: process.cwd(), stderr: "pipe" });
    peerTransport.stderr.resume();
    secondMcp.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: { approve: true } }));
    await secondMcp.connect(peerTransport);
    const invoke = async (client, name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) throw new Error(result.content[0].text);
      return JSON.parse(result.content[0].text);
    };
    for (let attempt = 0; attempt < 100; attempt++) {
      const both = await Promise.all([invoke(mcp, "adapter_status"), invoke(secondMcp, "adapter_status")]);
      if (both.every(status => status.socket === "connected")) break;
      await new Promise(resolve => setTimeout(resolve, 50));
      if (attempt === 99) throw new Error("Synthetic agents did not connect.");
    }
    const firstInvite = await invoke(mcp, "profile_export_invite", { displayName: "Synthetic first", expiresInMinutes: 10 });
    const secondInvite = await invoke(secondMcp, "profile_export_invite", { displayName: "Synthetic second", expiresInMinutes: 10 });
    ownerApproved = true;
    await invoke(mcp, "contact_confirm", { invite: JSON.stringify(secondInvite) });
    await invoke(secondMcp, "contact_confirm", { invite: JSON.stringify(firstInvite) });
    portalAvailable = false;
    const received = await invoke(secondMcp, "message_send", { recipientId: agent.agentId, text: "Live synthetic receive" });
    for (let attempt = 0; attempt < 100; attempt++) {
      const inbox = await invoke(mcp, "inbox_list");
      if (inbox.some(item => item.id === received.id)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
      if (attempt === 99) throw new Error("Live message was not saved during portal outage.");
    }
    const durableState = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    assert.equal(Object.values(durableState.ownerQueue).some(item => item.messageId === received.id && item.deviceId === device.agentId), true);
    let ack = "";
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ack = await readFile(join(directory, "ack"), "utf8"); } catch {}
      if (ack === received.id) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(ack, received.id);
    await mcp.close();
    mcp = await startMcp();
    portalAvailable = true;
    await invoke(mcp, "owner_copy_retry");
    let copiesAfterRecovery = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      copiesAfterRecovery = (await (await read(device, "12345", sessionCookie)).json()).copies;
      if (copiesAfterRecovery.length >= 3) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(copiesAfterRecovery.length, 3);
    const sent = await invoke(mcp, "message_send", { recipientId: secondInvite.issuer.agentId, text: "Live synthetic send" });
    let outgoingCopies = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      outgoingCopies = (await (await read(device, "12345", sessionCookie)).json()).copies;
      if (outgoingCopies.length >= 4) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(outgoingCopies.length, 4);
    const decrypted = await Promise.all(outgoingCopies.map(copy => openOwnerCopy(device, agentIdentity, copy)));
    assert.equal(decrypted.some(copy => JSON.parse(copy).id === sent.id && JSON.parse(copy).text === "Live synthetic send"), true);
    ownerApproved = false;
    console.log("Two local MCP agents delivered live incoming and outgoing copies; portal outage retained the durable queue.");
  }
  await post("/device/revoke", secondSession, { agentId: agent.agentId, deviceId: device.agentId });
  const beforeRevocation = await (await mf.dispatchFetch(origin + "/agents", { headers: { cookie: sessionCookie } })).json();
  assert.equal(beforeRevocation.agents.find(item => item.agentId === agent.agentId).devices.length, 2);
  assert.equal((await post("/device/revoke", sessionCookie, { agentId: agent.agentId, deviceId: device.agentId })).status, 200);
  const afterRevocation = await (await mf.dispatchFetch(origin + "/agents", { headers: { cookie: sessionCookie } })).json();
  assert.equal(afterRevocation.agents.find(item => item.agentId === agent.agentId).devices.length, 1);
  assert.equal((await read(device, "12345", sessionCookie)).status, 403);
  ownerApproved = true;
  assert.equal((await mcp.callTool({ name: "owner_device_copy", arguments: copyArgs })).isError, true);
  const rePair = await post("/pairing/start", sessionCookie, { agentId: agent.agentId, device: publicDevice });
  const rePairRequest = (await rePair.json()).request;
  const rePairApproval = await mcp.callTool({ name: "owner_device_approve", arguments: { request: rePairRequest } });
  assert.notEqual(rePairApproval.isError, true);
  assert.equal((await post("/pairing/complete", sessionCookie, { approval: JSON.parse(rePairApproval.content[0].text) })).status, 200);
  const stalePayload = { envelope: replayed[0], grantNonce: pair.nonce };
  const staleTimestamp = String(Date.now());
  const staleSignature = await signRequest(agentIdentity, "owner-copy-v1", staleTimestamp, stalePayload);
  assert.equal((await mf.dispatchFetch(origin + "/copy/publish", { method: "POST", headers: {
    "content-type": "application/json", "x-agent-timestamp": staleTimestamp, "x-agent-signature": staleSignature,
  }, body: JSON.stringify(stalePayload) })).status, 403);
  assert.equal((await (await read(device, "12345", sessionCookie)).json()).copies.length, 0);
  assert.equal((await mf.dispatchFetch(origin + "/auth/logout", { method: "POST", headers: { origin: "https://evil.example", cookie: sessionCookie } })).status, 403);
  assert.equal((await mf.dispatchFetch(origin + "/auth/logout", { method: "POST", headers: { origin, cookie: sessionCookie } })).status, 200);
  assert.equal((await mf.dispatchFetch(origin + "/auth/account", { headers: { cookie: sessionCookie } })).status, 401);
  console.log("Portal HTTP login, account isolation, pairing, denial, replay, revocation and logout passed.");
} finally {
  if (chrome) chrome.kill("SIGTERM");
  if (secondMcp) await secondMcp.close();
  if (mcp) await mcp.close();
  await new Promise(resolve => proxy.close(resolve));
  await rm(directory, { recursive: true, force: true });
  await mf.dispose();
}
