import assert from "node:assert/strict";
import { checkLiveStorage } from "./owner-live-storage-check.mjs";

const syntheticMarker = "synthetic message never sent to the API";
const syntheticKey = Buffer.alloc(32, 1).toString("base64url");
const input = {
  account: "a".repeat(32), token: "synthetic-token",
  release: "d".repeat(40),
  agentId: "at1_" + "A".repeat(43), deviceId: "at1_" + "B".repeat(43),
  recipientId: "at1_" + "C".repeat(43), groupId: "11111111-1111-4111-8111-111111111111",
  ownerCopyId: "e".repeat(64), offlineMessageId: "22222222-2222-4222-8222-222222222222",
  groupMessageId: "33333333-3333-4333-8333-333333333333",
  messageMarkers: [syntheticMarker, "another synthetic group marker"],
  privateKeys: [1, 2, 3, 4].map(value => Buffer.alloc(32, value).toString("base64url")),
};

function fakeFetch(mode) {
  let healthCount = 0;
  let deploymentCount = 0;
  return async (url, options) => {
    if (new URL(url).hostname === "agent-talk-owner-test.ralph-cfd.workers.dev") {
      assert.equal(options.headers, undefined);
      healthCount++;
      return Response.json({ ok: true, release: mode === "wrong-release" || (mode === "release-changed" && healthCount > 1) ? "e".repeat(40) : input.release });
    }
    const path = new URL(url).pathname;
    assert.equal(path.includes("production"), false);
    if (options.body) {
      assert.equal(options.body.includes(syntheticMarker), false);
      for (const key of input.privateKeys) assert.equal(options.body.includes(key), false);
    }
    if (path.endsWith("/settings")) {
      return Response.json({ success: true, result: { bindings: [
        { name: "PROJECT_OWNER", type: "plain_text", text: mode === "foreign-owner" ? "other-project" : "ralphschuler/agent-talk:owner-test" },
      ] } });
    }
    if (path.endsWith("/deployments")) {
      deploymentCount++;
      return Response.json({ success: true, result: { deployments: [{
        id: mode === "deployment-changed" && deploymentCount > 1 ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        created_on: "2026-11-26T00:00:00Z", versions: [{ version_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", percentage: mode === "split" ? 50 : 100 }],
      }] }, result_info: { total_pages: 1 } });
    }
    if (path.endsWith("/versions/cccccccc-cccc-4ccc-8ccc-cccccccccccc")) return Response.json({ success: true, result: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", annotations: { "workers/message": mode === "wrong-version" ? "e".repeat(40) : input.release },
    } });
    if (path.endsWith("/namespaces")) {
      return Response.json({ success: true, result: [
        { script: "agent-talk-owner-test", class: "PortalStore", id: "owner", use_sqlite: true },
        { script: "agent-talk-test", class: "Mailbox", id: "mailbox", use_sqlite: true },
        { script: "agent-talk-test", class: "Directory", id: "directory", use_sqlite: true },
      ], result_info: { total_pages: 1 } });
    }
    const request = JSON.parse(options.body);
    assert.equal(request.queries.length, 1);
    assert.match(request.queries[0].sql, /^SELECT /);
    assert.equal(request.jurisdiction, "none");
    if (path.includes("/owner/")) assert.deepEqual(request.queries[0].params, [input.agentId, input.deviceId, input.ownerCopyId]);
    if (path.includes("/mailbox/")) assert.deepEqual(request.queries[0].params, [input.agentId, input.offlineMessageId]);
    if (path.includes("/directory/")) assert.deepEqual(request.queries[0].params, [input.groupId, input.groupMessageId, "app"]);
    const field = mode === "leak" && path.includes("/owner/") ? syntheticMarker :
      mode === "binary-key-leak" && path.includes("/owner/") ? Array.from(Buffer.from(syntheticKey, "base64url")) :
      JSON.stringify({ ciphertext: "encrypted-synthetic-data" });
    return Response.json({ success: true, result: { results: [{ columns: ["data"], rows: mode === "empty" ? [] : [[field]], meta: {} }] } });
  };
}

assert.deepEqual(await checkLiveStorage({ ...input, fetcher: fakeFetch("safe") }), { ownerRows: 1, mailboxRows: 1, groupRows: 1 });
await assert.rejects(checkLiveStorage({ ...input, fetcher: fakeFetch("leak") }), /Private test material/);
await assert.rejects(checkLiveStorage({ ...input, fetcher: fakeFetch("empty") }), /exact synthetic/);
await assert.rejects(checkLiveStorage({ ...input, fetcher: fakeFetch("wrong-release") }), /expected release/);
await assert.rejects(checkLiveStorage({ ...input, fetcher: fakeFetch("release-changed") }), /expected release/);
await assert.rejects(checkLiveStorage({ ...input, fetcher: fakeFetch("foreign-owner") }), /ownership marker/);
await assert.rejects(checkLiveStorage({ ...input, fetcher: fakeFetch("binary-key-leak") }), /Private test material/);
await assert.rejects(checkLiveStorage({ ...input, fetcher: fakeFetch("wrong-version") }), /expected commit/);
await assert.rejects(checkLiveStorage({ ...input, fetcher: fakeFetch("deployment-changed") }), /deployment changed/);
await assert.rejects(checkLiveStorage({ ...input, fetcher: fakeFetch("split") }), /one complete version/);
console.log("Live storage checker uses scoped read-only queries and fails on missing or plaintext rows.");
