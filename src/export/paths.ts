/**
 * Where an export lands.
 *
 * Beside the note, same basename, new extension -- and never on top of
 * something that is already there. A taken path grows Obsidian's own duplicate
 * suffix (` 1`, ` 2`, ...) before the extension until one is free, so exporting
 * the same map twice leaves two files rather than one overwritten one.
 *
 * Pure on purpose: the caller decides what "exists" means, which is what makes
 * this testable without a vault.
 */

/** How many suffixes are tried before the caller is told to sort it out. */
const MAX_ATTEMPTS = 1000;

export function joinPath(dir: string, name: string): string {
	return dir === "" || dir === "/" ? name : `${dir}/${name}`;
}

/**
 * An `exists` predicate that reads a folder's own listing, case-insensitively.
 *
 * Vault paths are case-sensitive and most of the filesystems under them are
 * not. A folder holding `plan.svg` accepts no `Plan.svg`, so a lookup by exact
 * path says the name is free and the write then fails with "File already
 * exists". Comparing folded means the export lands on `Plan 1.svg` instead,
 * which is the answer the user wanted anyway.
 */
export function takenBy(names: Iterable<string>): (path: string) => boolean {
	const taken = new Set<string>();
	for (const name of names) taken.add(name.toLowerCase());
	return (path) => taken.has(path.slice(path.lastIndexOf("/") + 1).toLowerCase());
}

/**
 * The first free path for `<basename>.<ext>` in `dir`.
 *
 * `ext` carries no leading dot. The basename is used verbatim, dots and all:
 * `notes.v2` becomes `notes.v2.svg`, and its next free sibling is
 * `notes.v2 1.svg` -- the suffix goes before the extension this call adds, not
 * before one that happens to be part of the name.
 */
export function nextFreePath(
	exists: (path: string) => boolean,
	dir: string,
	basename: string,
	ext: string,
): string {
	const first = joinPath(dir, `${basename}.${ext}`);
	if (!exists(first)) return first;

	for (let n = 1; n <= MAX_ATTEMPTS; n++) {
		const candidate = joinPath(dir, `${basename} ${n}.${ext}`);
		if (!exists(candidate)) return candidate;
	}
	throw new Error(`No free path for ${first} after ${MAX_ATTEMPTS} tries.`);
}
