import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "agent-talk-package-test-"));
try {
  const archive = join(directory, "companion.tar");
  execFileSync("python3", ["scripts/build-companion.py", archive], { stdio: "pipe" });
  assert.equal(createHash("sha256").update(await readFile(archive)).digest("hex"),
    "71e064f2e1152cb4033c01a558b3ae698303d143f82f435dcc6e9a2a2d2466ee");
  console.log("Versioned public companion archive is reproducible.");
} finally { await rm(directory, { recursive: true, force: true }); }
