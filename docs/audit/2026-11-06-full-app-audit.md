# Scrivon full app audit (6 November 2026)

## Fix status (7 November 2026, missing features updated 14 November 2026)

The fixes were merged into `dev` in PR #66. They were done in three rounds, and each round was checked by independent reviewers. A ✅ before an item's title means it is fixed (or, for a missing feature, built); ⬜ means it still needs doing.

- **Problems (338, not counting the 50 missing features):** an independent final review confirmed 330 fixed. Of the other 9, it found 7 only partly done, and the third round finished those. Only two are left, and both are yours to decide: code signing (S06) and the installer's publisher name (R16).
- **New problems found by the final review (75):** 45 of these were caused by the fixes themselves. 72 are fixed. Three need a new Rust command, which that round wasn't allowed to add:
    - Deleting a big folder runs on the window's main thread, so the app can stall (N65).
    - Checking whether open files changed on disk also runs on that thread (N66).
    - When a file can't be replaced, the fallback save isn't flushed to disk (N59, partly fixed).
- **Known gaps left:**
    - With "Hide footer on title page and contents", the last contents page still shows the footer bar. Fixing it needs a change in the Rust page-number stamper.
    - After renaming or deleting in the explorer, focus waits up to 5 seconds for the tree to update. The proper fix belongs in the workspace session code.
- **Missing features (F list):** 48 of the 50 are built. F39 is half built and F44 is still open; both wait on #124. See [Missing features built](#missing-features-built) below.
- **Checks (all passing, 7 November):** 2378 frontend tests (coverage about 94%; the minimum is now set just under that), 158 Rust tests, type check, ESLint, Clippy with warnings treated as errors, cargo fmt, the Tauri version check, and `next build`.
- **Checks (all passing, 14 November, after the missing features):** 3778 frontend tests in 268 files (coverage 96% of statements, 97% of lines), 268 Rust tests, and the same checks as above, including Clippy on the release build. Both Windows installers (x64 and ARM64) build in CI.
- **Still needs a person:** [manual-checklist.md](manual-checklist.md) lists what tests can't cover. It's a one-off click-through in the real Windows app. Several of the feature PRs also say they weren't tried by hand in the built app; each PR description lists the steps to check.

<a id="missing-features-built"></a>

### Missing features built (14 November 2026)

Each feature had its own ticket and PR, merged into `dev`.

| F items         | What was built                                                               | Ticket | PR   |
| --------------- | ---------------------------------------------------------------------------- | ------ | ---- |
| F01             | Delete goes to the Recycle Bin, with a clearer confirm                       | #118   | #138 |
| F02             | Workspace images show in the Markdown preview                                | #105   | #136 |
| F03             | Images embedded in PDF and Word exports                                      | #106   | #155 |
| F04, F08        | Clear message for unsupported diagrams, Mermaid syntax colours, snippets     | #108   | #141 |
| F05, F49        | Check for updates on demand, and rc installs get updates                     | #110   | #162 |
| F06             | Diagram zoom buttons, and keyboard zoom and pan                              | #111   | #161 |
| F07, F17, F46   | Shared command list for the palette and menus, plus an Edit menu             | #96    | #142 |
| F09             | Paste and drop images and files                                              | #107   | #154 |
| F10             | Spell checking                                                               | #119   | #144 |
| F11, F33        | Export from the File menu and palette, HTML export, a saved message          | #113   | #167 |
| F12             | Explorer shows the active file, plus Collapse All                            | #116   | #160 |
| F13             | Move files by drag and drop or Move to…                                      | #117   | #171 |
| F14             | Editor and preview scroll together, with jump to source                      | #103   | #140 |
| F15             | Editor-only layout (hide the preview)                                        | #104   | #159 |
| F16, F41        | Status bar, and the current file shown in the title bar                      | #101   | #134 |
| F16             | Outline panel for Markdown headings                                          | #102   | #139 |
| F18             | Follow the Windows light/dark setting                                        | #120   | #143 |
| F19, F38        | Reopen the last folder, remember the window, fix Restore panel layout        | #121   | #135 |
| F20             | Live PDF preview in the export dialog                                        | #125   | #151 |
| F21, F34        | Tab shortcuts and more tab actions                                           | #97    | #165 |
| F22             | Keyboard moves between panes, and F2/Delete in the explorer                  | #100   | #164 |
| F23, F39 (half) | Settings backup file, and export/import of settings and profiles             | #123   | #148 |
| F24             | Open files from Windows Explorer                                             | #122   | #157 |
| F25             | Logs, crash catching and diagnostic info                                     | #127   | #170 |
| F26             | App zoom and preview text size                                               | #112   | #166 |
| F27, F50        | ARM64 build, minimum Windows version, uninstall clean-up                     | #132   | #152 |
| F28, F30        | New file and folder from anywhere; the name prompt no longer reads its title | #99    | #163 |
| F29             | Palette modes: go to line, jump to heading, help                             | #128   | #169 |
| F31, F32        | Markdown writing helpers, Ctrl+B for bold, CJK word selection                | #109   | #168 |
| F35             | Reveal in File Explorer and Copy Path                                        | #98    | #133 |
| F36, F37        | Copy button on code blocks, GitHub alerts and math                           | #115   | #137 |
| F40             | Settings dialog remembers its section, plus search                           | #129   | #146 |
| F42             | Windows 11 Snap Layouts on the maximise button                               | #130   | #150 |
| F43             | Save examples into the folder, and examples from the welcome screen          | #131   | #149 |
| F45             | Diagram export options and copy to clipboard                                 | #114   | #172 |
| F47, F48        | PDF bookmarks, and page numbers that start at the body                       | #126   | #147 |

**Still open:**

