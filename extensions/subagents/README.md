# Pi Subagents MVP

A minimal Pi extension that lets the main agent spawn background Pi worker sessions and exchange messages with them.

## Tools

### `spawn_worker`

Spawns a background worker agent.

Parameters:

- `task` — focused task for the worker
- `context` — optional design/background context from the main thread
- `name` — optional human-readable worker name
- `tools` — optional list of enabled tool names; defaults to `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`, and `message_main_thread`
- `model` — optional worker model as `provider/model-id`; defaults to the parent thread's current model
- `thinkingLevel` — optional worker thinking level: `off`, `low`, or `high`

By default, the worker inherits the parent session's current model and thinking level.

Model selection:

- `openai-codex/gpt-5.6-sol` at low or high for complex or ambiguous work
- `openai-codex/gpt-5.6-terra` at high for clear, moderately complex work
- `openai-codex/gpt-5.6-luna` at high only for simple, precisely defined work
- When uncertain, inherit the parent model; briefly explain deliberate changes

The tool result includes the full worker request JSON, including the resolved model, thinking level, tools, and exact kickoff prompt sent to the worker.

Thinking-level guidance for the main agent:

- `off` — mechanical, simple lookup, formatting, or low-risk file inspection tasks
- `low` — routine code edits, focused investigation, or tasks needing modest reasoning
- `high` — hard debugging, design review, security/concurrency concerns, or tasks where the worker needs to reason deeply

### Fable second opinions

Fable runs through Claude Code's native background-agent support and is used only when the user explicitly requests it. Its spawn result mirrors `spawn_worker` by showing the job id, name, model, effort, and task; result details include the full resolved request and exact kickoff prompt. When a job completes, its final response is read from Claude's transcript and delivered automatically to the main thread.

- `spawn_fable` — start a read-only Fable review and return immediately
- `fable_status` — refresh job status
- `abort_fable` — stop a job while preserving its Claude conversation

This requires the `claude` CLI, authentication, and access to the Fable model.

### `send_to_worker`

Sends a follow-up message to an existing worker. After sending, do not poll `worker_status` in a loop; continue other work or end the turn and wait for automatic delivery.

Parameters:

- `worker_id` — id returned by `spawn_worker`, e.g. `worker-1`
- `message` — message/instructions to send

### `worker_status`

Shows status for all workers or one worker.

Parameters:

- `worker_id` — optional worker id. If omitted, all workers are listed.

Status includes current state, current tool, last event, last activity, last message, and error if any.

### `peek_worker`

Shows recent event/transcript log entries for a worker.

Parameters:

- `worker_id` — id returned by `spawn_worker`
- `limit` — optional number of recent log entries; defaults to 50, max 200

### `abort_worker`

Aborts a running worker.

Parameters:

- `worker_id` — id returned by `spawn_worker`

## Worker tool

Each worker gets one extra tool:

### `message_main_thread`

The worker calls this to send a message back to the main thread. The extension injects it into the active main Pi session as a steering user message. If the main agent is streaming, the message is delivered after its current tool batch, before the next model call.

Worker messages are push-based. `worker_status` is for occasional inspection, not polling; repeated status calls can keep the main agent busy and should not be used to wait for a response.

## Worker indicator

While workers are active, a compact `⚙ N workers running` indicator is right-aligned on the directory/branch line, directly above Pi's model name. It updates as workers start, finish, fail, stall, or are aborted, and disappears when none remain.

## Command

### `/workers`

Lists currently known workers with status, current tool, last event, and last activity.

### `/worker <worker-id>`

Shows the most recent log entries for a worker.

## Install/test

Run Pi with the extension directly:

```bash
pi -e ../../scratch/pi/subagents/index.ts
```

Or copy/symlink this directory into an auto-discovered extension location:

```bash
ln -s "$PWD/../../scratch/pi/subagents" ~/.pi/agent/extensions/subagents
pi
```

Then ask the main agent to spawn a worker for a focused task.

## Notes

This is intentionally small: no full UI dashboard and no persistence across reloads. Worker visibility is in-memory only via the running-worker indicator, session event subscriptions, `/workers`, `/worker`, `worker_status`, and `peek_worker`. Workers are disposed when the main Pi session shuts down.
