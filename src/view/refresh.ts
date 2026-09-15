/**
 * "Does this `setViewData` have to repaint the map?", on its own.
 *
 * Zero imports, exactly like `culling.ts` and `motion.ts` and for the same
 * reason: `npm test` runs the sources straight through Node with no bundler, so
 * anything a test can reach has to stay clear of `obsidian` -- and
 * `MindmapView` is nothing but `obsidian`.
 *
 * The question exists because a save comes back. Writing the note makes
 * Obsidian read it again and hand the view the exact string it just wrote, and
 * repainting a map that is already drawn from that string is a whole layout for
 * no change at all. So a call is worth a paint only when it carries content the
 * map on screen was *not* drawn from.
 *
 * What it may not be compared against is `TextFileView.data`. That field
 * belongs to Obsidian, which sets it from the file before it calls
 * `setViewData`, so on an external edit the incoming string and `data` are the
 * same string and a guard written against it swallows every external edit --
 * which is the bug this replaces (1.1.0 through 1.1.1).
 */

/**
 * @param incoming what `setViewData` was handed.
 * @param drawn what the map currently on screen was painted from, or `null`
 *   when nothing is on screen: a fresh view, a cleared one, a paint that threw,
 *   or one that measured every card as zero because the pane had no size yet.
 * @param clear Obsidian's flag for "a different file", which is never skipped.
 */
export function needsRepaint(incoming: string, drawn: string | null, clear: boolean): boolean {
	if (clear) return true;
	return drawn === null || incoming !== drawn;
}
