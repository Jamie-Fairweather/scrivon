#!/usr/bin/env node
/**
 * Adds semantic-release notes to latest.json on a GitHub Release.
 * Run after tauri-action uploads updater artifacts (release workflow).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.env.VERSION?.trim()
const repository = process.env.GITHUB_REPOSITORY?.trim()

if (!version || !repository) {
    console.error('patch-updater-manifest: VERSION and GITHUB_REPOSITORY are required')
    process.exit(1)
}

const tag = version.startsWith('v') ? version : `v${version}`

function gh(args) {
    return execFileSync('gh', args, { encoding: 'utf8' }).trim()
}

const notes = gh(['api', `repos/${repository}/releases/tags/${tag}`, '--jq', '.body'])

gh(['release', 'download', tag, '-p', 'latest.json'])

const manifestPath = 'latest.json'
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

if (notes) {
    manifest.notes = notes
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
gh(['release', 'upload', tag, manifestPath, '--clobber'])

console.log(`Patched ${manifestPath} on ${tag}${notes ? ' with release notes' : ' (release has no body)'}`)
