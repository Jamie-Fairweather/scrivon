import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const isTauri = vi.hoisted(() => vi.fn(() => true))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri }))

import { describeError, logError, logWarning } from '@/lib/diagnostics/app-log'

/** The lines the app sent to its log file. */
function logged(): { level: number; message: string }[] {
    return invoke.mock.calls.map(([command, args]) => {
        expect(command).toBe('plugin:log|log')
        return args as { level: number; message: string }
    })
}

beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue(undefined)
    isTauri.mockReturnValue(true)
})

describe('logError', () => {
    it('writes what failed and why to the log file as an error', () => {
        logError("Couldn't open the folder", 'Access is denied. (os error 5)')

        expect(logged()).toEqual([{ level: 5, message: "Couldn't open the folder: Access is denied. (os error 5)" }])
    })

    it('writes the title alone when there is no error', () => {
        logError('Something went wrong')

        expect(logged()).toEqual([{ level: 5, message: 'Something went wrong' }])
    })

    it('does nothing outside the desktop app', () => {
        isTauri.mockReturnValue(false)

        logError('Something went wrong', new Error('boom'))

        expect(invoke).not.toHaveBeenCalled()
    })

    it('never throws, even when the log cannot be written', async () => {
        invoke.mockRejectedValue(new Error('plugin log not found'))
        expect(() => logError('Something went wrong', 'boom')).not.toThrow()

        invoke.mockImplementation(() => {
            throw new Error('IPC is gone')
        })
        expect(() => logError('Something went wrong', 'boom')).not.toThrow()
        // Let the rejected write settle: an unhandled rejection here would fail the test run.
        await Promise.resolve()
    })
})

describe('logWarning', () => {
    it('writes a warning', () => {
        logWarning('Recent folders were reset', 'The list was damaged.')

        expect(logged()).toEqual([{ level: 4, message: 'Recent folders were reset: The list was damaged.' }])
    })
})

describe('describeError', () => {
    it("gives an error's name, message and where it happened", () => {
        const error = new TypeError("Cannot read properties of undefined (reading 'path')")
        error.stack = [
            "TypeError: Cannot read properties of undefined (reading 'path')",
            '    at openTab (tauri://localhost/_next/static/chunks/app.js:1:200)',
            '    at onClick (tauri://localhost/_next/static/chunks/app.js:1:900)',
        ].join('\n')

        expect(describeError(error)).toBe(
            [
                "TypeError: Cannot read properties of undefined (reading 'path')",
                '    at openTab (tauri://localhost/_next/static/chunks/app.js:1:200)',
                '    at onClick (tauri://localhost/_next/static/chunks/app.js:1:900)',
            ].join('\n')
        )
    })

    it('reads Tauri errors, which are plain strings or objects with a message', () => {
        expect(describeError('failed to open file')).toBe('failed to open file')
        expect(describeError({ message: 'forbidden path' })).toBe('forbidden path')
        expect(describeError(42)).toBe('Unknown error')
    })

    it('leaves out the document text that parse errors quote', () => {
        // beautiful-mermaid puts the diagram's first line in its message.
        const header = new Error('Invalid mermaid header: "my secret plan". Expected "graph TD", "flowchart LR", "stateDiagram-v2", etc.')
        expect(describeError(header)).not.toContain('secret')
        expect(describeError(header)).toMatch(/^Error: Invalid mermaid header: "…"/)

        // Mermaid-style messages show the lines they couldn't read below the first.
        const parse = new Error('Parse error on line 2:\ngraph TD\n  secret --> plan\n---^')
        parse.stack = `Error: ${parse.message}\n    at parse (app.js:1:1)`
        expect(describeError(parse)).toBe('Error: Parse error on line 2:\n    at parse (app.js:1:1)')

        // A document line that reads like a stack line.
        const lookalike = new Error('Parse error on line 1:\n    at noon --> lunch')
        lookalike.stack = `Error: ${lookalike.message}\n    at parse (app.js:1:1)`
        expect(describeError(lookalike)).not.toContain('noon')
    })

    it('keeps each line short', () => {
        const [line] = describeError('x'.repeat(5_000)).split('\n')
        expect(line!.length).toBeLessThanOrEqual(300)
        expect(line!.endsWith('…')).toBe(true)
    })

    it('keeps only the first few places from a deep stack', () => {
        const error = new Error('deep')
        error.stack = ['Error: deep', ...Array.from({ length: 50 }, (_, i) => `    at f${i} (app.js:1:${i})`)].join('\n')

        const lines = describeError(error).split('\n')
        expect(lines[0]).toBe('Error: deep')
        expect(lines.length).toBeLessThanOrEqual(11)
        expect(lines[1]).toBe('    at f0 (app.js:1:0)')
    })
})
