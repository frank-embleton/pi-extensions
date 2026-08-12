import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	DefaultResourceLoader,
	SessionManager,
	createAgentSession,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
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
				'Optional model for the worker as "provider/model-id". Defaults to the parent thread\'s current model; use the same model unless the user explicitly asks for a different one.',
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

export default function subagents(pi: ExtensionAPI) {
	const workers = new Map<string, WorkerRecord>();
	let nextWorkerNumber = 1;

	let staleTimer: ReturnType<typeof setInterval> | undefined;

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

	function markWorker(worker: WorkerRecord, status: WorkerStatus, event: string, text: string) {
		worker.status = status;
		worker.updatedAt = Date.now();
		worker.lastEvent = event;
		worker.lastMessage = text;
		pushWorkerLog(worker, event, text);
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
					markWorker(worker, "stalled", "stalled", "No worker activity for more than 120s.");
				}
			}
		}, 10_000);
	}

	pi.registerTool({
		name: "spawn_worker",
		label: "Spawn Worker",
		description:
			"Spawn a background Pi worker agent for a focused implementation/research task. The worker can message the main thread when done or when it needs guidance.",
		promptSnippet: "Spawn a background Pi worker for a focused task.",
		promptGuidelines: [
			"Use spawn_worker when the user wants work to proceed in parallel while the main thread continues design or review.",
			"Do not poll worker_status in a loop. Worker messages are delivered automatically as steering messages after the current tool batch.",
			"When using spawn_worker, include design intent and constraints in the context field so the worker avoids architecture drift.",
			"Use the parent thread's current model for spawn_worker unless the user explicitly asks for a different model or you have a strong reason and explain it.",
			"Choose worker thinkingLevel by task difficulty: off for mechanical or simple lookup tasks, low for modest reasoning or routine code edits/investigation, and high for hard debugging/design/security/concurrency work where deep reasoning matters.",
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
				if (!current) return;

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
							event.isError ? "error" : "running",
							event.type,
							`${event.toolName} ${event.isError ? "failed" : "finished"}.`,
						);
						break;
					case "agent_end":
						current.currentTool = undefined;
						markWorker(current, "done", event.type, "Agent finished.");
						break;
					default:
						current.updatedAt = Date.now();
						current.lastEvent = event.type;
				}
			});
			pushWorkerLog(worker, "created", "Worker session created.");
			workers.set(workerId, worker);
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
				if (signal?.aborted) return;
				const current = workers.get(workerId);
				const message = error instanceof Error ? error.message : String(error);
				if (current) {
					current.error = message;
					current.currentTool = undefined;
					markWorker(current, "error", "prompt_error", message);
				}
				pi.sendUserMessage(`${workerId} / ${workerName} failed: ${message}`, { deliverAs: "followUp" });
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
							`spawn_worker → ${workerId} (${workerName})`,
							"Worker will message back automatically when done, blocked, or needing guidance; do not poll worker_status.",
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
			"After sending, do not poll worker_status in a loop. Continue other work or end the turn; the worker response will arrive automatically.",
		],
		parameters: sendToWorkerSchema,
		async execute(_toolCallId, params) {
			const worker = workers.get(params.worker_id);
			if (!worker) {
				throw new Error(`Unknown worker ${params.worker_id}. Known workers:\n${workerListText()}`);
			}

			if (worker.session.isStreaming) {
				await worker.session.followUp(params.message);
			} else {
				void worker.session.prompt(params.message).catch((error) => {
					pi.sendUserMessage(
						`${worker.id} / ${worker.name} failed after follow-up: ${
							error instanceof Error ? error.message : String(error)
						}`,
						{ deliverAs: "followUp" },
					);
				});
			}

			return {
				content: [
					{
						type: "text",
						text: `Sent message to ${worker.id} (${worker.name}). Do not poll worker_status; the response will be delivered automatically.`,
					},
				],
				details: { workerId: worker.id, workerName: worker.name },
			};
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
		staleTimer = undefined;
		for (const worker of workers.values()) worker.dispose();
		workers.clear();
	});
}
