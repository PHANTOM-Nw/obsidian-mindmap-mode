export interface CanvasOptions {
	wheel: "zoom" | "pan";
	/** Return true to let a pointerdown start a pan. */
	canPan: (target: HTMLElement) => boolean;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 3;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * The pan/zoom viewport.
 *
 * Everything is driven through Pointer Events so mouse, touch and pen all work
 * with one code path, including two-finger pinch on mobile.
 */
export class Canvas {
	readonly viewport: HTMLElement;
	readonly content: HTMLElement;

	scale = 1;
	tx = 0;
	ty = 0;

	private opts: CanvasOptions;
	private readonly pointers = new Map<number, { x: number; y: number }>();
	private panning = false;
	private last = { x: 0, y: 0 };
	private pinchDistance = 0;
	private readonly cleanups: Array<() => void> = [];

	constructor(parent: HTMLElement, opts: CanvasOptions) {
		this.opts = opts;
		this.viewport = parent.createDiv({ cls: "mm-viewport" });
		this.content = this.viewport.createDiv({ cls: "mm-content" });
		this.bind();
	}

	setOptions(opts: Partial<CanvasOptions>): void {
		this.opts = { ...this.opts, ...opts };
	}

	private on<K extends keyof HTMLElementEventMap>(
		el: HTMLElement,
		type: K,
		handler: (ev: HTMLElementEventMap[K]) => void,
		options?: AddEventListenerOptions,
	): void {
		el.addEventListener(type, handler as EventListener, options);
		this.cleanups.push(() => el.removeEventListener(type, handler as EventListener));
	}

	private bind(): void {
		this.on(
			this.viewport,
			"wheel",
			(ev) => {
				const wantsZoom =
					this.opts.wheel === "zoom" ? !ev.shiftKey : ev.ctrlKey || ev.metaKey;
				ev.preventDefault();
				if (wantsZoom) {
					this.zoomAt(ev.clientX, ev.clientY, Math.pow(0.999, ev.deltaY));
				} else {
					this.tx -= ev.deltaX;
					this.ty -= ev.deltaY;
					this.apply();
				}
			},
			{ passive: false },
		);

		this.on(this.viewport, "pointerdown", (ev) => {
			this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

			if (this.pointers.size === 2) {
				this.panning = false;
				this.pinchDistance = this.spread();
				return;
			}
			const target = ev.target as HTMLElement;
			const middleClick = ev.button === 1;
			if (!middleClick && !this.opts.canPan(target)) return;

			this.panning = true;
			this.last = { x: ev.clientX, y: ev.clientY };
			this.viewport.addClass("is-panning");
			this.viewport.setPointerCapture(ev.pointerId);
		});

		this.on(this.viewport, "pointermove", (ev) => {
			if (!this.pointers.has(ev.pointerId)) return;
			this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

			if (this.pointers.size === 2) {
				const distance = this.spread();
				if (this.pinchDistance > 0 && distance > 0) {
					const centre = this.centroid();
					this.zoomAt(centre.x, centre.y, distance / this.pinchDistance);
				}
				this.pinchDistance = distance;
				return;
			}
			if (!this.panning) return;
			this.tx += ev.clientX - this.last.x;
			this.ty += ev.clientY - this.last.y;
			this.last = { x: ev.clientX, y: ev.clientY };
			this.apply();
		});

		const release = (ev: PointerEvent): void => {
			this.pointers.delete(ev.pointerId);
			if (this.pointers.size < 2) this.pinchDistance = 0;
			if (this.panning && this.pointers.size === 0) {
				this.panning = false;
				this.viewport.removeClass("is-panning");
			}
		};
		this.on(this.viewport, "pointerup", release);
		this.on(this.viewport, "pointercancel", release);
		this.on(this.viewport, "pointerleave", release);
	}

	private spread(): number {
		const [a, b] = [...this.pointers.values()];
		if (!a || !b) return 0;
		return Math.hypot(a.x - b.x, a.y - b.y);
	}

	private centroid(): { x: number; y: number } {
		const list = [...this.pointers.values()];
		const sum = list.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), {
			x: 0,
			y: 0,
		});
		return { x: sum.x / list.length, y: sum.y / list.length };
	}

	zoomAt(clientX: number, clientY: number, factor: number): void {
		const rect = this.viewport.getBoundingClientRect();
		const px = clientX - rect.left;
		const py = clientY - rect.top;
		const next = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
		const k = next / this.scale;
		this.tx = px - (px - this.tx) * k;
		this.ty = py - (py - this.ty) * k;
		this.scale = next;
		this.apply();
	}

	zoomBy(factor: number): void {
		const rect = this.viewport.getBoundingClientRect();
		this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
	}

	apply(): void {
		this.content.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
	}

	/** Scale and centre so the whole map is visible. */
	fit(width: number, height: number): void {
		const rect = this.viewport.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0 || width === 0 || height === 0) return;
		const scale = clamp(
			Math.min(rect.width / width, rect.height / height, 1),
			MIN_SCALE,
			MAX_SCALE,
		);
		this.scale = scale;
		this.tx = (rect.width - width * scale) / 2;
		this.ty = (rect.height - height * scale) / 2;
		this.apply();
	}

	/** Put a point of the content at the centre of the viewport. */
	centreOn(x: number, y: number): void {
		const rect = this.viewport.getBoundingClientRect();
		if (rect.width === 0) return;
		this.tx = rect.width / 2 - x * this.scale;
		this.ty = rect.height / 2 - y * this.scale;
		this.apply();
	}

	/** Pan the smallest amount that brings a content rect fully into view. */
	reveal(x: number, y: number, width: number, height: number, margin = 40): void {
		const rect = this.viewport.getBoundingClientRect();
		if (rect.width === 0) return;
		const left = x * this.scale + this.tx;
		const top = y * this.scale + this.ty;
		const right = left + width * this.scale;
		const bottom = top + height * this.scale;

		if (left < margin) this.tx += margin - left;
		else if (right > rect.width - margin) this.tx -= right - (rect.width - margin);

		if (top < margin) this.ty += margin - top;
		else if (bottom > rect.height - margin) this.ty -= bottom - (rect.height - margin);

		this.apply();
	}

	destroy(): void {
		for (const off of this.cleanups) off();
		this.cleanups.length = 0;
		this.pointers.clear();
	}
}
