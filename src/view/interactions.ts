import type { Canvas } from "./canvas.ts";

export type Direction = "up" | "down" | "left" | "right";

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
	navigate(direction: Direction): void;

	canDrop(id: string, targetId: string): boolean;
	move(id: string, targetId: string): void;

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
		const id = nodeIdFrom(ev.target);
		if (!id) return;
		ev.preventDefault();
		controller.beginEdit(id);
	});

	// --- dragging to reparent -------------------------------------------------
	let dragId: string | null = null;
	let dragPointer = -1;
	let origin = { x: 0, y: 0 };
	let dragging = false;
	let hovered: HTMLElement | null = null;

	const clearHover = (): void => {
		hovered?.removeClasses(["is-drop-target", "is-drop-invalid"]);
		hovered = null;
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
		if (target.closest(".mm-toggle, .mm-checkbox")) return;
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

		if (targetEl === hovered) return;
		clearHover();
		if (!targetEl) return;

		const targetId = targetEl.dataset.id;
		if (!targetId || targetId === dragId) return;
		hovered = targetEl;
		targetEl.addClass(
			controller.canDrop(dragId, targetId) ? "is-drop-target" : "is-drop-invalid",
		);
	});

	const finishDrag = (ev: PointerEvent): void => {
		if (dragId === null || ev.pointerId !== dragPointer) return;
		if (dragging) {
			suppressClick = true;
			const under = document.elementFromPoint(ev.clientX, ev.clientY);
			const targetEl =
				under instanceof HTMLElement ? under.closest<HTMLElement>(".mm-node") : null;
			const targetId = targetEl?.dataset.id;
			if (targetId && controller.canDrop(dragId, targetId)) {
				const source = dragId;
				endDrag();
				controller.move(source, targetId);
				return;
			}
		}
		endDrag();
	};
	on(viewport, "pointerup", finishDrag);
	on(viewport, "pointercancel", () => endDrag());

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
			default:
				return;
		}
	});

	return () => {
		for (const off of cleanups) off();
		cleanups.length = 0;
	};
}
