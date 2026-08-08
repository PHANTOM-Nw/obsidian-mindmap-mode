import { Keymap, Menu, Notice, TextFileView, setIcon } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";

import { parseMarkdown } from "../model/parse.ts";
import type { MindNode, ParsedDoc } from "../model/types.ts";
import {
	addChild,
	addSibling,
	addSiblingBefore,
	bodyRangeText,
	canMove,
	canRename,
	canReorder,
	deleteNode,
	indentNode,
	moveAfter,
	moveBefore,
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
import { BlockDialog } from "./blockDialog.ts";
import type { BlockDialogMode, DialogBlock } from "./blockDialog.ts";
import { ensureMath, finishRenderMath, mathAvailable, mathSettled } from "./math.ts";
import type { Direction, DropMode, MapController } from "./interactions.ts";
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
const BODY_PREVIEW_CHARS = 2000;
const BODY_PREVIEW_LINES = 40;

/** Note content gets more room than a topic title needs. */
const BODY_WIDTH_FACTOR = 1.6;

/**
 * What a body card shows. The full text stays one click away on the card's own
 * expand button, so this only has to stop a 300-line code block from becoming a
 * 300-line card.
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

/**
 * A node to hold still across a repaint, and the viewport point to hold it at.
 *
 * Folding re-runs the whole layout, and `normalize` re-origins every card on the
 * new bounding box, so without this the entire map slides under the cursor even
 * though the branch you clicked is where you left it.
 */
interface Anchor {
	key: string;
	screenX: number;
	screenY: number;
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
	/**
	 * A restored focus waiting for the first framing to honour it.
	 *
	 * Not `pendingFocus`, which is where an edit wants the caret. This one only
	 * decides where the camera lands when a note opens: on the node the user was
	 * last working on, or -- when that node is gone, renamed out from under its
	 * key, or hidden inside a branch they left folded -- on the whole map.
	 */
	private restoreFocusKey: string | null = null;
	/** Body cards drawn by the last paint, keyed by their synthetic id. */
	private bodyNodes = new Map<string, BodyRef>();
	/** Consumed by the next paint. */
	private anchor: Anchor | null = null;
	private selectionKey: string | null = null;
	private editingId: string | null = null;
	private pendingFocus: PendingFocus | null = null;

	private undoStack: string[] = [];
	private redoStack: string[] = [];

	private detachInteractions: (() => void) | null = null;
	private popover: HTMLElement | null = null;
	private dialog: BlockDialog | null = null;
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
			// drag and click handlers. `.mm-tools` — the toggle and add button —
			// has to be named explicitly: it hangs off `.mm-node`, outside the
			// card, and letting a pan start there means the canvas takes pointer
			// capture, after which Chromium retargets the click to the viewport
			// and the button never fires.
			canPan: (target) => !target.closest(".mm-card, .mm-tools"),
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
			this.restoreFocusKey = null;
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
		this.restoreFocusKey = null;
		this.paintToken++;
		this.closePopover();
		// The dialog holds line ranges from the file being cleared; leaving it up
		// would let a save splice ranges that no longer mean anything.
		this.closeDialog();
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
		this.closeDialog();
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
			["⤢ on a content card", "Show the whole block, rendered"],
			["Click a link in a content card", "Open it"],
			["+ beside a card", "New child"],
			["Right-click a card", "The node's menu"],
			["Enter", "New sibling"],
			["Tab", "New child"],
			["Shift+Tab", "Outdent"],
			["]", "Indent under previous sibling"],
			["Delete", "Delete node and its children"],
			["Space", "Fold / unfold"],
			["Arrow keys", "Move the selection"],
			["Drag onto a card", "Reparent it"],
			["Drag onto a card's top / bottom edge", "Reorder it beside that card"],
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

		// Before anything reveals a node: seeding replaces the whole set.
		if (this.foldSeedPending) {
			this.foldSeedPending = false;
			this.seedFolds();
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
	 * Every node at or below `depth`, counting the root as 0, that has anything
	 * to hide. `Infinity` yields nothing, which is how "expand all" is spelled.
	 *
	 * The walk continues past nodes that are themselves collapsed. `paint()` just
	 * stops descending when it meets a collapsed key, so the deeper entries cost
	 * nothing to carry -- and they are what makes expanding a branch reveal one
	 * level at a time rather than dumping the whole subtree on screen.
	 */
	private collapsedAtDepth(depth: number): Set<string> {
		const keys = new Set<string>();
		if (!this.parsed || !Number.isFinite(depth)) return keys;
		// childCount, not children.length: a section whose only content is
		// paragraphs or callouts still has body cards to fold away.
		const showBody = this.plugin.settings.showBodyNodes;
		const visit = (node: MindNode, d: number): void => {
			if (d >= depth && this.childCount(node, showBody) > 0) keys.add(node.key);
			for (const child of node.children) visit(child, d + 1);
		};
		visit(this.parsed.root, 0);
		return keys;
	}

	private foldFrom(depth: number): void {
		this.collapsedKeys = this.collapsedAtDepth(depth);
	}

	/**
	 * The shape a freshly opened note starts in: what the user left behind if
	 * anything was remembered, and the default otherwise.
	 */
	private seedFolds(): void {
		const parsed = this.parsed;
		const path = this.file?.path;
		const saved = parsed && path ? this.plugin.readNoteState(path) : null;
		if (!parsed || !saved) {
			this.foldFrom(INITIAL_EXPAND_LEVEL);
			return;
		}

		// Keys the note no longer has are dropped rather than carried. They would
		// cost a lookup on every paint, and the next save would write them
		// straight back -- a note edited outside Obsidian would accumulate the
		// ghost of every heading it ever had.
		const showBody = this.plugin.settings.showBodyNodes;
		const restored = new Set<string>();
		for (const key of saved.collapsed) {
			const node = parsed.byKey.get(key);
			if (node && this.childCount(node, showBody) > 0) restored.add(key);
		}
		this.collapsedKeys = restored;

		const focus = this.findSaved(parsed, saved.focusKey, saved.focusId);
		// A focus inside a branch the user left folded loses to the fold: opening
		// the branch to show it would undo a decision they made on purpose, and
		// selecting a card that is not on screen leaves the keyboard aimed at
		// nothing. The map simply frames itself instead.
		if (!focus || !this.isVisible(focus)) return;
		this.selectionKey = focus.key;
		this.restoreFocusKey = focus.key;
	}

	/**
	 * The node a saved focus points at: by text path first, by tree position
	 * when the text has changed since.
	 *
	 * Renaming a node moves its key and leaves its position; inserting a sibling
	 * above it does the reverse. Only an edit that does both at once loses the
	 * focus, and losing it costs a default framing, nothing more.
	 */
	private findSaved(parsed: ParsedDoc, key?: string, id?: string): MindNode | null {
		const byKey = key === undefined ? undefined : parsed.byKey.get(key);
		if (byKey) return byKey;
		return (id === undefined ? undefined : parsed.byId.get(id)) ?? null;
	}

	/** False when a collapsed ancestor is keeping the node off the map. */
	private isVisible(node: MindNode): boolean {
		for (let p: MindNode | null = node.parent; p; p = p.parent) {
			if (this.collapsedKeys.has(p.key)) return false;
		}
		return true;
	}

	/**
	 * Hand the current shape to the plugin, which batches the writes.
	 *
	 * A map sitting at exactly the default fold with nothing selected is stored
	 * as nothing at all. That is what a note looks like the moment it is opened
	 * and never touched, and an entry apiece for those would be the bulk of the
	 * file in exchange for restoring precisely the state you get without it.
	 */
	private rememberState(): void {
		const path = this.file?.path;
		if (!this.parsed || !path || !this.plugin.settings.rememberFolds) return;

		const focus = this.selectedNode();
		if (!focus && this.isDefaultFold()) {
			this.plugin.forgetNoteState(path);
			return;
		}
		this.plugin.writeNoteState(path, {
			collapsed: [...this.collapsedKeys],
			focusKey: focus?.key,
			focusId: focus?.id,
		});
	}

	private isDefaultFold(): boolean {
		const fallback = this.collapsedAtDepth(INITIAL_EXPAND_LEVEL);
		if (fallback.size !== this.collapsedKeys.size) return false;
		for (const key of this.collapsedKeys) if (!fallback.has(key)) return false;
		return true;
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

	/**
	 * Note where a node currently sits on screen, so the next paint can put it
	 * back there. Reads the layout the *previous* paint left behind.
	 */
	private markAnchor(key: string | undefined): void {
		const layout = key ? this.layoutNodes.find((l) => l.node.key === key) : undefined;
		if (!layout || !key) {
			this.anchor = null;
			return;
		}
		const canvas = this.canvas;
		this.anchor = {
			key,
			screenX: canvas.tx + layout.x * canvas.scale,
			screenY: canvas.ty + layout.y * canvas.scale,
		};
	}

	/** Nothing was clicked, so hold the selection still, or the root. */
	private markGlobalAnchor(): void {
		this.markAnchor(this.selectedNode()?.key ?? this.parsed?.root.key);
	}

	expandAll(): void {
		this.markGlobalAnchor();
		this.foldFrom(Infinity);
		this.paint();
	}

	/** Back to the view the map opens with. */
	collapseAll(): void {
		this.markGlobalAnchor();
		this.foldFrom(INITIAL_EXPAND_LEVEL);
		this.paint();
	}

	/**
	 * Back to the shape a note with nothing remembered opens in.
	 *
	 * The paint that follows finds the map at exactly the default with nothing
	 * selected, which is the one state `rememberState` stores as no entry at
	 * all -- so the command's own `forgetNoteState` is confirmed, not undone.
	 */
	resetFolds(): void {
		this.selectionKey = null;
		this.restoreFocusKey = null;
		this.collapseAll();
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

	/**
	 * Leaves in a branch counted over the whole note, folded parts included.
	 *
	 * This is what the balanced layout splits on. Counting only what is on screen
	 * would let a fold deep inside one branch shunt a different branch across to
	 * the other side of the root.
	 */
	private branchWeight(node: MindNode, showBody: boolean): number {
		const bodies = showBody ? node.bodyRanges.length : 0;
		if (node.children.length === 0) return Math.max(1, bodies);
		let total = bodies;
		for (const child of node.children) total += this.branchWeight(child, showBody);
		return total;
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
		const anchor = this.anchor;
		this.anchor = null;

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

		// Fixed by the note, not by what happens to be unfolded, so the balanced
		// layout keeps every branch on the side it started on.
		for (const branch of rootLayout.children) {
			branch.weight = this.branchWeight(branch.node, showBody);
		}

		let sawMath = false;
		for (const layout of visible) {
			const node = layout.node;
			const collapsed = this.collapsedKeys.has(node.key);
			const isBody = node.kind === "body";
			const element = buildNodeElement(this.nodeLayer, layout, {
				maxWidth: isBody
					? Math.round(s.maxNodeWidth * BODY_WIDTH_FACTOR)
					: s.maxNodeWidth,
				branchColors: s.branchColors,
				preformatted: isBody && looksPreformatted(node.text),
				expandable: isBody,
				addable: !isBody,
				collapsed,
				hasChildren: this.childCount(node, showBody) > 0,
				hiddenCount: collapsed ? this.hiddenCount(node, showBody) : 0,
			});
			this.elements.set(node.id, element);
			if (element.hasMath) sawMath = true;
		}

		// The fold shape and the selection are both final by now, and neither
		// changes again before the next paint.
		this.rememberState();

		const wasFitting = this.needsFit;
		const wasFocusing = this.restoreFocusKey;
		this.measureAndPlace(rootLayout, visible, anchor);
		if (!sawMath) return;

		if (!mathSettled()) {
			// First map with formulas this session: what is on screen right now
			// is placeholder source text, so the cards have to be rebuilt rather
			// than re-measured. `ensureMath` settles either way, so the repaint
			// takes the branch below and this can run at most once per session.
			void ensureMath().then(() => {
				if (token !== this.paintToken) return;
				if (wasFitting) {
					this.needsFit = true;
					this.restoreFocusKey = wasFocusing;
				}
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
			if (wasFitting) {
				this.needsFit = true;
				this.restoreFocusKey = wasFocusing;
			}
			this.measureAndPlace(rootLayout, visible, anchor);
		});
	}

	/**
	 * Measure the cards that `paint()` built and position everything.
	 *
	 * Safe to run more than once over the same tree: `layoutTree` assigns
	 * coordinates outright rather than accumulating them, and `renderEdges`
	 * clears the layer before it draws.
	 */
	private measureAndPlace(
		rootLayout: LayoutNode,
		visible: LayoutNode[],
		anchor: Anchor | null,
	): void {
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
			// A first look at the map reframes it deliberately; holding a node
			// still would fight that. Where it reframes *to* is the one thing a
			// restored session gets to change -- and only when the node it names
			// actually made it onto the canvas.
			this.needsFit = false;
			const focus = this.restoreFocusKey;
			this.restoreFocusKey = null;
			const framed = focus === null ? undefined : result.nodes.find((l) => l.node.key === focus);
			if (framed) {
				this.canvas.centreOn(framed.x + framed.width / 2, framed.y + framed.height / 2);
			} else {
				this.canvas.fit(result.width, result.height);
			}
			return;
		}
		if (!anchor) return;
		const held = result.nodes.find((l) => l.node.key === anchor.key);
		if (held) this.canvas.placeAt(held.x, held.y, anchor.screenX, anchor.screenY);
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
		// A drop onto the position a node already holds rewrites it to exactly what
		// it was. Nothing changed, so it earns neither an undo step nor a save.
		if (mutation.text === this.data) return;
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
		const before = this.selectionKey;
		// A body card is not something the map can act on, so picking one drops
		// the selection rather than leaving the previous card looking active.
		if (id === null || this.bodyNodes.has(id)) {
			this.selectionKey = null;
		} else {
			const node = this.parsed?.byId.get(id);
			if (!node) return;
			this.selectionKey = node.key;
		}
		this.applySelection();
		// Moving the selection is the one change that never repaints, so it is
		// the one change that has to record itself.
		if (this.selectionKey !== before) this.rememberState();
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

	addSiblingBeforeTo(id: string): void {
		this.withNode(id, (parsed, node) => {
			if (!node.parent) {
				this.addChildTo(id);
				return;
			}
			this.apply(addSiblingBefore(parsed, node, ""), true);
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
			// Has to agree with the `hasChildren` that decided whether to draw the
			// toggle at all, or the button exists and does nothing.
			if (this.childCount(node, this.plugin.settings.showBodyNodes) === 0) return;
			this.markAnchor(node.key);
			if (this.collapsedKeys.has(node.key)) this.collapsedKeys.delete(node.key);
			else this.collapsedKeys.add(node.key);
			this.paint();
		});
	}

	canDrop(id: string, targetId: string, mode: DropMode): boolean {
		const node = this.parsed?.byId.get(id);
		const target = this.parsed?.byId.get(targetId);
		if (!node || !target) return false;
		return mode === "child" ? canMove(node, target) : canReorder(node, target);
	}

	move(id: string, targetId: string, mode: DropMode): void {
		const parsed = this.parsed;
		const node = parsed?.byId.get(id);
		const target = parsed?.byId.get(targetId);
		if (!parsed || !node || !target) return;

		if (mode === "child") {
			this.collapsedKeys.delete(target.key);
			this.apply(moveNode(parsed, node, target));
			return;
		}
		// Dropped beside the target, so it is the target's parent that must be
		// open for the node to be visible where it landed.
		if (target.parent) this.collapsedKeys.delete(target.parent.key);
		this.apply(
			mode === "before"
				? moveBefore(parsed, node, target)
				: moveAfter(parsed, node, target),
		);
	}

	/**
	 * Follow a link written in a note-content card.
	 *
	 * Anything with a scheme is handed to the platform, but only from a short
	 * list: the target came out of a note, and `javascript:` must never reach a
	 * window. Everything else is a vault link -- a note, a heading, a PDF -- and
	 * goes through the workspace so it opens the way Obsidian opens it anywhere
	 * else.
	 */
	openLink(href: string, ev: MouseEvent): void {
		const newLeaf = Keymap.isModEvent(ev);
		if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
			if (/^(https?|obsidian|mailto):/i.test(href)) window.open(href, "_blank");
			return;
		}
		// `[a](My%20File.pdf)` is the same file as `[[My File.pdf]]`; only the
		// wikilink spelling arrives ready to resolve.
		let path = href;
		try {
			path = decodeURIComponent(href);
		} catch {
			// A stray `%` is not an escape. Take the target as written.
		}
		void this.app.workspace.openLinkText(path, this.file?.path ?? "", newLeaf);
	}

	showMenu(id: string, ev: MouseEvent): void {
		const menu = new Menu();

		// A content card stands for lines the note owns: it can be read and
		// edited, but never renamed, moved or given children.
		if (this.bodyNodes.has(id)) {
			menu.addItem((item) =>
				item
					.setTitle("Show the whole block")
					.setIcon("maximize-2")
					.onClick(() => this.expandBody(id)),
			);
			menu.addItem((item) =>
				item
					.setTitle("Edit the block source")
					.setIcon("pencil")
					.onClick(() => this.openBody(id, "edit")),
			);
			menu.showAtMouseEvent(ev);
			return;
		}

		const node = this.parsed?.byId.get(id);
		if (!node) return;
		this.select(id);

		menu.addItem((item) =>
			item
				.setTitle("Add child")
				.setIcon("corner-down-right")
				.onClick(() => this.addChildTo(id)),
		);
		if (node.parent) {
			menu.addItem((item) =>
				item
					.setTitle("Add sibling below")
					.setIcon("plus")
					.onClick(() => this.addSiblingTo(id)),
			);
			menu.addItem((item) =>
				item
					.setTitle("Add sibling above")
					.setIcon("plus")
					.onClick(() => this.addSiblingBeforeTo(id)),
			);
		}

		if (this.childCount(node, this.plugin.settings.showBodyNodes) > 0) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(this.collapsedKeys.has(node.key) ? "Unfold" : "Fold")
					.setIcon("chevrons-down-up")
					.onClick(() => this.toggleFold(id)),
			);
		}

		if (canRename(node) || node.parent) {
			menu.addSeparator();
			if (canRename(node)) {
				menu.addItem((item) =>
					item
						.setTitle("Rename")
						.setIcon("text-cursor-input")
						.onClick(() => this.beginEdit(id)),
				);
			}
			if (node.parent) {
				menu.addItem((item) =>
					item
						.setTitle("Delete")
						.setIcon("trash-2")
						.onClick(() => this.removeNode(id)),
				);
			}
		}

		menu.showAtMouseEvent(ev);
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

	// --- popovers -------------------------------------------------------------

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

	// --- the block dialog -----------------------------------------------------

	expandBody(id: string): void {
		this.openBody(id, "read");
	}

	/**
	 * Show a node's note content whole.
	 *
	 * The card only ever holds `previewOf`'s clipped text; the dialog is handed
	 * `bodyRangeText`, which is the block's exact source, so "expand" really does
	 * mean the whole block.
	 */
	openBody(id: string, mode: BlockDialogMode = "edit"): void {
		const parsed = this.parsed;
		if (!parsed) return;

		// A body card shows its own block; anything else shows all of its blocks.
		const ref = this.bodyNodes.get(id);
		const node = ref ? parsed.byKey.get(ref.ownerKey) : parsed.byId.get(id);
		if (!node || node.bodyRanges.length === 0) return;
		const only = ref?.index;
		if (only !== undefined && !node.bodyRanges[only]) return;

		const blocks: DialogBlock[] = [];
		node.bodyRanges.forEach((range, index) => {
			if (only !== undefined && index !== only) return;
			blocks.push({ index, range, text: bodyRangeText(parsed, range) });
		});
		if (blocks.length === 0) return;

		// Only one panel at a time: a dialog opened over the shortcuts popover
		// would leave it stranded behind the modal's own backdrop.
		this.closePopover();
		this.closeDialog();

		const key = node.key;
		this.dialog = new BlockDialog(this.app, {
			title: node.text || "Note content",
			sourcePath: this.file?.path ?? "",
			blocks,
			mode,
			onSave: (edits) => this.saveBody(key, edits),
			onClosed: () => {
				this.dialog = null;
				this.canvas.viewport.focus({ preventScroll: true });
			},
		});
		this.dialog.open();
	}

	private closeDialog(): void {
		const dialog = this.dialog;
		this.dialog = null;
		dialog?.close();
	}

	/**
	 * Write edited blocks back, one splice each.
	 *
	 * Re-parsing between edits is what keeps this correct: every splice can move
	 * the lines under the ranges that follow it, and the node is re-found by key
	 * rather than held across the change.
	 */
	private saveBody(key: string, edits: Array<{ index: number; text: string }>): void {
		const before = this.data;
		let text = this.data;

		// Highest index first so the earlier ranges' line numbers stay valid.
		for (const edit of [...edits].sort((a, b) => b.index - a.index)) {
			const snapshot = parseMarkdown(text, this.parseOptions());
			const current = snapshot.byKey.get(key);
			if (!current) break;
			const result = replaceBodyRange(snapshot, current, edit.index, edit.text);
			if (!result.ok) break;
			text = result.text;
		}
		if (text === before) return;

		this.undoStack.push(before);
		if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
		this.redoStack = [];
		this.commit(text, -1, false);
	}

	// --- file lifecycle -------------------------------------------------------

	override async onLoadFile(file: TFile): Promise<void> {
		this.needsFit = true;
		await super.onLoadFile(file);
	}
}
