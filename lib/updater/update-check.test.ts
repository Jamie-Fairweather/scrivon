import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { checkForAppUpdate, newestReleaseTag } from './update-check'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

function release(tag: string, extra: Record<string, unknown> = {}) {
    return { tag_name: tag, draft: false, prerelease: tag.includes('-'), ...extra }
}

function jsonResponse(data: unknown, ok = true) {
    return { ok, json: async () => data } as Response
}

beforeEach(() => {
    vi.mocked(invoke).mockReset()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('newestReleaseTag', () => {
    it('picks the newest release after the installed one, rc or stable', () => {
        const releases = [release('v1.5.0'), release('v1.6.0-rc.2'), release('v1.6.0-rc.10'), release('v1.6.0-rc.1')]

        expect(newestReleaseTag(releases, '1.6.0-rc.1')).toBe('v1.6.0-rc.10')
    })

    it('prefers the stable release over the release candidates before it', () => {
        const releases = [release('v1.6.0-rc.3'), release('v1.6.0'), release('v1.6.0-rc.2')]

        expect(newestReleaseTag(releases, '1.6.0-rc.2')).toBe('v1.6.0')
    })

    it('returns null when nothing is newer, and skips drafts and tags it cannot read', () => {
        const releases = [release('v1.6.0-rc.2'), release('v1.7.0', { draft: true }), release('nightly'), { tag_name: 7 }]

        expect(newestReleaseTag(releases, '1.6.0-rc.2')).toBeNull()
        expect(newestReleaseTag(releases, 'not a version')).toBeNull()
    })
})

describe('checkForAppUpdate', () => {
    it('lets a stable build use the stable update channel only', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        vi.mocked(invoke).mockResolvedValue({ version: '1.6.0', notes: null })

        await expect(checkForAppUpdate('1.5.0')).resolves.toEqual({ update: { version: '1.6.0', notes: null }, missedPrereleases: false })

        expect(fetchMock).not.toHaveBeenCalled()
        expect(invoke).toHaveBeenCalledWith('check_for_app_update', { releaseTag: null })
    })

    it('tells an rc build about the newest release on GitHub', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse([release('v1.6.0-rc.1'), release('v1.6.0-rc.2')]))
        )
        vi.mocked(invoke).mockResolvedValue(null)

        await expect(checkForAppUpdate('1.6.0-rc.1')).resolves.toEqual({ update: null, missedPrereleases: false })

        expect(invoke).toHaveBeenCalledWith('check_for_app_update', { releaseTag: 'v1.6.0-rc.2' })
    })

    it('falls back to the stable channel when GitHub cannot be asked, and says it missed the pre-releases', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('offline')
            })
        )
        vi.mocked(invoke).mockResolvedValue(null)

        await expect(checkForAppUpdate('1.6.0-rc.1')).resolves.toEqual({ update: null, missedPrereleases: true })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ message: 'rate limited' }, false))
        )
        await expect(checkForAppUpdate('1.6.0-rc.1')).resolves.toEqual({ update: null, missedPrereleases: true })

        expect(vi.mocked(invoke).mock.calls).toEqual([
            ['check_for_app_update', { releaseTag: null }],
            ['check_for_app_update', { releaseTag: null }],
        ])
    })

    it('passes on a failed check', async () => {
        vi.mocked(invoke).mockRejectedValue("Couldn't reach the update server.")

        await expect(checkForAppUpdate(null)).rejects.toBe("Couldn't reach the update server.")
    })
})
