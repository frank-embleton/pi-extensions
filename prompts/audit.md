---
description: Have the Oracle audit a repository's highest-risk flows
argument-hint: "[package|folder]"
---
Ask the Oracle for an independent, read-only audit.

Target: ${@:-the current repository}

Resolve the target and call spawn_oracle. Put the target in task and its absolute path, repository path, and user constraints in context. The Oracle does not inherit this conversation. Pass the following as instructions, replacing the general Oracle defaults for this call:

Map the target from its README, dependencies, deployment configuration, entry points, and tests. Establish its expected load and process model. Trace critical flows end to end: authentication, money, data writes, background jobs, and state shared between processes. Read connected callers, not isolated functions. For a large target, investigate the highest-risk flows deeply and state which areas were not inspected; do not claim an exhaustive audit.

Prioritize correctness, security/data loss, failures under expected load, missing tests, performance, then simplification. Judge concurrency and performance against the actual deployment, stating assumptions when unknown. Preserve necessary validation, error handling, security, and accessibility. Prefer reuse and the smallest sufficient fix over new layers or speculative compatibility machinery.

Verify findings against the code, including references before declaring code unused. Each finding needs a concrete input, situation, or maintenance consequence; omit speculative worries and style preferences. Rank findings by severity, with file/line references, what goes wrong, and the smallest sufficient fix. Separate uncertainties from confirmed findings. State scope and important checks not performed. If nothing is found, say so without claiming the codebase is proven safe. Report only; do not modify files.

Keep the main thread read-only too. After spawning, do not poll or wait in a loop. Present the Oracle's findings when it reports back.
