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

describe('semantic-release plugins', () => {
    it('lists every plugin as a name or a [name, options] pair', () => {
        for (const plugin of plugins) {
            const valid =
                typeof plugin === 'string' ||
                (Array.isArray(plugin) && plugin.length === 2 && typeof plugin[0] === 'string' && typeof plugin[1] === 'object' && plugin[1] !== null)
            expect(valid, JSON.stringify(plugin)).toBe(true)
        }
    })

    it('treats a `feat!:` commit as a major release', async () => {
        type AnalyzerPlugin = {
            analyzeCommits: (config: PluginOptions, context: Record<string, unknown>) => Promise<string | null>
        }
        const { analyzeCommits } = await importPlugin<AnalyzerPlugin>('@semantic-release/commit-analyzer')
        const analyze = (...messages: string[]) =>
            analyzeCommits(pluginOptions('@semantic-release/commit-analyzer'), {
                cwd: repoRoot,
                logger: silentLogger,
                commits: messages.map((message, i) => ({ hash: `${i}`, message })),
            })

        expect(await analyze('feat!: remove legacy file format support')).toBe('major')
        expect(await analyze('fix: keep unsaved tabs', 'feat!: remove legacy file format support')).toBe('major')
        expect(await analyze('feat: add diagram export')).toBe('minor')
        expect(await analyze('fix: prevent canvas flash on theme change')).toBe('patch')
        expect(await analyze('docs: update readme')).toBeNull()
    })

    it('commits every file sync-version.mjs rewrites, Cargo.lock included', () => {
        expect(pluginOptions('@semantic-release/git').assets).toEqual(
            expect.arrayContaining([
                'package.json',
                'src-tauri/Cargo.toml',
                'src-tauri/Cargo.lock',
                'src-tauri/tauri.conf.json',
                'lib/legal/third-party-licenses.ts',
            ])
        )
    })

    it('creates the GitHub Release as a draft, for the Windows build job to publish', () => {
        expect(pluginOptions('@semantic-release/github')).toMatchObject({ draftRelease: true })
    })

    it('links PR comments to the tag, which keeps working once the draft is published', async () => {
        // The same lodash template function @semantic-release/github renders successComment with.
        const { template } = await importPlugin<{ template: (text: string) => (data: object) => string }>('lodash-es')
        const comment = template(pluginOptions('@semantic-release/github').successComment as string)({
            issue: { pull_request: {} },
            nextRelease: { version: '1.6.0', gitTag: 'v1.6.0' },
            env: { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'Jamie-Fairweather/scrivon' },
        })

        expect(comment).toContain('This PR is included in version 1.6.0')
        expect(comment).toContain('[GitHub release](https://github.com/Jamie-Fairweather/scrivon/releases/tag/v1.6.0)')
    })
})
