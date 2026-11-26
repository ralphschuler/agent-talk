// Recheck only the synthetic ciphertext rows, independently of the local runner.
import { checkLiveStorage, verifyStagingWindow } from "./owner-live-storage-check.mjs";
try {
  const encoded = process.env.OWNER_LIVE_OBSERVATION ?? "";
  if (encoded.length > 32000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Invalid observation.");
  const record = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (record.mode !== "staging-interactive" || record.release !== process.env.GITHUB_SHA || record.productionApproval !== false || record.storage?.status !== "pending") {
    throw new Error("Not an interactive staging observation.");
  }
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  await verifyStagingWindow({ account, token, release: record.release, expectedDeployment: record.deployment,
    startedAt: record.startedAt, observedAt: record.observedAt });
  await checkLiveStorage({ account, token,
    release: record.release, expectedDeployment: record.deployment, ...record.routing, materialDigests: record.materialDigests });
  await verifyStagingWindow({ account, token, release: record.release, expectedDeployment: record.deployment,
    startedAt: record.startedAt, observedAt: record.observedAt });
  console.log("Read-only staging inspection verified the synthetic encrypted records; this job did not perform the browser test.");
} catch {
  console.error("Read-only staging storage inspection failed; production remains gated.");
  process.exitCode = 1;
}
