/** A heading made from a file name: `meeting-notes.md` becomes `Meeting notes`. */
export function titleFromFileName(name: string): string {
    const words = name
        .replace(/\.[^.]*$/, '')
        .replace(/[-_\s]+/g, ' ')
        .trim()
    return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * What a new .md file starts with: a heading named after the file, ready to write under. Exports take the
 * first heading as the document title, so it matches the file name until the user changes it.
 */
export function defaultMarkdownFor(name: string): string {
    const title = titleFromFileName(name)
    return title ? `# ${title}\n\n` : ''
}
