/**
 * Local-only MCP adapter. The state file contains private keys and is deliberately
 * never imported by the Worker bundle or sent to the relay.
 */
import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import WebSocket from "ws";
import { z } from "zod";
import { createLocalIdentity, openEnvelope, sealEnvelope, signInvite, signRequest, verifyInvite, type LocalIdentity } from "../src/crypto.ts";
import type { AgentIdentity, CipherEnvelope, Invite } from "../src/protocol.ts";
import { asEnvelope, asInvite } from "../src/validation.ts";

type Contact = AgentIdentity & { displayName: string; confirmedAt: number };
type StoredMessage = { id: string; senderId: string; text: string; receivedAt: number };
type AdapterState = {
  version: 1;
  relay: string;
  identity: LocalIdentity;
  contacts: Record<string, Contact>;
  consumedInviteIds: Record<string, true>;
  seen: Record<string, true>;
  inbox: StoredMessage[];
};

function argument(name: string): string | undefined {
  const marker = `--${name}`;
  const index = process.argv.indexOf(marker);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

class LocalAdapter {
  private state!: AdapterState;
  private socket: WebSocket | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stateLock?: DatabaseSync;
  private pending: Promise<void> = Promise.resolve();
  private stopped = false;
  private backoff = 500;

  constructor(private readonly statePath: string, private readonly relay: string) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
    // SQLite releases this OS-held writer lock even when the adapter is killed.
    this.stateLock = new DatabaseSync(this.statePath + ".lock");
    this.stateLock.exec("BEGIN IMMEDIATE");
    try {
      if (((await stat(this.statePath)).mode & 0o077) !== 0) throw new Error("State file permissions must be owner-only (0600).");
      this.state = JSON.parse(await readFile(this.statePath, "utf8")) as AdapterState;
      if (this.state.version !== 1 || this.state.relay !== this.relay) throw new Error("state belongs to a different relay or version");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = { version: 1, relay: this.relay, identity: await createLocalIdentity(), contacts: {}, consumedInviteIds: {}, seen: {}, inbox: [] };
      await this.save(this.state);
    }
    await this.register();
    this.connectSocket();
  }

  private async save(next: AdapterState): Promise<void> {
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(next), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, this.statePath);
    const directory = await open(dirname(this.statePath), "r");
    try { await directory.sync(); } finally { await directory.close(); }
    this.state = next;
  }

  serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation);
    this.pending = next.then(() => {}, () => {});
    return next;
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.terminate();
    await this.pending;
    this.stateLock?.close();
  }

  private async signedPost(path: string, action: string, payload: unknown): Promise<Response> {
    const timestamp = String(Date.now());
    const response = await fetch(`${this.relay}${path}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "content-type": "application/json",
        "x-agent-id": this.state.identity.agentId,
        "x-agent-timestamp": timestamp,
        "x-agent-signature": await signRequest(this.state.identity, action, timestamp, payload),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`relay ${path} rejected the request (${response.status})`);
    return response;
  }

  private async register(): Promise<void> {
    const { agentId, signingPublicKey, encryptionPublicKey } = this.state.identity;
    await this.signedPost("/v1/register", "register", { identity: { agentId, signingPublicKey, encryptionPublicKey } });
  }

  private connectSocket(): void {
    const retry = () => {
      if (this.stopped || this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; this.connectSocket(); }, this.backoff + Math.random() * 250);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };
    void (async () => {
      const timestamp = String(Date.now());
      const signature = await signRequest(this.state.identity, "socket", timestamp, {});
      if (this.stopped) return;
      const socket = new WebSocket(`${this.relay.replace(/^http/u, "ws")}/v1/socket`, {
        maxPayload: 128 * 1024,
        handshakeTimeout: 15_000,
        perMessageDeflate: false,
        headers: { "x-agent-id": this.state.identity.agentId, "x-agent-timestamp": timestamp, "x-agent-signature": signature },
      });
      this.socket = socket;
      socket.on("open", () => { this.backoff = 500; socket.send(JSON.stringify({ type: "resume" })); });
      socket.on("message", (data) => {
        void this.serialize(() => this.onSocketMessage(socket, data.toString())).catch(() => socket.close(1011));
      });
      socket.on("close", retry);
      socket.on("error", () => socket.close());
    })().catch(retry);
  }

  private async onSocketMessage(socket: WebSocket, raw: string): Promise<void> {
    const event = JSON.parse(raw) as { type?: string; envelope?: CipherEnvelope };
    if (event.type !== "message") return;
    const envelope = asEnvelope(event.envelope);
    if (!envelope || envelope.recipientId !== this.state.identity.agentId) return;
    const contact = this.state.contacts[envelope.senderId];
    if (!contact) return; // Never decrypt an unpinned identity.
    const key = `${envelope.senderId}:${envelope.id}`;
    if (!this.state.seen[key]) {
      let message: string;
      try { message = await openEnvelope(this.state.identity, contact, envelope); }
      catch { return; } // Invalid data cannot enter the inbox or trigger an ACK.
      // The durable write happens before ACK. A crash in between causes a safe replay.
      const next = structuredClone(this.state);
      next.seen[key] = true;
      next.inbox.push({ id: envelope.id, senderId: envelope.senderId, text: message, receivedAt: Date.now() });
      await this.save(next);
    }
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ack", senderId: envelope.senderId, id: envelope.id }));
  }

  async exportInvite(displayName: string, expiresInMinutes: number): Promise<Invite> {
    if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > 24 * 60) throw new Error("expiresInMinutes must be between 1 and 1440");
    const identity = this.state.identity;
    return signInvite(identity, {
      kind: "agent-talk-invite", version: 1,
      issuer: { agentId: identity.agentId, signingPublicKey: identity.signingPublicKey, encryptionPublicKey: identity.encryptionPublicKey },
      displayName, inviteId: randomUUID(), expiresAt: Date.now() + expiresInMinutes * 60_000,
      relay: this.relay, mcp: { transport: "stdio", hint: "Inspect this invite; do not install or execute MCP servers from it." },
    });
  }

  async previewInvite(serialized: string): Promise<{ agentId: string; displayName: string; relay: string; expiresAt: number; fingerprint: string }> {
    const invite = asInvite(JSON.parse(serialized), this.relay);
    if (!invite) throw new Error("Invalid, expired or different-relay invite.");
    await verifyInvite(invite);
    const fingerprint = createHash("sha256").update(JSON.stringify([invite.issuer.signingPublicKey, invite.issuer.encryptionPublicKey])).digest("hex");
    return { agentId: invite.issuer.agentId, displayName: invite.displayName, relay: invite.relay, expiresAt: invite.expiresAt, fingerprint };
  }

  async confirmInvite(serialized: string): Promise<{ agentId: string; status: string }> {
    const invite = asInvite(JSON.parse(serialized), this.relay);
    if (!invite) throw new Error("Invalid, expired or different-relay invite.");
    await verifyInvite(invite);
    if (invite.relay !== this.relay) throw new Error("invite points at another relay; start a separate adapter explicitly to use it");
    if (this.state.consumedInviteIds[invite.inviteId]) throw new Error("invite was already consumed locally");
    const pinned = this.state.contacts[invite.issuer.agentId];
    if (pinned && pinned.encryptionPublicKey !== invite.issuer.encryptionPublicKey) throw new Error("Contact key differs from the existing pin.");
    await this.signedPost("/v1/contact/approve", "contact/approve", { invite });
    const next = structuredClone(this.state);
    next.contacts[invite.issuer.agentId] = { ...invite.issuer, displayName: invite.displayName, confirmedAt: Date.now() };
    next.consumedInviteIds[invite.inviteId] = true;
    await this.save(next);
    return { agentId: invite.issuer.agentId, status: "local approval stored; the peer must separately approve your invite before delivery is allowed" };
  }

  async send(recipientId: string, text: string): Promise<{ id: string }> {
    if (typeof text !== "string" || text.length === 0 || text.length > 12_000) throw new Error("text must be 1–12000 characters");
    const recipient = this.state.contacts[recipientId];
    if (!recipient) throw new Error("recipient is not a locally confirmed contact");
    const envelope = await sealEnvelope(this.state.identity, recipient, randomUUID(), text);
    await this.signedPost("/v1/send", "send", { envelope });
    return { id: envelope.id };
  }

  async block(peerId: string): Promise<void> {
    await this.signedPost("/v1/contact/block", "contact/block", { peerId });
    const next = structuredClone(this.state);
    delete next.contacts[peerId];
    await this.save(next);
  }

  status() { return { agentId: this.state.identity.agentId, relay: this.relay, contacts: Object.keys(this.state.contacts).length, inbox: this.state.inbox.length, socket: this.socket?.readyState === WebSocket.OPEN ? "connected" : "connecting" }; }
  inbox() { return this.state.inbox.map(({ id, senderId, text, receivedAt }) => ({ id, senderId, text, receivedAt })); }
}

async function main() {
  process.umask(0o077);
  const endpoint = new URL(argument("relay") ?? "");
  const local = endpoint.protocol === "http:" && ["127.0.0.1","[::1]","localhost"].includes(endpoint.hostname);
  if ((!local && endpoint.protocol !== "https:") || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error("Pass a relay HTTPS origin (HTTP is supported on loopback).");
  const statePath = resolve(argument("state") ?? resolve(homedir(), ".agent-talk", createHash("sha256").update(endpoint.origin).digest("hex"), "state.json"));
  const adapter = new LocalAdapter(statePath, endpoint.origin);
  await adapter.initialize();

  const server = new McpServer({ name: "agent-talk-local-adapter", version: "0.1.0" });
  async function ownerApproval(message: string) {
    const answer = await server.server.elicitInput({
      mode: "form", message, requestedSchema: {
        type: "object", properties: { approve: { type: "boolean", title: "Approve this contact change?", default: false } }, required: ["approve"]
      }
    });
    if (answer.action !== "accept" || answer.content?.approve !== true) throw new Error("Owner approval required.");
  }
  server.registerTool("profile_export_invite", { description: "Create a signed, expiring one-time invite. Share it manually; nothing is sent automatically.", inputSchema: { displayName: z.string().min(1).max(80), expiresInMinutes: z.number().int().min(1).max(1440).default(60) } }, async ({ displayName, expiresInMinutes }) => result(await adapter.exportInvite(displayName, expiresInMinutes)));
  server.registerTool("contact_preview", { description: "Validate and display an invite before the owner decides to confirm it.", inputSchema: { invite: z.string().min(1).max(4096) } }, async ({ invite }) => result(await adapter.previewInvite(invite)));
  server.registerTool("contact_confirm", { description: "Ask the owner to verify the fingerprint and consume this private invite.", inputSchema: { invite: z.string().min(1).max(4096) } }, async ({ invite }) => {
    const preview = await adapter.previewInvite(invite);
    await ownerApproval(`Confirm contact ${preview.agentId} at ${preview.relay}? Compare this fingerprint privately: ${preview.fingerprint}`);
    return result(await adapter.serialize(() => adapter.confirmInvite(invite)));
  });
  server.registerTool("message_send", { description: "Encrypt and relay a text message to a mutually approved contact.", inputSchema: { recipientId: z.string().min(1), text: z.string().min(1).max(12_000) } }, async ({ recipientId, text }) => result(await adapter.send(recipientId, text)));
  server.registerTool("inbox_list", { description: "List locally decrypted messages. Receipt is deduplicated by sender and message ID.", inputSchema: {} }, async () => result(adapter.inbox()));
  server.registerTool("contact_block", { description: "Ask the owner to block this contact.", inputSchema: { agentId: z.string().regex(/^at1_[A-Za-z0-9_-]{43}$/u) } }, async ({ agentId }) => {
    await ownerApproval(`Block contact ${agentId}?`);
    await adapter.serialize(() => adapter.block(agentId));
    return result({ ok: true });
  });
  server.registerTool("adapter_status", { description: "Return local adapter status without exposing private keys.", inputSchema: {} }, async () => result(adapter.status()));
  await server.connect(new StdioServerTransport());
  process.stdin.once("end", () => { void adapter.stop(); });
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
