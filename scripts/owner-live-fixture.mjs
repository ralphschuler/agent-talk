// Prepare real relay traffic using caller-supplied disposable MCP agents.
import assert from "node:assert/strict";

export async function prepareSyntheticScenario({ a1, a2, b3, invoke, waitForValue }) {
  async function link(left, right) {
    const a = await invoke(left, "profile_export_invite", { displayName: "Disposable A", expiresInMinutes: 10 });
    const b = await invoke(right, "profile_export_invite", { displayName: "Disposable B", expiresInMinutes: 10 });
    const ap = await invoke(left, "profile_export", { displayName: "Disposable A", capabilities: [] });
    const bp = await invoke(right, "profile_export", { displayName: "Disposable B", capabilities: [] });
    await invoke(left, "contact_confirm", { invite: JSON.stringify(b), profile: JSON.stringify(bp) });
    await invoke(right, "contact_confirm", { invite: JSON.stringify(a), profile: JSON.stringify(ap) });
  }
  await waitForValue(async () => (await Promise.all([a1, a2, b3].map(client => invoke(client, "adapter_status"))))
    .every(status => status.socket === "connected"), "Synthetic relay connections");
  const [one, two, three] = await Promise.all([a1, a2, b3].map(client => invoke(client, "adapter_status")));
  assert.equal(new Set([one.agentId, two.agentId, three.agentId]).size, 3);
  await link(a1, a2);
  await link(a2, b3);
  const first = await invoke(a2, "direct_ask", { recipientId: one.agentId, text: "Synthetic first question" });
  await waitForValue(async () => (await invoke(a1, "inbox_list")).some(item => item.id === first.id), "First direct delivery");
  await invoke(a1, "direct_reply", { recipientId: two.agentId, threadId: first.threadId, replyTo: first.id, text: "<img src=x> A second synthetic message" });
  const second = await invoke(a1, "direct_ask", { recipientId: two.agentId, text: "A2 distinct question" });
  await waitForValue(async () => (await invoke(a2, "inbox_list")).some(item => item.id === second.id), "Second direct delivery");
  await invoke(a2, "direct_reply", { recipientId: one.agentId, threadId: second.threadId, replyTo: second.id, text: "A2 distinct reply" });
  const { groupId } = await invoke(a1, "group_create", { name: "Disposable private group" });
  const invite = await invoke(a1, "group_invite", { groupId, target: two.agentId });
  const consent = await invoke(a2, "group_accept", { invite: JSON.stringify(invite) });
  await invoke(a1, "group_add", { consent: JSON.stringify(consent) });
  await waitForValue(async () => (await invoke(a2, "group_list")).some(group => group.groupId === groupId && group.status === "active"), "Group activation");
  const question = await invoke(a2, "group_ask", { groupId, text: "Synthetic private group question" });
  await waitForValue(async () => (await invoke(a1, "group_read", { groupId })).some(item => item.id === question.id), "Group delivery");
  await invoke(a1, "group_reply", { groupId, replyTo: question.messageRef, text: "Synthetic private group reply" });
  await invoke(b3, "message_send", { recipientId: two.agentId, text: "B3 private history" });
  return { one, two, three, first, second, groupId, question };
}

export async function checkOfflineReplay({ sender, receiver, receiverId, restart, invoke, waitForValue }) {
  await receiver.close();
  const message = await invoke(sender, "message_send", { recipientId: receiverId, text: "Synthetic offline delivery" });
  const reopened = await restart();
  await waitForValue(async () => (await invoke(reopened, "adapter_status")).socket === "connected", "Offline agent reconnect");
  await waitForValue(async () => (await invoke(reopened, "inbox_list")).some(item => item.id === message.id), "Offline replay");
  await new Promise(done => setTimeout(done, 300));
  assert.equal((await invoke(reopened, "inbox_list")).filter(item => item.id === message.id).length, 1,
    "Offline message must appear once.");
  return reopened;
}
