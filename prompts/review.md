---
description: Have the Oracle review a change and its affected callers
argument-hint: "[staged|branch|PR URL|files]"
---
Ask the Oracle for an independent, read-only review.

Target: ${@:-uncommitted changes, or the last commit if there are none}

Resolve the target and collect its diff, including untracked files for uncommitted work. For a branch or PR, establish the base/head and review the merge-base diff. Ensure the source available to the Oracle matches the reviewed revision; ask if the scope is ambiguous.

Call spawn_oracle. Put the target in task. In context, include the repository path, diff (or an absolute path to a complete diff saved outside the repository), relevant file paths, and user constraints. The Oracle has no shell/Git tool and does not inherit this conversation. For a file review, provide the file paths instead of a diff. Pass the following as instructions, replacing the general Oracle defaults for this call:

Review the change and the connected code, not just the diff. Read affected callers, dependencies, tests, fixtures, configuration, and exports. Trace data flow and check whether unchanged callers break when behavior, signatures, or return values change.

Prioritize correctness, security/data loss, failures under expected load, missing tests, performance, then simplification. Judge concurrency and performance against the actual deployment, stating assumptions when unknown. Preserve necessary validation, error handling, security, and accessibility. Prefer reuse and the smallest sufficient fix over new layers or speculative compatibility machinery.

Verify findings against the code. Each finding needs a concrete input, situation, or maintenance consequence; omit speculative worries and style preferences. Rank findings by severity, with file/line references, what goes wrong, and the smallest sufficient fix. Separate uncertainties from confirmed findings. State scope and important checks not performed. If nothing is found, say so without claiming the change is proven safe. Report only; do not modify files.

Keep the main thread read-only too. After spawning, do not poll or wait in a loop. Present the Oracle's findings when it reports back.
