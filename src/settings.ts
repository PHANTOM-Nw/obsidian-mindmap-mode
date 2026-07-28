import { PluginSettingTab, Setting } from "obsidian";
import type { App, SettingDefinitionControl, SettingDefinitionItem } from "obsidian";
import type { NodeSource, RootPolicy } from "./model/types.ts";
import type MindmapPlugin from "./main.ts";

export type LayoutMode = "balanced" | "right";
export type WheelMode = "zoom" | "pan";

export interface MindmapSettings {
	source: NodeSource;
	maxHeadingDepth: number;
	rootPolicy: RootPolicy;
	layout: LayoutMode;
	indentUnit: "auto" | "two" | "four" | "tab";
	wheel: WheelMode;
	branchColors: boolean;
	showBodyNodes: boolean;
	maxNodeWidth: number;
	horizontalGap: number;
	verticalGap: number;
	addHeaderButton: boolean;
}

export const DEFAULT_SETTINGS: MindmapSettings = {
	source: "headings-and-lists",
	maxHeadingDepth: 6,
	rootPolicy: "auto",
	layout: "balanced",
	indentUnit: "auto",
	wheel: "zoom",
	branchColors: true,
	showBodyNodes: true,
	maxNodeWidth: 340,
	horizontalGap: 64,
	verticalGap: 14,
	addHeaderButton: true,
};

/** Returns the literal indent string, or the sentinel `"auto"`. */
export function resolveIndentUnit(settings: MindmapSettings): string {
	switch (settings.indentUnit) {
		case "two":
			return "  ";
		case "four":
			return "    ";
		case "tab":
			return "\t";
		default:
			return "auto";
	}
}

type SettingKey = keyof MindmapSettings;

/** The one setting that redraws the note header rather than the open maps. */
const HEADER_BUTTON_KEY: SettingKey = "addHeaderButton";

interface SettingGroup {
	heading: string;
	items: SettingDefinitionControl<SettingKey>[];
}

/**
 * Every setting, declared once.
 *
 * Obsidian 1.13 renders a settings tab from `getSettingDefinitions()` and skips
 * `display()` entirely when it returns something; older versions know only
 * `display()`. Both paths below read this array, so the two renderings cannot
 * drift, and `minAppVersion` stays at 1.5.0 while 1.13 users still get their
 * settings indexed for search.
 */
const GROUPS: SettingGroup[] = [
	{
		heading: "Structure",
		items: [
			{
				name: "Nodes come from",
				desc: "Which markdown structures become cards on the map.",
				control: {
					type: "dropdown",
					key: "source",
					options: {
						"headings-and-lists": "Headings and list items",
						"headings-only": "Headings only",
						"lists-only": "List items only",
					},
				},
			},
			{
				name: "Deepest heading level",
				desc: "Headings below this level stay in the note as body content.",
				control: { type: "slider", key: "maxHeadingDepth", min: 1, max: 6, step: 1 },
			},
			{
				name: "Root node",
				desc: "Auto uses a lone top-level heading when the note has one, and the file name otherwise.",
				control: {
					type: "dropdown",
					key: "rootPolicy",
					options: {
						auto: "Auto",
						filename: "Always the file name",
						h1: "Always the first H1",
					},
				},
			},
			{
				name: "Indent for new list items",
				desc: "Auto copies whatever the note already uses.",
				control: {
					type: "dropdown",
					key: "indentUnit",
					options: {
						auto: "Auto-detect",
						two: "Two spaces",
						four: "Four spaces",
						tab: "Tab",
					},
				},
			},
		],
	},
	{
		heading: "Appearance",
		items: [
			{
				name: "Layout",
				desc: "Balanced splits top-level branches to both sides of the root.",
				control: {
					type: "dropdown",
					key: "layout",
					options: {
						balanced: "Balanced (both sides)",
						right: "Single side (right)",
					},
				},
			},
			{
				name: "Colour branches",
				desc: "Give each top-level branch its own colour.",
				control: { type: "toggle", key: "branchColors" },
			},
			{
				name: "Show note content",
				desc: "Paragraphs, code blocks and tables become their own cards, so they fold and unfold with the branch they belong to. Use the expand button on a card to see the whole block rendered, or double-click it to edit.",
				control: { type: "toggle", key: "showBodyNodes" },
			},
			{
				name: "Maximum card width",
				control: { type: "slider", key: "maxNodeWidth", min: 140, max: 520, step: 20 },
			},
			{
				name: "Horizontal spacing",
				control: { type: "slider", key: "horizontalGap", min: 24, max: 160, step: 4 },
			},
			{
				name: "Vertical spacing",
				control: { type: "slider", key: "verticalGap", min: 4, max: 60, step: 2 },
			},
		],
	},
	{
		heading: "Behaviour",
		items: [
			{
				name: "Mouse wheel",
				control: {
					type: "dropdown",
					key: "wheel",
					options: {
						zoom: "Zooms (hold Shift to pan)",
						pan: "Pans (hold Ctrl to zoom)",
					},
				},
			},
			{
				name: "Button in the note header",
				desc: "Adds a mind map toggle beside the other view actions. The command and ribbon icon work either way.",
				control: { type: "toggle", key: HEADER_BUTTON_KEY },
			},
		],
	},
];

