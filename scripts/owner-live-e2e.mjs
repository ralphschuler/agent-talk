import { checkOfflineReplay, checkPortalRetry, inspectOfflineSyntheticStorage, prepareSyntheticScenario } from "./owner-live-fixture.mjs";
// Interactive staging scenario. No credentials or browser state leave this machine.
// Its sanitized local observation does not unlock production.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { waitForHumanSignIn } from "./owner-live-human-signin.mjs";
import { runOwnerBrowserScenario } from "./owner-browser-scenario.mjs";
import { checkLiveStorage, getStagingDeployment } from "./owner-live-storage-check.mjs";
import { writeSanitizedObservation } from "./owner-live-record.mjs";

const portal = "https://agent-talk-owner-test.ralph-cfd.workers.dev";
const relay = "https://agent-talk-test.ralph-cfd.workers.dev";

export function liveSettings(env, tty) {
  assert.ok(tty, "Run the staging scenario in an interactive local terminal.");
  assert.match(env.OWNER_LIVE_RELEASE ?? "", /^[a-f0-9]{40}$/, "Set the full verified staging commit SHA.");
  for (const name of ["OWNER_TEST_ACCOUNT_A_ID", "OWNER_TEST_ACCOUNT_B_ID"]) {
    assert.match(env[name] ?? "", /^[1-9][0-9]{0,19}$/, "Set both authorized disposable GitHub account IDs.");
  }
  assert.notEqual(env.OWNER_TEST_ACCOUNT_A_ID, env.OWNER_TEST_ACCOUNT_B_ID, "Use distinct test accounts.");
  assert.ok(env.OPENCLAW_PACKAGE_DIR, "Set OPENCLAW_PACKAGE_DIR to the verified local OpenClaw package.");
  return { release: env.OWNER_LIVE_RELEASE, accountA: env.OWNER_TEST_ACCOUNT_A_ID, accountB: env.OWNER_TEST_ACCOUNT_B_ID };
}

