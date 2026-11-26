// Shared browser assertions for disposable agents. Authentication, confirmation,
// browser control and fixture setup are injected by the caller. This module does
// not inject cookies or produce release evidence.
import assert from "node:assert/strict";

export async function runOwnerBrowserScenario({ evaluate, waitFor, portalOrigin, agentId,
  senderId, mcp, secondMcp, expectEmpty = false, multiAgent, firstAccountId, secondAccountId,
  setApproval, delayRead, revokeFirst, signInSecond, testRetry = async () => {}, inspectStorage = async () => {},
  firstThreadId = "synthetic-thread", firstMessageId = "synthetic-message" }) {
  if (expectEmpty) {
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await evaluate('document.querySelector("#status").textContent.includes(' + JSON.stringify(secondAccountId) + ')'), true);
    assert.equal(await evaluate('document.querySelectorAll("#agents button").length'), 0);
    console.log("A separate browser profile could not see the first account's agents.");
    return;
  }
  await evaluate('document.querySelector("#agent-id").value = ' + JSON.stringify(agentId));
  await evaluate('document.querySelector("#start-pairing").click()');
  await waitFor('document.querySelector("#pair-request")?.value?.length > 0');
  const request = JSON.parse(await evaluate('document.querySelector("#pair-request").value'));
  assert.equal(request.agentId, agentId);
  assert.equal(request.accountId, firstAccountId);
  await setApproval(true);
  const signed = await mcp.callTool({ name: "owner_device_approve", arguments: { request } });
  assert.notEqual(signed.isError, true);
  await evaluate('document.querySelector("#pair-approval").value = ' + JSON.stringify(signed.content[0].text));
  await evaluate('document.querySelector("#complete-pairing").click()');
  await waitFor('document.querySelector("#status")?.textContent === "Device paired."');
  const enable = await mcp.callTool({ name: "owner_device_enable", arguments: {
    portal: portalOrigin, deviceId: request.device.agentId, minutes: 30,
  } });
  assert.notEqual(enable.isError, true);
  await evaluate('Array.from(document.querySelectorAll("#agents button")).find(b => b.textContent === ' + JSON.stringify(agentId) + ')?.click()');
  await waitFor('document.querySelector("#status")?.textContent === "Messages loaded."');
  assert.equal(await evaluate('document.querySelectorAll("#messages article").length'), 0);
  const backfill = await mcp.callTool({ name: "owner_thread_backfill", arguments: {
    deviceId: request.device.agentId, peerId: senderId, threadId: firstThreadId,
  } });
  assert.equal(JSON.parse(backfill.content[0].text).queued, 2);
  await setApproval(false);
  for (let attempt = 0; attempt < 60; attempt++) {
    await evaluate('Array.from(document.querySelectorAll("#agents button")).find(b => b.textContent === ' + JSON.stringify(agentId) + ')?.click()');
    await new Promise(resolve => setTimeout(resolve, 100));
    if (await evaluate('document.querySelectorAll("#messages article").length === 2')) break;
  }
  assert.equal(await evaluate('document.querySelectorAll("#messages article").length'), 2);
  assert.equal(await evaluate('document.querySelector("#messages").textContent.includes("A second synthetic message")'), true);
  assert.equal(await evaluate('document.querySelector("#messages img") === null'), true);
  await testRetry(request.device.agentId);
  await inspectStorage(request.device.agentId);
  if (multiAgent) {
    await setApproval(true);
    const groupBackfill = await mcp.callTool({ name: "owner_group_backfill", arguments: {
      deviceId: request.device.agentId, groupId: multiAgent.groupId, threadId: multiAgent.groupThreadId,
    } });
    assert.equal(JSON.parse(groupBackfill.content[0].text).queued, 2);
    await setApproval(false);
    for (let attempt = 0; attempt < 60; attempt++) {
      await evaluate('Array.from(document.querySelectorAll("#agents button")).find(b => b.textContent === ' + JSON.stringify(agentId) + ')?.click()');
      await new Promise(resolve => setTimeout(resolve, 100));
      if (await evaluate('document.querySelector("#messages").textContent.includes("Synthetic private group reply")')) break;
    }
    assert.equal(await evaluate('document.querySelector("#messages").textContent.includes("Synthetic private group question")'), true);
    await evaluate('document.querySelector("#agent-id").value = ' + JSON.stringify(multiAgent.secondAgentId));
    await evaluate('document.querySelector("#start-pairing").click()');
    await waitFor('JSON.parse(document.querySelector("#pair-request").value).agentId === ' + JSON.stringify(multiAgent.secondAgentId));
    const secondRequest = JSON.parse(await evaluate('document.querySelector("#pair-request").value'));
    assert.equal(secondRequest.agentId, multiAgent.secondAgentId);
    assert.equal(secondRequest.accountId, firstAccountId);
    const secondSigned = await secondMcp.callTool({ name: "owner_device_approve", arguments: { request: secondRequest } });
    assert.notEqual(secondSigned.isError, true);
    await evaluate('document.querySelector("#pair-approval").value = ' + JSON.stringify(secondSigned.content[0].text));
    await evaluate('document.querySelector("#complete-pairing").click()');
    await waitFor('document.querySelector("#status")?.textContent === "Device paired."');
    const secondEnable = await secondMcp.callTool({ name: "owner_device_enable", arguments: {
      portal: portalOrigin, deviceId: secondRequest.device.agentId, minutes: 30,
    } });
    assert.notEqual(secondEnable.isError, true);
    await evaluate('Array.from(document.querySelectorAll("#agents button")).find(b => b.textContent === ' + JSON.stringify(multiAgent.secondAgentId) + ')?.click()');
    await waitFor('document.querySelector("#status")?.textContent === "Messages loaded."');
    assert.equal(await evaluate('document.querySelectorAll("#messages article").length'), 0);
    const secondBackfill = await secondMcp.callTool({ name: "owner_thread_backfill", arguments: {
      deviceId: secondRequest.device.agentId, peerId: agentId, threadId: multiAgent.threadId,
    } });
    assert.equal(JSON.parse(secondBackfill.content[0].text).queued, 2);
    for (let attempt = 0; attempt < 60; attempt++) {
      await evaluate('Array.from(document.querySelectorAll("#agents button")).find(b => b.textContent === ' + JSON.stringify(multiAgent.secondAgentId) + ')?.click()');
      await new Promise(resolve => setTimeout(resolve, 100));
      if (await evaluate('document.querySelector("#messages").textContent.includes("A2 distinct reply")')) break;
    }
    assert.equal(await evaluate('document.querySelector("#messages").textContent.includes("A2 distinct question")'), true);
    assert.equal(await evaluate('document.querySelector("#messages").textContent.includes("A second synthetic message")'), false);
    await delayRead(agentId);
    await evaluate('Array.from(document.querySelectorAll("#agents button")).find(b => b.textContent === ' + JSON.stringify(agentId) + ')?.click()');
    await new Promise(resolve => setTimeout(resolve, 50));
    await evaluate('Array.from(document.querySelectorAll("#agents button")).find(b => b.textContent === ' + JSON.stringify(multiAgent.secondAgentId) + ')?.click()');
    await waitFor('document.querySelector("#messages").textContent.includes("A2 distinct reply")');
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(await evaluate('document.querySelector("#messages").textContent.includes("A second synthetic message")'), false);
    await evaluate('Array.from(document.querySelectorAll("#agents button")).find(b => b.textContent === ' + JSON.stringify(agentId) + ')?.click()');
    await waitFor('document.querySelector("#messages").textContent.includes("A second synthetic message")');
    assert.equal(await evaluate('document.querySelector("#messages").textContent.includes("A2 distinct reply")'), false);
    await revokeFirst(agentId);
    await waitFor('document.querySelector("#status").textContent === "Browser access revoked."');
    await evaluate('Array.from(document.querySelectorAll("#agents button")).find(b => b.textContent === ' + JSON.stringify(multiAgent.secondAgentId) + ')?.click()');
    await waitFor('document.querySelector("#messages").textContent.includes("A2 distinct reply")');
    await setApproval(true);
    const revokedCopy = await mcp.callTool({ name: "owner_device_copy", arguments: {
      portal: portalOrigin, deviceId: request.device.agentId, senderId, messageId: firstMessageId,
    } });
    assert.equal(revokedCopy.isError, true);
    await setApproval(false);
    await evaluate('document.querySelector("#logout").click()');
    await waitFor('document.querySelector("#login") && !document.querySelector("#login").hidden');
    await signInSecond();
    await waitFor('document.querySelector("#agents").textContent.includes(' + JSON.stringify(multiAgent.thirdAgentId) + ')');
    assert.equal(await evaluate('document.querySelector("#agents").textContent.includes(' + JSON.stringify(agentId) + ')'), false);
    assert.equal(await evaluate('document.querySelector("#agents").textContent.includes(' + JSON.stringify(multiAgent.secondAgentId) + ')'), false);
    assert.equal(await evaluate('document.querySelector("#messages").textContent.includes("A2 distinct")'), false);
    console.log("One browser isolated A's two agent histories, kept A2 after A1 revocation, and cleared A content for B.");
  }
  console.log("Chrome paired a separate browser device and decrypted two inert thread messages.");
}
