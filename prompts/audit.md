---
description: Ask the Oracle to audit a repository or package by critical flow
argument-hint: "[repository|package|folder]"
---
The user explicitly requests an independent, read-only Oracle codebase audit.

Target: ${@:-the current repository}

Resolve the target, read the `oracle-code-review` skill, and pass its reviewer instructions as spawn_oracle.instructions, replacing the general defaults for this call only. Pass the absolute repository/target paths and any user constraints in context; the Oracle does not inherit this conversation. Keep the main thread read-only too.

Its task is to map the target from its README, dependency list, deployment configuration, entry points, and tests. Establish the expected load and process model, then trace critical flows end to end: authentication, money, data writes, background jobs, and state shared between processes. Prioritize concrete correctness, security, data-loss, and expected-load failures before testing gaps, performance, and simplification.

For a large target, go deep on the highest-risk flows instead of claiming an exhaustive file-by-file audit. Report verified findings and the smallest sufficient fixes, state load assumptions, and name the areas not inspected and tests not run. Do not modify files or run commands that change repository state.

Do not poll or wait in a loop. When the Oracle reports back, present its findings and distinguish any additional interpretation of your own.
