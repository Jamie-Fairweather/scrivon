/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MermaidConfig } from 'mermaid'
import { officialMermaidConfig } from '@/lib/mermaid/official-theme'
import { RENDER_TIMEOUT_MESSAGE, RENDER_TIMEOUT_MS, RendererLoadError } from '@/lib/mermaid/render-errors'
import { getDiagramColors } from '@/lib/theme/catalog'

/**
 * Mermaid, faked: it can't lay a diagram out in happy-dom. Like the real one, a render reads the settings the last
 * `initialize` set, adds its working box (`#d<id>`) to the page, and leaves it there when it fails or never ends.
 */
const fake = vi.hoisted(() => {
    const state = {
        loads: 0,
        failLoads: 0,
        settings: null as MermaidConfig | null,
        /** What happened, in order: `init <theme bg>` and `render <id> <theme bg>`. */
        log: [] as string[],
        /** Renders still waiting for `finish`. */
        held: [] as { id: string; finish: (svg?: string) => void; fail: (err: unknown) => void }[],
        hold: false,
    }
    const mermaid = {
        initialize: (config: MermaidConfig) => {
            state.settings = config
            state.log.push(`init ${config.themeVariables?.background}`)
        },
        render: (id: string, text: string) => {
            // Read as the real one reads them: at the start, before it first waits.
            const background = state.settings?.themeVariables?.background
            state.log.push(`render ${id} ${background}`)
            const box = document.createElement('div')
            box.id = `d${id}`
            document.body.append(box)
            const tooltip = document.createElement('div')
            tooltip.className = 'mermaidTooltip'
            document.body.append(tooltip)
            const svg = `<svg id="${id}" width="100%" style="max-width: 120px;" viewBox="0 0 120 80"><style>#${id}{fill:${background};}</style></svg>`
            return new Promise<{ svg: string }>((resolve, reject) => {
                const finish = (out = svg) => {
                    box.remove()
                    resolve({ svg: out })
                }
                // Mermaid with suppressErrorRendering throws its parser's error, and leaves its box behind when drawing fails.
                const fail = (err: unknown) => reject(err)
                if (text.startsWith('bad')) fail(new Error(`Parse error on line 2:\n${text}\n---^`))
                else if (state.hold) state.held.push({ id, finish, fail })
                else finish()
            })
        },
    }
    return { state, mermaid }
})

/** The module, counting loads. A test that counts them mocks it afresh (vi.doMock), so the count starts from its own. */
function mermaidModule() {
    fake.state.loads++
    if (fake.state.failLoads > 0) {
        fake.state.failLoads--
        throw new Error('Failed to fetch dynamically imported module: /_next/static/chunks/mermaid.js')
    }
    return { default: fake.mermaid }
}

vi.mock('mermaid', () => ({ default: fake.mermaid }))

async function loadOfficial() {
    vi.resetModules()
    return import('@/lib/mermaid/render-official')
}

/** Lets queued promise callbacks run. */
async function settle() {
    for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
    Object.assign(fake.state, { loads: 0, failLoads: 0, settings: null, log: [], held: [], hold: false })
    document.body.innerHTML = '<main id="app"></main>'
})

afterEach(() => {
    vi.useRealTimers()
})

