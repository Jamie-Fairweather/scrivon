# Manual click-through checklist

These are the things automated tests can't cover, so they need a person using the real app. Do them once in the installed Windows app (`bun run tauri build`, or `bun run tauri dev`). Checks that need a slow drive, Narrator or similar are listed at the end.

## Opening and saving files

- [ ] Open a folder and a `.md` file, type, wait for autosave, then close and reopen the app. The text is saved and the tab shows no unsaved dot.
- [ ] Turn autosave off and edit a file. Click the tab's X: you get Save / Don't Save / Cancel, and each does what it says. Close All and Close Others list every unsaved file in one dialog.
- [ ] Mark a file read-only in Windows Properties and edit it. You get one error notice with the Windows reason and Try Again, not one per pause. Clear the flag, click Try Again, and the notice and dot clear.
- [ ] With that read-only file edited, try File > Close Folder, Open Recent, the title bar X and Alt+F4. The dialog names the file and reason. Cancel keeps everything, Close Without Saving closes, and quick repeated clicks don't stack dialogs.
- [ ] Open a file in Scrivon and VS Code. Save in VS Code, then type in Scrivon with autosave on. No dialog pops up, only a lasting "Couldn't save" notice with Try Again.
- [ ] Click Try Again or press Ctrl+S in that case. "File changed on disk" appears with Don't Save focused. Enter, Space and Esc keep both versions; Overwrite and Reload both work.
- [ ] Save in VS Code and switch back to Scrivon within a few seconds. The tab already shows the new text, with no conflict. An unedited tab also updates after outside changes, or after the explorer's Refresh.
- [ ] Delete an open file in Windows Explorer, then type and save. You get "File deleted" with Don't Save / Save Again, and the file only comes back after Save Again.
- [ ] With autosave off, edit a file and end Scrivon in Task Manager. On relaunch you get "Unsaved changes from last time". Opening the folder shows your edits marked unsaved, and Ctrl+S saves them. After choosing Don't Save on a normal close, no such notice appears.
- [ ] Open a `.md` file over 5 MB. The "Large file" question appears. Cancel opens nothing, Open Read-Only gives a locked tab, and Edit Anyway makes it editable.
- [ ] Open an old ANSI file with accents. It shows correctly and is read-only with a bar saying why. Edit as UTF-8 makes it editable (also with the keyboard), and the bar goes.
- [ ] Empty or damage Scrivon's `workspace.json` in `%APPDATA%\io.github.jamie-fairweather.scrivon` and launch. The app starts, shows "Recent folders restored", and your recent folders and tabs return.

## Tabs and folders

- [ ] Choose File > Open Recent on the folder you already have open, after typing. The editor doesn't flash empty, tabs stay, and Ctrl+Z still undoes.
- [ ] On the welcome screen, click a big recent folder and then quickly a small one. The small one stays open, and the "Opening..." notice goes away.
- [ ] Click a recent folder that was deleted or moved. A notice offers Remove from Recent. Removing it and choosing it again with Open Folder still works.
- [ ] Open a drive root such as `D:\` as a folder. It opens, hides System Volume Information, and is named `D:\`. A folder you can't read shows as empty with a warning.

## File explorer

- [ ] Create `meeting-notes.md`: it opens holding `# Meeting notes`. A new `.mmd` opens with a small flowchart. New Diagram twice suggests `diagram 2.mmd`.
- [ ] Type a bad name (`my:flow.mmd`, `aux`, `con`, or `Diagram.mmd` when `diagram.mmd` exists). A readable red message explains it, Create is greyed out, and nothing is created.
- [ ] Create a file in Windows Explorer, then make the same name in Scrivon (or rename onto it, such as `FINAL.md` over `final.md`). You get an "already exists" notice and the file is untouched.
- [ ] Rename `notes.md` to `Notes.md`: it works and the tab name updates. Rename folders with open tabs and the tabs follow.
- [ ] Press F2 on `screenshot.png`: only `screenshot` is selected. Type `beach`, Enter. After renaming or deleting, the arrow keys still work.
- [ ] Right-click a folder with files in it and choose Delete. It disappears from disk and the explorer, and its tabs close.
- [ ] Add or delete a file in Windows Explorer. The list updates within a second or two, and the Refresh button (or palette Refresh) also works.
- [ ] Use the keyboard only: Tab into the tree, arrows, Home/End, Enter, F2, Delete and Shift+F10 for the row menu. Esc closes the menu and focus returns to the row.

