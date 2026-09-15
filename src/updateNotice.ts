/**
 * Whether a load follows an update the user should be told about, and what to
 * remember afterwards.
 *
 * Free of every import -- `node --test` runs this file as it is, and the rule
 * is the part that can be got wrong. Showing the notice is `main.ts`'s job.
 *
 * An update from Obsidian's plugin browser arrives without a word, so a release
 * with something to say gets exactly one notice: the load after the update, and
 * no load after that.
 */

/** How long the notice stays up, in ms. Long enough to read it once. */
export const UPDATE_NOTICE_MS = 10000;

/** A notice and the version it speaks for. */
export interface UpdateNotice {
	version: string;
	text: string;
}

/**
 * The notice for the version that has something to say; a release with nothing
 * to announce leaves this pointing at the older version, and it then never
 * shows.
 *
 * A Notice is plain text -- no code spans, no links -- in a small box, so the
 * text stays to a sentence or two.
 */
export const UPDATE_NOTICE: UpdateNotice = {
	version: "1.1.2",
	text:
		"Mindmap Mode 1.1.2 fixes two things: an open map now follows edits made"
		+ " to the note outside it (another pane, sync, an external editor), and"
		+ " a link in a heading, list item, task item or the root card opens on"
		+ " click.",
};

/**
 * True only when the notice belongs to the running version -- which is what
 * makes a release that left the constant alone silent by construction -- and
 * this load follows an update.
 *
 * `freshInstall` is "data.json held no settings", not "the file was missing":
 * a vault that has run this plugin before but never stored a version came from
 * a release that kept no record. A first install announces nothing -- there is
 * no change to report to someone meeting the plugin for the first time.
 */
export function shouldAnnounce(
	lastSeen: unknown,
	current: string,
	freshInstall: boolean,
	notice: UpdateNotice = UPDATE_NOTICE,
): boolean {
	if (notice.version !== current) return false;
	if (typeof lastSeen === "string" && lastSeen !== "") return lastSeen !== current;
	return !freshInstall;
}

/**
 * The version to store, or null when what is already stored is right. It is
 * recorded whether or not anything was announced, so the next version that does
 * carry a notice shows it exactly once.
 */
export function versionToRecord(lastSeen: unknown, current: string): string | null {
	return lastSeen === current ? null : current;
}
