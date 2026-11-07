import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_THEMES, type AppThemeId } from '@/lib/theme/themes'

type HighlighterModule = typeof import('./shiki-highlighter')

function fakeHighlighter() {
    const loaded: string[] = []
    const themes = ['github-dark', 'github-light']
    return {
        getLoadedLanguages: () => loaded,
        getLoadedThemes: () => themes,
        loadTheme: vi.fn(async (theme: string) => {
            themes.push(theme)
        }),
        loadLanguage: vi.fn(async (lang: string) => {
            // A grammar Shiki has, but that fails to load (say its file is missing).
            if (lang === 'cobol') throw new Error('Failed to fetch dynamically imported module')
            loaded.push(lang)
        }),
        codeToHtml: vi.fn((code: string, { lang, theme }: { lang: string; theme: string }) =>
            theme.startsWith('github-') ? `<pre data-lang="${lang}">${code}</pre>` : `<pre data-lang="${lang}" data-theme="${theme}">${code}</pre>`
        ),
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
            vi.doMock('shiki', async (importOriginal) => ({ ...(await importOriginal<typeof import('shiki')>()), createHighlighter }))
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
            vi.doMock('shiki', async (importOriginal) => ({ ...(await importOriginal<typeof import('shiki')>()), createHighlighter }))
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

        it('shows a language Shiki doesn’t have as plain text, without asking Shiki for it (N20)', async () => {
            const { highlightFencedCode, highlightFencedCodeNow } = await load()

            for (const lang of ['nosuchlang', 'constructor', '__proto__', 'toString']) {
                await expect(highlightFencedCode('a', lang, 'github-dark')).resolves.toBe('<pre data-lang="text">a</pre>')
                expect(highlightFencedCodeNow('ab', lang, 'github-dark')).toBe('<pre data-lang="text">ab</pre>')
            }

            const highlighter = await createHighlighter.mock.results[0]!.value
            expect(highlighter.loadLanguage).not.toHaveBeenCalled()
        })

        it('shows a grammar that fails to load as plain text, without trying to load it again', async () => {
            const { highlightFencedCode, highlightFencedCodeNow } = await load()

            await expect(highlightFencedCode('a', 'cobol', 'github-dark')).resolves.toBe('<pre data-lang="text">a</pre>')
            expect(highlightFencedCodeNow('ab', 'cobol', 'github-dark')).toBe('<pre data-lang="text">ab</pre>')
            await highlightFencedCode('abc', 'cobol', 'github-dark')

            const highlighter = await createHighlighter.mock.results[0]!.value
            expect(highlighter.loadLanguage).toHaveBeenCalledTimes(1)
        })

        it('leaves a long block to wait for a pause in typing', async () => {
            const { highlightFencedCode, highlightFencedCodeNow } = await load()
            await highlightFencedCode('x', 'text', 'github-dark')

            expect(highlightFencedCodeNow('x'.repeat(4_000), 'text', 'github-dark')).not.toBeNull()
            expect(highlightFencedCodeNow('x'.repeat(4_001), 'text', 'github-dark')).toBeNull()
        })

        it('stops highlighting on the spot once a frame’s time is used up, until the next frame', async () => {
            const { highlightFencedCode, highlightFencedCodeNow } = await load()
            await highlightFencedCode('x', 'text', 'github-dark')
            const highlighter = await createHighlighter.mock.results[0]!.value
            // Each block takes 5 ms; a frame has 8 ms for them all.
            let clock = 0
            const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
            highlighter.codeToHtml.mockImplementation((code: string) => {
                clock += 5
                return `<pre>${code}</pre>`
            })

            try {
                expect(highlightFencedCodeNow('a', 'text', 'github-dark')).toBe('<pre>a</pre>')
                expect(highlightFencedCodeNow('b', 'text', 'github-dark')).toBe('<pre>b</pre>')
                expect(highlightFencedCodeNow('c', 'text', 'github-dark')).toBeNull()

                await new Promise((resolve) => setTimeout(resolve, 0))
                expect(highlightFencedCodeNow('c', 'text', 'github-dark')).toBe('<pre>c</pre>')
            } finally {
                now.mockRestore()
            }
        })

        it('loads a palette’s code theme the first time a block needs it', async () => {
            const { highlightFencedCode, highlightFencedCodeNow } = await load()
            await highlightFencedCode('x', 'text', 'github-dark')
            expect(highlightFencedCodeNow('y', 'text', 'dracula')).toBeNull()

            await expect(highlightFencedCode('y', 'text', 'dracula')).resolves.toBe('<pre data-lang="text" data-theme="dracula">y</pre>')
            expect(highlightFencedCodeNow('z', 'text', 'dracula')).toBe('<pre data-lang="text" data-theme="dracula">z</pre>')
            await highlightFencedCode('w', 'text', 'dracula')

            const highlighter = await createHighlighter.mock.results[0]!.value
            expect(highlighter.loadTheme).toHaveBeenCalledTimes(1)
            expect(highlighter.loadTheme).toHaveBeenCalledWith('dracula')
        })
    })

    describe('preview code colours for each palette', () => {
        it('uses Shiki’s own version of a palette, and GitHub’s colours for the rest', async () => {
            const { previewCodeTheme } = await import('./shiki-highlighter')
            expect(previewCodeTheme('dracula', false)).toBe('dracula')
            expect(previewCodeTheme('one-dark', false)).toBe('one-dark-pro')
            expect(previewCodeTheme('tokyo-night-storm', false)).toBe('tokyo-night')
            expect(previewCodeTheme('catppuccin-latte', true)).toBe('catppuccin-latte')
            expect(previewCodeTheme('scrivon-light', true)).toBe('github-light')
            expect(previewCodeTheme('zinc-dark', false)).toBe('github-dark')
            expect(previewCodeTheme('nord-light', true)).toBe('github-light')
        })

        it('gives every palette a real Shiki theme that is light or dark like the palette', async () => {
            const { previewCodeTheme } = await import('./shiki-highlighter')
            const { bundledThemesInfo } = await import('shiki')
            const kinds = new Map(bundledThemesInfo.map((info) => [info.id, info.type]))

            for (const [id, palette] of Object.entries(APP_THEMES)) {
                const codeTheme = previewCodeTheme(id as AppThemeId, palette.kind === 'light')
                expect({ id, kind: kinds.get(codeTheme) }).toEqual({ id, kind: palette.kind })
            }
        })
    })

    it('still highlights a language that was not loaded up front', async () => {
        const { highlightFencedCodeTokens } = await import('./shiki-highlighter')
        const lines = await highlightFencedCodeTokens('const answer = 42', 'ts', 'github-dark')
        const colours = new Set(lines.flat().map((token) => token.color))
        expect(colours.size).toBeGreaterThan(1)
    })

    it('still colours other languages after a fence named `constructor` or `__proto__` (N20)', async () => {
        const { highlightFencedCode, highlightFencedCodeTokens } = await import('./shiki-highlighter')
        const plain = await highlightFencedCode('x = 1', 'text', 'github-dark')
        await expect(highlightFencedCode('x = 1', 'constructor', 'github-dark')).resolves.toBe(plain)
        await expect(highlightFencedCode('x = 1', '__proto__', 'github-dark')).resolves.toBe(plain)

        const lines = await highlightFencedCodeTokens('def answer():\n    return 42', 'python', 'github-dark')
        const colours = new Set(lines.flat().map((token) => token.color))
        expect(colours.size).toBeGreaterThan(1)
    })
})
