import type { WikiLookup } from '@/lib/workspace/wiki-link-lookup'

/**
 * What the preview knows about a wiki link's note:
 * - `found`: it is in the open folder.
 * - `missing`: no note in the open folder has that name.
 * - `unlisted`: none the file list has, but Scrivon didn't list every file in the folder (it was too big, or some
 *   folders couldn't be read), so it may be there.
 * - `no-folder`: the document isn't in an open folder (an example, or a file opened on its own), so there is nowhere
 *   to look.
 */
export type WikiLinkStatus = WikiLookup['kind'] | 'no-folder'

/** A wiki link in the preview: the note it names and the heading to open it at. */
export type WikiLinkTarget = { target: string; heading: string | null }

/** How the preview finds and follows wiki links. */
export type WikiLinkHandlers = {
    status: (target: string) => WikiLinkStatus
    open: (link: WikiLinkTarget) => void
}

type Problem = Exclude<WikiLinkStatus, 'found'>

/** What a link that can't be followed says: to a screen reader after its text, and when it is pointed at or clicked. */
export const WIKI_LINK_PROBLEMS: Record<Problem, { spoken: string; description: string }> = {
    missing: { spoken: 'note not found', description: 'No Markdown file in the open folder has this name.' },
    unlisted: {
        spoken: 'note not found in the files Scrivon listed',
        description: "Scrivon didn't list every file in this folder, so this note may be in a part it didn't read.",
    },
    'no-folder': {
        spoken: 'needs an open folder',
        description: 'Wiki links lead to notes in the open folder. Open the folder this file is in to follow them.',
    },
}

/** The title of the notice a wiki link that can't be followed shows when it is clicked. */
export function wikiLinkProblemTitle(status: Problem, target: string): string {
    return status === 'no-folder' ? 'Wiki links need an open folder' : `Couldn't find ${target}`
}
