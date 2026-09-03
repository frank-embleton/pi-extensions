import {
	CustomEditor,
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionContext,
	keyHint,
	getSelectListTheme,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { Container, Input, type SelectItem, SelectList, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

type ModePreset = {
	name: string;
	provider: string;
	model: string;
	thinking: ThinkingLevel;
	color?: ThemeColor;
};

const defaultModes: ModePreset[] = [
	{ name: "rush", provider: "openai-codex", model: "gpt-5.5", thinking: "off", color: "warning" },
	{ name: "regular", provider: "openai-codex", model: "gpt-5.5", thinking: "low" },
];
const presetFile = join(homedir(), ".pi/agent/mode-presets.json");
const selectionFile = join(homedir(), ".pi/agent/mode-presets-selection.json");
const thinkingLevels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const manualModelChoice = "Enter provider/model manually…";
const defaultColorChoice = "Default (thinking-level color)";
const themeColors = [
	"accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text", "thinkingText",
	"searchMatchText", "userMessageText", "customMessageText", "customMessageLabel", "toolTitle", "toolOutput", "mdHeading", "mdLink",
	"mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet", "toolDiffAdded",
	"toolDiffRemoved", "toolDiffContext", "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber",
	"syntaxType", "syntaxOperator", "syntaxPunctuation", "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh",
	"thinkingXhigh", "thinkingMax", "bashMode",
] as const satisfies readonly ThemeColor[];
const themeColorSet = new Set<string>(themeColors);

/** RGB (0–255) of a foreground ANSI sequence: truecolor or the xterm 256-color cube/grays. Undefined for the 16 named colors. */
function ansiRgb(ansi: string): [number, number, number] | undefined {
	const rgb = ansi.match(/\[38;2;(\d+);(\d+);(\d+)m/);
	if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
	const index = Number(ansi.match(/\[38;5;(\d+)m/)?.[1] ?? -1);
	if (index >= 232) return [8 + (index - 232) * 10, 8 + (index - 232) * 10, 8 + (index - 232) * 10];
	if (index >= 16) {
		const levels = [0, 95, 135, 175, 215, 255];
		const cube = index - 16;
		return [levels[Math.floor(cube / 36)]!, levels[Math.floor(cube / 6) % 6]!, levels[cube % 6]!];
	}
	return undefined;
}

/** Sort chromatic colors around the color wheel, then grays by lightness, then colors the terminal defines. */
function colorSortKey(ansi: string): [number, number, number] {
	const rgb = ansiRgb(ansi);
	if (!rgb) return [2, 0, 0];
	const [red, green, blue] = rgb;
	const max = Math.max(red, green, blue);
	const delta = max - Math.min(red, green, blue);
	if (delta === 0) return [1, 0, max];
	const hue = ((max === red ? (green - blue) / delta : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4) * 60 + 360) % 360;
	return [0, hue, delta];
}

let modes: ModePreset[] = [...defaultModes];

const thinkingColors: Record<ThinkingLevel, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

function modelKey(mode: Pick<ModePreset, "provider" | "model">): string {
	return `${mode.provider}/${mode.model}`;
}

function describeMode(mode: ModePreset): string {
	return `${mode.name} (${modelKey(mode)}:${mode.thinking})`;
}

/** Like ctx.ui.input, but the field starts filled with `initial` so it can be edited in place. */
function promptText(ctx: ExtensionContext, title: string, initial: string): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((_tui, theme, keybindings, done) => {
		const input = new Input();
		input.setValue(initial);

		class PrefilledInput extends Container {
			private _focused = false;
			get focused() {
				return this._focused;
			}
			set focused(value: boolean) {
				this._focused = value;
				input.focused = value;
			}
			handleInput(data: string) {
				if (keybindings.matches(data, "tui.select.confirm") || data === "\n") done(input.getValue());
				else if (keybindings.matches(data, "tui.select.cancel")) done(undefined);
				else input.handleInput(data);
			}
		}

		const border = (text: string) => theme.fg("borderMuted", text);
		const component = new PrefilledInput();
		component.addChild(new DynamicBorder(border));
		component.addChild(new Spacer(1));
		component.addChild(new Text(theme.fg("accent", title), 1, 0));
		component.addChild(new Spacer(1));
		component.addChild(input);
		component.addChild(new Spacer(1));
		component.addChild(new Text(`${keyHint("tui.select.confirm", "submit")}  ${keyHint("tui.select.cancel", "cancel")}`, 1, 0));
		component.addChild(new Spacer(1));
		component.addChild(new DynamicBorder(border));
		return component;
	});
}

/** Like ctx.ui.select, but with custom labels and the cursor starting on the item whose value is `initial`. */
function promptSelect(ctx: ExtensionContext, title: string, items: SelectItem[], initial?: string): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((_tui, theme, keybindings, done) => {
		const list = new SelectList(items, Math.min(items.length, 12), getSelectListTheme());
		list.setSelectedIndex(items.findIndex((item) => item.value === initial));
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(undefined);

		class PreselectedList extends Container {
			handleInput(data: string) {
				if (keybindings.matches(data, "tui.select.cancel")) done(undefined);
				else list.handleInput(data);
			}
		}

		const border = (text: string) => theme.fg("borderMuted", text);
		const component = new PreselectedList();
		component.addChild(new DynamicBorder(border));
		component.addChild(new Spacer(1));
		component.addChild(new Text(theme.fg("accent", title), 1, 0));
		component.addChild(new Spacer(1));
		component.addChild(list);
		component.addChild(new Spacer(1));
		component.addChild(new DynamicBorder(border));
		return component;
	});
}

/**
 * Pick a theme token, previewing each in its own color. Tokens that resolve to the same color collapse into one
 * row named after the first in `themeColors`. Returns the token, `defaultColorChoice`, or undefined on cancel.
 */
function promptColorSelect(ctx: ExtensionContext, initial?: ThemeColor): Promise<string | undefined> {
	const theme = ctx.ui.theme;
	const byAnsi = new Map<string, ThemeColor>();
	for (const color of themeColors) {
		const ansi = theme.getFgAnsi(color);
		if (!byAnsi.has(ansi)) byAnsi.set(ansi, color);
	}
	const colors = [...byAnsi]
		.map(([ansi, color]) => ({ color, key: colorSortKey(ansi) }))
		.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])
		.map(({ color }) => ({ value: color, label: theme.fg(color, color) }));
	const initialRow = initial && themeColorSet.has(initial) ? byAnsi.get(theme.getFgAnsi(initial)) : undefined;
	return promptSelect(
		ctx,
		"Label color",
		[{ value: defaultColorChoice, label: theme.fg("muted", defaultColorChoice) }, ...colors],
		initialRow ?? defaultColorChoice,
	);
}

