import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DefaultResourceLoader,
	SessionManager,
	createAgentSession,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Type, type Static } from "typebox";

const thinkingLevelSchema = StringEnum(["off", "low", "high"] as const, {
	description:
		'Optional thinking level for the worker. Use "off" for no thinking. Defaults to the parent thread\'s current thinking level.',
});

const spawnWorkerSchema = Type.Object({
	task: Type.String({ description: "The task for the worker agent to perform." }),
	context: Type.Optional(
		Type.String({
			description:
				"Optional design/background context from the main thread. Include enough intent for the worker to avoid architecture drift.",
		}),
	),
	name: Type.Optional(Type.String({ description: "Optional human-readable worker name." })),
	tools: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Optional built-in tool names to enable for the worker. Defaults to read/write/edit/bash/grep/find/ls.",
		}),
	),
	model: Type.Optional(
		Type.String({
			description:
				'Optional model as "provider/model-id". Defaults to the parent model. Prefer openai-codex/gpt-5.6-sol for complex work, openai-codex/gpt-5.6-terra at high reasoning for clear moderate work, and openai-codex/gpt-5.6-luna at high reasoning only for simple, precisely defined work.',
		}),
	),
	thinkingLevel: Type.Optional(thinkingLevelSchema),
});

type SpawnWorkerInput = Static<typeof spawnWorkerSchema>;

const sendToWorkerSchema = Type.Object({
	worker_id: Type.String({ description: "Worker id returned by spawn_worker." }),
	message: Type.String({ description: "Message/instructions to send to the worker." }),
});

function formatModel(model: { provider: string; id: string } | undefined): string | undefined {
	return model ? `${model.provider}/${model.id}` : undefined;
}

type WorkerStatus = "starting" | "running" | "thinking" | "tool" | "done" | "error" | "aborted" | "stalled" | "disposed";

type WorkerLogEntry = {
	time: number;
	event: string;
	text: string;
};

type WorkerRecord = {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	status: WorkerStatus;
	lastEvent?: string;
	lastMessage?: string;
	currentTool?: string;
	error?: string;
	completionReported: boolean;
	log: WorkerLogEntry[];
	session: Awaited<ReturnType<typeof createAgentSession>>["session"];
	unsubscribe: () => void;
	dispose: () => void;
};

const workerStatusSchema = Type.Object({
	worker_id: Type.Optional(Type.String({ description: "Optional worker id. If omitted, all workers are listed." })),
});

const peekWorkerSchema = Type.Object({
	worker_id: Type.String({ description: "Worker id returned by spawn_worker." }),
	limit: Type.Optional(Type.Number({ description: "Maximum number of recent log entries to return. Defaults to 50." })),
});

const abortWorkerSchema = Type.Object({
	worker_id: Type.String({ description: "Worker id returned by spawn_worker." }),
});

const spawnFableSchema = Type.Object({
	task: Type.String({ description: "The question or review task for Fable." }),
	context: Type.Optional(Type.String({ description: "Optional self-contained context, paths, constraints, and observed errors." })),
	name: Type.Optional(Type.String({ description: "Optional name shown by Claude's background-agent manager." })),
});

const fableIdSchema = Type.Object({
	fable_id: Type.String({ description: "Fable background-session id returned by spawn_fable." }),
});

const fableStatusSchema = Type.Object({
	fable_id: Type.Optional(Type.String({ description: "Optional Fable id. If omitted, list Fable jobs started by this Pi session." })),
});

type FableRecord = {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	state: string;
	notified: boolean;
	sessionId?: string;
	cwd?: string;
};

