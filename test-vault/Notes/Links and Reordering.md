# Links and Reordering

A scratch note for the three things that only show up in a running app: links
inside note content, dragging a node to a new position among its siblings, and
the buttons that grow the tree.

## Links in note content

The paragraph below is a body card. Click any link on the card itself, or open
the card with ⤢ and click it there — both go to the same place, and a vault link
closes the dialog on its way so what it opened is actually visible.

Vault links: [[Mindmap Demo]], a heading inside it
[[Mindmap Demo#Goals]], an attachment [[Link Fixture.pdf]], and the markdown
spelling of the same thing [the fixture](Link%20Fixture.pdf).

Web links: [obsidian.md](https://obsidian.md) and a bare
https://example.com/one, which the map draws but does not linkify.

- Links in a *title* stay plain text: [[Mindmap Demo]] here is not clickable,
  because a title is something you select and drag

## Reordering

Every node below sits at the second level or deeper, so each of them can be
dragged onto a sibling's top or bottom edge to change its position. The cards on
the "Links in note content" / "Reordering" row cannot — those are first-level
branches, and the layout decides their order when it splits them left and right.

- Alpha
	- Alpha one
	- Alpha two
	- Alpha three
- Beta
	- Beta one
		- Beta one deep
	- Beta two
- Gamma

### Headings reorder too

Drop one of these onto the other's edge and it stays a heading, blank lines and
all.

#### First

Some content under the first heading.

#### Second

Some content under the second heading.

## Growing the tree

Hover any card: a **+** appears beside the fold toggle and adds a child.
Right-click a card for the rest — a sibling above or below, fold, rename,
delete. Content cards get their own two entries instead, since those lines
belong to the note.
