/** Letters of right-to-left scripts: Hebrew, Arabic, Syriac, Thaana, N'Ko and the rest, with their presentation forms. */
const RTL_LETTERS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u

/** U+200E LEFT-TO-RIGHT MARK: invisible, but counts as a left-to-right letter when text is laid out. */
const LRM = '\u200E'

/**
 * A path to show on screen, kept in order when it holds Hebrew or Arabic folder names. A \ or / between two
 * right-to-left names takes their direction, so `C:\Users\Dana\מסמכים\פרויקט` would show its last two folders
 * swapped. A left-to-right mark at the start, after each separator and at the end keeps every folder in its
 * place, and keeps text after the path (` · 1:3`) where it belongs. Unlike <bdi>, this also works in native
 * title tooltips. Paths with no right-to-left letters come back unchanged, so they never carry invisible marks.
 * Only for display: never pass the result back to the file system.
 */
export function displayPath(path: string): string {
    if (!RTL_LETTERS.test(path)) return path
    return `${LRM}${path.replace(/[\\/]/g, (separator) => separator + LRM)}${LRM}`
}
