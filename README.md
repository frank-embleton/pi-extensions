# Pi Extensions

Personal Pi extension package.

## Extensions

- `btw` — side-channel assistant overlay
- `doppelclaude` — vendored Claude Agent SDK provider ([upstream documentation](extensions/doppelclaude/README.upstream.md))
- `mode-presets` — switch model/thinking presets
- `subagents` — background Pi worker agents

## Skills

Includes the personal skills under `skills/`.

## Install on a new machine

This repository is a Pi package. Install it globally from GitHub:

```bash
pi install https://github.com/frank-embleton/pi-extensions
pi list
```

Then restart Pi, or run `/reload` in an existing session. Pi loads both the extensions and skills declared in `package.json`; no manual clone or symlinks are needed.

If you are giving this README to Pi on another machine, ask it:

> Install the Pi package from `https://github.com/frank-embleton/pi-extensions` globally, verify it with `pi list`, and tell me whether I need to restart or reload Pi.

## Updating

Pi checks unpinned packages for updates during interactive startup. After changes are committed and pushed to this repository, update with:

```bash
pi update --extensions
```

Then restart Pi or run `/reload`. Do not edit Pi's managed clone under `~/.pi/agent/git/`, because package updates reset and clean that checkout.
