import { test } from "node:test";
import assert from "node:assert/strict";

import {
	SHORTCUTS,
	comboFromEvent,
	comboToString,
	findConflicts,
	isDefaultBinding,
	isModifierOnly,
	parseCombo,
	recordKey,
	resolveAction,
	resolveBindings,
	sameCombo,
	serializeCombo,
	shortcutFor,
} from "./shortcuts.ts";
import type { KeyCombo, ShortcutAction, StoredShortcuts } from "./shortcuts.ts";

/** A keydown, with everything unpressed unless the test says otherwise. */
const press = (
	key: string,
	mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
) => ({
	key,
	ctrlKey: mods.ctrl === true,
	metaKey: mods.meta === true,
	shiftKey: mods.shift === true,
	altKey: mods.alt === true,
});

const combo = (key: string, mods: Partial<Omit<KeyCombo, "key">> = {}): KeyCombo => ({
	key,
	mod: mods.mod === true,
	shift: mods.shift === true,
	alt: mods.alt === true,
});

// --- normalising a press ------------------------------------------------------

test("a letter is recorded in one case, whichever case the event reports", () => {
	assert.deepEqual(comboFromEvent(press("Z", { ctrl: true })), combo("z", { mod: true }));
	assert.deepEqual(comboFromEvent(press("z", { ctrl: true })), combo("z", { mod: true }));
});

test("Shift survives on a letter, because the letter alone cannot carry it", () => {
	assert.deepEqual(
		comboFromEvent(press("Z", { ctrl: true, shift: true })),
		combo("z", { mod: true, shift: true }),
	);
});

test("Ctrl and Cmd are the same modifier", () => {
	assert.deepEqual(comboFromEvent(press("f", { ctrl: true })), comboFromEvent(press("f", { meta: true })));
});

test("the space bar is spelled out", () => {
	assert.deepEqual(comboFromEvent(press(" ")), combo("Space"));
});

test("Shift is dropped from a character that is already the shifted reading", () => {
	// Shift and `=` produce `+`; asking for Shift as well would be a press no
	// keyboard can make.
	assert.deepEqual(comboFromEvent(press("+", { ctrl: true, shift: true })), combo("+", { mod: true }));
	assert.deepEqual(comboFromEvent(press("+", { ctrl: true })), combo("+", { mod: true }));
});

test("Alt is kept as its own modifier", () => {
	assert.deepEqual(comboFromEvent(press("Enter", { alt: true })), combo("Enter", { alt: true }));
});

test("a modifier held on its own is not a combo yet", () => {
	for (const key of ["Shift", "Control", "Meta", "Alt"]) {
		assert.equal(isModifierOnly(comboFromEvent(press(key, { shift: true }))), true, key);
	}
	assert.equal(isModifierOnly(comboFromEvent(press("a"))), false);
});

// --- recording a shortcut ------------------------------------------------------

test("a modifier held on its own is ignored while recording", () => {
	for (const key of ["Shift", "Control", "Meta", "Alt", "Dead", "Process", "CapsLock"]) {
		assert.equal(recordKey(press(key)), "ignore", key);
	}
});

test("Escape cancels a recording instead of becoming its binding", () => {
	assert.equal(recordKey(press("Escape")), "cancel");
});

test("a plain letter becomes a combo", () => {
	assert.deepEqual(recordKey(press("a")), { combo: combo("a") });
});

test("a modified named key becomes a combo", () => {
	assert.deepEqual(
		recordKey(press("ArrowUp", { ctrl: true })),
		{ combo: combo("ArrowUp", { mod: true }) },
	);
});

// --- the stored form ----------------------------------------------------------

test("every combo survives the round trip through the stored form", () => {
	const cases: KeyCombo[] = [
		combo("Tab"),
		combo("Tab", { shift: true }),
		combo("ArrowUp", { mod: true }),
		combo("z", { mod: true, shift: true }),
		combo("Enter", { mod: true, alt: true, shift: true }),
		combo("]"),
		combo("+", { mod: true }),
		combo("Space"),
		combo("F2"),
	];
	for (const original of cases) {
		const text = serializeCombo(original);
		assert.deepEqual(parseCombo(text), original, text);
		assert.equal(serializeCombo(parseCombo(text) as KeyCombo), text);
	}
});