## Code editor

- [ ] Scroll to line 300 and press Ctrl+E twice, then Ctrl+Z. The undo works and the view stays at line 300.
- [ ] Set Word wrap to Off and open a wide table: a sideways scrollbar appears. Set "At column" 40: long lines wrap there. Tab size 2 and 4 insert that many spaces.
- [ ] Hover the editor's right edge. The cursor becomes a resize cursor and dragging resizes the pane. Shift+Tab from the preview lights up the handle, and arrow keys resize it.
- [ ] Press Ctrl+Shift+F, search a word and pick a hit in another file. The file opens with the word selected and centred.

## Diagram canvas

- [ ] Zoom a diagram, switch tabs and back: the zoom is kept. Close and reopen it: it comes back fitted. Opening a broken diagram elsewhere doesn't change it.
- [ ] Break a diagram. It dims and a red banner shows a message you can select and copy without panning. Fix it and the banner goes. Select all, delete, and type `f`: the old diagram doesn't return.
- [ ] Replace the text with just `graph TD`. The canvas says "Nothing to draw yet" and Export is greyed out. Add a node and it draws.
- [ ] On a touchpad, two-finger scroll pans and pinch zooms. With a mouse, the wheel zooms and Shift+wheel pans. The app UI never zooms.
- [ ] Export Diagram as SVG in a light and a dark theme, and open it in a browser. Colours, text and arrows match, the background is solid, and no web fonts are needed.
- [ ] Export Diagram as PNG at 4× for a very wide diagram: you get a "Saved a smaller PNG" notice. A huge diagram at 1x says "Export failed" and suggests SVG.

## Markdown preview

- [ ] Click `[x](#some-heading)`, a footnote and its back link. The preview scrolls. A link to `docs/other.md#part` opens a tab at that heading, and a `https://` link opens in your browser. Nothing opens a page inside the app.
- [ ] Click `[Back to top](#top)` in a long README. It jumps to the top with no error. A link into `node_modules/x/README.md#usage` opens at that section.
- [ ] Open the Markdown showcase example. The web images show as dashed placeholders with a "Load images" notice. Clicking it loads them. Another document blocks them again.
- [ ] Open a `.md` with a `data:image` picture, as Markdown and as raw HTML. Both show in the preview and the PDF, and a logo with a set height shows at that height.
- [ ] Type in a long `.md` file (about 1,500 lines). Typing stays smooth, the preview catches up after you stop, and dragging the splitter is smooth.
- [ ] Press Tab to an Expand button and Enter: focus goes to Back, and Esc closes it and returns focus. Edit the diagram while it's open and the view follows. Deleting its block closes it.
- [ ] Create an empty `.md` file. A centred message shows and goes away when you type.

## PDF export

- [ ] Export a long document. The button spins, Esc and outside clicks do nothing, and a "Saved" notice shows the path. Show in folder opens Explorer with the file selected.
- [ ] Export over a PDF that's open in Acrobat. You get a clear "open in another program" error, the old file is unchanged, and no `.tmp.pdf` files are left behind.
- [ ] Export a 5+ page document with page numbers and a footer (text, colour, image), with and without a title page and contents. The footer bar and number are at the very bottom of every page, and the title page has none when hidden.
- [ ] Repeat with "Ignore margins" on and "Title page + TOC" hiding. Numbering starts on the first body page, and a long contents list shows the bar on every page.
- [ ] Open the PDF in a reader, select all and copy. No odd codes (such as SFPN) come out, and headings copy cleanly.
- [ ] Export a Cyrillic title with footer text such as `{{title}} · {{page}}/{{total}}`. It reads in proper letters, not question marks, with no overlap.
- [ ] Export a long code line, a long web address and a wide screenshot. Text stays normal size, nothing is cut off, and page numbers show.
- [ ] Export a table with centred and right-aligned columns, a checklist, a footnote and a hand-made contents list. They look right and the contents links jump to the headings.

## Word export

