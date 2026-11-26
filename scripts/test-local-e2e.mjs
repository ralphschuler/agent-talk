// Exercise the same Worker entry point and stdio adapter used by the public release.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  mode: "test",
  logLevel: "warn",
  server: { host: "127.0.0.1", port: 0, open: false, strictPort: true },
});
try {
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
    const child = spawn(process.execPath, ["scripts/" + script, relay], {
      cwd: root,
      stdio: "inherit",
    });
    const [code, signal] = await once(child, "exit");
    if (code !== 0) throw new Error(script + " failed (" + (signal ?? code) + ").");
  }
} finally {
  await server.close();
}
