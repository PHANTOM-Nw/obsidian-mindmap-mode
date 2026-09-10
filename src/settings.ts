import { Platform, PluginSettingTab, Setting } from "obsidian";
import type {
	App,
	ButtonComponent,
	ExtraButtonComponent,
	SettingDefinitionControl,
	SettingDefinitionItem,
	SettingDefinitionRender,
} from "obsidian";
import type { NodeSource, RootPolicy } from "./model/types.ts";
import {
	SHORTCUTS,
	comboFromEvent,
	comboToString,
	findConflicts,
	isDefaultBinding,
	isModifierOnly,
	resolveBindings,
	serializeCombo,
	shortcutFor,
} from "./view/shortcuts.ts";
import type {
	KeyCombo,
	Shortcut,
	ShortcutAction,
	ShortcutBindings,
	StoredShortcuts,
} from "./view/shortcuts.ts";
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
	rememberFolds: boolean;
	branchColors: boolean;
	showBodyNodes: boolean;
	maxNodeWidth: number;
	horizontalGap: number;
	verticalGap: number;
	addHeaderButton: boolean;
	/**
	 * Only the shortcuts the user has changed, spelled the way `parseCombo`
	 * reads them. An action missing here answers to its default; an action with
	 * an empty list answers to nothing.
	 */
	shortcuts: StoredShortcuts;
}

export const DEFAULT_SETTINGS: MindmapSettings = {
	source: "headings-and-lists",
	maxHeadingDepth: 6,
	rootPolicy: "auto",
	layout: "balanced",
	indentUnit: "auto",
	wheel: "zoom",
	rememberFolds: true,
	branchColors: true,
	showBodyNodes: true,
	maxNodeWidth: 340,
	horizontalGap: 64,
	verticalGap: 14,
	addHeaderButton: true,
	shortcuts: {},
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
 * Every setting with a plain control, declared once.
 *
 * Obsidian 1.13 renders a settings tab from `getSettingDefinitions()` and skips
 * `display()` entirely when it returns something; older versions know only
 * `display()`. Both paths below read this array, so the two renderings cannot
 * drift, and `minAppVersion` stays at 1.5.0 while 1.13 users still get their
 * settings indexed for search.
 *
 * The Shortcuts group is not here: a row there is a live key capture rather
 * than a control with a value, so both paths hand it to `renderShortcutRow`.
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
				name: "Remember fold state",
				desc: "Reopen a note to the shape you left it in, focus included. The state is kept in the plugin's own data, never in the note — your markdown is untouched either way. Turn this off and every map opens at the root plus its top-level branches.",
				control: { type: "toggle", key: "rememberFolds" },
			},
			{
				name: "Button in the note header",
				desc: "Adds a mind map toggle beside the other view actions. The command and ribbon icon work either way.",
				control: { type: "toggle", key: HEADER_BUTTON_KEY },
			},
		],
	},
];

/** The row that closes the Shortcuts group, worded once for both renderers. */
const RESTORE_ALL = {
	name: "Restore all defaults",
	desc: "Put every shortcut back to the key the map shipped with.",
};

/** What to warn a row about, or "" when its keys are its own. */
function conflictNote(action: ShortcutAction, bindings: ShortcutBindings): string {
	const others = new Set<string>();
	for (const group of findConflicts(bindings)) {
		if (!group.actions.includes(action)) continue;
		for (const other of group.actions) {
			if (other !== action) others.add(shortcutFor(other).name);
		}
	}
	if (others.size === 0) return "";
	// Which one wins is not a detail the user can work out from the list: the
	// map answers with whichever action is listed first here.
	return `Also bound to ${[...others].join(", ")} — the one listed first is the one that answers.`;
}

export class MindmapSettingTab extends PluginSettingTab {
	private readonly plugin: MindmapPlugin;

	constructor(app: App, plugin: MindmapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// --- Obsidian 1.13 and later ------------------------------------------------

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const groups: SettingDefinitionItem[] = GROUPS.map((group) => ({
			type: "group" as const,
			heading: group.heading,
			items: group.items,
		}));
		const rows: SettingDefinitionRender[] = SHORTCUTS.map((entry) => ({
			name: entry.name,
			desc: entry.description,
			render: (setting: Setting) => this.renderShortcutRow(setting, entry),
		}));
		rows.push({
			name: RESTORE_ALL.name,
			desc: RESTORE_ALL.desc,
			render: (setting: Setting) => this.renderRestoreAll(setting),
		});
		groups.push({ type: "group", heading: "Shortcuts", items: rows });
		return groups;
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
		this.endRecording();
		this.shortcutRows = [];
		containerEl.empty();

		for (const group of GROUPS) {
			new Setting(containerEl).setName(group.heading).setHeading();
			for (const item of group.items) this.renderItem(containerEl, item);
		}

		new Setting(containerEl).setName("Shortcuts").setHeading();
		for (const entry of SHORTCUTS) {
			const setting = new Setting(containerEl).setName(entry.name).setDesc(entry.description);
			this.renderShortcutRow(setting, entry);
		}
		this.renderRestoreAll(
			new Setting(containerEl).setName(RESTORE_ALL.name).setDesc(RESTORE_ALL.desc),
		);
	}

