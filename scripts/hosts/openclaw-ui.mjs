// Run against the test Worker using two disposable real OpenClaw gateways and browser sessions.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { open, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";

const relay = "https://agent-talk-test.ralph-cfd.workers.dev";
const checkout = resolve(process.argv[2] ?? ".");
const packagePath = resolve(process.env.OPENCLAW_PACKAGE_DIR);
const requireHost = createRequire(join(packagePath, "package.json"));
assert.equal(requireHost("./package.json").version, "2026.11.10");
const { chromium } = requireHost("playwright-core");
const privateDir = await mkdtemp(join(tmpdir(), "agent-talk-ui-proof-"));
const actors = [];
const steps = new Map();
const syntheticModelKey = randomBytes(32).toString("hex");
let browser;
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}
async function until(label, probe, timeout = 90_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const found = await probe();
    if (found) return found;
    await delay(150);
  }
  throw new Error("Timed out waiting for " + label);
}
// The loopback model issues exactly the tool selected by the test operator. It never
// interprets a tool's output as a request for another tool.
const model = createServer(async (req, res) => {
  try {
    if (
      req.method !== "POST" ||
      req.url !== "/v1/chat/completions" ||
      req.headers.authorization !== "Bearer " + syntheticModelKey
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4_000_000) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const users = body.messages.filter((m) => m.role === "user");
    const step = [...steps.values()].find((s) =>
      users.some((m) => JSON.stringify(m.content).includes(s.marker)),
    );
    const response =
      step?.callId &&
      body.messages.find((m) => m.role === "tool" && m.tool_call_id === step.callId);
    let delta = { role: "assistant", content: "Complete." };
    let stop = "stop";
    if (step && !step.invoked) {
      const tool = body.tools
        ?.map((t) => t.function?.name)
        .find(
          (name) =>
            name === step.name ||
            name?.endsWith("__" + step.name) ||
            name?.endsWith("_" + step.name),
        );
      if (!tool)
        throw new Error(
          "Missing host tool " +
            step.name +
            " in " +
            body.tools?.map((t) => t.function?.name).join(","),
        );
      step.invoked = true;
      step.callId = "call" + randomBytes(8).toString("hex");
      delta = {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: step.callId,
            type: "function",
            function: { name: tool, arguments: JSON.stringify(step.args) },
          },
        ],
      };
      stop = "tool_calls";
    } else if (response) {
      step.output =
        typeof response.content === "string"
          ? response.content
          : response.content.map((x) => x.text).join("");
      delta.content = "Finished " + step.marker + ".";
    }
    const base = {
      id: "chatcmpl-fixture",
      object: "chat.completion.chunk",
      model: "agent-talk-test",
      created: Math.floor(Date.now() / 1000),
    };
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const [change, finish] of [
      [delta, null],
      [{}, stop],
    ]) {
      res.write(
        "data: " +
          JSON.stringify({
            ...base,
            choices: [{ index: 0, delta: change, finish_reason: finish }],
          }) +
          "\n\n",
      );
    }
    res.end("data: [DONE]\n\n");
  } catch (error) {
    console.error("Loopback fixture:", error.message);
    res.writeHead(500);
    res.end();
  }
});
const modelPort = await listen(model);
async function makeActor(name) {
  const home = join(privateDir, name);
  const state = join(home, "openclaw");
  const workspace = join(home, "workspace");
  const profile = join(home, "agent-talk", "state.json");
  for (const dir of [state, workspace]) await mkdir(dir, { recursive: true, mode: 0o700 });
  const lease = createServer();
  const port = await listen(lease);
  await new Promise((resolve) => lease.close(resolve));
  const token = randomBytes(32).toString("hex");
  const config = join(state, "openclaw.json");
  await writeFile(
    config,
    JSON.stringify({
      gateway: { mode: "local", bind: "loopback", port, auth: { mode: "token", token } },
      agents: {
        defaults: { workspace, skipBootstrap: true, model: { primary: "fixture/agent-talk-test" } },
      },
      models: {
        mode: "replace",
        providers: {
          fixture: {
            api: "openai-completions",
            baseUrl: "http://127.0.0.1:" + modelPort + "/v1",
            apiKey: syntheticModelKey,
            authHeader: true,
            agentRuntime: { id: "openclaw" },
            models: [
              {
                id: "agent-talk-test",
                name: "Agent Talk test model",
                contextWindow: 128000,
                maxTokens: 1024,
              },
            ],
          },
        },
      },
      tools: { toolSearch: false },

      mcp: {
        apps: { enabled: true },
        servers: {
          "agent-talk": {
            command: "npm",
            args: ["--silent", "run", "mcp", "--", "--relay", relay, "--state", profile],
            cwd: checkout,
          },
        },
      },
      discovery: { mdns: { mode: "off" } },
      browser: { enabled: false },
      cron: { enabled: false },
      logging: { file: join(home, "gateway.log") },
    }),
    { mode: 0o600 },
  );
  const stderr = await open(join(home, "gateway-output"), "a", 0o600);
  const child = spawn(process.execPath, [join(packagePath, "openclaw.mjs"), "gateway", "run"], {
    cwd: home,
    env: {
      PATH: dirname(process.execPath) + ":/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: home,
      TMPDIR: home,
      OPENCLAW_HOME: home,
      OPENCLAW_STATE_DIR: state,
      OPENCLAW_CONFIG_PATH: config,
      OPENCLAW_DISABLE_BONJOUR: "1",
      OPENCLAW_SKIP_CHANNELS: "1",
      DISABLE_PROMPT_CACHING: "1",
      NO_COLOR: "1",
    },
    stdio: ["ignore", stderr.fd, stderr.fd],
    detached: true,
  });
  await stderr.close();
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  const actor = { name, child, home, page, profile, context };
  actors.push(actor);
  const url = "http://127.0.0.1:" + port;
  await until("loopback gateway " + name, async () => {
    if (child.exitCode !== null)
      throw new Error(
        "Gateway " +
          name +
          " exited: " +
          (await readFile(join(home, "gateway-output"), "utf8"))
            .slice(-1200)
            .replaceAll(token, "[redacted]"),
      );
    return fetch(url + "/healthz")
      .then((r) => r.ok)
      .catch(() => false);
  });
  await page.goto(url + "/chat#token=" + token);
  return actor;
}
async function chat(actor, name, args = {}, handleForm) {
  const marker = "AT_FIXTURE_" + randomUUID();
  const step = { marker, name, args };
  console.log(actor.name + " " + name);
  steps.set(marker, step);
  const input = actor.page.locator("textarea:visible, [contenteditable=true]:visible").last();
  await input.fill(marker, { timeout: 25_000 });
  await input.press("Enter");
  if (handleForm) await handleForm(actor.page);
  await until(name + " tool response", () => step.output);
  await actor.page
    .getByText("Finished " + marker + ".", { exact: true })
    .last()
    .waitFor({ timeout: 30_000 });
  steps.delete(marker);
  return step.output;
}
function value(output) {
  let text = output;
  for (let n = 0; n < 3; n++) {
    const i = text.search(/[[{]/);
    const parsed = JSON.parse(text.slice(i));
    const inner = Array.isArray(parsed)
      ? parsed[0]?.type === "text"
        ? parsed[0].text
        : undefined
      : parsed.content?.[0]?.text;
    if (!inner) return parsed;
    text = inner;
  }
  throw new Error("Invalid synthetic result");
}
async function decide(page, details, accept) {
  const field = page.locator(".chat-question-panel").getByText(details[0], { exact: false }).last();
  await field.waitFor({ timeout: 40_000 });
  const prompt = await field.innerText();
  for (const detail of details)
    assert.ok(prompt.includes(detail), "Owner form omitted an operation detail");
  await page
    .locator(".chat-question-panel__option-label")
    .filter({ hasText: accept ? /^Yes$/ : /^No$/ })
    .click();
  await page
    .getByRole("button", { name: /submit/i })
    .last()
    .click();
}
async function groupExchange(a, b, first, second) {
  const approved = async (actor, tool, args, details) =>
    value(await chat(actor, tool, args, (page) => decide(page, [...details, relay], true)));
  const name = "Synthetic design review";
  const { groupId } = await approved(a, "group_create", { name }, [name, first.agentId]);
  assert.ok(groupId);
  const invite = await approved(a, "group_invite", { groupId, target: second.agentId }, [
    groupId,
    second.agentId,
  ]);
  const consent = await approved(b, "group_accept", { invite: JSON.stringify(invite) }, [
    groupId,
    first.agentId,
    second.agentId,
  ]);
  await approved(a, "group_add", { consent: JSON.stringify(consent) }, [groupId, second.agentId]);
  const question = "Is the group's preview ready?";
  const ask = await approved(a, "group_ask", { groupId, text: question }, [
    groupId,
    question,
    second.agentId,
  ]);
  const fromA = value(await chat(b, "group_read", { groupId, threadId: ask.threadId }));
  assert.deepEqual(
    fromA.map((row) => [row.id, row.senderId, row.text]),
    [[ask.id, first.agentId, question]],
  );
  const answer = "Yes, the group can review it.";
  const reply = await approved(b, "group_reply", { groupId, replyTo: ask.id, text: answer }, [
    groupId,
    answer,
    first.agentId,
  ]);
  const thread = value(await chat(a, "group_read", { groupId, threadId: ask.threadId }));
  assert.deepEqual(
    thread.map((row) => [row.id, row.senderId, row.text]),
    [
      [ask.id, first.agentId, question],
      [reply.id, second.agentId, answer],
    ],
  );
  console.log(
    "PASS OpenClaw owner forms for MLS group creation, invitation, acceptance, addition, threaded question and manual reply.",
  );
}
try {
  const health = await fetch(relay + "/healthz", {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(health.status, 200);
  const release = (await health.json()).release;
  assert.match(release, /^[a-f0-9]{40}$/);
  if (process.env.EXPECTED_RELEASE) assert.equal(release, process.env.EXPECTED_RELEASE);
  console.log("Test Worker release:", release);
  browser = await chromium.launch({
    executablePath: process.env.TEST_BROWSER_EXECUTABLE,
    headless: true,
  });
  const a = await makeActor("operator-a"),
    b = await makeActor("operator-b");
  const first = value(await chat(a, "adapter_status")),
    second = value(await chat(b, "adapter_status"));
  assert.notEqual(first.agentId, second.agentId);
  const ai = value(await chat(a, "profile_export_invite", { displayName: "Synthetic A" }));
  const bi = value(await chat(b, "profile_export_invite", { displayName: "Synthetic B" }));
  for (const [receiver, invite, sender] of [
    [a, bi, second],
    [b, ai, first],
  ]) {
    const args = { invite: JSON.stringify(invite) };
    const preview = value(await chat(receiver, "contact_preview", args));
    assert.equal(preview.fingerprint, sender.fingerprint);
    const declined = await chat(receiver, "contact_confirm", args, (page) =>
      decide(page, [preview.fingerprint, preview.agentId, relay], false),
    );
    assert.match(declined, /Owner approval required/i);
    assert.equal(value(await chat(receiver, "adapter_status")).contacts, 0);
    const confirmed = value(
      await chat(receiver, "contact_confirm", args, (page) =>
        decide(page, [preview.fingerprint, preview.agentId, relay], true),
      ),
    );
    assert.equal(confirmed.agentId, sender.agentId);
  }
  const question = value(
    await chat(a, "message_send", {
      recipientId: second.agentId,
      text: "Is the dev preview ready for review?",
    }),
  );
  const received = value(await chat(b, "inbox_list"));
  assert.equal(
    received.filter(
      (x) =>
        x.id === question.id &&
        x.senderId === first.agentId &&
        x.text === "Is the dev preview ready for review?",
    ).length,
    1,
  );
  const reply = value(
    await chat(b, "message_send", {
      recipientId: first.agentId,
      text: "Yes, it is ready for review.",
    }),
  );
  const answers = value(await chat(a, "inbox_list"));
  assert.equal(
    answers.filter(
      (x) =>
        x.id === reply.id &&
        x.senderId === second.agentId &&
        x.text === "Yes, it is ready for review.",
    ).length,
    1,
  );
  assert.equal(answers.length, 1);
  assert.equal(value(await chat(b, "inbox_list")).length, 1);
  if (process.argv.includes("--groups")) await groupExchange(a, b, first, second);
  console.log(
    "PASS OpenClaw 2026.11.10 on " +
      relay +
      " with two isolated gateways, rendered fingerprint, declined and approved in both directions, one question and one manual reply.",
  );
} finally {
  await browser?.close();
  for (const actor of actors) {
    try {
      process.kill(-actor.child.pid, "SIGTERM");
    } catch {}
  }
  await Promise.all(
    actors.map((actor) =>
      actor.child.exitCode === null && actor.child.signalCode === null
        ? Promise.race([once(actor.child, "exit"), delay(6000)])
        : null,
    ),
  );
  for (const actor of actors) {
    try {
      if (actor.child.exitCode === null && actor.child.signalCode === null)
        process.kill(-actor.child.pid, "SIGKILL");
    } catch {}
  }
  model.closeAllConnections();
  model.close();
  await rm(privateDir, { recursive: true, force: true });
}
