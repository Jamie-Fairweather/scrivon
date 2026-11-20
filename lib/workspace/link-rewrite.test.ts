import { describe, expect, it, vi } from 'vitest'
import { readDocumentLinks } from '@/lib/markdown/document-links'
import {
    applyRewrites,
    mightLinkTo,
    planLinkRewrites,
    rewriteEdits,
    rewriteSignature,
    type LinkRewriteContext,
    type PathMove,
} from '@/lib/workspace/link-rewrite'
import { applyTextEdits } from '@/lib/workspace/text-edits'

const ROOT = 'C:\\ws'

/** The file at `oldFilePath` after `move`, with every target there unless `exists` says otherwise. */
async function rewrite(text: string, oldFilePath: string, move: PathMove, overrides: Partial<LinkRewriteContext> = {}) {
    const context: LinkRewriteContext = { workspaceRoot: ROOT, oldFilePath, move, targetExists: () => true, ...overrides }
    const rewrites = await planLinkRewrites(text, context)
    return { rewrites, text: applyRewrites(text, rewrites) }
}

const moveSetup: PathMove = { oldPath: 'C:\\ws\\docs\\setup.md', newPath: 'C:\\ws\\guides\\setup.md' }

describe('links to a moved file', () => {
    it('points links and images in other files at the new place, from their own folder', async () => {
        const text = ['See [setup](docs/setup.md) and ![chart](docs/setup.md).', 'Not [other](docs/other.md).'].join('\n')
        const { rewrites, text: after } = await rewrite(text, 'C:\\ws\\README.md', moveSetup)

        expect(after).toBe(['See [setup](guides/setup.md) and ![chart](guides/setup.md).', 'Not [other](docs/other.md).'].join('\n'))
        expect(rewrites.map((r) => [r.oldAddress, r.newAddress, r.line])).toEqual([
            ['docs/setup.md', 'guides/setup.md', 1],
            ['docs/setup.md', 'guides/setup.md', 1],
        ])
    })

    it('climbs out with `..` from a file in another folder', async () => {
        const { text } = await rewrite('[s](../docs/setup.md)', 'C:\\ws\\notes\\a.md', moveSetup)
        expect(text).toBe('[s](../guides/setup.md)')
    })

    it('keeps the #fragment, ?query, title and <…> brackets', async () => {
        const source = [
            '[a](docs/setup.md#install)',
            '[b](docs/setup.md?raw=1#top "The setup")',
            "[c](<docs/setup.md> 'Title')",
            '[d](./docs/setup.md#Install%20it)',
        ].join('\n')
        const { text } = await rewrite(source, 'C:\\ws\\README.md', moveSetup)
        expect(text).toBe(
            [
                '[a](guides/setup.md#install)',
                '[b](guides/setup.md?raw=1#top "The setup")',
                "[c](<guides/setup.md> 'Title')",
                '[d](guides/setup.md#Install%20it)',
            ].join('\n')
        )
    })

    it('leaves wiki links as they are, and never reads [[a]] as a reference to an [a]: definition, which changes', async () => {
        const source = ['See [[a]], [[docs/setup]] and [[setup|the setup]].', '', '[a]: docs/setup.md'].join('\n')
        const { rewrites, text } = await rewrite(source, 'C:\\ws\\README.md', moveSetup)
        expect(text).toBe(['See [[a]], [[docs/setup]] and [[setup|the setup]].', '', '[a]: guides/setup.md'].join('\n'))
        expect(rewrites.map((r) => [r.oldAddress, r.newAddress, r.line])).toEqual([['docs/setup.md', 'guides/setup.md', 3]])
    })

    it('rewrites a reference definition, and leaves the references to it as they are', async () => {
        const source = ['Read [the setup][s] or [s].', '', '[s]: docs/setup.md "Setup"', '[o]: <docs/other.md>'].join('\n')
        const { text } = await rewrite(source, 'C:\\ws\\README.md', moveSetup)
        expect(text).toBe(['Read [the setup][s] or [s].', '', '[s]: guides/setup.md "Setup"', '[o]: <docs/other.md>'].join('\n'))
    })

    it('keeps `/` links from the open folder', async () => {
        const { text } = await rewrite('[s](/docs/setup.md#x)', 'C:\\ws\\notes\\deep\\a.md', moveSetup)
        expect(text).toBe('[s](/guides/setup.md#x)')
    })

    it('percent-encodes spaces and other unsafe characters in the new name', async () => {
        const move = { oldPath: 'C:\\ws\\docs\\setup.md', newPath: 'C:\\ws\\my docs\\set up (v2) #1.md' }
        const { text } = await rewrite('[s](docs/setup.md) [t](<docs/setup.md>)', 'C:\\ws\\README.md', move)
        expect(text).toBe('[s](my%20docs/set%20up%20%28v2%29%20%231.md) [t](<my%20docs/set%20up%20%28v2%29%20%231.md>)')
    })

    it('reads encoded and escaped addresses as the preview does', async () => {
        const move = { oldPath: 'C:\\ws\\my file (1).md', newPath: 'C:\\ws\\done\\my file (1).md' }
        const source = ['[a](my%20file%20(1).md)', '[b](<my file (1).md>)', '[c](my%20file%20\\(1\\).md#x)'].join('\n')
        const { text } = await rewrite(source, 'C:\\ws\\README.md', move)
        expect(text).toBe(['[a](done/my%20file%20%281%29.md)', '[b](<done/my%20file%20%281%29.md>)', '[c](done/my%20file%20%281%29.md#x)'].join('\n'))
    })

    it('never touches links in code blocks, inline code or maths', async () => {
        const source = [
            '```',
            '[s](docs/setup.md)',
            '```',
            '',
            '    [s](docs/setup.md)',
            '',
            'Code `[s](docs/setup.md)` and $[s](docs/setup.md)$ and',
            '',
            '$$',
            '[s](docs/setup.md)',
            '$$',
        ].join('\n')
        const { rewrites } = await rewrite(source, 'C:\\ws\\README.md', moveSetup)
        expect(rewrites).toEqual([])
    })

    it('leaves web links, # links, absolute paths and links outside the folder alone', async () => {
        const source = [
            '[w](https://example.com/docs/setup.md)',
            '[h](#setup)',
            '[a](C:/ws/docs/setup.md)',
            '[b](C:\\ws\\docs\\setup.md)',
            '[n](//server/share/docs/setup.md)',
            '[m](mailto:me@example.com)',
            '<docs/setup.md>',
        ].join('\n')
        const { rewrites } = await rewrite(source, 'C:\\ws\\README.md', moveSetup)
        expect(rewrites).toEqual([])
    })

    it('counts places from the top of the file when there is front matter, with CRLF line breaks', async () => {
        const source = ['---', 'title: "[x](docs/setup.md)"', '---', '', 'See [setup](docs/setup.md).'].join('\r\n')
        const { rewrites, text } = await rewrite(source, 'C:\\ws\\README.md', moveSetup)
        expect(text).toBe(['---', 'title: "[x](docs/setup.md)"', '---', '', 'See [setup](guides/setup.md).'].join('\r\n'))
        expect(rewrites[0]!.line).toBe(5)
        // As editor edits, on the same CRLF text.
        expect(applyTextEdits(source, rewriteEdits(source, rewrites))).toBe(text)
        expect(rewriteEdits(source, rewrites)[0]!.range).toMatchObject({ startLineNumber: 5, startColumn: 13, endLineNumber: 5, endColumn: 26 })
    })

    // Parsing 3000 links first takes several seconds under coverage on CI, so the test gets room; only the planning is timed.
    it('plans a long file with thousands of links quickly, giving the UI a turn every few hundred links', { timeout: 30_000 }, async () => {
        // Mixed line breaks: `\r\n`, `\r` and `\n` each count as one, as the editor counts them.
        const breaks = ['\n', '\r\n', '\r']
        const source = Array.from({ length: 3000 }, (_, i) => `${'Some words. '.repeat(20)}![shot ${i}](docs/setup.md#s${i})${breaks[i % 3]}`).join(
            ''
        )
        const yieldToUi = vi.fn(async () => {})
        // Parsed first (the scan does that in a worker), so only the planning is timed.
        const links = readDocumentLinks(source)
        const started = performance.now()
        const context: LinkRewriteContext = {
            workspaceRoot: ROOT,
            oldFilePath: 'C:\\ws\\README.md',
            move: moveSetup,
            targetExists: () => true,
            yieldToUi,
        }
        const rewrites = await planLinkRewrites(source, context, links)
        // Counting each link's line from the top of the file made this take many seconds.
        expect(performance.now() - started).toBeLessThan(1500)
        expect(rewrites).toHaveLength(3000)
        expect(rewrites.map((r) => r.line)).toEqual(Array.from({ length: 3000 }, (_, i) => i + 1))
        expect(rewrites[2999]).toMatchObject({ oldAddress: 'docs/setup.md#s2999', newAddress: 'guides/setup.md#s2999' })
        expect(yieldToUi).toHaveBeenCalledTimes(Math.floor(2999 / 256))
    })

    it('matches Windows paths that differ in letter case and separators, writing the target as it is spelt now', async () => {
        const move = { oldPath: 'c:/WS/Docs/Setup.md', newPath: 'C:\\ws\\Guides\\Setup.md' }
        const { text } = await rewrite('[s](docs/SETUP.md) [t](Docs\\Setup.md)', 'C:\\ws\\README.md', move)
        expect(text).toBe('[s](Guides/Setup.md) [t](Guides/Setup.md)')
    })

    it('leaves a link that was already broken as it is', async () => {
        // A file inside a moved folder that isn't there.
        const targetExists = vi.fn((path: string) => !path.toLowerCase().endsWith('gone.md'))
        const move = { oldPath: 'C:\\ws\\docs', newPath: 'C:\\ws\\archive\\docs' }
        const { text } = await rewrite('[g](docs/gone.md) [s](docs/setup.md)', 'C:\\ws\\README.md', move, { targetExists })
        expect(text).toBe('[g](docs/gone.md) [s](archive/docs/setup.md)')
        expect(targetExists).toHaveBeenCalledWith('C:\\ws\\docs\\gone.md')
    })

    it('never asks whether the moved item itself is there', async () => {
        const targetExists = vi.fn(() => false)
        const { text } = await rewrite('[s](docs/setup.md)', 'C:\\ws\\README.md', moveSetup, { targetExists })
        expect(text).toBe('[s](guides/setup.md)')
        expect(targetExists).not.toHaveBeenCalled()
    })

    it('asks about a target the caller has to look up on disk, such as one in a hidden folder', async () => {
        const targetExists = vi.fn(async (path: string) => path === 'C:\\ws\\.github\\logo.png')
        const move = { oldPath: 'C:\\ws\\README.md', newPath: 'C:\\ws\\docs\\README.md' }
        const { text } = await rewrite('![logo](.github/logo.png) ![gone](.github/gone.png)', 'C:\\ws\\README.md', move, { targetExists })
        expect(text).toBe('![logo](../.github/logo.png) ![gone](.github/gone.png)')
    })
})

