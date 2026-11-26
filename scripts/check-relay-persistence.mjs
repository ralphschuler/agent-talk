// Only the loopback runner supplies this fresh, private Miniflare directory.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decodeGroupState } from "ts-mls/clientState.js";

async function* databases(directory) {
  const stat = await lstat(directory);
  assert.ok(stat.isDirectory() && stat.uid === process.getuid(), "Expected own test directory");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* databases(path);
    if (entry.isFile() && entry.name.endsWith(".sqlite")) yield path;
  }
}

function inspect(value, needles) {
  if (value == null) return;
  if (typeof value === "object" && !ArrayBuffer.isView(value)) {
    for (const part of Object.values(value)) inspect(part, needles);
    return;
  }
  const raw = typeof value === "string" ? Buffer.from(value) : value;
  if (!(raw instanceof Uint8Array)) return;
  const check = (bytes) => {
    assert.ok(
      !needles.some((needle) => bytes.includes(needle)),
      "A private sample appeared in relay storage",
    );
  };
  check(Buffer.from(raw));
  if (typeof value !== "string") return;
  if (value.startsWith("{") || value.startsWith("[")) {
    let decoded;
    try {
      decoded = JSON.parse(value);
    } catch {
      return;
    }
    inspect(decoded, needles);
  } else if (/^[A-Za-z0-9_-]+$/.test(value)) {
    check(Buffer.from(value, "base64url"));
  }
}

export async function checkRelayPersistence({
  relay,
  storage,
  storageMarker,
  groupId,
  sender,
  recipient,
  id,
  sent,
  name,
  text,
  joinKeys,
  endpointStates,
}) {
  assert.equal(new URL(relay).hostname, "127.0.0.1");
  assert.equal(await realpath(dirname(storage)), await realpath(tmpdir()));
  assert.match(basename(storage), /^agent-talk-relay-test-[A-Za-z0-9]+$/);
  const stat = await lstat(storage);
  assert.ok(stat.isDirectory() && stat.uid === process.getuid() && !(stat.mode & 0o077));
  assert.ok(storageMarker && (await readFile(join(storage, "owner"), "utf8")) === storageMarker);

  const keys = joinKeys.map((key) => Buffer.from(key, "base64url"));
  assert.equal(keys.length, 2);
  for (const state of endpointStates) {
    keys.push(
      ...[state.identity.signingSecretKey, state.identity.encryptionSecretKey].map((key) =>
        Buffer.from(key, "base64url"),
      ),
    );
  }
  const snapshot = Buffer.from(endpointStates[0].groups.groups[groupId].mls, "base64url");
  const [mls, offset] = decodeGroupState(snapshot, 0);
  assert.equal(offset, snapshot.length);
  keys.push(
    ...[
      mls.keySchedule.membershipKey,
      mls.keySchedule.senderDataSecret,
      mls.keySchedule.initSecret,
    ].map((bytes) => Buffer.from(bytes)),
  );
  assert.ok(
    keys.every((key) => key.length === 32),
    "Expected full-size endpoint keys",
  );
  const needles = [Buffer.from(name), Buffer.from(text)];
  for (const bytes of keys) {
    needles.push(
      bytes,
      ...["base64url", "base64", "hex"].map((format) => Buffer.from(bytes.toString(format))),
    );
  }

  let matches = 0;
  let rows = 0;
  for await (const file of databases(join(storage, "state"))) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all();
      if (tables.some((table) => table.name === "g_log")) {
        const stored = db
          .prepare(`SELECT l.payload FROM g_log l JOIN g_feed f ON f.seq=l.seq
          WHERE l.gid=? AND l.agent=? AND l.opid=? AND l.kind='app' AND f.agent=?`)
          .all(groupId, sender, id, recipient);
        for (const { payload } of stored) {
          const op = JSON.parse(payload);
          assert.ok(
            op.id === sent.id && op.id === id && op.groupId === groupId && op.actor === sender,
          );
          const wire = Buffer.from(op.wire, "base64url");
          assert.ok(
            wire.length > 32 && createHash("sha256").update(wire).digest("hex") === sent.digest,
            "Stored MLS bytes differ from sender's submission",
          );
          matches++;
        }
      }
      for (const table of tables) {
        const quoted = '"' + table.name.replaceAll('"', '""') + '"';
        const select = db.prepare("SELECT * FROM " + quoted);
        select.setReadBigInts(true);
        for (const row of select.iterate()) {
          inspect(row, needles);
          rows++;
        }
      }
    } finally {
      db.close();
    }
  }
  assert.equal(
    matches,
    1,
    "Expected the exact outbound ciphertext pending for the offline recipient",
  );
  console.log(
    "PASS: matched the pending MLS ciphertext in Directory SQLite and checked " +
      rows +
      " disposable relay rows against the private label, message and " +
      keys.length +
      " endpoint key samples.",
  );
}
