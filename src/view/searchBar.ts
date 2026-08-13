import { debounce, setIcon } from "obsidian";
import type { Debouncer } from "obsidian";

import type { SearchQuery } from "../model/search.ts";

/**
 * How long typing settles before the map is searched again.
 *
 * Long enough that a burst of keystrokes is one query, short enough that the
 * count still feels like it is following the input.
 */
const TYPE_DELAY = 150;

export interface SearchBarOptions {
	/** What the session was last searching for; the bar opens holding it. */
	query: SearchQuery;
	onQuery: (query: SearchQuery) => void;
	/** +1 for the next match, -1 for the previous. */
	onStep: (delta: number) => void;
	onClose: () => void;
}

/**
 * The floating find bar.
 *
 * Mounted on `contentEl` rather than inside the canvas viewport: the map's own
 * keyboard handler sits on the viewport, so typing here cannot reach it, and
 * the bar is free to keep only the three keys it actually owns.
 */
export class SearchBar {
	private readonly el: HTMLElement;
	private readonly input: HTMLInputElement;
	private readonly count: HTMLElement;
	private readonly regexToggle: HTMLElement;
	private readonly opts: SearchBarOptions;
	private readonly submit: Debouncer<[], void>;
	private regex: boolean;
	/** True between compositionstart and compositionend. */
	private composing = false;

	constructor(parent: HTMLElement, opts: SearchBarOptions) {
		this.opts = opts;
		this.regex = opts.query.regex;

		this.el = parent.createDiv({ cls: "mm-search" });
		this.input = this.el.createEl("input", {
			cls: "mm-search-input",
			type: "text",
			value: opts.query.text,
			attr: {
				placeholder: "Find in the map",
				"aria-label": "Find in the map",
				spellcheck: "false",
			},
		});

		this.regexToggle = this.button(null, ".*", "Regular expression", () =>
			this.toggleRegex(),
		);
		this.regexToggle.toggleClass("is-active", this.regex);
		this.regexToggle.setAttribute("aria-pressed", String(this.regex));

		this.count = this.el.createDiv({ cls: "mm-search-count", text: "0/0" });
		this.button("chevron-up", "↑", "Previous match", () => opts.onStep(-1));
		this.button("chevron-down", "↓", "Next match", () => opts.onStep(1));
		this.button("x", "✕", "Close search", () => opts.onClose());

		this.submit = debounce(() => this.emit(), TYPE_DELAY, true);

		this.input.addEventListener("input", () => {
			// A composition in progress is not a query: searching each candidate
			// keystroke would drag the camera around on half a syllable.
			if (this.composing) return;
			this.submit();
		});
		this.input.addEventListener("compositionstart", () => {
			this.composing = true;
		});
		this.input.addEventListener("compositionend", () => {
			this.composing = false;
			this.submit();
		});
		this.input.addEventListener("keydown", (ev) => this.onKeyDown(ev));
	}

	focus(): void {
		this.input.focus();
		this.input.select();
	}

	setStatus(current: number, total: number, invalid: boolean): void {
		this.count.setText(`${current}/${total}`);
		this.input.toggleClass("is-error", invalid);
	}

	destroy(): void {
		// Cancelled before the element goes: a query firing afterwards would
		// search on behalf of a bar that no longer exists.
		this.submit.cancel();
		this.el.remove();
	}

	private button(
		icon: string | null,
		text: string,
		label: string,
		onClick: () => void,
	): HTMLElement {
		const el = this.el.createDiv({
			cls: "mm-tool",
			attr: { "aria-label": label, role: "button" },
		});
		if (icon) setIcon(el, icon);
		// `setIcon` is silent when an id is not in the bundled set, which would
		// leave an invisible but clickable box beside the input.
		if (!el.firstElementChild) el.setText(text);
		el.addEventListener("click", (ev) => {
			ev.preventDefault();
			onClick();
		});
		return el;
	}

	private onKeyDown(ev: KeyboardEvent): void {
		// The Enter that confirms an IME candidate arrives here as well.
		if (ev.isComposing) return;

		if (ev.key === "Enter") {
			this.take(ev);
			// Anything still on the timer is this same query, and stepping before
			// it lands would walk the previous match list.
			this.submit.run();
			this.opts.onStep(ev.shiftKey ? -1 : 1);
			return;
		}
		if (ev.key === "Escape") {
			this.take(ev);
			this.opts.onClose();
			return;
		}
		if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "f") {
			this.take(ev);
			this.input.select();
			return;
		}
		// Every other key keeps its usual meaning, the command palette included.
	}

	private take(ev: KeyboardEvent): void {
		ev.preventDefault();
		ev.stopPropagation();
	}

	private toggleRegex(): void {
		this.regex = !this.regex;
		this.regexToggle.toggleClass("is-active", this.regex);
		this.regexToggle.setAttribute("aria-pressed", String(this.regex));
		// A button press is not typing; there is nothing left to wait for.
		this.submit.cancel();
		this.emit();
		this.input.focus();
	}

	private emit(): void {
		this.opts.onQuery({ text: this.input.value, regex: this.regex });
	}
}