describe('renderOfficialDiagram', () => {
    it('sets the theme and draws as one step, and returns a sized SVG with no backdrop for the preview', async () => {
        const { renderOfficialDiagram } = await loadOfficial()
        const svg = await renderOfficialDiagram('pie\n  "A" : 1', 'nord')
        expect(fake.state.settings).toEqual(officialMermaidConfig('nord'))
        expect(svg).toMatch(/^<svg width="120" height="80" id="scrivon-mermaid-[a-z\d]+-1" viewBox="0 0 120 80">/)
        expect(svg).not.toContain('max-width')
        expect(svg).not.toContain('background-color')
    })

    it('passes mermaid the original text, front matter, %%{init}%% and accessibility lines included', async () => {
        const { renderOfficialDiagram } = await loadOfficial()
        const source = '---\nconfig:\n  theme: dark\n---\n%%{init: {"securityLevel": "loose"}}%%\npie\n  accTitle: Pets\n  "A" : 1'
        const render = vi.spyOn(fake.mermaid, 'render')
        await renderOfficialDiagram(source, 'scrivon-light')
        expect(render).toHaveBeenCalledWith(expect.stringMatching(/^scrivon-mermaid-/), source)
        render.mockRestore()
    })

    it("keeps the diagram's own config from changing the theme, security or styles", async () => {
        const { renderOfficialDiagram } = await loadOfficial()
        await renderOfficialDiagram('pie\n  "A" : 1', 'dracula')
        const settings = fake.state.settings!
        expect(settings.securityLevel).toBe('strict')
        expect(settings.theme).toBe('base')
        expect(settings.secure).toEqual(
            expect.arrayContaining(['securityLevel', 'theme', 'themeVariables', 'themeCSS', 'fontFamily', 'darkMode', 'htmlLabels'])
        )
        expect(settings).not.toHaveProperty('themeCSS')
    })

    it('puts the theme background behind an export that asks for one', async () => {
        const { renderOfficialDiagram } = await loadOfficial()
        const svg = await renderOfficialDiagram('pie\n  "A" : 1', 'dracula', { transparent: false })
        expect(svg).toContain(`style="background-color: ${getDiagramColors('dracula').bg}"`)
    })

    it('gives every render its own id, even for the same text', async () => {
        const { renderOfficialDiagram } = await loadOfficial()
        const [a, b] = await Promise.all([renderOfficialDiagram('pie\n  "A" : 1', 'nord'), renderOfficialDiagram('pie\n  "A" : 1', 'nord')])
        const id = (svg: string) => / id="([^"]+)"/.exec(svg)![1]
        expect(id(a)).not.toBe(id(b))
    })

    it('runs one render at a time, each with its own theme set just before it draws', async () => {
        const { renderOfficialDiagram } = await loadOfficial()
        fake.state.hold = true
        const light = renderOfficialDiagram('pie\n  "A" : 1', 'scrivon-light')
        const dark = renderOfficialDiagram('gantt\n  title Plan', 'scrivon-dark', { transparent: false })
        await settle()
        // The second waits for the first, so it can't change the settings the first is drawing with.
        expect(fake.state.held).toHaveLength(1)
        fake.state.held.shift()!.finish()
        await settle()
        expect(fake.state.held).toHaveLength(1)
        fake.state.held.shift()!.finish()
        const [lightSvg, darkSvg] = await Promise.all([light, dark])

        const lightBg = getDiagramColors('scrivon-light').bg
        const darkBg = getDiagramColors('scrivon-dark').bg
        expect(fake.state.log).toEqual([
            `init ${lightBg}`,
            expect.stringMatching(new RegExp(`^render \\S+ ${lightBg}$`)),
            `init ${darkBg}`,
            expect.stringMatching(new RegExp(`^render \\S+ ${darkBg}$`)),
        ])
        expect(lightSvg).toContain(`fill:${lightBg}`)
        expect(darkSvg).toContain(`fill:${darkBg}`)
        expect(darkSvg).not.toContain(lightBg)
    })

    it("rejects with mermaid's own message for text that doesn't parse, and draws the next one", async () => {
        const { renderOfficialDiagram } = await loadOfficial()
        await expect(renderOfficialDiagram('bad pie', 'nord')).rejects.toThrow('Parse error on line 2:\nbad pie\n---^')
        await expect(renderOfficialDiagram('pie\n  "A" : 1', 'nord')).resolves.toContain('<svg')
    })

    it('turns a thrown string into an error', async () => {
        const { renderOfficialDiagram } = await loadOfficial()
        fake.state.hold = true
        const failing = renderOfficialDiagram('pie\n  "A" : 1', 'nord')
        await settle()
        fake.state.held.shift()!.fail('Lexical error')
        await expect(failing).rejects.toEqual(new Error('Lexical error'))
    })

    it.each([
        ['a render that worked', 'pie\n  "A" : 1'],
        ['a render that failed', 'bad pie'],
    ])('leaves nothing mermaid added in the page after %s', async (_name, source) => {
        const { renderOfficialDiagram } = await loadOfficial()
        await renderOfficialDiagram(source, 'nord').catch(() => {})
        expect(document.body.innerHTML).toBe('<main id="app"></main>')
    })

    it('gives up on a render that takes too long, cleans up, and draws the next one', async () => {
        vi.useFakeTimers()
        const { renderOfficialDiagram } = await loadOfficial()
        fake.state.hold = true
        const slow = renderOfficialDiagram('pie\n  "A" : 1', 'nord')
        const failed = expect(slow).rejects.toThrow(RENDER_TIMEOUT_MESSAGE)
        await vi.advanceTimersByTimeAsync(RENDER_TIMEOUT_MS)
        await failed
        expect(document.body.innerHTML).toBe('<main id="app"></main>')

        fake.state.hold = false
        await expect(renderOfficialDiagram('pie\n  "B" : 1', 'nord')).resolves.toContain('<svg')
        // The stuck render finishing late adds nothing back.
        fake.state.held.shift()!.finish()
        await settle()
        expect(document.body.innerHTML).toBe('<main id="app"></main>')
    })

    it('loads mermaid only for the first render', async () => {
        vi.doMock('mermaid', mermaidModule)
        const { renderOfficialDiagram } = await loadOfficial()
        expect(fake.state.loads).toBe(0)
        await renderOfficialDiagram('pie\n  "A" : 1', 'nord')
        await renderOfficialDiagram('pie\n  "B" : 1', 'nord')
        expect(fake.state.loads).toBe(1)
    })

    it('says plainly when mermaid fails to load, and loads it again for the next render', async () => {
        fake.state.failLoads = 1
        vi.doMock('mermaid', mermaidModule)
        const { renderOfficialDiagram } = await loadOfficial()
        // The class from the same fresh load of the modules.
        const errors = await import('@/lib/mermaid/render-errors')
        const err = await renderOfficialDiagram('pie\n  "A" : 1', 'nord').catch((error: unknown) => error)
        expect(err).toBeInstanceOf(errors.RendererLoadError)
        expect(err).toMatchObject({ message: new RendererLoadError(null).message })
        await expect(renderOfficialDiagram('pie\n  "A" : 1', 'nord')).resolves.toContain('<svg')
        expect(fake.state.loads).toBe(2)
    })
})
