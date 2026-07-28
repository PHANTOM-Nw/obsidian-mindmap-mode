# Changelog

Every released version gets a `## [x.y.z] - YYYY-MM-DD` section here, newest
first. The release workflow pastes that section into the GitHub release notes
verbatim, so write it for someone installing the plugin, not for someone reading
the diff. `npm run check-changelog` fails if the section for `manifest.json`'s
version is missing or empty.

Entries are bilingual: Chinese, then `<br>`, then English, both on one source
line. The `<br>` is deliberate — a plain newline renders as a line break in
release notes but collapses to a space when this file is viewed on GitHub, and
the entry has to read correctly in both.

## [1.0.2] - 2026-07-27

### 新增 / Added

- 从笔记内容中打开链接 —— 卡片里的链接，点开后的行为和在笔记里点开完全一致。<br>Open links from note content — a link inside a card resolves the same way it does in the note.
- 拖动卡片到同级节点之间，即可调整它们的先后顺序。<br>Reorder siblings by dragging a card onto its new place among them.
- 鼠标悬停在卡片上会出现添加按钮，可以直接从这张卡片长出新节点。<br>Grow the tree straight from a card, with the add button that appears on hover.

### 修复 / Fixed

- 发布 tag 现在被锁定为 manifest 里的版本号：写错或带 `v` 前缀的 tag 会让构建直接失败，而不是发出一个 Obsidian 装不上、却又不报错的版本。<br>The release tag is now pinned to the manifest version, so a mistyped or `v`-prefixed tag fails the build instead of producing a release that Obsidian silently refuses to install.

## [1.0.1] - 2026-07-27

### 新增 / Added

- 把内容块展开成一个渲染后的对话框。<br>Expand a content block into a rendered dialog.

## [1.0.0] - 2026-07-27

首个版本。<br>Initial release.

### 新增 / Added

- 在同一个标签页里把任意笔记切换成可编辑的思维导图。每一次修改都直接写回原来的 `.md` 文件 —— 不会生成任何新文件。<br>Toggle any note into an editable mind map in the same tab. Every edit writes straight back to the original `.md` file — no new files are ever created.
- 笔记正文会以卡片的形式，画在它所属的标题旁边。<br>Note content is drawn as cards alongside the headings it belongs to.
- 导图打开时默认折叠，只含正文的小节也跟着一起折叠。<br>Maps open folded, and sections holding only note content fold with them.
- 节点标题里的 LaTeX 通过 MathJax 渲染。<br>LaTeX in node titles renders through MathJax.
- 卡片宽度自适应文字，中日韩字符同样适用。<br>Cards size themselves horizontally to their text, CJK included.

### 修复 / Fixed

- 点了没有任何反应的折叠按钮。<br>Fold toggles that did nothing when clicked.
- 折叠、展开小节时导图会跳动。<br>The map jumping as sections folded and unfolded.