async function waitForValue(fn, description) {
  for (let n = 0; n < 200; n++) {
    if (await fn()) return;
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error(description + " timed out.");
}

async function main() {
  const settings = liveSettings(process.env, process.stdin.isTTY && process.stdout.isTTY);
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const evidencePath = process.env.OWNER_LIVE_EVIDENCE_PATH;
  assert.match(account ?? "", /^[a-f0-9]{32}$/i, "Cloudflare account ID is unavailable.");
  assert.ok(token, "Cloudflare API token is unavailable.");
  assert.ok(evidencePath, "Set OWNER_LIVE_EVIDENCE_PATH to a new local output file.");
  try { await lstat(evidencePath); throw new Error("The evidence output already exists."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), settings.release,
    "The local checkout is not the requested staging commit.");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "",
    "Use a clean verified checkout for the interactive staging run.");
  const checkRelease = async () => {
    const health = await fetch(portal + "/healthz", { redirect: "error", signal: AbortSignal.timeout(20_000) });
    assert.ok(health.ok && (await health.json()).release === settings.release, "The expected staging commit is not live.");
  };
  await checkRelease();
  const expectedDeployment = await getStagingDeployment({ account, token, release: settings.release });
  const requireHost = createRequire(join(resolve(process.env.OPENCLAW_PACKAGE_DIR), "package.json"));
  assert.equal(requireHost("./package.json").version, "2026.11.10", "Use the verified OpenClaw version.");
  const { chromium } = requireHost("playwright-core");
  const dir = await mkdtemp(join(tmpdir(), "agent-talk-live-e2e-"));
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const clients = [];
  const outageFlag = join(dir, "portal-outage");
  let browser;
  let storageObservation;
  async function approve(message) {
    console.log("\nOwner confirmation for disposable test identities:\n" + message);
    return (await input.question('Type "yes" to approve; anything else declines: ')).trim() === "yes";
  }
  async function agent(name) {
    const client = new Client({ name: "agent-talk-live-test", version: "1" }, { capabilities: { elicitation: { form: {} } } });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ["--import", "tsx", "adapter/mcp-adapter.ts", "--relay", relay, "--state", join(dir, name + ".json")],
      cwd: process.cwd(), stderr: "pipe", ...(name === "a1" && { env: {
        NODE_OPTIONS: "--import=" + resolve("scripts/owner-live-portal-outage.mjs"),
        OWNER_TEST_PORTAL_ORIGIN: portal, OWNER_TEST_BLOCK_FILE: outageFlag,
      } }) });
    transport.stderr.resume();
    client.setRequestHandler(ElicitRequestSchema, async request => (await approve(request.params.message))
      ? { action: "accept", content: { approve: true } } : { action: "decline" });
    await client.connect(transport);
    clients.push(client);
    return client;
  }
  async function invoke(client, name, args = {}) {
    const value = await client.callTool({ name, arguments: args });
    if (value.isError) throw new Error("Synthetic MCP operation failed or was declined: " + name);
    return JSON.parse(value.content[0].text);
  }
  try {
    const a1 = await agent("a1");
    const a2 = await agent("a2");
    let b3 = await agent("b3");
    const { one, two, three, first, second, groupId, question } = await prepareSyntheticScenario({ a1, a2, b3, invoke, waitForValue });
    b3 = await checkOfflineReplay({ sender: a2, receiver: b3, receiverId: three.agentId,
      restart: () => agent("b3"), invoke, waitForValue });
    browser = await chromium.launchPersistentContext(join(dir, "browser"), {
      headless: false, env: getDefaultEnvironment(),
      ...(process.env.TEST_BROWSER_EXECUTABLE && { executablePath: process.env.TEST_BROWSER_EXECUTABLE }),
    });
    const page = browser.pages()[0] ?? await browser.newPage();
    await page.goto(portal + "/", { waitUntil: "domcontentloaded" });
    console.log("Owner B: sign in with the designated disposable GitHub account.");
    await waitForHumanSignIn(page, settings.accountB, console.log);
    await page.locator("#agent-id").fill(three.agentId);
    await page.locator("#start-pairing").click();
    await page.waitForFunction(() => document.querySelector("#pair-request")?.value?.length > 0);
    const request = JSON.parse(await page.locator("#pair-request").inputValue());
    assert.equal(request.accountId, settings.accountB);
    assert.equal(request.agentId, three.agentId);
    const approval = await invoke(b3, "owner_device_approve", { request });
    await page.locator("#pair-approval").fill(JSON.stringify(approval));
    await page.locator("#complete-pairing").click();
    await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Device paired.");
    await invoke(b3, "owner_device_enable", { portal, deviceId: request.device.agentId, minutes: 30 });
    await page.locator("#logout").click();
    await page.locator("#login").waitFor({ state: "visible" });
    console.log("Owner A: sign in with the designated disposable GitHub account.");
    await waitForHumanSignIn(page, settings.accountA, console.log);
    await runOwnerBrowserScenario({
      evaluate: expression => page.evaluate(expression),
      waitFor: expression => page.waitForFunction(expression, null, { timeout: 20_000 }),
      portalOrigin: portal, agentId: one.agentId, senderId: two.agentId, mcp: a1, secondMcp: a2,
      firstThreadId: first.threadId, firstMessageId: first.id, firstAccountId: settings.accountA, secondAccountId: settings.accountB,
      multiAgent: { secondAgentId: two.agentId, thirdAgentId: three.agentId, threadId: second.threadId,
        groupId, groupThreadId: question.threadId },
      // The MCP client always asks the human, including for backfill and rejected copies.
      setApproval: async () => {},
      testRetry: deviceId => {
        let requested = false;
        return checkPortalRetry({ sender: a2, receiver: a1, receiverId: one.agentId, deviceId,
          statePath: join(dir, "a1.json"), outageFlag, invoke, waitForValue,
          verifyBrowser: async () => {
            if (!requested) {
              requested = true;
              await page.locator("#agents button").filter({ hasText: one.agentId }).click();
            }
            return page.evaluate(() => Array.from(document.querySelectorAll("#messages article"))
              .filter(item => item.textContent.includes("Synthetic portal retry message")).length === 1);
          },
        });
      },
      inspectStorage: async deviceId => {
        storageObservation = await inspectOfflineSyntheticStorage({ sender: a1, receiver: b3, senderId: one.agentId,
          recipientId: three.agentId, deviceId, groupId, statePaths: [join(dir, "a1.json"), join(dir, "a2.json")],
          invoke, waitForValue, checkStorage: input => checkLiveStorage({ ...input, account, token,
            release: settings.release, expectedDeployment }) });
      },
      delayRead: async target => {
        const handler = async route => {
          let body;
          try { body = route.request().postDataJSON(); } catch {}
          if (body?.agentId !== target) { await route.continue(); return; }
          await page.unroute("**/copy/read", handler);
          await new Promise(done => setTimeout(done, 500));
          await route.continue();
        };
        await page.route("**/copy/read", handler);
      },
      revokeFirst: async id => {
        let dialogResult;
        page.once("dialog", dialog => { dialogResult = (async () => {
          if (await approve(dialog.message())) await dialog.accept(); else await dialog.dismiss();
        })(); });
        await page.locator("#agents button").filter({ hasText: id }).locator("xpath=following-sibling::*[1]").click();
        if (!dialogResult) throw new Error("Expected a human revocation confirmation.");
        await dialogResult;
      },
      signInSecond: async () => {
        console.log("Owner B: sign in again with the same designated disposable account.");
        await waitForHumanSignIn(page, settings.accountB, console.log);
      },
    });
    await checkRelease();
    assert.ok(storageObservation, "The staging storage inspection did not run.");
    assert.deepEqual(await getStagingDeployment({ account, token, release: settings.release }), expectedDeployment,
      "The staging deployment changed during the interactive scenario.");
    await writeSanitizedObservation({ path: evidencePath, release: settings.release,
      deployment: expectedDeployment, storage: storageObservation.result, routing: storageObservation.routing,
      materialDigests: storageObservation.materialDigests });
    console.log("Interactive staging checks passed and a sanitized local observation was written. Production remains gated.");
  } finally {
    if (browser) await browser.close().catch(() => {});
    await Promise.allSettled(clients.reverse().map(client => client.close()));
    input.close();
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch (error) { console.error(error instanceof Error ? error.message : "Staging scenario failed."); process.exitCode = 1; }
}
