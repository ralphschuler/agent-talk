// Emit only public version identifiers; credentials stay in the protected job.
import { appendFile } from "node:fs/promises";
import { getStagingDeployment } from "./owner-live-storage-check.mjs";
try {
  const release = process.env.GITHUB_SHA;
  const result = await getStagingDeployment({ account: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN, release });
  const summary = `Staging release: ${release}\nStaging deployment ID: ${result.deploymentId}\nStaging version ID: ${result.versionId}\n`;
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
} catch {
  console.error("Unable to verify the exact staging version. No credentials were printed.");
  process.exitCode = 1;
}
