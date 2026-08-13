import type { Canvas } from "./canvas.ts";

export type Direction = "up" | "down" | "left" | "right";

/**
 * Where a dragged node lands relative to the card it was dropped on: inside it
 * as a child, or beside it as a sibling above or below.
 */
export type DropMode = "child" | "before" | "after";

/** Everything the interaction layer needs from the view. */
export interface MapController {
	canvas: Canvas;
	isEditing(): boolean;
	selectedId(): string | null;
	select(id: string | null): void;
	beginEdit(id: string): void;

	addChildTo(id: string): void;
	addSiblingTo(id: string): void;
	removeNode(id: string): void;
	indent(id: string): void;
	outdent(id: string): void;
	toggleFold(id: string): void;
	toggleCheck(id: string): void;
	/** Open a note-content block whole, rendered, in its own dialog. */
	expandBody(id: string): void;
	/** Follow a link written in a note-content card. */
	openLink(href: string, ev: MouseEvent): void;
	/** The node's own menu, at the pointer. */
	showMenu(id: string, ev: MouseEvent): void;
	navigate(direction: Direction): void;

	openSearch(): void;
	/** False when there was no search bar to close, so Escape stays free. */
	closeSearch(): boolean;

	canDrop(id: string, targetId: string, mode: DropMode): boolean;
	move(id: string, targetId: string, mode: DropMode): void;

	undo(): void;
	redo(): void;
	fit(): void;
	centreOnSelection(): void;
}

const DRAG_THRESHOLD = 5;

function nodeIdFrom(target: EventTarget | null): string | null {
	if (!(target instanceof HTMLElement)) return null;
	const el = target.closest<HTMLElement>(".mm-node");
	return el?.dataset.id ?? null;
}

