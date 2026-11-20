/**
 * @vitest-environment happy-dom
 */
import mermaid from 'mermaid'
import { describe, expect, it } from 'vitest'
import { officialMermaidConfig } from '@/lib/mermaid/official-theme'

/**
 * The real mermaid package, reading a diagram's own settings with Scrivon's: parsing needs no page layout, so this
 * checks that what `secure` lists really is kept from a diagram, in the pinned version.
 */
describe("a diagram's own settings, read by the real mermaid package", () => {
    it.each([
        [
            'an %%{init}%% directive',
            '%%{init: {"theme": "dark", "securityLevel": "loose", "themeCSS": ".a{background:url(https://example.com/x.png)}", "themeVariables": {"background": "#ff0000"}, "darkMode": false, "fontFamily": "Comic Sans MS", "htmlLabels": true}}%%\npie\n  "A" : 1',
        ],
        [
            'front matter config',
            '---\nconfig:\n  theme: forest\n  securityLevel: loose\n  themeCSS: ".a{background:url(https://example.com/x.png)}"\n  themeVariables:\n    background: "#ff0000"\n  htmlLabels: true\n---\npie\n  "A" : 1',
        ],
    ])("can't change the theme, security, styles or labels from %s", async (_name, source) => {
        const settings = officialMermaidConfig('nord')
        mermaid.initialize(settings)
        await mermaid.parse(source)
        const config = mermaid.mermaidAPI.getConfig()
        expect(config.theme).toBe('base')
        expect(config.securityLevel).toBe('strict')
        expect(config.themeCSS ?? '').not.toContain('url(')
        expect(config.themeVariables.background).toBe(settings.themeVariables!.background)
        expect(config.darkMode).toBe(true)
        expect(config.fontFamily).toBe(settings.fontFamily)
        expect(config.htmlLabels).toBe(false)
        // Mermaid's own defaults are still there too.
        expect(config.secure).toEqual(expect.arrayContaining([...mermaid.mermaidAPI.defaultConfig.secure!]))
    })

    it('still lets a diagram choose settings of its own type', async () => {
        mermaid.initialize(officialMermaidConfig('nord'))
        await mermaid.parse('%%{init: {"pie": {"textPosition": 0.5}}}%%\npie\n  "A" : 1')
        expect(mermaid.mermaidAPI.getConfig().pie?.textPosition).toBe(0.5)
    })
})
