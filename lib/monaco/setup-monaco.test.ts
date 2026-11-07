import { beforeEach, describe, expect, it, vi } from 'vitest'

const { config, openerService, OPENER_SERVICE_ID } = vi.hoisted(() => ({
    config: vi.fn(),
    openerService: { registerOpener: vi.fn(() => ({ dispose: () => {} })) },
    OPENER_SERVICE_ID: { type: 'opener service id' },
}))
const bundledMonaco = { editor: {}, languages: {} }

vi.mock('@monaco-editor/react', () => ({ loader: { config } }))
vi.mock('monaco-editor/editor', () => bundledMonaco)
vi.mock('monaco-editor/features/register.all', () => ({}))
vi.mock('monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution.js', () => ({}))
vi.mock('monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js', () => ({}))
vi.mock('monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens.js', () => ({}))
vi.mock('monaco-editor/languages/definitions/markdown/register', () => ({}))
vi.mock('@/lib/monaco/code-block-languages', () => ({}))
vi.mock('monaco-editor/platform/opener/common/opener.js', () => ({ IOpenerService: OPENER_SERVICE_ID }))
vi.mock('monaco-editor/editor/standalone/browser/standaloneServices.js', () => ({
    StandaloneServices: { get: (id: unknown) => (id === OPENER_SERVICE_ID ? openerService : undefined) },
}))

describe('setup-monaco', () => {
    // Vitest wipes the mocks' call history before each test, so each test loads a fresh copy of the module
    // and checks the calls that load makes, instead of leaning on an earlier test having imported it.
    beforeEach(() => {
        vi.resetModules()
    })

    it('points the loader at the bundled Monaco instead of the CDN, and provides a worker', async () => {
        await import('./setup-monaco')

        expect(config).toHaveBeenCalledTimes(1)
        const [{ monaco }] = config.mock.calls[0] as [{ monaco: Record<string, unknown> }]
        expect(monaco.editor).toBe(bundledMonaco.editor)
        expect(config.mock.calls[0]![0]).not.toHaveProperty('paths')
        expect(typeof globalThis.MonacoEnvironment?.getWorker).toBe('function')
    })

    it("hands Ctrl+Clicked links to the app's opener through Monaco's opener service", async () => {
        await import('./setup-monaco')
        expect(openerService.registerOpener).toHaveBeenCalledTimes(1)
    })
})
