import { createLocalIdentity, openOwnerCopy, signRequest, type LocalIdentity } from "../src/crypto.ts";
import { base64url, type AgentIdentity } from "../src/protocol.ts";
import { verifyPairing, type PairingApproval, type PairingRequest } from "./pairing.ts";

type DeviceRecord = { device: LocalIdentity; agent?: AgentIdentity };
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element<HTMLElement>("status");
let accountId = "";
let pending: { request: PairingRequest; device: LocalIdentity } | undefined;
let selectionVersion = 0;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("agent-talk-owner-v1", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("devices");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
}

async function deviceRecord(agentId: string, value?: DeviceRecord): Promise<DeviceRecord | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("devices", value ? "readwrite" : "readonly");
      const store = transaction.objectStore("devices");
      const request = value ? store.put(value, accountId + ":" + agentId) : store.get(accountId + ":" + agentId);
      let result: DeviceRecord | undefined;
      request.onsuccess = () => { if (!value) result = request.result as DeviceRecord | undefined; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

async function api(path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<any> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? extraHeaders : { "content-type": "application/json", ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    credentials: "same-origin", cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new Error("The request failed (" + response.status + ").");
  return response.json();
}

function run(action: () => Promise<void>) {
  return () => { void action().catch(error => { status.textContent = error instanceof Error ? error.message : "Request failed."; }); };
}

async function listAgents() {
  const { agents } = await api("/agents");
  const container = element<HTMLElement>("agents");
  container.replaceChildren();
  for (const entry of agents) {
    const button = document.createElement("button");
    button.textContent = entry.agentId;
    button.addEventListener("click", run(() => readAgent(entry.agentId)));
    container.append(button);
    const record = await deviceRecord(entry.agentId);
    if (record && entry.devices.some((device: AgentIdentity) => device.agentId === record.device.agentId)) {
      const revoke = document.createElement("button");
      revoke.textContent = "Revoke this browser";
      revoke.addEventListener("click", run(async () => {
        if (!window.confirm("Revoke this browser's access to agent " + entry.agentId + "?")) return;
        selectionVersion++;
        element<HTMLElement>("messages").replaceChildren();
        await api("/device/revoke", { agentId: entry.agentId, deviceId: record.device.agentId });
        status.textContent = "Browser access revoked.";
        await listAgents();
      }));
      container.append(revoke);
    }
  }
}

async function readAgent(agentId: string) {
  const selection = ++selectionVersion;
  const container = element<HTMLElement>("messages");
  container.replaceChildren();
  const record = await deviceRecord(agentId);
  if (!record?.agent) throw new Error("Pair this browser with the agent before reading.");
  const body = { agentId, deviceId: record.device.agentId, nonce: base64url(crypto.getRandomValues(new Uint8Array(32))) };
  const timestamp = String(Date.now());
  const signature = await signRequest(record.device, "owner-copy-read-v1", timestamp, { ...body, accountId });
  const { copies } = await api("/copy/read", body, { "x-device-timestamp": timestamp, "x-device-signature": signature });
  const threads = new Map<string, Array<{ text: string; senderId: string; time: number }>>();
  for (const copy of copies) {
    const message = JSON.parse(await openOwnerCopy(record.device, record.agent, copy));
    if (typeof message.text !== "string" || typeof message.senderId !== "string" ||
        typeof message.receivedAt !== "number") throw new Error("Invalid encrypted message.");
    const threadId = typeof message.direct?.threadId === "string" ? message.direct.threadId : "Other messages";
    const thread = typeof message.groupId === "string" ? "Group " + message.groupId + " · " + threadId : threadId;
    const entries = threads.get(thread) ?? [];
    entries.push({ text: message.text, senderId: message.senderId, time: message.receivedAt });
    threads.set(thread, entries);
  }
  const fragment = document.createDocumentFragment();
  for (const [thread, entries] of threads) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = thread === "Other messages" ? thread : "Thread " + thread;
    section.append(heading);
    entries.sort((left, right) => left.time - right.time);
    for (const entry of entries) {
      const article = document.createElement("article");
      const label = document.createElement("strong");
      label.textContent = entry.senderId === agentId ? "Your agent" : entry.senderId;
      const text = document.createElement("p");
      text.textContent = entry.text;
      article.append(label, text);
      section.append(article);
    }
    fragment.append(section);
  }
  if (selection !== selectionVersion) return;
  container.replaceChildren(fragment);
  status.textContent = "Messages loaded.";
}

element<HTMLButtonElement>("login").onclick = run(async () => {
  const { url } = await api("/auth/login", {});
  const target = new URL(url);
  if (target.origin !== "https://github.com" || target.pathname !== "/login/oauth/authorize") throw new Error("Invalid login destination.");
  location.assign(target.href);
});
element<HTMLButtonElement>("logout").onclick = run(async () => {
  selectionVersion++;
  element<HTMLElement>("messages").replaceChildren();
  await api("/auth/logout", {});
  location.reload();
});
element<HTMLButtonElement>("start-pairing").onclick = run(async () => {
  const agentId = element<HTMLInputElement>("agent-id").value.trim();
  const existing = await deviceRecord(agentId);
  const device = existing?.device ?? await createLocalIdentity();
  const identity = { agentId: device.agentId, signingPublicKey: device.signingPublicKey, encryptionPublicKey: device.encryptionPublicKey };
  const { request } = await api("/pairing/start", { agentId, device: identity });
  await deviceRecord(agentId, { device, ...(existing?.agent && { agent: existing.agent }) });
  pending = { request, device };
  element<HTMLTextAreaElement>("pair-request").value = JSON.stringify(request);
  status.textContent = "Request created. Ask the agent owner to approve it.";
});
element<HTMLButtonElement>("complete-pairing").onclick = run(async () => {
  if (!pending) throw new Error("Create a pairing request first.");
  const approval = JSON.parse(element<HTMLTextAreaElement>("pair-approval").value) as PairingApproval;
  if (JSON.stringify(approval.request) !== JSON.stringify(pending.request)) throw new Error("The approval does not match this request.");
  const agentId = pending.request.agentId;
  await verifyPairing(approval, accountId, { agentId, signingPublicKey: agentId.slice(4), encryptionPublicKey: "" });
  await api("/pairing/complete", { approval });
  await deviceRecord(agentId, { device: pending.device, agent: approval.agent });
  pending = undefined;
  status.textContent = "Device paired.";
  await listAgents();
});
element<HTMLButtonElement>("deny-pairing").onclick = run(async () => {
  if (pending) await api("/pairing/deny", { nonce: pending.request.nonce });
  pending = undefined;
  element<HTMLTextAreaElement>("pair-request").value = "";
  status.textContent = "Pairing cancelled.";
});
void (async () => {
  try {
    const account = await api("/auth/account");
    accountId = account.accountId;
    element<HTMLElement>("owner").hidden = false;
    status.textContent = "Signed in to GitHub account " + accountId + ".";
    await listAgents();
  } catch {
    element<HTMLElement>("login").hidden = false;
    status.textContent = "Sign in to continue.";
  }
})();