describe('a case-only rename', () => {
    const move = { oldPath: 'C:\\ws\\docs\\Setup.md', newPath: 'C:\\ws\\docs\\setup.md' }

    it('fixes links whose spelling no longer matches, and leaves those that do', async () => {
        const { text } = await rewrite('[a](docs/Setup.md) [b](docs/setup.md#x) [c](docs/SETUP.md)', 'C:\\ws\\README.md', move)
        expect(text).toBe('[a](docs/setup.md) [b](docs/setup.md#x) [c](docs/setup.md)')
    })

    it("changes none of the renamed file's own links", async () => {
        const { rewrites } = await rewrite('[o](other.md) [r](../README.md) ![i](img/a.png)', 'C:\\ws\\docs\\Setup.md', move)
        expect(rewrites).toEqual([])
    })
})

describe("a moved file's own links", () => {
    const move = { oldPath: 'C:\\ws\\docs\\guide.md', newPath: 'C:\\ws\\archive\\2026\\guide.md' }

    it('are written again from its new folder', async () => {
        const source = ['[o](other.md#top) ![c](../assets/chart.png "Chart") [r](/README.md) [s](./sub/)', '', '[d]: other.md'].join('\n')
        const { text } = await rewrite(source, 'C:\\ws\\docs\\guide.md', move)
        expect(text).toBe(
            [
                '[o](../../docs/other.md#top) ![c](../../assets/chart.png "Chart") [r](/README.md) [s](../../docs/sub/)',
                '',
                '[d]: ../../docs/other.md',
            ].join('\n')
        )
    })

    it('keep links to itself working', async () => {
        const { text } = await rewrite('[me](guide.md#a) [here](#a)', 'C:\\ws\\docs\\guide.md', move)
        expect(text).toBe('[me](guide.md#a) [here](#a)')
    })

    it('are left alone after a rename in the same folder', async () => {
        const { rewrites } = await rewrite('[o](other.md) ![c](../assets/chart.png)', 'C:\\ws\\docs\\guide.md', {
            oldPath: 'C:\\ws\\docs\\guide.md',
            newPath: 'C:\\ws\\docs\\howto.md',
        })
        expect(rewrites).toEqual([])
    })

    it('leave a broken link as it is', async () => {
        const { text } = await rewrite('[o](other.md) [g](gone.md)', 'C:\\ws\\docs\\guide.md', move, {
            targetExists: (path) => !path.endsWith('gone.md'),
        })
        expect(text).toBe('[o](../../docs/other.md) [g](gone.md)')
    })
})