test("the stored form keeps a `+` key apart from the separator", () => {
	assert.equal(serializeCombo(combo("+", { mod: true })), "Mod++");
	assert.deepEqual(parseCombo("Mod++"), combo("+", { mod: true }));
});

test("a hand-written binding is read and normalised", () => {
	assert.deepEqual(parseCombo("Ctrl+Shift+Z"), combo("z", { mod: true, shift: true }));
	assert.deepEqual(parseCombo("Cmd+ArrowDown"), combo("ArrowDown", { mod: true }));
	assert.deepEqual(parseCombo("Shift++"), combo("+"));
});

test("nonsense is not a binding", () => {
	assert.equal(parseCombo(""), null);
	assert.equal(parseCombo("   "), null);
	assert.equal(parseCombo("Mod+"), null);
});

test("a combo reads differently on macOS", () => {
	assert.equal(comboToString(combo("ArrowUp", { mod: true }), false), "Ctrl + ↑");
	assert.equal(comboToString(combo("ArrowUp", { mod: true }), true), "⌘ ↑");
	assert.equal(comboToString(combo("z", { mod: true, shift: true }), false), "Ctrl + Shift + Z");
	assert.equal(comboToString(combo("Escape"), false), "Esc");
});

// --- resolving a press to an action -------------------------------------------

test("the defaults answer the keys the map has always answered", () => {
	const bindings = resolveBindings(undefined);
	const expected: Array<[ReturnType<typeof press>, ShortcutAction]> = [
		[press("Tab"), "add-child"],
		[press("Tab", { shift: true }), "outdent"],
		[press("Enter"), "add-sibling"],
		[press("Enter", { shift: true }), "edit-title"],
		[press("F2"), "edit-title"],
		[press("Enter", { ctrl: true }), "toggle-check"],
		[press("Delete"), "delete-node"],
		[press("Backspace"), "delete-node"],
		[press(" "), "toggle-fold"],
		[press("]"), "indent"],
		[press("ArrowUp"), "navigate-up"],
		[press("ArrowRight"), "navigate-right"],
		[press("ArrowUp", { ctrl: true }), "move-up"],
		[press("ArrowDown", { meta: true }), "move-down"],
		[press("f", { ctrl: true }), "search"],
		[press("Escape"), "close-search"],
		[press("z", { ctrl: true }), "undo"],
		[press("z", { ctrl: true, shift: true }), "redo"],
		[press("y", { ctrl: true }), "redo"],
		[press("0", { ctrl: true }), "fit"],
		[press("=", { ctrl: true }), "zoom-in"],
		[press("+", { ctrl: true, shift: true }), "zoom-in"],
		[press("-", { ctrl: true }), "zoom-out"],
		[press(".", { ctrl: true }), "centre-selection"],
	];
	for (const [event, action] of expected) {
		assert.equal(resolveAction(bindings, comboFromEvent(event)), action, JSON.stringify(event));
	}
});

test("a key nothing is bound to resolves to nothing", () => {
	const bindings = resolveBindings(undefined);
	assert.equal(resolveAction(bindings, comboFromEvent(press("q"))), null);
	// The modifiers are matched exactly, so a held Alt is a different press.
	assert.equal(resolveAction(bindings, comboFromEvent(press("Tab", { alt: true }))), null);
});

test("an override replaces the default rather than adding to it", () => {
	const stored: StoredShortcuts = { "toggle-fold": ["Mod+Space"] };
	const bindings = resolveBindings(stored);
	assert.equal(resolveAction(bindings, comboFromEvent(press(" ", { ctrl: true }))), "toggle-fold");
	assert.equal(resolveAction(bindings, comboFromEvent(press(" "))), null);
});

test("an empty override is what unbound looks like", () => {
	const bindings = resolveBindings({ "delete-node": [] });
	assert.deepEqual(bindings["delete-node"], []);
	assert.equal(resolveAction(bindings, comboFromEvent(press("Delete"))), null);
	// Everything else keeps its default.
	assert.equal(resolveAction(bindings, comboFromEvent(press("Tab"))), "add-child");
});