- [ ] Export the Markdown showcase and open it in desktop Word. No "unreadable content" or "fields that may refer to other files" prompt appears.
- [ ] Ctrl+click in-page links in Word, including a hand-made contents list and `[Back to top](#)`. They jump to the right place.
- [ ] Export with a table of contents. Press Ctrl+A then F9 in Word: the numbers update and clicking an entry jumps to the heading.
- [ ] Check long code snippets, small tables and headings don't split awkwardly, and a table header row is never alone at the bottom of a page.
- [ ] Use a coloured header with white text, a watermark, and a half-transparent colour. Text is readable, the watermark is complete and angled, and tints look right.
- [ ] Export Japanese, Korean, Chinese, Hebrew and Arabic files. Fonts are proper sans-serif, Hebrew and Arabic read right to left, and the language is right in Word.

## Settings, themes, shortcuts and menus

- [ ] Change font size, layout, editor width, a shortcut and a PDF profile, then quit and relaunch. All are kept, even if you close right after dragging a slider.
- [ ] With Settings open, drag the window, double-click the title bar and use minimise/maximise/close. They work, and File, Options, View and Help are dimmed. F1, Ctrl+B and Ctrl+Shift+O do nothing behind it.
- [ ] In Settings > Keyboard, record a shortcut already in use. A message offers Reassign and Cancel. Esc and Tab cancel recording, and Ctrl+D and Ctrl+S are refused. Rebound keys show in the View menu and tooltips.
- [ ] Click Reset all and Restore defaults. Each asks for confirmation above the dialog, and Cancel keeps your changes. Restore defaults keeps your export profiles.
- [ ] Try Nord, Dracula, Solarized Light, Catppuccin Latte and Tokyo Light. Text, editor colours, menus, scrollbars and the active tab underline all look right.
- [ ] Press F1 with text selected: the box is empty. Press Ctrl+Shift+F: the text is pre-filled. Ctrl+Shift+N shows "Go to file". Greyed commands say why.
- [ ] Search with Ctrl+Shift+F in a folder of 50+ files for a word only in the root README. It is found. A file deleted outside shows "1 file couldn't be read".
- [ ] Press Alt then F10: File gets focus. Esc returns to the editor. Choosing a menu item with the keyboard puts typing straight back in the editor.
- [ ] Open Help > About: the version is right, the GitHub link opens in your browser, and Copy version info works. In Licences, the filter finds `tauri` and long texts scroll.
- [ ] With an update available, click the menu-bar update icon. The toast goes as the dialog opens, and "What's new" lists every version since yours. Install with unsaved edits asks first.

## Window, titlebar and startup

- [ ] Launch with a light theme saved. There is no dark flash, and resizing edges are light.
- [ ] Right-click the empty title bar at 100%, 125% and 150% scaling. The window menu opens at the pointer, and Close with unsaved edits asks first.
- [ ] Open Scrivon a second time from the Start menu. No second window appears and the first comes to the front, even if minimised.
- [ ] Start from the taskbar pin, the Start menu and after an update. There is always one taskbar button.

## Accessibility (keyboard, screen reader, high contrast)

- [ ] Tab through the tab strip, title bar, Settings, explorer rows and welcome recent folders. Each focused item shows a clear ring that isn't cut off.
- [ ] Close a tab with Ctrl+W. Focus lands on the new active tab. Closing the last tab puts focus on "Toggle explorer". Clicking never steals focus from the editor.

## Needs special setup (optional)

- [ ] Slow or network drive: type with autosave on, then switch or close the folder. The last characters are in the file, and a big file from the old folder never shows in the new one.
- [ ] Kill Scrivon with unsaved edits, relaunch and click the file at once. The tab shows the recovered text, and typing early keeps a "(recovered)" copy.
- [ ] Windows High Contrast (Night sky, Desert): focus rings, menu highlights, switches, pressed toggles and the read-only bar all show.
- [ ] Narrator or NVDA: the editor, tabs, tree rows, toggles, palette, Settings, diagrams and dimmed buttons read with sensible names and states.
- [ ] Two monitors or different scaling: move and maximise the window. Layout and the resize handle still work.
- [ ] Release build, network off: editor, preview, diagrams, exports and licences all work with no blocked-feature errors.
- [ ] Update from an older install: one Scrivon in Apps, the Start menu opens the new one, and "Updated to version X" shows once.
- [ ] Clean Windows machine without WebView2: the installer adds it and Scrivon starts.
- [ ] Google Drive or another cloud drive: rename a file's letter case works, and renaming onto another file's name is refused.
