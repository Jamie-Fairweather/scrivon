import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import releaseConfig from '../release.config.mjs'

const repoRoot = resolve(__dirname, '..')
const plugins: unknown[] = releaseConfig.plugins

type PluginOptions = Record<string, unknown>

function pluginOptions(name: string): PluginOptions {
    const entry = plugins.find((plugin) => plugin === name || (Array.isArray(plugin) && plugin[0] === name))
    if (!entry) throw new Error(`${name} is not in release.config.mjs`)
    return Array.isArray(entry) ? (entry[1] as PluginOptions) : {}
}

// The semantic-release plugins ship no type declarations; a non-literal specifier keeps tsc from resolving them.
async function importPlugin<T>(specifier: string): Promise<T> {
    return (await import(/* @vite-ignore */ specifier)) as T
}

const silentLogger = { log() {}, error() {}, warn() {}, success() {} }

describe('release workflow outputs (exec successCmd)', () => {
    let dir: string
    let outputFile: string

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'scrivon-release-'))
        outputFile = join(dir, 'github-output')
        writeFileSync(outputFile, '')
    })

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true })
    })

    it('writes new_release_published and new_release_version after a release', async () => {
        type ExecPlugin = { success: (config: PluginOptions, context: Record<string, unknown>) => Promise<void> }
        const { success } = await importPlugin<ExecPlugin>('@semantic-release/exec')

        await success(pluginOptions('@semantic-release/exec'), {
            cwd: repoRoot,
            env: { ...process.env, GITHUB_OUTPUT: outputFile },
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            logger: silentLogger,
            nextRelease: { version: '1.6.0-rc.1' },
        })

        expect(readFileSync(outputFile, 'utf8').split(/\r?\n/)).toEqual(['new_release_published=true', 'new_release_version=1.6.0-rc.1', ''])
    })

    it('succeeds without writing anything when GITHUB_OUTPUT is not set', () => {
        const env = { ...process.env }
        delete env.GITHUB_OUTPUT
        const result = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'write-release-outputs.mjs'), '1.6.0'], { env, encoding: 'utf8' })

        expect(result.status).toBe(0)
        expect(readFileSync(outputFile, 'utf8')).toBe('')
    })

    it('fails when no version is passed', () => {
        const result = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'write-release-outputs.mjs')], {
            env: { ...process.env, GITHUB_OUTPUT: outputFile },
            encoding: 'utf8',
        })

        expect(result.status).toBe(1)
        expect(readFileSync(outputFile, 'utf8')).toBe('')
    })
})
