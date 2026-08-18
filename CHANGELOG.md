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

## [1.0.8] - 2026-08-13

### 新增 / Added

- 导图现在自带查找：按 `Ctrl`/`Cmd`+`F` 打开查找条，输入即搜，计数显示第几个/共几个，`Enter` / `Shift`+`Enter` 在命中之间来回跳，`Esc` 关闭。工具栏多了一个查找按钮，命令面板里也有 *Find in the mind map*，想自定义快捷键就绑它。<br>The map can now find things: `Ctrl`/`Cmd`+`F` opens a find bar that searches as you type, counts which match you are on, steps with `Enter` / `Shift`+`Enter` and closes with `Esc`. There is a find button on the toolbar too, and a *Find in the mind map* command for binding your own hotkey.
- 匹配的是卡片上看到的文字，不是原始 Markdown：`**bold** text` 能被"bold text"搜到，`[[note|Label]]` 只按"Label"命中，公式按它的 TeX 源码命中。`.*` 按钮切换成正则；两种方式都不区分大小写。<br>Matching follows the text you see on the card, not the raw markdown: `**bold** text` is found by "bold text", `[[note|Label]]` by "Label" alone, and a formula by its TeX source. The `.*` toggle switches to a regular expression; both modes are case-insensitive.
- 跳到折叠分支里的命中会自动把它展开；走到下一个命中时，上一处为搜索展开的分支随即折回，关闭查找条时其余的也一并折回 —— 只留下你最后停在的那个命中所在的路径，那张卡片依然选中可见。你自己手动展开的分支始终不动。<br>Stepping to a match inside a folded branch opens it on the way, and stepping onwards folds that branch back again; closing the bar folds back the rest and keeps only the path to the match you stopped on, with that card still selected. Anything you opened yourself is left alone.

### 变更 / Changed

- 最低支持的 Obsidian 版本从 1.5.0 提高到 1.5.7：查找条的 `Ctrl`/`Cmd`+`F` 依赖 1.5.7 才有的视图级快捷键作用域，这样只要导图标签页是活动的它就能响应，而不必先点一下卡片。<br>The minimum Obsidian version rises from 1.5.0 to 1.5.7: the find bar's `Ctrl`/`Cmd`+`F` relies on the per-view hotkey scope introduced there, which is what lets it answer whenever the map's tab is active rather than only after a card has been clicked.

## [1.0.6] - 2026-08-09

### 新增 / Added

- 导图现在会记住你把它折成了什么样。再打开同一篇笔记，折叠的分支还是折着的，镜头也落在你上次正在看的那张卡片上。这份状态存在插件自己的数据里，笔记一个字都不会改 —— 不产生 diff，也不会有合并冲突。<br>The map now remembers how you folded it. Reopen a note and the branches you collapsed are still collapsed, framed on the card you were last working on. That state lives in the plugin's own data, not in the note — your markdown is untouched, so there is nothing to diff and nothing to merge.
- 设置 → 行为里多了**记住折叠状态**开关，默认打开。关掉它，每张导图都会像以前一样打开成"根 + 一级分支"。<br>A **Remember fold state** toggle in Settings → Behaviour, on by default. Turn it off and every map opens at the root plus its top-level branches, exactly as before.
- 新命令 *Forget the saved fold state for this note*，用来只清掉当前这篇笔记记住的状态，不必去动设置。<br>A new command, *Forget the saved fold state for this note*, drops what is remembered about the note you are looking at without touching the setting.
- 笔记改名、移动，或者整个文件夹被搬走时，记住的状态会跟着一起走；笔记被删除时状态一并清掉。<br>Renaming or moving a note — or moving the whole folder it sits in — carries its remembered state along, and deleting a note clears it.

## [1.0.5] - 2026-07-28

### 修复 / Fixed

- 移除了一处对 Obsidian 1.13 才有的接口的调用。实际执行路径从未走到它，所以没有人遇到过问题，但插件不该引用高于自己 `minAppVersion` 的 API。设置页在新旧版本上的行为都不变。<br>Removed a call into an API that only exists in Obsidian 1.13. Nothing ever reached it, so nobody hit a problem, but a plugin should not reference an API newer than its own `minAppVersion`. The settings tab behaves the same on every version.

## [1.0.4] - 2026-07-28

### 新增 / Added

- 设置项现在会出现在 Obsidian 1.13 及以上版本的设置搜索结果里。1.13 以下的版本设置页照旧，不受影响。<br>Settings now turn up in the settings search on Obsidian 1.13 and later. On older versions the settings tab is unchanged.

### 变更 / Changed

- 发布资产现在都带 GitHub 构建来源证明，任何人都可以验证它们确实由本仓库构建，而不是从谁的电脑上传的。手动安装用的 `mindmap-mode.zip` 保持不变。<br>Release assets now carry GitHub build provenance, so anyone can verify they were built from this repository rather than uploaded off somebody's laptop. The `mindmap-mode.zip` for installing by hand is still there.

## [1.0.3] - 2026-07-28

### 变更 / Changed

- 插件简介改写为纯 ASCII 文本，以满足官方插件市场对描述的要求。功能没有任何变化。<br>Reworded the plugin description to plain ASCII, which the community plugin directory requires. Nothing about how the plugin behaves has changed.

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
