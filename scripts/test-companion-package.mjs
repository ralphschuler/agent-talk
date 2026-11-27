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
    "2dce66f6c20c3b7171d855310e433e9a6ff3a36b4c379307f24889c41f2b99dc");
  console.log("Versioned public companion archive is reproducible.");
} finally { await rm(directory, { recursive: true, force: true }); }
