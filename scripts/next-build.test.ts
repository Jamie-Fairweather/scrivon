import { spawnSync } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runProductionBuild } from './next-build.mjs'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn(() => ({ status: 0 })) }))

const spawn = vi.mocked(spawnSync)

function buildEnv() {
    const options = spawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv }
    return options.env
}

describe('runProductionBuild', () => {
    beforeEach(() => {
        spawn.mockClear()
    })

    it('turns on source maps by default, for the licence tracing', () => {
        runProductionBuild()

        expect(buildEnv()).toMatchObject({ GENERATE_LICENSES: '1', NODE_ENV: 'production' })
    })

    it('builds without source maps when asked, for the second pass after the licence list changes', () => {
        vi.stubEnv('GENERATE_LICENSES', '1')
        try {
            runProductionBuild({ sourceMaps: false })
        } finally {
            vi.unstubAllEnvs()
        }

        expect(buildEnv().GENERATE_LICENSES).toBeUndefined()
        expect(buildEnv().NODE_ENV).toBe('production')
    })

    it('fails when next build fails', () => {
        spawn.mockReturnValueOnce({ status: 1 } as ReturnType<typeof spawnSync>)

        expect(() => runProductionBuild()).toThrow('Production build failed.')
    })
})
