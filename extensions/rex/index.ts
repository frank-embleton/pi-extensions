import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    if (!process.env.REX_SESSION) return;

    const location = Object.fromEntries(
      ["REX_SERVER", "REX_SESSION", "REX_BLOCK"]
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    );

    pi.sendMessage({
      customType: "rex-context",
      display: false,
      content: `You are running inside Rex.
Default to bash, even for slow commands. Use Rex panes for concurrent, interactive, or user-visible work; use --wait for finite commands. Reuse relevant panes, clean up your own when no longer needed, and report anything left running. Never close unrelated terminals.
Inherited shell environment (not yet verified): ${JSON.stringify(location)}
A tab is a window; a pane is a block. Target your own session/block, not the user's focus, unless they request another target. If IDs are missing or stale, run rex whoami --json before acting.

Naming: On the first concrete task, name your current window with two to four lowercase words joined by hyphens. Keep an existing name for the same task. Leave session names unchanged unless asked; sessions need not represent projects. Name panes by role when useful (agent, server, tests). If a window contains unrelated work, name only your pane instead.

Keep inspection output small: block inspect includes the full API schema (50 KB+). Never run it unfiltered, including when combined with other commands; pipe it directly to jq and select only needed fields. The pane ID field is block_id, not id.

Quick reference (uppercase placeholders must be replaced with actual IDs, paths, labels, or commands):
- Find your window: rex block inspect -s "$REX_SESSION" "$REX_BLOCK" --json | jq '.block | {block_id, window_id, label}'
- List tabs/panes: rex window ls -s "$REX_SESSION" --json; rex block ls -s "$REX_SESSION" --json
- Rename tab: rex window rename -s "$REX_SESSION" WINDOW_ID task-name
- Rename pane: rex block rename -s "$REX_SESSION" "$REX_BLOCK" role
- New tab: rex run -s "$REX_SESSION" -c DIRECTORY --focus=false --json -- COMMAND
- Split: rex split -s "$REX_SESSION" -b "$REX_BLOCK" -c DIRECTORY --split=right --focus=false --json -- COMMAND
- Read output: rex capture -s "$REX_SESSION" -b BLOCK_ID --trim

Put Rex options before -- and command arguments after it. Use -- sh -c '...' for shell syntax. Save returned IDs for later targeting. Use --keep-open for output that should remain visible after exit, --wait only for finite commands, never for servers or interactive programs. Capture output to verify results; creating a pane does not prove its command succeeded. Never send input into your own agent pane, close unrelated terminals, or restart the Rex server.
This reference is sufficient for routine operations; do not load the Rex skill or full guide at startup. Use command-specific --help for unfamiliar options; load the Rex skill (or rex skill show) only for advanced workflows not covered here.`,
    });
  });
}
