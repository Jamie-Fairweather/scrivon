import type { GitStatusReply } from '@/lib/tauri/git'

/**
 * Why git status is wanted again: the folder opened (or the setting was turned on), Scrivon saved or changed a
 * file, the window got focus, the watcher saw files change, or it saw git's own files change (a commit, a
 * checkout or `git add` in a terminal).
 */
export type GitRefreshReason = 'open' | 'save' | 'focus' | 'watch' | 'git'

/** How long after the last request git status waits, so a burst of them (a checkout, typing with autosave) is one run. */
export const GIT_REFRESH_WAIT_MS = 300

/**
 * The longest a read waits for another refresher's read to end. Git itself is stopped after 10 seconds
 * (src-tauri/src/git_status.rs), so a read still going after this is stuck elsewhere and shouldn't hold up marks
 * for good.
 */
export const GIT_READ_WAIT_LIMIT_MS = 15_000

/**
 * The read going now (or waiting to), from any refresher. A new refresher (another folder opened, or the setting
 * turned off and on) is made while the old one's read may still run, and disposing it can't stop that git; so a
 * read waits for the one before it, and two gits never run at once.
 */
let readInFlight: Promise<void> | null = null

function oneReadAtATime<T>(read: () => Promise<T>): Promise<T> {
    const before = readInFlight
    // Nothing else running: straight away, so a folder's marks come as soon as they can.
    const turn = before ? settledOrLimit(before).then(read) : new Promise<T>((resolve) => resolve(read()))
    const done = turn.then(
        () => undefined,
        () => undefined
    )
    readInFlight = done
    void done.then(() => {
        if (readInFlight === done) readInFlight = null
    })
    return turn
}

async function settledOrLimit(read: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        await Promise.race([read, new Promise<void>((resolve) => (timer = setTimeout(resolve, GIT_READ_WAIT_LIMIT_MS)))])
    } finally {
        clearTimeout(timer)
    }
}

export type GitStatusRefresher = {
    request: (reason: GitRefreshReason) => void
    /** Stops for good: nothing waiting runs, and a result still coming is thrown away. */
    dispose: () => void
}

/**
 * Runs `read` (git status for one open folder) when asked, and hands each result to `apply`. It waits
 * GIT_REFRESH_WAIT_MS after the last request (an open runs at once), runs one at a time, and runs once more when
 * asked during a run (and never while another refresher's read runs). After git timed out it runs again only on
 * the next window focus, so a folder git is
 * slow in isn't read again after every change.
 */
export function createGitStatusRefresher({
    read,
    apply,
    wait = GIT_REFRESH_WAIT_MS,
}: {
    read: () => Promise<GitStatusReply>
    apply: (reply: GitStatusReply) => void
    wait?: number
}): GitStatusRefresher {
    let disposed = false
    let running = false
    let again = false
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = async () => {
        running = true
        let reply: GitStatusReply | null
        try {
            // Stopped while another refresher's read ran: git isn't run at all.
            reply = await oneReadAtATime(() => (disposed ? Promise.resolve(null) : read()))
        } catch {
            reply = { state: 'none' }
        }
        running = false
        if (disposed || !reply) return
        if (reply.state === 'timedOut') {
            timedOut = true
            // What was asked for meanwhile waits for the next focus too.
            again = false
        }
        apply(reply)
        if (again) {
            again = false
            void run()
        }
    }

    const start = () => {
        timer = undefined
        if (disposed) return
        if (running) {
            again = true
            return
        }
        void run()
    }

    return {
        request(reason) {
            if (disposed) return
            if (reason === 'focus') timedOut = false
            else if (timedOut) return
            clearTimeout(timer)
            if (reason === 'open') start()
            else timer = setTimeout(start, wait)
        },
        dispose() {
            disposed = true
            clearTimeout(timer)
        },
    }
}
