import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "agent-talk-package-test-"));
try {
  const archive = join(directory, "companion.tar.gz");
  execFileSync("python3", ["scripts/build-companion.py", archive], { stdio: "pipe" });
  assert.equal(createHash("sha256").update(await readFile(archive)).digest("hex"),
    "2c9b842d91b09425673970b625ef9da04feb68473de75336d755fcfb4e98cd62");
  console.log("Versioned public companion archive is reproducible.");
} finally { await rm(directory, { recursive: true, force: true }); }