/** A substring-searchable selector for large lists such as the model registry. */
function promptSearchSelect(ctx: ExtensionContext, title: string, options: string[], initial?: string): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((_tui, theme, keybindings, done) => {
		const input = new Input();
		const listSlot = new Container();
		let list: SelectList;

		const rebuild = () => {
			const query = input.getValue().toLowerCase();
			const filtered = options.filter((option) => option.toLowerCase().includes(query));
			list = new SelectList(filtered.map((value) => ({ value, label: value })), Math.min(Math.max(filtered.length, 1), 12), getSelectListTheme());
			if (!query) list.setSelectedIndex(filtered.findIndex((option) => option === initial));
			list.onSelect = (item) => done(item.value);
			list.onCancel = () => done(undefined);
			listSlot.clear();
			listSlot.addChild(list);
		};
		rebuild();

		const border = (text: string) => theme.fg("borderMuted", text);
		const component = new Container();
		component.addChild(new DynamicBorder(border));
		component.addChild(new Text(theme.fg("accent", title), 1, 0));
		component.addChild(input);
		component.addChild(listSlot);
		component.addChild(new Text(theme.fg("dim", `Type to search • ↑↓ navigate • ${keyHint("tui.select.confirm", "enter")} select • ${keyHint("tui.select.cancel", "esc")} cancel`), 1, 0));
		component.addChild(new DynamicBorder(border));

		return {
			get focused() { return input.focused; },
			set focused(value: boolean) { input.focused = value; },
			render: (width) => component.render(width),
			invalidate: () => component.invalidate(),
			handleInput: (data) => {
				if (keybindings.matches(data, "tui.select.cancel")) return done(undefined);
				if ((["tui.select.up", "tui.select.down", "tui.select.confirm"] as const).some((key) => keybindings.matches(data, key))) {
					return list.handleInput(data);
				}
				const before = input.getValue();
				input.handleInput(data);
				if (input.getValue() !== before) rebuild();
				else list.handleInput(data);
			},
		};
	});
}

