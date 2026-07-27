import { Notice, Plugin, TFile, setIcon } from "obsidian";
import type { ViewState, WorkspaceLeaf } from "obsidian";

import { MINDMAP_VIEW_TYPE, MindmapView } from "./view/MindmapView.ts";
import { DEFAULT_SETTINGS, MindmapSettingTab } from "./settings.ts";
import type { MindmapSettings } from "./settings.ts";

const HEADER_BUTTON_CLASS = "mindmap-mode-toggle";

export default class MindmapPlugin extends Plugin {
	override settings: MindmapSettings = { ...DEFAULT_SETTINGS };

	/**
	 * The markdown view state a leaf had before it became a map, so toggling
	 * back returns to reading or source mode exactly as the user left it.
	 */
	private readonly previousState = new WeakMap<WorkspaceLeaf, ViewState>();

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

		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.refreshHeaderButtons()),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.refreshHeaderButtons()),
		);
		this.app.workspace.onLayoutReady(() => this.refreshHeaderButtons());
	}

	override onunload(): void {
		this.removeHeaderButtons();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
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