export function attachInteractions(controller: MapController): () => void {
	const { canvas } = controller;
	const viewport = canvas.viewport;
	const cleanups: Array<() => void> = [];

	const on = <K extends keyof HTMLElementEventMap>(
		el: HTMLElement,
		type: K,
		handler: (ev: HTMLElementEventMap[K]) => void,
		options?: AddEventListenerOptions,
	): void => {
		el.addEventListener(type, handler as EventListener, options);
		cleanups.push(() => el.removeEventListener(type, handler as EventListener));
	};

	// A completed drag re-renders the map, so the click that follows pointerup
	// would resolve a stale element to whatever now holds that id.
	let suppressClick = false;

	// --- clicking ------------------------------------------------------------
	on(viewport, "click", (ev) => {
		if (suppressClick) {
			suppressClick = false;
			ev.stopPropagation();
			return;
		}
		const target = ev.target as HTMLElement;

		// Links, but only in note content: a title is something you select and
		// drag, and a link filling one would leave no way to grab the node.
		const link = target.closest<HTMLElement>(".mm-link[data-href], .mm-embed[data-href]");
		if (link?.closest('.mm-node[data-kind="body"]')) {
			const href = link.dataset.href;
			if (href) controller.openLink(href, ev);
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}

		// Ahead of the fallback below: the expand button sits inside the card,
		// so letting the click through would also drop the selection.
		const expand = target.closest<HTMLElement>(".mm-expand");
		if (expand) {
			const id = nodeIdFrom(expand);
			if (id) controller.expandBody(id);
			ev.stopPropagation();
			return;
		}
		const add = target.closest<HTMLElement>(".mm-add");
		if (add) {
			const id = nodeIdFrom(add);
			if (id) controller.addChildTo(id);
			ev.stopPropagation();
			return;
		}
		const toggle = target.closest<HTMLElement>(".mm-toggle");
		if (toggle) {
			const id = nodeIdFrom(toggle);
			if (id) controller.toggleFold(id);
			ev.stopPropagation();
			return;
		}
		const checkbox = target.closest<HTMLElement>(".mm-checkbox");
		if (checkbox) {
			const id = nodeIdFrom(checkbox);
			if (id) controller.toggleCheck(id);
			ev.stopPropagation();
			return;
		}
		const id = nodeIdFrom(target);
		controller.select(id);
		if (!controller.isEditing()) viewport.focus({ preventScroll: true });
	});

	on(viewport, "dblclick", (ev) => {
		const target = ev.target as HTMLElement;
		if (target.closest(".mm-expand")) return;
		const id = nodeIdFrom(target);
		if (!id) return;
		ev.preventDefault();
		controller.beginEdit(id);
	});

	// --- dragging to reparent or reorder ---------------------------------------
	let dragId: string | null = null;
	let dragPointer = -1;
	let origin = { x: 0, y: 0 };
	let dragging = false;
	let hovered: HTMLElement | null = null;
	let hoveredMode: DropMode = "child";

	const DROP_CLASSES = [
		"is-drop-target",
		"is-drop-before",
		"is-drop-after",
		"is-drop-invalid",
	];

	const clearHover = (): void => {
		hovered?.removeClasses(DROP_CLASSES);
		hovered = null;
	};

	/**
	 * Which third of the card the pointer is over.
	 *
	 * A rect is the right tool here -- this is hit-testing in screen space, where
	 * the pointer already lives, not measuring a card for layout.
	 */
	const zoneOf = (el: HTMLElement, clientY: number): DropMode => {
		const rect = el.getBoundingClientRect();
		const edge = Math.min(rect.height * 0.3, 14);
		if (clientY < rect.top + edge) return "before";
		if (clientY > rect.bottom - edge) return "after";
		return "child";
	};

	/**
	 * The zone under the pointer, falling back to "child" where reordering is
	 * refused. That fallback is what keeps a first-level card behaving exactly as
	 * it always has over its whole surface, rather than growing a silent dead
	 * band along each edge.
	 */
	const dropModeFor = (
		id: string,
		targetId: string,
		el: HTMLElement,
		clientY: number,
	): DropMode => {
		const zone = zoneOf(el, clientY);
		if (zone !== "child" && !controller.canDrop(id, targetId, zone)) return "child";
		return zone;
	};

	const endDrag = (): void => {
		if (dragId) {
			viewport
				.querySelector<HTMLElement>(`.mm-node[data-id="${CSS.escape(dragId)}"]`)
				?.removeClass("is-dragging");
		}
		viewport.removeClass("is-dragging-node");
		clearHover();
		dragId = null;
		dragPointer = -1;
		dragging = false;
	};

	on(viewport, "pointerdown", (ev) => {
		if (ev.button !== 0 || controller.isEditing()) return;
		const target = ev.target as HTMLElement;
		if (target.closest(".mm-tools, .mm-checkbox")) return;
		const card = target.closest<HTMLElement>(".mm-card");
		// A body card stands for lines the note owns, not a node that can be
		// reparented, so it never starts a drag.
		if (!card || card.closest('.mm-node[data-kind="body"]')) return;
		const id = nodeIdFrom(card);
		if (!id) return;

		dragId = id;
		dragPointer = ev.pointerId;
		origin = { x: ev.clientX, y: ev.clientY };
		dragging = false;
	});

	on(viewport, "pointermove", (ev) => {
		if (dragId === null || ev.pointerId !== dragPointer) return;

		if (!dragging) {
			const moved = Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y);
			if (moved < DRAG_THRESHOLD) return;
			dragging = true;
			viewport.addClass("is-dragging-node");
			viewport
				.querySelector<HTMLElement>(`.mm-node[data-id="${CSS.escape(dragId)}"]`)
				?.addClass("is-dragging");
			viewport.setPointerCapture(ev.pointerId);
		}

		// Pointer capture makes ev.target useless, so hit-test by coordinates.
		const under = document.elementFromPoint(ev.clientX, ev.clientY);
		const targetEl =
			under instanceof HTMLElement ? under.closest<HTMLElement>(".mm-node") : null;

		const targetId = targetEl?.dataset.id;
		const mode =
			targetEl && targetId && targetId !== dragId
				? dropModeFor(dragId, targetId, targetEl, ev.clientY)
				: "child";
		// The zone can change without the card changing, and the highlight has to
		// follow the pointer across that boundary.
		if (targetEl === hovered && mode === hoveredMode) return;
		clearHover();
		if (!targetEl || !targetId || targetId === dragId) return;

		hovered = targetEl;
		hoveredMode = mode;
		if (!controller.canDrop(dragId, targetId, mode)) targetEl.addClass("is-drop-invalid");
		else if (mode === "child") targetEl.addClass("is-drop-target");
		else targetEl.addClass(mode === "before" ? "is-drop-before" : "is-drop-after");
	});

	const finishDrag = (ev: PointerEvent): void => {
		if (dragId === null || ev.pointerId !== dragPointer) return;
		if (dragging) {
			suppressClick = true;
			const under = document.elementFromPoint(ev.clientX, ev.clientY);
			const targetEl =
				under instanceof HTMLElement ? under.closest<HTMLElement>(".mm-node") : null;
			const targetId = targetEl?.dataset.id;
			if (targetEl && targetId && targetId !== dragId) {
				const mode = dropModeFor(dragId, targetId, targetEl, ev.clientY);
				if (controller.canDrop(dragId, targetId, mode)) {
					const source = dragId;
					endDrag();
					controller.move(source, targetId, mode);
					return;
				}
			}
		}
		endDrag();
	};
	on(viewport, "pointerup", finishDrag);
	on(viewport, "pointercancel", () => endDrag());

	// --- the node menu ---------------------------------------------------------
	on(viewport, "contextmenu", (ev) => {
		// A node being edited is a text field, and it keeps the platform's own
		// menu -- cut, copy, paste, spelling.
		if (controller.isEditing()) return;
		const id = nodeIdFrom(ev.target);
		// Blank canvas keeps the platform menu too; a card gets the map's own.
		if (!id) return;
		ev.preventDefault();
		endDrag();
		controller.showMenu(id, ev);
	});

	// --- keyboard -------------------------------------------------------------
	on(viewport, "keydown", (ev) => {
		if (controller.isEditing()) return;

		const mod = ev.ctrlKey || ev.metaKey;
		const id = controller.selectedId();

		if (mod && ev.key.toLowerCase() === "z") {
			ev.preventDefault();
			if (ev.shiftKey) controller.redo();
			else controller.undo();
			return;
		}
		if (mod && (ev.key === "y" || ev.key === "Y")) {
			ev.preventDefault();
			controller.redo();
			return;
		}
		if (mod && ev.key === "0") {
			ev.preventDefault();
			controller.fit();
			return;
		}
		if (mod && (ev.key === "=" || ev.key === "+")) {
			ev.preventDefault();
			canvas.zoomBy(1.2);
			return;
		}
		if (mod && ev.key === "-") {
			ev.preventDefault();
			canvas.zoomBy(1 / 1.2);
			return;
		}
		if (mod && ev.key === ".") {
			ev.preventDefault();
			controller.centreOnSelection();
			return;
		}
		// Obsidian's own Ctrl+F belongs to the markdown editor, which this view
		// replaced. Taken here rather than as a plugin hotkey so it is only ever
		// claimed while a map has the keyboard.
		if (mod && ev.key.toLowerCase() === "f") {
			ev.preventDefault();
			controller.openSearch();
			return;
		}
		if (mod && ev.key === "Enter") {
			if (!id) return;
			ev.preventDefault();
			controller.toggleCheck(id);
			return;
		}

		switch (ev.key) {
			case "ArrowUp":
			case "ArrowDown":
			case "ArrowLeft":
			case "ArrowRight": {
				ev.preventDefault();
				const map: Record<string, Direction> = {
					ArrowUp: "up",
					ArrowDown: "down",
					ArrowLeft: "left",
					ArrowRight: "right",
				};
				controller.navigate(map[ev.key]);
				return;
			}
			case "Tab":
				if (!id) return;
				ev.preventDefault();
				if (ev.shiftKey) controller.outdent(id);
				else controller.addChildTo(id);
				return;
			case "Enter":
				if (!id) return;
				ev.preventDefault();
				if (ev.shiftKey) controller.beginEdit(id);
				else controller.addSiblingTo(id);
				return;
			case "F2":
				if (!id) return;
				ev.preventDefault();
				controller.beginEdit(id);
				return;
			case "Delete":
			case "Backspace":
				if (!id) return;
				ev.preventDefault();
				controller.removeNode(id);
				return;
			case " ":
				if (!id) return;
				ev.preventDefault();
				controller.toggleFold(id);
				return;
			case "]":
				if (!id) return;
				ev.preventDefault();
				controller.indent(id);
				return;
			case "Escape":
				// Only ours while a search is open; otherwise Escape keeps
				// whatever meaning Obsidian gives it.
				if (!controller.closeSearch()) return;
				ev.preventDefault();
				return;
			default:
				return;
		}
	});

	return () => {
		for (const off of cleanups) off();
		cleanups.length = 0;
	};
}