export default function subagents(pi: ExtensionAPI) {
	const workers = new Map<string, WorkerRecord>();
	const fables = new Map<string, FableRecord>();
	let nextWorkerNumber = 1;
	let uiContext: ExtensionContext | undefined;
	let requestFooterRender: (() => void) | undefined;

	let staleTimer: ReturnType<typeof setInterval> | undefined;
	let fableTimer: ReturnType<typeof setInterval> | undefined;
	const activeStatuses = new Set<WorkerStatus>(["starting", "running", "thinking", "tool"]);

	function activeWorkerText() {
		const workerCount = [...workers.values()].filter((worker) => activeStatuses.has(worker.status)).length;
		const fableCount = [...fables.values()].filter((fable) => !["done", "stopped", "error"].includes(fable.state)).length;
		const count = workerCount + fableCount;
		if (count === 0) return "";
		return `⚙ ${count === 1 ? "1 worker running" : `${count} workers running`}`;
	}

	function formatTokens(count: number) {
		if (count < 1000) return `${count}`;
		if (count < 1_000_000) return `${count < 10_000 ? (count / 1000).toFixed(1) : Math.round(count / 1000)}k`;
		return `${count < 10_000_000 ? (count / 1_000_000).toFixed(1) : Math.round(count / 1_000_000)}M`;
	}

	function formatCwd(cwd: string) {
		const home = process.env.HOME || process.env.USERPROFILE;
		if (!home) return cwd;
		const relativeToHome = relative(resolve(home), resolve(cwd));
		const insideHome =
			relativeToHome === "" ||
			(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
		return insideHome ? (relativeToHome ? `~${sep}${relativeToHome}` : "~") : cwd;
	}

	function updateWorkerFooter() {
		requestFooterRender?.();
	}

	function ageText(time: number) {
		const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		return `${minutes}m ${seconds % 60}s ago`;
	}

	function pushWorkerLog(worker: WorkerRecord, event: string, text: string, options?: { coalesce?: boolean }) {
		const now = Date.now();
		const previous = worker.log[worker.log.length - 1];
		if (options?.coalesce && previous?.event === event) {
			previous.time = now;
			previous.text += text;
		} else {
			worker.log.push({ time: now, event, text });
		}
		if (worker.log.length > 200) worker.log.splice(0, worker.log.length - 200);
	}

	function formatWorkerLog(entries: WorkerLogEntry[]) {
		return entries.length
			? entries.map((entry) => `[${new Date(entry.time).toLocaleTimeString()}] ${entry.event}: ${entry.text.trim()}`).join("\n")
			: "No log entries.";
	}

	function finalAssistantText(messages: any[]): string | undefined {
		const message = [...messages].reverse().find((candidate) => candidate?.role === "assistant");
		if (!message) return undefined;
		if (typeof message.content === "string") return message.content.trim() || undefined;
		if (!Array.isArray(message.content)) return undefined;
		const text = message.content
			.filter((part: any) => part?.type === "text" && typeof part.text === "string")
			.map((part: any) => part.text)
			.join("\n")
			.trim();
		return text || undefined;
	}

	function markWorker(worker: WorkerRecord, status: WorkerStatus, event: string, text: string) {
		worker.status = status;
		worker.updatedAt = Date.now();
		worker.lastEvent = event;
		worker.lastMessage = text;
		pushWorkerLog(worker, event, text);
		updateWorkerFooter();
	}

	function workerDetails(worker: WorkerRecord) {
		return {
			id: worker.id,
			name: worker.name,
			createdAt: worker.createdAt,
			updatedAt: worker.updatedAt,
			status: worker.status,
			lastEvent: worker.lastEvent,
			lastMessage: worker.lastMessage,
			currentTool: worker.currentTool,
			error: worker.error,
			logLength: worker.log.length,
		};
	}

	function workerSummary(worker: WorkerRecord) {
		return [
			`- ${worker.id} (${worker.name})`,
			`  status: ${worker.status}${worker.currentTool ? ` (${worker.currentTool})` : ""}`,
			`  updated: ${ageText(worker.updatedAt)}`,
			worker.lastEvent ? `  last event: ${worker.lastEvent}` : undefined,
			worker.lastMessage ? `  last: ${worker.lastMessage}` : undefined,
			worker.error ? `  error: ${worker.error}` : undefined,
		]
			.filter(Boolean)
			.join("\n");
	}

	function workerListText() {
		if (workers.size === 0) return "No workers.";
		return [...workers.values()].map(workerSummary).join("\n");
	}

	function startStaleTimer() {
		if (staleTimer) return;
		staleTimer = setInterval(() => {
			const now = Date.now();
			for (const worker of workers.values()) {
				if (["done", "error", "aborted", "disposed", "stalled"].includes(worker.status)) continue;
				if (now - worker.updatedAt > 120_000) {
					markWorker(
						worker,
						"stalled",
						"stalled",
						"No worker activity for more than 120s. The worker was marked stalled but was not stopped.",
					);
				}
			}
		}, 10_000);
	}

	async function fableFinalResponse(fable: FableRecord) {
		if (!fable.sessionId || !fable.cwd) return undefined;
		const projectDir = fable.cwd.replace(/[^a-zA-Z0-9_-]/g, "-");
		const transcriptPath = join(homedir(), ".claude", "projects", projectDir, `${fable.sessionId}.jsonl`);
		const transcript = await readFile(transcriptPath, "utf8");
		const lines = transcript.trim().split("\n").reverse();
		for (const line of lines) {
			let entry: any;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (entry?.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
			const text = entry.message.content
				.filter((part: any) => part?.type === "text" && typeof part.text === "string")
				.map((part: any) => part.text)
				.join("\n")
				.trim();
			if (text) return text.length > 50_000 ? `${text.slice(0, 50_000)}\n\n[Response truncated]` : text;
		}
		return undefined;
	}

	async function refreshFables() {
		if (fables.size === 0) return;
		const result = await pi.exec("claude", ["agents", "--json", "--all"], { timeout: 10_000 });
		if (result.code !== 0) return;
		let sessions: any[];
		try {
			sessions = JSON.parse(result.stdout);
		} catch {
			return;
		}
		for (const fable of fables.values()) {
			const session = sessions.find((candidate) => candidate.id === fable.id);
			if (!session) continue;
			fable.sessionId = typeof session.sessionId === "string" ? session.sessionId : fable.sessionId;
			fable.cwd = typeof session.cwd === "string" ? session.cwd : fable.cwd;
			const state = String(session.state ?? session.status ?? "unknown");
			if (state !== fable.state) {
				fable.state = state;
				fable.updatedAt = Date.now();
				updateWorkerFooter();
			}
			if (["done", "stopped", "error"].includes(state) && !fable.notified) {
				let response: string | undefined;
				if (state === "done") {
					try {
						response = await fableFinalResponse(fable);
					} catch {
						// The transcript may still be flushing; retry on the next timer tick.
						continue;
					}
					if (!response) continue;
				}
				fable.notified = true;
				const message = response
					? `${fable.id} / ${fable.name} finished:\n\n## Fable second opinion\n\n${response}`
					: `${fable.id} / ${fable.name} ${state}.`;
				pi.sendUserMessage(message, { deliverAs: "steer" });
			}
		}
	}

	function startFableTimer() {
		if (fableTimer) return;
		fableTimer = setInterval(() => void refreshFables().catch(() => undefined), 5_000);
	}

	function fableSummary(fable: FableRecord) {
		return `- ${fable.id} (${fable.name})\n  status: ${fable.state}\n  updated: ${ageText(fable.updatedAt)}`;
	}

	function fableListText() {
		return fables.size ? [...fables.values()].map(fableSummary).join("\n") : "No Fable jobs started by this Pi session.";
	}

	pi.on("session_start", async (_event, ctx) => {
		uiContext = ctx;
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestFooterRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(requestFooterRender);
			return {
				dispose() {
					unsubscribe();
					requestFooterRender = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
					for (const entry of ctx.sessionManager.getEntries()) {
						if (entry.type !== "message" || entry.message.role !== "assistant") continue;
						const usage = entry.message.usage;
						input += usage.input;
						output += usage.output;
						cacheRead += usage.cacheRead;
						cacheWrite += usage.cacheWrite;
						cost += usage.cost.total;
					}

					const branch = footerData.getGitBranch();
					const left = `${formatCwd(ctx.cwd)}${branch ? ` (${branch})` : ""}`;
					const clippedRight = truncateToWidth(activeWorkerText(), width, "...");
					const rightWidth = visibleWidth(clippedRight);
					const gap = rightWidth > 0 && rightWidth < width ? 1 : 0;
					const clippedLeft = truncateToWidth(left, Math.max(0, width - rightWidth - gap), "...");
					const firstPadding = " ".repeat(Math.max(0, width - visibleWidth(clippedLeft) - rightWidth));

					const context = ctx.getContextUsage();
					const stats = [
						input ? `↑${formatTokens(input)}` : undefined,
						output ? `↓${formatTokens(output)}` : undefined,
						cacheRead ? `R${formatTokens(cacheRead)}` : undefined,
						cacheWrite ? `W${formatTokens(cacheWrite)}` : undefined,
						cost ? `$${cost.toFixed(3)}` : undefined,
						context ? `${context.percent === null ? "?" : context.percent.toFixed(1) + "%"}/${formatTokens(context.contextWindow)} (auto)` : undefined,
					]
						.filter(Boolean)
						.join(" ");
					const model = ctx.model?.id ?? "no-model";
					const fullModelText = ctx.model?.reasoning ? `${model} • ${ctx.thinkingLevel}` : model;
					const modelText = truncateToWidth(fullModelText, width, "");
					const modelWidth = visibleWidth(modelText);
					const secondGap = modelWidth > 0 && modelWidth < width ? 2 : 0;
					const clippedStats = truncateToWidth(stats, Math.max(0, width - modelWidth - secondGap), "...");
					const secondPadding = " ".repeat(Math.max(0, width - visibleWidth(clippedStats) - modelWidth));

					return [
						theme.fg("dim", clippedLeft + firstPadding + clippedRight),
						theme.fg("dim", clippedStats + secondPadding + modelText),
					];
				},
			};
		});
	});

	pi.registerTool({
		name: "spawn_worker",
		label: "Spawn Worker",
		description:
			"Spawn a background Pi worker agent for a focused implementation/research task. The worker can message the main thread when done or when it needs guidance.",
		promptSnippet: "Spawn a background Pi worker for a focused task.",
		promptGuidelines: [
			"Use spawn_worker when the user wants work to proceed in parallel while the main thread continues design or review.",
			"Do not wait for a worker by polling worker_status, calling sleep, or running any other delay command. Worker messages are delivered automatically as steering messages after the current tool batch; continue other work or end the turn.",
			"When using spawn_worker, include design intent and constraints in the context field so the worker avoids architecture drift.",
			"Workers share the main checkout. For code changes, tell the worker which files it owns and avoid overlapping edits. Use a separate git worktree when isolation is needed.",
			"Model selection: prefer openai-codex/gpt-5.6-sol (low or high) for complex or ambiguous work; use openai-codex/gpt-5.6-terra at high for clear, moderately complex work; use openai-codex/gpt-5.6-luna at high only for simple, precisely defined work. When uncertain, inherit the parent model; briefly explain deliberate model changes.",
		],
		parameters: spawnWorkerSchema,
		async execute(_toolCallId, params: SpawnWorkerInput, signal, _onUpdate, ctx) {
			const workerNumber = nextWorkerNumber++;
			const workerId = `worker-${workerNumber}`;
			const workerName = params.name?.trim() || workerId;
			const parentModel = ctx.model;
			const parentThinkingLevel = pi.getThinkingLevel();
			const workerThinkingLevel = (params.thinkingLevel as ThinkingLevel | undefined) ?? parentThinkingLevel;
			let workerModel = parentModel;

			if (params.model) {
				const slashIndex = params.model.indexOf("/");
				if (slashIndex < 1 || slashIndex === params.model.length - 1) {
					throw new Error(`Invalid worker model "${params.model}". Use "provider/model-id".`);
				}
				const provider = params.model.slice(0, slashIndex);
				const modelId = params.model.slice(slashIndex + 1);
				const resolvedModel = ctx.modelRegistry.find(provider, modelId);
				if (!resolvedModel) throw new Error(`Unknown worker model "${params.model}".`);
				workerModel = resolvedModel;
			}

			const resourceLoader = new DefaultResourceLoader({
				cwd: ctx.cwd,
				agentDir: getAgentDir(),
				extensionFactories: [
					(workerPi) => {
						workerPi.registerTool({
							name: "message_main_thread",
							label: "Message Main Thread",
							description:
								"Send a message back to the main Pi thread. Use this when done, stuck, or needing guidance.",
							promptSnippet: "Message the main thread from a worker agent.",
							promptGuidelines: [
								"Worker agents should call message_main_thread when they finish their task, need guidance, or discover an important design issue.",
							],
							parameters: Type.Object({
								message: Type.String({
									description: "The message to send to the main thread.",
								}),
								kind: Type.Optional(
									StringEnum(["note", "done", "question"] as const, {
										description: "Optional loose message category.",
									}),
								),
							}),
							async execute(_id, report) {
								const kind = report.kind ? ` (${report.kind})` : "";
								const current = workers.get(workerId);
								if (report.kind === "done" && current) current.completionReported = true;
								pi.sendUserMessage(
									`Message from ${workerId} / ${workerName}${kind}:\n\n${report.message}`,
									{ deliverAs: "steer" },
								);
								return {
									content: [{ type: "text", text: "Sent to the main thread." }],
									details: {},
								};
							},
						});
					},
				],
			});
			await resourceLoader.reload();

			const { session } = await createAgentSession({
				cwd: ctx.cwd,
				model: workerModel,
				thinkingLevel: workerThinkingLevel,
				tools: params.tools ?? ["read", "write", "edit", "bash", "grep", "find", "ls", "message_main_thread"],
				resourceLoader,
				sessionManager: SessionManager.create(ctx.cwd),
			});

			const worker: WorkerRecord = {
				id: workerId,
				name: workerName,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				status: "starting",
				lastMessage: "Worker session created.",
				completionReported: false,
				log: [],
				session,
				unsubscribe: () => {},
				dispose: () => {
					worker.unsubscribe();
					worker.status = "disposed";
					session.dispose();
				},
			};

			worker.unsubscribe = session.subscribe((event: any) => {
				const current = workers.get(workerId);
				if (!current || current.status === "aborted" || current.status === "disposed") return;

				switch (event.type) {
					case "agent_start":
						current.currentTool = undefined;
						markWorker(current, "running", event.type, "Agent started.");
						break;
					case "turn_start":
						current.currentTool = undefined;
						markWorker(current, "thinking", event.type, `Turn ${event.turnIndex ?? "?"} started.`);
						break;
					case "message_update":
						current.status = "thinking";
						current.updatedAt = Date.now();
						current.lastEvent = event.type;
						if (event.assistantMessageEvent?.type === "text_delta") {
							const delta = event.assistantMessageEvent.delta ?? "";
							if (delta.trim()) pushWorkerLog(current, event.type, delta, { coalesce: true });
						}
						updateWorkerFooter();
						break;
					case "tool_execution_start":
						current.currentTool = event.toolName;
						markWorker(current, "tool", event.type, `Running tool: ${event.toolName}`);
						break;
					case "tool_execution_update":
						current.updatedAt = Date.now();
						current.lastEvent = event.type;
						break;
					case "tool_execution_end":
						current.currentTool = undefined;
						markWorker(
							current,
							"running",
							event.type,
							`${event.toolName} ${event.isError ? "failed" : "finished"}.`,
						);
						break;
					case "agent_end": {
						current.currentTool = undefined;
						markWorker(current, "done", event.type, "Agent finished.");
						if (!current.completionReported) {
							current.completionReported = true;
							const summary = finalAssistantText(event.messages ?? []);
							pi.sendUserMessage(
								`${workerId} / ${workerName} finished${summary ? `:\n\n${summary}` : " without a final summary."}`,
								{ deliverAs: "steer" },
							);
						}
						break;
					}
					default:
						current.updatedAt = Date.now();
						current.lastEvent = event.type;
				}
			});
			pushWorkerLog(worker, "created", "Worker session created.");
			workers.set(workerId, worker);
			updateWorkerFooter();
			startStaleTimer();

			const kickoff = [
				`You are ${workerId} / ${workerName}, a background worker agent spawned by a main Pi thread.`,
				"Work independently on the focused task below.",
				"Keep changes narrow and avoid speculative abstractions.",
				"When you finish, need guidance, or discover a design issue, call message_main_thread.",
				params.context ? `\nContext from main thread:\n${params.context}` : undefined,
				`\nTask:\n${params.task}`,
			]
				.filter(Boolean)
				.join("\n\n");

			void session.prompt(kickoff).catch((error) => {
				const current = workers.get(workerId);
				const message = error instanceof Error ? error.message : String(error);
				if (current) {
					current.error = signal?.aborted ? undefined : message;
					current.currentTool = undefined;
					markWorker(
						current,
						signal?.aborted ? "aborted" : "error",
						signal?.aborted ? "aborted" : "prompt_error",
						signal?.aborted ? "Worker cancelled with spawning tool." : message,
					);
				}
				if (!signal?.aborted) {
					pi.sendUserMessage(`${workerId} / ${workerName} failed: ${message}`, { deliverAs: "followUp" });
				}
			});

			const workerRequest = {
				name: workerName,
				task: params.task,
				context: params.context,
				tools: params.tools ?? ["read", "write", "edit", "bash", "grep", "find", "ls", "message_main_thread"],
				model: formatModel(workerModel),
				thinkingLevel: workerThinkingLevel,
				kickoffPrompt: kickoff,
			};

			return {
				content: [
					{
						type: "text",
						text: [
							`${workerId} (${workerName})`,
							`${formatModel(workerModel)} ${workerThinkingLevel}`,
							"",
							params.task,
						].join("\n"),
					},
				],
				details: { workerId, workerName, ...workerRequest },
			};
		},
	});

	pi.registerTool({
		name: "send_to_worker",
		label: "Send To Worker",
		description: "Send a message or follow-up instruction to a background worker spawned by spawn_worker.",
		promptSnippet: "Send a message to a background worker.",
		promptGuidelines: [
			"Use send_to_worker to reply to a worker after it messages the main thread or when the user wants to redirect worker work.",
			"After sending, do not wait for the worker by polling worker_status, calling sleep, or running any other delay command. Continue other work or end the turn; the worker response will arrive automatically.",
		],
		parameters: sendToWorkerSchema,
		async execute(_toolCallId, params) {
			const worker = workers.get(params.worker_id);
			if (!worker) {
				throw new Error(`Unknown worker ${params.worker_id}. Known workers:\n${workerListText()}`);
			}

			worker.completionReported = false;
			worker.error = undefined;
			markWorker(worker, "starting", "follow_up", "Follow-up queued.");
			const markFollowUpError = (error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				worker.error = message;
				worker.currentTool = undefined;
				markWorker(worker, "error", "follow_up_error", message);
				return message;
			};
			if (worker.session.isStreaming) {
				try {
					await worker.session.followUp(params.message);
				} catch (error) {
					markFollowUpError(error);
					throw error;
				}
			} else {
				void worker.session.prompt(params.message).catch((error) => {
					const message = markFollowUpError(error);
					pi.sendUserMessage(`${worker.id} / ${worker.name} failed after follow-up: ${message}`, {
						deliverAs: "followUp",
					});
				});
			}

			return {
				content: [
					{
						type: "text",
						text: [`${worker.id} (${worker.name})`, "", params.message].join("\n"),
					},
				],
				details: { workerId: worker.id, workerName: worker.name, message: params.message },
			};
		},
	});

	pi.registerTool({
		name: "spawn_fable",
		label: "Spawn Fable",
		description:
			"Start a read-only Fable second opinion. Fable specializes in improving code beyond bug fixes: simplifying implementations, designing clearer interfaces, removing unnecessary state and abstractions, removing unnecessary defensive fallbacks or backward-compatibility code, and finding more elegant approaches.",
		promptSnippet: "Start a requested Fable second opinion in the background.",
		promptGuidelines: [
			"Use spawn_fable only when the user explicitly requests Fable or a Fable second opinion; never invoke it proactively.",
			"After spawn_fable returns, continue other work or end the turn. Do not poll or wait; completion is delivered automatically.",
		],
		parameters: spawnFableSchema,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const name = params.name?.trim() || "Fable second opinion";
			const prompt = [
				"Analyze this as an independent second opinion.",
				"Do not modify files. Inspect the workspace only when useful.",
				"Review for correctness, but you must also look beyond bug fixes: find simplifications, better interfaces, less state and code, and a more elegant overall design. Prefer concrete improvements.",
				"Look specifically for defensive fallback paths and compatibility shims that add complexity. We own the whole system and its deployment, so prefer coordinated changes over fallbacks and do not preserve backward compatibility unless the task explicitly requires it.",
				"Be concise, identify uncertainties, and give actionable recommendations.",
				params.context ? `Context:\n${params.context}` : undefined,
				`Task:\n${params.task}`,
			]
				.filter(Boolean)
				.join("\n\n");
			const args = [
				"--bg",
				"--model",
				"fable",
				"--effort",
				"medium",
				"--permission-mode",
				"plan",
				"--name",
				name,
				prompt,
			];
			const result = await pi.exec("claude", args, { signal, timeout: 30_000, cwd: ctx.cwd });
			if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || "Claude failed to start Fable.");
			const match = result.stdout.match(/backgrounded\s*[·:]\s*([a-z0-9-]+)/i);
			if (!match) throw new Error(`Fable started but its id could not be parsed:\n${result.stdout.trim()}`);
			const id = match[1];
			const now = Date.now();
			const fable: FableRecord = { id, name, createdAt: now, updatedAt: now, state: "running", notified: false };
			fables.set(id, fable);
			startFableTimer();
			updateWorkerFooter();
			const fableRequest = {
				name,
				task: params.task,
				context: params.context,
				model: "anthropic/claude-fable-5",
				effort: "medium",
				permissionMode: "plan",
				cwd: ctx.cwd,
				kickoffPrompt: prompt,
			};
			return {
				content: [
					{
						type: "text",
						text: [
							`${id} (${name})`,
							"anthropic/claude-fable-5 medium",
							"",
							params.task,
						].join("\n"),
					},
				],
				details: {
					fableId: id,
					fableName: name,
					...fableRequest,
					command: ["claude", ...args.slice(0, -1), "<prompt>"],
				},
			};
		},
	});

	pi.registerTool({
		name: "fable_status",
		label: "Fable Status",
		description: "Refresh and show Fable jobs started by this Pi session.",
		parameters: fableStatusSchema,
		async execute(_toolCallId, params): Promise<any> {
			await refreshFables();
			if (!params.fable_id) return { content: [{ type: "text", text: fableListText() }], details: { fables: [...fables.values()] } };
			const fable = fables.get(params.fable_id);
			if (!fable) throw new Error(`Unknown Fable id ${params.fable_id}.\n${fableListText()}`);
			return { content: [{ type: "text", text: fableSummary(fable) }], details: { fable } };
		},
	});

	pi.registerTool({
		name: "abort_fable",
		label: "Abort Fable",
		description: "Stop a Fable background job while preserving its Claude conversation.",
		parameters: fableIdSchema,
		async execute(_toolCallId, params, signal) {
			const fable = fables.get(params.fable_id);
			if (!fable) throw new Error(`Unknown Fable id ${params.fable_id}.\n${fableListText()}`);
			const result = await pi.exec("claude", ["stop", fable.id], { signal, timeout: 15_000 });
			if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Could not stop Fable ${fable.id}.`);
			fable.state = "stopped";
			fable.updatedAt = Date.now();
			fable.notified = true;
			updateWorkerFooter();
			return { content: [{ type: "text", text: `Stopped Fable ${fable.id} (${fable.name}).` }], details: { fable } };
		},
	});

	pi.registerTool({
		name: "worker_status",
		label: "Worker Status",
		description: "Show status for all background workers or one worker.",
		promptSnippet: "Inspect background worker status.",
		parameters: workerStatusSchema,
		async execute(_toolCallId, params): Promise<any> {
			if (params.worker_id) {
				const worker = workers.get(params.worker_id);
				if (!worker) throw new Error(`Unknown worker ${params.worker_id}. Known workers:\n${workerListText()}`);
				return { content: [{ type: "text", text: workerSummary(worker) }], details: { worker: workerDetails(worker), workers: [] } };
			}
			return { content: [{ type: "text", text: workerListText() }], details: { worker: undefined, workers: [...workers.values()].map(workerDetails) } };
		},
	});

	pi.registerTool({
		name: "peek_worker",
		label: "Peek Worker",
		description: "Show recent event/transcript log entries for a background worker.",
		promptSnippet: "Peek at recent worker activity.",
		parameters: peekWorkerSchema,
		async execute(_toolCallId, params) {
			const worker = workers.get(params.worker_id);
			if (!worker) throw new Error(`Unknown worker ${params.worker_id}. Known workers:\n${workerListText()}`);
			const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
			const entries = worker.log.slice(-limit);
			return { content: [{ type: "text", text: formatWorkerLog(entries) }], details: { workerId: worker.id, entries } };
		},
	});

	pi.registerTool({
		name: "abort_worker",
		label: "Abort Worker",
		description: "Abort a running background worker.",
		promptSnippet: "Abort a background worker.",
		parameters: abortWorkerSchema,
		async execute(_toolCallId, params) {
			const worker = workers.get(params.worker_id);
			if (!worker) throw new Error(`Unknown worker ${params.worker_id}. Known workers:\n${workerListText()}`);
			await worker.session.abort();
			worker.currentTool = undefined;
			markWorker(worker, "aborted", "aborted", "Worker aborted by main thread.");
			return { content: [{ type: "text", text: `Aborted ${worker.id} (${worker.name}).` }], details: { workerId: worker.id } };
		},
	});

	pi.registerCommand("workers", {
		description: "List background worker agents created by spawn_worker.",
		handler: async (_args, ctx) => {
			ctx.ui.notify(workerListText(), "info");
		},
	});

	pi.registerCommand("worker", {
		description: "Show recent log entries for a worker. Usage: /worker worker-1",
		handler: async (args, ctx) => {
			const workerId = args.trim();
			if (!workerId) return ctx.ui.notify("Usage: /worker worker-1", "info");
			const worker = workers.get(workerId);
			if (!worker) return ctx.ui.notify(`Unknown worker ${workerId}.\n${workerListText()}`, "error");
			const entries = worker.log.slice(-50);
			ctx.ui.notify(formatWorkerLog(entries), "info");
		},
	});

	pi.on("session_shutdown", async () => {
		if (staleTimer) clearInterval(staleTimer);
		if (fableTimer) clearInterval(fableTimer);
		staleTimer = undefined;
		fableTimer = undefined;
		uiContext?.ui.setFooter(undefined);
		uiContext = undefined;
		requestFooterRender = undefined;
		for (const worker of workers.values()) worker.dispose();
		workers.clear();
	});
}
