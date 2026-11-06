import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkWorkerCanRender, handleRenderRequest } from '@/lib/mermaid/render-worker-core'

/**
 * A Web Worker has `self` (an accessor on the global's prototype that can be replaced, but not
 * deleted) and no `document`. That combination makes ELK start up as a worker of its own unless
 * render-worker-core stands in a `document`. Each test file gets fresh modules, so ELK first
 * starts here, inside the worker-like global.
 */
const globalPrototype = Object.getPrototypeOf(globalThis) as object

beforeAll(() => {
    Object.defineProperty(globalPrototype, 'self', {
        configurable: true,
        get() {
            return globalThis
        },
        set(value: unknown) {
            Object.defineProperty(this, 'self', { value, writable: true, configurable: true, enumerable: true })
        },
    })
})

afterAll(() => {
    delete (globalThis as { self?: unknown }).self
    delete (globalPrototype as { self?: unknown }).self
})

describe('render worker', () => {
    it('can render inside a worker-like global (P01)', () => {
        expect(typeof document).toBe('undefined')
        expect(typeof self).toBe('object')

        expect(checkWorkerCanRender()).toEqual({ type: 'ready' })
        expect(typeof document).toBe('undefined')
        expect((globalThis as { onmessage?: unknown }).onmessage ?? null).toBeNull()
    })

    it('answers render requests with the SVG', () => {
        const response = handleRenderRequest({ id: 7, source: 'graph TD\n  A --> B --> C', themeId: 'scrivon-dark' })

        expect(response).toMatchObject({ type: 'rendered', id: 7 })
        expect(response.type === 'rendered' && response.svg).toMatch(/^<svg /)
    })

    it('answers invalid text with the parse error', () => {
        const response = handleRenderRequest({ id: 8, source: 'not a diagram', themeId: 'scrivon-light' })

        expect(response).toMatchObject({ type: 'failed', id: 8 })
        expect(response.type === 'failed' && response.message).toMatch(/\S/)
    })
})
