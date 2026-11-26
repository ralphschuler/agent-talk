import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { it, expect } from "vite-plus/test";
import * as ed from "@noble/ed25519";
import { createLocalIdentity } from "../src/crypto.ts";
import { base64url, fromBase64url, stableJson } from "../src/protocol.ts";
import { groupSigningBytes } from "../src/group-protocol.ts";

it("upgrades retained group history, cursors and byte accounting once across real DO restarts", async () => {
  const directory = env.DIRECTORY.getByName("legacy-group-test-" + crypto.randomUUID());
  const [identity, idle] = await Promise.all([createLocalIdentity(), createLocalIdentity()]);
  const actor = identity.agentId,
    group = crypto.randomUUID(),
    closed = crypto.randomUUID();
  const origin = "https://agent-talk.test",
    wrong = "https://other.example";
  const body = {
    kind: "app",
    wire: "AQ",
    relay: origin,
    groupId: group,
    id: crypto.randomUUID(),
    actor,
    epoch: 0,
  };
  const event = {
    ...body,
    signature: base64url(
      await ed.signAsync(groupSigningBytes(body), fromBase64url(identity.signingSecretKey)),
    ),
  };
  const encoded = stableJson(event);
  const seed = Date.now();
  await runInDurableObject(directory, (_, state) =>
    state.storage.transactionSync(() => {
      // This isolated object represents the oldest development schema, including its actual column order.
      const sql = state.storage.sql;
      sql.exec(`DROP TRIGGER g_charge; DROP TRIGGER g_resize; DROP TRIGGER g_release;
      DROP TABLE g_usage; DELETE FROM g_migrations;
      ALTER TABLE g_groups DROP COLUMN entries;
      ALTER TABLE g_clients DROP COLUMN origin;
      ALTER TABLE g_log DROP COLUMN kind;
      ALTER TABLE g_log DROP COLUMN size;`);
      sql.exec("INSERT INTO g_groups VALUES (?,?,0,0),(?,?,1,1)", group, actor, closed, actor);
      sql.exec("INSERT INTO g_members VALUES (?,?,0),(?,?,0)", group, actor, closed, actor);
      sql.exec("INSERT INTO g_clients VALUES (?,2,1),(?,1,1)", actor, idle.agentId);
      // Acknowledged tombstone, undelivered application and a closed stream.
      sql.exec(
        "INSERT INTO g_log(seq,gid,agent,opid,digest,payload,welcome,joiner) VALUES (1,?,?,?,'first',NULL,NULL,NULL)",
        group,
        actor,
        crypto.randomUUID(),
      );
      sql.exec(
        "INSERT INTO g_log(seq,gid,agent,opid,digest,payload,welcome,joiner) VALUES (2,?,?,?,'second',?,NULL,NULL)",
        group,
        actor,
        body.id,
        encoded,
      );
      sql.exec(
        "INSERT INTO g_log(seq,gid,agent,opid,digest,payload,welcome,joiner) VALUES (3,?,?,?,'last',NULL,NULL,NULL)",
        closed,
        actor,
        crypto.randomUUID(),
      );
      sql.exec("INSERT INTO g_feed VALUES (?,2)", actor);
    }),
  );
  await evictDurableObject(directory);
  const call = async (action: string, agent: string, relay: string, payload: object) => {
    const response = await directory.fetch("https://internal/group/" + action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: agent, origin: relay, payload }),
    });
    return {
      status: response.status,
      body: (await response.json()) as { events?: { seq: number; op: unknown }[] },
    };
  };
  expect((await call("sync", actor, wrong, { after: 1 })).status).toBe(403);
  const replay = await call("sync", actor, origin, { after: 1 });
  expect(replay.status).toBe(200);
  expect(replay.body.events).toEqual([{ seq: 2, op: event }]);
  // No origin can be inferred for the entirely acknowledged legacy client.
  expect((await call("ack", idle.agentId, wrong, { through: 1 })).status).toBe(409);
  expect((await call("sync", idle.agentId, origin, { after: 1 })).status).toBe(200);
  expect((await call("sync", idle.agentId, wrong, { after: 1 })).status).toBe(403);
  const snapshot = () =>
    runInDurableObject(directory, (_, state) => {
      const sql = state.storage.sql;
      return {
        live: sql.exec("SELECT epoch,entries,closed FROM g_groups WHERE id=?", group).one(),
        closed: sql.exec("SELECT epoch,entries,closed FROM g_groups WHERE id=?", closed).one(),
        usage: sql.exec("SELECT bytes FROM g_usage").one().bytes,
        ops: sql.exec("SELECT seq,opid,digest FROM g_log ORDER BY seq").toArray(),
        memberCount: sql.exec("SELECT COUNT(*) AS n FROM g_members").one().n,
        feed: sql.exec("SELECT seq FROM g_feed WHERE agent=?", actor).toArray(),
        cursor: sql.exec("SELECT offered,acked,origin FROM g_clients WHERE agent=?", actor).one(),
      };
    });
  const first = await snapshot();
  expect(first.live).toEqual({ epoch: 0, entries: 2, closed: 0 });
  expect(first.closed.epoch).toBe(1);
  expect(first.closed.entries).toBe(1);
  expect(Number(first.closed.closed)).toBeGreaterThanOrEqual(seed);
  expect(first.usage).toBe(new TextEncoder().encode(encoded).byteLength);
  expect(first.memberCount).toBe(2);
  expect(first.ops.map((r) => r.digest)).toEqual(["first", "second", "last"]);
  expect(first.feed).toEqual([{ seq: 2 }]);
  expect(first.cursor).toEqual({ offered: 2, acked: 1, origin });
  await evictDurableObject(directory);
  expect(await snapshot()).toEqual(first);
  expect((await call("ack", actor, origin, { through: 2 })).status).toBe(200);
  const last = await snapshot();
  expect(last.usage).toBe(0);
  expect(last.feed).toEqual([]);
  expect(last.ops).toEqual(first.ops);
}, 90_000);
