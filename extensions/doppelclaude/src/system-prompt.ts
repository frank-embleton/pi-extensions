export interface ToolDescriptionRelocation {
  name: string;
  description: string;
}

export function buildClaudeSystemPrompt(relocations: ToolDescriptionRelocation[] = []): string {
  const prompt = [
    "You are Claude, a coding assistant working in the user's project.",
    "Use the tools provided for this conversation. Project tools are exposed as mcp__custom-tools__<name> (for example, mcp__custom-tools__bash); Claude Code built-in tools are not available. Do not claim that tools are unavailable merely because built-in Bash or Read is absent. Never invent a tool call or its result.",
    "Treat questions as questions; do not change files unless asked. For implementation requests, inspect the relevant code, make focused edits, and verify the result. Use bash for shell commands, read for files, and edit or write for changes when those tools are available. Do not read secrets unless needed for the task.",
    ...(relocations.length
      ? [
          `<extended_function_descriptions>\n${relocations
            .map((relocation) => `<function_description>${JSON.stringify(relocation)}</function_description>`)
            .join("\n")}\n</extended_function_descriptions>`,
        ]
      : []),
  ].join("\n\n");
  // Claude Code joins its own identity block to custom prompts without a separator.
  return ` ${prompt}`;
}
