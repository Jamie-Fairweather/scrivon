import { describe, expect, it, vi } from 'vitest'

const config = vi.fn()
const bundledMonaco = { editor: {}, languages: {} }

vi.mock('@monaco-editor/react', () => ({ loader: { config } }))
vi.mock('monaco-editor/esm/vs/editor/edcore.main.js', () => bundledMonaco)
vi.mock('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js', () => ({}))

describe('setup-monaco', () => {
    it('points the loader at the bundled Monaco instead of the CDN, and provides a worker', async () => {
        await import('./setup-monaco')

        expect(config).toHaveBeenCalledTimes(1)
        const [{ monaco }] = config.mock.calls[0] as [{ monaco: Record<string, unknown> }]
        expect(monaco.editor).toBe(bundledMonaco.editor)
        expect(config.mock.calls[0]![0]).not.toHaveProperty('paths')
        expect(typeof globalThis.MonacoEnvironment?.getWorker).toBe('function')
    })
})
