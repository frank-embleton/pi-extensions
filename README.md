# Pi Extensions

Personal Pi extension package.

## Extensions

- `btw` — side-channel assistant overlay
- `doppelclaude` — Claude Agent SDK provider with one standalone system prompt; Claude Code's prompt preset, settings files, and Pi instructions are not forwarded ([upstream reference, not current configuration](extensions/doppelclaude/README.upstream.md))
- `mode-presets` — switch model/thinking presets
- `subagents` — background Pi worker agents

## Skills

Includes the personal skills under `skills/`.

## Oracle prompts

- `/review [uncommitted|staged|branch|PR URL|files]` — review a change and its connected callers. Defaults to uncommitted changes, or the last commit when the working tree is clean.
- `/audit [repository|package|folder]` — map a codebase and audit its highest-risk flows. Defaults to the current repository.

These are prompt templates, not new agents or persistent modes. Both explicitly request the existing read-only Oracle and load the shared `oracle-code-review` skill as instructions for that call only. Ordinary Oracle calls keep their general second-opinion defaults. The main agent resolves the scope and supplies Git/PR evidence, since the Oracle has no shell or Git tool. Findings distinguish confirmed problems from uncertainties and state what was not checked.

## Install on a new machine

This repository is a Pi package. Install it globally from GitHub:

```bash
pi install https://github.com/frank-embleton/pi-extensions
pi list
```

Then restart Pi, or run `/reload` in an existing session. Pi loads the extensions, skills, and prompt templates declared in `package.json`; no manual clone or symlinks are needed.

If you are giving this README to Pi on another machine, ask it:

> Install the Pi package from `https://github.com/frank-embleton/pi-extensions` globally, verify it with `pi list`, and tell me whether I need to restart or reload Pi.

## Updating

Pi checks unpinned packages for updates during interactive startup. After changes are committed and pushed to this repository, update with:

```bash
pi update --extensions
```

Then restart Pi or run `/reload`. Do not edit Pi's managed clone under `~/.pi/agent/git/`, because package updates reset and clean that checkout.

## License

Original content in this repository is available under the [MIT License](LICENSE). Copied and vendored components retain their original MIT notices; see [Third-party notices](THIRD_PARTY_NOTICES.md).
