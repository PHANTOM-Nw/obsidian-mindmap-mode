import { Notice, Plugin, TFile, TFolder, debounce, setIcon } from "obsidian";
import type { ViewState, WorkspaceLeaf } from "obsidian";

import { MINDMAP_VIEW_TYPE, MindmapView } from "./view/MindmapView.ts";
import { DEFAULT_SETTINGS, MindmapSettingTab } from "./settings.ts";
import type { MindmapSettings } from "./settings.ts";
import {
	forgetFolder,
	forgetNote,
	putNoteState,
	readStore,
	renameFolder,
	renameNote,
} from "./foldStore.ts";
import type { FoldStore, NoteViewEntry, NoteViewState } from "./foldStore.ts";

const HEADER_BUTTON_CLASS = "mindmap-mode-toggle";

/** Where the fold store sits in `data.json`, beside the flat settings. */
const FOLD_STATE_KEY = "foldState";

/**
 * How long a fold change waits before it reaches disk.
 *
 * Every toggle, expand-all and selection move asks to be saved, and a user
 * walking a big map does that a few times a second. Long enough to collapse a
 * burst into one write, short enough that a crash loses a click, not an hour.
 */
const FOLD_SAVE_DELAY = 800;

export default class MindmapPlugin extends Plugin {
	override settings: MindmapSettings = { ...DEFAULT_SETTINGS };

	/** Fold and focus state per note path. Shares `data.json` with the settings. */
	private foldStore: FoldStore = {};

	/**
	 * The markdown view state a leaf had before it became a map, so toggling
	 * back returns to reading or source mode exactly as the user left it.
	 */
	private readonly previousState = new WeakMap<WorkspaceLeaf, ViewState>();

	private readonly queueSave = debounce(
		() => void this.savePluginData(),
		FOLD_SAVE_DELAY,
		false,
	);