export class MindmapSettingTab extends PluginSettingTab {
	private readonly plugin: MindmapPlugin;

	constructor(app: App, plugin: MindmapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// --- Obsidian 1.13 and later ------------------------------------------------

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return GROUPS.map((group) => ({
			type: "group" as const,
			heading: group.heading,
			items: group.items,
		}));
	}

	/**
	 * Writes the value rather than delegating to `super`. The base implementation
	 * would do the same thing, but calling it is a call into an API newer than
	 * `minAppVersion`, which the directory's review rejects -- and rightly, since
	 * on 1.12 there would be nothing there to call. Overriding a method Obsidian
	 * calls into is free; calling one it may not have is not.
	 */
	override async setControlValue(key: string, value: unknown): Promise<void> {
		await this.commit(key, value);
	}

	// --- Obsidian 1.12 and earlier ----------------------------------------------

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		for (const group of GROUPS) {
			new Setting(containerEl).setName(group.heading).setHeading();
			for (const item of group.items) this.renderItem(containerEl, item);
		}
	}

	private renderItem(
		containerEl: HTMLElement,
		item: SettingDefinitionControl<SettingKey>,
	): void {
		const setting = new Setting(containerEl).setName(item.name);
		if (typeof item.desc === "string") setting.setDesc(item.desc);

		const control = item.control;
		const commit = (value: string | number | boolean): Promise<void> =>
			this.commit(control.key, value);

		switch (control.type) {
			case "dropdown":
				setting.addDropdown((d) =>
					d
						.addOptions(control.options)
						.setValue(String(this.read(control.key)))
						.onChange(commit),
				);
				break;
			case "toggle":
				setting.addToggle((t) => t.setValue(this.read(control.key) === true).onChange(commit));
				break;
			case "slider":
				setting.addSlider((s) =>
					s
						.setLimits(control.min, control.max, control.step)
						.setValue(Number(this.read(control.key)))
						.onChange(commit),
				);
				break;
			default:
				// No other control type appears in GROUPS.
				break;
		}
	}

	// --- shared ------------------------------------------------------------------

	/** The single write path, whichever renderer collected the value. */
	private async commit(key: string, value: unknown): Promise<void> {
		this.store[key] = value;
		await this.plugin.saveSettings();
		this.applySideEffects(key);
	}

	private applySideEffects(key: string): void {
		if (key === HEADER_BUTTON_KEY) this.plugin.refreshHeaderButtons();
		else this.plugin.refreshAllViews();
	}

	/**
	 * Each key is paired with a control whose value type matches it, but the
	 * pairing lives in the definitions rather than in the type, so the settings
	 * object is indexed as a bag of unknowns here and nowhere else.
	 */
	private get store(): Record<string, unknown> {
		return this.plugin.settings as unknown as Record<string, unknown>;
	}

	private read(key: SettingKey): unknown {
		return this.store[key];
	}
}
