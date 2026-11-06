import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function updateCargoTomlVersion(contents, nextVersion) {
    const lines = contents.split(/\r?\n/)
    let inPackage = false
    let updated = false

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line === '[package]') {
            inPackage = true
            continue
        }
        if (line.startsWith('[') && line !== '[package]') {
            inPackage = false
        }
        if (inPackage && line.startsWith('version = ')) {
            lines[i] = `version = "${nextVersion}"`
            updated = true
            break
        }
    }

    if (!updated) {
        throw new Error('Could not update version in src-tauri/Cargo.toml')
    }

    return lines.join('\n')
}

/** The `name` in Cargo.toml's [package] table, which is also the app's entry in Cargo.lock. */
export function cargoPackageName(contents) {
    let inPackage = false
    for (const line of contents.split(/\r?\n/)) {
        if (line.startsWith('[')) inPackage = line === '[package]'
        const match = inPackage && line.match(/^name = "([^"]+)"$/)
        if (match) return match[1]
    }
    throw new Error('Could not find the package name in src-tauri/Cargo.toml')
}

/**
 * Sets the app's own version in Cargo.lock, so the lockfile in the release commit matches Cargo.toml
 * and `cargo build --locked` works from a release tag. Dependencies are left alone, and so are the
 * file's line endings.
 */
export function updateCargoLockVersion(contents, packageName, nextVersion) {
    const eol = contents.includes('\r\n') ? '\r\n' : '\n'
    const lines = contents.split(/\r?\n/)
    for (let i = 0; i + 2 < lines.length; i++) {
        if (lines[i] === '[[package]]' && lines[i + 1] === `name = "${packageName}"` && lines[i + 2].startsWith('version = ')) {
            lines[i + 2] = `version = "${nextVersion}"`
            return lines.join(eol)
        }
    }
    throw new Error(`Could not find the ${packageName} package in src-tauri/Cargo.lock`)
}

/** Copies package.json's version (set by semantic-release) to the Tauri, Cargo and legal files. */
export function syncVersion(root) {
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    if (!version) {
        throw new Error('package.json is missing a version field')
    }

    const cargoPath = join(root, 'src-tauri', 'Cargo.toml')
    const cargo = readFileSync(cargoPath, 'utf8')
    writeFileSync(cargoPath, updateCargoTomlVersion(cargo, version))

    const cargoLockPath = join(root, 'src-tauri', 'Cargo.lock')
    writeFileSync(cargoLockPath, updateCargoLockVersion(readFileSync(cargoLockPath, 'utf8'), cargoPackageName(cargo), version))

    const tauriConfPath = join(root, 'src-tauri', 'tauri.conf.json')
    const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'))
    tauriConf.version = version
    writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 4)}\n`)

    const licensesPath = join(root, 'lib', 'legal', 'third-party-licenses.ts')
    const licenseLines = readFileSync(licensesPath, 'utf8').split(/\r?\n/)
    const appVersionIndex = licenseLines.findIndex((line) => line.startsWith('export const APP_VERSION = '))
    if (appVersionIndex === -1) {
        throw new Error('Could not update APP_VERSION in lib/legal/third-party-licenses.ts')
    }
    licenseLines[appVersionIndex] = `export const APP_VERSION = ${JSON.stringify(version)}`
    writeFileSync(licensesPath, licenseLines.join('\n'))

    return version
}

// Run only when called as a script, so tests can import the helpers above.
const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = fileURLToPath(import.meta.url)
const isMain = process.platform === 'win32' ? entryPath.toLowerCase() === selfPath.toLowerCase() : entryPath === selfPath
if (isMain) {
    const version = syncVersion(join(__dirname, '..'))
    console.log(`Synced version ${version} to Tauri, Cargo and legal files`)
}