- **F39 (half built):** profile export and import are in (#123). More page sizes and code themes are #124, which isn't merged.
- **F44:** the "Contents title" setting is also #124.
- **Why #124 isn't in:** its PR #145 passed its checks on 13 November, but the agent workflow building it hit an error before it could merge (it couldn't set up its own working copy of the repo). `dev` has moved on since, so PR #145 now has merge conflicts and needs updating first.

**Small follow-ups the feature PRs left out** (details in each PR's "Left out" notes):

- #153: the palette's theme commands quietly turn off "Follow Windows" (found while reviewing #120).
- Drag to reorder tabs (F34). The ticket marked it optional.
- Case, whole-word and regex options for workspace search (F29). The ticket marked them optional.
- Open with Default App (F35). Skipped because it needs a broad new permission.
- Math in Word shows its TeX source, not a Word equation (F37).
- Moving a Markdown file doesn't update the relative links inside it (F13).

## Overview

Scrivon's main idea works: you open a folder, edit Markdown and Mermaid side by side, see a live preview, and export to SVG, PNG, PDF and Word. But the audit confirmed 388 problems, and the most serious group is about losing or overwriting work. Installing an update, autosaving while you type, creating or renaming files, reopening a file, closing tabs and changing settings can all silently throw away text or replace another file. When something does go wrong, the error is usually hidden in a tooltip or the developer console, so people don't find out until it's too late. On top of that, the code editor is downloaded from the internet at runtime, so it doesn't work offline, and a few Rust commands and the release pipeline give out more access than they should. PDF and Word exports have many layout bugs (cut-off code, shrinking pages, missing images). Most of the rest is polish: keyboard and screen-reader access, everyday features people expect from an editor, small UI inconsistencies, and some dead code. The good news is that 7 of the 9 critical problems are marked as small fixes, so the worst risks can be closed quickly.

## Counts

| Area                        | Critical | High   | Medium  | Low     | Total   | Still open (14 Nov) |
| --------------------------- | -------- | ------ | ------- | ------- | ------- | ------------------- |
| Data loss & file safety (D) | 8        | 4      | 8       | 4       | 24      | 0                   |
| Security (S)                | 0        | 2      | 4       | 8       | 14      | 1 (S06)             |
| Bugs (B)                    | 0        | 12     | 51      | 63      | 126     | 0                   |
| Performance (P)             | 0        | 0      | 8       | 11      | 19      | 0                   |
| UI/UX (U)                   | 1        | 3      | 31      | 58      | 93      | 0                   |
| Accessibility (A)           | 0        | 0      | 11      | 16      | 27      | 0                   |
| Missing features (F)        | 0        | 4      | 22      | 24      | 50      | 2 (F39 half, F44)   |
| Build/release/docs (R)      | 0        | 1      | 5       | 10      | 16      | 1 (R16)             |
| Code health (C)             | 0        | 0      | 2       | 17      | 19      | 0                   |
| **Total**                   | **9**    | **26** | **142** | **211** | **388** | **4**               |

The R group holds 10 build/release items and 6 documentation items.

Missing features: 48 of the 50 are now built. F39 is half built and F44 is open, both waiting on #124. [Missing features built](#missing-features-built) lists the ticket and PR for each one.

How to read the labels:

- **Critical**: you can lose or destroy work during normal use.
- **High**: a core feature is broken, or work is at risk in a common situation.
- **Medium**: a noticeable problem, but there is a workaround or it is a less common path.
- **Low**: polish, rare cases, or developer-only issues.
- **Effort**: trivial (minutes), small (under a day), medium (a few days), large (a week or more).

## Fix these first

Ranked by how much they hurt users.

1. **Updating can wipe unsaved work.** [D01](#d01), [D20](#d20)
2. **Autosave can say "saved" when your last typing was never written.** [D04](#d04)
3. **Settings get wiped after ordinary use** (resizing a pane is enough). [D03](#d03), [D17](#d17)
4. **Reopening a file can overwrite a newer version on disk.** [D02](#d02)
5. **Creating, renaming or duplicating can silently replace another file.** [D07](#d07), [D08](#d08), [U01](#u01), [D14](#d14)
6. **Unsaved or failed-to-save edits are dropped with no warning, and save errors are hidden.** [D06](#d06), [D11](#d11), [B03](#b03), [U03](#u03)
7. **On Windows one file can open in two tabs that overwrite each other.** [D05](#d05)
8. **Changes made outside Scrivon (git, other editors) get overwritten.** [D10](#d10)
9. **The editor doesn't load offline.** [R01](#r01)
10. **Security: a script in the window can reach the whole disk, and the release signing key is exposed to unpinned third-party code.** [S02](#s02), [S05](#s05), [S01](#s01)
11. **File errors are silent, deleting any non-empty folder fails, and some folders won't open at all.** [B06](#b06), [B11](#b11), [B12](#b12)
12. **A crash or power cut can lose every unsaved edit, or leave a file empty.** [D09](#d09), [D18](#d18)
13. **Diagram syntax errors are hidden once a diagram has rendered.** [U02](#u02)
14. **Workspace search misses files and can hang forever.** [B01](#b01), [B02](#b02)
15. **Files that aren't UTF-8 get corrupted on the first keystroke.** [D12](#d12)

## Data loss & file safety (D)

<a id="d01"></a>

#### ✅ D01 · [critical] "Install and restart" kills the app without saving open edits

- **Where:** `components/studio/app-update-provider.tsx:84`
- **What happens:** When you click Install and restart, Scrivon closes straight away and any text that hasn't been saved yet is gone. This mostly hits people with autosave off, or a tab whose last save failed.
- **Why:** `installUpdate` goes straight to the install command. On Windows the updater plugin then does a hard process exit, so the normal save-on-close code never runs.
- **Fix:** Before installing, call `flushAllSaves()` and save the tab session. If any save fails, stop and ask "Some files could not be saved. Install anyway?". Show install errors to the user (not just the console), and let a failed download be retried. Add a test that a dirty tab is written before the install starts.
- **Effort:** small

<a id="d02"></a>

#### ✅ D02 · [critical] Reopening a file shows an old Monaco model; typing overwrites the newer file on disk

- **Where:** `components/studio/editor/code-editor-panel.tsx:139-214`
- **What happens:** Close a file, change it in another program (or with git), and reopen it. The editor shows the old text while the preview shows the new text. The first key you press saves the old text over the newer file.
- **Why:** The editor library reuses any existing in-memory "model" for the same path and ignores the fresh content, and Scrivon never throws those models away when tabs close, files are renamed or a folder closes.
- **Fix:** Dispose any Monaco model whose path doesn't match an open tab. As a safety net, resync the model to the tab's content on mount and on tab change, without marking the tab dirty. Add a regression test. Optionally encode the path so files like `a%20b.md` and `a b.md` get separate models (see B72).
- **Effort:** small

<a id="d03"></a>

#### ✅ D03 · [critical] After the first settings change in a session, every change (pane width, layout toggles, editor settings) saves the string "undefined" and settings reset on restart

- **Where:** `components/studio/settings/settings-provider.tsx:50`
- **What happens:** Change a setting, then drag the editor divider or toggle a panel. On the next launch, font size, tab size, custom shortcuts, PDF profiles and more are back to defaults.
- **Why:** `updateSettings` reads the new value from inside a React state updater and saves it immediately. Once React delays that updater (which happens after the first update), the value is still empty, so the text "undefined" is stored. The next load can't read it and falls back to defaults.
- **Fix:** Work out the next settings from a ref that always holds the latest value (or save in an effect after state changes), and debounce the save. Make `saveSettings` refuse bad input, and make `loadSettings` ignore a stored "undefined". Add a test that renders the real provider without `act()`.
- **Effort:** small

<a id="d04"></a>

#### ✅ D04 · [critical] Autosave marks a tab clean even if you typed while the save was running, so the newest text is never written

- **Where:** `components/studio/workspace/document-save-context.tsx:72-73`
- **What happens:** If you type while a save is in progress, those last characters are never written. The tab shows as saved, and the window closes without warning. This is much more likely on OneDrive, network drives or with antivirus scanning.
- **Why:** When the write finishes, `flushSave` marks the tab clean without checking whether the text changed during the write. Two saves for the same file can also overlap and finish out of order.
- **Fix:** Take a snapshot of the text before writing, and after success set "dirty" to "current text differs from snapshot". Queue saves per tab so they run one at a time, and save again if newer text arrived. Make "save all" wait for saves already running. Add a test with a slow mocked write.
- **Effort:** small

<a id="d05"></a>

#### ✅ D05 · [critical] On Windows, one file can get two different tab IDs, which causes duplicate tabs, missed deletes/renames, and overwritten files

- **Where:** `lib/tauri/fs.ts:20`
- **What happens:** Create or rename a file in the explorer, then click it: a second tab for the same file opens. The two tabs save over each other. Deleting leaves the tab open (and the next keystroke brings the file back), and renaming doesn't move the tab. The duplicates are restored every launch.
- **Why:** The file tree builds paths with `/` after a `\` folder root, while create, rename and duplicate build them with `\`. Tabs are matched by exact text, so the two forms never match.
- **Fix:** Add `normalizePath` and `samePath` helpers, build every path through `joinPath`, normalise at every entry point (opening a folder, tab ids, session restore, recents) and compare paths with the helper, ignoring case on Windows. Add tests with real Windows-style roots.
- **Effort:** small

<a id="d06"></a>

#### ✅ D06 · [critical] With autosave off, closing a tab with unsaved changes throws them away without asking

- **Where:** `components/studio/workspace/document-tabs-context.tsx:217-269` (also `document-save-context.tsx:84`, `use-window-close.ts:19`, `workspace-session-context.tsx:89,133`)
- **What happens:** With autosave off, clicking a tab's X, Close Others, Close All or the palette's Close Tab loses your edits with no prompt. Yet closing the window or the folder silently saves everything, even though you turned autosave off.
- **Why:** There is no "unsaved changes" prompt anywhere in the app. The close functions just cancel the save timer and remove the tab. "Save all" ignores the autosave setting, and a failed save on close is ignored too.
- **Fix:** Add a Save / Don't Save / Cancel dialog and one shared helper used by tab close, folder close and switch, and window close. Never close a tab whose save failed. Keep "save all" for the explicit Save All command. Add tests for each choice, with autosave on and off.
- **Effort:** medium

<a id="d07"></a>

#### ✅ D07 · [critical] Creating a file with an existing name silently overwrites it (including the default name)

- **Where:** `lib/tauri/fs.ts:74` (handled in `components/studio/workspace/workspace-session-context.tsx:157-158`)
- **What happens:** Use New Diagram twice and press Enter on the default name "diagram.mmd": your first diagram is replaced by the template with no warning. If it was open in a tab, the tab still shows the old text, which hides the loss.
- **Why:** `createFile` never checks whether the file exists, and writes with "create and empty". The prompt pre-fills a fixed name.
- **Fix:** Write with `{ createNew: true }` and show "A file with that name already exists" on failure. Check the folder's existing names (ignoring case) first, and pre-fill a unique name such as "diagram 2.mmd". Apply the same guard to rename, duplicate and new folder.
- **Effort:** small

<a id="d08"></a>

#### ✅ D08 · [critical] Renaming onto an existing file name silently replaces that file

- **Where:** `components/studio/workspace/workspace-session-context.tsx:192`
- **What happens:** Rename draft.md to final.md when final.md already exists, and the old final.md is deleted for good with no prompt.
- **Why:** `renameEntry` calls the plugin's rename, which replaces an existing file at the destination. Nothing checks for a clash first.
- **Fix:** Check whether the new path exists before renaming (skipping case-only renames like a.md to A.md) and show an error if it's taken. Also drop or merge any other tab already open on that path. Add the same check to create file and create folder, and add a test.
- **Effort:** small

<a id="d09"></a>

#### ✅ D09 · [high] No hot-exit or backup of unsaved buffers: crash, kill, Windows restart or power loss loses every unsaved edit

- **Where:** `components/studio/workspace/document-save-context.tsx:90` (also `components/studio/app-update-provider.tsx:84`)
- **What happens:** With autosave off, or a save that keeps failing, a Windows restart, power cut, crash or Task Manager kill loses every unsaved edit. After relaunch the tabs show the old disk text and nothing offers to recover.
- **Why:** Unsaved text lives only in memory. The only safety net is the close-window handler, and Windows shutdown, crashes and the updater all skip it.
- **Fix:** First, flush saves before installing an update (D01). Then add a small backup service that writes unsaved text to the app data folder about once a second, deletes it after a successful save, and offers "Restored unsaved changes in N files" when the folder opens.
- **Effort:** medium

<a id="d10"></a>

#### ✅ D10 · [high] No file watching or refresh: external changes never appear and autosave overwrites them

- **Where:** `components/studio/workspace/document-save-context.tsx:72` and `components/studio/workspace/workspace-session-context.tsx:77`
- **What happens:** Files added by git or another program never appear in the explorer. If you edit an open file in another editor and then type one character in Scrivon, the other editor's changes are overwritten. A file deleted outside the app comes back on the next autosave.
- **Why:** There is no file watcher, no refresh button and no refresh on window focus. Saves write without checking whether the file changed on disk.
- **Fix:** Turn on the fs plugin's watch feature and refresh the tree on changes. Store each tab's disk "modified time" and, before saving, refuse to overwrite a changed or deleted file and ask Reload / Overwrite. Reload clean tabs automatically. Add a Refresh button and command, and refresh when the window regains focus.
- **Effort:** medium

<a id="d11"></a>

#### ✅ D11 · [high] Closing or switching folders discards edits that failed to save, and never asks about unsaved changes

- **Where:** `components/studio/workspace/workspace-session-context.tsx:133` (closeWorkspace) and `:89` (openWorkspace)
- **What happens:** If a save has failed (locked file, unplugged drive), Close Folder or opening another folder makes those edits vanish with no warning. With autosave off, Close Folder silently writes everything instead of asking.
- **Why:** Both functions ignore whether "save all" succeeded and then clear all tabs.
- **Fix:** Stop the close or switch when saving fails, and tell the user which files couldn't be saved. With autosave off, ask Save / Don't Save / Cancel using the same shared helper as D06. Add tests that a failed save keeps the folder open.
- **Effort:** small

<a id="d12"></a>

#### ✅ D12 · [high] Files that aren't UTF-8 (UTF-16, ANSI/Windows-1252) are decoded with errors and rewritten corrupted on the first keystroke; BOMs are stripped

- **Where:** `lib/tauri/fs.ts:47`
- **What happens:** A UTF-16 file (the default output of Windows PowerShell 5.1) or an old "ANSI" file shows garbage. Pressing any key rewrites it as UTF-8 with accented letters replaced by "?" boxes, and they can't be recovered.
- **Why:** Files are read as UTF-8 in forgiving mode and saved back as UTF-8, with no encoding check and no warning.
- **Fix:** Read raw bytes and detect a BOM, UTF-16 or valid UTF-8. Store the encoding on the tab and save back the same way. Open unknown encodings read-only with "Reopen as Windows-1252" or "Convert to UTF-8" choices. Add round-trip tests.
- **Effort:** medium

<a id="d13"></a>

#### ✅ D13 · [medium] Deleting a profile is one click, with no confirmation and no undo

- **Where:** `components/studio/settings/sections/pdf-export-settings.tsx:154`
- **What happens:** The Delete button sits right next to Duplicate. One misclick deletes a fully set-up branded export profile (fonts, colours, logos, header and footer) for good.
- **Why:** The button deletes the active profile straight away and it's saved at once. The settings dialog has no undo.
- **Fix:** Put Delete behind the same confirm dialog used by "Restore defaults", naming the profile in the message. Optionally show an Undo toast.
- **Effort:** small

<a id="d14"></a>

#### ✅ D14 · [medium] Duplicate copies the disk version (ignoring unsaved edits) and can overwrite an existing file

- **Where:** `components/studio/workspace/workspace-session-context.tsx:210-221` (also `lib/tauri/fs.ts:87-90`)
- **What happens:** Duplicating notes.md can silently overwrite an existing "Notes copy.md" (same name, different case) or a copy made outside the app since the last refresh. The copy also leaves out unsaved edits.
- **Why:** The new name is checked against a possibly stale tree with a case-sensitive match, and the copy replaces any file already there.
- **Fix:** Read the source and write the copy with `{ createNew: true }`. Pick the name by checking a fresh listing of the folder, ignoring case, and retry on a clash. Optionally include the open tab's unsaved text.
- **Effort:** small

<a id="d15"></a>

#### ✅ D15 · [medium] Control characters in the markdown produce a corrupt .docx that Word cannot open

- **Where:** `lib/markdown/export-docx.ts:378`
- **What happens:** Text with terminal colour codes, form feeds or other control characters exports "successfully", but Word says the file has a problem and won't open it.
- **Why:** These characters aren't allowed in XML, and the docx library writes them as-is.
- **Fix:** Add an `xmlSafe()` helper that removes XML-forbidden characters and use it everywhere text reaches the docx library (or in one wrapper around `TextRun`). Add a test that the XML is clean.
- **Effort:** small

<a id="d16"></a>

#### ✅ D16 · [medium] A document that starts with a `---` rule silently loses content in PDF/Word

- **Where:** `lib/markdown/export-metadata.ts:43`
- **What happens:** A note that starts with a horizontal rule, then some paragraphs, then another rule exports without those paragraphs.
- **Why:** Anything between a first-line `---` and the next `---` is treated as front matter, even if it isn't `key: value` data.
- **Fix:** Require the closing `---` to be on its own line, and only treat the block as front matter if every line looks like `key: value`. Share the helper with the preview so both hide exactly the same block. Add tests.
- **Effort:** small

<a id="d17"></a>

#### ✅ D17 · [medium] An unreadable settings blob triggers a lossy legacy migration that immediately overwrites it (what survives the 'undefined' write)

- **Where:** `lib/settings/storage.ts:25`
- **What happens:** If saved settings can't be read (for example after D03 stores "undefined"), the next launch quietly resets most settings, keeps only the theme and layout, and turns update checks back on. Nothing tells you.
- **Why:** `loadSettings` falls back to an old migration path and saves the result immediately, with no backup.
- **Fix:** Keep a copy of the unreadable value, restore from a backup copy if one exists, and show a message. Never write "undefined". Give `lib/tauri/store.ts` a read-only settings reader so opening a folder never writes settings. Fix the root cause in D03.
- **Effort:** small

<a id="d18"></a>

#### ✅ D18 · [medium] Saves aren't atomic, so a failed or interrupted write can leave the file empty or half-written

- **Where:** `lib/tauri/fs.ts:64`
- **What happens:** A power cut, crash or full disk in the middle of an autosave can leave the file empty or cut off. Closing the tab then throws away the only good copy.
- **Why:** The write empties the real file first and then writes; there's no "write to a temp file, then swap" step.
- **Fix:** Add a Rust command that writes to a temp file in the same folder, flushes it, and renames it over the original (retrying briefly if antivirus or OneDrive has it locked). Don't close tabs whose save failed.
- **Effort:** small

<a id="d19"></a>

#### ✅ D19 · [medium] Changing the app identifier in 1.4.1 silently wiped every user's settings, shortcuts, recent folders and tab sessions

- **Where:** `src-tauri/src/lib.rs:21` (with `src-tauri/tauri.conf.json:13-20`)
- **What happens:** Anyone who updated from 1.4.0 or earlier came back to the default theme, default shortcuts, no recent folders and no restored tabs. Their old data is still on disk.
- **Why:** Tauri names the app's data folders after the identifier, which changed from `com.diagram.app`, and no migration was added.
- **Fix:** Create the main window from code instead of config, and before that copy the old `workspace.json` and WebView2 storage across once (guarded by a marker file). Add a changelog note and a code comment that the identifier must never change again.
- **Effort:** medium

<a id="d20"></a>

#### ✅ D20 · [medium] Passive NSIS updates silently kill any other running Scrivon window, losing its unsaved edits

- **Where:** `src-tauri/src/lib.rs:22`
- **What happens:** If two Scrivon windows are open, installing an update from one force-closes the other, and its unsaved edits are lost.
- **Why:** In passive mode the installer kills every running scrivon.exe without asking, and nothing stops a second copy of the app from starting.
- **Fix:** Add `tauri-plugin-single-instance` so a second launch just focuses the existing window. Combine it with the "save before install" fix in D01.
- **Effort:** small

<a id="d21"></a>

#### ✅ D21 · [low] 'Restore defaults' also deletes every PDF/DOCX export profile, but the warning doesn't say so; 'Reset all' shortcuts has no confirmation

- **Where:** `components/studio/settings/settings-provider.tsx:160`
- **What happens:** Confirming "Restore defaults", whose warning only mentions preferences and shortcuts, also deletes all your custom export profiles. The Keyboard page's "Reset all" wipes custom shortcuts in one click.
- **Why:** The reset replaces the whole settings object, profiles included, and the shortcut reset has no confirm step.
- **Fix:** Keep export profiles when restoring defaults (or say clearly that they'll be deleted), and add a confirm dialog to "Reset all".
- **Effort:** small

<a id="d22"></a>

#### ✅ D22 · [low] A pending or in-progress autosave isn't handled around rename/delete, so it can recreate the old file or get lost

- **Where:** `components/studio/workspace/workspace-session-context.tsx:190-203`
- **What happens:** With a long autosave delay, renaming or deleting a file right after typing can bring the old file back next to the new one, or leave the renamed tab unsaved.
- **Why:** Save timers are tied to the old tab id, and tabs are only updated after a full tree rescan, so a timer can fire in between.
- **Fix:** Before a rename, flush pending saves for the affected tabs; before a delete, cancel them. Update tabs right after the disk change, then refresh the tree. Track saves in progress so they finish cleanly.
- **Effort:** small

<a id="d23"></a>

#### ✅ D23 · [low] Settings written by a newer version lose unknown fields, enum values and actions on the next unrelated change

- **Where:** `lib/settings/storage.ts:41` (with `lib/settings/migrate.ts:84`)
- **What happens:** After going back to an older version, the first small change (like resizing the editor) permanently deletes settings only the newer version understood, such as export profiles.
- **Why:** Settings are rebuilt from a fixed list of known fields and saved back, with no version number.
- **Fix:** Merge saved settings onto the original stored data so unknown fields survive, add a `schemaVersion` and back up the stored data when it's newer, and keep export profiles under their own key.
- **Effort:** small

<a id="d24"></a>

#### ✅ D24 · [low] A corrupt workspace.json is silently ignored and then overwritten, wiping recents and every folder's tab session

- **Where:** `lib/tauri/store.ts:29`
- **What happens:** If `workspace.json` gets damaged (for example by a power cut mid-save), the app starts with no recent folders and soon overwrites the file, so recents and every folder's tabs are gone for good.
- **Why:** The store plugin ignores read errors, starts empty, and its next save writes over the damaged file.
- **Fix:** Before opening the store, check the file can be read. If not, move it aside, restore a `.bak` copy if one exists, and tell the user. Keep a `.bak` copy after each good load, and optionally write atomically.
- **Effort:** small

## Security (S)

<a id="s01"></a>

#### ✅ S01 · [high] Release jobs that hold the updater signing key and a branch-bypass PAT run third-party actions pinned only to mutable tags

- **Where:** `.github/workflows/release.yml:86` (also `release.yml:39`, `:51-53`, `:59`, `:62`; `.github/actions/setup-bun/action.yml:8`; `.github/workflows/build-release.yml:30`, `:33`, `:57`; `.github/dependabot.yml`)
- **What happens:** Nothing visible today. But if any of the GitHub Actions used here were hijacked, an attacker could steal the update signing key and push a signed "update" that every Scrivon install would download and run.
- **Why:** Every third-party action is pinned to a movable tag like `@v4` instead of a fixed commit. The semantic-release action also installs its own packages at run time, without a lockfile, while holding a token that can bypass branch protection.
- **Fix:** Pin every action to a full commit SHA and let Dependabot keep them updated. Run the lockfile-pinned semantic-release with `bunx`. Limit job permissions, stop leaving checkout credentials on disk, and move the signing key into a protected "release" environment with a password.
- **Effort:** small

<a id="s02"></a>

#### ✅ S02 · [high] Custom commands let any webview script bypass the fs scope: allow_workspace(any path), read_export_image(any file), export_html_to_pdf(any output path)

- **Where:** `src-tauri/src/lib.rs:14`
- **What happens:** Nothing visible today. But any script that ends up running in the window (for example the editor code fetched from a CDN in R01) could get read and write access to the whole disk, read any file, or write a file anywhere.
- **Why:** `allow_workspace` grants full access to any path it's given, `read_export_image` reads any file, and `export_html_to_pdf` writes to any path. App commands aren't permission-checked, and folders granted in a session are never revoked.
- **Fix:** Replace `allow_workspace` with commands that only grant folders the user picked in a dialog (or already has in Recent). Limit image reads to picked image files, and let Rust open the PDF save dialog itself. Add an app command manifest, bundle Monaco and set a CSP.
- **Effort:** medium

<a id="s03"></a>

#### ✅ S03 · [medium] Raw HTML, including hidden `<!-- comments -->`, is written into the Word file as visible text

- **Where:** `lib/markdown/export-docx.ts:673`
- **What happens:** Private notes written as HTML comments, and tags like `<br>` or `<kbd>`, show up as literal text in the Word file you send to people. The PDF drops them, so the two exports disagree.
- **Why:** The Word exporter turns HTML into plain text instead of skipping or interpreting it.
- **Fix:** Skip HTML comments and other tags in Word export, turn `<br>` into a line break, and update the test that currently expects the tags to appear. Optionally make the preview match too.
- **Effort:** small

<a id="s04"></a>

#### ✅ S04 · [medium] Live preview fetches Google Fonts for every rendered diagram (privacy/offline issue for a local-first app)

- **Where:** `lib/mermaid/render.ts:28`
- **What happens:** Diagram previews contact fonts.googleapis.com, which contradicts the "no cloud" promise, and the font changes when you're offline.
- **Why:** The diagram library adds a Google Fonts import to every SVG, and Scrivon passes it through unchanged with no CSP to block it.
- **Fix:** Strip the import in `render.ts` so every output (preview, SVG, PNG, PDF, Word) is fixed at once. Either bundle the Inter font as embedded data or fall back to the system font. Add a CSP and a test that the output has no `fonts.googleapis.com`.
- **Effort:** small

<a id="s05"></a>

#### ✅ S05 · [medium] Content Security Policy is disabled (csp: null)

- **Where:** `src-tauri/tauri.conf.json:23` (plus `components/studio/editor/code-editor-panel.tsx:17` for bundling Monaco)
- **What happens:** Nothing visible today, but any future script injection would get unrestricted network access and full use of the app's powerful commands.
- **Why:** With no CSP the window can load scripts from anywhere and send data anywhere.
- **Fix:** Bundle Monaco locally and strip the Google Fonts import, then set a strict CSP (scripts only from the app itself, images and fonts from the app or embedded data, limited network targets). Test every feature with it switched on.
- **Effort:** medium

<a id="s06"></a>

#### ⬜ S06 · [medium] Nothing is Authenticode-signed: SmartScreen warnings, Smart App Control blocks, 'Unknown publisher' UAC prompts and antivirus risk on every release

- **Where:** `.github/workflows/release.yml:85` (also `build-release.yml:56`, `src-tauri/tauri.conf.json:26`, `docs/development.md:152`, `README.md:64`)
- **What happens:** New users see "Windows protected your PC – Unknown publisher" and must click through. PCs with Smart App Control on may block the app completely. MSI users get an "Unknown publisher" admin prompt on every update.
- **Why:** No Windows code signing is set up. The only signature is the updater's own key, which Windows doesn't look at.
- **Fix:** Now: add a README note on getting past SmartScreen and correct the misleading signing docs. Then sign builds (for example with Azure Trusted Signing or SignPath), using a separate signing config file and CI secrets.
- **Effort:** medium

<a id="s07"></a>

#### ✅ S07 · [low] .gitignore only protects the private key if it has exactly one filename

- **Where:** `.gitignore:33`
- **What happens:** If a maintainer saves the private update key under another name (for example a backup copy), a normal `git add .` would publish it in this public repo.
- **Why:** Only the exact path `src-tauri/.updater/scrivon` is ignored.
- **Fix:** Ignore everything in `src-tauri/.updater/` except `*.pub` files.
- **Effort:** trivial

<a id="s08"></a>

#### ✅ S08 · [low] Opening an untrusted document makes network requests (remote images, Google Fonts in every diagram), despite the 'local-first' claim

- **Where:** `components/studio/markdown/markdown-preview.tsx:50`
- **What happens:** A Markdown file with a remote image (for example a tracking pixel) contacts that server the moment you open it. Every diagram also contacts Google.
- **Why:** The preview has no image policy, and diagram SVGs carry a remote font import.
- **Fix:** Strip the font import, add an opt-in "Load remote images" setting with a placeholder, apply the same rule to PDF export, and set a CSP. Showing local images is a separate feature (F02).
- **Effort:** medium

<a id="s09"></a>

#### ✅ S09 · [low] Non-Windows PDF fallback prints the export HTML in an unsandboxed, same-origin iframe

- **Where:** `lib/markdown/export-pdf.ts:37`
- **What happens:** Nothing today. A future change that let script into the export HTML would give it full app access on macOS and Linux.
- **Why:** The print frame has no sandbox, so it shares the app's origin.
- **Fix:** Add `sandbox="allow-same-origin allow-modals"` (no scripts) and check printing still works.
- **Effort:** trivial

<a id="s10"></a>

#### ✅ S10 · [low] Export pipeline doesn't filter link URLs (javascript:, file:, custom protocol handlers) the preview strips

- **Where:** `lib/markdown/export-docx.ts:442` (also `lib/markdown/markdown-to-export-html.ts:205`)
- **What happens:** Links like `javascript:` or `file:` that the preview makes harmless become live clickable links in exported PDF and Word files that you might send to others.
- **Why:** The export code has no link filter.
- **Fix:** Add one shared "safe link" helper with the same rule as the preview, and turn unsafe links into plain text in both exporters. Add tests.
- **Effort:** small

<a id="s11"></a>

#### ✅ S11 · [low] Picking a logo grants recursive read/write file access to its whole folder, which isn't needed

- **Where:** `lib/tauri/dialog.ts:75`
- **What happens:** Choosing a logo from Downloads lets the app's web view read and write all of Downloads for the rest of the session, even though nothing needs that.
- **Why:** The image picker grants access to the image's parent folder, but the image is read by a separate command anyway. That command also reads any file type, not just images.
- **Fix:** Remove the folder grant, and make `read_export_image` accept only real image files (check the extension and the first bytes).
- **Effort:** small

<a id="s12"></a>

#### ✅ S12 · [low] 'Remove from recent' leaves the folder's file lists and open tabs in workspace.json

- **Where:** `lib/tauri/store.ts:54`
- **What happens:** After you remove a private folder from Recent, the paths of the files you had open there stay in the app's data file forever.
- **Why:** Only the recent list is updated; the folder's own saved keys are never deleted.
- **Fix:** Delete the folder's three saved keys when it is removed (and when it drops off the end of the list).
- **Effort:** trivial

<a id="s13"></a>

#### ✅ S13 · [low] Capabilities use the `$RUNTIME` folder permissions by mistake and grant an unused updater API

- **Where:** `src-tauri/capabilities/default.json:17`
- **What happens:** Nothing visible on Windows. On a Linux build, the web view could write to the user's runtime folder, and any script could call the updater directly.
- **Why:** The "runtime" permission sets mean the `$RUNTIME` folder, not "decided at runtime". The updater permission is granted twice even though the app never uses it from JavaScript.
- **Fix:** Replace them with only the file commands the app uses, remove `updater:default` and the unused JS package, and remove the duplicate update URL.
- **Effort:** trivial

<a id="s14"></a>

#### ✅ S14 · [low] Updater config duplicated and the full updater JS API is exposed though unused

- **Where:** `src-tauri/src/updater.rs:46-51`
- **What happens:** Changing the update URL in `tauri.conf.json` has no effect, and scripts in the page can call the updater plugin directly, skipping the app's pre-release check.
- **Why:** The URL is hardcoded in Rust and overrides the config, and `updater:default` is granted though unused.
- **Fix:** Read the update URL from the config only, and remove `updater:default` and the unused `@tauri-apps/plugin-updater` package.
- **Effort:** trivial

## Bugs (B)

<a id="b01"></a>

#### ✅ B01 · [high] Workspace text search only ever scans the first 50 files in tree order; the rest are never searched

- **Where:** `components/studio/command-palette/search-content.ts:7`
- **What happens:** In a folder with more than 50 files, Find in Workspace never looks at the rest. You can see "No results found" next to "More matches exist — refine query", and refining doesn't help because the same 50 files are read every time.
- **Why:** A fixed 50-file cap is applied in the same tree order every search, and "capped" is set whenever any file was skipped, even with zero hits.
- **Fix:** Remove the file cap (or use a time budget instead), make "capped" mean "hit limit reached", and reword the footer to "Showing first N matches". Optionally cache file contents by modified time. Update the existing test and add one that finds a file past position 50.
- **Effort:** small

<a id="b02"></a>

#### ✅ B02 · [high] One unreadable file makes all text search fail: the spinner never stops and the promise rejection is unhandled

- **Where:** `components/studio/command-palette/search-content.ts:142`
- **What happens:** If one file was deleted, moved or locked outside the app, every text search spins forever and shows nothing, until you reopen the folder.
- **Why:** The file read has no error handling, so one failure rejects the whole search, and the caller never stops the spinner.
- **Fix:** Catch read errors per file and skip that file (optionally show "N files couldn't be read"). Always stop the spinner in a `finally` block. Add a test. The stale tree itself is covered by D10.
- **Effort:** small

<a id="b03"></a>

#### ✅ B03 · [high] If a save fails, the window refuses to close with no message and no 'close anyway' option

- **Where:** `components/studio/hooks/use-window-close.ts:18-23`
- **What happens:** With a read-only or locked file, clicking the X or pressing Alt+F4 does nothing, every time, and nothing says why. The only ways out are Close Folder (which loses the edits) or Task Manager.
- **Why:** The close handler cancels the close when a save fails, but shows nothing and offers no way to quit anyway.
- **Fix:** Show a dialog listing the files that failed and why, with Retry, Close Without Saving and Cancel. Add a timeout, ignore repeat clicks while saving, show "Saving before close…", and show the real OS error text.
- **Effort:** medium

<a id="b04"></a>

#### ✅ B04 · [high] Every tab switch remounts the whole editor area: undo history, cursor, preview scroll and per-tab zoom are thrown away

- **Where:** `components/studio/markdown/markdown-expand-context.tsx:24`
- **What happens:** Switch to another tab and back: Ctrl+Z has nothing to undo, the cursor and the preview are back at the top, and diagram zoom is reset.
- **Why:** A `key={tabId}` on a context provider forces React to rebuild the whole editor area on every switch, which throws away the editor's model and all per-tab state.
- **Fix:** Remove the key and store the expanded-diagram state with its tab id instead (this also fixes B27). Then add model cleanup as in D02, and a test that switching tabs doesn't remount the editor.
- **Effort:** small

<a id="b05"></a>

#### ✅ B05 · [high] All preview links open in the system browser, so relative .md links, #anchors and footnotes are broken

- **Where:** `components/studio/markdown/markdown-preview.tsx:63`
- **What happens:** Clicking a link like `docs/setup.md`, a `#section` link or a footnote opens a dead page in your web browser, instead of opening the file or jumping to the right spot.
- **Why:** Every link is set to open in a new window with no click handler, so the opener plugin sends them all to the browser. Headings also have no ids to jump to.
- **Fix:** Handle link clicks in the preview: scroll for `#` links, send web links to the browser, and open `.md`/`.mmd` links in a tab. Give headings ids (matching the export slugs) and keep footnote ids. Don't blank out Windows paths. Add a test.
- **Effort:** medium

<a id="b06"></a>

#### ✅ B06 · [high] File operation errors are swallowed; failed create/rename/delete/duplicate just do nothing

- **Where:** `components/studio/workspace/workspace-session-context.tsx:145`
- **What happens:** When creating, renaming, deleting or duplicating fails (locked file, name taken, folder not empty), the dialog closes and nothing happens, with no explanation.
- **Why:** These functions have no error handling, and every caller starts them without waiting for or catching errors.
- **Fix:** Wrap each in try/catch, turn OS errors into plain messages ("permission denied or in use", "already exists", "folder isn't empty", "no longer exists"), and always refresh the tree afterwards. Handle errors when opening a folder too.
- **Effort:** small

<a id="b07"></a>

#### ✅ B07 · [high] Long code lines are cut off in the PDF

- **Where:** `lib/markdown/export-html-css.ts:289`
- **What happens:** Any code line longer than about 95 characters is silently cut off at the right edge of the PDF.
- **Why:** Highlighted code blocks are set to never wrap and to scroll sideways, which paper can't do.
- **Fix:** Make code blocks wrap (`pre-wrap` plus `overflow-wrap: anywhere`), and add `table-layout: fixed` to the page frame table. Add a CSS test.
- **Effort:** trivial

<a id="b08"></a>

#### ✅ B08 · [high] With a header, footer or page numbers on, one wide item shrinks every page of the PDF and then cuts every paragraph off at the right edge

- **Where:** `lib/markdown/export-html-css.ts:463`
- **What happens:** One long code line, URL or wide table makes every page print smaller. Past a point, every paragraph on every page is cut off and the page numbers disappear.
- **Why:** The body sits inside a table that grows to fit its widest content, so the browser shrinks or clips the whole document to fit the page.
- **Fix:** Add `table-layout: fixed` to the frame table, `overflow-wrap: anywhere` to the article, make code wrap in print, and limit body image width. Add a test.
- **Effort:** small

<a id="b09"></a>

#### ✅ B09 · [high] Body images have no max-width, so a normal screenshot shrinks the whole PDF to 66% and is still cropped

- **Where:** `lib/markdown/export-html-css.ts:343`
- **What happens:** A normal 1920-pixel screenshot makes the whole PDF print at about two-thirds size, and the image is still cut off on the right.
- **Why:** Images in the body have no width rule and render at their natural pixel size.
- **Fix:** Add `.pdf-body img { max-width: 100%; height: auto; }`, plus a print rule that scales tall images to fit one page. Add a test.
- **Effort:** trivial

<a id="b10"></a>

#### ✅ B10 · [high] Exported SVG files depend on CSS variables, color-mix() and a Google Fonts @import, so they break outside browsers

- **Where:** `lib/mermaid/export.ts:15`
- **What happens:** Put an exported SVG into Word, PowerPoint or Inkscape and the shapes come out black or uncoloured. Offline, the font changes too.
- **Why:** The SVG works out its colours with CSS features that most non-browser tools don't support, and loads its font from Google.
- **Fix:** Add a `flattenSvgForExport` step that replaces every variable and colour mix with plain hex colours, removes the font import and sets a plain font list. Add a test that no `var(`, `color-mix` or `@import` remains.
- **Effort:** small

<a id="b11"></a>

#### ✅ B11 · [high] Deleting a folder that has anything in it always fails, with no message

- **Where:** `lib/tauri/fs.ts:82-84` (caller at `components/studio/workspace/workspace-session-context.tsx:199-205`)
- **What happens:** Confirm "Delete folder and its contents?" and the dialog closes, but the folder is still there and nothing says why.
- **Why:** The delete call doesn't ask for a recursive delete, so it only works on empty folders, and the error is swallowed.
- **Fix:** Pass `{ recursive: isDirectory }` and show errors. Because there is no undo, strongly consider moving items to the Recycle Bin first (F01) and warning about unsaved tabs in the folder.
- **Effort:** trivial

<a id="b12"></a>

#### ✅ B12 · [high] One unreadable subfolder (e.g. 'System Volume Information' on a drive root) aborts the whole workspace open with no message

- **Where:** `lib/tauri/fs.ts:23` (and `components/studio/workspace/workspace-session-context.tsx:93`)
- **What happens:** Opening a drive root, or a recent folder on an unplugged drive, does nothing at all. On macOS and Linux, a `.github` or `.vscode` folder can stop most repos from opening.
- **Why:** The folder scan has no per-folder error handling and opening a folder has no catch, so one failure aborts everything silently.
- **Fix:** Skip unreadable subfolders (and mark them), skip Windows system folders, show "Could not open folder" with an offer to remove it from Recent, and allow dot-folders in the macOS/Linux file scope.
- **Effort:** small

<a id="b13"></a>

#### ✅ B13 · [medium] Italic text renders upright: Inter is loaded without italics, and `font-synthesis: none` blocks fake italics

- **Where:** `app/layout.tsx:17` (also `app/layout.tsx:15` and `app/globals.css:16`)
- **What happens:** `*emphasis*` and blockquotes in the preview aren't italic.
- **Why:** Inter is loaded without its italic style, and a CSS rule stops the browser from faking a slant.
- **Fix:** Load Inter with `style: ['normal', 'italic']`, remove the duplicate Inter instance, and change the rule to `font-synthesis: style`.
- **Effort:** trivial

<a id="b14"></a>

#### ✅ B14 · [medium] Stale fallback shows the OLDEST cached render of a document, not the latest

- **Where:** `components/studio/canvas/use-mermaid-svg.ts:23`
- **What happens:** Leave a tab mid-edit (or with a broken diagram) and come back, and the canvas can show the diagram as it was when you first opened the file, with no error.
- **Why:** The fallback lookup returns the first cache entry for the document, which is the oldest.
- **Fix:** Keep a "last good picture per document" map and use that for the fallback. Cap the cache size (see P02).
- **Effort:** trivial

<a id="b15"></a>

#### ✅ B15 · [medium] The palette waits for the selected action to finish before closing: no busy state, double-runs on repeat Enter, and stays open on errors

- **Where:** `components/studio/workspace/workspace-session-context.tsx:93` (and `components/studio/command-palette/command-palette-dialog.tsx:141`)
- **What happens:** Picking a big or missing recent folder leaves the palette sitting open with no feedback, and pressing Enter again can run the action twice.
- **Why:** The palette waits for the action before closing, and opening a folder doesn't catch errors.
- **Fix:** Close the palette first and catch errors. Add error handling (and removal of missing folders from Recent) in `openWorkspace`. Make `openFile` safe against two quick opens.
- **Effort:** small

<a id="b16"></a>

#### ✅ B16 · [medium] Multi-word queries fail when typed in folder-then-name order ("docs readme" finds nothing)

- **Where:** `components/studio/command-palette/fuzzy-match.ts:38`
- **What happens:** Typing "docs readme" doesn't find `docs/readme.md`; only "readme docs" works.
- **Why:** The whole query, spaces included, must match in order against "name then path", and there's only one space in that text.
- **Fix:** Split the query into words, score each word against the text, require every word to match, and add up the scores. Add tests.
- **Effort:** small

<a id="b17"></a>

#### ✅ B17 · [medium] Recent Files lists deleted or renamed files; choosing one gives an 'Open failed' error

- **Where:** `components/studio/command-palette/use-palette-search.ts:166`
- **What happens:** A deleted or renamed file stays under Recent Files with its old name, and picking it shows an "Open failed" error.
- **Why:** The recent list is never cleaned up and isn't checked against the current files.
- **Fix:** Only show recents that still exist, update recents on rename and delete, remove an entry if it fails to open, and catch store errors.
- **Effort:** small

<a id="b18"></a>

#### ✅ B18 · [medium] On Windows, file results show the full absolute path and fuzzy search matches the workspace root folder names

- **Where:** `components/studio/command-palette/search-files.ts:9`
- **What happens:** Each file row shows a long path with mixed slashes, and typing letters that appear in your folder's path (like "doc") matches every file.
- **Why:** The relative-path helper picks one slash style, but Windows paths mix both, so it never strips the root.
- **Fix:** Normalise slashes (and letter case for drive paths) before comparing, and use relative paths for open tabs too. Add tests with mixed paths.
- **Effort:** trivial

<a id="b19"></a>

#### ✅ B19 · [medium] Open tabs are matched on their absolute path and always listed first, so Enter often opens the wrong file

- **Where:** `components/studio/command-palette/search-files.ts:37`
- **What happens:** A short query can highlight an unrelated open tab first, so pressing Enter opens the wrong file.
- **Why:** Tabs are matched on their full path (which includes the root folder name), and the tab group is always first.
- **Fix:** Match tabs on name plus relative path, show that path in the row, and optionally rank tabs and files together by score.
- **Effort:** trivial

<a id="b20"></a>

#### ✅ B20 · [medium] Hiding the editor or renaming the open file throws away its undo history and cursor/scroll position

- **Where:** `components/studio/shell/studio-layout.tsx:37`
- **What happens:** Press Ctrl+E twice (hide, show), use Preview Only and back, or rename the open file: Ctrl+Z does nothing and the view jumps to the top.
- **Why:** Hiding the editor unmounts it, which throws away its model. A rename gives the file a brand-new model.
- **Fix:** Keep the editor mounted and just hide it. Use a per-tab key that doesn't change on rename as the model path, and save and restore the view position.
- **Effort:** small

<a id="b21"></a>

#### ✅ B21 · [medium] Monaco puts warning boxes on ordinary Ukrainian, Russian, Greek and Chinese text (unicodeHighlight left at defaults)

- **Where:** `components/studio/editor/code-editor-panel.tsx:22`
- **What happens:** Normal Ukrainian, Russian, Greek and Chinese text, and even curly apostrophes and en dashes pasted from Word, get yellow "could be confused with" boxes.
- **Why:** The editor's code-oriented Unicode warnings are left on for prose.
- **Fix:** Turn off `ambiguousCharacters`, `invisibleCharacters` and `nonBasicASCII` in `unicodeHighlight` (optionally keep invisible characters flagged in `.mmd` files).
- **Effort:** trivial

<a id="b22"></a>

#### ✅ B22 · [medium] Cancelling the save picker, or a failed export, closes the export dialog and throws away the user's edits

- **Where:** `lib/markdown/export-pdf.ts:124` (and `components/studio/editor/pdf-export-dialog.tsx:66-74`)
- **What happens:** Change the Title in the export dialog, click Export, then press Cancel in the save box: the dialog closes and your changes are gone. The same happens after an error.
- **Why:** The export function doesn't report whether it saved, was cancelled or failed, so the dialog always closes.
- **Fix:** Return a status (saved, cancelled, failed). Close only on "saved", and show failures inside the dialog. Update the tests.
- **Effort:** small

<a id="b23"></a>

#### ✅ B23 · [medium] Clicks in the '...' row menu also fire the row's own click: folders collapse, and files get opened and added to recents

- **Where:** `components/studio/explorer/file-tree-node.tsx:59`
- **What happens:** On a folder, "..." > New Diagram collapses the folder, so the new file is hidden. On a file, "..." > Delete opens it in a tab first; pressing Cancel leaves that tab open.
- **Why:** The menu sits inside the row's button, and React passes menu clicks up to the row.
- **Fix:** Move the "..." menu out of the row button so it sits next to it. This also fixes the invalid button-inside-a-button markup.
- **Effort:** trivial

<a id="b24"></a>

#### ✅ B24 · [medium] Global shortcuts still fire while Settings or other modal dialogs are open

- **Where:** `components/studio/hooks/use-global-keybinds.ts:20`
- **What happens:** Ctrl+B or Ctrl+E rearranges the layout behind an open dialog, F1 opens the palette on top of Settings, and Ctrl+, jumps Settings back to General.
- **Why:** The shortcut handler only skips text fields; it never checks whether a modal dialog is open.
- **Fix:** Skip shortcuts while a modal is open or the event was already handled, pause them while recording a shortcut, and make "open settings" keep the current section.
- **Effort:** small

<a id="b25"></a>

#### ✅ B25 · [medium] A WebView2 renderer crash or JS hang leaves a blank frameless window that can't be closed

- **Where:** `src-tauri/src/lib.rs:21` (with `components/studio/hooks/use-window-close.ts:18`)
- **What happens:** If the web view crashes or freezes, the custom title bar disappears and Alt+F4 or taskbar Close does nothing. Only Task Manager can close it.
- **Why:** Once a folder is open, every close request is handed to the JavaScript handler, which is dead or frozen. Nothing handles a crashed web view.
- **Fix:** Handle WebView2's "process failed" event with a Reload / Quit dialog, and add a Rust watchdog that offers "Close anyway" if the page doesn't answer a close request within a few seconds.
- **Effort:** medium

<a id="b26"></a>

#### ✅ B26 · [medium] Expanded Markdown diagram is a frozen snapshot: edits don't update it and export uses old text

- **Where:** `components/studio/markdown/markdown-document-viewer.tsx:36`
- **What happens:** Edit a diagram block while its expanded view is open and the view doesn't change. Save PNG exports the old version.
- **Why:** The block's text is copied once when you click Expand.
- **Fix:** Read the expanded block's live text from the current Markdown, update the overlay when it changes, and close it if the block is deleted. Add a test.
- **Effort:** small

<a id="b27"></a>

#### ✅ B27 · [medium] Expanded Markdown diagram leaks into other tabs, and export saves the wrong diagram

- **Where:** `components/studio/markdown/markdown-expand-context.tsx:19`
- **What happens:** Expand a diagram in one file and switch to another: the second file shows the first file's diagram full screen, and Save SVG names it after the second file.
- **Why:** The expanded state isn't tied to a tab, so it survives tab switches.
- **Fix:** Store the owning tab id with the expanded block and treat it as empty on any other tab. Add a test.
- **Effort:** trivial

<a id="b28"></a>

#### ✅ B28 · [medium] Position-based block ids make diagrams show a neighbouring block's picture after inserting or deleting a block

- **Where:** `components/studio/markdown/markdown-preview.tsx:103` (plus the cache key in `components/studio/canvas/use-mermaid-svg.ts:15`)
- **What happens:** Delete the first diagram in a file and the second one briefly shows the deleted diagram. If the second one has a typo, the wrong picture stays.
- **Why:** Diagram blocks are identified only by their position, so after an insert or delete they pick up each other's cached pictures.
- **Fix:** Cache pictures by diagram text, and give blocks ids that follow them across edits instead of position counters. Add a test.
- **Effort:** medium

<a id="b29"></a>

#### ✅ B29 · [medium] Raw HTML (including `<br>`, `<details>`, `<kbd>` and comments) shows as literal text

- **Where:** `components/studio/markdown/markdown-preview.tsx:128` (plus `lib/markdown/markdown-to-export-html.ts:205` and `lib/markdown/export-docx.ts:673`)
- **What happens:** The app's own Markdown showcase prints its HTML tags and comments as text in the preview. The PDF drops them and Word prints them, so all three disagree.
- **Why:** No HTML plugin is used, so the preview turns raw HTML into plain text.
- **Fix:** Add `rehype-raw` plus `rehype-sanitize` with a strict allow-list to the preview and the PDF export, and make Word skip comments. The sanitiser is essential, because unsanitised HTML could reach the app's powerful commands.
- **Effort:** medium

<a id="b30"></a>

#### ✅ B30 · [medium] Component overrides drop attributes: ordered lists restart at 1, task lists show bullets plus checkboxes, link titles are lost

- **Where:** `components/studio/markdown/markdown-preview.tsx:51-67`
- **What happens:** A list that starts at 3 shows as 1, 2. A task list shows a bullet and a checkbox. Link tooltips and footnote links don't work.
- **Why:** The custom preview components keep only the content and drop every other attribute.
- **Fix:** Pass the remaining attributes through and merge class names, hide bullets on task lists, and keep footnote ids. Add a render test.
- **Effort:** small

<a id="b31"></a>

#### ✅ B31 · [medium] YAML front matter shows in the preview as a rule plus a big heading, while export uses it as metadata

- **Where:** `components/studio/markdown/markdown-preview.tsx:128`
- **What happens:** A file that starts with `---`, `title: Report`, `---` shows a line and a big heading made of those fields in the preview, though export hides it.
- **Why:** The preview has no front-matter handling.
- **Fix:** Run the same front-matter parser the export uses and render only the body. Optionally show the fields in a small header.
- **Effort:** trivial

<a id="b32"></a>

#### ✅ B32 · [medium] Recording a shortcut that's already in use also runs that action

- **Where:** `components/studio/settings/global-keybinds-provider.tsx:99`
- **What happens:** While recording a shortcut, pressing Ctrl+, jumps Settings to General, and Ctrl+Shift+O hides panels behind the dialog.
- **Why:** The app-wide shortcut listener runs before the recorder and acts on the key first.
- **Fix:** Turn app-wide shortcuts off while Settings is open (or while recording).
- **Effort:** trivial

<a id="b33"></a>

#### ✅ B33 · [medium] Shortcut recorder accepts Tab and plain letters, and stays in recording mode after a conflict, so Tab can get hijacked app-wide

- **Where:** `components/studio/settings/keybind-capture.tsx:30`
- **What happens:** After an "Already assigned" message, pressing Tab to move on binds the action to Tab. From then on Tab toggles the editor everywhere, including inside the editor, and keyboard users can't reach Reset.
- **Why:** The recorder accepts any key and keeps recording after a conflict.
- **Fix:** Refuse Tab, Enter, Escape and keys without a modifier (except F-keys), let Tab cancel recording, stop recording after a conflict, add a Cancel button, and filter out bad saved shortcuts on load.
- **Effort:** small

<a id="b34"></a>

#### ✅ B34 · [medium] No error boundary: any render error blanks the frameless window, title bar and close button included

- **Where:** `components/studio/shell/studio-shell.tsx:35`
- **What happens:** If any part of the screen crashes while drawing, you get an error page with no title bar or window buttons, and F5 is blocked. A damaged `workspace.json` can cause this on every launch.
- **Why:** There's no React error boundary, and the frameless title bar is part of the page.
- **Fix:** Add an error boundary with its own small title bar and Reload / Reset buttons, add `app/global-error.tsx`, and check stored lists contain only text.
- **Effort:** small

<a id="b35"></a>

#### ✅ B35 · [medium] Renaming a folder that contains the active file leaves no tab active

- **Where:** `components/studio/workspace/document-tabs-context.tsx:97`
- **What happens:** Rename the folder that holds the open file and the editor and preview go blank until you click the tab again.
- **Why:** The active tab is only updated when the renamed path is the file itself, not a parent folder.
- **Fix:** Update the active tab id with the same parent-folder logic used for the tabs. Add a test.
- **Effort:** trivial

<a id="b36"></a>

#### ✅ B36 · [medium] No loading state when opening a folder; rapid clicks can open the wrong folder

- **Where:** `components/studio/workspace/workspace-session-context.tsx:83`
- **What happens:** Click a large recent folder, see nothing happen, then click a small one: the small one opens, and seconds later the big one replaces it.
- **Why:** Opening a folder shows no busy state and doesn't check for overlapping requests.
- **Fix:** Give each open request an id so only the latest one wins, show a spinner and disable the buttons while opening, and catch errors.
- **Effort:** small

<a id="b37"></a>

#### ✅ B37 · [medium] The colour picker's square picks a different colour than the one under the cursor

- **Where:** `components/ui/color-picker.tsx:64`
- **What happens:** Clicking a bright pink in the colour square gives a duller greyish pink, and the swatch doesn't match where you clicked.
- **Why:** The square is drawn using one colour model (HSV) but clicks are converted as if it used another (HSL).
- **Fix:** Convert the click position from HSV to HSL (and back again for the thumb position). Update the tests.
- **Effort:** small

<a id="b38"></a>

#### ✅ B38 · [medium] Any open modal covers the custom titlebar, so the window can't be moved, minimised, maximised or closed (clicks close the dialog instead)

- **Where:** `components/studio/shell/studio-shell.tsx:20`
- **What happens:** With Settings open, clicking Minimise, Maximise, Close or dragging the title bar just closes Settings. With a confirm dialog or update install open, those clicks do nothing at all.
- **Why:** Dialog backgrounds are full-screen layers drawn above the title bar.
- **Fix:** Stop the shell wrapper creating its own layer, raise the title bar above dialogs (`z-[60]`), and block only the menus while a dialog is open. Optionally stop the export dialog closing mid-export.
- **Effort:** small

<a id="b39"></a>

#### ✅ B39 · [medium] Default code font becomes 'Menlo', which Windows doesn't have, so code is not monospaced in Word

- **Where:** `lib/markdown/export-docx.ts:121`
- **What happens:** Code in Word exports isn't fixed-width on Windows, so columns don't line up.
- **Why:** The first usable name in the default font list is Menlo, a Mac-only font.
- **Fix:** Skip Mac-only fonts when choosing the Word font, so the default becomes Consolas. Update the test.
- **Effort:** small

<a id="b40"></a>

#### ✅ B40 · [medium] Header/footer left text ignores the profile's 'Font colour'; only the right side uses it

- **Where:** `lib/markdown/export-docx.ts:759`
- **What happens:** With a dark header bar and white text, the left label in Word is dark grey and can't be read.
- **Why:** The left side is built without the colour that the right side uses.
- **Fix:** Build the left text with the same colour helper. Optionally match the PDF's size and default colour. Add a test.
- **Effort:** trivial

<a id="b41"></a>

#### ✅ B41 · [medium] Semi-transparent colours (#rrggbbaa) from the colour picker are dropped in Word: headings, links and bars fall back to defaults

- **Where:** `lib/markdown/export-docx.ts:130`
- **What happens:** Lower a colour's opacity slider and Word headings and links turn grey and header bars vanish, while the PDF looks right.
- **Why:** The Word colour helper only accepts 3- or 6-digit hex, and the picker saves 8 digits.
- **Fix:** Accept 4- and 8-digit hex and blend the colour onto white. Add tests.
- **Effort:** trivial

<a id="b42"></a>

#### ✅ B42 · [medium] Watermark image is clipped for anything longer than about 8 characters and is stretched out of shape

- **Where:** `lib/markdown/export-docx.ts:249` (createWatermarkPng) and `:815` (placement)
- **What happens:** "CONFIDENTIAL" comes out with letters cut off at both ends, squashed, and darker than in the PDF.
- **Why:** The text is drawn on a fixed-size canvas that's too small for long tilted text, then placed in a box of a different shape.
- **Fix:** Size the canvas to the measured tilted text, keep its shape when placing it, and match the PDF's opacity and font. Add a test.
- **Effort:** small

<a id="b43"></a>

#### ✅ B43 · [medium] SVG and WebP logos and header/footer images, which Settings offers, silently disappear from Word exports

- **Where:** `lib/markdown/export-docx.ts:1321` (also `:146`)
- **What happens:** An SVG logo shows in the PDF but is missing from the Word file, with no warning.
- **Why:** Word export only recognises PNG, JPEG, GIF and BMP.
- **Fix:** Convert SVG and WebP images to PNG with a canvas before export (optionally keep the SVG with a PNG fallback), and warn if conversion fails.
- **Effort:** small

<a id="b44"></a>

#### ✅ B44 · [medium] DOCX flattens blocks nested in lists and quotes: code, tables and quotes lose their indent and quote border

- **Where:** `lib/markdown/export-docx.ts:543` (also `:562`, `:363`, `:490`, `:567`, `:616`)
- **What happens:** In Word, code blocks and tables inside numbered steps sit at the page margin, and nested quotes lose their indent and border.
- **Why:** Only paragraphs inside lists and quotes get the extra indent and border.
- **Fix:** Track extra indent and quote depth while rendering and apply them to every nested block, including tables and images. Add tests.
- **Effort:** small

<a id="b45"></a>

#### ✅ B45 · [medium] In Word, 'Ignore margins' sets the whole document's page margins to zero; footnotes then run to the paper edge

- **Where:** `lib/markdown/export-docx.ts:1254` (stopgap at `:678`)
- **What happens:** With a header set to ignore margins, footnotes (and anything you later type in Word) start at the very edge of the paper.
- **Why:** The side margins are set to zero and faked with indents, which footnotes don't get.
- **Fix:** Keep the real side margins and use a negative table indent so only the header and footer bars reach the edge. Stopgap: indent footnotes.
- **Effort:** small

<a id="b46"></a>

#### ✅ B46 · [medium] Mermaid diagrams show at twice their PDF size in Word, and tall diagrams get squeezed to 480px

- **Where:** `lib/markdown/export-docx.ts:651`
- **What happens:** Small diagrams appear twice as big in Word as in the PDF, and tall sequence diagrams shrink until their text is tiny.
- **Why:** The size comes from the double-resolution PNG, and it's capped at a fixed 640 by 480 pixels.
- **Fix:** Store the diagram's natural size, keep the PNG sharp, and cap the size at the real page content width and height. Use the same size in the TOC page estimate. Add a test.
- **Effort:** small

<a id="b47"></a>

#### ✅ B47 · [medium] Static TOC page numbers are guesses and drift; local or remote images add about 53mm of height each that doesn't exist

- **Where:** `lib/markdown/export-docx.ts:1057` (and `:1220`)
- **What happens:** The Word Contents page points to the wrong pages, especially in documents with screenshots linked by path or URL.
- **Why:** Page numbers are estimates typed in as plain text, and every image that can't be embedded is counted as a 200-pixel-tall picture even though Word shows one line of alt text.
- **Fix:** Measure images that can't be embedded as their alt text, and write page numbers as Word page-reference fields with the estimate as the stored value, so Word can correct them. Add tests that check page numbers.
- **Effort:** small

<a id="b48"></a>

#### ✅ B48 · [medium] Title page is not vertically centred in Word with the default (no header/footer) profile

- **Where:** `lib/markdown/export-docx.ts:1284`
- **What happens:** The cover title sits at the top of the first page in Word, while the PDF centres it.
- **Why:** The title section is merged with the next section, which switches off centring.
- **Fix:** Don't merge into the title section when it needs centring (leave the full-bleed logo case alone). Add a test.
- **Effort:** trivial

<a id="b49"></a>

#### ✅ B49 · [medium] Table rows with fewer cells than the header come out ragged in Word

- **Where:** `lib/markdown/export-docx.ts:585`
- **What happens:** A table row that leaves out its last cells ends early in Word, so the table looks broken. Rows with extra cells go past the grid.
- **Why:** Each Word row is built from the cells it actually has, not from the column count.
- **Fix:** Pad or trim every row to the column count, the same way the PDF does. Add a test.
- **Effort:** trivial

<a id="b50"></a>

#### ✅ B50 · [medium] Footnotes are flattened: link URLs, bold/italic, code and paragraph breaks are lost (paragraphs run together)

- **Where:** `lib/markdown/export-docx.ts:675-679`
- **What happens:** A citation footnote like "See RFC 9110 (link)" shows "See RFC 9110" with no link in Word, formatting is lost, and paragraphs run together.
- **Why:** Footnotes are squashed into one plain text run.
- **Fix:** Render footnotes with the normal text and paragraph renderers at a smaller size. Add a test with a link and two paragraphs.
- **Effort:** small

<a id="b51"></a>

#### ✅ B51 · [medium] Word TOC page numbers come out far too low for Chinese/Japanese/Korean documents

- **Where:** `lib/markdown/export-docx.ts:1049` (and `:1220`)
- **What happens:** In a long Japanese document, the Contents lists later headings several pages too early.
- **Why:** The height estimate treats every character as half a letter wide, but CJK characters are full width. The numbers are plain text, so Word can't fix them.
- **Fix:** Count CJK and emoji characters as full width in the estimate, and write the numbers as page-reference fields. Add tests.
- **Effort:** small

<a id="b52"></a>

#### ✅ B52 · [medium] Heading sizes ignore the Body size setting; h3/h4 can print smaller than body text

- **Where:** `lib/markdown/export-html-css.ts:244`
- **What happens:** With a 16pt body size, level 2 to 4 headings print smaller than the paragraphs. Level 5 and 6 headings are smaller than body text even at the default size.
- **Why:** Headings use fixed sizes tied to 16px instead of the body size, and h5/h6 have no rule at all.
- **Fix:** Size headings and code relative to the body (`em`), add h5/h6 rules, and scale Word heading sizes by the body size too. Add a test.
- **Effort:** small

<a id="b53"></a>

#### ✅ B53 · [medium] Table column alignment (:-: and --:) is lost in the PDF

- **Where:** `lib/markdown/export-html-css.ts:280`
- **What happens:** Right-aligned and centred table columns print left-aligned in the PDF, though the preview and Word get them right.
- **Why:** A stylesheet rule setting left alignment beats the table's alignment attribute.
- **Fix:** Change the base rule to `text-align: start` and add rules for each alignment value (or turn the attribute into an inline style). Add a test.
- **Effort:** trivial

<a id="b54"></a>

#### ✅ B54 · [medium] A mermaid diagram taller than a page wastes a blank page, is sliced through nodes, and covers the footer

- **Where:** `lib/markdown/export-html-css.ts:338`
- **What happens:** A long vertical flowchart leaves a blank page, then gets cut through its boxes across several pages and covers the footer text.
- **Why:** Diagrams are told never to split but have no height limit, so they can't fit anywhere.
- **Fix:** Add a print max-height for diagrams based on the usable page height so they shrink to one page. Fix the invalid `<p><div>` nesting. Use the page height (not 480px) as the cap in Word too.
- **Effort:** small

<a id="b55"></a>

#### ✅ B55 · [medium] Heading anchors drop non-ASCII letters, so internal links like `[x](#résumé)` don't work in Word (or the PDF)

- **Where:** `lib/markdown/export-outline.ts:10-21` (also `lib/markdown/export-docx.ts:441`)
- **What happens:** A link to a heading like "Résumé", or a GitHub-style link to "Setup & Install", does nothing when clicked in the exported file.
- **Why:** The heading-id function removes every non-English letter and merges dashes differently from GitHub, so links point at ids that don't exist.
- **Fix:** Use GitHub's id rules (keep Unicode letters, one dash per space, numbered duplicates), and in Word match link targets against the real heading ids. Update tests.
- **Effort:** small

<a id="b56"></a>

#### ✅ B56 · [medium] Shortcuts are matched on event.key, so they fail on non-Latin keyboard layouts and show odd symbols with Shift

- **Where:** `lib/settings/match-keybind.ts:11`
- **What happens:** With a Russian, Ukrainian, Greek, Hebrew or Arabic keyboard layout active, Ctrl+S, Ctrl+B, Ctrl+, and the other shortcuts do nothing. Ctrl+Shift+1 is shown as "Ctrl+Shift+!".
- **Why:** Shortcuts compare the typed character, which changes with the layout, instead of the physical key.
- **Fix:** When the typed key isn't plain English text, fall back to the physical key code, and record the physical key for Shift shortcuts. Add tests, including one that Dvorak still works.
- **Effort:** small

<a id="b57"></a>

#### ✅ B57 · [medium] Global shortcut guard does not recognise Monaco: shortcuts are skipped inside the editor on WebKit, and on WebView2 they can steal editor keys

- **Where:** `lib/settings/match-keybind.ts:5`
- **What happens:** On macOS or Linux builds, Cmd+S does nothing while you type in the editor. On Windows, a custom shortcut like Ctrl+D overrides the editor's own command.
- **Why:** The "typing in a text field" check only knows inputs, textareas and selects, and the editor uses a different element depending on the browser engine.
- **Fix:** Treat anything inside `.monaco-editor` specially: allow shortcuts with Ctrl/Cmd or F-keys, block bare keys. Require a modifier when recording, and warn about clashes with the editor's own keys.
- **Effort:** small

<a id="b58"></a>

#### ✅ B58 · [medium] You can't type a space at the end of a profile name, and you can't clear the field

- **Where:** `components/studio/settings/sections/pdf-export-settings.tsx:168`
- **What happens:** Typing "Client Report" gives "ClientReport", and pressing Backspace leaves the field stuck on the first letter.
- **Why:** Every keystroke is trimmed and saved straight away, and empty names are refused.
- **Fix:** Keep a local draft in the box, save only trimmed non-empty names, and restore the last good name on blur. Add a test.
- **Effort:** small

<a id="b59"></a>

#### ✅ B59 · [medium] File operation errors are silent, and Windows-invalid names (CON, AUX, NUL, trailing dots) aren't rejected

- **Where:** `lib/workspace/paths.ts:3` (and `components/studio/workspace/workspace-session-context.tsx:145-222`)
- **What happens:** New Folder "aux" silently fails. New Folder "drafts." creates "drafts", while open tabs track "drafts.", so tabs and the tree disagree.
- **Why:** Name checks miss Windows reserved names and trailing dots, and file errors are swallowed.
- **Fix:** Refuse reserved names, trailing dots or spaces and names over 255 characters, and show file errors as in B06. Add tests.
- **Effort:** small

<a id="b60"></a>

#### ✅ B60 · [medium] No single-instance lock: a second window overwrites the first window's recents, sessions and files

- **Where:** `src-tauri/src/lib.rs:22`
- **What happens:** Launching Scrivon twice means each window overwrites the other's recent folders and saved tabs. If both open the same folder, they also overwrite each other's files.
- **Why:** Each running copy keeps its own copy of `workspace.json` and rewrites the whole file.
- **Fix:** Add `tauri-plugin-single-instance` so a second launch focuses the existing window (and passes on any file path).
- **Effort:** small

<a id="b61"></a>

#### ✅ B61 · [medium] Custom page-number labels with non-Latin text come out as '?'

- **Where:** `src-tauri/src/page_numbers.rs:1067` (with `:974-1000`, `:139-157`, and `lib/markdown/markdown-to-export-html.ts:127`)
- **What happens:** A footer like "{{title}} — {{page}}/{{total}}" with a Cyrillic or Chinese title prints question marks on every page.
- **Why:** The page-number stamper draws labels in a basic Helvetica font that only covers Western European characters.
- **Fix:** Reuse the font the browser already embedded for the footer when every character is available, falling back to Helvetica; or embed a Unicode font. At least warn in settings. Add a test.
- **Effort:** medium

<a id="b62"></a>

#### ✅ B62 · [medium] Stamper silently skips page numbers on every body page when their footer slot is missing but a TOC page had one

- **Where:** `src-tauri/src/page_numbers.rs:1090`
- **What happens:** With a table of contents and page numbers on, one very wide URL or table means the TOC pages get numbers but the body pages don't, with no error.
- **Why:** Any page without the hidden footer marker is assumed to be hidden on purpose.
- **Fix:** Fix the wide-content layout (B08), add an explicit "hidden on purpose" marker, use the fallback position (with the real margins) otherwise, and warn. Add tests.
- **Effort:** medium

<a id="b63"></a>

#### ✅ B63 · [medium] Failed update install is silent and can't be retried

- **Where:** `src-tauri/src/updater.rs:70`
- **What happens:** If the download fails (for example the Wi-Fi drops), the button just goes back to normal with no message. Clicking again always fails silently until you restart.
- **Why:** The pending update is removed before the download starts, and errors only go to the console.
- **Fix:** Copy the pending update instead of removing it, clear it only after success, and show the error in the dialog with a Retry button.
- **Effort:** small

<a id="b64"></a>

#### ✅ B64 · [low] 'Loading release notes…' can get stuck forever if the update setting is toggled mid-fetch

- **Where:** `components/studio/app-update-provider.tsx:58-66`
- **What happens:** If you switch off "Check for updates on launch" while release notes are loading, the update dialog shows "Loading release notes…" forever.
- **Why:** The loading flag is only cleared if the effect wasn't cancelled.
- **Fix:** Always clear the loading flag, or fetch notes in a separate effect keyed on the update version.
- **Effort:** trivial

<a id="b65"></a>

#### ✅ B65 · [low] Upper-case .MD files show the diagram icon in Open Editors and Text results

- **Where:** `components/studio/command-palette/command-palette-dialog.tsx:73`
- **What happens:** README.MD shows a diagram icon under Open Editors but a document icon under Files.
- **Why:** That icon check is case-sensitive while the rest of the app isn't.
- **Fix:** Use `documentKind()` to pick the icon.
- **Effort:** trivial

<a id="b66"></a>

#### ✅ B66 · [low] Disabled commands can be highlighted but Enter silently does nothing, and their 'why disabled' tooltip can never appear

- **Where:** `components/studio/command-palette/command-palette-dialog.tsx:63`
- **What happens:** A greyed-out command can be selected, but Enter does nothing and you never see why it's disabled.
- **Why:** The reason is only in a hover tooltip, and disabled rows ignore the mouse.
- **Fix:** Show the reason as text on the row, and list disabled commands after enabled ones.
- **Effort:** small

<a id="b67"></a>

#### ✅ B67 · [low] 'Open Example' commands do nothing visible when no folder is open

- **Where:** `components/studio/command-palette/command-registry.ts:184`
- **What happens:** On the welcome screen, picking an example from the palette closes the palette and nothing appears.
- **Why:** Example tabs can only be shown inside the folder view, and the tab is thrown away when a folder opens.
- **Fix:** Disable example commands when no folder is open ("Open a folder first"), or let the welcome screen show examples.
- **Effort:** trivial

<a id="b68"></a>

#### ✅ B68 · [low] Search treats differently-encoded but identical accented text as different (no Unicode normalization)

- **Where:** `components/studio/command-palette/fuzzy-match.ts:5`
- **What happens:** Korean or accented file names that came from a Mac can't be found by typing them on Windows, even though they look identical.
- **Why:** The same letter can be stored in two ways, and search doesn't convert them to one form first.
- **Fix:** Normalise text and queries to NFC in both fuzzy and content search, keeping the original positions for highlighting. Add tests.
- **Effort:** small

<a id="b69"></a>

#### ✅ B69 · [low] Workspace text search breaks on Turkish İ and Greek final sigma: missed matches, wrong cursor column, wrong highlight

- **Where:** `components/studio/command-palette/search-content.ts:35`
- **What happens:** In Turkish text, matches after a capital İ get the wrong column and highlight, and jumping to them lands inside the word. Some Greek searches miss.
- **Why:** Lowercasing İ makes the text longer, so positions found in the lowercased copy don't line up with the original.
- **Fix:** Search the original line with a case-insensitive Unicode pattern, and use the stored match position for the preview highlight and editor selection. Add tests.
- **Effort:** small

<a id="b70"></a>

#### ✅ B70 · [low] Text hit order is random between runs, and one file can take all 100 result slots

- **Where:** `components/studio/command-palette/search-content.ts:57-88` (and `:127`, `:146`)
- **What happens:** The same search lists files in a different order each time, and one file with many matches can hide every other file.
- **Why:** Results are added in whatever order the file reads finish, and each file can use the whole result budget.
- **Fix:** Collect results by file position so order is stable, and cap hits per file (for example 10). Add a test.
- **Effort:** small

<a id="b71"></a>

#### ✅ B71 · [low] Search and path truncation cut emoji in half, leaving '�' at the edges

- **Where:** `components/studio/command-palette/search-content.ts:22` (also `components/studio/shell/welcome-screen.tsx:11-12`)
- **What happens:** Search previews of emoji-heavy lines, and shortened paths on the welcome screen, can show broken-character boxes at the edges.
- **Why:** Text is cut at raw positions that can fall in the middle of an emoji.
- **Fix:** Move cut points to whole-character boundaries in a small shared helper. Add tests.
- **Effort:** small

<a id="b72"></a>

#### ✅ B72 · [low] File names with %XX sequences share one Monaco model (Uri.parse percent-decodes)

- **Where:** `components/studio/editor/code-editor-panel.tsx:139`
- **What happens:** With "report%20v2.md" and "report v2.md" in the same folder, opening the second shows the first file's text, and typing saves it into the second file.
- **Why:** The editor's model key decodes `%20` into a space, so the two paths become the same key.
- **Fix:** Build the model path by encoding the tab id into a custom URI, so every file path gets its own model. Add a test.
- **Effort:** trivial

<a id="b73"></a>

#### ✅ B73 · [low] Theme changed while Monaco is still loading leaves the editor in the old theme

- **Where:** `components/studio/editor/code-editor-panel.tsx:167`
- **What happens:** Switch between light and dark before the editor first appears and it shows up in the old theme.
- **Why:** The editor library keeps the first version of the setup callback, which holds the old theme colours.
- **Fix:** Read the theme from a ref and apply it again when the editor mounts.
- **Effort:** trivial

<a id="b74"></a>

#### ✅ B74 · [low] Closing the dialog mid-export allows a parallel export, and the old export later closes the new dialog

- **Where:** `components/studio/editor/pdf-export-dialog.tsx:23-74` (with `components/studio/editor/document-export-menu.tsx:36-58`)
- **What happens:** Press Esc during an export, reopen the dialog and start typing: when the first export finishes, it closes your new dialog.
- **Why:** The busy state lives inside the form, closing isn't blocked, and the old export calls the shared close function.
- **Fix:** Move the busy state up to the export menu, block closing while exporting, and show a spinner.
- **Effort:** small

<a id="b75"></a>

#### ✅ B75 · [low] The window-close listener can be registered twice

- **Where:** `components/studio/hooks/use-window-close.ts:15`
- **What happens:** In development, clicking X saves every unsaved tab twice in parallel.
- **Why:** The cleanup can run before the listener is registered, so it can't remove it.
- **Fix:** Track a "disposed" flag and remove the listener straight away if cleanup already ran. Add a test.
- **Effort:** trivial

<a id="b76"></a>

#### ✅ B76 · [low] Bold and italic in Chinese/Japanese Markdown break when the marker touches CJK punctuation (preview, PDF and DOCX)

- **Where:** `components/studio/markdown/markdown-preview.tsx:30` and `lib/markdown/export-document.ts:52`
- **What happens:** Text like `**「重要」**です` shows stray asterisks or bolds the wrong parts, in the preview and in exports.
- **Why:** Standard Markdown rules don't treat CJK punctuation as word edges.
- **Fix:** Add the `remark-cjk-friendly` plugins through one shared plugin list used by both the preview and the export. Add a test.
- **Effort:** small

<a id="b77"></a>

#### ✅ B77 · [low] AltGr, CapsLock and other modifier keys get recorded as shortcuts

- **Where:** `components/studio/settings/keybind-capture.tsx:15`
- **What happens:** On a German or French keyboard, pressing AltGr while recording saves a meaningless "Ctrl+Alt+AltGraph" shortcut straight away.
- **Why:** Only Shift, Control, Alt and Meta are ignored while recording.
- **Fix:** Ignore a fuller list of modifier and lock keys (AltGraph, CapsLock, NumLock, dead keys, IME input). Add a test.
- **Effort:** trivial

<a id="b78"></a>

#### ✅ B78 · [low] Number settings apply clamped half-typed values on every keystroke, accept decimals, and have odd Shift/Alt steps

- **Where:** `components/studio/settings/number-setting.tsx:30` (also `components/studio/settings/sections/general-settings.tsx:33`)
- **What happens:** Typing 16 into Font size briefly sets it to 8. Tab size 2.5 is saved while the editor uses 2. Shift+Arrow on Autosave delay moves by 10 instead of 100.
- **Why:** Values are saved on every keystroke after being clamped, decimals aren't rounded, and the step sizes are left at defaults.
- **Fix:** Save when you finish (blur, Enter, buttons), round to the step, set sensible small and large steps, and round stored values on load.
- **Effort:** small

<a id="b79"></a>

#### ✅ B79 · [low] Resetting one shortcut can silently create a duplicate, and existing conflicts are never shown

- **Where:** `components/studio/settings/settings-provider.tsx:142`
- **What happens:** After clearing and reassigning shortcuts, pressing Reset can leave two actions on Ctrl+E, and one of them silently stops working.
- **Why:** Reset doesn't check for clashes, and the Keyboard page never shows existing duplicates.
- **Fix:** Check for clashes on reset and show an error, and highlight duplicate shortcuts on the Keyboard page. Add tests.
- **Effort:** small

<a id="b80"></a>

#### ✅ B80 · [low] Recent folder names: drive roots show blank, labels can't tell same-named folders apart, truncation can split emoji

- **Where:** `lib/tauri/fs.ts:101`
- **What happens:** A whole drive opened as a folder (like E:\) shows with no name, and two folders both called "docs" look identical in Open Recent.
- **Why:** The "base name" of a drive root is empty, and menus show only base names.
- **Fix:** Return the full path for drive roots, show the parent folder when names clash, and add "Clear Recently Opened". Add tests.
- **Effort:** small

<a id="b81"></a>

#### ✅ B81 · [low] Turning autosave back on does not save tabs that are already dirty

- **Where:** `components/studio/workspace/document-save-context.tsx:50`
- **What happens:** Turn autosave on after editing with it off, and those tabs stay unsaved until you type in them again.
- **Why:** Switching autosave on doesn't schedule saves for tabs that already have changes.
- **Fix:** When autosave turns on, schedule a save for every unsaved tab. Add a test.
- **Effort:** trivial

<a id="b82"></a>

#### ✅ B82 · [low] Opening a file has no guard against overlapping opens, so a double-click on a slow file creates two identical tabs

- **Where:** `components/studio/workspace/document-tabs-context.tsx:138`
- **What happens:** Double-clicking a large file on a slow or network drive opens two identical tabs, and both come back on every launch.
- **Why:** The "is it already open?" check happens before the file read, and the tab is added after it without checking again.
- **Fix:** Track files that are being opened, add the tab with a duplicate check, and remove duplicates when saving and restoring sessions. Add a test.
- **Effort:** small

<a id="b83"></a>

#### ✅ B83 · [low] Store write failures show a false 'Open failed' error or become unhandled promise rejections

- **Where:** `components/studio/workspace/document-tabs-context.tsx:73`
- **What happens:** If `workspace.json` can't be written (disk full, file locked), opening a file shows "Open failed" even though the tab did open.
- **Why:** Saving the tab session sits inside the same error block as reading the file.
- **Fix:** Make session and recents saves best-effort (log, don't fail), and only treat read errors as "Open failed".
- **Effort:** trivial

<a id="b84"></a>

#### ✅ B84 · [low] Example titles become file names; 17 of 85 contain characters Windows rejects, and 'CI/CD Pipeline' is suggested as 'CD Pipeline.svg' in a folder named 'CI'

- **Where:** `lib/mermaid/export.ts:11`
- **What happens:** Exporting the "CI/CD Pipeline" example suggests "CD Pipeline.svg", and titles with characters like `:` `<` `>` `|` `*` are rejected by the Windows save box until you rename them.
- **Why:** Example titles are used as file names without removing characters Windows doesn't allow.
- **Fix:** Add a `toSafeFileStem` helper (replace bad characters, avoid reserved names) and use it for all export file names. Add tests.
- **Effort:** small

<a id="b85"></a>

#### ✅ B85 · [low] Leading indented code block is turned into a paragraph

- **Where:** `lib/markdown/export-document.ts:47-52`
- **What happens:** A file that starts with a 4-space indented code block exports it as normal paragraph text.
- **Why:** The text is trimmed before parsing, which removes the first line's indent.
- **Fix:** Parse the untrimmed text and use trimming only to check for an empty document. Add a test.
- **Effort:** trivial

<a id="b86"></a>

#### ✅ B86 · [low] Inline code in headings drops to body size

- **Where:** `lib/markdown/export-docx.ts:387`
- **What happens:** In Word, a heading like "## `useState()`" has its code part shrunk to body size, so it looks wrong.
- **Why:** Code size is based on the body size rather than the heading around it.
- **Fix:** Base code size on the surrounding heading size. Add a test.
- **Effort:** trivial

<a id="b87"></a>

#### ✅ B87 · [low] Blank or stray page before the first heading when 'New page from heading' is on and the document starts with a link definition or comment

- **Where:** `lib/markdown/export-docx.ts:665`
- **What happens:** With "New page from heading" and a title page on, a file that starts with link definitions gets an empty page between the cover and the content in Word.
- **Why:** The "is this the first block?" check counts items that produce no output.
- **Fix:** Check whether anything has been output yet, and skip HTML comments. Add a test.
- **Effort:** trivial

<a id="b88"></a>

#### ✅ B88 · [low] An image with no alt text and an unsupported data: URL dumps the whole base64 string into the document

- **Where:** `lib/markdown/export-docx.ts:417`
- **What happens:** An embedded SVG or WebP image with no alt text puts pages of encoded text into the Word file.
- **Why:** When an image can't be embedded, the fallback text is the image address itself.
- **Fix:** Never print an embedded-data address; show "[image]" instead. Add a test.
- **Effort:** trivial

<a id="b89"></a>

#### ✅ B89 · [low] Code highlighting failure aborts the whole Word export (the PDF falls back to plain code)

- **Where:** `lib/markdown/export-docx.ts:1317`
- **What happens:** If code highlighting fails, Word export fails entirely (and keeps failing until restart), while PDF export still works.
- **Why:** There's no error handling around highlighting, and a failed highlighter start is cached.
- **Fix:** Fall back to plain uncoloured code on error, and clear the cached failure so it can retry. Add a test.
- **Effort:** trivial

<a id="b90"></a>

#### ✅ B90 · [low] Table columns are always equal width, so narrow columns waste space and wide text wraps heavily

- **Where:** `lib/markdown/export-docx.ts:579`
- **What happens:** A short "ID" column and a long "Description" column get the same width in Word, so the description wraps into many lines.
- **Why:** Column widths are split evenly with a fixed layout.
- **Fix:** Weight column widths by content length (with sensible limits), use the same widths in the page estimate, and cap images in cells to the cell width. Add a test.
- **Effort:** small

<a id="b91"></a>

#### ✅ B91 · [low] List details lost: ordered task lists lose their numbers, '0.' lists start at 1, nested bullets all use '•'

- **Where:** `lib/markdown/export-docx.ts:516`
- **What happens:** In Word, a numbered checklist loses its numbers, a list starting at 0 starts at 1, and nested bullets all look the same.
- **Why:** Task items skip numbering, start values of 0 or 1 are ignored, and one bullet character is used for every level.
- **Fix:** Keep numbers on ordered task items, pass a start of 0 through, and vary the bullet by depth (•, ◦, ▪). Add tests.
- **Effort:** trivial

<a id="b92"></a>

#### ✅ B92 · [low] Duplicate reference-link definitions: Word uses the last one, markdown and the PDF use the first

- **Where:** `lib/markdown/export-docx.ts:432` (and `:418-419`)
- **What happens:** A reference link defined twice points to different URLs in Word and PDF. Reference-style images never embed in Word.
- **Why:** Later definitions overwrite earlier ones, and reference images are never looked up.
- **Fix:** Keep the first definition (the Markdown rule) and look up reference images like normal ones. Add tests.
- **Effort:** trivial

<a id="b93"></a>

#### ✅ B93 · [low] Word export never marks paragraphs or runs as right-to-left (no w:bidi / w:rtl / bidiVisual)

- **Where:** `lib/markdown/export-docx.ts:457`
- **What happens:** Arabic and Hebrew documents open in Word laid out left-to-right, with punctuation and list markers on the wrong side.
- **Why:** No paragraph, text or table direction is ever set.
- **Fix:** Detect right-to-left text and set the matching paragraph, text and table direction options. Add a test. (The whole app lacks RTL support; see B97.)
- **Effort:** small

<a id="b94"></a>

#### ✅ B94 · [low] Word export puts a Latin-only font in the East Asian slot, so CJK text falls back to whatever Word picks

- **Where:** `lib/markdown/export-docx.ts:334`
- **What happens:** Chinese and Japanese text in Word shows in a substitute font chosen by Word, often a serif one, so it looks different from the PDF.
- **Why:** The same Latin font name (like Segoe UI) is written into every font slot, including the East Asian one.
- **Fix:** Put a proper CJK font (Yu Gothic, Microsoft YaHei or Malgun Gothic, picked from the text) in the East Asian slot. Add a test.
- **Effort:** small

<a id="b95"></a>

#### ✅ B95 · [low] Custom footer with {{title}}: reserved width ignores the title, and non-Latin titles print as '???'

- **Where:** `lib/markdown/export-html-css.ts:167` (with `lib/markdown/export-metadata.ts:17-32`, `lib/markdown/markdown-to-export-html.ts:121-128`)
- **What happens:** The page-number area can overlap the left footer text, and a non-Latin title prints as question marks.
- **Why:** The title isn't counted in the reserved width, and the whole label is sent to the Helvetica page-number stamper.
- **Fix:** Send only the page-counter part to the stamper and render the rest as normal footer text. Update tests.
- **Effort:** small

<a id="b96"></a>

#### ✅ B96 · [low] Watermark text containing `</style>` breaks the export HTML

- **Where:** `lib/markdown/export-html-css.ts:151`
- **What happens:** A watermark containing `</style>` prints raw CSS text at the top of the PDF.
- **Why:** The watermark text is only partly escaped before it goes into the stylesheet.
- **Fix:** Also escape `<` and line breaks in CSS strings. Add a test.
- **Effort:** trivial

<a id="b97"></a>

#### ✅ B97 · [low] Arabic and Hebrew content renders left-to-right in the preview and PDF (no dir="auto", physical CSS)

- **Where:** `lib/markdown/markdown-to-export-html.ts:206` (also `lib/markdown/export-html-css.ts:250-280`, `components/studio/markdown/markdown-preview.tsx:51-85`)
- **What happens:** Arabic or Hebrew paragraphs are left-aligned, with the full stop and list bullets on the wrong side.
- **Why:** No text direction is set anywhere, and the CSS uses fixed left/right sides.
- **Fix:** Add `dir="auto"` to text blocks in the preview and export, and switch the CSS to start/end sides. Add a test.
- **Effort:** small

<a id="b98"></a>

#### ✅ B98 · [low] {{date}} is blank unless a date is entered; {{author}}/{{subtitle}} aren't supported; '{{ title }}' with spaces isn't replaced

- **Where:** `lib/markdown/export-metadata.ts:9`
- **What happens:** Header text "Generated {{date}}" prints just "Generated", `{{ title }}` with spaces stays as literal text, and author and subtitle can't be used.
- **Why:** Only two exact placeholders are replaced, and the date has no default.
- **Fix:** Replace title, subtitle, author and date with one pattern that allows spaces, and default the date to today in headers and footers. Update the help text and add tests.
- **Effort:** small

<a id="b99"></a>

#### ✅ B99 · [low] Clearing Subtitle, Author or Date in the export dialog doesn't remove the front-matter value

- **Where:** `lib/markdown/export-metadata.ts:78`
- **What happens:** Clear Author in the export dialog and the cover still shows the author from the file's front matter.
- **Why:** An empty dialog value is treated as "not set" and falls back to the front matter.
- **Fix:** Treat any value from the dialog, even an empty one, as the value to use. Add a test.
- **Effort:** trivial

<a id="b100"></a>

#### ✅ B100 · [low] Default title comes from code comments and keeps raw Markdown symbols

- **Where:** `lib/markdown/export-metadata.ts:60-62`
- **What happens:** A README that opens with a shell snippet gets "install deps" as its export title, and a heading like "# Using `foo`" keeps the backticks.
- **Why:** The title is found with a text search instead of from the parsed document.
- **Fix:** Use the plain text of the first real level-1 heading from the parsed document. Add tests.
- **Effort:** small

<a id="b101"></a>

#### ✅ B101 · [low] Export heading ids don't match GitHub's, so README-style table-of-contents links break in PDF and DOCX

- **Where:** `lib/markdown/export-outline.ts:11-17`
- **What happens:** README-style links to headings containing " / ", " - " or " & " go nowhere in the exported file.
- **Why:** Repeated dashes are merged into one, but GitHub keeps them.
- **Fix:** Follow GitHub's id rules (or use the `github-slugger` package). Update tests. Closely related to B55.
- **Effort:** small

<a id="b102"></a>

#### ✅ B102 · [low] Non-Windows print path can hang forever and runs in an unsandboxed same-origin iframe

- **Where:** `lib/markdown/export-pdf.ts:34`
- **What happens:** On self-built macOS or Linux versions, if no print dialog appears, the Export button stays greyed out and a dead frame is left behind.
- **Why:** The export only finishes when the browser says printing ended, with no timeout.
- **Fix:** Add a fallback timeout that always finishes and cleans up, and sandbox the frame (see S09).
- **Effort:** small

<a id="b103"></a>

#### ✅ B103 · [low] On non-Windows (and the browser fallback) TOC and footer page numbers print blank

- **Where:** `lib/markdown/export-pdf.ts:146`
- **What happens:** When printing through the system dialog, the contents page numbers and footer page numbers are empty.
- **Why:** Only the Windows path stamps the numbers; elsewhere only invisible marker text prints.
- **Fix:** Build a variant of the HTML without markers for this path (using CSS page counters where possible), and note the limitation in settings.
- **Effort:** small

<a id="b104"></a>

#### ✅ B104 · [low] Exported documents are always tagged English: Chinese glyph shapes in Japanese PDFs, no way to set the language, no w:lang in Word

- **Where:** `lib/markdown/markdown-to-export-html.ts:217`
- **What happens:** On English Windows, Japanese PDFs print some characters in Chinese shapes, and `lang: ja` in front matter is ignored.
- **Why:** The language is hardcoded to English and there's no language field.
- **Fix:** Accept `lang` and `dir` in front matter (with a guess from the text), and set them in the export HTML and in Word.
- **Effort:** small

<a id="b105"></a>

#### ✅ B105 · [low] Export file name is wrong for Markdown and example tabs, and the dialog doesn't open in the document's folder

- **Where:** `lib/mermaid/export.ts:9`
- **What happens:** A diagram from notes.md is suggested as "notes.md.svg" (the same for every diagram in the file), and the save box opens somewhere unrelated.
- **Why:** Only `.mmd` is stripped from the name, and only a bare file name is passed to the save box.
- **Fix:** Strip any extension, clean the name, add a per-diagram suffix, and start the save box in the file's folder. Add tests.
- **Effort:** small

<a id="b106"></a>

#### ✅ B106 · [low] PNG export has no size guard; 2x/4x of large diagrams exceeds canvas limits and fails with a vague error

- **Where:** `lib/mermaid/export.ts:88`
- **What happens:** Exporting a very wide diagram as a 4x PNG fails with "Failed to encode PNG."
- **Why:** The canvas size isn't checked against the browser's limits.
- **Fix:** Cap the scale so the canvas fits the limits, and show a clear message that suggests a smaller scale or SVG. Add a test.
- **Effort:** small

<a id="b107"></a>

#### ✅ B107 · [low] `sandbox=""` makes iframe.contentDocument null: bounds measuring and load-based buffer swap never run

- **Where:** `lib/mermaid/svg-iframe.tsx:130-148` (sandbox attribute at `:184`)
- **What happens:** Fit-to-view uses the padded diagram size rather than a tight one, and large diagrams may flash blank after edits.
- **Why:** The fully sandboxed frame can't be read from the app, so the measuring code exits early and picture swaps rely on an 80 ms timer.
- **Fix:** Swap pictures on the frame's load event regardless. Then either allow same-origin (never scripts) so measuring works, or remove the measuring code. Remove the unused live-update path.
- **Effort:** small

<a id="b108"></a>

#### ✅ B108 · [low] Overriding F1 doesn't remove Monaco's own 'Command Palette' from the editor's right-click menu

- **Where:** `lib/monaco/editor-keybindings.ts:5` (called from `components/studio/editor/code-editor-panel.tsx:177`)
- **What happens:** Right-click in the editor and choose Command Palette, and a different-looking palette with the editor's own commands opens.
- **Why:** Only the F1 key was overridden, not the command itself.
- **Fix:** Re-register the editor's command-palette action so it opens Scrivon's palette. Check in the real app.
- **Effort:** small

<a id="b109"></a>

#### ✅ B109 · [low] Recording Ctrl+Alt+letter on AltGr layouts (Polish, German, Czech…) stops you typing that character in the editor; IME and dead keys can be recorded as 'Process' or 'Dead'

- **Where:** `lib/settings/match-keybind.ts:28`
- **What happens:** On a Polish keyboard, a recorded Ctrl+Alt+E shortcut stops you typing "ę" in the editor. Some special keys can be recorded as "Dead" or "Process".
- **Why:** AltGr looks like Ctrl+Alt to the shortcut matcher, and composition and dead keys aren't filtered.
- **Fix:** Ignore AltGraph, IME and dead-key events in both matching and recording, and show a message when a combination types a character. Add tests.
- **Effort:** small

<a id="b110"></a>

#### ✅ B110 · [low] No check that margins and header/footer sizes together fit on the page

- **Where:** `components/studio/settings/sections/pdf-export-settings.tsx:424`
- **What happens:** With very large header, footer and margin values, there's no room left for the text, and Word reports margin errors.
- **Why:** Each value is limited on its own, never in total.
- **Fix:** Work out how much body height is left and warn in settings when it gets too small. Add a test.
- **Effort:** small

<a id="b111"></a>

#### ✅ B111 · [low] System font picker writes invalid CSS for some names and gives monospace picks a sans-serif fallback; duplicate entries

- **Where:** `lib/settings/pdf-export-fonts.ts:34`
- **What happens:** Picking a font named like "0xProto" makes code print in Times New Roman, monospace picks fall back to a proportional font, and some fonts appear twice.
- **Why:** Only names with spaces are quoted, every system font gets a sans-serif fallback, and duplicates are removed by value, not name.
- **Fix:** Always quote font names, add the right fallback for each slot (sans or monospace), and remove duplicates by name. Add tests.
- **Effort:** small

<a id="b112"></a>

#### ✅ B112 · [low] The normaliser doesn't remove duplicate profile ids; Delete can then remove two profiles and crash

- **Where:** `lib/settings/pdf-export-normalize.ts:176`
- **What happens:** If stored settings ever hold two profiles with the same id, clicking Delete crashes the screen.
- **Why:** Duplicate ids aren't fixed on load, and delete removes both and then reads from an empty list.
- **Fix:** Give duplicates new ids when loading, and guard delete against an empty list. Add a test.
- **Effort:** trivial

<a id="b113"></a>

#### ✅ B113 · [low] Hard-coded skip list hides legitimate 'build'/'dist'/'target' folders; symlinked folders silently vanish

- **Where:** `lib/tauri/fs.ts:5`
- **What happens:** Notes kept in a folder called build, dist or target never appear, and linked (symlinked or junctioned) folders are invisible.
- **Why:** A fixed skip list hides those names at every level, and links are dropped.
- **Fix:** Skip build/dist/target only next to a `package.json` or `Cargo.toml` (or make the list a setting), and follow links safely with a depth limit. Add tests.
- **Effort:** small

<a id="b114"></a>

#### ✅ B114 · [low] Recent folders limit only applies on the next folder open, and is read from storage instead of the live setting

- **Where:** `components/studio/workspace/workspace-session-context.tsx:71` (plus `lib/tauri/store.ts:13-52`)
- **What happens:** Lower the recent-folders limit to 3 and the welcome screen and menu still show 10.
- **Why:** The limit is only applied when a folder is opened, and it's re-read from storage rather than the live setting.
- **Fix:** Pass the live setting in, and trim the list straight away whenever the setting changes. Add a test.
- **Effort:** small

<a id="b115"></a>

#### ✅ B115 · [low] A failing workspace.json write blocks opening any folder; a failed store init is cached for the whole session

- **Where:** `lib/tauri/store.ts:27-34` and `:50` (plus `document-tabs-context.tsx:156`, `workspace-session-context.tsx:90-94,134`)
- **What happens:** If the app data folder can't be written (full disk, redirected folder offline), Open Folder, Close Folder and switching folders silently do nothing.
- **Why:** Saving recents and sessions is treated as essential and done before the folder opens, so a failure stops everything.
- **Fix:** Make these saves best-effort with one warning toast per session, and don't keep a store that failed to start.
- **Effort:** small

<a id="b116"></a>

#### ✅ B116 · [low] A non-string entry in recent-workspaces crashes the app on every launch

- **Where:** `lib/tauri/store.ts:40`
- **What happens:** A hand-edited or future-format `workspace.json` with a non-text entry makes the app crash at every start.
- **Why:** The list's items aren't checked, and the welcome screen treats them as text.
- **Fix:** Keep only non-empty text entries when reading the list (and remove duplicates). Consider an error boundary (B34). Add a test.
- **Effort:** trivial

<a id="b117"></a>

#### ✅ B117 · [low] TAURI_SIGNING_PRIVATE_KEY_PATH breaks for absolute paths and fails silently

- **Where:** `scripts/load-dotenv.mjs:35`
- **What happens:** A signing key stored outside the repo is never found, with no message, so a local build fails at the end or signs with an old key inside the repo.
- **Why:** The path is joined onto the repo folder instead of resolved, and a missing file isn't reported.
- **Fix:** Resolve the path properly (expanding `~`), and stop with a clear error if the file is missing. Add a test.
- **Effort:** trivial

<a id="b118"></a>

#### ✅ B118 · [low] If WebView2 is missing or broken, Scrivon silently fails to open with no message

- **Where:** `src-tauri/src/lib.rs:21`
- **What happens:** Tauri already warns when WebView2 is missing, but other startup failures (a broken runtime, an unwritable data folder) make the app vanish silently when you double-click it.
- **Why:** Startup errors cause a crash with no console, no dialog and no log.
- **Fix:** Add a crash hook that writes a log and shows a message box with repair advice, and handle the final startup error the same way.
- **Effort:** small

<a id="b119"></a>

#### ✅ B119 · [low] Translucent footer colour makes TOC page numbers translucent (or invisible) too

- **Where:** `src-tauri/src/page_numbers.rs:981`
- **What happens:** With a 25% opacity footer colour, the contents page numbers also print at 25%.
- **Why:** The footer's opacity setting carries over to the labels drawn after it on the same page.
- **Fix:** Wrap each label in its own saved drawing state so the opacity can't leak. Add a test.
- **Effort:** trivial

<a id="b120"></a>

#### ✅ B120 · [low] Page-number stamping overwrites the PDF in place; a failure leaves an unnumbered or broken file plus a misleading error

- **Where:** `src-tauri/src/page_numbers.rs:1135` (and `src-tauri/src/pdf_export.rs:150`)
- **What happens:** If stamping fails, you're told "Export failed" though a usable PDF exists. A failed save part-way through can leave a cut-off file.
- **Why:** The PDF is reloaded and saved back over the same path with no temp file.
- **Fix:** Print to a temp file, stamp into another temp file, then rename it into place. If stamping fails, keep the unnumbered PDF and show a warning instead of an error.
- **Effort:** small

<a id="b121"></a>

#### ✅ B121 · [low] Stamper can wipe a page's fonts with inherited or indirect resources, and fails on an inherited MediaBox

- **Where:** `src-tauri/src/page_numbers.rs:881-929` (and `:857-866`)
- **What happens:** Nothing today. If WebView2's PDF output ever changes shape, stamped pages could lose all their text, or stamping could fail.
- **Why:** The stamper reads inherited page settings correctly but writes them as if they weren't inherited.
- **Fix:** Look up inherited settings properly and copy shared font lists before editing them. Add tests for those PDF layouts.
- **Effort:** small

<a id="b122"></a>

#### ✅ B122 · [low] PDF page-number and TOC markers are fixed strings that document text can spoof

- **Where:** `lib/markdown/export-html-css.ts:77` and `src-tauri/src/page_numbers.rs:547`
- **What happens:** A document that happens to contain "SFPN" or "SFT0001" gets a page number stamped over that word, or wrong numbers in the contents.
- **Why:** The hidden markers are fixed text, so normal text can match them.
- **Fix:** Generate a random marker code for each export and share it between the TypeScript and Rust sides. Update tests.
- **Effort:** small

<a id="b123"></a>

#### ✅ B123 · [low] PDF export prints after a fixed 1.2 s sleep with no readiness check and no timeout

- **Where:** `src-tauri/src/pdf_export.rs:57`
- **What happens:** Remote images or fonts can be missing from the PDF on a slow network, and every export waits at least 1.2 seconds for nothing.
- **Why:** Export waits a fixed time instead of checking that fonts and images have loaded, and has no overall timeout.
- **Fix:** Poll a small "ready" check (fonts loaded, images decoded) with a cap, add an overall timeout, and always close the hidden window. Optionally embed remote images first.
- **Effort:** small

<a id="b124"></a>

#### ✅ B124 · [low] Closing the app during a PDF export leaves an invisible process, and the hidden window is closed before page numbers are stamped

- **Where:** `src-tauri/src/pdf_export.rs:147`
- **What happens:** Quitting right after starting an export can leave a PDF without page numbers or a cut-off file, and an invisible process may linger briefly.
- **Why:** The hidden export window is closed before stamping, which can make the app exit mid-stamp, and some error paths never close it.
- **Fix:** Close the window only after stamping (using a guard that also covers errors), run stamping off the async worker, and save atomically.
- **Effort:** small

<a id="b125"></a>

#### ✅ B125 · [low] Offline or locked-down installs fail because both installers download WebView2 during setup

- **Where:** `src-tauri/tauri.conf.json:26`
- **What happens:** On offline PCs without WebView2 (some LTSC or Server machines), setup stops with an unclear "Failed to install WebView2" message.
- **Why:** The default install mode downloads WebView2 during setup.
- **Fix:** Add a README note on installing the standalone runtime, embed the bootstrapper in the installer, and optionally publish an offline installer.
- **Effort:** small

<a id="b126"></a>

#### ✅ B126 · [low] The identifier change also changed the installer's Publisher: custom install folders were dropped, leaving an old copy that the Start menu still launches

- **Where:** `src-tauri/tauri.conf.json:26`
- **What happens:** People who installed to a custom folder before 1.4.1 got a second copy elsewhere. The Start menu keeps launching the old version, which offers the update again and again, and the old copy can't be uninstalled from Settings.
- **Why:** The installer's registry keys use the publisher name, which is taken from the identifier and changed from "diagram" to "github".
- **Fix:** Pin the publisher, binary name and MSI upgrade code in the config, and add an installer hook that moves old shortcuts and removes the old copy.
- **Effort:** small

## Performance (P)

<a id="p01"></a>

#### ✅ P01 · [medium] Diagram layout runs synchronously on the UI thread with no worker or idle scheduling

- **Where:** `components/studio/canvas/use-mermaid-svg.ts:95`
- **What happens:** Typing in a large diagram (200+ nodes) stutters after every short pause.
- **Why:** Diagram layout runs on the main thread after each pause, blocking typing and the window. A helper for idle rendering exists but isn't used.
- **Fix:** First remove the double render (P03). Then move rendering into a Web Worker that keeps only the newest request, with a timeout and a main-thread fallback.
- **Effort:** medium

<a id="p02"></a>

#### ✅ P02 · [medium] Global SVG cache grows without limit for the whole session

- **Where:** `components/studio/canvas/use-mermaid-svg.ts:13`
- **What happens:** Memory use slowly climbs during long editing sessions.
- **Why:** Every successful render is kept forever until the theme changes, including closed tabs and every in-between version.
- **Fix:** Keep only the latest picture per document in a small size-limited cache and prune closed tabs. This also fixes B14.
- **Effort:** small

<a id="p03"></a>

#### ✅ P03 · [medium] Every edit renders the diagram twice on the main thread

- **Where:** `components/studio/canvas/use-mermaid-svg.ts:95`
- **What happens:** The pause after typing in a large diagram lasts twice as long as it needs to.
- **Why:** The export menu and the canvas both render the same diagram, and neither checks the cache before rendering.
- **Fix:** Check the cache inside the timer before rendering (and cache errors too), or move to one shared render store.
- **Effort:** trivial

<a id="p04"></a>

#### ✅ P04 · [medium] Every tree row re-renders on every keystroke in the editor

- **Where:** `components/studio/explorer/file-tree-node.tsx:17` (plus `components/studio/workspace/document-tabs-context.tsx:275-291`)
- **What happens:** In folders with thousands of files, typing in the editor lags.
- **Why:** Each tree row listens to the whole tabs state, which changes with every keystroke, and each row sets up two menus.
- **Fix:** Split the tabs context into "active tab" and "actions", memoise rows, and use one shared context menu for the whole tree.
- **Effort:** small

<a id="p05"></a>

#### ✅ P05 · [medium] The whole document is re-parsed twice per keystroke, and on every unrelated re-render

- **Where:** `components/studio/markdown/markdown-preview.tsx:89`
- **What happens:** Typing in long Markdown files (over about 1,500 lines) stutters.
- **Why:** The preview component isn't memoised, so it re-parses the whole document on every parent render plus once more per frame.
- **Fix:** Wrap the preview in `memo`, and for large files wait for a short pause in typing before updating the preview.
- **Effort:** small

<a id="p06"></a>

#### ✅ P06 · [medium] The TOC leader's `transform` makes Chromium paint every TOC leader onto every page: PDFs grow about 1.7x and stamping takes 22 s for 341 pages

- **Where:** `lib/markdown/export-html-css.ts:445`
- **What happens:** Long documents with a table of contents take up to 20+ seconds to export and produce bloated PDFs.
- **Why:** A CSS transform on the dotted leader lines makes the browser repeat all of them, hidden, on every page.
- **Fix:** Replace the transform with `position: relative; top: -0.25em`, add a test, and run the stamper off the async worker.
- **Effort:** trivial

<a id="p07"></a>

#### ✅ P07 · [medium] Tree loading is a full one-at-a-time recursive scan, repeated after every operation, with no loading state

- **Where:** `lib/tauri/fs.ts:15` (and `components/studio/workspace/workspace-session-context.tsx:77-125`)
- **What happens:** Large folders take seconds to open with no feedback, and every new file waits on a full rescan before its tab opens.
- **Why:** Each subfolder is read one after another, the whole tree is rescanned after every change, and late results aren't discarded.
- **Fix:** Scan in a single Rust command (respecting `.gitignore` and skipping unsupported files), add a loading state and a guard against stale results, and update the tree in place after small changes.
- **Effort:** medium

<a id="p08"></a>

#### ✅ P08 · [medium] No guard for very large files or folders: the app freezes on open and every keystroke copies and rewrites the whole document

- **Where:** `lib/tauri/fs.ts:15`
- **What happens:** Opening a 20 MB log, or a repo with `.venv` or `vendor` folders, hangs with no spinner, and typing lags.
- **Why:** There's no size check, the skip list is short, and the preview re-parses the whole document every frame.
- **Fix:** Extend the skip list, read folders in parallel with error handling, ask before opening very large files (read-only), and slow down preview updates for big files.
- **Effort:** medium

<a id="p09"></a>

#### ✅ P09 · [low] Each pause in typing re-reads up to 50 files from disk with no caching; palette results also recompute on every editor keystroke while closed

- **Where:** `components/studio/command-palette/use-palette-search.ts:140`
- **What happens:** Extra disk activity while you type slowly in Find in Workspace, and a little wasted work while the palette is closed.
- **Why:** File contents aren't cached between searches, and result groups are rebuilt even when the palette is closed.
- **Fix:** Skip building groups while closed, and cache file contents keyed by modified time.
- **Effort:** small

<a id="p10"></a>

#### ✅ P10 · [low] Command palette rebuilds its result groups on every editor keystroke while closed

- **Where:** `components/studio/command-palette/use-palette-search.ts:140`
- **What happens:** A small amount of wasted work on every keystroke in large workspaces.
- **Why:** The result list doesn't check whether the palette is open.
- **Fix:** Return the previous results while the palette is closed.
- **Effort:** trivial

<a id="p11"></a>

#### ✅ P11 · [low] All licence texts (~175 KB) are loaded at startup because About imports APP_VERSION from the licences module

- **Where:** `components/studio/dialogs/about-dialog.tsx:6` (also `components/studio/shell/studio-menu-bar.tsx:8`, `scripts/generate-licenses.mjs:180-181`)
- **What happens:** About 175 KB of licence text is loaded and parsed on every launch, though most people never open it.
- **Why:** The About dialog reads the version number from the big licences file.
- **Fix:** Put the version in its own small file and load the licences dialog only when opened.
- **Effort:** small

<a id="p12"></a>

#### ✅ P12 · [low] Each embedded diagram creates two full iframes (one invisible), and both are tab stops

- **Where:** `lib/mermaid/svg-iframe.tsx:172`
- **What happens:** A document with 20 diagrams creates 40 frames, and Tab stops on invisible ones.
- **Why:** The flicker-free double buffer always keeps both frames.
- **Fix:** Only draw the second frame during a swap, make frames unfocusable, or use a single frame for small inline diagrams.
- **Effort:** small

<a id="p13"></a>

#### ✅ P13 · [low] Every keystroke and every pixel of pane dragging writes all settings to localStorage and re-renders all settings consumers

- **Where:** `components/studio/editor/code-editor-panel.tsx:114`
- **What happens:** Dragging the editor divider is janky, and typing 20 into Font size briefly sets it to 8.
- **Why:** All settings are saved on every mouse move and every typed digit.
- **Fix:** Keep the drag width local and save once on release, debounce saves, and apply number fields when you finish typing.
- **Effort:** small

<a id="p14"></a>

#### ✅ P14 · [low] Word export slows down quadratically with the number of lists and blocks the UI for many seconds on large documents

- **Where:** `lib/markdown/export-docx.ts:495`
- **What happens:** Exporting a book-length document with thousands of lists freezes the app for many seconds.
- **Why:** Every list gets its own numbering, and the docx library scans the whole document once per numbering.
- **Fix:** Share one bullet numbering per depth, and show "Exporting…" before starting.
- **Effort:** small

<a id="p15"></a>

#### ✅ P15 · [low] Header/footer images are embedded even when hidden, and repeated up to three times

- **Where:** `lib/markdown/markdown-to-export-html.ts:134` (and `lib/markdown/export-assets.ts:17`)
- **What happens:** Exports with large but hidden header images are slower and heavier than needed.
- **Why:** All profile images are read every time and copied into every section, even when hidden.
- **Fix:** Skip images for hidden bars and an off title page, and only render visible bars. Add tests.
- **Effort:** small

<a id="p16"></a>

#### ✅ P16 · [low] First code block loads 24 Shiki grammars (~1.9MB) plus the 620KB Oniguruma WASM

- **Where:** `lib/markdown/shiki-highlighter.ts:57`
- **What happens:** A short delay and a memory jump before the first code block is coloured.
- **Why:** Every language grammar is loaded up front.
- **Fix:** Start with no languages and load each on first use, and clear a cached start-up failure.
- **Effort:** trivial

<a id="p17"></a>

#### ✅ P17 · [low] Every production build, including the one bundled into the installer, ships full JS source maps

- **Where:** `scripts/generate-licenses.mjs:197`
- **What happens:** Every installer and update download is bigger than it needs to be.
- **Why:** Source maps made for the licence script are never deleted before the app is bundled.
- **Fix:** Delete `.map` files from `out/` after the licence script runs.
- **Effort:** trivial

<a id="p18"></a>

#### ✅ P18 · [low] No release profile tuning for the shipped binary

- **Where:** `src-tauri/Cargo.toml:42`
- **What happens:** The installer and updates are larger than they could be.
- **Why:** There's no release build profile.
- **Fix:** Add `codegen-units = 1`, `lto = true` and `strip = true` (keep the default panic behaviour), then compare sizes.
- **Effort:** trivial

<a id="p19"></a>

#### ✅ P19 · [low] Synchronous commands (image read, font list) run on the UI thread and can freeze the app

- **Where:** `src-tauri/src/pdf_export.rs:193`
- **What happens:** With a logo in an online-only Google Drive folder, the whole window freezes during export until Drive fetches the file.
- **Why:** These commands are plain synchronous functions, which Tauri runs on the main thread.
- **Fix:** Mark them `#[tauri::command(async)]`, check file size before reading, and cache the font list.
- **Effort:** trivial

## UI/UX (U)

<a id="u01"></a>

#### ✅ U01 · [critical] Name prompt has no inline validation; errors show in a native box after the dialog closes, and the typed name is lost

- **Where:** `components/studio/dialogs/name-prompt-provider.tsx:68` (inline validation); `lib/tauri/fs.ts:72-80` (overwrite guard for create/rename)
- **What happens:** Type an invalid name and press Create: the dialog closes, a system error box pops up, and you have to start again from the menu. Worse, accepting a pre-filled name that already exists silently replaces that file (see D07).
- **Why:** The prompt only trims the text. Checks happen later and report through a native message box, and nothing checks whether the name is already taken.
- **Fix:** Give the prompt a `validate` callback that shows the error under the field and keeps the dialog open, disable Create while the name is invalid, check for clashes with existing names (ignoring case), and select only the name part on focus. Add overwrite guards in `fs.ts` and catch file errors. Add tests.
- **Effort:** medium

<a id="u02"></a>

#### ✅ U02 · [high] Syntax errors are never shown once a diagram has rendered successfully

- **Where:** `components/studio/canvas/use-mermaid-svg.ts:133`
- **What happens:** Once a diagram has rendered, any later mistake just leaves the old picture on screen with no error, so you can't tell your edit broke it. Save SVG then fails with an error. Deleting everything and typing again brings the deleted diagram back.
- **Why:** The error is hidden whenever an older picture of the same document exists.
- **Fix:** Always return the error. Show the old diagram dimmed with an error banner over it, clear the old picture when the text is emptied, and keep the most recent fallback rather than the oldest. Optionally mark the error line in the editor.
- **Effort:** small

<a id="u03"></a>

#### ✅ U03 · [high] Save errors only show up as a tab tooltip

- **Where:** `components/studio/workspace/document-save-context.tsx:75` (catch block), plus `components/studio/editor/editor-tab-bar.tsx:48` and `:83`
- **What happens:** When saves keep failing (for example a locked file), the tab looks like any other unsaved tab. The error only appears if you hover over the tab, and even then it says just "Failed to save file".
- **Why:** The error is only used in a hover tooltip, and the real OS message is thrown away because it isn't an Error object.
- **Fix:** Show an error toast with a Retry button, mark the tab with a red icon, keep the error until a save succeeds, and read the real error text.
- **Effort:** small

<a id="u04"></a>

#### ✅ U04 · [high] Footer bar and page number float up under the text on the last page of every multi-page section

- **Where:** `lib/markdown/export-html-css.ts:367`
- **What happens:** On the last contents page and the last body page, the footer bar and page number sit halfway up the page, right under the last paragraph.
- **Why:** The "fill the page" height applies to the whole section, not each page, so on the last page the footer just follows the content.
- **Fix:** Draw the footer with CSS page margin boxes (`@page` with named pages and page counters) instead of a repeating table row, then remove the table footer and update tests.
- **Effort:** medium

<a id="u05"></a>

#### ✅ U05 · [medium] No `color-scheme` set, so native scrollbars and other browser-drawn controls stay light in dark themes

- **Where:** `app/globals.css:7`
- **What happens:** In dark themes, bright grey scrollbars appear under code blocks and tables, in menus and on the tab strip.
- **Why:** The page never says it's dark, so the browser draws its controls in light mode. Leftover template rules also override the theme.
- **Fix:** Remove the leftover template rules, set `color-scheme` for light and dark (also in the startup script), add thin themed scrollbars, and hide the tab strip's scrollbar.
- **Effort:** small

<a id="u06"></a>

#### ✅ U06 · [medium] Right-click is dead in all inputs and the preview (no Copy/Paste), and it's disabled in three separate places

- **Where:** `components/disable-native-context-menu.tsx:17` (plus `src-tauri/src/prevent_browser_shortcuts.rs:11`, `:15`, `:29`)
- **What happens:** You can't right-click Paste into the rename box, palette or settings fields, or right-click Copy text in the preview.
- **Why:** The right-click menu is blocked in three places, and the code meant to allow it in text fields does nothing.
- **Fix:** Let right-clicks through in text fields and the editor, remove the context-menu block from the Rust plugin, re-enable WebView2's text-field menu, and optionally add a small Copy menu for preview selections.
- **Effort:** small

<a id="u07"></a>

#### ✅ U07 · [medium] Wheel always zooms: trackpad two-finger scroll zooms instead of panning, and preventDefault is a no-op

- **Where:** `components/studio/canvas/use-pan-zoom.ts:157`
- **What happens:** On a laptop touchpad, a two-finger swipe zooms the diagram instead of moving it, and a sideways swipe does nothing. Touchscreens jump between fingers.
- **Why:** Every wheel event is treated as zoom, and the listener can't stop the browser's default handling.
- **Fix:** Attach a proper wheel listener that zooms on pinch or Ctrl+wheel and pans otherwise, keep zoom symmetric, and add two-finger touch pinch. Add tests.
- **Effort:** small

<a id="u08"></a>

#### ✅ U08 · [medium] Fit to view can't fit large diagrams and blows small ones up to 500%

- **Where:** `components/studio/canvas/use-pan-zoom.ts:19`
- **What happens:** A new two-box diagram opens at a huge zoom, and as you add more it grows off-screen. Very wide diagrams still overflow after Fit.
- **Why:** Fit is limited to between 10% and 500%.
- **Fix:** Lower the minimum zoom, cap Fit at about 150%, and add tests.
- **Effort:** trivial

<a id="u09"></a>

#### ✅ U09 · [medium] Go to File and Find in Workspace modes are invisible: same placeholder, results silently filtered, no way to switch

- **Where:** `components/studio/command-palette/command-palette-dialog.tsx:157` (plus `command-palette-provider.tsx:76`)
- **What happens:** After Ctrl+Shift+F, typing a file name finds nothing, and nothing explains that file names aren't searched in this mode. The empty box suggests "Try a shorter query".
- **Why:** The dialog is never told which mode it's in, so the text is always the same.
- **Fix:** Pass the mode to the dialog, set the placeholder and empty message per mode, show a small mode chip, and let users switch mode without closing.
- **Effort:** small

<a id="u10"></a>

#### ✅ U10 · [medium] Editor selection is pasted into the palette query without being selected, so typing '>' or a new search appends to it

- **Where:** `components/studio/command-palette/command-palette-provider.tsx:33-43`
- **What happens:** With a word selected in the editor, pressing F1 and typing ">" gives "word>", which lists files instead of commands. Old selections and multi-line text get in too.
- **Why:** Every open copies the editor selection into the box without selecting it, and F1 inside the palette does it again.
- **Fix:** Only use a focused, single-line selection, and only for Find in Workspace. Select the text in the box, and don't refill it if the palette is already open.
- **Effort:** small

<a id="u11"></a>

#### ✅ U11 · [medium] The command palette (F1) shows no commands unless you know to type '>'

- **Where:** `components/studio/command-palette/use-palette-search.ts:140`
- **What happens:** Press F1 and type "theme" or "close folder": no commands appear, though the box says it searches commands.
- **Why:** Commands only appear when the query starts with ">".
- **Fix:** Show the top matching commands in the normal mode as well, and add a ">" hint to the empty message and footer.
- **Effort:** small

<a id="u12"></a>

#### ✅ U12 · [medium] New-file prompt never adds the extension, and it pre-selects the whole name including the extension

- **Where:** `components/studio/dialogs/name-prompt-provider.tsx:95` and `components/studio/explorer/use-file-tree-actions.ts:13-20`
- **What happens:** New Diagram shows "diagram.mmd" fully selected; type "login flow" and you get "File name must end with .md or .mmd".
- **Why:** Focus selects the extension too, and the expected extension is never added.
- **Fix:** Select only the part before the dot, add the default extension when it's missing, keep the old extension on rename, and mention `.mermaid` in the messages.
- **Effort:** small

<a id="u13"></a>

#### ✅ U13 · [medium] Update install has no progress, misleading copy, no timeout and an undismissable modal

- **Where:** `src-tauri/src/updater.rs:69-77` (also `components/studio/dialogs/update-available-dialog.tsx:28-50`, `components/studio/app-update-provider.tsx:84-93`)
- **What happens:** The dialog says the update is "ready to install" but it hasn't downloaded yet. Clicking Install shows a static "Installing…", the X does nothing, and on a stalled connection the dialog blocks the app with no way out.
- **Why:** Download progress is thrown away, there are no network timeouts, and the dialog refuses to close while installing.
- **Fix:** Send progress to the dialog and show a progress bar, add connect and read timeouts, allow cancelling the download, fix the wording, and show errors with a Retry button.
- **Effort:** medium

<a id="u14"></a>

#### ✅ U14 · [medium] Saved editor width is never re-checked against the window size; the editor can push the preview to zero and hide its own resize handle

- **Where:** `components/studio/editor/code-editor-panel.tsx:201`
- **What happens:** Widen the editor on a big monitor, then move to a laptop screen: the preview disappears and the resize handle is off-screen, so you can't drag it back.
- **Why:** The width is only limited while dragging, not when the window gets smaller.
- **Fix:** Measure the available space and cap the shown width (without changing the saved value), base the drag limit on the same space, and add a minimum window size.
- **Effort:** small

<a id="u15"></a>

#### ✅ U15 · [medium] Word wrap 'Off' leaves long lines cut off with no horizontal scrollbar

- **Where:** `components/studio/editor/code-editor-panel.tsx:38`
- **What happens:** With wrapping off, long lines run past the edge and there's no scrollbar to reach them.
- **Why:** The horizontal scrollbar is hardcoded to hidden.
- **Fix:** Set the horizontal scrollbar to `auto` (it only appears when needed).
- **Effort:** trivial

<a id="u16"></a>

#### ✅ U16 · [medium] Resize handle sits under Monaco's vertical scrollbar, and its drag never cleans up on cancel

- **Where:** `components/studio/editor/code-editor-panel.tsx:108-128` and `222-228`
- **What happens:** Moving the mouse from the text to the editor's edge grabs the scrollbar instead of the resize handle. Right or middle clicks also start a resize, and a missed release keeps resizing.
- **Why:** The handle sits under the scrollbar, and the drag only ends on a normal mouse-up.
- **Fix:** Raise and widen the handle so it straddles the border, accept only the left button, end the drag on cancel and lost capture too, and save the width once at the end.
- **Effort:** small

<a id="u17"></a>

#### ✅ U17 · [medium] With many tabs open, tabs squeeze down until their names disappear instead of the bar scrolling

- **Where:** `components/studio/editor/editor-tab-bar.tsx:75`
- **What happens:** With 15 to 20 files open, tab names shrink to nothing and close buttons overlap; you can only tell tabs apart by hovering.
- **Why:** Tabs are allowed to shrink to zero width, so the bar never needs to scroll.
- **Fix:** Give tabs a minimum width so the bar scrolls, hide or thin its scrollbar, scroll the active tab into view, and let the mouse wheel scroll sideways.
- **Effort:** small

<a id="u18"></a>

#### ✅ U18 · [medium] No progress, no success message, and no way to open the exported file

- **Where:** `components/studio/editor/pdf-export-dialog.tsx:66`
- **What happens:** After clicking Export nothing seems to happen, then a save box appears, then the dialog vanishes with no confirmation of where the file went.
- **Why:** The button doesn't show progress, and the export doesn't report its result.
- **Fix:** Show "Exporting…" with a spinner, return a status, stop the dialog closing mid-export, and on success show a toast with "Show in folder".
- **Effort:** small

<a id="u19"></a>

#### ✅ U19 · [medium] Folder expand/collapse state isn't saved and resets on Ctrl+B, the panel switch, or a folder rename

- **Where:** `components/studio/explorer/file-tree-node.tsx:18` (state to move into `components/studio/workspace/workspace-session-context.tsx`)
- **What happens:** Folders you opened or closed snap back to the default after you hide the explorer, switch to Examples, or rename a folder.
- **Why:** Each row keeps its own open/closed state, which is lost when the tree is rebuilt.
- **Fix:** Keep a set of open folders in the workspace session, update it on rename and delete, and save it with the folder's tab session.
- **Effort:** small

<a id="u20"></a>

#### ✅ U20 · [medium] The export settings form is one long flat list; settings that depend on others are never hidden or disabled

- **Where:** `components/studio/settings/sections/pdf-export-settings.tsx:281`
- **What happens:** About 50 settings in one column with no headings. Options like TOC depth stay active even when the contents page is off, and the logo comes before the switch that turns it on.
- **Why:** There's no grouping and no disabled state for dependent options.
- **Fix:** Group settings into titled sections (Page, Typography, Cover, Contents, Header, Footer, Content), put each section's on/off switch first and disable its options when off, and use one name for the cover image.
- **Effort:** small

<a id="u21"></a>

#### ✅ U21 · [medium] Settings dialog is taller than the window below ~806px, giving a nested double scroll that hides the bottom of long sections

- **Where:** `components/studio/settings/settings-dialog.tsx:47-58`
- **What happens:** On common 768px-tall laptop screens, the last rows of Keyboard or Document export are cut off and can't be reached with normal scrolling.
- **Why:** The height calculation leaves too little room for the header and footer, which creates one scroll area inside another.
- **Fix:** Give the dialog a fixed height that fits the window and use a single scroll area for the section content. Add a minimum window size.
- **Effort:** small

<a id="u22"></a>

#### ✅ U22 · [medium] Explorer vanishes below 769 CSS px (half-snapped window or high Windows scaling), and the toggle silently does nothing

- **Where:** `components/studio/shell/studio-layout.tsx:30`
- **What happens:** Snap the window to half the screen on a laptop with display scaling, and the file tree disappears while its toggle still looks "on" and Ctrl+B does nothing visible.
- **Why:** A leftover "mobile" rule hides the explorer at narrow widths.
- **Fix:** Remove that rule (or show the explorer as an overlay when narrow), and add a minimum window size.
- **Effort:** small

<a id="u23"></a>

#### ✅ U23 · [medium] Small or snapped windows break the layout: window controls get clipped, the explorer disappears while its toggle still shows 'on', and a saved editor width can push the preview off-screen

- **Where:** `components/studio/shell/studio-layout.tsx:19`
- **What happens:** Very narrow windows cut off the Close button, half-snapped windows lose the explorer, and a wide saved editor pushes the preview off the screen.
- **Why:** The window has no minimum size, a "mobile" rule hides the explorer, and the editor width isn't capped to the space available.
- **Fix:** Add `minWidth` and `minHeight`, remove the mobile rule, and cap the editor width to its container (see U14 and U22).
- **Effort:** small

<a id="u24"></a>

#### ✅ U24 · [medium] Welcome screen can't scroll; with many recents or a short window the top and bottom are cut off

- **Where:** `components/studio/shell/welcome-screen.tsx:20`
- **What happens:** With many recent folders or a short window, the title and Open Folder button are pushed off the top and the last folders off the bottom.
- **Why:** The content is centred with no scrolling.
- **Fix:** Make the screen scroll and keep the content centred only when it fits (`overflow-y-auto` with an inner `my-auto` wrapper).
- **Effort:** trivial

<a id="u25"></a>

#### ✅ U25 · [medium] Logo and header/footer images that fail to load are dropped without telling the user

- **Where:** `lib/markdown/export-assets.ts:10`
- **What happens:** If the logo file was moved, is too big, or is on an offline drive, the PDF comes out without it and nothing explains why.
- **Why:** Image read errors are turned into empty values.
- **Fix:** Collect the failed images with their reasons and ask "Some images could not be loaded. Export anyway?". Base the full-bleed logo layout on the loaded image, not the saved path.
- **Effort:** small

<a id="u26"></a>

#### ✅ U26 · [medium] updateFields makes Word ask 'This document contains fields that may refer to other files…' every time the file is opened

- **Where:** `lib/markdown/export-docx.ts:1340`
- **What happens:** Everyone who opens an exported Word file sees a warning-style prompt about updating fields, every time.
- **Why:** The "update fields on open" flag is set, though the file has no fields that need it.
- **Fix:** Remove the flag and add a test.
- **Effort:** trivial

<a id="u27"></a>

#### ✅ U27 · [medium] Turning the Footer switch off doesn't hide the footer when page numbers are set

- **Where:** `lib/markdown/export-html-css.ts:28`
- **What happens:** Switch the footer off while page numbers are set, and the full styled footer (text, images, background) still prints, in PDF and Word.
- **Why:** Choosing a page-number format turns the whole footer on.
- **Fix:** When the switch is off, print only the page number, and say so in settings (dimming the other footer fields). Update tests.
- **Effort:** small

<a id="u28"></a>

#### ✅ U28 · [medium] Headings are left stranded as the last line of a page, cut off from their content

- **Where:** `lib/markdown/export-html-css.ts:228`
- **What happens:** Many PDF pages end with a heading whose section starts on the next page.
- **Why:** Headings aren't told to stay with what follows them.
- **Fix:** Add `break-after: avoid` to body headings in the print styles (and optionally orphan/widow rules). Add a test.
- **Effort:** trivial

<a id="u29"></a>

#### ✅ U29 · [medium] Title page spills onto a second page in landscape, with large margins, or when header/footer bars show on the cover

- **Where:** `lib/markdown/export-html-css.ts:187`
- **What happens:** In landscape, with large margins, or with header and footer bars on the cover, the subtitle, author and date end up alone on page 2, and the contents moves to page 3.
- **Why:** The cover height and logo size cap don't allow for the bars or the orientation.
- **Fix:** Work out the space really available (including bars) and let the logo shrink to fit. Add tests for those layouts.
- **Effort:** small

<a id="u30"></a>

#### ✅ U30 · [medium] Profile naming: every new profile is called 'New profile', copies stack up as 'copy copy', and the name isn't focused

- **Where:** `lib/settings/pdf-export-profiles.ts:25`
- **What happens:** Click New twice and the picker shows two "New profile" entries you can't tell apart. Renaming is also awkward (see B58).
- **Why:** Names aren't made unique and the name field isn't focused after creating.
- **Fix:** Generate unique names ("New profile 2", "Default copy 2"), focus and select the name field after New or Duplicate, and fix the rename box as in B58.
- **Effort:** small

<a id="u31"></a>

#### ✅ U31 · [medium] Monaco theme only sets a few colors: syntax colors and most widgets fall back to VS Code defaults that clash with the palette

- **Where:** `lib/theme/monaco-theme.ts:21`
- **What happens:** On Nord, Solarized, Catppuccin and the other themes, editor headings and links use stock VS Code blues, the suggestion popup has a bright blue row, and the find box is a grey block.
- **Why:** The editor theme defines no syntax colours and only about 20 widget colours.
- **Fix:** Build syntax rules and widget colours (suggestions, find box, menus, inputs) from the chosen theme's palette. Add a test.
- **Effort:** small

<a id="u32"></a>

#### ✅ U32 · [medium] Surface tokens are a 3% mix, so the active tab, active file, hover states and secondary buttons are basically invisible

- **Where:** `lib/theme/semantic-vars.ts:77`
- **What happens:** In every theme it's hard to see which tab or file is active, and "on" toggle buttons look less pressed than hovered ones.
- **Why:** These states use a barely-there 3% tint, often with extra transparency on top.
- **Fix:** Use a stronger tint for interactive states, add an accent bar to the active tab and file, use `aria-selected` and `aria-pressed`, and give overlay buttons a visible border.
- **Effort:** small

<a id="u33"></a>

#### ✅ U33 · [medium] PDF write failures are reported as 'PDF export was cancelled.'

- **Where:** `src-tauri/src/pdf_export.rs:130`
- **What happens:** Export over a PDF that's open in Acrobat and you get "Export failed" with raw Rust text saying the export was cancelled, which you never did.
- **Why:** Every print failure is reported as "cancelled", and errors are shown in their raw debug form.
- **Fix:** Use a clear message ("close the PDF in the other program or choose another folder"), format errors cleanly, and optionally check up front whether the file is locked.
- **Effort:** small

<a id="u34"></a>

#### ✅ U34 · [medium] The app quits before the installer runs, so any installer failure is invisible; MSI users also face a UAC prompt on every update

- **Where:** `src-tauri/src/updater.rs:74`
- **What happens:** If you decline the permission prompt, or antivirus blocks the installer, Scrivon just disappears and nothing installs. The next launch offers the same update again.
- **Why:** The updater starts the installer and exits immediately without checking it started. The MSI is per-machine, so it needs admin rights every time.
- **Fix:** Save work first (D01), leave an "update attempted" marker and report on next launch if the version didn't change, warn in the dialog that Windows may ask for permission, drop the MSI from updates, and sign the installer (S06).
- **Effort:** medium

<a id="u35"></a>

#### ✅ U35 · [medium] Main window size is fixed at 1440×810, not remembered, and can overflow common laptop screens

- **Where:** `src-tauri/tauri.conf.json:14`
- **What happens:** On a 1080p laptop at 150% scaling the window is bigger than the screen and its Close button is off-screen. Size, position and maximised state reset every launch, and the window can be shrunk until it's unusable.
- **Why:** The window has a fixed size with no centring, overflow guard, minimum size or remembered state.
- **Fix:** Add `center`, `minWidth`/`minHeight`, `preventOverflow` and `visible: false`, plus `tauri-plugin-window-state` to remember size and position.
- **Effort:** small

<a id="u36"></a>

#### ✅ U36 · [low] Each stable release ships two installers with opposite install scopes and no guidance; installing the MSI after the EXE creates a duplicate install

- **Where:** `.github/workflows/release.yml:79`
- **What happens:** The release page offers an .exe and an .msi with no explanation. Installing the MSI after the EXE gives you two separate copies of Scrivon.
- **Why:** Both a per-user (NSIS) and a per-machine (MSI) installer are published, and the MSI can't see the other install.
- **Fix:** Publish only the NSIS installer and name it in the README (the MSI has had no downloads).
- **Effort:** trivial

<a id="u37"></a>

#### ✅ U37 · [low] Error and empty-state cards are inside the pan/zoom layer and can't be selected or scrolled

- **Where:** `components/studio/canvas/mermaid-canvas.tsx:107`
- **What happens:** After zooming, the "Add Mermaid syntax" hint is tiny or off-screen, and you can't select or copy a diagram error message.
- **Why:** The cards sit inside the zoomed layer and ignore the mouse.
- **Fix:** Draw them in a separate overlay at normal size, allow text selection, and announce errors politely to screen readers. Do the same for embedded blocks.
- **Effort:** small

<a id="u38"></a>

#### ✅ U38 · [low] Canvas goes blank with no loading state on first open, on theme change, and for header-only diagrams

- **Where:** `components/studio/canvas/use-mermaid-svg.ts:41`
- **What happens:** Switching theme makes the diagram blink out, embedded diagrams shrink to a placeholder and jump, and a file with only "flowchart TD" shows nothing.
- **Why:** A theme change clears every cached picture with no fallback, and every first render waits for the typing delay.
- **Fix:** Keep the old picture while re-rendering, render straight away when nothing is shown yet, and show a hint for diagrams with no content.
- **Effort:** small

<a id="u39"></a>

#### ✅ U39 · [low] Half-typed diagrams render a 0×0 SVG: blank canvas, an empty sliver in markdown, and an empty file on SVG export

- **Where:** `components/studio/canvas/use-mermaid-svg.ts:95`
- **What happens:** While you're typing "graph TD" and haven't added boxes yet, the canvas is blank with no hint, Markdown shows an empty box, and Save SVG writes an empty file.
- **Why:** A zero-size picture is treated as a success.
- **Fix:** Treat zero-size results as "empty": show "Add nodes to see the diagram", disable export, and handle it the same way in PDF and Word. Add a test.
- **Effort:** small

<a id="u40"></a>

#### ✅ U40 · [low] Empty and loading states are wrong: 'No results found' shows while still searching, before typing, and in '>' mode

- **Where:** `components/studio/command-palette/command-palette-dialog.tsx:149` (plus `use-palette-search.ts:178` and `:254`)
- **What happens:** "No results found. Try a shorter query" shows while a search is still running, before you type anything in Find in Workspace, and in command mode. Old results stay clickable after you change the query.
- **Why:** There's one empty message for every situation, and old text results linger.
- **Fix:** Pick the message by state ("Searching…", "Type at least 2 characters", "No matching commands"), and only show text results for the current query.
- **Effort:** small

<a id="u41"></a>

#### ✅ U41 · [low] Match highlight and unsaved-dot disappear on the highlighted row and are faint elsewhere; the second match on a line highlights the wrong spot

- **Where:** `components/studio/command-palette/command-palette-dialog.tsx:37-51,75` (plus `search-content.ts:12-26,42-49,157-170`)
- **What happens:** On the selected row, the unsaved dot and match highlight can't be seen. For a second match on the same line, the first one is highlighted.
- **Why:** They use the same colour as the selected row, and the highlight searches the preview again instead of using the hit's position.
- **Fix:** Use the foreground colour for the dot, a different highlight style, and the stored match position. Optionally highlight matched letters in file names.
- **Effort:** small

<a id="u42"></a>

#### ✅ U42 · [low] Rows with the same file name can't be told apart; Files repeats entries already in Open Editors and Recent

- **Where:** `components/studio/command-palette/command-palette-dialog.tsx:70`
- **What happens:** Two README.md files show as identical rows, two recent folders called "docs" look the same, and the same file can appear in two groups.
- **Why:** Rows show only the base name, and groups aren't de-duplicated.
- **Fix:** Show the relative path under the name, add the folder path to recent-folder commands, and leave out files already listed above.
- **Effort:** small

<a id="u43"></a>

#### ✅ U43 · [low] While the palette fades out, its list jumps back to the default results

- **Where:** `components/studio/command-palette/command-palette-provider.tsx:45`
- **What happens:** After every selection or Escape, the list briefly flashes to a list of files while the palette fades out.
- **Why:** The search is reset as soon as closing starts, not when the fade ends.
- **Fix:** Reset the search when the close animation finishes, and keep results frozen while fading.
- **Effort:** trivial

<a id="u44"></a>

#### ✅ U44 · [low] The theme toggle command throws away the user's chosen theme

- **Where:** `components/studio/command-palette/command-registry.ts:208`
- **What happens:** On Tokyo Night, run "Switch to Light Theme" then "Switch to Dark Theme" and you end up on Scrivon Dark.
- **Why:** The toggle always jumps to the Scrivon light or dark theme.
- **Fix:** Toggle to the theme's matching pair (or the last-used theme of that kind), and add a palette command for each theme.
- **Effort:** small

<a id="u45"></a>

#### ✅ U45 · [low] Some commands are enabled when they can't do anything

- **Where:** `components/studio/command-palette/command-registry.ts:139` and `:159`
- **What happens:** "Close Other Tabs" with only one tab, or "Fit Diagram" on a Markdown tab, just closes the palette and does nothing.
- **Why:** Their enabled checks are too loose.
- **Fix:** Use the tab count and the canvas's "can fit" flag (moving that provider higher up), with clear disabled reasons.
- **Effort:** small

<a id="u46"></a>

#### ✅ U46 · [low] A one-character Chinese or Japanese query never searches file contents

- **Where:** `components/studio/command-palette/use-palette-search.ts:58`
- **What happens:** Typing a single character like 図 in Find in Workspace finds nothing, even though many files contain it.
- **Why:** Text search needs at least two characters, and a single CJK character is a whole word.
- **Fix:** Allow single CJK characters (and any single character in Find in Workspace), and count real characters, not code units. Add tests.
- **Effort:** trivial

<a id="u47"></a>

#### ✅ U47 · [low] About dialog copy and spelling: omits Markdown, no repo/website/copyright, mixed Licence/License

- **Where:** `components/studio/dialogs/about-dialog.tsx:28`
- **What happens:** About describes only Mermaid editing, has no project link or copyright, offers no way to copy version info or check for updates, and mixes "Licence" and "License".
- **Why:** The text wasn't updated as features were added.
- **Fix:** Rewrite the description, add the repo link and copyright, add "Copy version info" and "Check for updates", and use "licence" throughout.
- **Effort:** small

<a id="u48"></a>

#### ✅ U48 · [low] Long file names without spaces overflow the delete confirmation dialog

- **Where:** `components/studio/dialogs/delete-confirm-provider.tsx:73`
- **What happens:** A long name with no spaces (like a long snake_case name) runs past the right edge of the delete dialog.
- **Why:** The text has no rule allowing it to wrap anywhere.
- **Fix:** Add `wrap-anywhere` to the description, and optionally show the name in bold.
- **Effort:** trivial

<a id="u49"></a>

#### ✅ U49 · [low] Prompt and explorer wording is generic or inaccurate

- **Where:** `components/studio/dialogs/name-prompt-provider.tsx:10`
- **What happens:** Every prompt hints "diagram.mmd", even for folders. The rename dialog just says "Rename", create prompts don't say which folder, messages leave out `.mermaid`, and long names have no tooltip.
- **Why:** Fixed placeholder and generic text throughout.
- **Fix:** Pass a placeholder and a description naming the target folder, name the item in the rename title, share one supported-extensions label, and add tooltips.
- **Effort:** small

<a id="u50"></a>

#### ✅ U50 · [low] Licences dialog: the filter box scrolls out of view, because the Accordion's own scroll container never activates

- **Where:** `components/studio/dialogs/open-source-licenses-dialog.tsx:43`
- **What happens:** Scroll down the licence list and the "Filter packages" box scrolls away with it.
- **Why:** The inner scroll area meant to hold the list never kicks in, so the whole panel scrolls.
- **Fix:** Move the filter box above the scroll panel and use one scroll area. Optionally stop matching licence body text.
- **Effort:** trivial

<a id="u51"></a>

#### ✅ U51 · [low] Release notes renderer lacks GFM/list/code styling and only shows the target version

- **Where:** `lib/updater/release-notes.ts:11` (and `components/studio/dialogs/release-notes-content.tsx:28`)
- **What happens:** Someone jumping from 1.3.0 to 1.4.2 only sees the 1.4.2 notes and never hears about the bigger features in between. Tables and numbered lists in notes don't display properly.
- **Why:** Only one release's notes are fetched, and the notes renderer has no table or list support.
- **Fix:** Fetch and join the notes of every release since the installed version, and add `remark-gfm` plus styles for numbered lists, code and tables. Add a test.
- **Effort:** small

<a id="u52"></a>

#### ✅ U52 · [low] Ctrl+Click 'Follow link' in the editor does nothing

- **Where:** `components/studio/editor/code-editor-panel.tsx:167`
- **What happens:** Hover a URL in the editor and it says "Follow link (ctrl + click)", but clicking does nothing.
- **Why:** The editor tries to open a new browser window, which Tauri quietly blocks.
- **Fix:** Register an editor link handler that opens the URL with the opener plugin.
- **Effort:** trivial

<a id="u53"></a>

#### ✅ U53 · [low] Opening or creating a file does not put focus in the editor

- **Where:** `components/studio/editor/code-editor-panel.tsx:98` (callers at `workspace-session-context.tsx:160`, `use-palette-search.ts:235-241`; dialogs at `name-prompt-provider.tsx:80`, `command-palette-dialog.tsx:153`)
- **What happens:** After naming a new file and pressing Enter, your typing goes nowhere until you click into the editor. The same happens after opening a file from the palette.
- **Why:** Nothing asks the editor to take focus, and closing dialogs hand focus back to the button that opened them.
- **Fix:** Add a "focus editor" hook that runs after creating or opening a file, and stop closing dialogs from pulling focus back.
- **Effort:** small

<a id="u54"></a>

#### ✅ U54 · [low] Jumping to a text-search hit places a bare caret and may lose editor focus

- **Where:** `components/studio/editor/code-editor-panel.tsx:86`
- **What happens:** Picking a search result puts the cursor at the match but doesn't highlight the matched text, so it's hard to spot on long lines.
- **Why:** The match length is known but never passed to the editor.
- **Fix:** Pass the length through to the editor and select the matched range.
- **Effort:** small

<a id="u55"></a>

#### ✅ U55 · [low] Different monospace fonts in the editor and the preview, and a duplicate Inter instance

- **Where:** `components/studio/editor/code-editor-panel.tsx:27`
- **What happens:** The same code looks different side by side: Consolas in the editor, Geist Mono in the preview.
- **Why:** The editor uses a hardcoded font list instead of the app's code font. Inter is also loaded twice.
- **Fix:** Use the app's monospace font in the editor (re-measuring once it loads), optionally add an editor font setting, and remove the duplicate Inter.
- **Effort:** small

<a id="u56"></a>

#### ✅ U56 · [low] Export button is enabled with no tab open and opens an empty menu

- **Where:** `components/studio/editor/document-export-menu.tsx:57`
- **What happens:** Close every tab and click the export icon: an empty little menu opens.
- **Why:** The disabled check misses the "no tab open" case.
- **Fix:** Disable the button when no document is open, with a tooltip saying why.
- **Effort:** trivial

<a id="u57"></a>

#### ✅ U57 · [low] Files with the same name in different folders get identical tab labels

- **Where:** `components/studio/editor/editor-tab-bar.tsx:86`
- **What happens:** Open docs/api/README.md and docs/guide/README.md and you get two tabs both labelled "README.md".
- **Why:** Tabs show only the file name.
- **Fix:** When names clash, add a small folder hint to the tab ("api", "guide"), and keep the path in the tooltip even when there's a save error.
- **Effort:** small

<a id="u58"></a>

#### ✅ U58 · [low] Right-clicking a tab switches to it, so 'Close' from the menu leaves you on a different tab

- **Where:** `components/studio/editor/editor-tab-context-menu.tsx:16`
- **What happens:** Right-click a background tab and choose Close, and you end up on its neighbour instead of the tab you were working in. Even pressing Escape leaves you on the clicked tab.
- **Why:** Opening the menu makes the clicked tab active first.
- **Fix:** Don't switch tabs on right-click; optionally highlight the tab while its menu is open. Add a test.
- **Effort:** trivial

<a id="u59"></a>

#### ✅ U59 · [low] Subtitle/Author/Date fields often do nothing, and the PDF has no Author/Subject properties

- **Where:** `lib/markdown/export-metadata.ts:9` (also `components/studio/editor/pdf-export-dialog.tsx:100`, `src-tauri/src/page_numbers.rs:1061`, `src-tauri/src/pdf_export.rs:149`)
- **What happens:** With the default profile, the author you type in the export dialog appears nowhere in the PDF, not even in File > Properties.
- **Why:** These fields only feed the title page (off by default), and the PDF's own document properties are never written.
- **Fix:** Support more placeholders with a default date (B98), explain in the dialog when the title page is off, and write Title, Author and Subject into the PDF.
- **Effort:** medium

<a id="u60"></a>

#### ✅ U60 · [low] Mermaid error text can't be selected or copied, and the Expand button covers the block's top-right corner

- **Where:** `components/studio/markdown/embedded-mermaid-block.tsx:24` (and `:87-101`, `:108-115`)
- **What happens:** You can't select an embedded diagram's error message to copy or search it, and the Expand button sits over the top-right of wide diagrams.
- **Why:** The error card ignores the mouse, and the button floats over the content area.
- **Fix:** Allow text selection on the error card, and reserve a strip or header row for the Expand button.
- **Effort:** trivial

<a id="u61"></a>

#### ✅ U61 · [low] Embedded diagrams first paint at full size, then shrink (layout jump on every mount)

- **Where:** `components/studio/markdown/embedded-mermaid-block.tsx:55`
- **What happens:** Switching to a Markdown tab with wide diagrams shows a too-tall box that then snaps smaller, pushing the text around.
- **Why:** The container width is measured only after the first paint, and measured bounds are forgotten on every remount.
- **Fix:** Measure the width before paint (`useLayoutEffect`), and remember bounds per diagram.
- **Effort:** small

<a id="u62"></a>

#### ✅ U62 · [low] Code blocks flash to plain uncolored text while typing in them and on every theme toggle

- **Where:** `components/studio/markdown/fenced-code-block.tsx:118`
- **What happens:** A code block loses its colours while you type in it, and briefly when you first switch between light and dark.
- **Why:** Plain text replaces the coloured version until a 400 ms quiet period passes.
- **Fix:** Colour code immediately once the highlighter is ready, keep the old colours while waiting, and optionally use two-theme CSS so theme changes need no re-colouring.
- **Effort:** small

<a id="u63"></a>

#### ✅ U63 · [low] Preview code blocks always use GitHub Light/Dark colors, whatever palette is chosen

- **Where:** `components/studio/markdown/fenced-code-block.tsx:106`
- **What happens:** On Dracula, Nord, Solarized or Tokyo Night, code in the preview uses GitHub's colours on the theme's background.
- **Why:** Only the two GitHub code themes are loaded.
- **Fix:** Map each app theme to its matching code theme and load it on demand, keeping GitHub as the fallback.
- **Effort:** small

<a id="u64"></a>

#### ✅ U64 · [low] h5/h6 headings, long URLs and inline images aren't styled

- **Where:** `components/studio/markdown/markdown-preview.tsx:54`
- **What happens:** Level 5 and 6 headings look like plain text, a long URL makes the whole preview scroll sideways, and a row of README badges stacks vertically.
- **Why:** There are no styles for h5/h6, no word-wrap rule, and images default to block layout.
- **Fix:** Add h5/h6 styles, `overflow-wrap: anywhere` on the article, and an inline image style. Match in the PDF styles.
- **Effort:** trivial

<a id="u65"></a>

#### ✅ U65 · [low] 'Tab size' is overridden by indentation detection, and 'Word wrap: At column' has no column setting

- **Where:** `components/studio/editor/code-editor-panel.tsx:147`
- **What happens:** Set Tab size to 2 and Tab still inserts 4 spaces in files that already use 4. "At column" wraps at a hidden 80 columns that doesn't fit the default pane.
- **Why:** The editor's automatic indentation detection is left on, and there's no wrap-column setting.
- **Fix:** Add settings for "detect indentation", "insert spaces" and "wrap column", pass them to the editor, and make the horizontal scrollbar available.
- **Effort:** small

<a id="u66"></a>

#### ✅ U66 · [low] Conflict handling is a dead end, and the error isn't tied to a row and can go stale

- **Where:** `components/studio/settings/sections/keyboard-settings.tsx:46`
- **What happens:** "Already assigned to X" appears at the top of the page with no way to reassign, and stays there even while you edit a different row. Changed rows aren't marked.
- **Why:** There is one shared error message that's rarely cleared, and no "reassign" action.
- **Fix:** Show the error in the row being edited with Reassign and Cancel, clear it when editing starts, mark changed rows and disable Reset on defaults.
- **Effort:** small

<a id="u67"></a>

#### ✅ U67 · [low] TOC depth 'H1' plus 'Exclude H1 from TOC' (on by default) silently produces no table of contents

- **Where:** `components/studio/settings/sections/pdf-export-settings.tsx:310`
- **What happens:** With TOC on, depth H1 and "Exclude H1" left on, the exported file has no contents page and no message.
- **Why:** The two settings cancel each other out and nothing warns you.
- **Fix:** Disable "Exclude H1" at depth H1 (or show a warning), and show a toast when the contents page ends up empty.
- **Effort:** small

<a id="u68"></a>

#### ✅ U68 · [low] Settings footer: 'Restore defaults' ends up right next to 'Done' instead of on the left

- **Where:** `components/studio/settings/settings-dialog.tsx:59`
- **What happens:** "Restore defaults" sits right next to "Done", where people expect a Cancel button.
- **Why:** A built-in "align right" rule beats the intended "space between" layout on wide screens.
- **Fix:** Use `sm:justify-between` on the footer.
- **Effort:** trivial

<a id="u69"></a>

#### ✅ U69 · [low] Settings sections: scroll position carries over between sections, no section heading, and unnamed scroll tab stops

- **Where:** `components/studio/settings/settings-dialog.tsx:54`
- **What happens:** Scroll down Document export, switch to Appearance, and it opens at the bottom. Screen-reader users don't hear that the section changed.
- **Why:** One scroll area is reused for every section, with no heading or label.
- **Fix:** Reset the scroll area on section change, add a heading for each section, label the scroll region, and fix the nested height so there's only one scroller.
- **Effort:** small

<a id="u70"></a>

#### ✅ U70 · [low] Menu items show no keyboard shortcuts and ignore user-configured keybinds

- **Where:** `components/studio/shell/studio-menu-bar.tsx:112`
- **What happens:** The Options and View menus never show shortcuts like Ctrl+B or Ctrl+E, even after you change them in Settings.
- **Why:** The menu's shortcut label component exists but isn't used.
- **Fix:** Show each item's current shortcut in the menu, and add Command Palette, Go to File and Save entries.
- **Effort:** small

<a id="u71"></a>

#### ✅ U71 · [low] Welcome copy shows literal backticks; drive-root folders get an empty name

- **Where:** `components/studio/shell/welcome-screen.tsx:25` (and `lib/tauri/fs.ts:101`, `welcome-screen.tsx:51`)
- **What happens:** The welcome text shows backtick characters around `.md` and `.mmd`, and leaves out `.mermaid`. A folder at a drive root like D:\ shows a blank name.
- **Why:** The text is plain, not formatted, and the "base name" of a drive root is empty.
- **Fix:** Use proper code styling and list all three extensions, and return the full path as the name for drive roots. Add tests.
- **Effort:** trivial

<a id="u72"></a>

#### ✅ U72 · [low] Welcome-screen 'desktop app required' banner uses hard-coded amber-100 text, unreadable in light themes

- **Where:** `components/studio/shell/welcome-screen.tsx:31`
- **What happens:** In a light theme, the warning text is nearly invisible. Only developers running the app in a plain browser see this banner.
- **Why:** The colour is hardcoded for dark backgrounds.
- **Fix:** Use the theme's warning colour tokens.
- **Effort:** trivial

<a id="u73"></a>

#### ✅ U73 · [low] Paths with Hebrew or Arabic folder names show their folders in reverse order, and RTL names get cut off at the wrong end

- **Where:** `components/studio/shell/welcome-screen.tsx:65` (plus a shared helper in `lib/tauri/fs.ts` near line 101)
- **What happens:** A path with two Hebrew folder names shows them swapped, and long right-to-left names lose their beginning instead of their end.
- **Why:** Paths and names have no text-direction isolation.
- **Fix:** Add a `displayPath` helper that keeps folder order, and set `dir="auto"` on file names and text inputs.
- **Effort:** small

<a id="u74"></a>

#### ✅ U74 · [low] Title bar is Windows-only: no macOS traffic lights or native layout, no Snap Layouts, no system menu, window title never updates

- **Where:** `components/studio/shell/studio-menu-bar.tsx:165`
- **What happens:** On Windows 11, hovering maximise doesn't show Snap Layouts, right-clicking the title bar shows no Move/Size menu, and the taskbar always just says "Scrivon".
- **Why:** The custom frameless title bar doesn't hook into these native features, and the window title is never set.
- **Fix:** Set the window title from the active file and folder, add a native system-menu command on right-click, and consider Snap Layouts support (F42). macOS only matters if a Mac build is added.
- **Effort:** medium

<a id="u75"></a>

#### ✅ U75 · [low] 'Unsupported file' messages leave out .mermaid, which is supported

- **Where:** `lib/workspace/file-types.ts:12` (used in `document-tabs-context.tsx:132`, `workspace-session-context.tsx:153` and `:187`, `file-tree-node.tsx:42`)
- **What happens:** Messages say Scrivon supports only .md and .mmd, though .mermaid works too.
- **Why:** The text is hardcoded in four places.
- **Fix:** Add one shared "supported extensions" label and use it everywhere. Update the test.
- **Effort:** trivial

<a id="u76"></a>

#### ✅ U76 · [low] Duplicating a non-.md/.mmd file shows an error after copying; renaming such files is blocked

- **Where:** `components/studio/workspace/workspace-session-context.tsx:186`
- **What happens:** Duplicate logo.png and you get "Unsupported file" even though the copy worked. Renaming logo.PNG to logo.png is refused.
- **Why:** The copy is always opened in a tab, and renaming requires a Markdown or Mermaid extension.
- **Fix:** Only open the copy if it's a supported type, and only check extensions when renaming supported documents.
- **Effort:** trivial

<a id="u77"></a>

#### ✅ U77 · [low] Re-opening the folder that is already open is not short-circuited

- **Where:** `components/studio/workspace/workspace-session-context.tsx:85`
- **What happens:** Picking the folder you're already in from Open Recent makes the editor flash empty and lose undo history.
- **Why:** There's no "this is the same folder" check, so everything is torn down and rebuilt.
- **Fix:** If the path is the current folder, just refresh the tree. Mark the current folder in the menus. Add a test.
- **Effort:** small

<a id="u78"></a>

#### ✅ U78 · [low] Settings rows: switches aren't right-aligned (ragged), while steppers and selects stretch to full width

- **Where:** `components/studio/settings/switch-setting.tsx:20`
- **What happens:** Switches sit at different positions depending on the text length, while a tiny tab-size field stretches across the whole column.
- **Why:** Switch rows don't fill the width, and number fields and selects always do.
- **Fix:** Make switch rows full width, and give number fields and short selects a fixed width.
- **Effort:** small

<a id="u79"></a>

#### ✅ U79 · [low] Disabled-state styling gaps: stepper buttons look clickable at min/max, and the disabled autosave-delay label isn't dimmed

- **Where:** `components/ui/number-field.tsx:66`
- **What happens:** At the maximum font size, the "+" button still lights up on hover and does nothing. With autosave off, the delay label still looks active.
- **Why:** The stepper buttons have no disabled styles, and the field's label doesn't know the control is disabled.
- **Fix:** Add disabled styles to the stepper buttons and pass `disabled` to the whole field.
- **Effort:** trivial

<a id="u80"></a>

#### ✅ U80 · [low] New .mmd files start with a 28-line, 12-node sample architecture that users must delete

- **Where:** `lib/default-diagram.ts:1`
- **What happens:** Every new diagram starts with a large sample system diagram you have to delete first.
- **Why:** The default template is a full architecture example.
- **Fix:** Replace it with a short three-box starter (the big sample already exists in Examples).
- **Effort:** trivial

<a id="u81"></a>

#### ✅ U81 · [low] New .md files get a generic '# Document' template with a sample diagram, and empty files show a blank preview

- **Where:** `components/studio/workspace/workspace-session-context.tsx:156`
- **What happens:** Every new note starts with "# Document" and a sample diagram, and exports are titled "Document" unless you change it. An empty file shows a blank preview.
- **Why:** The template is fixed, and the preview has no empty state.
- **Fix:** Title new files from their file name, use a smaller starter, and show "Start writing Markdown to see a preview" when empty. Add tests.
- **Effort:** small

<a id="u82"></a>

#### ✅ U82 · [low] In bundled sequence examples, lifelines run through message labels and one label overflows its alt frame

- **Where:** `lib/mermaid/render.ts:28` (sample at `lib/examples/craft-samples.ts:610`)
- **What happens:** In sequence diagrams, dashed lifelines run straight through message labels, and one sample label sticks out of its frame.
- **Why:** The diagram library draws labels with no background behind them.
- **Fix:** Add a thin background-coloured outline behind sequence message text, shorten the sample label, and report the frame-width issue upstream.
- **Effort:** trivial

<a id="u83"></a>

#### ✅ U83 · [low] Word files list 'Un-named' as author and last modified by when no author is given

- **Where:** `lib/markdown/export-docx.ts:1338`
- **What happens:** Exported Word files show "Un-named" as the author and last editor in File > Info.
- **Why:** The docx library fills in "Un-named" when no author is passed.
- **Fix:** Pass empty strings (or the real author) for both fields. Add a test.
- **Effort:** trivial

<a id="u84"></a>

#### ✅ U84 · [low] Oversized code blocks and tables leave most of the previous page blank

- **Where:** `lib/markdown/export-html-css.ts:221` (and `lib/markdown/markdown-to-export-html.ts:60`, `:62`)
- **What happens:** A long code block or table after a paragraph leaves that page mostly empty, and the heading before it is stranded.
- **Why:** Every block is told to stay on one page, however long it is.
- **Fix:** Only keep short blocks and tables together, and keep headings with what follows. Add tests.
- **Effort:** small

<a id="u85"></a>

#### ✅ U85 · [low] Save dialog doesn't start in the document's folder

- **Where:** `lib/markdown/export-pdf.ts:140`
- **What happens:** Exporting spec.md opens the save box in some unrelated folder instead of next to the file.
- **Why:** Only a bare file name is passed to the save box.
- **Fix:** Pass the document's folder plus the file name (falling back to the bare name for examples). Do the same for SVG and PNG.
- **Effort:** small

<a id="u86"></a>

#### ✅ U86 · [low] Shortcut labels: Space shows as blank, Windows key shows as 'Meta', multiple chords look like a key sequence

- **Where:** `lib/settings/format-keybind.ts:31`
- **What happens:** A Ctrl+Space shortcut shows as "Ctrl+ " with a blank, and the plus key shows as "Ctrl++".
- **Why:** The space character isn't mapped to a label, and alternatives are joined with a space.
- **Fix:** Label Space, Plus and the Windows key properly, and join alternatives with " / ". Add tests.
- **Effort:** small

<a id="u87"></a>

#### ✅ U87 · [low] The font lists show duplicate entries, mix every font into all three pickers, and have no search

- **Where:** `lib/settings/pdf-export-fonts.ts:48-60` (and `components/studio/settings/sections/pdf-export-settings.tsx:84-105`)
- **What happens:** Arial, Segoe UI and others appear twice side by side, and hundreds of fonts (including symbol fonts) are in every picker with no way to search.
- **Why:** Duplicates are removed by CSS value rather than name, and there's no grouping or filter.
- **Fix:** Remove duplicates by font name, group built-in and system fonts, show only monospace fonts in the code picker, and add a search box.
- **Effort:** medium

<a id="u88"></a>

#### ✅ U88 · [low] Explorer sorts numbers as text ('chapter10' before 'chapter2')

- **Where:** `lib/tauri/fs.ts:12`
- **What happens:** chapter1, chapter10, chapter2 appear in that order.
- **Why:** Names are compared as plain text.
- **Fix:** Sort with `Intl.Collator` using `numeric: true`. Add a test.
- **Effort:** trivial

<a id="u89"></a>

#### ✅ U89 · [low] First launch ignores the OS light/dark setting: boot script shows the system theme, then React forces Scrivon Dark and saves it

- **Where:** `lib/settings/migrate.ts:65`
- **What happens:** On a fresh install with Windows in light mode, the app flashes light, switches to dark, and stays dark.
- **Why:** The default theme is hardcoded to dark and saved straight away.
- **Fix:** Use the OS-preferred theme on first run and for unknown saved themes. Add tests.
- **Effort:** small

<a id="u90"></a>

#### ✅ U90 · [low] Update toast stays on screen above the update dialog when the dialog is opened from the menu-bar button

- **Where:** `components/studio/app-update-provider.tsx:76`
- **What happens:** Open the update dialog from the menu-bar icon and the "Update available" toast stays floating on top of it for the rest of the session.
- **Why:** The toast is never dismissed when the dialog opens.
- **Fix:** Dismiss the toast whenever the update dialog opens.
- **Effort:** trivial

<a id="u91"></a>

#### ✅ U91 · [low] The app never sets its taskbar ID (AppUserModelID), so after an update or an Explorer launch it shows as a second taskbar button next to the pinned one

- **Where:** `src-tauri/src/lib.rs:22`
- **What happens:** After an update, the relaunched app shows as a second taskbar button next to your pinned Scrivon icon.
- **Why:** Windows groups windows with pinned icons by an app ID, which Scrivon never sets for itself.
- **Fix:** Set the app ID to the identifier at startup, and add an installer hook that fixes older shortcuts.
- **Effort:** small

<a id="u92"></a>

#### ✅ U92 · [low] Window background is hard-coded #161616, so light-theme users get a dark flash at every launch and dark flicker when resizing

- **Where:** `src-tauri/tauri.conf.json:19` (and `components/theme/app-theme-provider.tsx:23`)
- **What happens:** With a light theme, the window opens as a dark box before turning light, and dark bands can flash at the edge while resizing.
- **Why:** The window background is fixed to the dark theme's colour and shown before the page has painted.
- **Fix:** Start the window hidden, set its background from the current theme, and show it after the first paint (with a Rust safety timer).
- **Effort:** small

<a id="u93"></a>

#### ✅ U93 · [low] Installers use stock NSIS/WiX branding and have no support links, licence page or shortcut choice

- **Where:** `src-tauri/tauri.conf.json:26`
- **What happens:** The setup wizard shows stock artwork and "Nullsoft Install System" in its footer, Apps & features has no website link, and the MSI always creates a desktop shortcut.
- **Why:** No publisher, copyright, homepage or installer images are configured.
- **Fix:** Add publisher, copyright, homepage and Scrivon artwork. Take care with the registry-key change this causes (see B126).
- **Effort:** small

## Accessibility (A)

<a id="a01"></a>

#### ✅ A01 · [medium] Editor is a keyboard trap with no hint how to leave, plus a generic accessible name

- **Where:** `components/studio/editor/code-editor-panel.tsx:143`
- **What happens:** Inside the editor, Tab indents instead of moving on, so a keyboard user can't reach the preview unless they happen to know Ctrl+M. Screen readers announce every file as just "Editor content".
- **Why:** No accessible label is set, and the editor's "Tab moves focus" mode is never mentioned or offered as a setting.
- **Fix:** Give the editor a label with the file name and a Ctrl+M hint, and add a "Tab key moves focus" setting.
- **Effort:** small

<a id="a02"></a>

#### ✅ A02 · [medium] Tab bar has no tablist semantics, and unsaved, saving, read-only and save-error states are hidden from assistive tech

- **Where:** `components/studio/editor/editor-tab-bar.tsx:68-88`
- **What happens:** Screen-reader users can't tell which tab is active, which have unsaved changes, which are read-only examples, or which failed to save. Arrow keys don't move between tabs, and switching tabs doesn't scroll the new one into view.
- **Why:** Tabs are plain buttons, and the status icons are hidden from assistive tech with no text alternative.
- **Fix:** Use tab-list roles with `aria-selected` and arrow-key movement, add hidden status text, show a visible error icon, and scroll the active tab into view.
- **Effort:** small

<a id="a03"></a>

#### ✅ A03 · [medium] Hover-only controls stay invisible when keyboard users focus them (file actions, tab close, remove recent)

- **Where:** `components/studio/explorer/file-tree-context-menu.tsx:90`
- **What happens:** Keyboard users tab onto invisible "..." buttons in the explorer, invisible tab close buttons, and an invisible "Remove from recents" button that removes a folder when you press Enter.
- **Why:** These controls only appear on mouse hover, with no rule to show them on keyboard focus.
- **Fix:** Show them on focus (`focus-visible` and `group-focus-within`), and move the "..." button out of the row button (see B23).
- **Effort:** small

<a id="a04"></a>

#### ✅ A04 · [medium] File tree has no tree semantics or keyboard navigation

- **Where:** `components/studio/explorer/file-tree-node.tsx:35`
- **What happens:** Arrow keys do nothing in the file tree, there's no F2 to rename or Delete to delete, and screen readers can't tell folders from files or whether a folder is open. A 200-file tree takes about 400 Tab presses.
- **Why:** The tree is plain buttons with no tree roles and no key handling.
- **Fix:** Use proper tree roles with one focusable item at a time, and add arrow, Home/End, Enter, F2, Delete and Shift+F10 keys.
- **Effort:** medium

<a id="a05"></a>

#### ✅ A05 · [medium] Expanded markdown diagram overlay doesn't manage focus: Escape does nothing and content behind stays reachable

- **Where:** `components/studio/markdown/markdown-document-viewer.tsx:85-108` (also `components/studio/markdown/embedded-mermaid-block.tsx:95`)
- **What happens:** After expanding a diagram, Escape doesn't close it, Tab moves through hidden links behind it, and pressing Back drops focus to the top of the window. Every Expand button has the same name.
- **Why:** The overlay doesn't move focus, doesn't block the content behind it, and has no Escape handler.
- **Fix:** Make the content behind inert, focus Back when it opens, close on Escape and return focus to the Expand button. Give each Expand button a unique label.
- **Effort:** small

<a id="a06"></a>

#### ✅ A06 · [medium] Links in the markdown preview look the same as body text

- **Where:** `components/studio/markdown/markdown-preview.tsx:64`
- **What happens:** You can't see where the links are in the preview; they only show an underline when hovered.
- **Why:** Links differ from body text by just 10% opacity, with no underline or distinct colour.
- **Fix:** Use one shared link style that is always underlined and has a clear focus ring, in the preview and dialogs.
- **Effort:** trivial

<a id="a07"></a>

#### ✅ A07 · [medium] Menu bar is four independent modal Menus, not a menubar: no Alt/F10, no arrow keys between menus, two clicks to switch

- **Where:** `components/studio/shell/studio-menu-bar.tsx:80`
- **What happens:** Alt or F10 doesn't focus the menu bar, Left/Right arrows don't move between menus, and with File open, clicking Options only closes File.
- **Why:** Each menu is a separate modal menu instead of one menu bar.
- **Fix:** Wrap the menus in Base UI's `Menubar` (non-modal), and add F10/Alt focus handling. Optionally add mnemonics and shortcut hints.
- **Effort:** small

<a id="a08"></a>

#### ✅ A08 · [medium] Focus indicators and selection highlights disappear in Windows Contrast Themes (forced colors)

- **Where:** `app/globals.css:247`
- **What happens:** With a Windows contrast theme on, you can't see keyboard focus or which menu item is highlighted, and switches vanish entirely.
- **Why:** Focus is drawn with shadows and highlights with background colours, and contrast mode removes both.
- **Fix:** Add a contrast-mode CSS block that uses system Highlight colours for focus outlines, highlighted rows and switches. Test with Night sky and Desert.
- **Effort:** small

<a id="a09"></a>

#### ✅ A09 · [medium] Hidden marker codes (SFH0001, SFT0001, SFPN) stay in the PDF's text

- **Where:** `src-tauri/src/page_numbers.rs:1033` (markers added in `lib/markdown/markdown-to-export-html.ts:35`)
- **What happens:** Copying a heading from the PDF gives "SFH0002Section", search finds the codes, and screen readers read "S F P N" in every footer.
- **Why:** The invisible markers used to place page numbers are real text, and the stamper never removes them.
- **Fix:** After stamping, blank out the marker text, mark stamped labels as page decoration for screen readers, and skip the markers entirely on non-Windows. Add tests.
- **Effort:** medium

<a id="a10"></a>

#### ✅ A10 · [medium] Secondary text color (`--muted-foreground`) fails WCAG contrast in 15 of 17 themes, including the default Scrivon Light (2.38:1)

- **Where:** `lib/theme/resolve-theme-tokens.ts:37` and `lib/theme/semantic-vars.ts:80`
- **What happens:** Grey helper text (welcome tagline, recent paths, empty states, keybind labels, editor line numbers) is hard to read in almost every theme.
- **Why:** Muted text is a 40% mix, or the diagram palette's faint colour, which is far below the 4.5:1 contrast readable text needs.
- **Fix:** Add a separate muted text colour that is adjusted until it reaches 4.5:1 against the background, use it for UI text and line numbers, and test every theme.
- **Effort:** small

<a id="a11"></a>

#### ✅ A11 · [medium] Shift+Tab is blocked app-wide, so keyboard users cannot move focus backwards

- **Where:** `src-tauri/src/prevent_browser_shortcuts.rs:11` and `:15`
- **What happens:** Pressing Shift+Tab in Settings, dialogs, menus or the explorer doesn't move focus back.
- **Why:** The browser-shortcut blocker includes the "focus move" flag, which cancels Shift+Tab.
- **Fix:** Leave that flag out in both debug and release builds, with a comment explaining why.
- **Effort:** trivial

<a id="a12"></a>

#### ✅ A12 · [low] Raw buttons fall back to a faint, partly clipped default focus ring

- **Where:** `app/globals.css:249`
- **What happens:** When you Tab to a document tab, title-bar button or settings item, the focus ring is barely visible and its edges are cut off.
- **Why:** These buttons use the browser's default ring at half strength, drawn outside the button where it gets clipped.
- **Fix:** Use a full-strength ring drawn inside the button, and show hidden close buttons when they get focus.
- **Effort:** small

<a id="a13"></a>

#### ✅ A13 · [low] Command palette has no accessible name, and its disabled reasons and unsaved markers are invisible to assistive tech

- **Where:** `components/studio/command-palette/command-palette-dialog.tsx:153`
- **What happens:** Screen readers announce an unnamed dialog, never hear why a command is disabled or that a file is unsaved, and don't hear result counts.
- **Why:** There's no dialog title, disabled reasons are only in tooltips, and the unsaved dot isn't exposed.
- **Fix:** Add a hidden title and an input label, show disabled reasons as text, add hidden "unsaved changes" text, and announce result counts politely.
- **Effort:** small

<a id="a14"></a>

#### ✅ A14 · [low] Editor resize handle is mouse-only: not focusable and has no value

- **Where:** `components/studio/editor/code-editor-panel.tsx:222`
- **What happens:** Keyboard users can't change the editor's width at all.
- **Why:** The divider can't be focused and has no key handling.
- **Fix:** Make it focusable, move it with arrow keys (Shift for bigger steps), expose its value, and reset it on double-click.
- **Effort:** small

<a id="a15"></a>

#### ✅ A15 · [low] Keyboard focus is dropped to the page body after closing a tab, hiding a pane, deleting or renaming a file, or leaving the expanded diagram

- **Where:** `components/studio/editor/editor-tab-bar.tsx:88`
- **What happens:** After closing a tab with the keyboard, hiding a panel, renaming or deleting a file, or leaving the expanded diagram, the focus ring disappears and screen readers lose their place.
- **Why:** The focused element is removed and focus isn't moved anywhere else.
- **Fix:** In each case, move focus to a sensible neighbour (next tab, active tab, renamed row, or the Expand button).
- **Effort:** small

<a id="a16"></a>

#### ✅ A16 · [low] Icon-only buttons explain themselves only through mouse-hover `title` tooltips

- **Where:** `components/studio/editor/editor-tab-bar.tsx:96`
- **What happens:** Keyboard users see icons with no label, the "New" button has no label at all, and the Fit button's "Expand a Mermaid block to fit" hint can never appear, even on hover.
- **Why:** Labels are native tooltips that don't show on focus, and disabled buttons ignore the mouse.
- **Fix:** Use the existing Base UI tooltip (it opens on focus), and make Fit use `aria-disabled` so it stays focusable.
- **Effort:** small

<a id="a17"></a>

#### ✅ A17 · [low] Layout toggle buttons do not expose pressed state or their shortcuts

- **Where:** `components/studio/editor/layout-toggle-buttons.tsx:12`
- **What happens:** Screen readers don't say whether the explorer or editor is shown, and the buttons don't mention Ctrl+B or Ctrl+E.
- **Why:** No `aria-pressed`, and the titles are fixed text.
- **Fix:** Add `aria-pressed` and include the current shortcut in the title.
- **Effort:** trivial

<a id="a18"></a>

#### ✅ A18 · [low] Every row in the explorer reads as 'name File actions' because the actions button is nested inside the row button

- **Where:** `components/studio/explorer/file-tree-node.tsx:57-61` (and `file-tree-context-menu.tsx:83-92`)
- **What happens:** Screen readers announce each file as "notes.md File actions, button".
- **Why:** The actions button sits inside the row button, so its label merges into the row's name.
- **Fix:** Make the actions button a separate sibling with its own label naming the file, visible on focus.
- **Effort:** small

<a id="a19"></a>

#### ✅ A19 · [low] Animations ignore the reduced-motion preference

- **Where:** `app/globals.css:247` (and `components/studio/settings/keybind-capture.tsx:59`)
- **What happens:** With Windows animations turned off, the shortcut recorder still pulses forever and error toasts still shake.
- **Why:** Nothing checks the "reduce motion" preference.
- **Fix:** Use `motion-safe` for the pulse (with a steady visual cue instead), and add a reduced-motion CSS block that keeps loading spinners working.
- **Effort:** trivial

<a id="a20"></a>

#### ✅ A20 · [low] Theme pickers don't expose which theme is selected

- **Where:** `components/studio/settings/sections/appearance-settings.tsx:24`
- **What happens:** Screen readers don't say which theme is selected in Settings, and the menu presents themes as independent checkboxes.
- **Why:** Settings uses plain buttons, and the menu uses checkbox items for a pick-one choice.
- **Fix:** Use radio-group semantics with a visible check mark in Settings, and radio items in the menu.
- **Effort:** small

<a id="a21"></a>

#### ✅ A21 · [low] Keyboard settings: ten identical 'Edit'/'Clear'/'Reset' buttons, an unannounced conflict error, and no Cancel control

- **Where:** `components/studio/settings/sections/keyboard-settings.tsx:76`
- **What happens:** A screen reader hears "Edit, button" ten times with no context, the conflict error isn't announced, and the only way out of recording is Escape.
- **Why:** Buttons have no row-specific labels, the error has no alert role, and there's no Cancel button.
- **Fix:** Label each button with its action name, announce errors, add a Cancel button, and return focus to the row's Edit button afterwards.
- **Effort:** small

<a id="a22"></a>

#### ✅ A22 · [low] Header and footer export fields have unlabeled colour pickers and duplicate labels

- **Where:** `components/studio/settings/sections/pdf-export-settings.tsx:411`
- **What happens:** The footer colour picker reads as just "Transparent, button", and header and footer fields share identical names, so screen-reader users can't tell them apart.
- **Why:** The colour labels aren't linked to their controls, and the header and footer blocks have no group labels.
- **Fix:** Link labels to the colour pickers, wrap header and footer in labelled groups, and name the Browse and Clear buttons after their field.
- **Effort:** small

<a id="a23"></a>

#### ✅ A23 · [low] Welcome screen 'Remove from recents' button is invisible unless hovered (and unlabeled per folder)

- **Where:** `components/studio/shell/welcome-screen.tsx:70`
- **What happens:** Keyboard users can tab onto an invisible button and remove a folder by pressing Enter, and every row's button has the same label.
- **Why:** The button only appears on hover and its label doesn't name the folder.
- **Fix:** Show it on focus (and always on touch screens), and include the folder name in its label.
- **Effort:** trivial

<a id="a24"></a>

#### ✅ A24 · [low] Theme picker is 4 menu levels deep and uses checkbox semantics for a one-of-many choice

- **Where:** `components/studio/theme/theme-menu.tsx:17-58`
- **What happens:** Picking a theme from the menu takes Options, then Theme, then Dark or Light, then the palette, and screen readers announce checkboxes.
- **Why:** Nested submenus and checkbox items are used for a single choice.
- **Fix:** Use one Theme submenu with "Dark" and "Light" groups of radio items.
- **Effort:** small

<a id="a25"></a>

#### ✅ A25 · [low] Colour picker: hue/alpha sliders have no accessible name and no visible focus, and the colour square can't be used from the keyboard

- **Where:** `components/ui/color-picker.tsx:293`
- **What happens:** Screen readers announce the hue slider as just "slider", there's no visible focus ring, and the colour square needs a mouse.
- **Why:** The label and focus style are on the wrong element, and the square has no keyboard support.
- **Fix:** Put the label on the slider thumb, fix the focus style, and add arrow-key support to the colour square. Add tests.
- **Effort:** small

<a id="a26"></a>

#### ✅ A26 · [low] Exported Word and PDF files have generic or empty alt text and a hard-coded language

- **Where:** `lib/markdown/export-docx.ts:652`
- **What happens:** Every diagram in a Word export is described as "Diagram", images without alt text become "image", and PDFs are always tagged as English.
- **Why:** Alt text and language are fixed values.
- **Fix:** Build alt text from the diagram's `accTitle`/`accDescr` or its type and first labels, and set the language from front matter or the user's language.
- **Effort:** small

<a id="a27"></a>

#### ✅ A27 · [low] Hidden buffer iframe stays in the accessibility tree and tab order; diagrams have no text alternative

- **Where:** `lib/mermaid/svg-iframe.tsx:180`
- **What happens:** Tab lands on invisible diagram frames, screen readers find two frames per diagram (one stale), and diagrams have no description.
- **Why:** The hidden buffer frame is only made transparent, and nothing labels the diagram.
- **Fix:** Make both frames unfocusable and hidden from assistive tech, and label the wrapper as an image (using `accTitle` when present).
- **Effort:** small

## Missing features (F)

<a id="f01"></a>

#### ✅ F01 · [high] Delete is permanent (skips the Recycle Bin), and the confirm dialog gives little detail

- **Where:** `lib/tauri/fs.ts:84` (also `components/studio/dialogs/delete-confirm-provider.tsx:62`, `components/studio/workspace/workspace-session-context.tsx:201`)
- **What happens:** A mistaken delete can't be undone or recovered from the Recycle Bin. The dialog shows only the bare name (ambiguous if several folders have a README.md), not how many files are inside or that open, unsaved tabs will close.
- **Why users want it:** Windows users expect deleted files to land in the Recycle Bin.
- **Why:** Deletes go straight to the file system with no trash step, and the dialog only receives the name.
- **Fix:** Add a Rust `move_to_trash` command (using the `trash` crate) limited to the open folder, show delete errors, and show the relative path, file count and affected tabs in the dialog.
- **Effort:** medium

<a id="f02"></a>

#### ✅ F02 · [high] Images from the workspace never load in the preview (relative and absolute paths)

- **Where:** `components/studio/markdown/markdown-preview.tsx:128` (plus `studio-layout.tsx:42`, `markdown-to-export-html.ts:205`, `export-docx.ts:445`)
- **What happens:** `![](diagram.png)` next to your notes shows a broken image, and a full `C:/` path shows only the alt text.
- **Why users want it:** Local images are a basic expectation in a local-first Markdown editor.
- **Why:** The preview doesn't know the file's folder, has no image handling, and its URL filter removes Windows paths.
- **Fix:** Pass the document path to the preview, resolve image paths against it, load local images through the existing `read_export_image` command (cached), and inline them in exports too.
- **Effort:** medium

<a id="f03"></a>

#### ✅ F03 · [high] Images in the Markdown are never embedded; local images always break and big ones overflow the page

- **Where:** `lib/markdown/export-pdf.ts:124`
- **What happens:** Exported PDF and Word files show local images as broken or missing, remote ones only if they load in time, and large ones run off the page.
- **Why users want it:** Images are a core part of documents people export and share.
- **Why:** The export never gets the file's path and copies image addresses as-is into a blank page.
- **Fix:** Pass the document path to the export, turn every local (and ideally remote) image into embedded data before rendering, warn about any that fail, and add a max-width rule.
- **Effort:** medium

<a id="f04"></a>

#### ✅ F04 · [high] Common Mermaid diagram types and syntax are rejected with a misleading 'Invalid mermaid header' error

- **Where:** `lib/mermaid/render.ts:28`
- **What happens:** Pie charts, Gantt charts, mindmaps, front matter, `graph TD;` with a semicolon, and plain `graph` all fail with "Invalid mermaid header", which suggests a typo. Some unsupported lines are silently dropped.
- **Why users want it:** People paste common Mermaid snippets and expect them to work, or at least to be told clearly what isn't supported.
- **Why:** The rendering library only supports six diagram types and strict headers, and Scrivon passes text straight through.
- **Fix:** Add a `prepareMermaidSource` step (strip front matter, tidy headers), show a friendly "not supported yet" message listing supported types, and list them in the README and empty state. Optionally fall back to the official `mermaid` package later.
- **Effort:** small

<a id="f05"></a>

#### ✅ F05 · [medium] No way to check for updates manually (and no re-check in long sessions)

- **Where:** `components/studio/app-update-provider.tsx:41`
- **What happens:** There's only one automatic check, 4 seconds after launch. If it's turned off, fails, or you leave the app open for days, you never learn about updates, and failures are silent.
- **Why users want it:** People need a way to look for updates on demand and to know they're up to date.
- **Why:** The check isn't exposed anywhere else.
- **Fix:** Turn the check into a reusable function, add Help > Check for Updates…, a button in Settings and a palette command, show "up to date" and "couldn't check" toasts, and handle pre-release builds clearly.
- **Effort:** medium

<a id="f06"></a>

#### ✅ F06 · [medium] No zoom controls, zoom level indicator, or keyboard pan/zoom; reset is a hidden double-click

- **Where:** `components/studio/canvas/use-pan-zoom.ts:85` (and `components/studio/canvas/mermaid-canvas.tsx:101`)
- **What happens:** You can only zoom diagrams with a mouse wheel. There are no zoom buttons, no zoom percentage, and no keyboard way to zoom or pan.
- **Why users want it:** Keyboard and touchpad users need to zoom and move around diagrams, and a zoom readout is standard.
- **Why:** The zoom code has no public zoom functions and the canvas can't be focused.
- **Fix:** Add zoom-by and zoom-to functions, a small floating toolbar with a % readout, keyboard handling on a focusable canvas, and zoom shortcuts and menu items.
- **Effort:** medium

<a id="f07"></a>

#### ✅ F07 · [medium] Command list is missing many app actions (new/rename/delete file, exports, specific themes, About, updates, refresh, Go to File)

- **Where:** `components/studio/command-palette/command-registry.ts:47` (provider order in `components/studio/shell/studio-shell.tsx:37`)
- **What happens:** Typing "export", "new file", "rename", a theme name or "about" in the command palette finds nothing useful.
- **Why users want it:** The palette is the keyboard route to everything in the app.
- **Why:** Only a few actions are registered, and some features live in providers placed below the palette.
- **Fix:** Move those providers up, and add file, export, per-theme, About, update, refresh and mode-switch commands.
- **Effort:** medium

<a id="f08"></a>

#### ✅ F08 · [medium] Mermaid files are highlighted with the Markdown tokenizer; there is no Mermaid language

- **Where:** `components/studio/editor/code-editor-panel.tsx:54` (plus a new `lib/monaco/mermaid-language.ts` and `lib/theme/monaco-theme.ts:21`)
- **What happens:** In `.mmd` files, indented diagram lines show as one flat colour, labels in brackets look like links, and `%%` comments aren't dimmed.
- **Why users want it:** The README promises Mermaid syntax highlighting, and clear colours make diagram code easier to read.
- **Why:** No Mermaid language is registered, so Markdown rules are used, and the editor theme has no colour rules.
- **Fix:** Register a Mermaid grammar (keywords, arrows, shapes, comments), use it for `.mmd` files and Mermaid code blocks, and add theme colour rules.
- **Effort:** medium

<a id="f09"></a>

#### ✅ F09 · [medium] No image paste/drop and no file drop onto the editor or window

- **Where:** `components/studio/editor/code-editor-panel.tsx:175` (plus a window drop hook and `components/studio/markdown/markdown-preview.tsx:50`)
- **What happens:** Pasting a screenshot into a Markdown file does nothing, and dropping an image or a `.md` file onto the window does nothing.
- **Why users want it:** Paste-or-drop an image and get a link is a basic Markdown editor feature.
- **Why:** There are no paste or drop handlers anywhere.
- **Fix:** Open dropped `.md`/`.mmd` files, save pasted or dropped images into an `assets` folder and insert a link, and teach the preview to show local images (F02).
- **Effort:** medium

<a id="f10"></a>

#### ✅ F10 · [medium] No spell checking anywhere, and the native menu that would offer suggestions is turned off

- **Where:** `components/studio/editor/code-editor-panel.tsx:175` (also `components/disable-native-context-menu.tsx:17`, `src-tauri/src/prevent_browser_shortcuts.rs:29`)
- **What happens:** Typos aren't flagged in the editor, and right-click spelling suggestions are blocked in text boxes.
- **Why users want it:** Documents get exported to PDF and Word and sent to people; typos end up in them.
- **Why:** The editor turns spell check off, and the right-click menu is disabled.
- **Fix:** First allow the native menu in text boxes. Then add a background spell checker for Markdown text (skipping code), with underlines, suggestions and an "add to dictionary" option.
- **Effort:** large

<a id="f11"></a>

#### ✅ F11 · [medium] Export gaps: no HTML export or copy to clipboard, no feedback after saving, export only reachable from a small icon

- **Where:** `components/studio/editor/document-export-menu.tsx:92`
- **What happens:** You can't copy a diagram to paste into chat or slides, there's no Save HTML, code blocks have no copy button, and nothing confirms where an export went.
- **Why users want it:** Copying a diagram is the usual way to share it, and HTML export is almost free since the app already builds it.
- **Why:** No clipboard or HTML paths exist, and export lives only behind one icon.
- **Fix:** Add Copy as PNG/SVG, Save HTML, a success toast with "Show in folder", a code-block copy button, and export entries in the File menu and palette.
- **Effort:** medium

<a id="f12"></a>

#### ✅ F12 · [medium] Explorer never shows where the active file is (no auto-expand or scroll), and has no Collapse All

- **Where:** `components/studio/explorer/file-tree-node.tsx:18`
- **What happens:** Open a deeply nested file from the palette and the explorer highlights nothing, because its folder is collapsed. There's no Collapse All.
- **Why users want it:** People need to see where a file lives and tidy the tree quickly.
- **Why:** Each folder keeps its own open state, so nothing can open a file's parent folders.
- **Fix:** Move open-folder state into a shared store, automatically reveal the active file, and add Collapse All and Reveal Active File buttons and commands.
- **Effort:** medium

<a id="f13"></a>

#### ✅ F13 · [medium] No way to move files: no drag-and-drop, no Move command, no dropping files in from the OS

- **Where:** `components/studio/workspace/workspace-session-context.tsx:180` (and `components/studio/explorer/file-tree-node.tsx:35`)
- **What happens:** To move a file into another folder you have to use Windows Explorer, then reopen the folder in Scrivon.
- **Why users want it:** Moving files is a basic file-tree action.
- **Why:** Rename forbids folder separators, and there's no drag handling or Move command.
- **Fix:** Add a safe `moveEntry` (no moving into itself, no name clashes, tabs updated), drag and drop in the tree, a "Move to…" menu item, and drops from Explorer.
- **Effort:** medium

<a id="f14"></a>

#### ✅ F14 · [medium] No scroll sync or click-to-source between the editor and the Markdown preview

- **Where:** `components/studio/markdown/markdown-preview.tsx:50` (plus `code-editor-panel.tsx:175`, `markdown-document-viewer.tsx:86`)
- **What happens:** Scroll or edit line 800 and the preview stays wherever it was; you have to find your place by hand in both panes.
- **Why users want it:** Split-view Markdown editors (VS Code, Typora, Obsidian) all keep the panes in step.
- **Why:** Preview blocks carry no source line numbers and nothing links the two scroll positions.
- **Fix:** Tag preview blocks with their source line, sync scrolling both ways with a guard against loops, double-click to jump to the source, and add an on/off setting.
- **Effort:** medium

<a id="f15"></a>

#### ✅ F15 · [medium] No editor-only layout and no editor-preview scroll sync

- **Where:** `components/studio/shell/studio-layout.tsx:41`
- **What happens:** There's "Preview only" but no "Editor only", so you can't write long Markdown full-width; the preview always takes at least 40%.
- **Why users want it:** Focused writing without the preview in the way.
- **Why:** The preview is always shown and the editor is capped at 60% of the window.
- **Fix:** Add a "preview open" setting with a toggle button, View menu item, palette command and shortcut, and let the editor fill the space when the preview is hidden. Scroll sync as in F14.
- **Effort:** medium

<a id="f16"></a>

#### ✅ F16 · [medium] Missing editor basics: status bar (word count, cursor position, save state), outline panel, editor-preview scroll sync

- **Where:** `components/studio/shell/studio-layout.tsx:49` (status bar); `components/studio/explorer/workspace-explorer.tsx:16` (outline); `markdown-preview.tsx:51`, `code-editor-panel.tsx:175` (scroll sync)
- **What happens:** There's no word count, no line and column, no clear save status, and no list of headings to jump between.
- **Why users want it:** These are standard in Markdown editors, and a status bar would make failed saves visible.
- **Why:** These features don't exist yet.
- **Fix:** Add a status bar (cursor, counts, save state with errors, line endings), an Outline panel built from the existing outline code, and scroll sync as in F14.
- **Effort:** large

<a id="f17"></a>

#### ✅ F17 · [medium] Menu bar is missing most of the app's commands (Edit menu, Save, Export, Command Palette, Check for Updates, Exit)

- **Where:** `components/studio/shell/studio-menu-bar.tsx:82` (and `components/studio/app-update-provider.tsx:41`)
- **What happens:** A mouse user looking in the menus finds no Save, no Export, no Edit menu, no Check for Updates and no Exit.
- **Why users want it:** People look in the menu bar first, and it teaches the shortcuts.
- **Why:** The menus only have a handful of items.
- **Fix:** Share one command list between the palette and the menus, add File, Edit and Help items with shortcuts, and add a manual update check (F05).
- **Effort:** medium

<a id="f18"></a>

#### ✅ F18 · [medium] No 'System' / follow-OS theme mode, and no listener for OS light/dark changes

- **Where:** `lib/settings/types.ts:36` (and `components/theme/app-theme-provider.tsx:21`)
- **What happens:** Switching Windows between light and dark (including scheduled night mode) doesn't change Scrivon.
- **Why users want it:** Modern desktop apps follow the system theme.
- **Why:** Settings only store one fixed theme, and nothing listens for OS changes.
- **Fix:** Add a "System" mode with chosen light and dark themes, listen for OS changes, and keep existing users on their fixed choice.
- **Effort:** medium

<a id="f19"></a>

#### ✅ F19 · [medium] The last folder isn't reopened on launch, and window size/position aren't remembered

- **Where:** `components/studio/workspace/workspace-session-context.tsx:71`
- **What happens:** Every launch, including after an update, lands on the welcome screen in a default-size, un-maximised window.
- **Why users want it:** People expect to pick up where they left off.
- **Why:** Startup only loads the recent list, and there's no window-state plugin.
- **Fix:** Add a "Reopen last folder on startup" setting (on by default) and `tauri-plugin-window-state`.
- **Effort:** medium

<a id="f20"></a>

#### ✅ F20 · [medium] No preview of the styled PDF before exporting

- **Where:** `components/studio/editor/pdf-export-dialog.tsx:82` (with a new command next to `export_html_to_pdf` in `src-tauri/src/pdf_export.rs:164`)
- **What happens:** Tuning margins, headers or the title page means exporting and opening a file every time.
- **Why users want it:** Export profiles have dozens of layout options that are hard to judge blind.
- **Why:** No preview exists; a comment mentions one that was never built.
- **Fix:** Add a Rust command that renders a temporary numbered PDF and show it in a second column of the export dialog, refreshing after changes.
- **Effort:** medium

<a id="f21"></a>

#### ✅ F21 · [medium] No keyboard shortcuts for tabs, and no Save / Close Tab entries in the File menu

- **Where:** `lib/settings/keybind-registry.ts:12`
- **What happens:** Ctrl+W, Ctrl+Tab, Ctrl+PageUp/PageDown and Ctrl+Shift+T do nothing, and the File menu has no Save or Close Tab.
- **Why users want it:** These are standard in every tabbed editor.
- **Why:** Those actions don't exist in the shortcut list.
- **Fix:** Add close, next, previous and reopen-closed-tab actions with default keys, and add Save, Save All, Close Tab and Exit to the File menu with shortcuts shown.
- **Effort:** medium

<a id="f22"></a>

#### ✅ F22 · [medium] No keyboard way to move between panes, switch or close tabs, or rename and delete files, and no main landmark

- **Where:** `lib/settings/keybind-registry.ts:12` (plus `types.ts`, `defaults.ts:14`, `global-keybinds-provider.tsx`, `file-tree-node.tsx`, `studio-layout.tsx:33`)
- **What happens:** From the explorer, there's no keyboard way to get to the preview or the next tab, and no F2 or Delete for files.
- **Why users want it:** Keyboard-only and screen-reader users otherwise move around very slowly.
- **Why:** There are no pane-focus actions, no tab actions and no `<main>` landmark.
- **Fix:** Add focus actions and F6 pane cycling, tab actions, F2 and Delete in the tree, a `<main>` landmark, and a window title showing the file.
- **Effort:** medium

<a id="f23"></a>

#### ✅ F23 · [medium] Settings and PDF profiles live only in WebView2 localStorage, away from workspace.json, with no export or backup

- **Where:** `lib/settings/storage.ts:41`
- **What happens:** Clearing the WebView2 cache (a common fix for display glitches) wipes all settings and export profiles, and there's no way to share a profile with a colleague.
- **Why users want it:** Export profiles take effort to build, and teams want a shared company template.
- **Why:** Settings live only in the web view's storage.
- **Fix:** Mirror settings to a `settings.json` app file, and add Export/Import for settings and for single profiles (embedding images).
- **Effort:** medium

<a id="f24"></a>

#### ✅ F24 · [medium] Files can't be opened from Explorer: no file associations or command-line path handling

- **Where:** `src-tauri/src/lib.rs:21` (plus `src-tauri/tauri.conf.json:26` and `workspace-session-context.tsx`)
- **What happens:** Double-clicking a `.mmd` file or using "Open with Scrivon" just opens the welcome screen without the file.
- **Why users want it:** It's expected for any desktop editor of these file types.
- **Why:** There are no file associations and the app ignores paths passed to it.
- **Fix:** Add file associations, a single-instance plugin that forwards paths, and a startup command that opens the file and its folder.
- **Effort:** medium

<a id="f25"></a>

#### ✅ F25 · [medium] No logs, no global error handlers, no diagnostic info: bugs in release builds can't be reported

- **Where:** `src-tauri/src/lib.rs:24` (also `components/studio/shell/studio-menu-bar.tsx:145`, `components/studio/app-update-provider.tsx:90`)
- **What happens:** When something fails in the released app (a recent folder won't open, an update fails), there's nothing to attach to a bug report. A failed update install shows no message at all.
- **Why users want it:** Lets problems be reported and fixed quickly.
- **Why:** There's no log file, no global error handlers, no crash hook, and no diagnostic info in the app.
- **Fix:** Add `tauri-plugin-log` and a crash hook, global error handlers with toasts, and Help items for "Copy Diagnostic Info", "Open Logs Folder" and "Report an Issue".
- **Effort:** medium

<a id="f26"></a>

#### ✅ F26 · [medium] No way to make the UI or preview text bigger (no zoom, no UI scale, preview fixed at 14px)

- **Where:** `components/studio/settings/sections/appearance-settings.tsx:41` (plus `lib/settings/types.ts`, `keybind-registry.ts:12`, `src-tauri/capabilities/default.json`)
- **What happens:** Ctrl+= and Ctrl+mouse wheel do nothing, and there's no text-size option for the app or the preview; only the editor's font size can change.
- **Why users want it:** People with low vision need bigger text (WCAG 1.4.4), and it's expected in editors.
- **Why:** Zoom keys are off and there's no setting.
- **Fix:** Add "UI zoom" and "Preview text size" settings, zoom in/out/reset shortcuts and View menu items, and size preview text relative to the setting.
- **Effort:** medium

<a id="f27"></a>

#### ✅ F27 · [low] No ARM64 build, and no stated or enforced minimum Windows version

- **Where:** `.github/workflows/release.yml:44-98` (same change in `build-release.yml:17-69`; README Download section)
- **What happens:** On Snapdragon (Windows on ARM) laptops, Scrivon runs in emulation, which is slower and uses more battery. On Windows 8.1 it installs but won't start.
- **Why users want it:** A native ARM build runs better, and a stated minimum version avoids broken installs.
- **Why:** Only an x86_64 build is made, and nothing states or checks the supported Windows versions.
- **Fix:** Add an ARM64 build to the release matrix (built one at a time so the update manifest isn't overwritten), and state "Windows 10 1809+ or Windows 11, x64 or ARM64" in the README.
- **Effort:** small

<a id="f28"></a>

#### ✅ F28 · [low] Explorer is missing standard entry points: no New File shortcut, palette command or File menu item, no Reveal in File Explorer or Copy Path, no right-click on empty space

- **Where:** `components/studio/command-palette/command-registry.ts:47`
- **What happens:** With the explorer hidden there's no way to create a file: no Ctrl+N, no palette command, no File menu item. Right-clicking empty explorer space does nothing, and files have no Reveal or Copy Path.
- **Why users want it:** These are the standard ways to create files and find them on disk.
- **Why:** These entry points were never added.
- **Fix:** Add New Diagram/Document/Folder actions with shortcuts, palette and File menu entries, a right-click menu on empty space, and Reveal / Copy Path items.
- **Effort:** medium

<a id="f29"></a>

#### ✅ F29 · [low] Only the '>' prefix exists: no go-to-line, no heading jump, no case/word/regex options, and no help listing the prefixes

- **Where:** `components/studio/command-palette/parse-palette-query.ts:6`
- **What happens:** Typing ":120" in the palette searches for the text ":120" instead of jumping to line 120, and you can't jump to a heading or search case-sensitively across the workspace.
- **Why users want it:** Faster navigation in long files, familiar from VS Code.
- **Why:** The palette only understands the ">" prefix, and workspace search is always case-insensitive plain text.
- **Fix:** Add ":" (go to line), "@" (headings) and "?" (help) modes, mention them in the placeholder, add Find and Go to Line commands, and optionally case/word/regex toggles.
- **Effort:** medium

<a id="f30"></a>

#### ✅ F30 · [low] No translation structure; some logic depends on the English wording of strings

- **Where:** `components/studio/dialogs/name-prompt-provider.tsx:50`
- **What happens:** Nothing visible today, but translating or rewording the "Rename" title would make the prompt's button say "Create".
- **Why users want it:** Keeps the door open for translations and safer rewording.
- **Why:** The prompt guesses what it's for by searching the title text for "rename" or "folder".
- **Fix:** Pass an explicit `kind` (new diagram, new document, new folder, rename) and look up the text from that. Leave full translation for later.
- **Effort:** small

<a id="f31"></a>

#### ✅ F31 · [low] No Markdown/Mermaid writing helpers; default Ctrl+B is taken by 'Toggle explorer'

- **Where:** `components/studio/editor/code-editor-panel.tsx:175`
- **What happens:** Selecting a word and pressing Ctrl+B toggles the explorer instead of making it bold. Lists don't continue when you press Enter, and there are no Mermaid snippets.
- **Why users want it:** Bold, italic and link shortcuts and list continuation are expected in Markdown editors.
- **Why:** No editor actions are registered, and Ctrl+B is caught by the app before the editor sees it.
- **Fix:** Add bold, italic, code and link actions for Markdown, list continuation on Enter, a Mermaid language with snippets, and settle the Ctrl+B clash (new default or let the editor have it first).
- **Effort:** medium

<a id="f32"></a>

#### ✅ F32 · [low] Ctrl+Left/Right and double-click select whole Chinese/Japanese/Thai sentences in the editor

- **Where:** `components/studio/editor/code-editor-panel.tsx:22`
- **What happens:** In Japanese, Chinese or Thai text, double-click or Ctrl+Right selects or skips a whole clause instead of a word.
- **Why users want it:** Normal word-by-word editing for people writing in those languages.
- **Why:** The editor's word-splitting for these languages is only on when `wordSegmenterLocales` is set.
- **Fix:** Set `wordSegmenterLocales` to `['ja', 'zh-CN', 'zh-TW', 'ko', 'th']`.
- **Effort:** trivial

<a id="f33"></a>

#### ✅ F33 · [low] Export is only reachable from a small tab-bar icon: no File menu entry, palette command or shortcut

- **Where:** `components/studio/editor/document-export-menu.tsx:37`
- **What happens:** Pressing F1 and typing "export" or "pdf" finds nothing, and the File menu has no Export.
- **Why users want it:** Export is a main feature; people look for it in the menu or palette.
- **Why:** Export state lives inside the small tab-bar menu.
- **Fix:** Move export state into a shared provider, then add Export to the File menu, palette commands and a shortcut. Optionally add Save HTML.
- **Effort:** medium

<a id="f34"></a>

#### ✅ F34 · [low] Tabs lack expected actions: middle-click close, drag to reorder, Close to the Right / Close Saved, Copy Path, Reveal in Explorer, Save As, Revert

- **Where:** `components/studio/editor/editor-tab-context-menu.tsx:28`
- **What happens:** Middle-clicking a tab doesn't close it, tabs can't be reordered, and there's no way to keep a copy of an example or revert a file to its saved version.
- **Why users want it:** These are standard tab actions in editors and browsers.
- **Why:** The tab menu has only three Close items.
- **Fix:** Add middle-click close, Close to the Right, Close Saved, Copy Path, Reveal in File Explorer, Save Copy to Workspace and Revert. Drag to reorder is optional.
- **Effort:** medium

<a id="f35"></a>

#### ✅ F35 · [low] No 'Reveal in File Explorer', 'Copy path' or 'Open with default app', even though the opener plugin is installed

- **Where:** `components/studio/explorer/file-tree-context-menu.tsx:32` (also `components/studio/editor/editor-tab-context-menu.tsx:28`)
- **What happens:** Right-click a file or tab looking for "Show in Explorer" or "Copy path": they aren't there.
- **Why users want it:** People move between Scrivon and Windows Explorer all the time.
- **Why:** The opener plugin is set up but only used for web links.
- **Fix:** Add Reveal in File Explorer, Copy Path and Copy Relative Path to the file and tab menus. "Open with default app" needs an extra permission, so it's optional.
- **Effort:** small

<a id="f36"></a>

#### ✅ F36 · [low] No way to copy a code block (no Copy button, and the native right-click menu is disabled)

- **Where:** `components/studio/markdown/fenced-code-block.tsx:157`
- **What happens:** To copy a snippet from the preview you have to drag-select it carefully; there's no Copy button and right-click does nothing.
- **Why users want it:** Copying code from documentation is very common.
- **Why:** Code blocks have no button, and the right-click menu is disabled.
- **Fix:** Add a hover Copy button and a language label to code blocks, and optionally a preview right-click menu with Copy and Copy link.
- **Effort:** small

<a id="f37"></a>

#### ✅ F37 · [low] GitHub alerts and math aren't rendered, though the bundled showcase demonstrates them

- **Where:** `components/studio/markdown/markdown-preview.tsx:30` (also `export-document.ts:52`, `export-html-css.ts:252`, `export-docx.ts:668/1123`)
- **What happens:** `> [!NOTE]` shows as a normal quote with the literal text, and `$E = mc^2$` shows raw. Quote text also isn't greyed as intended.
- **Why users want it:** GitHub alerts are common in READMEs and docs.
- **Why:** Only the GitHub-tables plugin is used, and the paragraph style overrides the quote colour.
- **Fix:** Add a small alerts plugin used by preview and exports with coloured callouts, fix the quote text colour, and optionally add math to the preview.
- **Effort:** medium

<a id="f38"></a>

#### ✅ F38 · [low] 'Restore panel layout' setting does nothing

- **Where:** `components/studio/settings/settings-provider.tsx:41` (switch in `advanced-settings.tsx:48`)
- **What happens:** Turn "Restore panel layout" off, hide the editor, restart: the editor is still hidden.
- **Why users want it:** A switch should do what it says.
- **Why:** Nothing ever reads the setting.
- **Fix:** At startup, when the setting is off, open the explorer and editor as default. Or remove the switch.
- **Effort:** trivial

<a id="f39"></a>

#### ⬜ F39 · [low] Few page sizes and code themes, and no way to share profiles

- **Where:** `lib/settings/pdf-export-types.ts:4` (also `lib/markdown/shiki-highlighter.ts:3`, `pdf-export-settings.tsx:135`)
- **What happens:** Only A4 and Letter pages and two code colour themes are offered, and profiles can't be exported, imported or backed up.
- **Why users want it:** A5 handouts, Legal pages, matching code colours, and sharing a company template.
- **Why:** The options are hardcoded lists.
- **Fix:** Add A3, A5, Legal and a custom size, more code themes, profile Export/Import (embedding images), and mention profiles in the Restore defaults warning.
- **Effort:** medium
- **Status (14 November 2026):** half built. Profile export and import are in (#123, PR #148). The page sizes and code themes are #124 (PR #145, not merged yet).

<a id="f40"></a>

#### ✅ F40 · [low] Settings dialog has no search and always opens on General

- **Where:** `components/studio/settings/settings-provider.tsx:59`
- **What happens:** Finding "minimap" or "page numbers" means clicking through sections, and closing and reopening Settings always starts on General.
- **Why users want it:** Faster access to settings, especially the long export section.
- **Why:** Opening Settings always resets to General, and there's no search.
- **Fix:** Reopen on the last section, say that changes save automatically, fix the confusing width wording, and optionally add a search box.
- **Effort:** small

<a id="f41"></a>

#### ✅ F41 · [low] No indication of the current file anywhere: window title is always 'Scrivon' and there is no status bar

- **Where:** `components/studio/shell/studio-menu-bar.tsx:164-168` (plus a new `use-window-title.ts` and `src-tauri/capabilities/default.json`)
- **What happens:** The taskbar and Alt+Tab always say "Scrivon", so several windows look the same, and there's no status bar.
- **Why users want it:** To tell windows and files apart, and see unsaved state at a glance.
- **Why:** The window title is never set (the permission isn't even granted).
- **Fix:** Set the window title to "● file — folder — Scrivon", show it in the title bar's drag area, and optionally add a status bar.
- **Effort:** medium

<a id="f42"></a>

#### ✅ F42 · [low] Custom maximize button doesn't show Windows 11 Snap Layouts

- **Where:** `components/studio/shell/window-titlebar-controls.tsx:75` (plus `src-tauri/src/lib.rs` setup)
- **What happens:** Hovering the maximise button on Windows 11 doesn't show the snap layout grid that other apps have.
- **Why users want it:** It's normal Windows 11 behaviour and a quick way to arrange windows.
- **Why:** The custom web button doesn't tell Windows it's a maximise button.
- **Fix:** Use `tauri-plugin-decorum`, or trigger Win+Z when the pointer rests on the button.
- **Effort:** medium

<a id="f43"></a>

#### ✅ F43 · [low] Examples can't be saved into the workspace and aren't reachable before a folder is opened

- **Where:** `components/studio/editor/editor-tab-context-menu.tsx:28`
- **What happens:** Example tabs are read-only with no "save a copy" option, and on the welcome screen there's no way to browse examples.
- **Why users want it:** Starting from a sample is a common way to learn and get going.
- **Why:** Examples only live in the folder view, and there's no copy action.
- **Fix:** Add "Save Copy to Workspace" (with a safe, unique file name), and disable or rework the example commands when no folder is open (B67).
- **Effort:** small

<a id="f44"></a>

#### ⬜ F44 · [low] Exports always print 'Contents' and 'Page N' in English, with no setting to change them

- **Where:** `lib/settings/pdf-export-types.ts:73` (used at `markdown-to-export-html.ts:108` and `export-docx.ts:1231`)
- **What happens:** A French or Japanese document's contents page is always headed "Contents".
- **Why users want it:** Documents in other languages look unfinished with an English heading.
- **Why:** The heading is hardcoded.
- **Fix:** Add a "Contents title" field to the export profile (and optionally a front-matter override). The custom footer already covers page wording.
- **Effort:** small
- **Status (14 November 2026):** not built yet. It's part of #124 (PR #145, not merged yet).

<a id="f45"></a>

#### ✅ F45 · [low] Diagram export has no options (theme, transparent background), no copy-to-clipboard, and no success feedback

- **Where:** `lib/mermaid/export.ts:130`
- **What happens:** In dark mode you can't export a light diagram or a transparent PNG for slides, can't copy a diagram, and nothing confirms the save.
- **Why users want it:** Slides and documents usually need light or transparent images, and copy-paste is faster than saving.
- **Why:** Export always uses the app theme with a solid background.
- **Fix:** Add "transparent background" and "diagram theme" options to the export menu, Copy PNG and Copy SVG, and a success toast with "Show in folder".
- **Effort:** medium

<a id="f46"></a>

#### ✅ F46 · [low] Editor commands are hard to find: no Edit menu, no editor actions in the palette, and Monaco's own palette is still in the context menu

- **Where:** `components/studio/editor/code-editor-panel.tsx:99` (also `studio-menu-bar.tsx:108`, `command-registry.ts:47`, `lib/monaco/editor-keybindings.ts:5`)
- **What happens:** Find, Replace and Go to Line work only if you already know the shortcuts; they're in no menu or palette.
- **Why users want it:** Makes common editing features discoverable.
- **Why:** Nothing connects the app's menus and palette to the editor's built-in actions.
- **Fix:** Expose a "run editor action" function, add an Edit menu and palette commands, and point the editor's own palette entry at Scrivon's palette (B108).
- **Effort:** small

<a id="f47"></a>

#### ✅ F47 · [low] Exported PDFs have no bookmarks/outline even though the stamper already knows every heading's page

- **Where:** `src-tauri/src/page_numbers.rs:1033`
- **What happens:** Long exported reports have no bookmarks pane in PDF viewers.
- **Why users want it:** Bookmarks make long documents easy to navigate.
- **Why:** The page-number stamper finds heading positions but never writes a PDF outline.
- **Fix:** Pass the full heading list to Rust and build a nested outline from the heading positions. Add a test.
- **Effort:** medium

<a id="f48"></a>

#### ✅ F48 · [low] Page numbers always count hidden front matter, so the first visible number can be 'Page 10'

- **Where:** `src-tauri/src/page_numbers.rs:1084`
- **What happens:** With a title page and contents, the body starts at "Page 3" (or "Page 10" with a long contents), and "of total" counts the front pages too.
- **Why users want it:** Polished reports usually number from the start of the body.
- **Why:** Labels always use the physical page number.
- **Fix:** Add a "number from body" option using a hidden body-start marker, apply it to footer and contents numbers, and restart numbering in Word too.
- **Effort:** medium

<a id="f49"></a>

#### ✅ F49 · [low] Pre-release (rc) installs never update, not even to the stable release that replaces them

- **Where:** `src-tauri/src/updater.rs:42`
- **What happens:** Someone who installs a release candidate never hears about the final release or anything after it.
- **Why users want it:** Testers should move back onto stable automatically.
- **Why:** Pre-release builds skip the update check completely.
- **Fix:** Remove the early return; version ordering already makes it safe. Update the docs, and optionally show a "Pre-release" badge in About.
- **Effort:** trivial

<a id="f50"></a>

#### ✅ F50 · [low] Uninstall leaves user data and old folders behind; the MSI has no 'remove my data' option and the updater piles up installers in %TEMP%

- **Where:** `src-tauri/tauri.conf.json:26` (add an installer hook) and `src-tauri/src/lib.rs:21` (startup cleanup)
- **What happens:** After uninstalling, the old `com.diagram.app` folders and every downloaded update installer (about 13 MB each) stay on disk.
- **Why users want it:** A clean uninstall and less wasted disk space.
- **Why:** The uninstaller doesn't know about the old folders, and the updater leaves its temp files behind.
- **Fix:** Add an uninstall hook that removes the old folders when "delete app data" is ticked, clean up old updater folders at startup, and document where data lives.
- **Effort:** small

## Build/release/docs (R)

<a id="r01"></a>

#### ✅ R01 · [high] Monaco is downloaded from the jsDelivr CDN at runtime, so the editor never loads offline

- **Where:** `components/studio/editor/code-editor-panel.tsx:17`
- **What happens:** On first launch without internet, or behind a firewall that blocks jsDelivr, the editor shows "Loading..." forever and you can't edit anything. This breaks the "local-first" promise.
- **Why:** The editor library downloads itself from a public CDN by default, nothing bundles it, and load errors only go to the console.
- **Fix:** Copy Monaco into `public/` at build time and point the loader there, show a proper loading and error state with Retry, set a CSP (S05), and add Monaco to the licence list.
- **Effort:** small

<a id="r02"></a>

#### ✅ R02 · [medium] Dependabot has been stalled since June and never covers Rust crates or GitHub Actions

- **Where:** `.github/dependabot.yml:8`
- **What happens:** Security fixes for Tauri, WebView2 bindings or GitHub Actions never arrive as pull requests. About 130 security alerts are open, and Dependabot security updates are paused.
- **Why:** Only the bun ecosystem is configured, and five old open pull requests fill its limit.
- **Fix:** Add `cargo` and `github-actions` entries with grouping, merge or close the old PRs, unpause security updates, remove the unused npm lockfile (R11), and bump `lopdf`.
- **Effort:** small

<a id="r03"></a>

#### ✅ R03 · [medium] CI never compiles the Windows-only Rust code (PDF export via WebView2, shortcut blocking); breakage only shows up after a release is published

- **Where:** `.github/workflows/ci.yml:82`
- **What happens:** A change that only breaks on Windows passes CI, then fails after the release is published, leaving a release with no installers.
- **Why:** The only Rust CI job runs on Linux, so Windows-only code is never compiled.
- **Fix:** Add a `windows-latest` job that runs clippy and tests (with `--locked`), and make it a required check.
- **Effort:** small

<a id="r04"></a>

#### ✅ R04 · [medium] Licences dialog omits all bundled Rust crates and fonts despite claiming to list shipped third-party software

- **Where:** `scripts/generate-licenses.mjs:13`
- **What happens:** Help > Licences lists only JavaScript packages, misses hundreds of bundled Rust crates and the Inter and Geist Mono fonts, and shows no text for the Tauri packages.
- **Why:** The script only traces npm packages in the web build and misses some licence file names.
- **Fix:** Add Rust crates (for example with `cargo about`), add the fonts, match more licence file names, and group the list by type.
- **Effort:** medium

<a id="r05"></a>

#### ✅ R05 · [medium] Signing-key docs say to generate the updater keypair 'once per machine' with -f, which would leave every installed copy unable to update

- **Where:** `docs/development.md:113`
- **What happens:** A maintainer setting up a new PC who follows the guide would create a new signing key, and every installed copy would then reject all future updates.
- **Why:** The guide says to generate keys "once per machine" with an overwrite flag, though every install trusts only one key.
- **Fix:** Rewrite the section: one key for the project, back it up, copy it to new machines, never use overwrite, and document a safe rotation process.
- **Effort:** small

<a id="r06"></a>

#### ✅ R06 · [medium] semantic-release analyzer config is spread into two plugin entries, so the 'conventionalcommits' preset is ignored and `feat!:` commits never trigger a release

- **Where:** `release.config.mjs:54`
- **What happens:** A breaking-change commit written as `feat!:` produces no release at all, or only a patch release.
- **Why:** The analyzer's settings are spread into the plugin list, so its preset is silently dropped.
- **Fix:** Change `...analyzer,` to `analyzer,`, check with a dry run, and optionally add a test for the config shape.
- **Effort:** trivial

<a id="r07"></a>

#### ✅ R07 · [low] The GitHub Release is published (and becomes 'latest') before any test or Windows build runs; a failed build leaves a stable release with no installers or updater manifest

- **Where:** `release.config.mjs:60` (and `.github/workflows/release.yml:37-106`)
- **What happens:** For about 8 minutes after each release (or longer if the build fails), the latest release has no installers, and update checks fail quietly.
- **Why:** The release is published straight away; installers are built and uploaded afterwards.
- **Fix:** Create the release as a draft and publish it after the Windows build finishes, and run tests before releasing.
- **Effort:** medium

<a id="r08"></a>

#### ✅ R08 · [low] The 'PDF' naming and copy hide that profiles also drive Word export, and what Word doesn't support

- **Where:** `components/studio/settings/sections/pdf-export-settings.tsx:133`
- **What happens:** Settings say profiles are "for branded PDFs", so Word users may think they don't apply. Word's gaps (SVG logos, see-through colours) aren't mentioned.
- **Why:** The text and README only mention PDF.
- **Fix:** Rename and reword the section to cover PDF and Word, fix the Word image and colour gaps (B41, B43), and update the README.
- **Effort:** small

<a id="r09"></a>

#### ✅ R09 · [low] README and development docs are out of date with how the app and pipeline actually work

- **Where:** `docs/development.md:67`
- **What happens:** A new maintainer waits for a workflow that never runs automatically, may give the release token too few permissions, and is invited to open PRs straight to `main`.
- **Why:** The docs weren't updated as the pipeline changed.
- **Fix:** Fix the listed lines (workflow names, token scopes, PR target), mention Word export, and add notes on building without the signing key.
- **Effort:** small

<a id="r10"></a>

#### ✅ R10 · [low] `bun run start` always fails, and dev assetPrefix hard-codes port 3000

- **Where:** `package.json:8`
- **What happens:** `bun run start` always errors, and if port 3000 is busy, `tauri dev` opens a blank or wrong window.
- **Why:** `next start` doesn't work with a static export, and dev assets are pinned to port 3000 while Next quietly moves to another port.
- **Fix:** Run dev with an explicit `-p 3000` so it fails clearly, and remove or replace the `start` script.
- **Effort:** trivial

<a id="r11"></a>

#### ✅ R11 · [low] The DOCX feature commit added a 16,948-line package-lock.json to a Bun-managed repo

- **Where:** `package-lock.json:1`
- **What happens:** Anyone running `npm install` gets a different set of dependencies from CI, and GitHub alerts track a lockfile nobody uses.
- **Why:** An npm lockfile was committed next to `bun.lock`.
- **Fix:** Delete it, add npm/yarn/pnpm lockfiles to `.gitignore`, and add a `packageManager` field.
- **Effort:** trivial

<a id="r12"></a>

#### ✅ R12 · [low] The licences file is regenerated after the bundle that ships it, so the in-app list is always one build behind and builds dirty tracked files

- **Where:** `scripts/generate-licenses.mjs:187`
- **What happens:** The licence list inside the app is always from the previous build, and every local build leaves changed tracked files.
- **Why:** The licence file is rewritten after the app has already been bundled.
- **Fix:** If the regenerated file changed, rebuild once, and add a CI check that the committed file is up to date.
- **Effort:** small

<a id="r13"></a>

#### ✅ R13 · [low] README and in-app text are out of date or inaccurate

- **Where:** `lib/workspace/file-types.ts:3`
- **What happens:** The README doesn't mention Word export and says folders can be deleted (they can't, B11). In-app messages leave out `.mermaid`, and `.markdown` files aren't supported.
- **Why:** Text wasn't updated as features changed.
- **Fix:** Share one supported-extensions label, update the README and About text, fix folder delete, and optionally accept `.markdown`.
- **Effort:** small

<a id="r14"></a>

#### ✅ R14 · [low] Cargo.lock is always one version behind at every release tag

- **Where:** `scripts/sync-version.mjs:43` (plus `release.config.mjs:31`)
- **What happens:** Building a release tag with `cargo build --locked` fails, and local builds leave a stray `Cargo.lock` change.
- **Why:** The version script updates every version file except `Cargo.lock`.
- **Fix:** Update Scrivon's own entry in `Cargo.lock` in the script, include it in the release commit, and build with `--locked`.
- **Effort:** trivial

<a id="r15"></a>

#### ✅ R15 · [low] The bundled Markdown showcase was rewritten by Prettier and now demonstrates the wrong syntax

- **Where:** `.prettierignore` (add `scripts/data/`) and `scripts/data/markdown-syntax-showcase.md:21-25,43,45,53,87-89,189-195,220-221`
- **What happens:** The showcase claims to show different ways of writing italics, bold, lists, rules and headings, but shows the same one twice, and some lines render with stray underscores.
- **Why:** The pre-commit formatter rewrote the source file.
- **Fix:** Tell Prettier to skip `scripts/data/`, restore the original syntax, fix the subscript example's label, and regenerate the example.
- **Effort:** small

<a id="r16"></a>

#### ⬜ R16 · [low] Template package metadata: 'A Tauri App' description and publisher shown as 'github'

- **Where:** `src-tauri/tauri.conf.json:26` (and `src-tauri/Cargo.toml:4`)
- **What happens:** Windows file properties and Apps & features show the publisher as "github", and the package description is still "A Tauri App".
- **Why:** The publisher defaults to the second part of the identifier, and the template description was never changed.
- **Fix:** Set publisher, copyright and descriptions. Take care with the installer registry-key change this causes (B126).
- **Effort:** trivial

## Code health (C)

<a id="c01"></a>

#### ✅ C01 · [medium] Keybind storage freezes defaults and never detects conflicts, so future default changes break or collide

- **Where:** `lib/settings/migrate.ts:36`
- **What happens:** If a future release changes a default shortcut, existing users never get it. A new default can silently clash with a custom shortcut, and one of them stops working with no warning.
- **Why:** The full set of shortcuts is saved, not just the user's changes, and clashes are never checked on load or reset.
- **Fix:** Save only the user's changes, resolve clashes on load (the user's choice wins), check clashes on reset, and show duplicates on the Keyboard page. Add tests.
- **Effort:** medium

<a id="c02"></a>

#### ✅ C02 · [medium] The '100% coverage' gate and Codecov badge only count files some test happens to import; about 145 of 199 source files are never measured

- **Where:** `vitest.config.ts:13`
- **What happens:** The README badge and the CI gate say 100%, but most of the app's own code is never measured. Real coverage is about 43%.
- **Why:** Coverage only counts files a test loads, because no `include` pattern is set.
- **Fix:** Add include and exclude patterns, set the thresholds to the real numbers (or let them ratchet up), and switch Codecov to `target: auto`.
- **Effort:** trivial

<a id="c03"></a>

#### ✅ C03 · [low] Test files are never type-checked anywhere in CI

- **Where:** `.github/workflows/ci.yml:34`
- **What happens:** Type errors in test files (wrong mock shapes, old function signatures) pile up without CI noticing.
- **Why:** Next.js ignores test files when type-checking, and there's no separate `tsc` step.
- **Fix:** Add a committed types file, a `typecheck` script and a CI step, and fix the existing error in `match-keybind.test.ts`.
- **Effort:** trivial

<a id="c04"></a>

#### ✅ C04 · [low] Find-widget overflow workaround in CSS depends on the exact Tailwind class strings in studio-layout

- **Where:** `app/globals.css:272`
- **What happens:** A small class change in the layout files would quietly bring back clipped find-box tooltips.
- **Why:** The fix targets elements by their exact list of classes.
- **Fix:** Mark the elements with a `data-find-overflow-host` attribute and target that instead.
- **Effort:** trivial

<a id="c05"></a>

#### ✅ C05 · [low] Unused duplicate FileExplorer component and other dead helpers

- **Where:** `components/studio/explorer/file-explorer.tsx:8`
- **What happens:** A future fix could go into code that never runs.
- **Why:** Several components and helpers are left over and never used.
- **Fix:** Delete the unused explorer, examples barrel, theme provider, idle-render helper and other dead functions, and replace `uniqueUntitledName` with a general unique-name helper.
- **Effort:** small

<a id="c06"></a>

#### ✅ C06 · [low] fenced-code-block's per-block caches are written but never read; clearFencedCodeBlockContainers does nothing useful

- **Where:** `components/studio/markdown/fenced-code-block.tsx:39`
- **What happens:** Nothing visible; the code suggests a caching layer that doesn't exist.
- **Why:** Two maps are filled and cleared but never read.
- **Fix:** Remove the maps, their cleanup and the clear function.
- **Effort:** trivial

<a id="c07"></a>

#### ✅ C07 · [low] Menu bar's own drag/double-click handler never runs (Tauri's drag script swallows the event)

- **Where:** `components/studio/shell/studio-menu-bar.tsx:59`
- **What happens:** Nothing visible; dragging and maximising work through Tauri's own script, so this handler is misleading dead code.
- **Why:** Tauri's drag script handles the click first and stops it from reaching React.
- **Fix:** Delete the handler and the imports it used.
- **Effort:** trivial

<a id="c08"></a>

#### ✅ C08 · [low] Dead theme code: next-themes wrapper never mounted, clearThemeFromDocument unused

- **Where:** `components/theme-provider.tsx:1`
- **What happens:** Nothing visible, but a contributor could mount a second theme system that fights the real one.
- **Why:** An unused wrapper and dependency were left behind.
- **Fix:** Delete the file and the `next-themes` dependency, and remove `clearThemeFromDocument`.
- **Effort:** trivial

<a id="c09"></a>

#### ✅ C09 · [low] About 31 unused ui primitives are shipped, type-checked and scanned for CSS; one hides a broken action handler

- **Where:** `components/ui/` (unused wrapper files) and `package.json:56`
- **What happens:** About 3,400 lines of unused UI components have to be kept compiling, and add unused CSS. (On checking, the "broken action handler" turned out to work fine.)
- **Why:** Registry components were added but never used.
- **Fix:** Delete the unused components and `react-day-picker`, keeping any (like Tooltip) that planned UX fixes will use.
- **Effort:** small

<a id="c10"></a>

#### ✅ C10 · [low] DOCX tests mostly check that substrings appear anywhere in the package, and some lock in the bugs above

- **Where:** `lib/markdown/export-docx.test.ts:90`
- **What happens:** Regressions in page numbers, contents numbers, list numbering or tables would still pass, and some tests expect today's bugs.
- **Why:** All XML parts are joined into one string and checked loosely.
- **Fix:** Check each part separately, verify the XML is valid, add real assertions for page fields, lists and tables, and update tests that expect buggy output.
- **Effort:** medium

<a id="c11"></a>

#### ✅ C11 · [low] The premise that 'WebView2 never resolves CSS page counters' no longer holds; native @page margin boxes work in this engine

- **Where:** `lib/markdown/export-html-css.ts:72`
- **What happens:** Nothing visible, but the comment could steer a maintainer away from a simpler native fix for footers.
- **Why:** Chromium does fill in page counters inside page margin boxes; it only doesn't for normal content.
- **Fix:** Correct the comments, and optionally try native margin-box footers for simple profiles (no images or backgrounds).
- **Effort:** small

<a id="c12"></a>

#### ✅ C12 · [low] Dead or half-built render code paths mislead maintainers

- **Where:** `lib/mermaid/svg-iframe.tsx:203`
- **What happens:** Nothing visible, but the code looks like it does tight-bounds fitting and idle rendering when it doesn't.
- **Why:** An unused live frame, an unused idle-render helper, never-filled bounds state and checks that can't fail remain.
- **Fix:** Remove them or make them work (see B107).
- **Effort:** small

<a id="c13"></a>

#### ✅ C13 · [low] Action list is kept in four separate places; one missing registry entry would break every shortcut

- **Where:** `lib/settings/keybind-registry.ts:12`
- **What happens:** Nothing today, but forgetting one registry entry for a new action would make every key press throw an error, breaking all shortcuts.
- **Why:** Action ids are listed in four places with no type check tying them together, and an unknown id throws.
- **Fix:** Key the registry by action id with a type check, build the defaults from it, and skip unknown ids instead of throwing.
- **Effort:** small

<a id="c14"></a>

#### ✅ C14 · [low] Prototype keys pass isAppThemeId: a stored theme id like 'constructor' crashes the app on every launch

- **Where:** `lib/theme/catalog.ts:20`
- **What happens:** A corrupted saved theme id such as "constructor" makes the app crash on every start.
- **Why:** The check uses `in`, which also accepts built-in object names.
- **Fix:** Use `Object.hasOwn`, fix the startup script the same way, and add tests.
- **Effort:** trivial

<a id="c15"></a>

#### ✅ C15 · [low] Boot script keeps its own copy of the CSS variable list and fallback theme ids, which can drift from semantic-vars.ts

- **Where:** `lib/theme/theme-boot-script.ts:30`
- **What happens:** Nothing today, but a new colour variable could briefly flash its default colour at startup.
- **Why:** The startup script has its own copy of the variable list and theme ids.
- **Fix:** Loop over the theme's variables directly, import the theme id constants, and add a test that the lists match.
- **Effort:** trivial

<a id="c16"></a>

#### ✅ C16 · [low] Unused and misplaced dependencies, including the shadcn CLI in runtime deps, which drags in an MCP server stack that needs security overrides

- **Where:** `package.json:62` (and `app/globals.css:3`)
- **What happens:** Security alerts keep arriving for server packages the desktop app never runs, each needing a manual override.
- **Why:** The shadcn CLI is a runtime dependency just for one CSS import, and several other packages are unused.
- **Fix:** Copy the needed CSS into the app, remove `shadcn` and the other unused packages, then drop the overrides that are no longer needed.
- **Effort:** small

<a id="c17"></a>

#### ✅ C17 · [low] generate-examples.mjs is fragile: titles keep markdown escapes, entries are matched by position, and a mismatch only warns

- **Where:** `scripts/generate-examples.mjs:73`
- **What happens:** One example already shows a stray backslash in its title, and refreshing the sample data could pair titles with the wrong diagrams without failing the build.
- **Why:** Titles aren't unescaped, entries are matched by position, and mismatches only print a warning.
- **Fix:** Unescape titles, match entries by heading text, and fail the build on any mismatch. Fix the mangled descriptions in the data file.
- **Effort:** small

<a id="c18"></a>

#### ✅ C18 · [low] Debug builds don't actually keep DevTools/reload shortcuts on Windows

- **Where:** `src-tauri/src/prevent_browser_shortcuts.rs:22`
- **What happens:** During development on Windows there's no way to open DevTools or reload the page, despite the comment saying there is.
- **Why:** The WebView2 lockdown is applied in every build, not just release.
- **Fix:** Apply the WebView2 lockdown only in release builds.
- **Effort:** trivial

<a id="c19"></a>

#### ✅ C19 · [low] Shared Vitest Tauri mock does not match the real module APIs

- **Where:** `vitest/mocks/tauri.ts:36`
- **What happens:** The first test anyone writes for the workspace or session screens fails with a confusing mock error.
- **Why:** The shared mock is missing five store functions, the `stat` function and the `LazyStore` class.
- **Fix:** Add the missing pieces, with a type check that keeps the mock in step with the real module, plus a smoke test.
- **Effort:** small

## Appendix: Needs a real-app check

No findings were left uncertain this time: there are no Q items. A few confirmed items have one part the reviewers couldn't see without running the app. It's worth a quick look while fixing them:

- **U05** Light scrollbars in dark themes (`app/globals.css:7`): whether the tab strip also grows a vertical scrollbar. Open many tabs in a dark theme and look.
- **B107** Sandboxed diagram frames (`lib/mermaid/svg-iframe.tsx:184`): whether large diagrams really flash blank after edits. Edit a 200+ node diagram and watch.
- **B123** Fixed 1.2 s wait before printing (`src-tauri/src/pdf_export.rs:57`): whether the blank-PDF race or a stuck print ever happens. Export a large document with remote images on a slow connection.
- **C11** Page counters in WebView2 (`lib/markdown/export-html-css.ts:72`): whether `@page` margin-box counters work inside the real PrintToPdf call. Export a small test page that uses them.
- **S04** Google Fonts requests (`lib/mermaid/render.ts:28`): whether every preview re-requests the font or the cache serves it. Watch network traffic while editing a diagram.
- **B25** Renderer crash (`src-tauri/src/lib.rs:21`): whether a crash shows WebView2's error page or a blank window. Kill the WebView2 renderer process while a folder is open.
- **U92** Dark flash on resize (`src-tauri/tauri.conf.json:19`): how visible the resize flicker is. Resize quickly with a light theme.
- **B108 / F46** Monaco's own palette (`lib/monaco/editor-keybindings.ts:5`): whether re-registering the command replaces the right-click entry. Right-click in the editor after the fix.

Five other reported issues were checked and rejected.
