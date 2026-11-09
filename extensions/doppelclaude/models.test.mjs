import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("./src/models.ts", import.meta.url), "utf8");
const models = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const configured = {
  id: "claude-fable-5-2",
  provider: models.PROVIDER_ID,
  api: models.PROVIDER_API,
  baseUrl: models.PROVIDER_BASE_URL,
  contextWindow: 1_000_000,
};

test("explicit stable models do not require SDK discovery or a catalog marker", () => {
  assert.equal(models.isSupportedModel(configured), true);
  assert.equal(models.claudeCodeModelId(configured), "claude-fable-5-2[1m]");
  assert.equal(models.claudeCodeModelId({ ...configured, contextWindow: 200_000 }), "claude-fable-5-2");
});

test("explicit models must use the bridge route and a stable Claude model ID", () => {
  for (const patch of [
    { provider: "anthropic" },
    { api: "anthropic-messages" },
    { baseUrl: "https://api.anthropic.com" },
    { id: "fable" },
    { id: "claude-fable-5-2[1m]" },
    { id: "claude-unknown-5" },
  ]) {
    assert.equal(models.isSupportedModel({ ...configured, ...patch }), false);
    assert.throws(() => models.claudeCodeModelId({ ...configured, ...patch }), /Unsupported Doppelclaude model/);
  }
});
