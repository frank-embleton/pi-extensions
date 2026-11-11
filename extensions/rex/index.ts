import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    if (!process.env.REX_SESSION) return;

    try {
      const result = await pi.exec(
        "rex",
        ["__internal", "session-start", "--agent", "pi"],
        { timeout: 5000 },
      );

      if (result.code !== 0 || !result.stdout.trim()) return;

      pi.sendMessage({
        customType: "rex-context",
        content: result.stdout.trim(),
        display: false,
      });
    } catch {
      // Missing or unavailable Rex must not prevent Pi startup.
    }
  });
}