async function loadModes() {
	try {
		modes = JSON.parse(await readFile(presetFile, "utf8"));
	} catch {
		modes = [...defaultModes];
	}
}

async function saveModes() {
	await mkdir(dirname(presetFile), { recursive: true });
	await writeFile(presetFile, `${JSON.stringify(modes, null, "\t")}\n`);
}

type Selection = Pick<ModePreset, "provider" | "model" | "thinking">;

async function loadSelection(): Promise<Selection | undefined> {
	try {
		const value: unknown = JSON.parse(await readFile(selectionFile, "utf8"));
		if (
			typeof value === "object" &&
			value !== null &&
			typeof (value as Selection).provider === "string" &&
			typeof (value as Selection).model === "string" &&
			thinkingLevels.includes((value as Selection).thinking)
		) {
			return value as Selection;
		}
	} catch {
		// No selection has been saved yet.
	}
}

async function saveSelection(selection: Selection) {
	await mkdir(dirname(selectionFile), { recursive: true });
	await writeFile(selectionFile, `${JSON.stringify(selection, null, "\t")}\n`);
}

function rightLabelBorder(label: string, width: number, borderColor: (text: string) => string): string {
	if (width <= 0) return "";
	if (width === 1) return borderColor("─");

	let text = label;
	let textWidth = visibleWidth(text);
	while (textWidth + 5 > width && textWidth > 0) {
		text = truncateToWidth(text, textWidth - 1, "");
		textWidth = visibleWidth(text);
	}

	return `${borderColor("─")}${borderColor("─".repeat(Math.max(0, width - 2 - textWidth)))}${text}${borderColor("─")}`;
}

