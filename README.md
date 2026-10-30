# Pi Extensions

Personal Pi extension package.

## Extensions

- `btw` — side-channel assistant overlay
- `doppelclaude` — Claude Agent SDK provider with one standalone system prompt; Claude Code's prompt preset, settings files, and Pi instructions are not forwarded ([upstream reference, not current configuration](extensions/doppelclaude/README.upstream.md))
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

Pi loads the extensions and skills declared in `package.json`. To also use the shared global instructions and mode presets, run this once on each machine after installing:

```bash
node ~/.pi/agent/git/github.com/frank-embleton/pi-extensions/scripts/link-config.mjs
```

Then restart Pi, or run `/reload` in an existing session.

If you are giving this README to Pi on another machine, ask it:

> Install the Pi package from `https://github.com/frank-embleton/pi-extensions` globally, run its `scripts/link-config.mjs` script from the installed package directory, verify it with `pi list`, and tell me whether I need to restart or reload Pi.

## Shared global configuration

- `config/AGENTS.md` contains the shared global instructions.
- `config/mode-presets.json` contains the shared model/thinking presets.
- `scripts/link-config.mjs` symlinks these files into `~/.pi/agent/` (or `PI_CODING_AGENT_DIR` when set).

The script backs up existing regular files under the agent directory's `backups/shared-config-*` directory. Rerunning it leaves correct links alone and refuses to replace unexpected symlinks or directories. It does not touch credentials, device IDs, settings, or `mode-presets-selection.json`; those remain machine-local.

Run the script from Pi's managed package checkout so package updates refresh the linked files. Edit shared files in your development checkout, commit and push them, then update the package on each machine. Do not edit the linked files through `~/.pi/agent/`: those writes would modify the managed checkout and be lost on update.

To stop sharing a file, remove its symlink and copy the desired file from the backup directory into its place.

Test the setup script with:

```bash
node --test scripts/link-config.test.mjs
```

## Updating

Pi checks unpinned packages for updates during interactive startup. After changes are committed and pushed to this repository, update with:

```bash
pi update --extensions
```

Then restart Pi or run `/reload`. Do not edit Pi's managed clone under `~/.pi/agent/git/`, because package updates reset and clean that checkout.

## License

Original content in this repository is available under the [MIT License](LICENSE). Copied and vendored components retain their original MIT notices; see [Third-party notices](THIRD_PARTY_NOTICES.md).
