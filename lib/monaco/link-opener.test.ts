import type { Monaco } from '@monaco-editor/react'
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const openUrl = vi.fn<(url: string) => Promise<void>>(async () => {})
const notifyError = vi.fn()
let inTauri = true

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (url: string) => openUrl(url) }))
vi.mock('@/lib/notify', () => ({ notifyError: (...args: unknown[]) => notifyError(...args) }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => inTauri }))

const { registerExternalLinkOpener } = await import('./link-opener')

type Opener = { open(resource: URI): Promise<boolean> }

function fakeMonaco() {
    const openers: Opener[] = []
    const monaco = { editor: { registerLinkOpener: vi.fn((opener: Opener) => openers.push(opener)) } }
    return { monaco: monaco as unknown as Monaco, openers, registerLinkOpener: monaco.editor.registerLinkOpener }
}

beforeEach(() => {
    openUrl.mockReset()
    openUrl.mockResolvedValue(undefined)
    notifyError.mockClear()
    inTauri = true
})

describe('registerExternalLinkOpener', () => {
    it('opens web and email links with the system', async () => {
        const { monaco, openers } = fakeMonaco()
        registerExternalLinkOpener(monaco)

        expect(await openers[0]!.open(URI.parse('https://mermaid.js.org/syntax/flowchart.html'))).toBe(true)
        expect(openUrl).toHaveBeenLastCalledWith('https://mermaid.js.org/syntax/flowchart.html')

        expect(await openers[0]!.open(URI.parse('https://example.com/a%20b?q=1&x=2#part'))).toBe(true)
        expect(openUrl).toHaveBeenLastCalledWith('https://example.com/a%20b?q=1&x=2#part')

        expect(await openers[0]!.open(URI.parse('mailto:me@example.com'))).toBe(true)
        expect(openUrl).toHaveBeenLastCalledWith('mailto:me@example.com')
    })

    it('leaves other links, and the browser build, to Monaco', async () => {
        const { monaco, openers } = fakeMonaco()
        registerExternalLinkOpener(monaco)

        expect(await openers[0]!.open(URI.parse('file:///C:/Windows/system32/calc.exe'))).toBe(false)
        inTauri = false
        expect(await openers[0]!.open(URI.parse('https://example.com'))).toBe(false)
        expect(openUrl).not.toHaveBeenCalled()
    })

    it('says so when the link cannot be opened', async () => {
        const { monaco, openers } = fakeMonaco()
        registerExternalLinkOpener(monaco)
        openUrl.mockRejectedValueOnce(new Error('Not allowed'))

        expect(await openers[0]!.open(URI.parse('https://example.com'))).toBe(true)
        expect(notifyError).toHaveBeenCalledWith("Couldn't open link", expect.any(Error))
    })

    it('registers once per Monaco instance', () => {
        const { monaco, registerLinkOpener } = fakeMonaco()
        registerExternalLinkOpener(monaco)
        registerExternalLinkOpener(monaco)
        expect(registerLinkOpener).toHaveBeenCalledTimes(1)
    })
})
