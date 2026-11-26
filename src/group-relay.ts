import { base64url, stableJson } from "./protocol.ts";
import {
  GROUP_CAPACITY_REJECTION,
  GROUP_PAGE_SIZE,
  MAX_GROUP_MEMBERS,
  digestGroupWire,
  verifyGroupSignature,
  type GroupEvent,
  type GroupOp,
} from "./group-protocol.ts";
import { DAY } from "./validation.ts";

const MAX_GROUPS = 128;
const MAX_FOUNDER_GROUPS = 8;
const MAX_RECENT_GROUPS_PER_FOUNDER = 32;
const MAX_TRACKED_GROUPS = 1024;
const CLOSED_RETENTION = 30 * DAY;
const MAX_ENTRIES_PER_GROUP = 4096;
const MAX_PENDING_PER_AGENT = 256;
const CONTROL_RESERVE = 2 * MAX_GROUP_MEMBERS + 1;
const MAX_PENDING_BYTES = 48 * 1024 * 1024;

class Rejected extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
// Thrown exclusively inside the append transaction; it reaches handle only after SQLite rollback.
class CapacityRejected extends Error {
  constructor(
    readonly op: GroupOp,
    message: string,
  ) {
    super(message);
  }
}
function requireCapacity(condition: unknown, op: GroupOp, message: string): asserts condition {
  if (!condition) throw new CapacityRejected(op, message);
}
function requireGroup(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new Rejected(status, message);
}
function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
type GroupRow = { owner: string; epoch: number; closed: number; entries: number };
type Member = { agent: string; leaving: number };

