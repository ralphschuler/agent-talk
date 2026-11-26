// Synthetic API fixture used only by test-owner-release.mjs.
import { appendFileSync } from "node:fs";

globalThis.fetch = async (url, options = {}) => {
  const path = new URL(String(url)).pathname;
  appendFileSync(process.env.OWNER_API_TRACE, (options.method ?? "GET") + " " + path + "\n");
  if (path.endsWith("/subdomain")) return Response.json({ success: true, result: { subdomain: "ralph-cfd" } });
  if (path.endsWith("/scripts")) return Response.json({ success: true, result: ["initial", "race"].includes(process.env.OWNER_FAKE_SCENARIO) ? [] : [{ id: "agent-talk-owner-test" }], result_info: { total_pages: 1 } });
  if (path.endsWith("/workers/workers") && options.method === "POST") {
    if (process.env.OWNER_FAKE_SCENARIO === "race") return Response.json({ success: false }, { status: 409 });
    return Response.json({ success: true, result: { id: "a".repeat(32), name: "agent-talk-owner-test" } });
  }
  if (path.endsWith("/settings")) {
    return Response.json({ success: true, result: { bindings: [
      { name: "PROJECT_OWNER", type: "plain_text", text: process.env.OWNER_FAKE_SCENARIO === "foreign" ? "another-project" : "ralphschuler/agent-talk:owner-test" },
      { name: "PORTAL_ORIGIN", type: "plain_text", text: "https://agent-talk-owner-test.ralph-cfd.workers.dev" },
      { name: "PORTAL_STORE", type: "durable_object_namespace", namespace_id: "synthetic-namespace" },
    ] } });
  }
  if (path.endsWith("/durable_objects/namespaces")) {
    const result = [{ script: "agent-talk-owner-test", class: "PortalStore", id: "synthetic-namespace", use_sqlite: true }];
    if (process.env.OWNER_FAKE_SCENARIO === "shared") result.push({ script: "agent-talk-owner", class: "PortalStore", id: "synthetic-namespace", use_sqlite: true });
    return Response.json({ success: true, result, result_info: { total_pages: 1 } });
  }
  if (path.includes("/versions/")) {
    return Response.json({ success: true, result: { annotations: { "workers/message": process.env.OWNER_FAKE_SCENARIO === "wrongsha" ? "b".repeat(40) : "a".repeat(40) } } });
  }
  if (path.endsWith("/deployments") && options.method === "POST") return Response.json({ success: true, result: { id: "c".repeat(32) } });
  if (path.endsWith("/deployments/" + "c".repeat(32))) {
    return Response.json({ success: true, result: { id: "c".repeat(32), versions: [{ version_id: "11111111-1111-1111-1111-111111111111", percentage: 100 }] } });
  }
  return Response.json({ success: false }, { status: 404 });
};
