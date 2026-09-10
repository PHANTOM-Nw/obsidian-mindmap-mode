/**
 * Every key the map answers, declared once.
 *
 * The table below is the source of truth for three readers: the keydown handler
 * in `interactions.ts` resolves a press through it, the settings tab renders a
 * row per entry and rebinds it, and the in-app help panel prints whatever is
 * bound right now. Adding an action here is what makes it appear in all three.
 *
 * Nothing in this file imports `obsidian` -- the tests run the sources through
 * Node's type stripping, where that module does not exist.
 */

/**
 * One press, normalised.
 *
 * `key` is `KeyboardEvent.key` with the two spellings that vary flattened:
 * letters are lower-cased and `" "` is written `"Space"`. Named keys keep their
 * own spelling (`"ArrowUp"`, `"Tab"`, `"Enter"`, `"Delete"`, `"Escape"`).
 *
 * `mod` is Obsidian's "Mod" -- Ctrl on Windows and Linux, Cmd on macOS -- which
 * is why a combo carries no separate ctrl and meta.
 */
export interface KeyCombo {
	key: string;
	mod: boolean;
	shift: boolean;
	alt: boolean;
}

/** The shape `comboFromEvent` reads, so a test can hand it a plain object. */
export interface KeyEventLike {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

/** Keys that are only ever half of a combo. */
const MODIFIER_KEYS = new Set([
	"Shift",
	"Control",
	"Meta",
	"Alt",
	"AltGraph",
	"CapsLock",
	"NumLock",
	"ScrollLock",
	"Dead",
	"Process",
	"Unidentified",
]);

/** A cased letter, in any alphabet: the one thing `key` reports two ways. */
function isLetter(key: string): boolean {
	return key.length === 1 && key.toLowerCase() !== key.toUpperCase();
}

/**
 * Whether Shift is part of this combo or already spent on the character.
 *
 * A letter reports its own case, so Shift has to be kept to tell `z` from `Z`.
 * Every other single character *is* the shifted reading -- `+` is what Shift
 * and `=` produce -- so carrying the flag as well would ask for a press that no
 * keyboard can make.
 */
function shiftApplies(key: string): boolean {
	return key.length !== 1 || isLetter(key);
}

export function normaliseKey(key: string): string {
	if (key === " " || key === "Spacebar") return "Space";
	return isLetter(key) ? key.toLowerCase() : key;
}

export function comboFromEvent(ev: KeyEventLike): KeyCombo {
	const key = normaliseKey(ev.key);
	return {
		key,
		mod: ev.ctrlKey || ev.metaKey,
		shift: ev.shiftKey && shiftApplies(key),
		alt: ev.altKey,
	};
}

/** A press that is still waiting for the key it modifies. */
export function isModifierOnly(combo: KeyCombo): boolean {
	return MODIFIER_KEYS.has(combo.key);
}

export function sameCombo(a: KeyCombo, b: KeyCombo): boolean {
	return a.key === b.key && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt;
}

/** What one keydown means to a shortcut row that is recording. */
export type RecordOutcome = "ignore" | "cancel" | { combo: KeyCombo };

/**
 * Turns a keydown into a recording decision, with no DOM in the way -- the
 * settings tab's window-level listener calls this and then only carries out
 * whatever it says.
 *
 * A modifier held alone is half of a combo, not one yet, so recording waits
 * for the next key. Escape is the one key a capture cannot record -- it
 * cancels the capture instead. Everything else, Delete and Backspace
 * included, becomes the new binding.
 */
export function recordKey(ev: KeyEventLike): RecordOutcome {
	const combo = comboFromEvent(ev);
	if (isModifierOnly(combo)) return "ignore";
	if (combo.key === "Escape") return "cancel";
	return { combo };
}

/** The stored spelling: `"Mod+Shift+ArrowUp"`, `"Mod++"`, `"]"`. */
export function serializeCombo(combo: KeyCombo): string {
	const parts: string[] = [];
	if (combo.mod) parts.push("Mod");
	if (combo.alt) parts.push("Alt");
	if (combo.shift) parts.push("Shift");
	parts.push(combo.key);
	return parts.join("+");
}

const MOD_ALIASES: Record<string, "mod" | "shift" | "alt"> = {
	Mod: "mod",
	Ctrl: "mod",
	Control: "mod",
	Cmd: "mod",
	Meta: "mod",
	Shift: "shift",
	Alt: "alt",
	Option: "alt",
};

/**
 * Reads the stored spelling back, or null when there is no key left in it.
 *
 * The key is whatever follows the last modifier, which is what lets `"Mod++"`
 * mean Mod and `+` rather than a trailing empty name. Everything that comes
 * back is normalised, so a hand-edited `data.json` still lands on a combo the
 * keyboard can actually produce.
 */
export function parseCombo(text: string): KeyCombo | null {
	let rest = text.trim();
	if (rest === "") return null;

	let mod = false;
	let shift = false;
	let alt = false;
	for (;;) {
		const match = /^([A-Za-z]+)\+(?=.)/.exec(rest);
		const flag = match ? MOD_ALIASES[match[1]] : undefined;
		if (!match || !flag) break;
		if (flag === "mod") mod = true;
		else if (flag === "shift") shift = true;
		else alt = true;
		rest = rest.slice(match[0].length);
	}

	// What is left is the key itself, so the only `+` it may still hold is the
	// key named `+`. Anything else is a separator with no modifier in front of
	// it, or a modifier this version does not know.
	if (rest.length > 1 && rest.includes("+")) return null;

	const key = normaliseKey(rest);
	if (key === "") return null;
	return { key, mod, shift: shift && shiftApplies(key), alt };
}

const KEY_LABELS: Record<string, string> = {
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	Escape: "Esc",
};

/** How a combo is written for a reader: `Ctrl + ↑`, or `⌘ ↑` on macOS. */
export function comboToString(combo: KeyCombo, isMac: boolean): string {
	const parts: string[] = [];
	if (combo.mod) parts.push(isMac ? "⌘" : "Ctrl");
	if (combo.alt) parts.push(isMac ? "⌥" : "Alt");
	if (combo.shift) parts.push(isMac ? "⇧" : "Shift");
	parts.push(KEY_LABELS[combo.key] ?? (isLetter(combo.key) ? combo.key.toUpperCase() : combo.key));
	return parts.join(isMac ? " " : " + ");
}

function mustParse(text: string): KeyCombo {
	const combo = parseCombo(text);
	if (!combo) throw new Error(`Not a key combination: ${text}`);
	return combo;
}

/**
 * The table.
 *
 * Order is the order the settings tab and the help panel list the actions in,
 * and it is also the order a press is matched in: bind two actions to one combo
 * and the earlier one answers. The settings tab warns about exactly that.
 */
const TABLE = [
	{
		action: "add-child",
		name: "Add a child",
		description: "Add an empty child to the selected node and start editing it.",
		defaults: ["Tab"],
	},
	{
		action: "add-sibling",
		name: "Add a sibling",
		description: "Add an empty node below the selected one, at the same level.",
		defaults: ["Enter"],
	},
	{
		action: "edit-title",
		name: "Edit the title",
		description: "Edit the selected node's text in place.",
		defaults: ["Shift+Enter", "F2"],
	},
	{
		action: "delete-node",
		name: "Delete the node",
		description: "Delete the selected node and everything under it.",
		defaults: ["Delete", "Backspace"],
	},
	{
		action: "toggle-check",
		name: "Cycle the checkbox",
		description: "Step the selected list item through none, unchecked and checked.",
		defaults: ["Mod+Enter"],
	},
	{
		action: "expand-body",
		name: "Show the note content",
		description:
			"Open the selected node's paragraphs and code blocks whole, rendered, in their own dialog. Unbound by default; the ⤢ button on a content card does the same thing.",
		defaults: [],
	},
	{
		action: "indent",
		name: "Indent",
		description: "Make the selected node a child of the sibling above it.",
		defaults: ["]"],
	},
	{
		action: "outdent",
		name: "Outdent",
		description: "Make the selected node a sibling of its own parent.",
		defaults: ["Shift+Tab"],
	},
	{
		action: "move-up",
		name: "Move up among siblings",
		description: "Swap the selected node, subtree and all, with the sibling above it.",
		defaults: ["Mod+ArrowUp"],
	},
	{
		action: "move-down",
		name: "Move down among siblings",
		description: "Swap the selected node, subtree and all, with the sibling below it.",
		defaults: ["Mod+ArrowDown"],
	},
	{
		action: "toggle-fold",
		name: "Fold or unfold",
		description: "Hide or show the selected node's children.",
		defaults: ["Space"],
	},
	{
		action: "navigate-up",
		name: "Select the node above",
		description: "Move the selection to the nearest card above.",
		defaults: ["ArrowUp"],
	},
	{
		action: "navigate-down",
		name: "Select the node below",
		description: "Move the selection to the nearest card below.",
		defaults: ["ArrowDown"],
	},
	{
		action: "navigate-left",
		name: "Select the node to the left",
		description: "Move the selection to the nearest card to the left.",
		defaults: ["ArrowLeft"],
	},
	{
		action: "navigate-right",
		name: "Select the node to the right",
		description: "Move the selection to the nearest card to the right.",
		defaults: ["ArrowRight"],
	},
	{
		action: "search",
		name: "Find in the map",
		description:
			"Open the find bar over the canvas. Enter and Shift+Enter step through the matches.",
		defaults: ["Mod+f"],
	},
	{
		action: "close-search",
		name: "Close the find bar",
		description:
			"Only the map's while a find bar is open; with no bar up the key keeps whatever meaning Obsidian gives it.",
		defaults: ["Escape"],
	},
	{
		action: "undo",
		name: "Undo",
		description: "Undo the last edit made on the map.",
		defaults: ["Mod+z"],
	},
	{
		action: "redo",
		name: "Redo",
		description: "Redo the last undone edit.",
		defaults: ["Mod+Shift+z", "Mod+y"],
	},
	{
		action: "fit",
		name: "Fit to window",
		description: "Frame the whole map in the viewport.",
		defaults: ["Mod+0"],
	},
	{
		action: "zoom-in",
		name: "Zoom in",
		description: "Zoom the canvas in one step.",
		defaults: ["Mod+=", "Mod++"],
	},
	{
		action: "zoom-out",
		name: "Zoom out",
		description: "Zoom the canvas out one step.",
		defaults: ["Mod+-"],
	},
	{
		action: "centre-selection",
		name: "Centre on the selection",
		description: "Bring the selected node to the middle of the viewport.",
		defaults: ["Mod+."],
	},
] as const;

/** Every action the map's keyboard performs. */
export type ShortcutAction = (typeof TABLE)[number]["action"];

export interface Shortcut {
	action: ShortcutAction;
	/** Shown in the settings tab and the help panel. */
	name: string;
	description: string;
	/** What the action answers to until the user says otherwise. */
	defaults: KeyCombo[];
}

/** The table with its literal types widened, so one `map` reads every row. */
const ROWS: ReadonlyArray<{
	action: ShortcutAction;
	name: string;
	description: string;
	defaults: readonly string[];
}> = TABLE;

export const SHORTCUTS: ReadonlyArray<Shortcut> = ROWS.map((entry) => ({
	action: entry.action,
	name: entry.name,
	description: entry.description,
	defaults: entry.defaults.map(mustParse),
}));

const BY_ACTION = new Map<ShortcutAction, Shortcut>(SHORTCUTS.map((s) => [s.action, s]));

export function shortcutFor(action: ShortcutAction): Shortcut {
	const entry = BY_ACTION.get(action);
	// Unreachable: the action type is the table's own action column.
	if (!entry) throw new Error(`No such shortcut: ${action}`);
	return entry;
}

/** What every action answers to right now. An empty array means unbound. */
export type ShortcutBindings = Record<ShortcutAction, KeyCombo[]>;

/** What `data.json` holds: only the actions the user has changed. */
export type StoredShortcuts = Partial<Record<ShortcutAction, string[]>>;

/**
 * The defaults with the user's overrides laid over them.
 *
 * A missing action means "default", an empty array means "unbound", and an
 * action the table no longer knows is dropped -- so a binding left behind by an
 * older version cannot resurrect a key nothing handles.
 */
export function resolveBindings(stored: StoredShortcuts | undefined): ShortcutBindings {
	const bindings = {} as ShortcutBindings;
	for (const entry of SHORTCUTS) {
		const raw = stored?.[entry.action];
		if (!Array.isArray(raw)) {
			bindings[entry.action] = entry.defaults.map((combo) => ({ ...combo }));
			continue;
		}
		const combos: KeyCombo[] = [];
		for (const text of raw) {
			const combo = typeof text === "string" ? parseCombo(text) : null;
			if (combo && !combos.some((seen) => sameCombo(seen, combo))) combos.push(combo);
		}
		bindings[entry.action] = combos;
	}
	return bindings;
}

/** Whether an action is still on the keys it shipped with. */
export function isDefaultBinding(action: ShortcutAction, combos: KeyCombo[]): boolean {
	const defaults = shortcutFor(action).defaults;
	if (combos.length !== defaults.length) return false;
	return defaults.every((combo, index) => sameCombo(combo, combos[index]));
}

/** The action a press performs, or null when the map does not answer to it. */
export function resolveAction(
	bindings: ShortcutBindings,
	combo: KeyCombo,
): ShortcutAction | null {
	for (const entry of SHORTCUTS) {
		if (bindings[entry.action].some((bound) => sameCombo(bound, combo))) return entry.action;
	}
	return null;
}

/** Every combo more than one action answers to, in table order. */
export function findConflicts(
	bindings: ShortcutBindings,
): Array<{ combo: KeyCombo; actions: ShortcutAction[] }> {
	const groups = new Map<string, { combo: KeyCombo; actions: ShortcutAction[] }>();
	for (const entry of SHORTCUTS) {
		for (const combo of bindings[entry.action]) {
			const spelling = serializeCombo(combo);
			const group = groups.get(spelling);
			if (group) {
				if (!group.actions.includes(entry.action)) group.actions.push(entry.action);
			} else {
				groups.set(spelling, { combo, actions: [entry.action] });
			}
		}
	}
	return [...groups.values()].filter((group) => group.actions.length > 1);
}
