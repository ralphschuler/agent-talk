import assert from "node:assert/strict";

export async function verifyDeploymentReceipt(creation, expectedVersion, readDeployment) {
  // Cloudflare can acknowledge creation with just the ID. Read that deployment on the owned Worker.
  const id = typeof creation === "string" ? creation : creation?.id;
  assert.match(id ?? "", /^(?:[a-f0-9]{32}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i, "Activation returned no valid deployment ID");
  const deployment = await readDeployment(id);
  assert.equal(deployment?.id, id, "Deployment read-back returned a different ID");
  assert.ok(Array.isArray(deployment.versions) && deployment.versions.length === 1, "Expected one active version");
  const [active] = deployment.versions;
  assert.equal(active.version_id, expectedVersion, "Deployment serves a different Worker version");
  assert.equal(active.percentage, 100, "Uploaded Worker version must receive 100% of traffic");
  return id;
}
