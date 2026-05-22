import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runProductionBuild } from './next-build.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const appPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const outPath = join(root, 'lib', 'legal', 'third-party-licenses.ts')
const shippedDir = join(root, 'out')
const nextDir = join(root, '.next')

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md']

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

function readLicenseText(dir) {
    for (const file of LICENSE_FILES) {
        const path = join(dir, file)
        if (existsSync(path)) {
            return readFileSync(path, 'utf8').trim()
        }
    }
    return null
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

function packageEntry(name) {
    const dir = resolvePkgDir(name)
    const pkgJsonPath = join(dir, 'package.json')
    // Skip path segments mistaken for packages (e.g. lucide's internal `shared/` helpers).
    if (!existsSync(pkgJsonPath)) return null

    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    return {
        name,
        version: pkgJson.version ?? '',
        license: normalizeLicense(pkgJson.license),
        repository: normalizeRepository(pkgJson.repository),
        licenseText: readLicenseText(dir),
    }
}

ensureShippedBuild()

const shippedNames = [...collectShippedPackageNames()].sort((a, b) => a.localeCompare(b))
const packages = shippedNames.map(packageEntry).filter(Boolean)

const output = `// Generated by scripts/generate-licenses.mjs — do not edit manually.
// Includes npm packages traced from the production static export (out/) only.

export type ThirdPartyPackage = {
    name: string
    version: string
    license: string
    repository: string | null
    licenseText: string | null
}

export const APP_NAME = 'Scrivon' // keep in sync with lib/app-branding.ts
export const APP_VERSION = ${JSON.stringify(appPkg.version)}

export const THIRD_PARTY_PACKAGES: ThirdPartyPackage[] = ${JSON.stringify(packages, null, 4)}
`

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, output)
console.log(`Wrote ${packages.length} shipped packages to ${outPath}`)
