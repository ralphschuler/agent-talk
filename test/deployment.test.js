import { expect, it } from "vite-plus/test";
import { verifyDeploymentReceipt } from "../scripts/verify-deployment-receipt.mjs";

it("reads the exact deployment from an ID-only create receipt and checks its traffic", async () => {
  const id = "182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e";
  const version = "023e105f-2a42-4f8b-a1c1-73f6a2a30c0f";
  const active = { version_id: version, percentage: 100 };
  const verify = deployment => verifyDeploymentReceipt({ id }, version, async requestedId => {
    expect(requestedId).toBe(id);
    return deployment;
  });

  await expect(verify({ id, versions: [active] })).resolves.toBe(id);
  await expect(verify({ id: version, versions: [active] })).rejects.toThrow(/different ID/);
  await expect(verify({ id, versions: [{ ...active, version_id: id }] })).rejects.toThrow(/different Worker version/);
  await expect(verify({ id, versions: [{ ...active, percentage: 50 }] })).rejects.toThrow(/100%/);
  await expect(verify({ id, versions: [active, active] })).rejects.toThrow(/one active version/);
});
