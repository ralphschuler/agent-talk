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
    "6ea3d1b272f76925a9e606430a7c44a9e65f54dc39f748d3fffe83e610ce1006");
  const entries = execFileSync("tar", ["-tf", archive], { encoding: "utf8" }).split("\n");
  assert.ok(entries.includes("LICENSE") && entries.includes("THIRD_PARTY_NOTICES.md"));
  for (const name of ["hpke-chacha20poly1305", "hpke-core", "hpke-dhkem-x25519", "modelcontextprotocol-sdk", "noble-ed25519", "ts-mls", "ws", "zod", "tsx"]) {
    assert.ok(entries.includes("third_party/licenses/" + name + ".txt"));
  }
  assert.equal(createHash("sha256").update(await readFile("LICENSE")).digest("hex"), "ffcca38841adb694b6f380647e15f17c446a4d1656fed51a1e2041d064c94cc8");
  for (const directory of ["", "distribution/companion/"]) {
    const manifest = JSON.parse(await readFile(directory + "package.json", "utf8"));
    const lock = JSON.parse(await readFile(directory + "package-lock.json", "utf8"));
    assert.equal(manifest.license, "PolyForm-Noncommercial-1.0.0");
    assert.equal(lock.packages[""].license, manifest.license);
  }
  assert.ok(!entries.some(entry => entry.startsWith("node_modules/")));
  console.log("Versioned public companion archive and notices are reproducible.");
} finally { await rm(directory, { recursive: true, force: true }); }
