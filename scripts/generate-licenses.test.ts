import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THIRD_PARTY_PACKAGES } from '@/lib/legal/third-party-licenses'
import {
    findLicenseFiles,
    readLicenseTexts,
    removeSourceMaps,
    renderLicensesModule,
    rustCratesFromMetadata,
    spdxIds,
    updateLicensesModule,
    withUniqueNames,
} from './generate-licenses.mjs'

let dir: string

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scrivon-licenses-'))
})

afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
})

function packageDir(name: string, files: Record<string, string>) {
    const path = join(dir, name)
    mkdirSync(path, { recursive: true })
    for (const [file, text] of Object.entries(files)) writeFileSync(join(path, file), text)
    return path
}

describe('licence files', () => {
    it('finds split and alternate licence file names, LICENSE files first', () => {
        const path = packageDir('pkg', {
            NOTICE: 'notice',
            LICENSE_MIT: 'mit',
            'LICENSE_APACHE-2.0': 'apache',
            'LICENCE.txt': 'licence',
            'README.md': 'readme',
            'license-checker.config.js': 'not a licence',
        })
        mkdirSync(join(path, 'LICENSES'))

        expect(findLicenseFiles(path)).toEqual(['LICENCE.txt', 'LICENSE_APACHE-2.0', 'LICENSE_MIT', 'NOTICE'])
    })

    it('orders licence files by plain character order, whatever the machine locale', () => {
        // en-GB collation puts _ before -, the C locale on Linux runners puts - first.
        // LICENSE.spdx only describes the licences, so it goes after the real texts.
        const path = packageDir('pkg', { LICENSE_APACHE: 'apache', 'LICENSE-MIT': 'mit', 'LICENSE.md': 'md', 'LICENSE.spdx': 'spdx', NOTICE: 'n' })

        expect(findLicenseFiles(path)).toEqual(['LICENSE-MIT', 'LICENSE.md', 'LICENSE_APACHE', 'NOTICE', 'LICENSE.spdx'])
    })

    it('keeps every licence a package ships, once each', () => {
        const path = packageDir('tauri', { LICENSE_MIT: 'MIT text\r\n', 'LICENSE_APACHE-2.0': 'Apache text', 'LICENSE.md': 'MIT text' })

        // LICENSE.md sorts first, and LICENSE_MIT repeats its text.
        expect(readLicenseTexts([path], { name: 'tauri', license: 'Apache-2.0 OR MIT' })).toEqual(['MIT text', 'Apache text'])
    })

    it('falls back to the standard texts when a package only ships SPDX metadata', () => {
        const path = packageDir('plugin', { 'LICENSE.spdx': 'PackageCopyrightText: The Tauri Programme' })

        const texts = readLicenseTexts([path], { name: 'plugin', license: 'MIT OR Apache-2.0', authors: ['Jane Doe <jane@example.com>'] })

        expect(texts[0]).toBe('PackageCopyrightText: The Tauri Programme')
        expect(texts[1]).toBe("plugin doesn't include its own licence file, so the standard MIT / Apache-2.0 text is shown below.\nAuthors: Jane Doe")
        expect(texts[2]).toMatch(/^MIT License/)
        expect(texts[3]).toMatch(/^Apache License/)
    })

    it('splits SPDX expressions, including the old slash form', () => {
        expect(spdxIds('(MIT OR Apache-2.0) AND Unicode-3.0')).toEqual(['MIT', 'Apache-2.0', 'Unicode-3.0'])
        expect(spdxIds('MIT/Apache-2.0')).toEqual(['MIT', 'Apache-2.0'])
        expect(spdxIds(undefined)).toEqual([])
    })
})

