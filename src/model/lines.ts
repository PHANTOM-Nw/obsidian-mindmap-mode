/**
 * Line storage that reconstructs the original text byte-for-byte.
 *
 * Every line keeps its own terminator, so a file with mixed or CRLF endings
 * survives a parse/serialize round trip untouched. This is the foundation of
 * the plugin's promise: lines nobody edited come back out exactly as they
 * went in.
 */
export interface LineDoc {
	/** Line contents, terminators excluded. */
	lines: string[];
	/** Terminator for each line. Only the final entry may be empty. */
	eols: string[];
	/** Dominant terminator, used for lines we insert ourselves. */
	eol: string;
}

export function fromText(text: string): LineDoc {
	const lines: string[] = [];
	const eols: string[] = [];
	let i = 0;

	for (;;) {
		let j = i;
		while (j < text.length && text[j] !== "\n" && text[j] !== "\r") j++;
		lines.push(text.slice(i, j));

		if (j >= text.length) {
			eols.push("");
			break;
		}
		if (text[j] === "\r" && text[j + 1] === "\n") {
			eols.push("\r\n");
			i = j + 2;
		} else {
			eols.push(text[j]);
			i = j + 1;
		}
		// Text ended with a terminator: no phantom trailing line.
		if (i >= text.length) break;
	}

	return { lines, eols, eol: dominantEol(eols) };
}

function dominantEol(eols: string[]): string {
	let crlf = 0;
	let lf = 0;
	for (const e of eols) {
		if (e === "\r\n") crlf++;
		else if (e === "\n") lf++;
	}
	return crlf > lf ? "\r\n" : "\n";
}

export function toText(doc: LineDoc): string {
	let out = "";
	for (let i = 0; i < doc.lines.length; i++) out += doc.lines[i] + doc.eols[i];
	return out;
}

/**
 * Replace `deleteCount` lines at `start` with `insert`.
 *
 * Returns a new LineDoc; the input is never mutated, which is what lets the
 * undo stack hold cheap snapshots.
 */
export function spliceLines(
	doc: LineDoc,
	start: number,
	deleteCount: number,
	insert: string[] = [],
): LineDoc {
	const lines = doc.lines.slice();
	const eols = doc.eols.slice();

	lines.splice(start, deleteCount, ...insert);
	eols.splice(start, deleteCount, ...insert.map(() => doc.eol));

	// Only the last line may lack a terminator; otherwise a join would weld two
	// lines together. This fixes up the case where we appended past the old end.
	for (let i = 0; i < eols.length - 1; i++) {
		if (eols[i] === "") eols[i] = doc.eol;
	}
	if (lines.length === 0) {
		lines.push("");
		eols.push("");
	}

	return { lines, eols, eol: doc.eol };
}

/** Replace a single line's content, leaving its terminator alone. */
export function replaceLine(doc: LineDoc, index: number, content: string): LineDoc {
	const lines = doc.lines.slice();
	lines[index] = content;
	return { lines, eols: doc.eols.slice(), eol: doc.eol };
}

export function isBlank(line: string): boolean {
	return line.trim().length === 0;
}
