// @vitest-environment happy-dom
// (Monaco's real opener service, used in the last test, needs a window.)
import { URI } from 'monaco-editor/base/common/uri.js'
import { OpenerService } from 'monaco-editor/editor/browser/services/openerService.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinkOpenerService, LinkTarget } from './link-opener'

const openUrl = vi.fn<(url: string) => Promise<void>>(async () => {})
const notifyError = vi.fn()
let inTauri = true

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (url: string) => openUrl(url) }))
vi.mock('@/lib/notify', () => ({ notifyError: (...args: unknown[]) => notifyError(...args) }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => inTauri }))

const { linkHref, registerExternalLinkOpener } = await import('./link-opener')

type Opener = { open(target: LinkTarget): Promise<boolean> }

function fakeOpenerService() {
    const openers: Opener[] = []
    const registerOpener = vi.fn((opener: Opener) => {
        openers.push(opener)
        return { dispose: () => {} }
    })
    const service: LinkOpenerService = { registerOpener }
    return { service, openers, registerOpener }
}

beforeEach(() => {
    openUrl.mockReset()
    openUrl.mockResolvedValue(undefined)
    notifyError.mockClear()
    inTauri = true
})

describe('registerExternalLinkOpener', () => {
    it('opens web and email links with the system', async () => {
        const { service, openers } = fakeOpenerService()
        registerExternalLinkOpener(service)

        expect(await openers[0]!.open('https://mermaid.js.org/syntax/flowchart.html')).toBe(true)
        expect(openUrl).toHaveBeenLastCalledWith('https://mermaid.js.org/syntax/flowchart.html')

        expect(await openers[0]!.open('mailto:me@example.com')).toBe(true)
        expect(openUrl).toHaveBeenLastCalledWith('mailto:me@example.com')

        expect(await openers[0]!.open(URI.parse('https://example.com/a%20b?q=1&x=2#part'))).toBe(true)
        expect(openUrl).toHaveBeenLastCalledWith('https://example.com/a%20b?q=1&x=2#part')
    })

    it.each([
        'https://example.com/search?q=rock%26roll',
        'https://gitlab.com/api/v4/projects/group%2Fproj',
        'https://example.com/a%23b',
        'https://example.com/login?redirect=https%3A%2F%2Fexample.org%2Fhome%3Fx%3D1',
        'HTTPS://example.com/Upper',
    ])('opens the link text %s exactly as written', async (href) => {
        const { service, openers } = fakeOpenerService()
        registerExternalLinkOpener(service)

        expect(await openers[0]!.open(href)).toBe(true)
        expect(openUrl).toHaveBeenLastCalledWith(href)
    })

    it('leaves other links, and the browser build, to Monaco', async () => {
        const { service, openers } = fakeOpenerService()
        registerExternalLinkOpener(service)

        expect(await openers[0]!.open('file:///C:/Windows/system32/calc.exe')).toBe(false)
        expect(await openers[0]!.open(URI.parse('command:editor.action.selectAll'))).toBe(false)
        expect(await openers[0]!.open('not a link')).toBe(false)
        inTauri = false
        expect(await openers[0]!.open('https://example.com')).toBe(false)
        expect(openUrl).not.toHaveBeenCalled()
    })

    it('says so when the link cannot be opened', async () => {
        const { service, openers } = fakeOpenerService()
        registerExternalLinkOpener(service)
        openUrl.mockRejectedValueOnce(new Error('Not allowed'))

        expect(await openers[0]!.open('https://example.com')).toBe(true)
        expect(notifyError).toHaveBeenCalledWith("Couldn't open link", expect.any(Error))
    })

    it('registers once per opener service', () => {
        const { service, registerOpener } = fakeOpenerService()
        registerExternalLinkOpener(service)
        registerExternalLinkOpener(service)
        expect(registerOpener).toHaveBeenCalledTimes(1)
    })

    it("is asked before Monaco's own opener and gets the link text as Monaco's link detector found it", async () => {
        const openerService = new OpenerService(null as never, null as never)
        registerExternalLinkOpener(openerService)

        const href = 'https://example.com/search?q=rock%26roll&next=%2Fhome%23top'
        expect(await openerService.open(href, { fromUserGesture: true, allowContributedOpeners: true })).toBe(true)
        expect(openUrl).toHaveBeenCalledTimes(1)
        expect(openUrl).toHaveBeenLastCalledWith(href)
    })
})

describe('linkHref', () => {
    it('keeps link text as is, and encodes a parsed Uri the way Monaco does', () => {
        expect(linkHref('https://example.com/a%2Fb')).toBe('https://example.com/a%2Fb')
        expect(linkHref(URI.parse('https://example.com/a b'))).toBe('https://example.com/a%20b')
    })
})
