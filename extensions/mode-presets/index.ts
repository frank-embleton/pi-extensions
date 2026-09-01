import {
	CustomEditor,
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionContext,
	keyHint,
	getSelectListTheme,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { Container, Input, SelectList, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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
const thinkingLevels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const manualModelChoice = "Enter provider/model manually…";
const legacyWidgetIds = ["mode-preset", "special-mode"] as const;

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

/** Like ctx.ui.select, but with the cursor starting on `initial` (when present). */
function promptSelect(
	ctx: ExtensionContext,
	title: string,
	options: string[],
	initial?: string,
): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((_tui, theme, keybindings, done) => {
		const list = new SelectList(
			options.map((value) => ({ value, label: value })),
			Math.min(options.length, 12),
			getSelectListTheme(),
		);
		const initialIndex = initial === undefined ? -1 : options.indexOf(initial);
		if (initialIndex >= 0) list.setSelectedIndex(initialIndex);
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

	let activeModeName: string | undefined;
	let requestRender: (() => void) | undefined;

	function syncModeDisplay(ctx: ExtensionContext) {
		const model = ctx.model;
		const thinking = pi.getThinkingLevel();
		activeModeName = modes.find(
			(mode) => model?.provider === mode.provider && model.id === mode.model && thinking === mode.thinking,
		)?.name;

		for (const id of legacyWidgetIds) ctx.ui.setWidget(id, undefined);
		requestRender?.();
	}

	async function applyMode(mode: ModePreset, ctx: ExtensionContext) {
		const model = ctx.modelRegistry.find(mode.provider, mode.model);
		if (!model) return ctx.ui.notify(`Could not find ${mode.provider}/${mode.model}`, "error");
		if (!(await pi.setModel(model))) return ctx.ui.notify(`No auth/API key for ${mode.provider}/${mode.model}`, "error");

		pi.setThinkingLevel(mode.thinking);
		activeModeName = mode.name;
		requestRender?.();
		ctx.ui.notify(`${mode.name}: ${mode.model}, thinking:${mode.thinking}`, "info");
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
		let choice = await promptSelect(ctx, "Model", [...known, manualModelChoice], currentKey);
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
			thinkingLevels,
			existing?.thinking ?? pi.getThinkingLevel(),
		)) as ThinkingLevel | undefined;
		if (!thinking) return;

		const colorInput = await promptText(ctx, "Theme color (optional, empty for thinking-level color)", existing?.color ?? "");
		if (colorInput === undefined) return;

		const next = { name, provider, model, thinking, color: (colorInput.trim() || undefined) as ThemeColor | undefined };
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
					const labels = modes.map(describeMode);
					const picked = await ctx.ui.select("Edit which preset?", labels);
					const mode = picked === undefined ? undefined : modes[labels.indexOf(picked)];
					if (mode) await editMode(ctx, mode);
				}
				if (action === "delete preset") {
					const labels = modes.map(describeMode);
					const picked = await ctx.ui.select("Delete which preset?", labels);
					const mode = picked === undefined ? undefined : modes[labels.indexOf(picked)];
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

	pi.on("thinking_level_select", (_event, ctx) => syncModeDisplay(ctx));
	pi.on("model_select", (_event, ctx) => syncModeDisplay(ctx));

	pi.on("session_start", (_event, ctx) => {
		class ModePresetEditor extends CustomEditor {
			render(width: number): string[] {
				const lines = super.render(width);
				if (lines.length < 2 || !activeModeName) return lines;

				const mode = modes.find((mode) => mode.name === activeModeName);
				const labelColor = mode?.color ?? (mode ? thinkingColors[mode.thinking] : "accent");
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
		requestRender = undefined;
	});
}
