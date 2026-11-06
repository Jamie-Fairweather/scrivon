import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { THIRD_PARTY_PACKAGES } from '@/lib/legal/third-party-licenses'
import { findLicenseFiles, readLicenseTexts, renderLicensesModule, rustCratesFromMetadata, spdxIds, withUniqueNames } from './generate-licenses.mjs'

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

    it('keeps every licence a package ships, once each', () => {
        const path = packageDir('tauri', { LICENSE_MIT: 'MIT text\r\n', 'LICENSE_APACHE-2.0': 'Apache text', 'LICENSE.md': 'MIT text' })

        expect(readLicenseTexts([path], { name: 'tauri', license: 'Apache-2.0 OR MIT' })).toEqual(['Apache text', 'MIT text'])
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
