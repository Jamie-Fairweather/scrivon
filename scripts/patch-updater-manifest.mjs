#!/usr/bin/env node
/**
 * Checks latest.json on a GitHub Release and adds the semantic-release notes to it.
 * Run once both Windows builds have uploaded their installers (release workflows).
 * It fails, leaving the release a draft, when an installer is missing from latest.json.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The updater entries each release needs: tauri-action names them after the Rust architecture
 * (`windows-<arch>`, plus `-nsis` for the installer type), and the installer after Windows' name for it.
 */
const WINDOWS_INSTALLERS = [
    { platform: 'windows-x86_64', arch: 'x64' },
    { platform: 'windows-aarch64', arch: 'arm64' },
]

/** The file a minisign signature (base64, as in latest.json) was made for. */
function signedFile(signature) {
    const text = Buffer.from(signature ?? '', 'base64').toString('utf8')
    return text.match(/^trusted comment: .*\bfile:([^\t\r\n]+)/m)?.[1]
}

/**
 * What is wrong with a release's latest.json: an installer missing (each build adds its own, so a
 * build that ran alongside another can overwrite the other's), or an entry for another version or
 * architecture. Empty when every Windows installer of `version` is there.
 */
export function manifestProblems(manifest, version) {
    const expected = version.replace(/^v/, '')
    const problems = []
    if (manifest.version !== expected) {
        problems.push(`version is ${manifest.version}, not ${expected}`)
    }
    for (const { platform, arch } of WINDOWS_INSTALLERS) {
        for (const key of [platform, `${platform}-nsis`]) {
            const entry = manifest.platforms?.[key]
            if (!entry?.url || !entry.signature) {
                problems.push(`${key} is missing`)
                continue
            }
            const file = signedFile(entry.signature)
            if (!file?.endsWith(`_${expected}_${arch}-setup.exe`)) {
                problems.push(`${key} is signed for ${file ?? 'an unknown file'}, not the ${expected} ${arch} installer`)
            }
        }
    }
    return problems
}

function gh(args) {
    return execFileSync('gh', args, { encoding: 'utf8' }).trim()
}

function main() {
    const version = process.env.VERSION?.trim()
    const repository = process.env.GITHUB_REPOSITORY?.trim()

    if (!version || !repository) {
        console.error('patch-updater-manifest: VERSION and GITHUB_REPOSITORY are required')
        process.exit(1)
    }

    const tag = version.startsWith('v') ? version : `v${version}`

    // The release is still a draft here (release.config.mjs). The releases/tags API can't see drafts; gh release can.
    const notes = gh(['release', 'view', tag, '--repo', repository, '--json', 'body', '--jq', '.body'])

    // --clobber overwrites any copy already in the working folder with the release asset
    gh(['release', 'download', tag, '--repo', repository, '-p', 'latest.json', '--clobber'])

    const manifestPath = 'latest.json'
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

    const problems = manifestProblems(manifest, version)
    if (problems.length > 0) {
        console.error(`patch-updater-manifest: latest.json on ${tag} is not right, so the release stays a draft:`)
        for (const problem of problems) console.error(`  - ${problem}`)
        process.exit(1)
    }

    if (notes) {
        manifest.notes = notes
    }

    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    gh(['release', 'upload', tag, '--repo', repository, manifestPath, '--clobber'])

    console.log(`Patched ${manifestPath} on ${tag}${notes ? ' with release notes' : ' (release has no body)'}`)
}

// Run only when called as a script, so tests can import the check above.
const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
const selfPath = fileURLToPath(import.meta.url)
const isMain = process.platform === 'win32' ? entryPath.toLowerCase() === selfPath.toLowerCase() : entryPath === selfPath
if (isMain) {
    main()
}
