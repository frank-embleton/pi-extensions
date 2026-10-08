---
description: Ask the Oracle to review a change and its connected code
argument-hint: "[uncommitted|staged|branch|PR URL|files]"
---
The user explicitly requests an independent, read-only Oracle code review.

Target: ${@:-uncommitted changes, or the last commit if there are none}

Resolve the target before spawning. For a branch, establish its base and review the merge-base diff. For a PR, obtain its base/head and diff. Ensure the files available to the Oracle match the reviewed revision; if they do not, use a separate temporary checkout or state the limitation rather than reviewing unrelated local files. Include untracked files when reviewing uncommitted work. If the target is ambiguous, ask rather than guess.

The Oracle has file-reading tools, but no shell or Git tool and does not inherit this conversation. Collect the relevant diff and pass it, the repository path, base/head where applicable, changed-file paths, and any user constraints in spawn_oracle context. For a large diff, save the complete diff outside the repository and provide its absolute path. For named files, provide their paths and clarify that this is a file review rather than a diff review. Keep the main thread read-only too.

Use spawn_oracle with its default instructions. Its task is to understand the change, then read connected callers, dependencies, tests, fixtures, configuration, and exports. Trace behavior end to end, especially when signatures or return values change: unchanged code can break too. Report verified findings and the smallest sufficient fixes, with scope and limitations. Do not modify files or run commands that change repository state.

Do not poll or wait in a loop. When the Oracle reports back, present its findings and distinguish any additional interpretation of your own.