export class GroupDelivery {
  private readonly sql: SqlStorage;
  private flushing = false;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly mailbox: DurableObjectNamespace,
  ) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS g_groups (id TEXT PRIMARY KEY, owner TEXT NOT NULL, epoch INTEGER NOT NULL, closed INTEGER NOT NULL, entries INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS g_members (gid TEXT NOT NULL, agent TEXT NOT NULL, leaving INTEGER NOT NULL, PRIMARY KEY(gid,agent));
      CREATE TABLE IF NOT EXISTS g_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, gid TEXT NOT NULL, agent TEXT NOT NULL, opid TEXT NOT NULL, digest TEXT NOT NULL,
        kind TEXT NOT NULL, payload TEXT, welcome TEXT, joiner TEXT, size INTEGER NOT NULL, UNIQUE(agent,opid));
      CREATE INDEX IF NOT EXISTS g_log_group ON g_log(gid);
      CREATE TABLE IF NOT EXISTS g_usage (singleton INTEGER PRIMARY KEY CHECK(singleton=1), bytes INTEGER NOT NULL);
      INSERT OR IGNORE INTO g_usage VALUES (1,0);
      CREATE TABLE IF NOT EXISTS g_feed (agent TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY(agent,seq));
      CREATE INDEX IF NOT EXISTS g_feed_seq ON g_feed(seq);
      CREATE TABLE IF NOT EXISTS g_clients (agent TEXT PRIMARY KEY, origin TEXT NOT NULL, offered INTEGER NOT NULL, acked INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS g_grants (gid TEXT NOT NULL, id TEXT NOT NULL, signature TEXT NOT NULL, PRIMARY KEY(gid,id));
      CREATE TABLE IF NOT EXISTS g_wakes (agent TEXT PRIMARY KEY, seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS g_migrations (version INTEGER PRIMARY KEY);
    `);
    if (!this.sql.exec("SELECT 1 FROM g_migrations WHERE version=1").toArray().length) {
      ctx.storage.transactionSync(() => {
        const has = (table: string, name: string) =>
          this.sql
            .exec(`PRAGMA table_info(${table})`)
            .toArray()
            .some((row) => row.name === name);
        if (!has("g_groups", "entries"))
          this.sql.exec("ALTER TABLE g_groups ADD COLUMN entries INTEGER NOT NULL DEFAULT 0");
        if (!has("g_groups", "closed"))
          this.sql.exec("ALTER TABLE g_groups ADD COLUMN closed INTEGER NOT NULL DEFAULT 0");
        if (!has("g_clients", "origin"))
          this.sql.exec("ALTER TABLE g_clients ADD COLUMN origin TEXT");
        if (!has("g_log", "kind")) {
          this.sql.exec("ALTER TABLE g_log ADD COLUMN kind TEXT NOT NULL DEFAULT ''");
          this.sql.exec(
            "UPDATE g_log SET kind=COALESCE(json_extract(payload,'$.kind'),'') WHERE payload IS NOT NULL",
          );
        }
        if (!has("g_log", "size"))
          this.sql.exec("ALTER TABLE g_log ADD COLUMN size INTEGER NOT NULL DEFAULT 0");
        this.sql.exec(
          "UPDATE g_groups SET entries=(SELECT COUNT(*) FROM g_log WHERE gid=g_groups.id)",
        );
        // Earliest builds stored a close flag but no timestamp. Give those streams the full grace period.
        this.sql.exec(
          `UPDATE g_groups SET closed=? WHERE closed=1 OR (closed=0 AND EXISTS
          (SELECT 1 FROM g_log WHERE gid=g_groups.id AND kind='close'))`,
          Date.now(),
        );
        this.sql.exec(
          `UPDATE g_log SET size=COALESCE(length(CAST(payload AS BLOB)),0)+COALESCE(length(CAST(welcome AS BLOB)),0)`,
        );
        this.sql.exec(
          "UPDATE g_usage SET bytes=(SELECT COALESCE(SUM(size),0) FROM g_log) WHERE singleton=1",
        );
        this.sql.exec(`
      CREATE INDEX IF NOT EXISTS g_groups_closed ON g_groups(closed);
      CREATE INDEX IF NOT EXISTS g_groups_owner ON g_groups(owner,closed);
      CREATE TRIGGER IF NOT EXISTS g_charge AFTER INSERT ON g_log BEGIN
        UPDATE g_usage SET bytes=bytes+NEW.size WHERE singleton=1;
      END;
      CREATE TRIGGER IF NOT EXISTS g_resize AFTER UPDATE OF size ON g_log WHEN OLD.size<>NEW.size BEGIN
        UPDATE g_usage SET bytes=bytes-OLD.size+NEW.size WHERE singleton=1;
      END;
      CREATE TRIGGER IF NOT EXISTS g_release AFTER DELETE ON g_log WHEN OLD.size>0 BEGIN
        UPDATE g_usage SET bytes=bytes-OLD.size WHERE singleton=1;
      END;
        `);
        this.sql.exec("INSERT INTO g_migrations VALUES (1)");
      });
    }
    // An older closed group may have no outstanding notification and no alarm.
    const [next] = this.sql
      .exec("SELECT closed FROM g_groups WHERE closed>0 ORDER BY closed LIMIT 1")
      .toArray();
    if (next)
      void ctx.blockConcurrencyWhile(() =>
        this.scheduleBy(Math.max(Date.now() + 1000, Number(next.closed) + CLOSED_RETENTION)),
      );
  }

  async handle(
    path: string,
    actor: string,
    body: Record<string, unknown>,
    origin: string,
  ): Promise<Response> {
    try {
      this.checkOrigin(actor, origin, path === "group/sync");
      if (path === "group/sync") return this.sync(actor, Number(body.after));
      if (path === "group/ack") return this.ack(actor, Number(body.through));
      const op = body.op as GroupOp;
      requireGroup(
        op.actor === actor && (await verifyGroupSignature(op)),
        403,
        "Invalid group operation signature",
      );
      if (op.kind === "add") {
        const { consent, permit } = op;
        requireGroup(
          (await verifyGroupSignature(consent)) && (await verifyGroupSignature(consent.invite)),
          403,
          "Invalid signed admission",
        );
        requireGroup(
          op.welcomeHash === (await digestGroupWire(body.welcome as string)),
          400,
          "Welcome digest mismatch",
        );
        if (permit)
          requireGroup(await verifyGroupSignature(permit), 403, "Invalid delegate permit");
      } else if (op.kind === "remove" && op.permit) {
        requireGroup(await verifyGroupSignature(op.permit), 403, "Invalid delegate permit");
      }
      const encoded = stableJson(op);
      const digest = base64url(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded))),
      );
      // Arm recovery before committing delivery intents; a crash after commit cannot lose the wake.
      await this.scheduleBy(Date.now() + 10_000);
      const seq = this.ctx.storage.transactionSync(() =>
        this.append(op, encoded, digest, body.welcome as string | undefined),
      );
      this.ctx.waitUntil(this.flushWakes());
      return json({ seq });
    } catch (error) {
      if (error instanceof CapacityRejected) {
        const { id, groupId, actor } = error.op;
        return json(
          { error: error.message, code: GROUP_CAPACITY_REJECTION, operationId: id, groupId, actor },
          429,
        );
      }
      if (error instanceof Rejected) return json({ error: error.message }, error.status);
      throw error;
    }
  }

  private checkOrigin(actor: string, origin: string, authenticatedSync = false) {
    const [existing] = this.sql.exec("SELECT origin FROM g_clients WHERE agent=?", actor).toArray();
    if (!existing) return;
    if (existing.origin) {
      requireGroup(
        existing.origin === origin,
        403,
        "Group identity belongs to a different relay origin",
      );
      return;
    }
    // Historical cursors lacked an origin. Recover the realm from previously authenticated
    // operations before exposing their feed. Contradictory evidence must fail closed.
    const realms = this.sql
      .exec(
        `WITH relevant(seq) AS (
      SELECT seq FROM g_feed WHERE agent=? UNION SELECT seq FROM g_log WHERE agent=?
      UNION SELECT l.seq FROM g_members m JOIN g_log l ON m.gid=l.gid WHERE m.agent=?
    ) SELECT DISTINCT json_extract(l.payload,'$.relay') AS origin FROM relevant r JOIN g_log l ON l.seq=r.seq
      WHERE l.payload IS NOT NULL LIMIT 2`,
        actor,
        actor,
        actor,
      )
      .toArray();
    requireGroup(
      realms.length === 0 || (realms.length === 1 && realms[0].origin === origin),
      403,
      "Legacy group identity belongs to a different or ambiguous relay origin",
    );
    // Another member's submission must never select a legacy recipient's realm for them.
    requireGroup(
      realms.length > 0 || authenticatedSync,
      409,
      "Legacy group identity must sync to claim its original realm",
    );
    this.sql.exec("UPDATE g_clients SET origin=? WHERE agent=? AND origin IS NULL", origin, actor);
  }

  private append(op: GroupOp, encoded: string, digest: string, welcome?: string): number {
    const [prior] = this.sql
      .exec("SELECT seq,digest FROM g_log WHERE agent=? AND opid=?", op.actor, op.id)
      .toArray();
    if (prior) {
      requireGroup(
        prior.digest === digest,
        409,
        "Operation ID already used with different content",
      );
      return Number(prior.seq);
    }
    const [group] = this.sql
      .exec<GroupRow>("SELECT owner,epoch,closed,entries FROM g_groups WHERE id=?", op.groupId)
      .toArray();
    let recipients: string[];
    if (op.kind === "create") {
      requireGroup(!group && op.epoch === 0, 409, "Group already exists or invalid initial epoch");
      requireGroup(
        this.sql
          .exec(
            `SELECT 1 FROM approvals a JOIN approvals b ON a.owner_id=b.peer_id AND a.peer_id=b.owner_id
        WHERE a.owner_id=? AND NOT EXISTS(SELECT 1 FROM blocks WHERE owner_id=a.owner_id AND peer_id=a.peer_id)
        AND NOT EXISTS(SELECT 1 FROM blocks WHERE owner_id=a.peer_id AND peer_id=a.owner_id) LIMIT 1`,
            op.actor,
          )
          .toArray().length,
        403,
        "Group creation requires a mutually approved contact",
      );
      const own = this.sql
        .exec(
          "SELECT COUNT(*) AS total,COUNT(CASE WHEN closed=0 THEN 1 END) AS active FROM g_groups WHERE owner=?",
          op.actor,
        )
        .one();
      requireCapacity(
        Number(own.active) < MAX_FOUNDER_GROUPS &&
          Number(own.total) < MAX_RECENT_GROUPS_PER_FOUNDER,
        op,
        "Founder group capacity reached",
      );
      const all = this.sql
        .exec(
          "SELECT COUNT(*) AS total,COUNT(CASE WHEN closed=0 THEN 1 END) AS active FROM g_groups",
        )
        .one();
      requireCapacity(
        Number(all.active) < MAX_GROUPS && Number(all.total) < MAX_TRACKED_GROUPS,
        op,
        "Pilot group capacity reached",
      );
      this.sql.exec(
        "INSERT INTO g_groups (id,owner,epoch,closed,entries) VALUES (?,?,0,0,0)",
        op.groupId,
        op.actor,
      );
      this.sql.exec("INSERT INTO g_members VALUES (?,?,0)", op.groupId, op.actor);
      recipients = [op.actor];
    } else {
      requireGroup(group && !group.closed, 403, "Group unavailable");
      const members = this.sql
        .exec<Member>("SELECT agent,leaving FROM g_members WHERE gid=? ORDER BY agent", op.groupId)
        .toArray();
      const caller = members.find((m) => m.agent === op.actor);
      requireGroup(caller, 403, "Group unavailable");
      requireGroup(op.epoch === group.epoch, 409, "Stale group epoch");
      recipients = members.map((m) => m.agent);
      this.authorize(op, group, members, recipients);
      if (op.kind === "add") recipients.push(op.target);
    }
    const control = op.kind === "remove" || op.kind === "leave" || op.kind === "close";
    const reserve = control ? 0 : CONTROL_RESERVE;
    const count = Number(group?.entries ?? 0);
    requireCapacity(count < MAX_ENTRIES_PER_GROUP - reserve, op, "Group history capacity reached");
    const pending = Number(
      this.sql.exec("SELECT bytes FROM g_usage WHERE singleton=1").one().bytes,
    );
    const size = encoded.length + (welcome?.length ?? 0);
    requireCapacity(
      pending + size <= MAX_PENDING_BYTES + (control ? 2 * 1024 * 1024 : 0),
      op,
      "Group delivery storage full",
    );
    for (const agent of recipients) {
      this.checkOrigin(agent, op.relay);
      const n = this.sql.exec("SELECT COUNT(*) AS n FROM g_feed WHERE agent=?", agent).one().n;
      requireCapacity(
        Number(n) < MAX_PENDING_PER_AGENT - reserve,
        op,
        "Recipient group stream full",
      );
    }
    this.sql.exec("UPDATE g_groups SET entries=entries+1 WHERE id=?", op.groupId);
    const seq = Number(
      this.sql
        .exec(
          `INSERT INTO g_log(gid,agent,opid,digest,kind,payload,welcome,joiner,size)
      VALUES(?,?,?,?,?,?,?,?,?) RETURNING seq`,
          op.groupId,
          op.actor,
          op.id,
          digest,
          op.kind,
          encoded,
          welcome ?? null,
          op.kind === "add" ? op.target : null,
          size,
        )
        .one().seq,
    );
    for (const agent of recipients) {
      this.sql.exec(
        "INSERT OR IGNORE INTO g_clients (agent,origin,offered,acked) VALUES (?,?,0,0)",
        agent,
        op.relay,
      );
      this.sql.exec("INSERT INTO g_feed VALUES (?,?)", agent, seq);
      this.sql.exec(
        "INSERT INTO g_wakes VALUES (?,?) ON CONFLICT(agent) DO UPDATE SET seq=excluded.seq",
        agent,
        seq,
      );
    }
    return seq;
  }

  private authorize(
    op: Exclude<GroupOp, { kind: "create" }>,
    group: GroupRow,
    members: Member[],
    roster: string[],
  ) {
    const founder = op.actor === group.owner;
    const frozen = members.some((m) => m.leaving);
    const isBlocked = (a: string, b: string) =>
      Boolean(
        this.sql
          .exec(
            "SELECT 1 FROM blocks WHERE (owner_id=? AND peer_id=?) OR (owner_id=? AND peer_id=?) LIMIT 1",
            a,
            b,
            b,
            a,
          )
          .toArray().length,
      );
    if (op.kind === "app" || op.kind === "add") {
      requireGroup(!frozen, 409, "Group is waiting for a departure rekey");
      for (let i = 0; i < roster.length; i++)
        for (let j = i + 1; j < roster.length; j++) {
          requireGroup(!isBlocked(roster[i], roster[j]), 403, "Group has a blocked relationship");
        }
    }
    if (op.kind === "app") return;
    if (op.kind === "close") {
      requireGroup(founder, 403, "Only the founder can close the group");
      this.sql.exec("UPDATE g_groups SET closed=? WHERE id=?", Date.now(), op.groupId);
      this.sql.exec("DELETE FROM g_grants WHERE gid=?", op.groupId);
      return;
    }
    if (op.kind === "leave") {
      requireGroup(
        !founder && !members.find((m) => m.agent === op.actor)?.leaving,
        409,
        "Departure unavailable",
      );
      this.sql.exec("UPDATE g_members SET leaving=1 WHERE gid=? AND agent=?", op.groupId, op.actor);
      return;
    }
    if (op.kind === "grant") {
      requireGroup(
        founder &&
          op.delegate !== group.owner &&
          op.target !== group.owner &&
          op.delegate !== op.target &&
          members.some((m) => m.agent === op.delegate && !m.leaving),
        403,
        "Invalid delegate or target",
      );
      requireGroup(
        op.action === "add" ? !frozen && !roster.includes(op.target) : roster.includes(op.target),
        409,
        "Invalid permit for current roster",
      );
      this.sql.exec("INSERT INTO g_grants VALUES (?,?,?)", op.groupId, op.id, op.signature);
      return;
    }
    if (op.kind === "revoke") {
      requireGroup(founder, 403, "Only the founder can revoke permits");
      requireGroup(
        this.sql
          .exec("DELETE FROM g_grants WHERE gid=? AND id=? RETURNING id", op.groupId, op.permitId)
          .toArray().length,
        409,
        "Unknown or revoked permit",
      );
      return;
    }
    if (founder) requireGroup(op.permit === null, 400, "Unexpected permit for founder");
    else {
      const permit = op.permit;
      requireGroup(
        permit &&
          permit.actor === group.owner &&
          permit.groupId === op.groupId &&
          permit.epoch === group.epoch &&
          permit.action === op.kind &&
          permit.delegate === op.actor &&
          permit.target === op.target &&
          !members.find((m) => m.agent === op.actor)?.leaving,
        403,
        "Membership change requires an exact founder permit",
      );
      const [stored] = this.sql
        .exec("SELECT signature FROM g_grants WHERE gid=? AND id=?", op.groupId, permit.id)
        .toArray();
      requireGroup(stored?.signature === permit.signature, 403, "Unknown or revoked permit");
    }
    if (op.kind === "add") {
      const { consent } = op,
        invite = consent.invite;
      requireGroup(
        !roster.includes(op.target) && roster.length < MAX_GROUP_MEMBERS,
        409,
        "Invalid group admission",
      );
      requireGroup(
        consent.actor === op.target &&
          consent.groupId === op.groupId &&
          consent.epoch === group.epoch &&
          invite.actor === op.actor &&
          invite.owner === group.owner &&
          invite.target === op.target &&
          invite.groupId === op.groupId &&
          invite.epoch === group.epoch &&
          stableJson(invite.permit) === stableJson(op.permit) &&
          stableJson(invite.members) === stableJson(roster),
        403,
        "Consent does not match the proposed membership",
      );
      const now = Date.now();
      requireGroup(
        invite.expiresAt > now && invite.expiresAt <= now + DAY + 300_000,
        403,
        "Invite outside its admission window",
      );
      const approved = this.sql
        .exec(
          "SELECT 1 FROM approvals WHERE (owner_id=? AND peer_id=?) OR (owner_id=? AND peer_id=?)",
          op.actor,
          op.target,
          op.target,
          op.actor,
        )
        .toArray();
      requireGroup(
        approved.length === 2 && roster.every((a) => !isBlocked(a, op.target)),
        403,
        "Admission requires approved contacts and no blocks",
      );
      this.sql.exec("INSERT INTO g_members VALUES (?,?,0)", op.groupId, op.target);
    } else {
      requireGroup(
        op.target !== group.owner && op.target !== op.actor && roster.includes(op.target),
        403,
        "Invalid removal target",
      );
      this.sql.exec("DELETE FROM g_members WHERE gid=? AND agent=?", op.groupId, op.target);
    }
    this.sql.exec("UPDATE g_groups SET epoch=epoch+1 WHERE id=?", op.groupId);
    this.sql.exec("DELETE FROM g_grants WHERE gid=?", op.groupId);
  }

  private sync(actor: string, after: number): Response {
    const [client] = this.sql
      .exec("SELECT offered,acked FROM g_clients WHERE agent=?", actor)
      .toArray();
    requireGroup(
      after >= Number(client?.acked ?? 0) && after <= Number(client?.offered ?? 0),
      409,
      "Group cursor outside acknowledged stream",
    );
    const rows = this.sql
      .exec(
        `SELECT l.seq,l.payload,l.joiner,l.welcome FROM g_feed f JOIN g_log l ON l.seq=f.seq
      WHERE f.agent=? AND f.seq>? ORDER BY f.seq LIMIT ?`,
        actor,
        after,
        GROUP_PAGE_SIZE + 1,
      )
      .toArray();
    const events: GroupEvent[] = rows.slice(0, GROUP_PAGE_SIZE).map((row) => ({
      seq: Number(row.seq),
      op: JSON.parse(String(row.payload)),
      ...(row.joiner === actor ? { welcome: String(row.welcome) } : {}),
    }));
    if (events.length)
      this.sql.exec(
        "UPDATE g_clients SET offered=MAX(offered,?) WHERE agent=?",
        events[events.length - 1].seq,
        actor,
      );
    return json({ events, more: rows.length > GROUP_PAGE_SIZE });
  }

  private ack(actor: string, through: number): Response {
    const [client] = this.sql
      .exec("SELECT offered,acked FROM g_clients WHERE agent=?", actor)
      .toArray();
    if (through <= Number(client?.acked ?? 0)) return json({ ok: true });
    requireGroup(client && through <= Number(client.offered), 409, "Unissued group cursor");
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE g_log SET payload=NULL,welcome=NULL,size=0 WHERE seq IN (
        SELECT f.seq FROM g_feed f WHERE f.agent=? AND f.seq<=? AND NOT EXISTS
        (SELECT 1 FROM g_feed other WHERE other.seq=f.seq AND other.agent<>f.agent))`,
        actor,
        through,
      );
      this.sql.exec(
        "UPDATE g_log SET size=size-length(welcome),welcome=NULL WHERE welcome IS NOT NULL AND joiner=? AND seq IN (SELECT seq FROM g_feed WHERE agent=? AND seq<=?)",
        actor,
        actor,
        through,
      );
      this.sql.exec("DELETE FROM g_feed WHERE agent=? AND seq<=?", actor, through);
      this.sql.exec("UPDATE g_clients SET acked=? WHERE agent=?", through, actor);
    });
    return json({ ok: true });
  }

  block(a: string, b: string) {
    // Global stream numbers need not be contiguous. Preserve administration and rekey commits.
    for (const [recipient, sender] of [
      [a, b],
      [b, a],
    ]) {
      this.sql.exec(
        `DELETE FROM g_feed WHERE agent=? AND seq IN
        (SELECT seq FROM g_log WHERE agent=? AND kind='app' AND payload IS NOT NULL)`,
        recipient,
        sender,
      );
    }
    this.sql.exec(
      `UPDATE g_log SET payload=NULL,welcome=NULL,size=0 WHERE kind='app' AND payload IS NOT NULL
      AND agent IN (?,?) AND NOT EXISTS (SELECT 1 FROM g_feed WHERE g_feed.seq=g_log.seq)`,
      a,
      b,
    );
  }

  private async scheduleBy(deadline: number) {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > deadline) await this.ctx.storage.setAlarm(deadline);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    // Bound work per alarm, including historical operation IDs. Active group cursors remain untouched.
    const expired = this.sql
      .exec(
        "SELECT id FROM g_groups WHERE closed>0 AND closed<=? ORDER BY closed LIMIT 2",
        now - CLOSED_RETENTION,
      )
      .toArray();
    for (const row of expired)
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "DELETE FROM g_feed WHERE seq IN (SELECT seq FROM g_log WHERE gid=?)",
          row.id,
        );
        this.sql.exec("DELETE FROM g_log WHERE gid=?", row.id);
        this.sql.exec("DELETE FROM g_members WHERE gid=?", row.id);
        this.sql.exec("DELETE FROM g_grants WHERE gid=?", row.id);
        this.sql.exec("DELETE FROM g_groups WHERE id=?", row.id);
      });
    await this.flushWakes();
    const [next] = this.sql
      .exec("SELECT closed FROM g_groups WHERE closed>0 ORDER BY closed LIMIT 1")
      .toArray();
    if (next) await this.scheduleBy(Math.max(now + 1000, Number(next.closed) + CLOSED_RETENTION));
  }

  async flushWakes(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (let batch = 0; batch < 4; batch++) {
        const entries = this.sql
          .exec("SELECT agent,seq FROM g_wakes ORDER BY seq,agent LIMIT 8")
          .toArray();
        if (!entries.length) return;
        // The next attempt is durable even if execution stops after an individual socket push.
        await this.ctx.storage.setAlarm(Date.now() + 30_000);
        const results = await Promise.all(
          entries.map(async (row) => {
            try {
              const response = await this.mailbox
                .getByName(String(row.agent))
                .fetch("https://internal/group-wake", { method: "POST" });
              if (response.status !== 204) return false;
              this.sql.exec("DELETE FROM g_wakes WHERE agent=? AND seq=?", row.agent, row.seq);
              return true;
            } catch {
              return false;
            }
          }),
        );
        if (results.includes(false)) return;
      }
      if (this.sql.exec("SELECT 1 FROM g_wakes LIMIT 1").toArray().length)
        await this.ctx.storage.setAlarm(Date.now() + 1000);
    } finally {
      this.flushing = false;
    }
  }
}
