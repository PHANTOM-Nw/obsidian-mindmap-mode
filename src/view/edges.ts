import type { LayoutNode } from "../layout/tidyTree.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

function anchorFor(n: LayoutNode, outgoing: boolean, side: number): [number, number] {
	const y = n.y + n.height / 2;
	// Outgoing edges leave the face pointing at the children; incoming edges
	// arrive on the opposite face.
	const rightFace = outgoing ? side === 1 : side !== 1;
	return [rightFace ? n.x + n.width : n.x, y];
}

function strokeWidth(depth: number): number {
	if (depth <= 1) return 3;
	if (depth === 2) return 2;
	return 1.4;
}

/**
 * Draw the connector layer.
 *
 * The organic S-curve is what reads as "mind map" rather than "org chart":
 * a cubic bezier whose control points sit halfway between the two anchors.
 */
export function renderEdges(
	svg: SVGSVGElement,
	nodes: LayoutNode[],
	width: number,
	height: number,
	branchColors: boolean,
): void {
	while (svg.firstChild) svg.removeChild(svg.firstChild);
	svg.setAttribute("width", String(width));
	svg.setAttribute("height", String(height));
	svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

	for (const child of nodes) {
		const parent = child.parent;
		if (!parent) continue;

		const [px, py] = anchorFor(parent, true, child.side);
		const [cx, cy] = anchorFor(child, false, child.side);
		const dx = (cx - px) * 0.5;

		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute(
			"d",
			`M ${px} ${py} C ${px + dx} ${py}, ${cx - dx} ${cy}, ${cx} ${cy}`,
		);
		path.setAttribute("fill", "none");
		path.setAttribute("stroke-width", String(strokeWidth(child.depth)));
		path.setAttribute("stroke-linecap", "round");
		path.addClass("mm-edge");
		if (branchColors && child.branch >= 0) {
			path.dataset.branch = String(child.branch % 10);
		}
		svg.appendChild(path);
	}
}

export function createEdgeLayer(parent: HTMLElement): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.addClass("mm-edges");
	parent.appendChild(svg);
	return svg;
}
