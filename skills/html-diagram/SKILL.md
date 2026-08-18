---
name: html-diagram
description: Create a compact self-contained HTML file with a high-quality SVG diagram for architecture, system flows, or stack explanations. Use when the user asks for an HTML architecture diagram, visual system map, interactive SVG explainer, or diagram-first artifact.
disable-model-invocation: true
---

# HTML Diagram

Create a single self-contained `.html` file that explains the system visually.

## Output goals

- Diagram-first: minimal prose, maximum visual clarity.
- Full-screen layout with an inline SVG as the main stage.
- Use labeled boxes, regions, arrows, sequence paths, and small callouts.
- Make the artifact easy to open locally in a browser.
- Prefer one strong diagram over many weak sections.

## Process

1. Inspect the project/domain enough to understand the architecture or flow.
2. Choose the clearest visual model:
   - architecture map
   - request/data flow
   - deployment topology
   - module dependency map
   - user journey / sequence
3. Build one self-contained HTML file with:
   - inline CSS
   - inline SVG
   - no external dependencies unless the user asks
4. Iterate on the SVG until spacing, hierarchy, labels, and paths are clear.

## Interactivity, when useful

Add lightweight JavaScript only if it improves comprehension:

- clickable nodes that reveal short notes
- flow chips/buttons that highlight a path
- animated request/data movement along arrows
- hover states for relationships

## Style guidance

- Keep the page clean and presentation-ready.
- Use CSS classes and variables for colors and repeated styles.
- Avoid long text blocks; use concise labels and short side notes.
- Make arrows readable: consistent direction, clear labels, no unnecessary crossings.
- Use semantic grouping: clients, app, services, data, external systems, infrastructure.

## Do not

- Do not include dark mode unless the user asks.
- Do not write a prose report disguised as a diagram.
- Do not use Mermaid as the primary artifact; handcraft the SVG.
- Do not depend on network assets.