test("an action can answer to more than one key", () => {
	const bindings = resolveBindings({ "edit-title": ["F4", "Mod+e"] });
	assert.equal(resolveAction(bindings, comboFromEvent(press("F4"))), "edit-title");
	assert.equal(resolveAction(bindings, comboFromEvent(press("e", { meta: true }))), "edit-title");
	assert.equal(resolveAction(bindings, comboFromEvent(press("F2"))), null);
});

test("a stored binding the table no longer knows is dropped", () => {
	const bindings = resolveBindings({ "fold-everything": ["Mod+k"] } as StoredShortcuts);
	assert.equal(resolveAction(bindings, comboFromEvent(press("k", { ctrl: true }))), null);
	assert.equal(Object.keys(bindings).length, SHORTCUTS.length);
});

test("junk in data.json falls back to the defaults", () => {
	const bindings = resolveBindings({ "add-child": ["", "Mod+"] as string[] });
	assert.deepEqual(bindings["add-child"], []);
	const broken = resolveBindings({ "add-child": "Tab" } as unknown as StoredShortcuts);
	assert.equal(resolveAction(broken, comboFromEvent(press("Tab"))), "add-child");
});

test("a duplicated binding is stored once", () => {
	const bindings = resolveBindings({ indent: ["]", "]"] });
	assert.equal(bindings.indent.length, 1);
});

// --- conflicts ----------------------------------------------------------------

test("the defaults conflict with nothing", () => {
	assert.deepEqual(findConflicts(resolveBindings(undefined)), []);
});

test("two actions on one key are reported as a conflict", () => {
	const conflicts = findConflicts(resolveBindings({ indent: ["Tab"] }));
	assert.equal(conflicts.length, 1);
	assert.ok(sameCombo(conflicts[0].combo, combo("Tab")));
	assert.deepEqual(conflicts[0].actions, ["add-child", "indent"]);
});

test("the earlier action in the table answers a conflicted key", () => {
	const bindings = resolveBindings({ indent: ["Tab"] });
	assert.equal(resolveAction(bindings, comboFromEvent(press("Tab"))), "add-child");
});

// --- the table itself ---------------------------------------------------------

test("every action has an entry, and the entry is findable", () => {
	// The record is exhaustive at compile time, which is what makes an action
	// added to the union without a row in the table a typecheck failure.
	const covered: Record<ShortcutAction, true> = {
		"add-child": true,
		"add-sibling": true,
		"edit-title": true,
		"delete-node": true,
		"toggle-check": true,
		"expand-body": true,
		indent: true,
		outdent: true,
		"move-up": true,
		"move-down": true,
		"toggle-fold": true,
		"navigate-up": true,
		"navigate-down": true,
		"navigate-left": true,
		"navigate-right": true,
		search: true,
		"close-search": true,
		undo: true,
		redo: true,
		fit: true,
		"zoom-in": true,
		"zoom-out": true,
		"centre-selection": true,
	};
	const actions = Object.keys(covered) as ShortcutAction[];
	assert.equal(SHORTCUTS.length, actions.length);
	for (const action of actions) {
		assert.equal(shortcutFor(action).action, action);
		assert.ok(shortcutFor(action).name.length > 0);
		assert.ok(shortcutFor(action).description.length > 0);
	}
});

test("no two actions ship on the same key", () => {
	const seen = new Map<string, ShortcutAction>();
	for (const entry of SHORTCUTS) {
		for (const key of entry.defaults.map(serializeCombo)) {
			assert.equal(seen.get(key), undefined, `${key} is bound twice`);
			seen.set(key, entry.action);
		}
	}
});

test("a default is a combo a keyboard can actually produce", () => {
	for (const entry of SHORTCUTS) {
		for (const bound of entry.defaults) {
			assert.deepEqual(parseCombo(serializeCombo(bound)), bound);
			assert.equal(isModifierOnly(bound), false);
		}
	}
});

test("only a changed binding counts as changed", () => {
	assert.equal(isDefaultBinding("add-child", [combo("Tab")]), true);
	assert.equal(isDefaultBinding("add-child", [combo("Tab"), combo("F3")]), false);
	assert.equal(isDefaultBinding("add-child", []), false);
	assert.equal(isDefaultBinding("expand-body", []), true);
	const bindings = resolveBindings(undefined);
	for (const entry of SHORTCUTS) {
		assert.equal(isDefaultBinding(entry.action, bindings[entry.action]), true, entry.action);
	}
});
