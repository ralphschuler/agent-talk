import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// The config is evaluated by Node at build time; the Worker keeps its runtime-only types.
declare const process: { env: { EXPECTED_RELEASE?: string; AGENT_TALK_TEST_OAUTH_KV_ID?: string; OWNER_OAUTH_CLIENT_ID?: string } };

export default defineConfig(({ mode }) => {
  const release = process.env.EXPECTED_RELEASE ?? "local";
  if (process.env.EXPECTED_RELEASE !== undefined && !/^[a-f0-9]{40}$/.test(release)) throw new Error("EXPECTED_RELEASE must be a full Git commit SHA");
  const isCanonicalTest = mode === "canonical-test";
  const isTest = mode === "test" || isCanonicalTest;
  const workerName = isCanonicalTest ? "agent-talk-canonical-test" : isTest ? "agent-talk-test" : "agent-talk";
  const oauthKv = isTest ? process.env.AGENT_TALK_TEST_OAUTH_KV_ID : undefined;
  const oauthClient = isTest ? process.env.OWNER_OAUTH_CLIENT_ID : undefined;
  if (isCanonicalTest && (!oauthKv || !oauthClient)) throw new Error("Canonical test OAuth configuration required");
  if (!!oauthKv !== !!oauthClient || (oauthKv && !/^[a-f0-9]{32}$/.test(oauthKv))) throw new Error("Invalid test OAuth configuration");
  const testOauthBindings = oauthKv && oauthClient ? {
    OAUTH_KV: bindings.kv({ id: oauthKv }),
    AUTH_SERVER: bindings.worker({ worker: workerName, exportName: "OAuthValidator" }),
    PORTAL_ORIGIN: bindings.text("https://agent-talk-test.nyphon.de"),
    MCP_OAUTH_ISSUER: bindings.text("https://agent-talk-test.nyphon.de"),
    MCP_OAUTH_RESOURCE: bindings.text("https://agent-talk-test.nyphon.de/mcp"),
    GITHUB_CLIENT_ID: bindings.text(oauthClient),
    GITHUB_CLIENT_SECRET: bindings.secret(),
  } : {};
  return {
    worker: {
    // Separate Worker names provision separate Durable Object namespaces and SQLite stores.
    name: workerName,
    compatibilityDate: "2026-11-26",
    entrypoint,
    // Updates send a new version to the existing Worker. The rollout never changes triggers.
    env: {
      ...testOauthBindings,
      RELEASE_SHA: bindings.text(release),
      PROJECT_OWNER: bindings.text("ralphschuler/agent-talk:" + (isCanonicalTest ? "canonical-test" : isTest ? "test" : "production")),
      DIRECTORY: bindings.durableObject({ worker: workerName, exportName: "Directory" }),
      MAILBOX: bindings.durableObject({ worker: workerName, exportName: "Mailbox" }),
      PORTAL_STORE: bindings.durableObject({ worker: workerName, exportName: "PortalStore" }),
    },
    assets: {
      // Static assets are served before this Worker. Only relay paths execute code.
      runWorkerFirst: ["/v1/*", "/healthz", "/mcp", "/.well-known/oauth-protected-resource/mcp", "/auth/*", "/.well-known/oauth-authorization-server", "/oauth/*", "/authorize", "/agents", "/pairing/*", "/device/*", "/copy/*"],
    },
    exports: {
      Directory: exports.durableObject({ storage: "sqlite" }),
      Mailbox: exports.durableObject({ storage: "sqlite" }),
      PortalStore: exports.durableObject({ storage: "sqlite" }),
      OAuthValidator: exports.worker(),
    },
    },
  };
});
