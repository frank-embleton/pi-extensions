#!/usr/bin/env node
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = resolve(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));
const names = ["AGENTS.md", "mode-presets.json"];

function inspect(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

try {
  // Validate every source and destination before changing any files.
  const pending = names.filter((name) => {
    const source = join(root, "config", name);
    const target = join(agentDir, name);
    const contents = readFileSync(source, "utf8");
    if (name.endsWith(".json")) JSON.parse(contents);
    const stat = inspect(target);
    if (stat?.isSymbolicLink()) {
      try {
        if (realpathSync(target) === realpathSync(source)) {
          console.log(`Already linked: ${target}`);
          return false;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      throw new Error(`Refusing to replace unexpected symlink: ${target}`);
    }
    if (stat && !stat.isFile()) throw new Error(`Not a regular file: ${target}`);
    return true;
  });

  mkdirSync(agentDir, { recursive: true });
  const backupDir = join(agentDir, "backups", `shared-config-${Date.now()}-${process.pid}`);
  for (const name of pending) {
    const target = join(agentDir, name);
    if (inspect(target)) {
      mkdirSync(backupDir, { recursive: true });
      renameSync(target, join(backupDir, name));
      console.log(`Backed up: ${join(backupDir, name)}`);
    }
    symlinkSync(join(root, "config", name), target);
    console.log(`Linked: ${target}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
