import assert from "node:assert/strict";
import test from "node:test";
import rex from "./index.ts";

test("Rex startup context", async (t) => {
  const previous = process.env.REX_SESSION;
  try {
    for (const scenario of [
      { name: "outside Rex", session: "", calls: 0 },
      { name: "successful hook", session: "session:test", result: { code: 0, stdout: " Rex context\n" }, calls: 1, content: "Rex context" },
      { name: "failed hook", session: "session:test", result: { code: 1, stdout: "error" }, calls: 1 },
      { name: "empty output", session: "session:test", result: { code: 0, stdout: " \n" }, calls: 1 },
      { name: "unavailable Rex", session: "session:test", error: new Error("ENOENT"), calls: 1 },
    ]) {
      await t.test(scenario.name, async () => {
        process.env.REX_SESSION = scenario.session;
        let handler;
        const calls = [];
        const messages = [];
        rex({
          on(event, callback) {
            assert.equal(event, "session_start");
            handler = callback;
          },
          async exec(...args) {
            calls.push(args);
            if (scenario.error) throw scenario.error;
            return scenario.result;
          },
          sendMessage(message, options) {
            messages.push({ message, options });
          },
        });

        await handler();
        assert.equal(calls.length, scenario.calls);
        if (scenario.calls) {
          assert.deepEqual(calls[0], [
            "rex",
            ["__internal", "session-start", "--agent", "pi"],
            { timeout: 5000 },
          ]);
        }
        assert.deepEqual(messages, scenario.content ? [{
          message: { customType: "rex-context", content: scenario.content, display: false },
          options: undefined,
        }] : []);
      });
    }
  } finally {
    if (previous === undefined) delete process.env.REX_SESSION;
    else process.env.REX_SESSION = previous;
  }
});
