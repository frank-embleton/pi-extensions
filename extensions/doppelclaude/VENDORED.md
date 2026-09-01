# Vendored pi-doppelclaude

This directory vendors [`thurstonsand/pi-doppelclaude`](https://github.com/thurstonsand/pi-doppelclaude).

- Source repository: [`thurstonsand/pi-doppelclaude`](https://github.com/thurstonsand/pi-doppelclaude)
- Source commit: `6fdf773b7f54d75af02313ac9b524e68fdc1899d` (`v0.10.0-2-g6fdf773`)
- Vendored content: `src/`, `LICENSE`, and upstream `README.md`

Runtime dependencies are maintained in the root `package.json`. To update, copy the same files from a clean source checkout, update the dependency ranges and source commit above, then regenerate the root lockfile and run the load check.

## Local changes

Re-apply these to `src/description-cap.ts` when re-vendoring unless upstream has them:

- Accept the parameterised truncation anchor (`${label} truncated from …`) used by Claude Code ≥ 0.3.257.
- Re-`stat` the binary after scanning and skip caching/warning if it changed mid-scan (a package install may still be writing it).
