import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/tauri/platform'

/** One changed path from `git status --porcelain=v2` (src-tauri/src/git_status.rs). */
export type GitEntry = {
    /** The kind of status line: `1`, `2` (renamed or copied), `u` (a merge conflict) or `?`. */
    kind: 'changed' | 'renamed' | 'unmerged' | 'untracked'
    /** The index and work tree letters as git writes them (`.M`, `A.`, `R.`, `UU`); `??` when untracked. */
    xy: string
    /** From the open folder, with `/` between names. Empty for the open folder itself. */
    path: string
    /** A folder git didn't list the inside of: everything in it is untracked. */
    dir: boolean
    /** Where a renamed or copied file came from, when that is in the open folder. */
    from?: string
}

/** The changes, nothing to show (no git, not a repository, git failed or refused), or git took too long. */
export type GitStatusReply = { state: 'changes'; entries: GitEntry[] } | { state: 'none' } | { state: 'timedOut' }

const NONE: GitStatusReply = { state: 'none' }

/**
 * What git sees changed in the open folder `folder`. Never throws: any trouble is no changes, which the app
 * has already logged.
 */
export async function readGitStatus(folder: string): Promise<GitStatusReply> {
    if (!isTauri()) return NONE
    try {
        const reply = await invoke<GitStatusReply | null>('git_status', { folder })
        return reply && typeof reply === 'object' && 'state' in reply ? reply : NONE
    } catch (err) {
        console.warn("Couldn't read the folder's git changes", err)
        return NONE
    }
}
