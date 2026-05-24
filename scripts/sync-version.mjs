import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (!version) {
    throw new Error('package.json is missing a version field')
}

function updateCargoTomlVersion(contents, nextVersion) {
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

const cargoPath = join(root, 'src-tauri', 'Cargo.toml')
const cargo = readFileSync(cargoPath, 'utf8')
writeFileSync(cargoPath, updateCargoTomlVersion(cargo, version))

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

console.log(`Synced version ${version} to Tauri and legal files`)
