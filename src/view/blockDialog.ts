import { Component, Keymap, MarkdownRenderer, Modal } from "obsidian";
import type { App, PaneType } from "obsidian";

import { ensureMath, finishRenderMath } from "./math.ts";

/**
 * The full view of a note-content block.
 *
 * A body card on the map is a preview: `previewOf` clips it, and `renderInline`
 * only knows inline markup, so a table, a fenced block or a `\begin{align}`
 * environment never looks like itself out there. This dialog is where the block
 * is shown whole and rendered by Obsidian's own reading-view pipeline, which is
 * the only renderer that gets every case right.
 *
 * It is a `Modal` rather than the view's `.mm-popover` because `.mindmap-mode`
 * is `overflow: hidden` -- a popover big enough to read a long block would be
 * clipped by the viewport it hangs in.
 */

export type BlockDialogMode = "read" | "edit";

export interface DialogBlock {
	/** Index into the owner's `bodyRanges`; the view needs it back to save. */
	index: number;
	/** Inclusive, zero-based line range in the note. */
	range: [number, number];
	/** The block's exact source, untruncated. */
	text: string;
}

export interface BlockDialogOptions {
	title: string;
	/** Resolves relative links and embeds; the note's path. */
	sourcePath: string;
	blocks: DialogBlock[];
	mode: BlockDialogMode;
	/** Only the blocks whose text actually changed. Ordering is the caller's. */
	onSave: (edits: Array<{ index: number; text: string }>) => void;
	onClosed?: () => void;
}

const MAX_TEXTAREA_ROWS = 24;

export class BlockDialog extends Modal {
	private readonly opts: BlockDialogOptions;

	/**
	 * `Modal` is not a `Component`, and `MarkdownRenderer.render` needs one to
	 * hang the children it spawns off. This owns them, so closing the dialog
	 * tears down whatever the rendered markdown started.
	 */
	private readonly lifecycle = new Component();

	/** Current text per block, so Preview <-> Source never drops an edit. */
	private readonly drafts = new Map<number, string>();

	private mode: BlockDialogMode;
	private body: HTMLElement | null = null;
	private readonly tabs = new Map<BlockDialogMode, HTMLElement>();

	/** Bumped on every repaint so a slow render cannot paint over a newer one. */
	private renderToken = 0;

	constructor(app: App, opts: BlockDialogOptions) {
		super(app);
		this.opts = opts;
		this.mode = opts.mode;
		for (const block of opts.blocks) this.drafts.set(block.index, block.text);
	}

	override onOpen(): void {
		this.lifecycle.load();
		this.modalEl.addClass("mm-block-dialog");
		this.setTitle(this.opts.title);

		const { contentEl } = this;
		contentEl.createEl("p", {
			cls: "mm-dialog-hint",
			text: "This content stays in the note exactly where it is. Editing here rewrites only these lines.",
		});

		const modes = contentEl.createDiv({ cls: "mm-dialog-modes" });
		this.addTab(modes, "read", "Preview");
		this.addTab(modes, "edit", "Source");

		this.body = contentEl.createDiv({ cls: "mm-dialog-body" });
		// Bound once, not per repaint: `renderBody` empties this element, it never
		// replaces it. Middle-click arrives as auxclick, never as click.
		this.body.addEventListener("click", (ev) => this.followLink(ev));
		this.body.addEventListener("auxclick", (ev) => this.followLink(ev));

		const actions = contentEl.createDiv({ cls: "mm-dialog-actions" });
		actions.createEl("button", { text: "Close" }).addEventListener("click", () => this.close());
		actions
			.createEl("button", { cls: "mod-cta", text: "Save" })
			.addEventListener("click", () => this.save());

		this.renderBody();
	}

	override onClose(): void {
		// Before `contentEl.empty()`: unloading is what stops anything the
		// rendered markdown started, and it must not race the DOM going away.
		this.lifecycle.unload();
		this.contentEl.empty();
		this.opts.onClosed?.();
	}

	private addTab(parent: HTMLElement, mode: BlockDialogMode, label: string): void {
		const el = parent.createEl("button", { cls: "mm-dialog-mode", text: label });
		el.addEventListener("click", () => this.setMode(mode));
		this.tabs.set(mode, el);
	}

	private setMode(mode: BlockDialogMode): void {
		if (mode === this.mode) return;
		this.mode = mode;
		this.renderBody();
	}

	private renderBody(): void {
		const body = this.body;
		if (!body) return;

		for (const [mode, el] of this.tabs) el.toggleClass("is-active", mode === this.mode);

		// Every repaint invalidates the renders the previous one had in flight.
		const token = ++this.renderToken;
		body.empty();

		for (const block of this.opts.blocks) {
			const wrapper = body.createDiv({ cls: "mm-body-block" });
			wrapper.createDiv({
				cls: "mm-body-lines",
				text: `Lines ${block.range[0] + 1}–${block.range[1] + 1}`,
			});

			const text = this.drafts.get(block.index) ?? block.text;
			if (this.mode === "edit") {
				const area = wrapper.createEl("textarea", { cls: "mm-body-input" });
				area.value = text;
				area.rows = Math.min(MAX_TEXTAREA_ROWS, text.split("\n").length + 1);
				area.addEventListener("input", () => this.drafts.set(block.index, area.value));
			} else {
				// `markdown-rendered` is what pulls in the reading view's own CSS
				// for tables, callouts and code blocks.
				const host = wrapper.createDiv({ cls: "mm-body-render markdown-rendered" });
				void this.renderMarkdown(host, text, token);
			}
		}
	}

	/**
	 * Vault links, which Obsidian renders here but nothing navigates from.
	 *
	 * External links already work: those are handed to the platform wherever they
	 * appear, which is why a web address opens from this dialog and `[[a.pdf]]`
	 * does not. Both halves below matter -- the workspace call, and closing first,
	 * because a note opened behind a modal is indistinguishable from a link that
	 * did nothing at all.
	 */
	private followLink(ev: MouseEvent): void {
		if (ev.button !== 0 && ev.button !== 1) return;
		const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>(
			"a.internal-link, a[data-href]",
		);
		if (!el || el.hasClass("external-link")) return;
		const href = el.dataset.href ?? el.getAttribute("href");
		if (!href) return;

		ev.preventDefault();
		ev.stopPropagation();
		const newLeaf: PaneType | boolean = ev.button === 1 ? "tab" : Keymap.isModEvent(ev);
		this.close();
		void this.app.workspace.openLinkText(href, this.opts.sourcePath, newLeaf);
	}

	private async renderMarkdown(host: HTMLElement, text: string, token: number): Promise<void> {
		// The view warms MathJax when a map opens; awaiting it covers the case
		// where this dialog wins that race, so formulas never paint as source.
		await ensureMath();
		if (token !== this.renderToken) return;

		try {
			await MarkdownRenderer.render(this.app, text, host, this.opts.sourcePath, this.lifecycle);
			await finishRenderMath();
		} catch (error) {
			// Uncaught, a single malformed block would leave the dialog blank.
			console.error("Mindmap Mode: could not render this block.", error);
			if (token !== this.renderToken) return;
			host.empty();
			host.createEl("pre", { text });
		}
	}

	private save(): void {
		const edits = this.opts.blocks
			.filter((block) => (this.drafts.get(block.index) ?? block.text) !== block.text)
			.map((block) => ({
				index: block.index,
				text: this.drafts.get(block.index) ?? block.text,
			}));

		this.close();
		if (edits.length > 0) this.opts.onSave(edits);
	}
}
