import { Notice } from "obsidian";
import type { App, TFile } from "obsidian";

import { htmlDocument, svgDocument } from "./documents.ts";
import { nextFreePath, takenBy } from "./paths.ts";
import { rasterize } from "./raster.ts";
import type { Snapshot } from "./snapshot.ts";

/**
 * The vault side of exporting: where the file goes, what it is called, and what
 * the user is told about it.
 *
 * The map itself is built by the view and arrives through `ExportSource`, which
 * is what keeps this file out of the view's import cycle.
 */

export type ExportFormat = "canvas" | "svg" | "png" | "html";

export interface ExportCommand {
	/** Command id, as registered. */
	id: string;
	/** Command name, as shown in the palette. */
	name: string;
	/** The same thing, said shorter, for the tab's menu. */
	menu: string;
	icon: string;
	format: ExportFormat;
}

/** Declared once: the palette reads it, and so does the pane menu. */
export const EXPORT_COMMANDS: readonly ExportCommand[] = [
	{
		id: "export-canvas",
		name: "Export mind map as Canvas",
		menu: "Export as Canvas",
		icon: "layout-dashboard",
		format: "canvas",
	},
	{
		id: "export-svg",
		name: "Export mind map as SVG",
		menu: "Export as SVG",
		icon: "file-code",
		format: "svg",
	},
	{
		id: "export-png",
		name: "Export mind map as PNG",
		menu: "Export as PNG",
		icon: "image",
		format: "png",
	},
	{
		id: "export-html",
		name: "Export mind map as HTML",
		menu: "Export as HTML",
		icon: "code",
		format: "html",
	},
];

export interface ExportSource {
	/** The `.canvas` file's text, or null when there is nothing on the map. */
	canvasFile(): string | null;
	/** The map as an XHTML fragment, or null when there is nothing on the map. */
	snapshot(): Snapshot | null;
}

/**
 * Beside the note, same basename, new extension -- and never over the top of
 * something that is already there.
 *
 * The folder's own listing is what is checked, rather than a lookup by exact
 * path: a vault path is case-sensitive and the disk under it usually is not.
 */
function freePath(app: App, file: TFile, ext: string): string {
	const folder = file.parent ?? app.vault.getRoot();
	const path = folder.path === "/" ? "" : folder.path;
	const exists = takenBy(folder.children.map((child) => child.name));
	return nextFreePath(exists, path, file.basename, ext);
}

export async function runExport(
	app: App,
	file: TFile | null,
	format: ExportFormat,
	source: ExportSource,
): Promise<void> {
	if (!file) {
		new Notice("Nothing to export");
		return;
	}

	try {
		if (format === "canvas") {
			const text = source.canvasFile();
			if (text === null) {
				new Notice("Nothing to export");
				return;
			}
			const created = await app.vault.create(freePath(app, file, "canvas"), text);
			// A canvas is something to work in rather than something to look at,
			// so it opens where the note can stay open beside it.
			await app.workspace.getLeaf(true).openFile(created);
			return;
		}

		const snapshot = source.snapshot();
		if (snapshot === null) {
			new Notice("Nothing to export");
			return;
		}
		const title = file.basename;

		const { width, height, background } = snapshot;

		if (format === "html") {
			// The HTML serialization, not the XML one: an HTML parser reads
			// `<div/>` as a tag that was never closed.
			const created = await app.vault.create(
				freePath(app, file, "html"),
				htmlDocument({ body: snapshot.html, width, height, background, title }),
			);
			new Notice(`Mind map exported to ${created.path}`);
			return;
		}

		const svg = svgDocument({ body: snapshot.xhtml, width, height, background, title });

		if (format === "svg") {
			const created = await app.vault.create(freePath(app, file, "svg"), svg);
			new Notice(`Mind map exported to ${created.path}`);
			return;
		}

		const raster = await rasterize(svg, snapshot.width, snapshot.height);
		const created = await app.vault.createBinary(freePath(app, file, "png"), raster.data);
		new Notice(
			raster.clamped
				? `Mind map exported to ${created.path}, scaled down to stay within 16384 px`
				: `Mind map exported to ${created.path}`,
		);
	} catch (error) {
		console.error("Mindmap Mode: the export failed.", error);
		const reason = error instanceof Error ? error.message : String(error);
		new Notice(`Mind map export failed: ${reason}`);
	}
}