export default async function modePresets(pi: ExtensionAPI) {
	await loadModes();

	let selection = await loadSelection();
	let activeModeName: string | undefined;
	let requestRender: (() => void) | undefined;
	let sessionStarted = false;

	function syncModeDisplay(ctx: ExtensionContext) {
		const model = ctx.model;
		const thinking = pi.getThinkingLevel();
		activeModeName = modes.find(
			(mode) => model?.provider === mode.provider && model.id === mode.model && thinking === mode.thinking,
		)?.name;

		requestRender?.();
	}

	async function applySelection(next: Selection, ctx: ExtensionContext, label?: string) {
		const model = ctx.modelRegistry.find(next.provider, next.model);
		if (!model) return ctx.ui.notify(`Could not find ${next.provider}/${next.model}`, "error");
		if (!(await pi.setModel(model))) return ctx.ui.notify(`No auth/API key for ${next.provider}/${next.model}`, "error");

		pi.setThinkingLevel(next.thinking);
		selection = next;
		await saveSelection(next);
		requestRender?.();
		if (label) ctx.ui.notify(`${label}: ${next.model}, thinking:${next.thinking}`, "info");
	}

	async function applyMode(mode: ModePreset, ctx: ExtensionContext) {
		await applySelection(mode, ctx, mode.name);
	}

	function persistCurrentSelection(ctx: ExtensionContext) {
		if (!sessionStarted || !ctx.model) return;
		selection = { provider: ctx.model.provider, model: ctx.model.id, thinking: pi.getThinkingLevel() };
		void saveSelection(selection);
	}

	async function pickMode(ctx: ExtensionContext, title: string): Promise<ModePreset | undefined> {
		const labels = modes.map(describeMode);
		const picked = await ctx.ui.select(title, labels);
		return picked === undefined ? undefined : modes[labels.indexOf(picked)];
	}

	async function editMode(ctx: ExtensionContext, existing?: ModePreset) {
		const name = (await promptText(ctx, "Preset name", existing?.name ?? ""))?.trim();
		if (!name) return;
		if (modes.some((mode) => mode !== existing && mode.name === name)) {
			ctx.ui.notify(`Preset already exists: ${name}`, "error");
			return;
		}

		// Pick from known models so the exact provider/model id never has to be remembered.
		const current = existing ?? (ctx.model ? { provider: ctx.model.provider, model: ctx.model.id } : undefined);
		const currentKey = current ? modelKey(current) : undefined;
		const known = [...new Set(ctx.modelRegistry.getAll().map((m) => `${m.provider}/${m.id}`))].sort();
		let choice = await promptSearchSelect(ctx, "Model", [...known, manualModelChoice], currentKey);
		if (!choice) return;
		if (choice === manualModelChoice) {
			choice = (await promptText(ctx, "Model (provider/model-id)", currentKey ?? ""))?.trim();
			if (!choice) return;
		}
		const slash = choice.indexOf("/");
		if (slash <= 0 || slash === choice.length - 1) {
			ctx.ui.notify(`Expected provider/model-id, got: ${choice}`, "error");
			return;
		}
		const provider = choice.slice(0, slash);
		const model = choice.slice(slash + 1);

		const thinking = (await promptSelect(
			ctx,
			"Thinking level",
			thinkingLevels.map((value) => ({ value, label: value })),
			existing?.thinking ?? pi.getThinkingLevel(),
		)) as ThinkingLevel | undefined;
		if (!thinking) return;

		const colorChoice = await promptColorSelect(ctx, existing?.color);
		if (!colorChoice) return;
		const color = colorChoice === defaultColorChoice ? undefined : (colorChoice as ThemeColor);

		const next = { name, provider, model, thinking, color };
		if (existing) Object.assign(existing, next);
		else modes.push(next);
		await saveModes();
		syncModeDisplay(ctx);
		ctx.ui.notify(`Saved preset: ${name}`, "info");
	}

	pi.registerCommand("modes", {
		description: "Manage mode presets",
		async handler(_args, ctx) {
			while (true) {
				const choices = [
					...modes.map((mode, i) => `${i + 1}. apply ${describeMode(mode)}`),
					"add preset",
					"edit preset",
					"delete preset",
					"reload presets",
				];
				const action = await ctx.ui.select("Mode presets", choices);
				if (!action) return;

				const applyIndex = choices.indexOf(action);
				if (applyIndex >= 0 && applyIndex < modes.length) {
					await applyMode(modes[applyIndex]!, ctx);
					return;
				}
				if (action === "add preset") await editMode(ctx);
				if (action === "edit preset") {
					const mode = await pickMode(ctx, "Edit which preset?");
					if (mode) await editMode(ctx, mode);
				}
				if (action === "delete preset") {
					const mode = await pickMode(ctx, "Delete which preset?");
					if (mode && (await ctx.ui.confirm("Delete preset?", describeMode(mode)))) {
						modes = modes.filter((other) => other !== mode);
						await saveModes();
						syncModeDisplay(ctx);
					}
				}
				if (action === "reload presets") {
					await loadModes();
					syncModeDisplay(ctx);
					ctx.ui.notify("Reloaded mode presets", "info");
				}
			}
		},
	});

	pi.registerShortcut("ctrl+q", {
		description: "Cycle mode presets",
		async handler(ctx) {
			if (modes.length === 0) {
				ctx.ui.notify("No mode presets configured", "warning");
				return;
			}

			// Resync first so manually landing on a preset participates in the cycle.
			syncModeDisplay(ctx);
			await applyMode(modes[(modes.findIndex((mode) => mode.name === activeModeName) + 1) % modes.length]!, ctx);
		},
	});

	pi.on("thinking_level_select", (_event, ctx) => {
		persistCurrentSelection(ctx);
		syncModeDisplay(ctx);
	});
	pi.on("model_select", (_event, ctx) => {
		persistCurrentSelection(ctx);
		syncModeDisplay(ctx);
	});

	pi.on("session_start", async (event, ctx) => {
		// Pi starts a new session at its configured default thinking level. Reapply the
		// last chosen model and level, whether or not they belong to a preset.
		if (event.reason === "new" && selection) await applySelection(selection, ctx);
		sessionStarted = true;

		class ModePresetEditor extends CustomEditor {
			render(width: number): string[] {
				const lines = super.render(width);
				if (lines.length < 2 || !activeModeName) return lines;

				const mode = modes.find((mode) => mode.name === activeModeName);
				const labelColor = mode?.color && themeColorSet.has(mode.color) ? mode.color : (mode ? thinkingColors[mode.thinking] : "accent");
				const borderColor = (text: string) => this.borderColor(text);
				const label = `${ctx.ui.theme.fg(labelColor, activeModeName)}${borderColor("─")}`;
				lines[0] = rightLabelBorder(label, width, borderColor);
				return lines;
			}
		}

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			requestRender = () => tui.requestRender();
			return new ModePresetEditor(tui, theme, keybindings);
		});
		syncModeDisplay(ctx);
	});

	pi.on("session_shutdown", () => {
		sessionStarted = false;
		requestRender = undefined;
	});
}
