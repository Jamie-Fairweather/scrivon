import { describe, expect, it } from 'vitest'
import { getThemeBootScript, jsonForInlineScript } from './theme-boot-script'

describe('jsonForInlineScript', () => {
    it('escapes angle brackets so values cannot break out of script tags', () => {
        const payload = '</script><script>alert(1)</script>'
        const embedded = jsonForInlineScript(payload)

        expect(embedded).not.toContain('</script>')
        expect(embedded).toContain('\\u003c/script>')
        expect(JSON.parse(embedded)).toBe(payload)
    })
})

describe('getThemeBootScript', () => {
    it('does not embed raw script-tag closers in generated source', () => {
        const script = getThemeBootScript()

        expect(script).toMatch(/^\(function\(\)\{try\{/)
        expect(script).not.toMatch(/<\/script>/i)
    })

    it('embeds parseable theme data literals', () => {
        const script = getThemeBootScript()
        const themesMatch = script.match(/var themes=(\{.*?\});var names=/)
        const namesMatch = script.match(/var names=(\[.*?\]);var id=/)

        expect(themesMatch).not.toBeNull()
        expect(namesMatch).not.toBeNull()

        const themes = JSON.parse(themesMatch![1]!)
        const names = JSON.parse(namesMatch![1]!)

        expect(themes['scrivon-dark']).toEqual(
            expect.objectContaining({
                kind: 'dark',
                vars: expect.objectContaining({ '--background': expect.any(String) }),
            })
        )
        expect(names).toContain('--background')
    })
})
