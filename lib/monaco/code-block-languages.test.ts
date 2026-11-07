import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const LANGUAGE_DEFINITIONS = join(process.cwd(), 'node_modules', 'monaco-editor', 'esm', 'vs', 'languages', 'definitions')

describe('code-block-languages', () => {
    // Importing Monaco itself here takes over ten seconds, so this reads the list instead.
    it('loads every language Monaco can colour, so any code block in Markdown is coloured', () => {
        const source = readFileSync(join(process.cwd(), 'lib', 'monaco', 'code-block-languages.ts'), 'utf8')
        const imported = new Set([...source.matchAll(/languages\/definitions\/([^/]+)\/register'/g)].map((m) => m[1]))
        const shipped = readdirSync(LANGUAGE_DEFINITIONS).filter((name) => existsSync(join(LANGUAGE_DEFINITIONS, name, 'register.js')))

        expect(shipped).toEqual(expect.arrayContaining(['javascript', 'typescript', 'python', 'shell', 'html', 'css', 'yaml']))
        // Markdown is loaded by setup-monaco.ts, before this list.
        expect([...imported].sort()).toEqual(shipped.filter((name) => name !== 'markdown').sort())
    })
})
