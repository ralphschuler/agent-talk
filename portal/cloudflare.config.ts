import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./worker.ts" with { type: "cf-worker" };

// Production must be selected explicitly. Configure the origin and OAuth
// secrets in each deployment environment; neither shares the relay's storage.
declare const process: { env: { OWNER_TARGET?: string; OWNER_OAUTH_CLIENT_ID?: string; EXPECTED_RELEASE?: string } };
const target = process.env.OWNER_TARGET ?? "test";
if (target !== "test" && target !== "production") throw new Error("Invalid owner portal target.");
const workerName = target === "test" ? "agent-talk-owner-test" : "agent-talk-owner";
const release = process.env.EXPECTED_RELEASE ?? "local";
if (release !== "local" && !/^[a-f0-9]{40}$/.test(release)) throw new Error("Invalid release SHA.");

export default defineConfig({
  worker: {
    name: workerName,
    compatibilityDate: "2026-11-26",
    entrypoint,
    assets: { runWorkerFirst: ["/healthz", "/auth/*", "/agents", "/pairing/*", "/device/*", "/copy/*"] },
    env: {
      PORTAL_STORE: bindings.durableObject({ worker: workerName, exportName: "PortalStore" }),
      PROJECT_OWNER: bindings.text("ralphschuler/agent-talk:owner-" + target),
      RELEASE_SHA: bindings.text(release),
      PORTAL_ORIGIN: bindings.text(`https://${workerName}.ralph-cfd.workers.dev`),
      GITHUB_CLIENT_ID: bindings.text(process.env.OWNER_OAUTH_CLIENT_ID ?? ""),
      GITHUB_CLIENT_SECRET: bindings.secret(),
    },
    exports: { PortalStore: exports.durableObject({ storage: "sqlite" }) },
  },
});
