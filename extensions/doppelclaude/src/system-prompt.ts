import type { SettingSource } from "@anthropic-ai/claude-agent-sdk";
interface SystemPromptReplacements {
  identity: string;
  toolNameNote: string;
  documentation: {
    heading: string;
    instructions: string[];
  };
}

const SYSTEM_PROMPT_REPLACEMENTS: SystemPromptReplacements = {
  identity:
    "You are Claude, working in a custom coding harness via the Claude Code SDK. You primarily help the user with software engineering tasks.",
  toolNameNote:
    "Tool names arrive with a prefix when you call them, but the instructions below refer to them bare — calling `mcp__custom-tools__bash` is what the `bash` tool means",
  documentation: {
    heading: "Working conventions:",
    instructions: [
      "- Do not modify this coding harness unless the user explicitly asks.",
      "- Work autonomously: complete reversible actions implied by the request without asking permission. Stop only for destructive actions, genuine scope changes, or input only the user can provide.",
      "- If the user is asking a question, describing a problem, or thinking aloud rather than requesting a change, provide an assessment only; do not implement a fix.",
      "- Before ending, finish any work you have planned or promised, including retries and investigation. Do not end with unfinished next steps or a permission-seeking question.",
      "- Before changing system state, confirm the evidence supports that specific action rather than merely resembling a familiar failure.",
      "- Prefer surgical edits over rewrites when the result is equivalent.",
      "- Keep the change focused. Do not fix unrelated bugs, optimize, or extend behavior unless required; report such findings instead.",
      "- Resolve ambiguity using the request and surrounding code's most direct reading, and note the assumption rather than supporting multiple interpretations.",
      "- Verify the requested behavior. Add permanent tests only when requested or when this repository normally tests comparable changes, and keep them focused.",
    ],
  },
};

// "pi" mode isolates Claude Code's filesystem settings ([] = no setting sources);
// every other mode keeps Claude Code's defaults (undefined).
export function settingSourcesFor(systemPromptMode: string): SettingSource[] | undefined {
  return systemPromptMode === "pi" ? [] : undefined;
}

const PI_IDENTITY_PROMPT = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.`;

const PI_DOCUMENTATION_BLOCK_REGEX =
  /\n\nPi documentation \(read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI\):\n[\s\S]*?\n- Always read pi \.md files completely and follow links to related docs \(e\.g\., tui\.md for TUI API details\)/;

function rewritePiDocumentationBlock(
  systemPrompt: string,
  documentation: SystemPromptReplacements["documentation"],
): string {
  const match = PI_DOCUMENTATION_BLOCK_REGEX.exec(systemPrompt);
  if (!match) return systemPrompt;

  return systemPrompt.replace(
    PI_DOCUMENTATION_BLOCK_REGEX,
    [`\n\n${documentation.heading}`, ...documentation.instructions].join("\n"),
  );
}

function rewriteIdentityPrompt(systemPrompt: string, replacement: string): string {
  return systemPrompt.replace(PI_IDENTITY_PROMPT, replacement);
}

function insertToolNameNote(systemPrompt: string, replacement: string): string {
  return systemPrompt.replace("\n\nAvailable tools:", `\n\n${replacement}\n\nAvailable tools:`);
}

function insertRelocatedToolBlock(systemPrompt: string, block: string): string {
  const anchor = "\n\nIn addition to the tools above";
  if (!systemPrompt.includes(anchor)) return `${block}\n\n${systemPrompt}`;
  return systemPrompt.replace(anchor, `\n\n${block}${anchor}`);
}

export type ClaudeSystemPrompt =
  | string
  | {
      type: "preset";
      preset: "claude_code";
      append?: string;
    };

export interface ToolDescriptionRelocation {
  name: string;
  description: string;
}

function relocatedToolBlock(relocations: ToolDescriptionRelocation[]): string | undefined {
  if (relocations.length === 0) return undefined;
  const descriptions = relocations
    .map(
      (relocation) => `<function_description>${JSON.stringify(relocation)}</function_description>`,
    )
    .join("\n");
  return `<extended_function_descriptions>\n${descriptions}\n</extended_function_descriptions>`;
}

// Calls that never went through pi's agent loop — e.g. streamSimple
// — carry a system prompt with none of pi's blocks in it.
export function rewritePiSystemPrompt(systemPrompt: string): string {
  const replacements = SYSTEM_PROMPT_REPLACEMENTS;
  if (!systemPrompt.includes(PI_IDENTITY_PROMPT)) return systemPrompt;

  return rewritePiDocumentationBlock(
    insertToolNameNote(
      rewriteIdentityPrompt(systemPrompt, replacements.identity),
      replacements.toolNameNote,
    ),
    replacements.documentation,
  );
}

export function buildClaudeSystemPrompt(
  piSystemPrompt: string | undefined,
  mode: "claude-code" | "pi" | "append",
  relocations: ToolDescriptionRelocation[] = [],
): ClaudeSystemPrompt {
  const relocationBlock = relocatedToolBlock(relocations);
  if (mode === "claude-code") {
    return {
      type: "preset",
      preset: "claude_code",
      ...(relocationBlock ? { append: ` ${relocationBlock}` } : {}),
    };
  }
  const rewrittenPiPrompt = rewritePiSystemPrompt(piSystemPrompt ?? "");
  const promptWithRelocations = relocationBlock
    ? insertRelocatedToolBlock(rewrittenPiPrompt, relocationBlock)
    : rewrittenPiPrompt;
  // Claude Code puts its own identity in a separate system block right before ours and
  // joins nothing between them, so without this the two run together as "…Agent SDK.You are".
  const separatedPiPrompt = ` ${promptWithRelocations}`;
  return mode === "pi"
    ? separatedPiPrompt
    : { type: "preset", preset: "claude_code", append: separatedPiPrompt };
}