describe('rustCratesFromMetadata', () => {
    function crate(name: string, version: string) {
        const path = packageDir(`${name}-${version}`, { 'LICENSE-MIT': `Copyright ${name}` })
        return {
            id: `${name}@${version}`,
            name,
            version,
            license: 'MIT',
            repository: null,
            homepage: null,
            authors: [],
            manifest_path: join(path, 'Cargo.toml'),
        }
    }
    const normal = [{ kind: null, target: null }]

    it('lists crates reached through normal dependencies only, merging versions', () => {
        const metadata = {
            packages: [
                crate('app', '1.0.0'),
                crate('tauri', '2.0.0'),
                crate('windows-sys', '0.59.0'),
                crate('windows-sys', '0.61.2'),
                crate('cc', '1.0.0'),
                crate('insta', '1.0.0'),
                crate('cc-helper', '1.0.0'),
            ],
            resolve: {
                root: 'app@1.0.0',
                nodes: [
                    {
                        id: 'app@1.0.0',
                        deps: [
                            { pkg: 'tauri@2.0.0', dep_kinds: normal },
                            { pkg: 'windows-sys@0.61.2', dep_kinds: normal },
                            { pkg: 'cc@1.0.0', dep_kinds: [{ kind: 'build', target: null }] },
                            { pkg: 'insta@1.0.0', dep_kinds: [{ kind: 'dev', target: null }] },
                        ],
                    },
                    { id: 'tauri@2.0.0', deps: [{ pkg: 'windows-sys@0.59.0', dep_kinds: normal }] },
                    { id: 'cc@1.0.0', deps: [{ pkg: 'cc-helper@1.0.0', dep_kinds: normal }] },
                ],
            },
        }

        const crates = rustCratesFromMetadata(metadata)

        expect(crates.map((c: { name: string; version: string }) => `${c.name} ${c.version}`)).toEqual(['tauri 2.0.0', 'windows-sys 0.59.0, 0.61.2'])
        expect(crates[0]).toMatchObject({
            ecosystem: 'rust',
            license: 'MIT',
            repository: 'https://crates.io/crates/tauri',
            licenseTexts: ['Copyright tauri'],
        })
        expect(crates[1].licenseTexts).toEqual(['Copyright windows-sys'])
    })

    it('sorts names by plain character order and versions numerically, whatever the machine locale', () => {
        const names = ['serde_core', 'serde-untagged', 'cargo_metadata', 'cargo-platform', 'Inflector']
        const packages = [crate('app', '1.0.0'), ...names.map((name) => crate(name, '1.0.0')), crate('syn', '0.10.0'), crate('syn', '0.9.1')]
        const metadata = {
            packages,
            resolve: {
                root: 'app@1.0.0',
                nodes: [{ id: 'app@1.0.0', deps: packages.slice(1).map((pkg) => ({ pkg: pkg.id, dep_kinds: normal })) }],
            },
        }

        const crates = rustCratesFromMetadata(metadata)

        expect(crates.map((c: { name: string; version: string }) => `${c.name} ${c.version}`)).toEqual([
            'Inflector 1.0.0',
            'cargo-platform 1.0.0',
            'cargo_metadata 1.0.0',
            'serde-untagged 1.0.0',
            'serde_core 1.0.0',
            'syn 0.9.1, 0.10.0',
        ])
    })
})

describe('generated module', () => {
    it('stores a shared licence text once', () => {
        const entry = (name: string, licenseTexts: string[]) => ({
            name,
            version: '1.0.0',
            license: 'MIT',
            repository: null,
            ecosystem: 'npm',
            licenseTexts,
        })

        const source = renderLicensesModule([entry('a', ['Shared MIT text']), entry('b', ['Shared MIT text', 'NOTICE b']), entry('c', [])], '9.9.9')

        expect(source.split('Shared MIT text')).toHaveLength(2)
        expect(source).toContain('"licenseText": T[0]\n')
        expect(source).toContain('"licenseText": T[0] + SEP + T[1]\n')
        expect(source).toContain('"licenseText": null\n')
        expect(source).toContain('export const APP_VERSION = "9.9.9"\n')
    })

    it('renames a crate or font that shares a name with an npm package', () => {
        const entries = withUniqueNames([
            { name: 'url', ecosystem: 'npm' },
            { name: 'url', ecosystem: 'rust' },
            { name: 'tauri', ecosystem: 'rust' },
        ])

        expect(entries.map((e: { name: string }) => e.name)).toEqual(['url', 'url (Rust crate)', 'tauri'])
    })
})

