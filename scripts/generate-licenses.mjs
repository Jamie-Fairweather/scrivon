import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runProductionBuild } from './next-build.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outPath = join(root, 'lib', 'legal', 'third-party-licenses.ts')
const shippedDir = join(root, 'out')
const nextDir = join(root, '.next')
const cargoManifest = join(root, 'src-tauri', 'Cargo.toml')
const spdxTextDir = join(__dirname, 'data', 'licenses', 'spdx')
const fontLicenseDir = join(__dirname, 'data', 'licenses', 'fonts')

// Installers are only built for Windows, so list the crates linked into the Windows binary.
const RUST_TARGET = 'x86_64-pc-windows-msvc'

// Fonts that next/font/google bundles into the static export (app/layout.tsx).
const BUNDLED_FONTS = [
    { name: 'Geist Mono', license: 'OFL-1.1', repository: 'https://github.com/vercel/geist-font', licenseFile: 'GeistMono-OFL.txt' },
    { name: 'Inter', license: 'OFL-1.1', repository: 'https://github.com/rsms/inter', licenseFile: 'Inter-OFL.txt' },
]

// LICENSE, LICENSE.md, LICENSE-MIT, LICENSE_APACHE-2.0, LICENCE, COPYING, NOTICE, UNLICENSE, LICENSE.spdx, ...
const LICENSE_FILE_RE = /^(?:licen[cs]e|copying|copyright|notice|unlicense)(?:$|[-_.])/i
// ...but not code or config that happens to start with the same word (license-checker.config.js).
const NOT_LICENSE_TEXT_RE = /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|lock|sh|ps1|py|rs|html?|css)$/i
// A LICENSE.spdx file only describes the licence; it doesn't contain the licence text.
const METADATA_ONLY_RE = /\.spdx$/i
const TEXT_SEPARATOR = '\n\n----------------------------------------\n\n'

const NODE_MODULES_PKG_RE = /node_modules[/\\](?:\.pnpm[/\\][^/\\]+[/\\]node_modules[/\\])?((?:@[^/\\]+[/\\][^/\\]+)|[^/\\]+)/

function ensureShippedBuild() {
    const hasMaps = existsSync(shippedDir) && walkFiles(shippedDir).some((file) => file.endsWith('.js.map'))
    if (hasMaps) return

    console.log('No shipped source maps found; running production build…')
    runProductionBuild()
}

function walkFiles(dir, files = []) {
    if (!existsSync(dir)) return files
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walkFiles(path, files)
        else files.push(path)
    }
    return files
}

function parsePackageFromSource(source) {
    const match = source.match(NODE_MODULES_PKG_RE)
    if (!match) return null
    return match[1].replace(/\\/g, '/')
}

function addCompiledRuntimePackages(source, names) {
    if (/[/\\]next[/\\]dist[/\\]compiled[/\\]react-dom[/\\]/.test(source)) {
        names.add('react-dom')
    }
    if (/[/\\]next[/\\]dist[/\\]compiled[/\\]scheduler[/\\]/.test(source)) {
        names.add('scheduler')
    }
    if (/[/\\]next[/\\]dist[/\\]compiled[/\\]react[/\\]/.test(source) && !/react-dom|react-server-dom|react-refresh/.test(source)) {
        names.add('react')
    }
}

function collectFromSource(source, names) {
    const pkg = parsePackageFromSource(source)
    if (pkg && !pkg.startsWith('.')) names.add(pkg)
    addCompiledRuntimePackages(source, names)
}

function collectShippedPackageNames() {
    const names = new Set()

    for (const file of walkFiles(shippedDir)) {
        if (!file.endsWith('.js.map')) continue
        try {
            const map = JSON.parse(readFileSync(file, 'utf8'))
            for (const source of map.sources ?? []) {
                collectFromSource(source, names)
            }
        } catch {
            // skip malformed maps
        }
    }

    const manifestPaths = walkFiles(join(nextDir, 'server', 'app')).filter((file) => file.endsWith('_client-reference-manifest.js'))
    for (const manifestPath of manifestPaths) {
        const content = readFileSync(manifestPath, 'utf8')
        const matches = content.matchAll(/\[project\][^"]*node_modules[/\\][^"]+/g)
        for (const match of matches) {
            collectFromSource(match[0].replace(/^\[project\]/, ''), names)
        }
    }

    if (names.has('react-dom')) {
        names.add('react')
    }

    return names
}

function resolvePkgDir(name) {
    const direct = name.startsWith('@') ? join(root, 'node_modules', name.split('/')[0], name.split('/')[1]) : join(root, 'node_modules', name)
    if (existsSync(join(direct, 'package.json'))) return direct

    const pnpmDir = join(root, 'node_modules', '.pnpm')
    if (!existsSync(pnpmDir)) return direct

    const prefix = name.startsWith('@') ? `${name.replace('/', '+')}@` : `${name}@`
    const entry = readdirSync(pnpmDir).find((dir) => dir.startsWith(prefix))
    if (!entry) return direct

    const nested = join(pnpmDir, entry, 'node_modules', name)
    return existsSync(join(nested, 'package.json')) ? nested : direct
}

