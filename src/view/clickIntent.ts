/**
 * What a click on the map means: follow a link, swallow the tail of a drag, or
 * leave the click to everything else the card can do.
 *
 * Zero imports, exactly like `culling.ts` and `motion.ts` and for the same
 * reason: `npm test` runs the sources straight through Node with no bundler, so
 * anything a test can reach has to stay clear of `obsidian` -- and
 * `view/interactions.ts` cannot, since it is wired to the live view. The DOM
 * lookups stay there; the decision they feed lives here, where a test can ask
 * it directly.
 */

/** Where the pointer is, as the three things the answer turns on. */
export interface ClickTarget {
	/**
	 * The `data-kind` of the card under the pointer, or null off every card.
	 *
	 * Carried so the rule can be read off the code: the answer never depends on
	 * it. A link opens from a heading, a list item or the root exactly as it
	 * does from note content, and the tests walk every kind to hold that.
	 */
	kind: string | null;
	/** The `data-href` of the link or embed under the pointer; null when neither. */
	href: string | null;
	/** `MouseEvent.detail`: 1 for a single click, 2 for the second of a double. */
	clickCount: number;
}

/**
 * - `open` — follow `href`.
 * - `swallow` — the click belongs to a gesture that is already finished; stop
 *   it and do nothing.
 * - `select` — an ordinary click on a card: the rest of the click handler.
 */
export type ClickIntent =
	| { action: "open"; href: string }
	| { action: "swallow" }
	| { action: "select" };

/**
 * The one piece of state a click needs: whether a drag just ended.
 *
 * A finished drag re-renders the map, so the click that follows its pointerup
 * would resolve a stale element to whatever now holds that id -- the drag
 * raises the flag and the click spends it. The flag also comes down on the next
 * pointerdown, because that repaint happens *inside* pointerup and the browser
 * then often never fires the click at all: left standing, the flag would eat
 * the next real one instead, and one drag would cost the click after it.
 */
export class ClickGate {
	private suppressed = false;

	/** A drag just finished. Its own trailing click, if any, is not a click. */
	dragEnded(): void {
		this.suppressed = true;
	}

	/** A new gesture started, so nothing is owed to the previous one. */
	pointerDown(): void {
		this.suppressed = false;
	}

	/** What this click means. Spends the drag flag if one was raised. */
	click(target: ClickTarget): ClickIntent {
		if (this.suppressed) {
			this.suppressed = false;
			return { action: "swallow" };
		}
		if (target.href === null || target.href === "") return { action: "select" };
		// The second click of a double-click on a link: the first one already
		// opened it, and opening it twice is not what two clicks asked for.
		if (target.clickCount > 1) return { action: "swallow" };
		return { action: "open", href: target.href };
	}
}

/**
 * Whether a double-click opens an editor.
 *
 * No, when the pointer is on a link -- the click underneath it opened the link,
 * and the editor would come up over what was just opened -- and no on the
 * expand button, which has its own dialog.
 */
export function opensEditor(target: { href: string | null; onExpand: boolean }): boolean {
	return !target.onExpand && (target.href === null || target.href === "");
}