	override async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			MINDMAP_VIEW_TYPE,
			(leaf) => new MindmapView(leaf, this),
		);

		this.addSettingTab(new MindmapSettingTab(this.app, this));

		this.addRibbonIcon("git-fork", "Toggle mind map view", () => {
			const leaf = this.app.workspace.getMostRecentLeaf();
			if (leaf) void this.toggleLeaf(leaf);
		});

		this.addCommand({
			id: "toggle-mindmap-view",
			name: "Toggle mind map view",
			checkCallback: (checking) => {
				const leaf = this.app.workspace.getMostRecentLeaf();
				if (!leaf || !this.isToggleable(leaf)) return false;
				if (!checking) void this.toggleLeaf(leaf);
				return true;
			},
		});

		this.addCommand({
			id: "forget-fold-state",
			name: "Forget the saved fold state for this note",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MindmapView);
				const path = view?.file?.path;
				if (!view || !path) return false;
				if (!checking) {
					this.forgetNoteState(path);
					view.resetFolds();
				}
				return true;
			},
		});

		this.addCommand({
			id: "open-as-mindmap",
			name: "Open current note as a mind map",
			checkCallback: (checking) => {
				const leaf = this.app.workspace.getMostRecentLeaf();
				if (!leaf || leaf.view.getViewType() !== "markdown") return false;
				if (!checking) void this.setMindmapView(leaf);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				const isMap = leaf?.view.getViewType() === MINDMAP_VIEW_TYPE;
				menu.addItem((item) =>
					item
						.setTitle(isMap ? "Edit as markdown" : "Open as mind map")
						.setIcon(isMap ? "file-text" : "git-fork")
						.onClick(() => {
							if (leaf) void this.toggleLeaf(leaf);
							else void this.openFileAsMindmap(file);
						}),
				);
			}),
		);

		// A note that moves keeps its state; one that is deleted takes its state
		// with it. Neither is cosmetic -- without the first, reorganising a vault
		// quietly resets every map in it, and without the second the store fills
		// with entries for files nothing will ever open again.
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFolder) {
					this.updateStore(renameFolder(this.foldStore, oldPath, file.path));
				} else if (file instanceof TFile && file.extension === "md") {
					this.updateStore(renameNote(this.foldStore, oldPath, file.path));
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFolder) this.updateStore(forgetFolder(this.foldStore, file.path));
				else if (file instanceof TFile) this.forgetNoteState(file.path);
			}),
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.refreshHeaderButtons()),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.refreshHeaderButtons()),
		);
		this.app.workspace.onLayoutReady(() => this.refreshHeaderButtons());
	}

	override onunload(): void {
		// Obsidian is done with the plugin after this returns, so a fold change
		// still sitting on the debounce timer has to be spent now or lost.
		this.queueSave.run();
		this.removeHeaderButtons();
	}

	async loadSettings(): Promise<void> {
		// `loadData` is typed `any`; naming the shape here is what keeps an
		// unchecked spread from silently widening every setting to `any`.
		const stored = (await this.loadData()) as Record<string, unknown> | null;

		// The settings sit flat at the root of data.json and the fold store sits
		// beside them under one reserved key. Lifting it out before the spread is
		// what stops it riding into `this.settings` as an unrecognised setting --
		// which the next save would then write back inside itself, once per save.
		const { [FOLD_STATE_KEY]: folds, ...rest } = stored ?? {};
		this.foldStore = readStore(folds);
		this.settings = { ...DEFAULT_SETTINGS, ...(rest as Partial<MindmapSettings>) };
	}

	async saveSettings(): Promise<void> {
		await this.savePluginData();
	}

	// --- remembered fold state ------------------------------------------------

	/**
	 * The one place data.json is written.
	 *
	 * Two things share the file now, and `saveData` replaces it wholesale, so a
	 * write that knew only about the settings would drop every note's fold state
	 * the first time somebody moved a slider.
	 */
	private async savePluginData(): Promise<void> {
		// Whatever the timer was going to write is in this write already, so a
		// settings change spends the pending fold save rather than racing it.
		this.queueSave.cancel();
		await this.saveData({ ...this.settings, [FOLD_STATE_KEY]: this.foldStore });
	}

	/** Swap the store and schedule a write, unless nothing actually changed. */
	private updateStore(next: FoldStore): void {
		if (next === this.foldStore) return;
		this.foldStore = next;
		this.queueSave();
	}

	/** What a note was left looking like, or null when nothing is remembered. */
	readNoteState(path: string): NoteViewState | null {
		if (!this.settings.rememberFolds) return null;
		return this.foldStore[path] ?? null;
	}

	writeNoteState(path: string, entry: NoteViewEntry): void {
		if (!this.settings.rememberFolds) return;
		this.updateStore(putNoteState(this.foldStore, path, entry, Date.now()));
	}

	/**
	 * Deliberately not gated on `rememberFolds`: the command has to be able to
	 * clear a stale entry left behind by a session where the setting was on.
	 */
	forgetNoteState(path: string): void {
		this.updateStore(forgetNote(this.foldStore, path));
	}

	refreshAllViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof MindmapView) view.refresh();
		}
	}

	// --- switching between markdown and the map -------------------------------

	private isToggleable(leaf: WorkspaceLeaf): boolean {
		const type = leaf.view.getViewType();
		if (type === MINDMAP_VIEW_TYPE) return true;
		if (type !== "markdown") return false;
		const file = this.app.workspace.getActiveFile();
		return file?.extension === "md";
	}

	async toggleLeaf(leaf: WorkspaceLeaf): Promise<void> {
		if (leaf.view.getViewType() === MINDMAP_VIEW_TYPE) {
			await this.setMarkdownView(leaf);
		} else {
			await this.setMindmapView(leaf);
		}
	}

	/**
	 * Swap the view type on the leaf that is already showing the file.
	 *
	 * Nothing is created and nothing is copied: the same TFile stays open in the
	 * same tab, and the map reads and writes that file directly.
	 */
	async setMindmapView(leaf: WorkspaceLeaf): Promise<void> {
		const state = leaf.getViewState();
		const file = (leaf.view as { file?: TFile }).file;
		if (!file || file.extension !== "md") {
			new Notice("Only markdown notes can be shown as a mind map.");
			return;
		}

		this.previousState.set(leaf, state);
		await leaf.setViewState(
			{
				type: MINDMAP_VIEW_TYPE,
				state: { file: file.path },
				active: true,
			},
			{ focus: true },
		);
	}

	async setMarkdownView(leaf: WorkspaceLeaf): Promise<void> {
		const file = (leaf.view as { file?: TFile }).file;
		const remembered = this.previousState.get(leaf);

		const next: ViewState = remembered
			? { ...remembered, active: true }
			: { type: "markdown", state: file ? { file: file.path } : {}, active: true };

		// The remembered state may point at a different note if the user navigated.
		if (remembered && file) {
			next.state = { ...(remembered.state ?? {}), file: file.path };
		}

		await leaf.setViewState(next, { focus: true });
	}

	private async openFileAsMindmap(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({
			type: MINDMAP_VIEW_TYPE,
			state: { file: file.path },
			active: true,
		});
	}

	// --- header button --------------------------------------------------------

	refreshHeaderButtons(): void {
		if (!this.settings.addHeaderButton) {
			this.removeHeaderButtons();
			return;
		}
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			this.injectHeaderButton(leaf);
		}
	}

	/**
	 * Adds a toggle beside the other view actions so the map feels like another
	 * reading mode. Purely cosmetic: the command, ribbon icon and context menu
	 * all still work if Obsidian's header markup ever changes.
	 */
	private injectHeaderButton(leaf: WorkspaceLeaf): void {
		const actions = leaf.view.containerEl.querySelector(".view-actions");
		if (!actions) return;
		if (actions.querySelector(`.${HEADER_BUTTON_CLASS}`)) return;

		const button = createDiv({
			cls: `clickable-icon view-action ${HEADER_BUTTON_CLASS}`,
			attr: { "aria-label": "Open as mind map" },
		});
		setIcon(button, "git-fork");
		button.addEventListener("click", (ev) => {
			ev.preventDefault();
			void this.toggleLeaf(leaf);
		});
		actions.prepend(button);
	}

	private removeHeaderButtons(): void {
		for (const el of Array.from(document.querySelectorAll(`.${HEADER_BUTTON_CLASS}`))) {
			el.remove();
		}
	}
}