/** Same text regardless of CRLF checkouts or trailing spaces, so identical licences are stored once. */
export function normalizeText(text) {
    return text
        .replace(/^﻿/, '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .trim()
}

/** Licence-like files in a package directory: LICENSE* first, then COPYING, NOTICE and the rest. */
export function findLicenseFiles(dir) {
    if (!existsSync(dir)) return []
    const rank = (file) => (/^licen[cs]e/i.test(file) ? 0 : 1)
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && LICENSE_FILE_RE.test(entry.name) && !NOT_LICENSE_TEXT_RE.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** Licence ids in an SPDX expression, including the old `MIT/Apache-2.0` form. */
export function spdxIds(expression) {
    if (!expression) return []
    const ids = expression
        .split(/\s+(?:OR|AND|WITH)\s+|\/|[()]/i)
        .map((id) => id.trim())
        .filter(Boolean)
    return [...new Set(ids)]
}

function standardLicenseText(id) {
    const path = join(spdxTextDir, `${id}.txt`)
    return existsSync(path) ? normalizeText(readFileSync(path, 'utf8')) : null
}

function formatAuthors(authors) {
    return authors
        .map((author) => (typeof author === 'string' ? author : author?.name))
        .filter(Boolean)
        .map((author) =>
            author
                .replace(/\s*<[^>]*>/g, '')
                .replace(/\s*\([^)]*\)/g, '')
                .trim()
        )
        .filter(Boolean)
}

/**
 * The licence texts to show for a package: every licence file it ships (deduplicated). When it ships no
 * actual licence text, fall back to the standard text of each licence it declares.
 * @param {string[]} dirs
 * @param {{ name: string, license?: string | null, authors?: Array<string | { name?: string }> }} pkg
 * @returns {string[]}
 */
export function readLicenseTexts(dirs, { name, license, authors = [] }) {
    const texts = []
    let hasLicenseText = false
    for (const dir of dirs) {
        for (const file of findLicenseFiles(dir)) {
            const text = normalizeText(readFileSync(join(dir, file), 'utf8'))
            if (!text || texts.includes(text)) continue
            texts.push(text)
            if (!METADATA_ONLY_RE.test(file)) hasLicenseText = true
        }
    }
    if (hasLicenseText) return texts

    const ids = spdxIds(license)
    const standard = ids.map(standardLicenseText).filter(Boolean)
    if (standard.length === 0) return texts

    const names = formatAuthors(authors)
    const note = `${name} doesn't include its own licence file, so the standard ${ids.join(' / ')} text is shown below.${names.length ? `\nAuthors: ${names.join(', ')}` : ''}`
    return [...texts, note, ...standard]
}

function normalizeLicense(license) {
    if (!license) return 'Unknown'
    if (typeof license === 'string') return license
    if (typeof license === 'object' && license.type) return license.type
    return 'Unknown'
}

function normalizeRepository(repository) {
    if (!repository) return null

    let url = typeof repository === 'string' ? repository : repository.url
    if (!url || typeof url !== 'string') return null

    url = url.trim()

    if (url.startsWith('github:')) {
        return `https://github.com/${url.slice(7).replace(/\.git$/, '')}`
    }

    url = url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://')

    // npm shorthand: "owner/repo" implies GitHub
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
        return `https://github.com/${url}`
    }

    if (/^https?:\/\//i.test(url)) {
        return url.replace(/\.git$/, '')
    }

    return url
}

function npmPackageEntry(name) {
    const dir = resolvePkgDir(name)
    const pkgJsonPath = join(dir, 'package.json')
    // Skip path segments mistaken for packages (e.g. lucide's internal `shared/` helpers).
    if (!existsSync(pkgJsonPath)) return null

    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    const license = normalizeLicense(pkgJson.license)
    return {
        name,
        version: pkgJson.version ?? '',
        license,
        repository: normalizeRepository(pkgJson.repository),
        ecosystem: 'npm',
        licenseTexts: readLicenseTexts([dir], { name, license, authors: pkgJson.author ? [pkgJson.author] : [] }),
    }
}

/**
 * Crates compiled into the app from `cargo metadata` output: everything reachable from the root package
 * through normal dependencies (build and dev dependencies are not shipped). Versions of the same crate are
 * merged into one entry.
 */
export function rustCratesFromMetadata(metadata) {
    const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]))
    const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]))
    const rootId = metadata.resolve.root
    const seen = new Set([rootId])
    const stack = [rootId]
    while (stack.length > 0) {
        const node = nodes.get(stack.pop())
        for (const dep of node?.deps ?? []) {
            if (seen.has(dep.pkg) || !dep.dep_kinds.some((kind) => kind.kind === null)) continue
            seen.add(dep.pkg)
            stack.push(dep.pkg)
        }
    }
    seen.delete(rootId)

    const byName = new Map()
    for (const id of seen) {
        const pkg = packages.get(id)
        if (!pkg) continue
        const crate = byName.get(pkg.name) ?? { name: pkg.name, versions: [], licenses: [], dirs: [], authors: [], repository: null }
        crate.versions.push(pkg.version)
        if (pkg.license && !crate.licenses.includes(pkg.license)) crate.licenses.push(pkg.license)
        crate.dirs.push(dirname(pkg.manifest_path))
        crate.authors.push(...(pkg.authors ?? []).filter((author) => !crate.authors.includes(author)))
        crate.repository ??= pkg.repository ?? pkg.homepage ?? null
        byName.set(pkg.name, crate)
    }

    return [...byName.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((crate) => {
            const license = crate.licenses.join('; ') || 'Unknown'
            return {
                name: crate.name,
                version: crate.versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', '),
                license,
                repository: normalizeRepository(crate.repository) ?? `https://crates.io/crates/${crate.name}`,
                ecosystem: 'rust',
                licenseTexts: readLicenseTexts(crate.dirs, { name: crate.name, license, authors: crate.authors }),
            }
        })
}

