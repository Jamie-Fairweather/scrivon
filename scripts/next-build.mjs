import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nextBin = join(root, 'node_modules', 'next', 'dist', 'bin', 'next')

export function runProductionBuild() {
    if (!existsSync(nextBin)) {
        throw new Error('Next.js is not installed. Run install first.')
    }

    const result = spawnSync(process.execPath, [nextBin, 'build'], {
        cwd: root,
        env: { ...process.env, GENERATE_LICENSES: '1', NODE_ENV: 'production' },
        stdio: 'inherit',
    })

    if (result.status !== 0) {
        throw new Error('Production build failed.')
    }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
    runProductionBuild()
}