describe('removeSourceMaps', () => {
    it('deletes the maps from the export and the comments that point at them', () => {
        const chunks = join(dir, '_next', 'static', 'chunks')
        mkdirSync(chunks, { recursive: true })
        writeFileSync(join(chunks, 'app.js'), 'console.log(1)\n//# sourceMappingURL=app.js.map')
        writeFileSync(join(chunks, 'app.js.map'), '{"sources":[]}')
        writeFileSync(join(chunks, 'plain.js'), 'const url = "//# sourceMappingURL=x.js.map"; run(url)\n')
        writeFileSync(join(chunks, 'style.css'), 'a{color:red}\n/*# sourceMappingURL=style.css.map */\n')
        writeFileSync(join(chunks, 'style.css.map'), '{}')
        writeFileSync(join(chunks, 'min.css'), 'b{color:blue}\n/*# sourceMappingURL=min.css.map*/')
        writeFileSync(join(chunks, 'min.css.map'), '{}')
        writeFileSync(join(dir, 'index.html'), '<html></html>')

        expect(removeSourceMaps(dir)).toBe(3)

        expect(readdirSync(chunks).sort()).toEqual(['app.js', 'min.css', 'plain.js', 'style.css'])
        expect(readFileSync(join(chunks, 'app.js'), 'utf8')).toBe('console.log(1)')
        expect(readFileSync(join(chunks, 'plain.js'), 'utf8')).toBe('const url = "//# sourceMappingURL=x.js.map"; run(url)\n')
        expect(readFileSync(join(chunks, 'style.css'), 'utf8')).toBe('a{color:red}')
        expect(readFileSync(join(chunks, 'min.css'), 'utf8')).toBe('b{color:blue}')
        expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe('<html></html>')
    })
})

describe('updateLicensesModule', () => {
    const NEW_LIST = 'export const LIST = ["new"]\n'

    it('writes a changed list, then builds again so the app ships it', () => {
        const path = join(dir, 'third-party-licenses.ts')
        writeFileSync(path, 'export const LIST = ["old"]\n')
        const rebuild = vi.fn(() => {
            // The second build must already see the new list.
            expect(readFileSync(path, 'utf8')).toBe(NEW_LIST)
        })

        expect(updateLicensesModule(path, NEW_LIST, rebuild)).toBe(true)
        expect(rebuild).toHaveBeenCalledTimes(1)
    })

    it('writes a missing list and builds again', () => {
        const path = join(dir, 'legal', 'third-party-licenses.ts')
        const rebuild = vi.fn()

        expect(updateLicensesModule(path, NEW_LIST, rebuild)).toBe(true)
        expect(readFileSync(path, 'utf8')).toBe(NEW_LIST)
        expect(rebuild).toHaveBeenCalledTimes(1)
    })

    it('leaves an unchanged list alone, even with Windows line endings, and skips the second build', () => {
        const path = join(dir, 'third-party-licenses.ts')
        const crlf = 'export const A = 1\r\nexport const B = 2\r\n'
        writeFileSync(path, crlf)
        const rebuild = vi.fn()

        expect(updateLicensesModule(path, 'export const A = 1\nexport const B = 2\n', rebuild)).toBe(false)
        expect(readFileSync(path, 'utf8')).toBe(crlf)
        expect(rebuild).not.toHaveBeenCalled()
    })
})

describe('shipped licence list', () => {
    const byName = (name: string) => THIRD_PARTY_PACKAGES.find((pkg) => pkg.name === name)

    it('covers the Rust crates in the desktop binary', () => {
        for (const name of ['tauri', 'wry', 'webview2-com', 'lopdf', 'font-kit']) {
            expect(byName(name), name).toMatchObject({ ecosystem: 'rust' })
            expect(byName(name)?.licenseText, name).toBeTruthy()
        }
    })

    it('covers the bundled fonts', () => {
        for (const name of ['Inter', 'Geist Mono']) {
            expect(byName(name), name).toMatchObject({ ecosystem: 'font', license: 'OFL-1.1' })
            expect(byName(name)?.licenseText, name).toContain('SIL OPEN FONT LICENSE')
        }
    })

    it('has licence text for the Tauri JS packages and a unique name for every row', () => {
        expect(byName('@tauri-apps/api')?.licenseText).toContain('MIT License')
        expect(byName('@tauri-apps/plugin-fs')?.licenseText).toContain('Apache License')
        expect(new Set(THIRD_PARTY_PACKAGES.map((pkg) => pkg.name)).size).toBe(THIRD_PARTY_PACKAGES.length)
    })
})
