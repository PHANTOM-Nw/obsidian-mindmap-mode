/**
 * What the map remembers about a note between sessions, and the rules for
 * keeping that record honest.
 *
 * Deliberately free of every import -- `obsidian` above all, so `node --test`
 * can run this file as-is, but also of the parser, so the store never grows an
 * opinion about what a key means. It holds strings the view handed it and hands
 * the same strings back; deciding which of them still point at a node is the
 * view's job, done against a fresh parse.
 *
 * Nothing here touches the note. The whole point of the feature is that fold
 * state lives in the plugin's own `data.json` and leaves the markdown alone.
 */

/** One note's view state, as it sits in `data.json`. */
export interface NoteViewState {
	/**
	 * `node.key` for every collapsed node -- the view's entire set, not just what
	 * the user clicked. The seeded entries deeper in the tree are what make
	 * expanding a branch reveal one level at a time, so dropping them would
	 * change how the restored map behaves, not just how much it stores.
	 */
	collapsed: string[];
	/** Text path of the node in focus when the map was last left. */
	focusKey?: string;
	/**
	 * Tree position of that same node, tried when the text path misses. Renaming
	 * a node moves its key and leaves its position; inserting a sibling does the
	 * reverse. Keeping both means only a change that does each at once loses the
	 * focus, and losing it costs a default framing, nothing more.
	 */
	focusId?: string;
	/** Last touched, in ms. Only ever compared, never shown. */
	at: number;
}

/** Keyed by note path, exactly as the vault spells it. */
export type FoldStore = Record<string, NoteViewState>;

/** What a caller supplies; `at` is stamped by the store. */
export type NoteViewEntry = Omit<NoteViewState, "at">;

/**
 * How many notes keep their state.
 *
 * A bound is needed because entries are never explicitly retired -- a note read
 * once and never again would otherwise sit in `data.json` forever. 200 is far
 * more than the notes anyone revisits in a session and small enough that the
 * file stays a file.
 */
export const MAX_REMEMBERED_NOTES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEntry(value: unknown): NoteViewState | null {
	if (!isRecord(value)) return null;
	if (!Array.isArray(value.collapsed)) return null;

	const state: NoteViewState = {
		collapsed: value.collapsed.filter((key): key is string => typeof key === "string"),
		at: typeof value.at === "number" && Number.isFinite(value.at) ? value.at : 0,
	};
	if (typeof value.focusKey === "string") state.focusKey = value.focusKey;
	if (typeof value.focusId === "string") state.focusId = value.focusId;
	return state;
}

/**
 * Whatever was in `data.json`, as a store.
 *
 * `data.json` is a plain file in the vault: it gets synced, merged, hand-edited
 * and truncated. Anything unreadable is dropped rather than repaired, because a
 * lost fold state is invisible and a throw here would take the plugin's whole
 * settings load down with it.
 */
export function readStore(raw: unknown): FoldStore {
	if (!isRecord(raw)) return {};
	const store: FoldStore = {};
	for (const [path, value] of Object.entries(raw)) {
		if (path === "") continue;
		const entry = readEntry(value);
		if (entry) store[path] = entry;
	}
	return prune(store);
}

/**
 * Drop the least recently used entries once the store is over its bound.
 *
 * Ties break on path so eviction is deterministic -- a whole vault written in
 * one pass shares a timestamp, and "whichever Object.keys happened to list
 * first" is not something a test can name.
 */
function prune(store: FoldStore): FoldStore {
	const paths = Object.keys(store);
	if (paths.length <= MAX_REMEMBERED_NOTES) return store;

	paths.sort((a, b) => store[a].at - store[b].at || (a < b ? -1 : 1));
	const kept: FoldStore = {};
	for (const path of paths.slice(paths.length - MAX_REMEMBERED_NOTES)) {
		kept[path] = store[path];
	}
	return kept;
}

/** The store with one note's state written, replacing whatever was there. */
export function putNoteState(
	store: FoldStore,
	path: string,
	entry: NoteViewEntry,
	now: number,
): FoldStore {
	if (path === "") return store;
	const state: NoteViewState = { collapsed: [...entry.collapsed], at: now };
	if (entry.focusKey !== undefined) state.focusKey = entry.focusKey;
	if (entry.focusId !== undefined) state.focusId = entry.focusId;
	return prune({ ...store, [path]: state });
}

/** The store with one note's state gone. */
export function forgetNote(store: FoldStore, path: string): FoldStore {
	if (!(path in store)) return store;
	const next = { ...store };
	delete next[path];
	return next;
}

/**
 * Follow a note that moved.
 *
 * A rename in Obsidian is a move: same file, new path. Without this the state
 * would be stranded under a path nothing opens again, and the note would come
 * back folded to the default as if it had never been read.
 */
export function renameNote(store: FoldStore, from: string, to: string): FoldStore {
	const state = store[from];
	if (!state || from === to || to === "") return store;
	const next = { ...store };
	delete next[from];
	next[to] = state;
	return next;
}

/** The store with every note under a folder gone. Deletes arrive folder-only too. */
export function forgetFolder(store: FoldStore, path: string): FoldStore {
	if (path === "") return store;
	const prefix = `${path}/`;
	const gone = Object.keys(store).filter((entry) => entry.startsWith(prefix));
	if (gone.length === 0) return store;

	const next = { ...store };
	for (const entry of gone) delete next[entry];
	return next;
}

/**
 * Follow every note under a folder that moved.
 *
 * Obsidian fires one `rename` for the folder and none for the files inside it,
 * so without this, moving a folder silently strands the state of every note it
 * holds. Matching on `from + "/"` rather than `from` is what keeps a sibling
 * folder called `Archive-2024` out of a rename of `Archive`.
 */
export function renameFolder(store: FoldStore, from: string, to: string): FoldStore {
	if (from === to || from === "" || to === "") return store;
	const prefix = `${from}/`;
	const moved = Object.keys(store).filter((path) => path.startsWith(prefix));
	if (moved.length === 0) return store;

	const next = { ...store };
	for (const path of moved) {
		delete next[path];
		next[`${to}/${path.slice(prefix.length)}`] = store[path];
	}
	return next;
}
