import { afterEach, describe, expect, it, vi } from 'vitest'
import { combineReleaseNotes, fetchReleaseNotesSince, fetchUpdateReleaseNotes, GITHUB_TIMEOUT_MS, type GitHubReleaseSummary } from './release-notes'

function release(
    tag: string,
    body: string | null = `## [${tag.replace(/^v/, '')}]\n\n* change in ${tag}`,
    extra: Partial<GitHubReleaseSummary> = {}
) {
    return { tag_name: tag, body, draft: false, prerelease: false, ...extra }
}

function jsonResponse(data: unknown, ok = true) {
    return { ok, json: async () => data } as Response
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('combineReleaseNotes', () => {
    it('joins every release after the installed version up to the target, newest first', () => {
        const releases = [release('v1.4.0'), release('v1.4.2'), release('v1.3.0'), release('v1.4.1'), release('v1.5.0')]

        const notes = combineReleaseNotes(releases, '1.3.0', '1.4.2')

        expect(notes).toBe(['## [1.4.2]\n\n* change in v1.4.2', '## [1.4.1]\n\n* change in v1.4.1', '## [1.4.0]\n\n* change in v1.4.0'].join('\n\n'))
    })

    it('compares versions numerically, not as text', () => {
        const notes = combineReleaseNotes([release('v1.10.0'), release('v1.9.0'), release('v1.2.0')], '1.8.0', '1.10.0')

        expect(notes).toBe('## [1.10.0]\n\n* change in v1.10.0\n\n## [1.9.0]\n\n* change in v1.9.0')
    })

    it('skips drafts and prereleases when the target is a normal release', () => {
        const releases = [
            release('v2.0.0'),
            release('v2.0.0-beta.1'),
            release('v1.9.0', undefined, { draft: true }),
            release('v1.8.1', undefined, { prerelease: true }),
        ]

        expect(combineReleaseNotes(releases, '1.8.0', '2.0.0')).toBe('## [2.0.0]\n\n* change in v2.0.0')
    })

    it('adds a version heading to a body that has none and leaves out empty bodies', () => {
        const releases = [release('v1.2.0', 'Fixed the thing.'), release('v1.1.0', '   '), release('v1.0.1', null)]

        expect(combineReleaseNotes(releases, '1.0.0', '1.2.0')).toBe('## v1.2.0\n\nFixed the thing.')
    })

    it('returns null when the target release is missing or a version cannot be read', () => {
        expect(combineReleaseNotes([release('v1.1.0')], '1.0.0', '1.2.0')).toBeNull()
        expect(combineReleaseNotes([release('v1.2.0')], 'dev', '1.2.0')).toBeNull()
        expect(combineReleaseNotes([{ tag_name: 42 }, release('v1.2.0')], '1.0.0', '1.2.0')).toBe('## [1.2.0]\n\n* change in v1.2.0')
    })
})

describe('fetchReleaseNotesSince', () => {
    it('reads the release list from GitHub', async () => {
        const fetchMock = vi.fn(async () => jsonResponse([release('v1.1.0')]))
        vi.stubGlobal('fetch', fetchMock)

        await expect(fetchReleaseNotesSince('1.0.0', '1.1.0')).resolves.toBe('## [1.1.0]\n\n* change in v1.1.0')
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/repos/Jamie-Fairweather/scrivon/releases?per_page='), expect.anything())
    })

    it('gives up when GitHub takes too long', async () => {
        const timeout = vi.spyOn(AbortSignal, 'timeout')
        const fetchMock = vi.fn(
            (_url: string, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
        )
        vi.stubGlobal('fetch', fetchMock)
        const controller = new AbortController()
        timeout.mockReturnValue(controller.signal)

        const result = fetchReleaseNotesSince('1.0.0', '1.1.0')
        controller.abort(new DOMException('timed out', 'TimeoutError'))

        await expect(result).resolves.toBeNull()
        expect(timeout).toHaveBeenCalledWith(GITHUB_TIMEOUT_MS)
        expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }))
        timeout.mockRestore()
    })

    it('returns null when the request fails or the reply is not a list', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ message: 'rate limited' }, false))
        )
        await expect(fetchReleaseNotesSince('1.0.0', '1.1.0')).resolves.toBeNull()

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ message: 'odd' }))
        )
        await expect(fetchReleaseNotesSince('1.0.0', '1.1.0')).resolves.toBeNull()

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => Promise.reject(new Error('offline')))
        )
        await expect(fetchReleaseNotesSince('1.0.0', '1.1.0')).resolves.toBeNull()
    })
})

describe('fetchUpdateReleaseNotes', () => {
    it('prefers the notes for every skipped version over the update manifest notes', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse([release('v1.2.0'), release('v1.1.0')]))
        )

        await expect(fetchUpdateReleaseNotes({ version: '1.2.0', notes: 'manifest notes' }, '1.0.0')).resolves.toBe(
            '## [1.2.0]\n\n* change in v1.2.0\n\n## [1.1.0]\n\n* change in v1.1.0'
        )
    })

    it('falls back to the manifest notes, then to the target release, when the list is unavailable', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => Promise.reject(new Error('offline')))
        )
        await expect(fetchUpdateReleaseNotes({ version: '1.2.0', notes: 'manifest notes' }, '1.0.0')).resolves.toBe('manifest notes')

        const fetchMock = vi.fn(async () => jsonResponse({ body: 'tag notes' }))
        vi.stubGlobal('fetch', fetchMock)
        await expect(fetchUpdateReleaseNotes({ version: '1.2.0', notes: null }, null)).resolves.toBe('tag notes')
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/releases/tags/v1.2.0'), expect.anything())
    })
})
