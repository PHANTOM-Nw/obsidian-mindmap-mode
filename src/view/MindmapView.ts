import { Notice, TextFileView, setIcon } from "obsidian";
import type { Menu, TFile, WorkspaceLeaf } from "obsidian";

import { parseMarkdown } from "../model/parse.ts";
import type { MindNode, ParsedDoc } from "../model/types.ts";
import {
	addChild,
	addSibling,
	bodyRangeText,
	canMove,
	canRename,
	deleteNode,
	indentNode,
	moveNode,
	outdentNode,
	renameNode,
	replaceBodyRange,
	toggleCheckbox,
} from "../model/mutate.ts";
import type { Mutation } from "../model/mutate.ts";

import { createLayoutNode, layoutTree } from "../layout/tidyTree.ts";
import type { LayoutNode } from "../layout/tidyTree.ts";
import { Canvas } from "./canvas.ts";
import { createEdgeLayer, renderEdges } from "./edges.ts";
import { buildNodeElement } from "./nodes.ts";
import type { NodeElement } from "./nodes.ts";
import { attachInteractions } from "./interactions.ts";
import { ensureMath, finishRenderMath, mathAvailable, mathSettled } from "./math.ts";
import type { Direction, MapController } from "./interactions.ts";
import { resolveIndentUnit } from "../settings.ts";
import type MindmapPlugin from "../main.ts";

export const MINDMAP_VIEW_TYPE = "mindmap-mode-view";

const UNDO_LIMIT = 100;

/**
 * Depth kept open when a map is first painted. 0 would leave only the root, 1
 * shows the root plus its top-level branches with a descendant count on each
 * toggle -- compact enough to scan, complete enough to navigate.
 */
const INITIAL_EXPAND_LEVEL = 1;

/** Separates a body card's id from its owner's. Never appears in a parsed id. */
const BODY_ID_MARK = "$body";

/** Body cards show their block in full up to this much, then trail off. */
const BODY_PREVIEW_CHARS = 600;
const BODY_PREVIEW_LINES = 12;

/**
 * What a body card shows. The full text stays one double-click away, so this
 * only has to stop a 300-line code block from becoming a 300-line card.
 */
function previewOf(text: string): string {
	const lines = text.replace(/\s+$/, "").split("\n");
	let clipped = lines.length > BODY_PREVIEW_LINES;
	let out = lines.slice(0, BODY_PREVIEW_LINES).join("\n");
	if (out.length > BODY_PREVIEW_CHARS) {
		out = out.slice(0, BODY_PREVIEW_CHARS);
		clipped = true;
	}
	return clipped ? `${out.replace(/\s+$/, "")}…` : out;
}

/**
 * Blocks that must keep their own shape: fenced code, indented code and tables.
 * These skip the inline markdown pass, so a `**` inside a code sample stays a
 * `**`, and they are drawn in a monospace face where alignment carries meaning.
 */
