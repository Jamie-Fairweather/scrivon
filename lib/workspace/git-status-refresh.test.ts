import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitStatusReply } from '@/lib/tauri/git'
import { createGitStatusRefresher, GIT_REFRESH_WAIT_MS } from '@/lib/workspace/git-status-refresh'

const CHANGES: GitStatusReply = { state: 'changes', entries: [{ kind: 'changed', xy: '.M', path: 'a.md', dir: false }] }

/** A git status that answers only when told to. */
function controlledRead() {
    const pending: Array<(reply: GitStatusReply) => void> = []
    const read = vi.fn(
        () =>
            new Promise<GitStatusReply>((resolve) => {
                pending.push(resolve)
            })
    )
    const answer = async (reply: GitStatusReply = CHANGES) => {
        pending.shift()!(reply)
        await vi.advanceTimersByTimeAsync(0)
    }
    return { read, answer, running: () => pending.length }
}

describe('createGitStatusRefresher', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('runs straight away when the folder opens, and waits after the last of other requests', async () => {
        const { read, answer } = controlledRead()
        const apply = vi.fn()
        const refresher = createGitStatusRefresher({ read, apply })

        refresher.request('open')
        expect(read).toHaveBeenCalledTimes(1)
        await answer()
        expect(apply).toHaveBeenCalledExactlyOnceWith(CHANGES)

        refresher.request('save')
        await vi.advanceTimersByTimeAsync(GIT_REFRESH_WAIT_MS - 50)
        refresher.request('watch')
        await vi.advanceTimersByTimeAsync(GIT_REFRESH_WAIT_MS - 50)
        expect(read).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(50)
        expect(read).toHaveBeenCalledTimes(2)
    })

    it('runs one at a time, and once more when asked during a run', async () => {
        const { read, answer, running } = controlledRead()
        const refresher = createGitStatusRefresher({ read, apply: vi.fn() })

        refresher.request('open')
        refresher.request('git')
        await vi.advanceTimersByTimeAsync(GIT_REFRESH_WAIT_MS)
        refresher.request('focus')
        await vi.advanceTimersByTimeAsync(GIT_REFRESH_WAIT_MS)
        expect(running()).toBe(1)
        expect(read).toHaveBeenCalledTimes(1)

        await answer()
        // The two asked for during the run are one more run.
        expect(read).toHaveBeenCalledTimes(2)
        await answer()
        await vi.advanceTimersByTimeAsync(GIT_REFRESH_WAIT_MS * 2)
        expect(read).toHaveBeenCalledTimes(2)
    })

    it('throws away a result that comes after it was stopped, and runs nothing more', async () => {
        const { read, answer } = controlledRead()
        const apply = vi.fn()
        const refresher = createGitStatusRefresher({ read, apply })

        refresher.request('open')
        refresher.request('save')
        refresher.dispose()
        await answer()
        await vi.advanceTimersByTimeAsync(GIT_REFRESH_WAIT_MS)

        expect(apply).not.toHaveBeenCalled()
        expect(read).toHaveBeenCalledTimes(1)
        refresher.request('open')
        expect(read).toHaveBeenCalledTimes(1)
    })

    it('after a timeout, runs again only on the next window focus', async () => {
        const { read, answer } = controlledRead()
        const apply = vi.fn()
        const refresher = createGitStatusRefresher({ read, apply })

        refresher.request('open')
        // Asked for while the slow run is still going.
        refresher.request('watch')
        await vi.advanceTimersByTimeAsync(GIT_REFRESH_WAIT_MS)
        await answer({ state: 'timedOut' })
        expect(apply).toHaveBeenLastCalledWith({ state: 'timedOut' })

        for (const reason of ['watch', 'git', 'save'] as const) refresher.request(reason)
        await vi.advanceTimersByTimeAsync(GIT_REFRESH_WAIT_MS)
        expect(read).toHaveBeenCalledTimes(1)

        refresher.request('focus')
        await vi.advanceTimersByTimeAsync(GIT_REFRESH_WAIT_MS)
        expect(read).toHaveBeenCalledTimes(2)
        await answer()

        // It worked this time, so changes run it again.
        refresher.request('watch')
        await vi.advanceTimersByTimeAsync(GIT_REFRESH_WAIT_MS)
        expect(read).toHaveBeenCalledTimes(3)
    })

    it('takes a read that fails for no changes', async () => {
        const apply = vi.fn()
        const refresher = createGitStatusRefresher({ read: () => Promise.reject(new Error('gone')), apply })

        refresher.request('open')
        await vi.advanceTimersByTimeAsync(0)

        expect(apply).toHaveBeenCalledExactlyOnceWith({ state: 'none' })
    })
})