describe('a moved folder', () => {
    const move = { oldPath: 'C:\\ws\\docs', newPath: 'C:\\ws\\archive\\docs' }

    it('updates links into it from outside', async () => {
        const { text } = await rewrite('[s](docs/setup.md) ![i](docs/img/a.png) [d](docs/)', 'C:\\ws\\README.md', move)
        expect(text).toBe('[s](archive/docs/setup.md) ![i](archive/docs/img/a.png) [d](archive/docs/)')
    })

    it('updates links from files inside it to files outside, and not those between two files inside', async () => {
        const source = '[o](other.md) ![i](img/a.png) [r](../README.md) [b](../docs/other.md)'
        const { text } = await rewrite(source, 'C:\\ws\\docs\\setup.md', move)
        expect(text).toBe('[o](other.md) ![i](img/a.png) [r](../../README.md) [b](../docs/other.md)')
    })

    it('fixes the spelling of links into it after a case-only rename', async () => {
        const { text } = await rewrite('[s](Docs/setup.md) [t](docs/setup.md)', 'C:\\ws\\README.md', {
            oldPath: 'C:\\ws\\Docs',
            newPath: 'C:\\ws\\docs',
        })
        expect(text).toBe('[s](docs/setup.md) [t](docs/setup.md)')
    })
})

