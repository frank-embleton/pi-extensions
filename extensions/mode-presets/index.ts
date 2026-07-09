import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EditorTheme } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
type ThemeColor = Parameters<EditorTheme["fg"]>[0];

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
const thinkingLevels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const legacyWidgetIds = ["mode-preset", "special-mode"] as const;

let modes: ModePreset[] = [...defaultModes];

const thinkingColors: Record<ThinkingLevel, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
};

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
		const name = await ctx.ui.input("Preset name", existing?.name ?? "");
		if (!name) return;
		if (modes.some((mode) => mode !== existing && mode.name === name)) {
			ctx.ui.notify(`Preset already exists: ${name}`, "error");
			return;
		}

		const provider = await ctx.ui.input("Provider", existing?.provider ?? ctx.model?.provider ?? "");
		if (!provider) return;
		const model = await ctx.ui.input("Model", existing?.model ?? ctx.model?.id ?? "");
		if (!model) return;
		const thinking = (await ctx.ui.select("Thinking level", thinkingLevels)) as ThinkingLevel | undefined;
		if (!thinking) return;
		const colorInput = await ctx.ui.input("Optional theme color", existing?.color ?? "");

		const next = { name, provider, model, thinking, color: (colorInput || undefined) as ThemeColor | undefined };
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
					...modes.map((mode, i) => `${i + 1}. apply ${mode.name} (${mode.provider}/${mode.model}:${mode.thinking})`),
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
					const name = await ctx.ui.select("Edit which preset?", modes.map((mode) => mode.name));
					const mode = modes.find((mode) => mode.name === name);
					if (mode) await editMode(ctx, mode);
				}
				if (action === "delete preset") {
					const name = await ctx.ui.select("Delete which preset?", modes.map((mode) => mode.name));
					if (name && (await ctx.ui.confirm("Delete preset?", name))) {
						modes = modes.filter((mode) => mode.name !== name);
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
