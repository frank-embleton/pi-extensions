// Everything about a turn that is a pure function of the request: how Claude Code
// would be spawned for it, and how pi's tools are named to it. No runtime state, so
// the runtime can derive it before deciding whether the turn is pushed into a live
// query or spawns a new one — and derive it again, identically, for a replay.

import type { Options } from "@anthropic-ai/claude-agent-sdk";
import {
  getCurrentTools,
  normalizeContext,
  type Api,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type Tool,
} from "@earendil-works/pi-ai";
import { makeCliDebugOptions } from "./debug.js";
import { claudeCodeModelId, resolveThinkingEffort } from "./models.js";
import { sdkChildEnv } from "./sdk-child-env.js";
import type { ProviderSettings } from "./settings.js";
import { MCP_TOOL_PREFIX } from "./skills.js";
import { buildClaudeSystemPrompt, type ToolDescriptionRelocation } from "./system-prompt.js";

export interface TurnTools {
  mcpTools: Tool[];
  originalMcpTools: Tool[];
  relocations: ToolDescriptionRelocation[];
  customToolNameToSdk: Map<string, string>;
  customToolNameToPi: Map<string, string>;
}

export function resolveMcpTools(context: Context, toolDescriptionCap: number | false): TurnTools {
  const mcpTools: Tool[] = [];
  const originalMcpTools: Tool[] = [];
  const relocations: ToolDescriptionRelocation[] = [];
  const customToolNameToSdk = new Map<string, string>();
  const customToolNameToPi = new Map<string, string>();

  // Pi's agent loop folds tool declarations into system messages before calling
  // the provider. context.tools is absent on those normalized turns.
  for (const tool of getCurrentTools(normalizeContext(context).messages)) {
    const sdkName = `${MCP_TOOL_PREFIX}${tool.name}`;
    originalMcpTools.push(tool);
    if (toolDescriptionCap !== false && tool.description.length > toolDescriptionCap) {
      mcpTools.push({ ...tool, description: "" });
      relocations.push({
        name: sdkName,
        description: tool.description,
      });
    } else {
      mcpTools.push(tool);
    }
    customToolNameToSdk.set(tool.name, sdkName);
    customToolNameToSdk.set(tool.name.toLowerCase(), sdkName);
    customToolNameToPi.set(sdkName, tool.name);
    customToolNameToPi.set(sdkName.toLowerCase(), tool.name);
  }

  return { mcpTools, originalMcpTools, relocations, customToolNameToSdk, customToolNameToPi };
}

/** The tool set a live query was handed. A change means the servers are reconciled,
 *  not that the process is replaced. */
export function mcpSignature(tools: Tool[]): string {
  return JSON.stringify(
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  );
}

export interface TurnPlan {
  cwd: string;
  cliModel: string;
  /** The spawn arguments a subprocess cannot be talked out of after the fact. A live
   *  query whose signature no longer matches the turn has to be replaced. */
  spawnSignature: string;
  queryOptions: Options;
}

export function planTurn(input: {
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions | undefined;
  providerSettings: ProviderSettings;
  /** Only the host's own query outlives its turn; its CLI log is the root one. */
  oneShot: boolean;
  relocations: ToolDescriptionRelocation[];
}): TurnPlan {
  const { model, context, options, providerSettings, oneShot, relocations } = input;
  const cwd = (options as { cwd?: string } | undefined)?.cwd ?? process.cwd();
  const systemPrompt = buildClaudeSystemPrompt(relocations);
  const claudeExecutable = providerSettings.pathToClaudeCodeExecutable;
  const effort = resolveThinkingEffort(model, options?.reasoning);
  const cliModel = claudeCodeModelId(model);
  const extraArgs: Record<string, string | null> = {};
  if (effort) extraArgs["thinking-display"] = "summarized";
  const spawnSignature = JSON.stringify({
    cwd,
    systemPrompt,
    effort: effort ?? null,
    claudeExecutable: claudeExecutable ?? null,
  });
  const queryOptions: Options = {
    cwd,
    env: sdkChildEnv({ ENABLE_CLAUDEAI_MCP_SERVERS: "0", DISABLE_AUTO_COMPACT: "1" }),
    tools: [],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    strictMcpConfig: true,
    systemPrompt,
    model: cliModel,
    extraArgs,
    ...(effort ? { effort } : {}),
    settingSources: [],
    ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
    ...makeCliDebugOptions(oneShot ? "provider-child" : "provider"),
  };
  return { cwd, cliModel, spawnSignature, queryOptions };
}
