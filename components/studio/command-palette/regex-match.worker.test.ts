import { afterEach, expect, it, vi } from 'vitest'
import type { RegexMatchRequest, RegexMatchResponse } from '@/components/studio/command-palette/regex-match-client'
import { PLAIN_SEARCH_OPTIONS } from '@/components/studio/command-palette/text-matcher'

afterEach(() => {
    vi.unstubAllGlobals()
})

it('says it is ready, then answers each file with its matches, or the error of a bad pattern', async () => {
    let listener: ((event: { data: RegexMatchRequest }) => void) | undefined
    const postMessage = vi.fn<(message: RegexMatchResponse) => void>()
    vi.stubGlobal('addEventListener', (type: string, fn: typeof listener) => {
        if (type === 'message') listener = fn
    })
    vi.stubGlobal('postMessage', postMessage)

    await import('@/components/studio/command-palette/regex-match.worker')
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'ready' })

    const options = { ...PLAIN_SEARCH_OPTIONS, useRegex: true }
    listener!({ data: { id: 1, text: 'foo\r\nbar foo\r\n', query: 'foo$', options, maxHits: null } })
    expect(postMessage).toHaveBeenLastCalledWith({
        type: 'regex-matched',
        id: 1,
        matches: [
            { lineIndex: 0, start: 0, length: 3 },
            { lineIndex: 1, start: 4, length: 3 },
        ],
        longLinesSkipped: 0,
    })

    listener!({ data: { id: 2, text: 'foo\nfoo', query: 'foo', options, maxHits: 1 } })
    expect(postMessage).toHaveBeenLastCalledWith({
        type: 'regex-matched',
        id: 2,
        matches: [{ lineIndex: 0, start: 0, length: 3 }],
        longLinesSkipped: 0,
    })

    listener!({ data: { id: 3, text: 'x', query: '[', options, maxHits: null } })
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'regex-invalid', id: 3, error: expect.stringMatching(/^Invalid regular expression: /) })
})
