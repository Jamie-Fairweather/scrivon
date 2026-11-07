import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BASIC_LANGUAGES = join(process.cwd(), 'node_modules', 'monaco-editor', 'esm', 'vs', 'basic-languages')

describe('code-block-languages', () => {
    // Importing Monaco itself here takes over ten seconds, so this reads the list instead.
    it('loads every language Monaco can colour, so any code block in Markdown is coloured', () => {
        const source = readFileSync(join(process.cwd(), 'lib', 'monaco', 'code-block-languages.ts'), 'utf8')
        const imported = new Set([...source.matchAll(/basic-languages\/([^/]+)\/\1\.contribution\.js'/g)].map((m) => m[1]))
        const shipped = readdirSync(BASIC_LANGUAGES).filter((name) => existsSync(join(BASIC_LANGUAGES, name, `${name}.contribution.js`)))

        expect(shipped).toEqual(expect.arrayContaining(['javascript', 'typescript', 'python', 'shell', 'html', 'css', 'yaml']))
        // Markdown is loaded by setup-monaco.ts, before this list.
        expect([...imported].sort()).toEqual(shipped.filter((name) => name !== 'markdown').sort())
    })
})
