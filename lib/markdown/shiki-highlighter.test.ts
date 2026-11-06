import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type HighlighterModule = typeof import('./shiki-highlighter')

function fakeHighlighter() {
    const loaded: string[] = []
    return {
        getLoadedLanguages: () => loaded,
        loadLanguage: vi.fn(async (lang: string) => {
            if (lang === 'nosuchlang') throw new Error('Language `nosuchlang` is not included in this bundle.')
            loaded.push(lang)
        }),
        codeToHtml: vi.fn((code: string, { lang }: { lang: string }) => `<pre data-lang="${lang}">${code}</pre>`),
    }
}

describe('shiki highlighter', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    afterEach(() => {
        vi.doUnmock('shiki')
    })

    describe('start-up', () => {
        const createHighlighter = vi.fn()

        async function load(): Promise<HighlighterModule> {
            vi.doMock('shiki', () => ({ createHighlighter }))
            return import('./shiki-highlighter')
        }

        afterEach(() => {
            createHighlighter.mockReset()
        })

        it('loads no grammars up front, only the one a block uses', async () => {
            const highlighter = fakeHighlighter()
            createHighlighter.mockResolvedValue(highlighter)
            const { highlightFencedCode } = await load()

            const html = await highlightFencedCode('echo hi\n', 'sh', 'github-dark')

            expect(createHighlighter).toHaveBeenCalledWith(expect.objectContaining({ langs: [] }))
            expect(highlighter.loadLanguage).toHaveBeenCalledTimes(1)
            expect(highlighter.loadLanguage).toHaveBeenCalledWith('bash')
            expect(html).toBe('<pre data-lang="bash">echo hi</pre>')

            await highlightFencedCode('ls', 'bash', 'github-dark')
            expect(highlighter.loadLanguage).toHaveBeenCalledTimes(1)
        })

        it('starts again after a failed start instead of staying off until restart', async () => {
            createHighlighter.mockRejectedValueOnce(new Error('wasm failed')).mockResolvedValueOnce(fakeHighlighter())
            const { highlightFencedCode } = await load()

            await expect(highlightFencedCode('x', 'text', 'github-light')).rejects.toThrow('wasm failed')
            await expect(highlightFencedCode('x', 'text', 'github-light')).resolves.toBe('<pre data-lang="text">x</pre>')
            expect(createHighlighter).toHaveBeenCalledTimes(2)
        })
    })

    describe('highlighting without waiting', () => {
        const createHighlighter = vi.fn()

        async function load(): Promise<HighlighterModule> {
            createHighlighter.mockResolvedValue(fakeHighlighter())
            vi.doMock('shiki', () => ({ createHighlighter }))
            return import('./shiki-highlighter')
        }

        afterEach(() => {
            createHighlighter.mockReset()
        })

        it('highlights straight away once Shiki has started and the grammar is loaded', async () => {
            const { highlightFencedCode, highlightFencedCodeNow } = await load()
            expect(highlightFencedCodeNow('ls', 'bash', 'github-dark')).toBeNull()

            await highlightFencedCode('echo hi', 'sh', 'github-dark')
            expect(highlightFencedCodeNow('ls\n', 'bash', 'github-dark')).toBe('<pre data-lang="bash">ls</pre>')
            expect(highlightFencedCodeNow('plain', undefined, 'github-dark')).toBe('<pre data-lang="text">plain</pre>')
            expect(highlightFencedCodeNow('print(1)', 'python', 'github-dark')).toBeNull()
        })

        it('shows a language Shiki doesn’t have as plain text, without trying to load it again', async () => {
            const { highlightFencedCode, highlightFencedCodeNow } = await load()

            await expect(highlightFencedCode('a', 'nosuchlang', 'github-dark')).resolves.toBe('<pre data-lang="text">a</pre>')
            expect(highlightFencedCodeNow('ab', 'nosuchlang', 'github-dark')).toBe('<pre data-lang="text">ab</pre>')
            await highlightFencedCode('abc', 'nosuchlang', 'github-dark')

            const highlighter = await createHighlighter.mock.results[0]!.value
            expect(highlighter.loadLanguage).toHaveBeenCalledTimes(1)
        })

        it('leaves a long block to wait for a pause in typing', async () => {
            const { highlightFencedCode, highlightFencedCodeNow } = await load()
            await highlightFencedCode('x', 'text', 'github-dark')

            expect(highlightFencedCodeNow('x'.repeat(4_000), 'text', 'github-dark')).not.toBeNull()
            expect(highlightFencedCodeNow('x'.repeat(4_001), 'text', 'github-dark')).toBeNull()
        })
    })

    it('still highlights a language that was not loaded up front', async () => {
        const { highlightFencedCodeTokens } = await import('./shiki-highlighter')
        const lines = await highlightFencedCodeTokens('const answer = 42', 'ts', 'github-dark')
        const colours = new Set(lines.flat().map((token) => token.color))
        expect(colours.size).toBeGreaterThan(1)
    })
})