function readCargoMetadata() {
    try {
        const json = execFileSync(
            'cargo',
            ['metadata', '--format-version', '1', '--filter-platform', RUST_TARGET, '--manifest-path', cargoManifest],
            { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }
        )
        return JSON.parse(json)
    } catch (err) {
        throw new Error(`Couldn't list the Rust crates with \`cargo metadata\`. Install Rust (https://rustup.rs) and try again.\n${err.message}`)
    }
}

function fontEntries() {
    return BUNDLED_FONTS.map((font) => ({
        name: font.name,
        version: '',
        license: font.license,
        repository: font.repository,
        ecosystem: 'font',
        licenseTexts: [normalizeText(readFileSync(join(fontLicenseDir, font.licenseFile), 'utf8'))],
    }))
}

/** The dialog keys rows by name, so a crate or font that shares an npm package's name gets a suffix. */
export function withUniqueNames(entries) {
    const suffix = { npm: 'npm package', rust: 'Rust crate', font: 'font' }
    const used = new Set()
    return entries.map((entry) => {
        const name = used.has(entry.name) ? `${entry.name} (${suffix[entry.ecosystem]})` : entry.name
        used.add(name)
        return name === entry.name ? entry : { ...entry, name }
    })
}

/** Source of lib/legal/third-party-licenses.ts. Each distinct licence text is written once and shared. */
export function renderLicensesModule(entries, appVersion) {
    const texts = []
    const textIndex = new Map()
    const ref = (text) => {
        if (!textIndex.has(text)) {
            textIndex.set(text, texts.length)
            texts.push(text)
        }
        return `T[${textIndex.get(text)}]`
    }

    const rows = entries.map((entry) => {
        const licenseText = entry.licenseTexts.length > 0 ? entry.licenseTexts.map(ref).join(' + SEP + ') : 'null'
        return [
            '    {',
            `        "name": ${JSON.stringify(entry.name)},`,
            `        "version": ${JSON.stringify(entry.version)},`,
            `        "license": ${JSON.stringify(entry.license)},`,
            `        "repository": ${JSON.stringify(entry.repository)},`,
            `        "ecosystem": ${JSON.stringify(entry.ecosystem)},`,
            `        "licenseText": ${licenseText}`,
            '    }',
        ].join('\n')
    })

    return `// Generated by scripts/generate-licenses.mjs — do not edit manually.
// npm packages traced from the production static export (out/), the Rust crates linked into the
// Windows desktop binary (cargo metadata) and the fonts bundled by next/font.

export type ThirdPartyPackage = {
    name: string
    version: string
    license: string
    repository: string | null
    ecosystem: 'npm' | 'rust' | 'font'
    licenseText: string | null
}

export const APP_NAME = 'Scrivon' // keep in sync with lib/app-branding.ts
export const APP_VERSION = ${JSON.stringify(appVersion)}

// Each distinct licence text is stored once; packages that share it point at the same entry.
const T: string[] = ${JSON.stringify(texts, null, 4)}

const SEP = ${JSON.stringify(TEXT_SEPARATOR)}

export const THIRD_PARTY_PACKAGES: ThirdPartyPackage[] = [
${rows.join(',\n')}
]
`
}

function main() {
    const appPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

    ensureShippedBuild()

    const shippedNames = [...collectShippedPackageNames()].sort((a, b) => a.localeCompare(b))
    const npmPackages = shippedNames.map(npmPackageEntry).filter(Boolean)
    const rustCrates = rustCratesFromMetadata(readCargoMetadata())
    const entries = withUniqueNames([...npmPackages, ...fontEntries(), ...rustCrates])

    const missing = entries.filter((entry) => entry.licenseTexts.length === 0).map((entry) => entry.name)
    if (missing.length > 0) {
        console.warn(`No licence text found for: ${missing.join(', ')}`)
    }

    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, renderLicensesModule(entries, appPkg.version))
    console.log(`Wrote ${npmPackages.length} npm packages, ${rustCrates.length} Rust crates and ${BUNDLED_FONTS.length} fonts to ${outPath}`)
}

// Run only when called as a script, so tests can import the helpers above.
const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = fileURLToPath(import.meta.url)
const isMain = process.platform === 'win32' ? entryPath.toLowerCase() === selfPath.toLowerCase() : entryPath === selfPath
if (isMain) {
    main()
}
