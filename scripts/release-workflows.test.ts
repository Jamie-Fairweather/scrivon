import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const repoRoot = resolve(__dirname, '..')

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> }
type Job = {
    needs?: string | string[]
    if?: string
    strategy?: { 'max-parallel'?: number; matrix?: { include?: Record<string, string>[] } }
    steps: Step[]
}
type Workflow = { jobs: Record<string, Job> }

function workflow(file: string): Workflow {
    return parse(readFileSync(join(repoRoot, '.github', 'workflows', file), 'utf8')) as Workflow
}

const ciBuild = () => workflow('ci.yml').jobs['bundle-windows']
const releaseWorkflows = ['release.yml', 'build-release.yml']

/** Every job that builds the Windows installers: CI's check and the two release builds. */
function installerBuilds(): [string, Job][] {
    return [['ci.yml', ciBuild()], ...releaseWorkflows.map((file): [string, Job] => [file, workflow(file).jobs['build-windows']])]
}

const step = (job: Job, match: (step: Step) => boolean) => job.steps.find(match)
const buildStep = (job: Job) => step(job, (s) => s.uses?.startsWith('tauri-apps/tauri-action') || /tauri build/.test(s.run ?? ''))
const buildArgs = (job: Job) => {
    const build = buildStep(job)
    return String(build?.with?.args ?? build?.run ?? '')
}
const toolchain = (job: Job) => step(job, (s) => s.uses?.startsWith('dtolnay/rust-toolchain') ?? false)
const rustCache = (job: Job) => step(job, (s) => s.uses?.startsWith('swatinem/rust-cache') ?? false)
const runs = (job: Job, text: string) => job.steps.some((s) => (s.run ?? '').includes(text))

describe('Windows installer builds', () => {
    it.each(installerBuilds())('%s builds an x64 and an ARM64 installer', (_file, job) => {
        const targets = job.strategy?.matrix?.include?.map((entry) => entry.target)
        expect(targets).toEqual(['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc'])
        expect(toolchain(job)?.with?.targets).toBe('${{ matrix.target }}')
        expect(buildArgs(job)).toContain('--target ${{ matrix.target }}')
        expect(buildArgs(job)).toContain('--bundles nsis')
    })

    it.each(releaseWorkflows)('%s uploads one installer at a time, so neither overwrites the other in latest.json', (file) => {
        // Each build reads latest.json from the release, adds its own installer and uploads it again.
        expect(workflow(file).jobs['build-windows'].strategy?.['max-parallel']).toBe(1)
    })

    it.each(releaseWorkflows)('%s checks latest.json and publishes the release only after both builds', (file) => {
        const { jobs } = workflow(file)
        const build = jobs['build-windows']
        expect(runs(build, 'patch-updater-manifest')).toBe(false)
        expect(runs(build, 'draft=false')).toBe(false)

        const publish = jobs.publish
        expect([publish.needs].flat()).toContain('build-windows')
        expect(publish.if).toContain("needs.build-windows.result == 'success'")
        const patch = publish.steps.findIndex((s) => (s.run ?? '').includes('patch-updater-manifest.mjs'))
        const publishStep = publish.steps.findIndex((s) => (s.run ?? '').includes('draft=false'))
        expect(patch).toBeGreaterThan(-1)
        expect(publishStep).toBeGreaterThan(patch)
    })

    it("release builds start from the crates CI's check compiled for the same architecture", () => {
        // Same matrix, same cache key and same build options, so the caches CI saves on dev fit.
        for (const file of releaseWorkflows) {
            const job = workflow(file).jobs['build-windows']
            expect(job.strategy?.matrix?.include).toEqual(ciBuild().strategy?.matrix?.include)
            expect(rustCache(job)?.with?.['shared-key']).toBe(rustCache(ciBuild())?.with?.['shared-key'])
            expect(toolchain(job)?.with).toEqual(toolchain(ciBuild())?.with)
        }
        expect(rustCache(ciBuild())?.with?.['shared-key']).toContain('${{ matrix.arch }}')
    })
})