function looksPreformatted(text: string): boolean {
	return /^(?:```|~~~|\t| {4}|\|)/.test(text);
}

interface PendingFocus {
	line: number;
	edit: boolean;
}

/** Where a body card came from, so its editor can find the range again. */
interface BodyRef {
	ownerKey: string;
	index: number;
}

export class MindmapView extends TextFileView implements MapController {
	readonly canvas: Canvas;

	private readonly plugin: MindmapPlugin;
	private edgeLayer: SVGSVGElement | null = null;
	private nodeLayer: HTMLElement | null = null;
	private parsed: ParsedDoc | null = null;
	private layoutNodes: LayoutNode[] = [];
	private elements = new Map<string, NodeElement>();

	private collapsedKeys = new Set<string>();
	private foldSeedPending = false;
	/** Body cards drawn by the last paint, keyed by their synthetic id. */
	private bodyNodes = new Map<string, BodyRef>();
	private selectionKey: string | null = null;
	private editingId: string | null = null;
	private pendingFocus: PendingFocus | null = null;

	private undoStack: string[] = [];
	private redoStack: string[] = [];

	private detachInteractions: (() => void) | null = null;
	private popover: HTMLElement | null = null;
	private needsFit = true;
	private paintedEmpty = false;
	private paintToken = 0;

	constructor(leaf: WorkspaceLeaf, plugin: MindmapPlugin) {
		super(leaf);
		this.plugin = plugin;

		this.contentEl.addClass("mindmap-mode");
		this.canvas = new Canvas(this.contentEl, {
			wheel: plugin.settings.wheel,
			// Only blank space starts a pan; everything a node owns belongs to the
			// drag and click handlers. The fold toggle has to be named explicitly:
			// it hangs off `.mm-node`, outside the card, and letting a pan start on
			// it means the canvas takes pointer capture — after which Chromium
			// retargets the click to the viewport and `toggleFold` never fires.
			canPan: (target) => !target.closest(".mm-card, .mm-toggle"),
		});
		this.canvas.viewport.tabIndex = 0;
		this.buildToolbar();
	}

	// --- Obsidian plumbing ---------------------------------------------------

	override getViewType(): string {
		return MINDMAP_VIEW_TYPE;
	}

	override getDisplayText(): string {
		return this.file?.basename ?? "Mind map";
	}

	override getIcon(): string {
		return "git-fork";
	}

	override getViewData(): string {
		return this.data;
	}

	override setViewData(data: string, clear: boolean): void {
		this.data = data;
		if (clear) {
			this.collapsedKeys.clear();
			this.selectionKey = null;
			this.undoStack = [];
			this.redoStack = [];
			this.needsFit = true;
			// `clear` means a different file, which is the only moment the map
			// may re-fold. Saves and external edits arrive with clear === false,
			// so typing can never collapse the tree out from under the user.
			this.foldSeedPending = true;
		}
		this.render();
	}

	override clear(): void {
		this.data = "";
		this.parsed = null;
		this.layoutNodes = [];
		this.elements.clear();
		this.collapsedKeys.clear();
		this.selectionKey = null;
		this.paintToken++;
		this.closePopover();
	}

	override async onOpen(): Promise<void> {
		// Warm MathJax now rather than on the first formula: opening a map is
		// already a deliberate action, so the cost is invisible here, and it
		// spares the first painted map its one placeholder-to-formula rebuild.
		// Deliberately not in the plugin's onload -- users who never open a map
		// should not pay for it at Obsidian startup.
		void ensureMath();
		this.detachInteractions = attachInteractions(this);
		this.addAction("file-text", "Edit as markdown", () => {
			void this.plugin.toggleLeaf(this.leaf);
		});
	}

	override async onClose(): Promise<void> {
		this.paintToken++;
		this.detachInteractions?.();
		this.detachInteractions = null;
		this.closePopover();
		this.canvas.destroy();
	}

	override onResize(): void {
		// A view painted while hidden measures every card as zero-sized.
		if (this.paintedEmpty) this.render();
	}

	override onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		menu.addItem((item) =>
			item
				.setTitle("Edit as markdown")
				.setIcon("file-text")
				.onClick(() => void this.plugin.toggleLeaf(this.leaf)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Fit map to window")
				.setIcon("maximize")
				.onClick(() => this.fit()),
		);
	}

	/** Called by the plugin when settings change. */
	refresh(): void {
		this.canvas.setOptions({ wheel: this.plugin.settings.wheel });
		this.render();
	}

	// --- toolbar --------------------------------------------------------------

	private buildToolbar(): void {
		const bar = this.contentEl.createDiv({ cls: "mm-toolbar" });

		const button = (
			icon: string,
			label: string,
			onClick: () => void,
		): HTMLElement => {
			const el = bar.createDiv({ cls: "mm-tool", attr: { "aria-label": label } });
			setIcon(el, icon);
			el.addEventListener("click", (ev) => {
				ev.preventDefault();
				onClick();
			});
			return el;
		};

		button("zoom-in", "Zoom in", () => this.canvas.zoomBy(1.2));
		button("zoom-out", "Zoom out", () => this.canvas.zoomBy(1 / 1.2));
		button("maximize", "Fit to window", () => this.fit());
		button("crosshair", "Centre on selection", () => this.centreOnSelection());
		button("chevrons-up-down", "Expand all", () => this.expandAll());
		button("chevrons-down-up", "Collapse all", () => this.collapseAll());
		button("help-circle", "Keyboard shortcuts", () => this.showShortcuts());
	}

	private showShortcuts(): void {
		const rows: Array<[string, string]> = [
			["Double-click / F2", "Edit the node"],
			["Enter", "New sibling"],
			["Tab", "New child"],
			["Shift+Tab", "Outdent"],
			["]", "Indent under previous sibling"],
			["Delete", "Delete node and its children"],
			["Space", "Fold / unfold"],
			["Arrow keys", "Move the selection"],
			["Drag a card", "Reparent it"],
			["Ctrl/Cmd+Enter", "Cycle the checkbox"],
			["Ctrl/Cmd+Z", "Undo (Shift to redo)"],
			["Ctrl/Cmd+0", "Fit to window"],
		];

		const panel = this.openPopover();
		panel.addClass("mm-shortcuts");
		panel.createEl("h4", { text: "Mind map shortcuts" });
		const table = panel.createEl("table");
		for (const [keys, what] of rows) {
			const tr = table.createEl("tr");
			tr.createEl("td", { cls: "mm-keys", text: keys });
			tr.createEl("td", { text: what });
		}
		panel.style.left = "50%";
		panel.style.top = "50%";
		panel.style.transform = "translate(-50%, -50%)";
	}

	// --- rendering ------------------------------------------------------------

	private parseOptions() {
		const s = this.plugin.settings;
		return {
			title: this.file?.basename ?? "Untitled",
			source: s.source,
			rootPolicy: s.rootPolicy,
			maxHeadingDepth: s.maxHeadingDepth,
			indentUnit: resolveIndentUnit(s),
		};
	}

	private render(): void {
		this.parsed = parseMarkdown(this.data, this.parseOptions());

		// Before anything reveals a node: foldFrom clears the whole set.
		if (this.foldSeedPending) {
			this.foldSeedPending = false;
			this.foldFrom(INITIAL_EXPAND_LEVEL);
		}

		if (this.pendingFocus) {
			const focus = this.pendingFocus;
			this.pendingFocus = null;
			const target = this.findByLine(focus.line);
			if (target) {
				this.selectionKey = target.key;
				this.revealAncestors(target);
				this.paint();
				if (focus.edit) this.beginEdit(target.id);
				this.revealSelection();
				return;
			}
		}
		this.paint();
	}

	/**
	 * Collapse every node at or below `depth`, counting the root as 0. Pass
	 * `Infinity` to expand everything.
	 *
	 * Seeding continues past nodes that are themselves collapsed. `paint()` just
	 * stops descending when it meets a collapsed key, so the deeper entries cost
	 * nothing to carry -- and they are what makes expanding a branch reveal one
	 * level at a time rather than dumping the whole subtree on screen.
	 */
	private foldFrom(depth: number): void {
		this.collapsedKeys.clear();
		if (!this.parsed || !Number.isFinite(depth)) return;
		const visit = (node: MindNode, d: number): void => {
			if (d >= depth && node.children.length > 0) this.collapsedKeys.add(node.key);
			for (const child of node.children) visit(child, d + 1);
		};
		visit(this.parsed.root, 0);
	}

	/**
	 * Open whatever is hiding a node the user is about to work on.
	 *
	 * Indent, outdent, drag and undo can all land a node under a collapsed
	 * parent. Without this the node simply vanishes, and every follow-up -- the
	 * selection, `beginEdit` -- silently no-ops against a missing element.
	 */
	private revealAncestors(node: MindNode): void {
		for (let p: MindNode | null = node.parent; p; p = p.parent) {
			this.collapsedKeys.delete(p.key);
		}
	}

	expandAll(): void {
		this.foldFrom(Infinity);
		this.paint();
	}

	/** Back to the view the map opens with. */
	collapseAll(): void {
		this.foldFrom(INITIAL_EXPAND_LEVEL);
		this.paint();
	}

	// --- body content as nodes -------------------------------------------------

	/**
	 * A node's children as the map draws them: its real children plus one card
	 * per block of note content, interleaved in the order they appear in the file.
	 *
	 * The body cards are synthesised here and never enter `parsed.byId`, so every
	 * mutation -- rename, move, delete, indent -- looks them up, misses, and does
	 * nothing. That is the whole safety story: the note owns those lines, and the
	 * only way to change them is the editor `openBody` puts up.
	 */
	private childrenOf(parsed: ParsedDoc, node: MindNode, showBody: boolean): MindNode[] {
		if (!showBody || node.bodyRanges.length === 0) return node.children;

		const merged: Array<{ line: number; node: MindNode }> = node.children.map((c) => ({
			line: c.lineStart,
			node: c,
		}));

		node.bodyRanges.forEach((range, index) => {
			const body = this.makeBodyNode(parsed, node, range, index);
			merged.push({ line: range[0], node: body });
		});

		merged.sort((a, b) => a.line - b.line);
		return merged.map((entry) => entry.node);
	}

	private makeBodyNode(
		parsed: ParsedDoc,
		owner: MindNode,
		range: [number, number],
		index: number,
	): MindNode {
		const id = `${owner.id}${BODY_ID_MARK}${index}`;
		const body: MindNode = {
			id,
			key: `${owner.key}${BODY_ID_MARK}${index}`,
			kind: "body",
			virtual: true,
			text: previewOf(bodyRangeText(parsed, range)),
			level: owner.level,
			indentWidth: 0,
			indent: "",
			marker: "",
			spacing: "",
			checkbox: null,
			checkboxSpacing: "",
			suffix: "",
			lineStart: range[0],
			blockEnd: range[1],
			bodyRanges: [],
			children: [],
			// Kept for `revealAncestors`; `owner.children` is never touched, so the
			// parsed tree stays exactly as the parser left it.
			parent: owner,
		};
		this.bodyNodes.set(id, { ownerKey: owner.key, index });
		return body;
	}

	private childCount(node: MindNode, showBody: boolean): number {
		return node.children.length + (showBody ? node.bodyRanges.length : 0);
	}

	/** Everything a collapsed node is hiding, body cards included. */
	private hiddenCount(node: MindNode, showBody: boolean): number {
		let total = showBody ? node.bodyRanges.length : 0;
		for (const child of node.children) total += 1 + this.hiddenCount(child, showBody);
		return total;
	}

	private findByLine(line: number): MindNode | null {
		if (!this.parsed || line < 0) return null;
		for (const node of this.parsed.byId.values()) {
			if (node.lineStart === line) return node;
		}
		return null;
	}

	private paint(): void {
		const parsed = this.parsed;
		if (!parsed) return;

		// Invalidates any measurement callback still in flight from an earlier
		// paint, so a slow MathJax flush cannot lay out a map that is now gone.
		const token = ++this.paintToken;

		const s = this.plugin.settings;
		this.canvas.content.empty();
		this.elements.clear();
		this.edgeLayer = createEdgeLayer(this.canvas.content);
		this.nodeLayer = this.canvas.content.createDiv({ cls: "mm-nodes" });

		const showBody = s.showBodyNodes;
		this.bodyNodes.clear();

		// Build the tree of visible nodes; a collapsed node contributes no children.
		const rootLayout = createLayoutNode(parsed.root, null, 0);
		const visible: LayoutNode[] = [];
		const build = (node: MindNode, layout: LayoutNode): void => {
			visible.push(layout);
			if (this.collapsedKeys.has(node.key)) return;
			for (const child of this.childrenOf(parsed, node, showBody)) {
				const childLayout = createLayoutNode(child, layout, layout.depth + 1);
				layout.children.push(childLayout);
				build(child, childLayout);
			}
		};
		build(parsed.root, rootLayout);

		let sawMath = false;
		for (const layout of visible) {
			const node = layout.node;
			const collapsed = this.collapsedKeys.has(node.key);
			const element = buildNodeElement(this.nodeLayer, layout, {
				maxWidth: s.maxNodeWidth,
				branchColors: s.branchColors,
				preformatted: node.kind === "body" && looksPreformatted(node.text),
				collapsed,
				hasChildren: this.childCount(node, showBody) > 0,
				hiddenCount: collapsed ? this.hiddenCount(node, showBody) : 0,
			});
			this.elements.set(node.id, element);
			if (element.hasMath) sawMath = true;
		}

		const wasFitting = this.needsFit;
		this.measureAndPlace(rootLayout, visible);
		if (!sawMath) return;

		if (!mathSettled()) {
			// First map with formulas this session: what is on screen right now
			// is placeholder source text, so the cards have to be rebuilt rather
			// than re-measured. `ensureMath` settles either way, so the repaint
			// takes the branch below and this can run at most once per session.
			void ensureMath().then(() => {
				if (token !== this.paintToken) return;
				if (wasFitting) this.needsFit = true;
				this.paint();
			});
			return;
		}
		if (!mathAvailable()) return;

		// MathJax emits its stylesheet adaptively, one glyph at a time, so a
		// formula reaching for a glyph nobody has used yet measures short until
		// the flush lands. Re-measure, but never rebuild: `measureAndPlace` only
		// reads and positions, so it cannot schedule itself again.
		void finishRenderMath().then(() => {
			if (token !== this.paintToken) return;
			if (wasFitting) this.needsFit = true;
			this.measureAndPlace(rootLayout, visible);
		});
	}

	/**
	 * Measure the cards that `paint()` built and position everything.
	 *
	 * Safe to run more than once over the same tree: `layoutTree` assigns
	 * coordinates outright rather than accumulating them, and `renderEdges`
	 * clears the layer before it draws.
	 */
	private measureAndPlace(rootLayout: LayoutNode, visible: LayoutNode[]): void {
		const s = this.plugin.settings;

		// One batched read pass: every write above, every measurement here.
		// offsetWidth, not getBoundingClientRect -- the cards sit inside a
		// scaled `.mm-content`, and a rect would feed the zoom back into layout.
		for (const layout of visible) {
			const element = this.elements.get(layout.node.id);
			if (!element) continue;
			layout.width = element.el.offsetWidth;
			layout.height = element.el.offsetHeight;
		}

		this.paintedEmpty = rootLayout.width === 0;
		if (this.paintedEmpty) return;

		const result = layoutTree(rootLayout, {
			mode: s.layout,
			horizontalGap: s.horizontalGap,
			verticalGap: s.verticalGap,
			padding: 60,
		});

		for (const layout of result.nodes) {
			const element = this.elements.get(layout.node.id);
			if (!element) continue;
			element.el.style.transform = `translate(${layout.x}px, ${layout.y}px)`;
			element.el.dataset.side = layout.side === 1 ? "right" : "left";
		}

		this.canvas.content.style.width = `${result.width}px`;
		this.canvas.content.style.height = `${result.height}px`;
		if (this.edgeLayer) {
			renderEdges(this.edgeLayer, result.nodes, result.width, result.height, s.branchColors);
		}
		this.layoutNodes = result.nodes;

		this.applySelection();
		if (this.needsFit) {
			this.needsFit = false;
			this.canvas.fit(result.width, result.height);
		}
	}

	private applySelection(): void {
		for (const element of this.elements.values()) element.el.removeClass("is-selected");
		const node = this.selectedNode();
		if (!node) return;
		this.elements.get(node.id)?.el.addClass("is-selected");
	}

	private selectedNode(): MindNode | null {
		if (!this.parsed || this.selectionKey === null) return null;
		return this.parsed.byKey.get(this.selectionKey) ?? null;
	}

	private layoutFor(id: string): LayoutNode | null {
		return this.layoutNodes.find((l) => l.node.id === id) ?? null;
	}

	// --- mutation plumbing ----------------------------------------------------

	private apply(mutation: Mutation, edit = false): void {
		if (!mutation.ok) return;
		this.undoStack.push(this.data);
		if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
		this.redoStack = [];
		this.commit(mutation.text, mutation.focusLine, edit);
	}

	private commit(text: string, focusLine: number, edit: boolean): void {
		this.data = text;
		this.pendingFocus = focusLine >= 0 ? { line: focusLine, edit } : null;
		this.requestSave();
		this.render();
	}

	private withNode(id: string, run: (parsed: ParsedDoc, node: MindNode) => void): void {
		const parsed = this.parsed;
		const node = parsed?.byId.get(id);
		if (!parsed || !node) return;
		run(parsed, node);
	}

	// --- MapController --------------------------------------------------------

	isEditing(): boolean {
		return this.editingId !== null;
	}

	selectedId(): string | null {
		return this.selectedNode()?.id ?? null;
	}

	select(id: string | null): void {
		// A body card is not something the map can act on, so picking one drops
		// the selection rather than leaving the previous card looking active.
		if (id === null || this.bodyNodes.has(id)) {
			this.selectionKey = null;
			this.applySelection();
			return;
		}
		const node = this.parsed?.byId.get(id);
		if (!node) return;
		this.selectionKey = node.key;
		this.applySelection();
	}

	beginEdit(id: string): void {
		// Body cards hold lines the note owns, not a node title. Editing one means
		// the block editor, which rewrites exactly those lines and nothing else.
		if (this.bodyNodes.has(id)) {
			this.openBody(id);
			return;
		}

		const element = this.elements.get(id);
		const node = this.parsed?.byId.get(id);
		if (!element || !node) return;
		if (!canRename(node)) {
			new Notice("This node is the file name. Rename the note to change it.");
			return;
		}

		this.editingId = id;
		this.select(id);

		const el = element.text;
		el.empty();
		el.setText(node.text);
		el.addClass("is-editing");
		try {
			el.contentEditable = "plaintext-only";
		} catch {
			el.contentEditable = "true";
		}
		if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
		el.focus();

		const range = document.createRange();
		range.selectNodeContents(el);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		let settled = false;
		const finish = (save: boolean): void => {
			if (settled) return;
			settled = true;
			const value = el.textContent ?? "";
			el.contentEditable = "false";
			el.removeClass("is-editing");
			this.editingId = null;
			if (save) {
				this.withNode(id, (parsed, current) => {
					this.apply(renameNode(parsed, current, value));
				});
			} else {
				this.render();
			}
			this.canvas.viewport.focus({ preventScroll: true });
		};

		el.addEventListener("keydown", (ev) => {
			// While editing, the map's own shortcuts must not fire.
			ev.stopPropagation();
			if (ev.key === "Enter") {
				ev.preventDefault();
				finish(true);
			} else if (ev.key === "Escape") {
				ev.preventDefault();
				finish(false);
			}
		});
		el.addEventListener("blur", () => finish(true), { once: true });
	}

	addChildTo(id: string): void {
		this.withNode(id, (parsed, node) => {
			this.collapsedKeys.delete(node.key);
			this.apply(addChild(parsed, node, ""), true);
		});
	}

	addSiblingTo(id: string): void {
		this.withNode(id, (parsed, node) => {
			if (!node.parent) {
				this.addChildTo(id);
				return;
			}
			this.apply(addSibling(parsed, node, ""), true);
		});
	}

	removeNode(id: string): void {
		this.withNode(id, (parsed, node) => {
			if (!node.parent) {
				new Notice("The root node cannot be deleted from the map.");
				return;
			}
			this.apply(deleteNode(parsed, node));
		});
	}

	indent(id: string): void {
		this.withNode(id, (parsed, node) => this.apply(indentNode(parsed, node)));
	}

	outdent(id: string): void {
		this.withNode(id, (parsed, node) => this.apply(outdentNode(parsed, node)));
	}

	toggleCheck(id: string): void {
		this.withNode(id, (parsed, node) => this.apply(toggleCheckbox(parsed, node)));
	}

	toggleFold(id: string): void {
		this.withNode(id, (_parsed, node) => {
			if (node.children.length === 0) return;
			if (this.collapsedKeys.has(node.key)) this.collapsedKeys.delete(node.key);
			else this.collapsedKeys.add(node.key);
			this.paint();
		});
	}

	canDrop(id: string, targetId: string): boolean {
		const node = this.parsed?.byId.get(id);
		const target = this.parsed?.byId.get(targetId);
		if (!node || !target) return false;
		return canMove(node, target);
	}

	move(id: string, targetId: string): void {
		const parsed = this.parsed;
		const node = parsed?.byId.get(id);
		const target = parsed?.byId.get(targetId);
		if (!parsed || !node || !target) return;
		this.collapsedKeys.delete(target.key);
		this.apply(moveNode(parsed, node, target));
	}

	navigate(direction: Direction): void {
		if (this.layoutNodes.length === 0) return;
		const currentId = this.selectedId();
		const current = currentId ? this.layoutFor(currentId) : null;
		if (!current) {
			this.select(this.parsed?.root.id ?? null);
			this.revealSelection();
			return;
		}

		const cx = current.x + current.width / 2;
		const cy = current.y + current.height / 2;
		let best: LayoutNode | null = null;
		let bestScore = Infinity;

		for (const candidate of this.layoutNodes) {
			if (candidate === current) continue;
			// Body cards cannot hold the selection, so stepping onto one would
			// leave the arrow keys apparently stuck.
			if (this.bodyNodes.has(candidate.node.id)) continue;
			const dx = candidate.x + candidate.width / 2 - cx;
			const dy = candidate.y + candidate.height / 2 - cy;

			let along: number;
			let across: number;
			if (direction === "right") {
				if (dx <= 1) continue;
				along = dx;
				across = Math.abs(dy);
			} else if (direction === "left") {
				if (dx >= -1) continue;
				along = -dx;
				across = Math.abs(dy);
			} else if (direction === "down") {
				if (dy <= 1) continue;
				along = dy;
				across = Math.abs(dx);
			} else {
				if (dy >= -1) continue;
				along = -dy;
				across = Math.abs(dx);
			}

			// Favour candidates that stay near the current axis.
			const score = along + across * 2;
			if (score < bestScore) {
				bestScore = score;
				best = candidate;
			}
		}

		if (best) {
			this.select(best.node.id);
			this.revealSelection();
		}
	}

	undo(): void {
		const previous = this.undoStack.pop();
		if (previous === undefined) {
			new Notice("Nothing to undo on the map.");
			return;
		}
		this.redoStack.push(this.data);
		this.commit(previous, -1, false);
	}

	redo(): void {
		const next = this.redoStack.pop();
		if (next === undefined) return;
		this.undoStack.push(this.data);
		this.commit(next, -1, false);
	}

	fit(): void {
		const width = parseFloat(this.canvas.content.style.width) || 0;
		const height = parseFloat(this.canvas.content.style.height) || 0;
		this.canvas.fit(width, height);
	}

	centreOnSelection(): void {
		const id = this.selectedId();
		const layout = id ? this.layoutFor(id) : null;
		if (!layout) {
			this.fit();
			return;
		}
		this.canvas.centreOn(layout.x + layout.width / 2, layout.y + layout.height / 2);
	}

	private revealSelection(): void {
		const id = this.selectedId();
		const layout = id ? this.layoutFor(id) : null;
		if (!layout) return;
		this.canvas.reveal(layout.x, layout.y, layout.width, layout.height);
	}

	// --- body popover ---------------------------------------------------------

	private openPopover(): HTMLElement {
		this.closePopover();
		const panel = this.contentEl.createDiv({ cls: "mm-popover" });
		this.popover = panel;

		const onOutside = (ev: MouseEvent): void => {
			if (!panel.contains(ev.target as Node)) this.closePopover();
		};
		const onKey = (ev: KeyboardEvent): void => {
			if (ev.key === "Escape") this.closePopover();
		};
		// Deferred so the click that opened the panel does not close it.
		window.setTimeout(() => document.addEventListener("mousedown", onOutside), 0);
		document.addEventListener("keydown", onKey);
		this.popoverCleanup = () => {
			document.removeEventListener("mousedown", onOutside);
			document.removeEventListener("keydown", onKey);
		};
		return panel;
	}

	private popoverCleanup: (() => void) | null = null;

	private closePopover(): void {
		this.popoverCleanup?.();
		this.popoverCleanup = null;
		this.popover?.remove();
		this.popover = null;
	}

	openBody(id: string): void {
		const parsed = this.parsed;
		if (!parsed) return;

		// A body card edits its own block; anything else edits all of its blocks.
		const ref = this.bodyNodes.get(id);
		const node = ref ? parsed.byKey.get(ref.ownerKey) : parsed.byId.get(id);
		if (!node || node.bodyRanges.length === 0) return;
		const only = ref?.index;
		if (only !== undefined && !node.bodyRanges[only]) return;

		const panel = this.openPopover();
		panel.addClass("mm-body-popover");
		panel.createEl("h4", { text: node.text || "Note content" });
		panel.createEl("p", {
			cls: "mm-popover-hint",
			text: "This content stays in the note exactly where it is. Editing here rewrites only these lines.",
		});

		const areas: Array<{ index: number; original: string; el: HTMLTextAreaElement }> = [];
		node.bodyRanges.forEach((range, index) => {
			if (only !== undefined && index !== only) return;
			const original = bodyRangeText(parsed, range);
			const wrapper = panel.createDiv({ cls: "mm-body-block" });
			wrapper.createDiv({
				cls: "mm-body-lines",
				text: `Lines ${range[0] + 1}–${range[1] + 1}`,
			});
			const area = wrapper.createEl("textarea", { cls: "mm-body-input" });
			area.value = original;
			area.rows = Math.min(16, original.split("\n").length + 1);
			areas.push({ index, original, el: area });
		});

		const actions = panel.createDiv({ cls: "mm-popover-actions" });
		actions
			.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => this.closePopover());

		const save = actions.createEl("button", { cls: "mod-cta", text: "Save" });
		save.addEventListener("click", () => {
			const changed = areas
				.filter((a) => a.el.value !== a.original)
				// Highest index first so the earlier ranges' line numbers stay valid.
				.sort((a, b) => b.index - a.index);
			this.closePopover();
			if (changed.length === 0) return;

			const before = this.data;
			let text = this.data;
			for (const edit of changed) {
				const snapshot = parseMarkdown(text, this.parseOptions());
				const current = snapshot.byKey.get(node.key);
				if (!current) break;
				const result = replaceBodyRange(snapshot, current, edit.index, edit.el.value);
				if (!result.ok) break;
				text = result.text;
			}
			if (text === before) return;

			this.undoStack.push(before);
			if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
			this.redoStack = [];
			this.commit(text, -1, false);
		});

		const anchor = this.elements.get(id)?.card;
		const host = this.contentEl.getBoundingClientRect();
		if (anchor) {
			const rect = anchor.getBoundingClientRect();
			panel.style.left = `${Math.max(8, Math.min(rect.left - host.left, host.width - 380))}px`;
			panel.style.top = `${Math.min(rect.bottom - host.top + 8, host.height - 120)}px`;
		} else {
			panel.style.left = "50%";
			panel.style.top = "20%";
		}
	}

	// --- file lifecycle -------------------------------------------------------

	override async onLoadFile(file: TFile): Promise<void> {
		this.needsFit = true;
		await super.onLoadFile(file);
	}
}
