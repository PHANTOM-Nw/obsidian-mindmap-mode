# Search Fixture

A scratch note for the find bar, `Ctrl`/`Cmd`+`F`. Every query worth trying is
written out beside the card it is supposed to hit; the prose paragraphs are
there to prove they are *not* searched.

## What a query sees

Five cards, five queries, one each. "bold text" finds the first, because the
markers are not on the card. "Read the demo" finds the second and "Mindmap Demo"
finds nothing at all, because a wikilink is its label and not its target. "code
span" finds the third: the backticks are not part of it. "标题" finds the fourth,
and so does the regular expression `^第`. "\lambda" finds the fifth, because a
formula is searched as the TeX it was written as.

The annotations live in this paragraph rather than on the cards on purpose — a
counter-example spelled out beside a card would be found by the query it is
supposed to miss.

- **bold** text
- [[Mindmap Demo|Read the demo]]
- `code span`
- 第一章 标题
- 学习率 $\lambda$

Type `(` with the `.*` toggle on and the box goes red at 0/0 — a half-typed
pattern is the normal case, not an error.

## Three siblings to step through

"focus" hits exactly these three. The counter should read 1/3, `Enter` should
walk them in file order and `Shift`+`Enter` back, wrapping round both ways.

- first focus
- second focus
- third focus

## A branch that opens itself

Folded when the note opens, and so is every level inside it. Searching for
"buried" has to open four levels and pan the card into view.

Turn the `.*` toggle on and search `focus|buried` to watch a branch handed back:
stepping onto "buried target" opens the four levels, and stepping on to the next
match folds all four again, because a branch stays open only while the match
inside it is the one you are looking at. Stop on "buried target" and close the
bar and the path to it stays open instead, with the card still selected — only
the branches the search is no longer using go back.

Open `three` by hand while the bar is up and it stays open afterwards — only the
folds the search made are ever put back.

- one
	- two
		- three
			- buried target

## Note content is not searched

Paragraph, code and table cards are out of scope in this version: searching for
paragraphonly finds nothing at all, even though the word is sitting right here
in a body card.
