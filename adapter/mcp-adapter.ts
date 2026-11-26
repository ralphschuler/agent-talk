/**
 * Local-only MCP adapter. The state file contains private keys and is deliberately
 * never imported by the Worker bundle or sent to the relay.
 */
import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import WebSocket from "ws";
import { z } from "zod";
import { createLocalIdentity, openEnvelope, sealEnvelope, signInvite, signRequest, verifyInvite, type LocalIdentity } from "../src/crypto.ts";
import type { AgentIdentity, CipherEnvelope, Invite } from "../src/protocol.ts";

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

  constructor(private readonly statePath: string, private readonly relay: string) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
    try {
      this.state = JSON.parse(await readFile(this.statePath, "utf8")) as AdapterState;
      if (this.state.version !== 1 || this.state.relay !== this.relay) throw new Error("state belongs to a different relay or version");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = { version: 1, relay: this.relay, identity: await createLocalIdentity(), contacts: {}, consumedInviteIds: {}, seen: {}, inbox: [] };
      await this.save();
    }
    await this.register();
    this.connectSocket();
  }

  private async save(): Promise<void> {
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.statePath);
    await chmod(this.statePath, 0o600);
  }

  private async signedPost(path: string, action: string, payload: unknown): Promise<Response> {
    const timestamp = String(Date.now());
    const response = await fetch(`${this.relay}${path}`, {
      method: "POST",
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
      if (!this.reconnectTimer) this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; this.connectSocket(); }, 1_000);
    };
    void (async () => {
      const timestamp = String(Date.now());
      const signature = await signRequest(this.state.identity, "socket", timestamp, {});
      const socket = new WebSocket(`${this.relay.replace(/^http/u, "ws")}/v1/socket`, {
        headers: { "x-agent-id": this.state.identity.agentId, "x-agent-timestamp": timestamp, "x-agent-signature": signature },
      });
      this.socket = socket;
      socket.on("open", () => socket.send(JSON.stringify({ type: "resume" })));
      socket.on("message", (data) => { void this.onSocketMessage(socket, data.toString()); });
      socket.on("close", retry);
      socket.on("error", () => socket.close());
    })().catch(retry);
  }

  private async onSocketMessage(socket: WebSocket, raw: string): Promise<void> {
    const event = JSON.parse(raw) as { type?: string; envelope?: CipherEnvelope };
    if (event.type !== "message" || !event.envelope) return;
    const envelope = event.envelope;
    const contact = this.state.contacts[envelope.senderId];
    if (!contact) return; // Never decrypt an unpinned identity.
    const key = `${envelope.senderId}:${envelope.id}`;
    if (!this.state.seen[key]) {
      const message = await openEnvelope(this.state.identity, contact, envelope);
      // The durable write happens before ACK. A crash in between causes a safe replay.
      this.state.seen[key] = true;
      this.state.inbox.push({ id: envelope.id, senderId: envelope.senderId, text: message, receivedAt: Date.now() });
      await this.save();
    }
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ack", id: envelope.id }));
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
    const invite = JSON.parse(serialized) as Invite;
    await verifyInvite(invite);
    return { agentId: invite.issuer.agentId, displayName: invite.displayName, relay: invite.relay, expiresAt: invite.expiresAt, fingerprint: invite.issuer.signingPublicKey.slice(0, 16) };
  }

  async confirmInvite(serialized: string): Promise<{ agentId: string; status: string }> {
    const invite = JSON.parse(serialized) as Invite;
    await verifyInvite(invite);
    if (invite.relay !== this.relay) throw new Error("invite points at another relay; start a separate adapter explicitly to use it");
    if (this.state.consumedInviteIds[invite.inviteId]) throw new Error("invite was already consumed locally");
    await this.signedPost("/v1/contact/approve", "contact/approve", { invite });
    this.state.contacts[invite.issuer.agentId] = { ...invite.issuer, displayName: invite.displayName, confirmedAt: Date.now() };
    this.state.consumedInviteIds[invite.inviteId] = true;
    await this.save();
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
    delete this.state.contacts[peerId];
    await this.save();
  }

  status() { return { agentId: this.state.identity.agentId, relay: this.relay, contacts: Object.keys(this.state.contacts).length, inbox: this.state.inbox.length, socket: this.socket?.readyState === WebSocket.OPEN ? "connected" : "connecting" }; }
  inbox() { return this.state.inbox.map(({ id, senderId, text, receivedAt }) => ({ id, senderId, text, receivedAt })); }
}

async function main() {
  const relay = argument("relay");
  if (!relay || !/^https:\/\//u.test(relay)) throw new Error("pass an HTTPS relay URL with --relay");
  const statePath = resolve(argument("state") ?? "./agent-talk-state.json");
  const adapter = new LocalAdapter(statePath, relay.replace(/\/$/u, ""));
  await adapter.initialize();

  const server = new McpServer({ name: "agent-talk-local-adapter", version: "0.1.0" });
  server.registerTool("profile_export_invite", { description: "Create a signed, expiring one-time invite. Share it manually; nothing is sent automatically.", inputSchema: { displayName: z.string().min(1).max(80), expiresInMinutes: z.number().int().min(1).max(1440).default(60) } }, async ({ displayName, expiresInMinutes }) => result(await adapter.exportInvite(displayName, expiresInMinutes)));
  server.registerTool("contact_preview", { description: "Validate and display an invite before the owner decides to confirm it.", inputSchema: { invite: z.string().min(1) } }, async ({ invite }) => result(await adapter.previewInvite(invite)));
  server.registerTool("contact_confirm", { description: "Consume an inspected invite and record a pinned local contact. The remote peer must confirm separately.", inputSchema: { invite: z.string().min(1) } }, async ({ invite }) => result(await adapter.confirmInvite(invite)));
  server.registerTool("message_send", { description: "Encrypt and relay a text message to a mutually approved contact.", inputSchema: { recipientId: z.string().min(1), text: z.string().min(1).max(12_000) } }, async ({ recipientId, text }) => result(await adapter.send(recipientId, text)));
  server.registerTool("inbox_list", { description: "List locally decrypted messages. Receipt is deduplicated by sender and message ID.", inputSchema: {} }, async () => result(adapter.inbox()));
  server.registerTool("contact_block", { description: "Block a contact, reject future delivery, and remove its local pin.", inputSchema: { agentId: z.string().min(1) } }, async ({ agentId }) => { await adapter.block(agentId); return result({ ok: true }); });
  server.registerTool("adapter_status", { description: "Return local adapter status without exposing private keys.", inputSchema: {} }, async () => result(adapter.status()));
  await server.connect(new StdioServerTransport());
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
