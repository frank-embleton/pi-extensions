import assert from "node:assert/strict";
import test from "node:test";
import rex from "./index.ts";

test("Rex startup context", async (t) => {
  const keys = ["REX_SERVER", "REX_SESSION", "REX_BLOCK"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const scenario of [
      { name: "outside Rex", env: {} },
      { name: "empty session", env: { REX_SESSION: "", REX_BLOCK: "block:test" } },
      { name: "inside Rex", env: { REX_SERVER: "unix:///tmp/rex.sock", REX_SESSION: "session:test", REX_BLOCK: "block:test" } },
      { name: "missing pane and server", env: { REX_SESSION: "session:test" } },
    ]) {
      await t.test(scenario.name, async () => {
        for (const key of keys) {
          if (scenario.env[key] === undefined) delete process.env[key];
          else process.env[key] = scenario.env[key];
        }
        let handler;
        const messages = [];
        rex({
          on(event, callback) {
            assert.equal(event, "session_start");
            handler = callback;
          },
          async exec() {
            assert.fail("Startup must not invoke Rex or load its guide");
          },
          sendMessage(message) {
            messages.push(message);
          },
        });

        await handler();
        if (!scenario.env.REX_SESSION) {
          assert.deepEqual(messages, []);
          return;
        }

        assert.equal(messages.length, 1);
        const { customType, display, content } = messages[0];
        assert.equal(customType, "rex-context");
        assert.equal(display, false);
        assert.ok(content.includes(JSON.stringify(scenario.env)));
        assert.match(content, /Default to bash, even for slow commands/);
        assert.match(content, /clean up your own when no longer needed/);
        assert.match(content, /report anything left running/);
        assert.match(content, /name your current window/);
        assert.match(content, /Leave session names unchanged unless asked/);
        assert.match(content, /If a window contains unrelated work, name only your pane/);
        assert.match(content, /rex whoami --json/);
        assert.match(content, /Never run it unfiltered/);
        assert.match(content, /pipe it directly to jq/);
        assert.ok(content.includes("jq '.block | {block_id, window_id, label}'"));
        for (const command of ["window rename", "block rename", "run", "split", "capture"]) {
          assert.ok(content.includes(`rex ${command} -s "$REX_SESSION"`));
        }
        assert.match(content, /do not load the Rex skill or full guide at startup/);
        assert.doesNotMatch(content, /__internal|rex session rename/);
        assert.ok(content.length < 3500, "Keep startup guidance compact");
      });
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
