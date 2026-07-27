# Mindmap Mode

Turn any Obsidian note into an editable, XMind-style mind map — the same way you
switch to reading mode. Same tab, same file, **no new files ever created**.

Every edit you make on the map is written straight back into the original
`.md` note as a minimal line edit. Toggle back and your note is still your note.

## What it does

- **A view mode, not an export.** Toggling swaps the view type on the leaf you
  are already in, so the same `TFile` stays open in the same tab. Nothing is
  generated, copied, or written to a sidecar file.
- **Your outline is the map.** Headings nest by level; nested bullets hang under
  the heading they belong to. What you already wrote is the structure.
- **Edit on the canvas.** Rename, add, delete, indent, drag to reparent, fold,
  tick checkboxes — all of it rewrites the note in place.
- **Nothing else is touched.** Frontmatter, fenced code, tables, HTML and links
  are never reformatted. Lines you did not edit come back byte-for-byte
  identical, including CRLF endings.

## Switching to the map

Any of these work, on the note you already have open:

| Where | How |
| --- | --- |
| Command palette | **Toggle mind map view** (assign a hotkey to make it feel native) |
| Note header | The branch icon beside the other view actions |
| Ribbon | The branch icon in the left sidebar |
| Context menu | Right-click the note → **Open as mind map** |

Toggling back returns you to whichever markdown mode you came from — source or
reading.

## Editing on the map

| Input | Action |
| --- | --- |
| Double-click / `F2` | Edit the node text inline |
| `Enter` | New sibling |
| `Tab` | New child |
| `Shift`+`Tab` | Outdent |
| `]` | Indent under the previous sibling |
| `Delete` | Delete the node and its children |
| `Space` | Fold / unfold |
| Arrow keys | Move the selection |
| Drag a card onto another | Reparent it |
| `Ctrl`/`Cmd`+`Enter` | Cycle the checkbox: none → `[ ]` → `[x]` → none |
| `Ctrl`/`Cmd`+`Z` | Undo (`Shift` to redo) |
| `Ctrl`/`Cmd`+`0` | Fit the map to the window |
| Wheel / pinch | Zoom; drag blank space to pan |

Dragging across the heading/list boundary converts the moved block for you. Drop
a heading onto a bullet and the whole subtree becomes nested bullets; drop a
bullet onto a heading and it becomes a top-level list. Checkbox state survives
the round trip.

### Paragraphs, code blocks and tables

Content that is not a heading or a list item stays exactly where it is in the
note. The owning node shows a small `≡` badge; click it to read or edit those
lines in a popover. Editing there rewrites only those lines.

## Install

Not in the community plugin browser yet, so install manually:

```bash
npm install
npm run build
```

Then copy `main.js`, `manifest.json` and `styles.css` into your vault:

```bash
mkdir -p /path/to/vault/.obsidian/plugins/mindmap-mode
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/mindmap-mode/
```

Enable **Mindmap Mode** in *Settings → Community plugins*.

For development, symlink the repo instead so `npm run dev` rebuilds in place,
then use *Reload app without saving* (or the Hot-Reload plugin) to pick up changes:

```bash
ln -s "$PWD" /path/to/vault/.obsidian/plugins/mindmap-mode
npm run dev
```

A sample vault lives in `test-vault/` — open that folder as a vault and symlink
the plugin into `test-vault/.obsidian/plugins/` to try it without touching your
real notes.

## Settings

Node source (headings and lists / headings only / lists only), deepest heading
level, root node policy, indent unit for new list items, layout (balanced or
single-sided), branch colours, body badges, card width, spacing, wheel
behaviour, and whether to add the header button.

## How the round trip is kept safe

Every operation is a **line-range splice** on the original text. The map is a
projection: each node remembers the exact line it came from and the exact pieces
of that line (indent, marker, spacing, checkbox, text, trailing suffix), so it
can rebuild itself character-for-character. The file is never regenerated from
the tree.

That invariant is enforced by the test suite rather than assumed:

```bash
npm test
```

It checks, among other things, that a parse/serialize round trip is
byte-identical across frontmatter, CRLF, tilde and nested fences, ordered lists,
empty list items and closing-hash headings; that fenced code never produces
nodes; that **no operation ever touches frontmatter**; and that every legal
reparent across a rich fixture still round-trips with code content intact.

Layout is covered too — cards are asserted never to overlap in deep, uneven
trees, in both balanced and single-sided modes.

## Known limits

- **Setext headings** (`Title` underlined with `===` or `---`) are treated as
  body content, not nodes. They are preserved untouched; ATX (`#`) headings are
  what the map reads.
- The root node is the note's single top-level heading when it has one, and
  otherwise the file name. A file-name root cannot be renamed from the map,
  since that would mean renaming the file.
- Fold state lives in memory for the session. It is deliberately not written to
  the note, so the map never adds anything to your file.
- Moving a checkbox item into heading position keeps `[x]` as literal text
  (headings cannot hold checkboxes). Moving it back restores a real checkbox.

## Development

```
src/model/     parser + mutation engine — pure functions, no Obsidian imports
src/layout/    tidy-tree layout
src/view/      canvas, cards, connectors, interactions, the TextFileView
src/main.ts    plugin: view registration, the mode toggle, commands
```

`src/model` and `src/layout` have no DOM or Obsidian dependency, which is why
they can be unit-tested directly with `node --test` (Node 22.6+ strips the
TypeScript types natively — no build step, no test framework).

## License

MIT
