import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => {
  const isTest = mode === "test";
  const workerName = isTest ? "agent-talk-test" : "agent-talk";
  return {
    worker: {
    // Separate Worker names provision separate Durable Object namespaces and SQLite stores.
    name: workerName,
    compatibilityDate: "2026-11-26",
    entrypoint,
    // This is only applied by the manually confirmed production workflow.
    domains: isTest ? [] : ["agent-talk.nyphon.de"],
    env: {
      DIRECTORY: bindings.durableObject({ worker: workerName, exportName: "Directory" }),
      MAILBOX: bindings.durableObject({ worker: workerName, exportName: "Mailbox" }),
    },
    assets: {
      // Static assets are served before this Worker. Only relay paths execute code.
      runWorkerFirst: ["/v1/*", "/healthz"],
    },
    exports: {
      Directory: exports.durableObject({ storage: "sqlite" }),
      Mailbox: exports.durableObject({ storage: "sqlite" }),
    },
    },
  };
});
