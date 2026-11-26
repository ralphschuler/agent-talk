// Exercise the same Worker entry point and stdio adapter used by the public release.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const storage = await mkdtemp(join(tmpdir(), "agent-talk-relay-test-"));
const marker = randomUUID();
let server;
try {
  await writeFile(join(storage, "owner"), marker, { mode: 0o600, flag: "wx" });
  server = await createServer({
    root,
    configFile: false,
    plugins: [cloudflare({ persistState: { path: join(storage, "state") } })],
    mode: "test",
    logLevel: "warn",
    server: { host: "127.0.0.1", port: 0, open: false, strictPort: true },
  });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1")
    throw new Error("Expected loopback HTTP listener");
  const relay = "http://127.0.0.1:" + address.port;
  for (const script of [
    "smoke-mcp.mjs",
    "smoke-conversations.mjs",
    "smoke-social.mjs",
    "smoke-upgrade.mjs",
  ]) {
    const proofArgs = script === "smoke-conversations.mjs" ? [storage, marker] : [];
    const child = spawn(process.execPath, ["scripts/" + script, relay, ...proofArgs], {
      cwd: root,
      stdio: "inherit",
    });
    const [code, signal] = await once(child, "exit");
    if (code !== 0) throw new Error(script + " failed (" + (signal ?? code) + ").");
  }
} finally {
  try {
    await server?.close();
  } finally {
    await rm(storage, { recursive: true, force: true });
  }
}
