/**
 * Fails when an @tauri-apps package and its Rust crate are on different major/minor versions
 * (@tauri-apps/api and tauri, @tauri-apps/plugin-x and tauri-plugin-x). The Tauri CLI refuses to
 * build then, and CI never runs the Tauri CLI, so this catches it before a release is tagged.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** name -> versions of every [[package]] in a Cargo.lock. */
export function cargoLockVersions(contents) {
    const versions = new Map()
    for (const block of contents.split(/\r?\n\[\[package\]\]\r?\n/).slice(1)) {
        const name = block.match(/^name = "([^"]+)"/m)?.[1]
        const version = block.match(/^version = "([^"]+)"/m)?.[1]
        if (name && version) versions.set(name, [...(versions.get(name) ?? []), version])
    }
    return versions
}

/** The Rust crate an @tauri-apps package must match, or null when it has none (the CLI, for example). */
export function crateFor(npmName) {
    if (npmName === '@tauri-apps/api') return 'tauri'
    const plugin = npmName.match(/^@tauri-apps\/plugin-(.+)$/)?.[1]
    return plugin ? `tauri-plugin-${plugin}` : null
}

const majorMinor = (version) => version.split('.').slice(0, 2).join('.')

/**
 * @param {Map<string, string>} npmVersions installed @tauri-apps package versions
 * @param {Map<string, string[]>} crateVersions from cargoLockVersions
 * @returns {string[]} one line per mismatch
 */
export function tauriVersionMismatches(npmVersions, crateVersions) {
    const problems = []
    for (const [npmName, npmVersion] of npmVersions) {
        const crate = crateFor(npmName)
        if (!crate) continue
        const crates = crateVersions.get(crate)
        if (!crates) {
            problems.push(`${npmName} ${npmVersion} has no ${crate} crate in src-tauri/Cargo.lock`)
            continue
        }
        for (const crateVersion of crates) {
            if (majorMinor(crateVersion) !== majorMinor(npmVersion)) {
                problems.push(`${npmName} ${npmVersion} doesn't match ${crate} ${crateVersion}`)
            }
        }
    }
    return problems
}

function installedTauriPackages() {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => crateFor(name))
    return new Map(
        names.map((name) => {
            const path = join(root, 'node_modules', ...name.split('/'), 'package.json')
            if (!existsSync(path)) throw new Error(`${name} is not installed. Run bun install first.`)
            return [name, JSON.parse(readFileSync(path, 'utf8')).version]
        })
    )
}

function main() {
    const crates = cargoLockVersions(readFileSync(join(root, 'src-tauri', 'Cargo.lock'), 'utf8'))
    const problems = tauriVersionMismatches(installedTauriPackages(), crates)
    if (problems.length > 0) {
        console.error('The Tauri npm packages and Rust crates must be on the same major/minor versions:')
        for (const problem of problems) console.error(`  ${problem}`)
        console.error('Update them together (see "Updating Tauri" in docs/development.md).')
        process.exit(1)
    }
    console.log('Tauri npm packages and Rust crates are on matching versions.')
}

// Run only when called as a script, so tests can import the helpers above.
const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = fileURLToPath(import.meta.url)
const isMain = process.platform === 'win32' ? entryPath.toLowerCase() === selfPath.toLowerCase() : entryPath === selfPath
if (isMain) {
    main()
}
