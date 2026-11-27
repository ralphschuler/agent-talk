import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// The config is evaluated by Node at build time; the Worker keeps its runtime-only types.
declare const process: { env: { EXPECTED_RELEASE?: string } };

export default defineConfig(({ mode }) => {
  const release = process.env.EXPECTED_RELEASE ?? "local";
  if (process.env.EXPECTED_RELEASE !== undefined && !/^[a-f0-9]{40}$/.test(release)) throw new Error("EXPECTED_RELEASE must be a full Git commit SHA");
  const isTest = mode === "test";
  const workerName = isTest ? "agent-talk-test" : "agent-talk";
  return {
    worker: {
    // Separate Worker names provision separate Durable Object namespaces and SQLite stores.
    name: workerName,
    compatibilityDate: "2026-11-26",
    entrypoint,
    // Updates send a new version to the existing Worker. The rollout never changes triggers.
    env: {
      RELEASE_SHA: bindings.text(release),
      PROJECT_OWNER: bindings.text("ralphschuler/agent-talk:" + (isTest ? "test" : "production")),
      DIRECTORY: bindings.durableObject({ worker: workerName, exportName: "Directory" }),
      MAILBOX: bindings.durableObject({ worker: workerName, exportName: "Mailbox" }),
    },
    assets: {
      // Static assets are served before this Worker. Only relay paths execute code.
      runWorkerFirst: ["/v1/*", "/healthz", "/mcp", "/.well-known/oauth-protected-resource/mcp"],
    },
    exports: {
      Directory: exports.durableObject({ storage: "sqlite" }),
      Mailbox: exports.durableObject({ storage: "sqlite" }),
    },
    },
  };
});