	/** A capture still listening when the tab goes away would never stop. */
	override hide(): void {
		this.endRecording();
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

	// --- shortcuts ----------------------------------------------------------------

	/** Repaints for the shortcut rows on screen: one binding affects them all. */
	private shortcutRows: Array<() => void> = [];

	/** Ends the capture in progress. Only ever one row records at a time. */
	private endCapture: (() => void) | null = null;

	/**
	 * One shortcut: what it does, what it answers to, and the buttons that
	 * change that -- record a key, unbind, put the default back.
	 *
	 * Returns the cleanup Obsidian 1.13 calls when it tears the row down, which
	 * is what keeps a repaint from reaching a row that is no longer there.
	 */
	private renderShortcutRow(setting: Setting, entry: Shortcut): () => void {
		setting.settingEl.addClass("mm-shortcut");
		// In `infoEl` rather than `descEl`, which belongs to whichever renderer
		// wrote the description into it.
		const note = setting.infoEl.createDiv({ cls: "mm-shortcut-note" });
		const keys = setting.controlEl.createDiv({ cls: "mm-shortcut-keys" });

		let unbind: ExtraButtonComponent | null = null;
		let reset: ExtraButtonComponent | null = null;
		let record: ButtonComponent | null = null;
		let recording = false;

		const paint = (): void => {
			const bindings = this.bindings();
			const combos = bindings[entry.action];
			keys.empty();
			if (recording) {
				keys.createSpan({
					cls: "mm-shortcut-capture",
					text: "Press any key — Esc cancels",
				});
			} else if (combos.length === 0) {
				keys.createSpan({ cls: "mm-shortcut-unbound", text: "Not bound" });
			} else {
				for (const combo of combos) {
					keys.createEl("kbd", {
						cls: "mm-shortcut-key",
						text: comboToString(combo, Platform.isMacOS),
					});
				}
			}
			unbind?.extraSettingsEl.toggle(combos.length > 0);
			reset?.extraSettingsEl.toggle(!isDefaultBinding(entry.action, combos));
			const conflict = conflictNote(entry.action, bindings);
			note.setText(conflict);
			note.toggle(conflict !== "");
		};

		const stop = (): void => {
			if (!recording) return;
			recording = false;
			document.removeEventListener("keydown", onKey, true);
			if (this.endCapture === stop) this.endCapture = null;
			setting.settingEl.removeClass("is-recording");
			record?.setButtonText("Record");
			paint();
		};

		const onKey = (ev: KeyboardEvent): void => {
			const combo = comboFromEvent(ev);
			// A modifier on its own is half of a combination, not one.
			if (isModifierOnly(combo)) return;
			// Captured on the document so the key reaches nothing else: Escape
			// would otherwise close the settings window on its way past.
			ev.preventDefault();
			ev.stopPropagation();
			stop();
			// Escape is the way out of a capture, so it is the one key a capture
			// cannot record. Everything else is fair game, Delete and Backspace
			// included -- they are what deleting a node is bound to, and the
			// unbind button is what clears a row.
			if (combo.key === "Escape") return;
			void this.bind(entry.action, [combo]);
		};

		const start = (): void => {
			this.endRecording();
			recording = true;
			this.endCapture = stop;
			setting.settingEl.addClass("is-recording");
			record?.setButtonText("Cancel");
			// The button keeps the focus otherwise, and Enter or Space would be
			// read as another click on it before this listener saw them.
			record?.buttonEl.blur();
			document.addEventListener("keydown", onKey, true);
			paint();
		};

		setting.addExtraButton((button) => {
			unbind = button;
			button
				.setIcon("x")
				.setTooltip("Unbind")
				.onClick(() => {
					this.endRecording();
					void this.bind(entry.action, []);
				});
		});
		setting.addExtraButton((button) => {
			reset = button;
			button
				.setIcon("rotate-ccw")
				.setTooltip("Restore the default")
				.onClick(() => {
					this.endRecording();
					void this.bind(entry.action, shortcutFor(entry.action).defaults);
				});
		});
		setting.addButton((button) => {
			record = button;
			button.setButtonText("Record").onClick(() => {
				if (recording) stop();
				else start();
			});
		});

		this.shortcutRows.push(paint);
		paint();

		return () => {
			stop();
			this.shortcutRows = this.shortcutRows.filter((other) => other !== paint);
		};
	}

	private renderRestoreAll(setting: Setting): void {
		setting.settingEl.addClass("mm-shortcut");
		setting.addButton((button) =>
			button.setButtonText("Restore").onClick(() => {
				this.endRecording();
				void this.writeShortcuts({});
			}),
		);
	}

	private bindings(): ShortcutBindings {
		return resolveBindings(this.plugin.settings.shortcuts);
	}

	private endRecording(): void {
		this.endCapture?.();
	}

	/** Give one action a set of keys; an empty set leaves it unbound. */
	private async bind(action: ShortcutAction, combos: KeyCombo[]): Promise<void> {
		// A whole new map rather than a mutation of the stored one: the setting's
		// value is replaced the way every other setting's is, so the write path
		// stays the same one.
		const next: StoredShortcuts = { ...this.plugin.settings.shortcuts };
		if (isDefaultBinding(action, combos)) delete next[action];
		else next[action] = combos.map(serializeCombo);
		await this.writeShortcuts(next);
	}

	private async writeShortcuts(shortcuts: StoredShortcuts): Promise<void> {
		await this.commit("shortcuts", shortcuts);
		// Every row, not just this one: a key taken from another action changes
		// what that row shows and whether either of them warns.
		for (const paint of this.shortcutRows) paint();
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
