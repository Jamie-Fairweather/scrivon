import { afterEach, expect, it, vi } from 'vitest'
import type { OutlineRequest, OutlineResponse } from '@/lib/markdown/outline-reader'

afterEach(() => {
    vi.unstubAllGlobals()
})

it('answers each request with the headings of its text', async () => {
    let listener: ((event: { data: OutlineRequest }) => void) | undefined
    const postMessage = vi.fn<(message: OutlineResponse) => void>()
    vi.stubGlobal('addEventListener', (type: string, fn: typeof listener) => {
        if (type === 'message') listener = fn
    })
    vi.stubGlobal('postMessage', postMessage)

    await import('@/lib/markdown/outline.worker')
    listener!({ data: { id: 4, source: 'Intro\n\n## Setup' } })

    expect(postMessage).toHaveBeenCalledWith({ id: 4, headings: [{ id: 'setup', level: 2, text: 'Setup', line: 3 }] })
})
