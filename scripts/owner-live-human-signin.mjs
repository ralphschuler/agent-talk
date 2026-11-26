// Interactive identity preflight only. It does not produce release evidence.
// The human signs in through GitHub in an isolated browser profile.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const origin = "https://agent-talk-owner-test.ralph-cfd.workers.dev";

export async function waitForHumanSignIn(page, expectedId, report = () => {}) {
  if (!/^[1-9][0-9]{0,19}$/.test(expectedId ?? "")) throw new Error("Expected a numeric synthetic test account ID.");
  let observedAuthorization = false;
  const observe = frame => {
    if (frame !== page.mainFrame()) return;
    try {
      const url = new URL(frame.url());
      if (url.origin === "https://github.com" && url.pathname === "/login/oauth/authorize") observedAuthorization = true;
    } catch {}
  };
  const observeRequest = request => {
    try {
      const url = new URL(request.url());
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() &&
          url.origin === "https://github.com" && url.pathname === "/login/oauth/authorize") observedAuthorization = true;
    } catch {}
  };
  page.on("framenavigated", observe);
  page.on("request", observeRequest);
  try {
    report("In the opened browser, choose Sign in with GitHub and complete the sign-in for the designated disposable test account.");
    await page.waitForFunction(
      expected => document.querySelector("#status")?.textContent === "Signed in to GitHub account " + expected + ".",
      expectedId,
      { timeout: 300_000 },
    );
    assert.equal(new URL(page.url()).origin, origin, "Sign-in did not return to staging.");
    assert.ok(observedAuthorization, "The real GitHub authorization navigation was not observed.");
  } finally {
    page.off("framenavigated", observe);
    page.off("request", observeRequest);
  }
}

async function main() {
  assert.ok(process.stdin.isTTY && process.stdout.isTTY, "Run this interactive preflight in a local terminal.");
  const release = process.env.OWNER_LIVE_RELEASE;
  const first = process.env.OWNER_TEST_ACCOUNT_A_ID;
  const second = process.env.OWNER_TEST_ACCOUNT_B_ID;
  if (!/^[a-f0-9]{40}$/.test(release ?? "")) throw new Error("Set OWNER_LIVE_RELEASE to the verified staging commit.");
  if (!/^[1-9][0-9]{0,19}$/.test(first ?? "") || !/^[1-9][0-9]{0,19}$/.test(second ?? "") || first === second) {
    throw new Error("Use two distinct numeric IDs of authorized disposable accounts.");
  }
  const health = await fetch(origin + "/healthz", { redirect: "error", signal: AbortSignal.timeout(20_000) });
  assert.ok(health.ok && (await health.json()).release === release, "The exact staging release is not live.");
  assert.ok(process.env.OPENCLAW_PACKAGE_DIR, "Set OPENCLAW_PACKAGE_DIR to the verified local OpenClaw package.");
  const requireHost = createRequire(join(resolve(process.env.OPENCLAW_PACKAGE_DIR), "package.json"));
  assert.equal(requireHost("./package.json").version, "2026.11.10", "Use the verified OpenClaw version.");
  const { chromium } = requireHost("playwright-core");
  const directory = await mkdtemp(join(tmpdir(), "agent-talk-live-human-"));
  let browser;
  try {
    browser = await chromium.launchPersistentContext(directory, {
      headless: false, ...(process.env.TEST_BROWSER_EXECUTABLE && { executablePath: process.env.TEST_BROWSER_EXECUTABLE }),
    });
    const page = browser.pages()[0] ?? await browser.newPage();
    await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
    await waitForHumanSignIn(page, first, console.log);
    await page.locator("#logout").click();
    await page.locator("#login").waitFor({ state: "visible" });
    await waitForHumanSignIn(page, second, console.log);
    console.log("Both human sign-ins succeeded. This preflight does not constitute live E2E evidence.");
  } finally {
    if (browser) await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : "Interactive identity preflight failed.");
    process.exitCode = 1;
  }
}
