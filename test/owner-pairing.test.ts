import { expect, it } from "vite-plus/test";
import { createLocalIdentity, openEnvelope, sealEnvelope } from "../src/crypto.ts";
import { approvePairing, createPairingRequest, verifyPairing } from "../portal/pairing.ts";

it("binds the account, pinned agent and device to the signed pairing", async () => {
  const agent = await createLocalIdentity();
  const otherAgent = await createLocalIdentity();
  const device = await createLocalIdentity();
  const otherDevice = await createLocalIdentity();
  const publicDevice = { agentId: device.agentId, signingPublicKey: device.signingPublicKey, encryptionPublicKey: device.encryptionPublicKey };
  const request = createPairingRequest("123", agent.agentId, publicDevice, 1000);
  const requestFromLocalIdentity = createPairingRequest("123", agent.agentId, device, 1000);
  expect(JSON.stringify(requestFromLocalIdentity)).not.toContain(device.signingSecretKey);
  expect(JSON.stringify(requestFromLocalIdentity)).not.toContain(device.encryptionSecretKey);
  const approval = await approvePairing(request, agent, 1001);
  await expect(verifyPairing(approval, "123", agent, 1002)).resolves.toBeUndefined();
  await expect(verifyPairing(approval, "456", agent, 1002)).rejects.toThrow();
  await expect(verifyPairing(approval, "123", otherAgent, 1002)).rejects.toThrow();
  await expect(verifyPairing({ ...approval, request: { ...request, device: otherDevice } }, "123", agent, 1002)).rejects.toThrow();
  await expect(verifyPairing(approval, "123", agent, request.expiresAt)).rejects.toThrow();

  const encrypted = await sealEnvelope(agent, publicDevice, "synthetic-message", "Hello from the agent");
  await expect(openEnvelope(device, agent, encrypted)).resolves.toBe("Hello from the agent");
  await expect(openEnvelope(otherDevice, agent, encrypted)).rejects.toThrow();
  expect(JSON.stringify(encrypted)).not.toContain("Hello from the agent");
});
