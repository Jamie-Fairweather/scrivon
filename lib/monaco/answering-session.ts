/**
 * With the editor split, two editors can show the same buffer, each with its own spell check (or link check), and
 * each registers its quick fixes with Monaco. Monaco asks every provider for a buffer's fixes and lists them all, so
 * each fix would show twice. This picks the one session that answers for a buffer: the latest one checking it, else
 * (no session checks it) the latest one, as with a single editor.
 */
export function createAnsweringSessions() {
    /** Each live session, as the buffer it checks now (null while it checks none). */
    const sessions: Array<() => string | null> = []
    return {
        /** Adds a session. Returns the function that removes it again. */
        add(checking: () => string | null): () => void {
            sessions.push(checking)
            return () => {
                const index = sessions.indexOf(checking)
                if (index !== -1) sessions.splice(index, 1)
            }
        },
        /** Whether the session `checking` answers for the buffer `modelUri`. */
        answers(checking: () => string | null, modelUri: string): boolean {
            return (sessions.findLast((session) => session() === modelUri) ?? sessions.at(-1)) === checking
        },
    }
}
