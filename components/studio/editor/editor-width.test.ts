import { describe, expect, it } from 'vitest'
import { MIN_EDITOR_WIDTH, clampEditorWidth } from './editor-width'

describe('clampEditorWidth', () => {
    it('keeps a width that fits', () => {
        expect(clampEditorWidth(400, 1600)).toBe(400)
    })

    it('shrinks a saved width that no longer fits the window, leaving room for the preview', () => {
        // Dragged to 1500px on a big monitor, then shown in a 1110px row.
        expect(clampEditorWidth(1500, 1110)).toBe(666)
        expect(clampEditorWidth(1500, 500)).toBe(MIN_EDITOR_WIDTH)
    })

    it('never goes below the minimum width', () => {
        expect(clampEditorWidth(100, 1600)).toBe(MIN_EDITOR_WIDTH)
    })
})
