import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
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

export function resolveIndentUnit(settings: MindmapSettings): string | "auto" {
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

export class MindmapSettingTab extends PluginSettingTab {
	private readonly plugin: MindmapPlugin;

	constructor(app: App, plugin: MindmapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const save = async (): Promise<void> => {
			await this.plugin.saveSettings();
			this.plugin.refreshAllViews();
		};

		new Setting(containerEl).setName("Structure").setHeading();

		new Setting(containerEl)
			.setName("Nodes come from")
			.setDesc("Which markdown structures become cards on the map.")
			.addDropdown((d) =>
				d
					.addOption("headings-and-lists", "Headings and list items")
					.addOption("headings-only", "Headings only")
					.addOption("lists-only", "List items only")
					.setValue(this.plugin.settings.source)
					.onChange(async (value) => {
						this.plugin.settings.source = value as NodeSource;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Deepest heading level")
			.setDesc("Headings below this level stay in the note as body content.")
			.addSlider((s) =>
				s
					.setLimits(1, 6, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.maxHeadingDepth)
					.onChange(async (value) => {
						this.plugin.settings.maxHeadingDepth = value;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Root node")
			.setDesc(
				"Auto uses a lone top-level heading when the note has one, and the file name otherwise.",
			)
			.addDropdown((d) =>
				d
					.addOption("auto", "Auto")
					.addOption("filename", "Always the file name")
					.addOption("h1", "Always the first H1")
					.setValue(this.plugin.settings.rootPolicy)
					.onChange(async (value) => {
						this.plugin.settings.rootPolicy = value as RootPolicy;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Indent for new list items")
			.setDesc("Auto copies whatever the note already uses.")
			.addDropdown((d) =>
				d
					.addOption("auto", "Auto-detect")
					.addOption("two", "Two spaces")
					.addOption("four", "Four spaces")
					.addOption("tab", "Tab")
					.setValue(this.plugin.settings.indentUnit)
					.onChange(async (value) => {
						this.plugin.settings.indentUnit = value as MindmapSettings["indentUnit"];
						await save();
					}),
			);

		new Setting(containerEl).setName("Appearance").setHeading();

		new Setting(containerEl)
			.setName("Layout")
			.setDesc("Balanced splits top-level branches to both sides of the root.")
			.addDropdown((d) =>
				d
					.addOption("balanced", "Balanced (both sides)")
					.addOption("right", "Single side (right)")
					.setValue(this.plugin.settings.layout)
					.onChange(async (value) => {
						this.plugin.settings.layout = value as LayoutMode;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Colour branches")
			.setDesc("Give each top-level branch its own colour.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.branchColors).onChange(async (value) => {
					this.plugin.settings.branchColors = value;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Show note content")
			.setDesc(
				"Paragraphs, code blocks and tables become their own cards, so they fold and unfold with the branch they belong to. Use the expand button on a card to see the whole block rendered, or double-click it to edit.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showBodyNodes).onChange(async (value) => {
					this.plugin.settings.showBodyNodes = value;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Maximum card width")
			.addSlider((s) =>
				s
					.setLimits(140, 520, 20)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.maxNodeWidth)
					.onChange(async (value) => {
						this.plugin.settings.maxNodeWidth = value;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Horizontal spacing")
			.addSlider((s) =>
				s
					.setLimits(24, 160, 4)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.horizontalGap)
					.onChange(async (value) => {
						this.plugin.settings.horizontalGap = value;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Vertical spacing")
			.addSlider((s) =>
				s
					.setLimits(4, 60, 2)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.verticalGap)
					.onChange(async (value) => {
						this.plugin.settings.verticalGap = value;
						await save();
					}),
			);

		new Setting(containerEl).setName("Behaviour").setHeading();

		new Setting(containerEl)
			.setName("Mouse wheel")
			.addDropdown((d) =>
				d
					.addOption("zoom", "Zooms (hold Shift to pan)")
					.addOption("pan", "Pans (hold Ctrl to zoom)")
					.setValue(this.plugin.settings.wheel)
					.onChange(async (value) => {
						this.plugin.settings.wheel = value as WheelMode;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Button in the note header")
			.setDesc(
				"Adds a mind map toggle beside the other view actions. The command and ribbon icon work either way.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.addHeaderButton).onChange(async (value) => {
					this.plugin.settings.addHeaderButton = value;
					await this.plugin.saveSettings();
					this.plugin.refreshHeaderButtons();
				}),
			);
	}
}
