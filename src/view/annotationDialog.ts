import { Modal } from "obsidian";
import type { App } from "obsidian";

/** A plain multiline editor. Syntax prefixes belong to the source writer. */
export class AnnotationDialog extends Modal {
	private readonly title: string;
	private readonly text: string;
	private readonly onSave: (text: string) => boolean;
	private readonly onClosed: () => void;

	constructor(
		app: App,
		title: string,
		text: string,
		onSave: (text: string) => boolean,
		onClosed: () => void,
	) {
		super(app);
		this.title = title;
		this.text = text;
		this.onSave = onSave;
		this.onClosed = onClosed;
	}

	override onOpen(): void {
		this.modalEl.addClass("mm-annotation-dialog");
		this.setTitle(`Annotation — ${this.title}`);
		this.contentEl.createEl("p", {
			text: "Enter inserts a line break. Blank lines are preserved. No colon prefixes needed. Clear the text and save to remove the annotation.",
		});
		const input = this.contentEl.createEl("textarea", { cls: "mm-annotation-input" });
		input.setAttribute("aria-label", "Annotation");
		input.value = this.text;
		input.rows = Math.min(20, Math.max(6, this.text.split("\n").length + 2));
		// Where the text lands is the part of the feature a note cannot show: the
		// prefix is this plugin's convention, and the editor never displays one.
		const hint = this.contentEl.createEl("p", { cls: "mm-annotation-hint" });
		hint.appendText("Saved into the note as ");
		hint.createEl("code", { text: ": " });
		hint.appendText(" lines beneath the node. Ctrl/Cmd+Enter saves.");
		const save = () => { if (this.onSave(input.value)) this.close(); };
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				save();
			}
		});
		const actions = this.contentEl.createDiv({ cls: "mm-dialog-actions" });
		actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		actions.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", save);
		input.focus();
	}

	override onClose(): void {
		this.contentEl.empty();
		this.onClosed();
	}
}
