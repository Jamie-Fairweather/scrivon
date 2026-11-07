#!/usr/bin/env node
/**
 * Tells the release workflow that semantic-release published a version, so the Windows build job runs.
 * Called by @semantic-release/exec's successCmd (release.config.mjs), which only runs after a release.
 * Usage: node scripts/write-release-outputs.mjs <version>
 */
import { appendFileSync } from 'node:fs'

const version = process.argv[2]?.trim()
if (!version) {
    console.error('write-release-outputs: usage: node scripts/write-release-outputs.mjs <version>')
    process.exit(1)
}

const outputFile = process.env.GITHUB_OUTPUT
if (!outputFile) {
    // Local run (e.g. a dry run): there is no workflow step to report to.
    console.log(`write-release-outputs: released ${version}; GITHUB_OUTPUT is not set, nothing to write`)
    process.exit(0)
}

appendFileSync(outputFile, `new_release_published=true\nnew_release_version=${version}\n`)
console.log(`write-release-outputs: new_release_version=${version}`)