describe('rewriteSignature', () => {
    it('is the same for the same rewrites at other places, and differs when a link changed', async () => {
        const first = await planLinkRewrites('[s](docs/setup.md)', {
            workspaceRoot: ROOT,
            oldFilePath: 'C:\\ws\\README.md',
            move: moveSetup,
            targetExists: () => true,
        })
        const moved = await planLinkRewrites('Intro.\n\n[s](docs/setup.md)', {
            workspaceRoot: ROOT,
            oldFilePath: 'C:\\ws\\README.md',
            move: moveSetup,
            targetExists: () => true,
        })
        const changed = await planLinkRewrites('[s](docs/setup.md#x)', {
            workspaceRoot: ROOT,
            oldFilePath: 'C:\\ws\\README.md',
            move: moveSetup,
            targetExists: () => true,
        })
        expect(rewriteSignature(moved)).toBe(rewriteSignature(first))
        expect(rewriteSignature(changed)).not.toBe(rewriteSignature(first))
    })
})

describe('mightLinkTo', () => {
    it('looks for each word of the name, as written or percent-encoded, in any case', () => {
        expect(mightLinkTo('[s](docs/My%20Setup.md)', 'my setup.md')).toBe(true)
        expect(mightLinkTo('[s](docs/caf%C3%A9.md)', 'café.md')).toBe(true)
        expect(mightLinkTo('[s](docs/other.md)', 'setup.md')).toBe(false)
        expect(mightLinkTo('anything', '---')).toBe(true)
    })
})
