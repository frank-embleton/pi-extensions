import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-shared-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agent = join(dir, "agent");
  const pkg = join(dir, "package");
  mkdirSync(agent);
  mkdirSync(join(pkg, "scripts"), { recursive: true });
  mkdirSync(join(pkg, "config"));
  const script = join(pkg, "scripts/link-config.mjs");
  writeFileSync(script, readFileSync(fileURLToPath(new URL("./link-config.mjs", import.meta.url))));
  writeFileSync(join(pkg, "config/AGENTS.md"), "Shared instructions\n");
  writeFileSync(join(pkg, "config/mode-presets.json"), "[]\n");
  return { agent, pkg, run: () => spawnSync(process.execPath, [script], {
    encoding: "utf8", env: { ...process.env, PI_CODING_AGENT_DIR: agent },
  }) };
}

test("links shared config; updates flow through; reruns are harmless", (t) => {
  const { agent, pkg, run } = fixture(t);
  assert.equal(run().status, 0);
  for (const name of ["AGENTS.md", "mode-presets.json"]) {
    assert.equal(realpathSync(join(agent, name)), realpathSync(join(pkg, "config", name)));
  }
  writeFileSync(join(pkg, "config/AGENTS.md"), "Updated\n");
  assert.equal(readFileSync(join(agent, "AGENTS.md"), "utf8"), "Updated\n");
  assert.equal(run().status, 0);
  assert.deepEqual(readdirSync(agent).sort(), ["AGENTS.md", "mode-presets.json"]);
});

test("backs up existing files and preserves local selection", (t) => {
  const { agent, run } = fixture(t);
  writeFileSync(join(agent, "AGENTS.md"), "Original\n");
  writeFileSync(join(agent, "mode-presets.json"), "[1]\n");
  writeFileSync(join(agent, "mode-presets-selection.json"), "local\n");
  assert.equal(run().status, 0);
  const backup = join(agent, "backups", readdirSync(join(agent, "backups"))[0]);
  assert.equal(readFileSync(join(backup, "AGENTS.md"), "utf8"), "Original\n");
  assert.equal(readFileSync(join(backup, "mode-presets.json"), "utf8"), "[1]\n");
  assert.equal(readFileSync(join(agent, "mode-presets-selection.json"), "utf8"), "local\n");
});

for (const dangling of [false, true]) {
  test(`refuses ${dangling ? "dangling" : "existing"} unexpected symlinks before changing files`, (t) => {
    const { agent, run } = fixture(t);
    writeFileSync(join(agent, "AGENTS.md"), "Original\n");
    const other = join(agent, "other");
    if (!dangling) writeFileSync(other, "[]\n");
    symlinkSync(other, join(agent, "mode-presets.json"));
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unexpected symlink/);
    assert.equal(readFileSync(join(agent, "AGENTS.md"), "utf8"), "Original\n");
  });
}

test("invalid source JSON does not replace existing instructions", (t) => {
  const { agent, pkg, run } = fixture(t);
  writeFileSync(join(agent, "AGENTS.md"), "Original\n");
  writeFileSync(join(pkg, "config/mode-presets.json"), "invalid");
  assert.equal(run().status, 1);
  assert.equal(readFileSync(join(agent, "AGENTS.md"), "utf8"), "Original\n");
});
