import { describe, expect, it } from 'vitest'
import { MIN_EDITOR_WIDTH, MIN_PREVIEW_WIDTH, clampEditorWidth, maxEditorWidth, minEditorWidth } from './editor-width'

describe('clampEditorWidth', () => {
    it('keeps a width that fits', () => {
        expect(clampEditorWidth(400, 1600)).toBe(400)
    })

    it('shrinks a saved width that no longer fits the window, leaving room for the preview', () => {
        // Dragged to 1500px on a big monitor, then shown in a 1110px row.
        expect(clampEditorWidth(1500, 1110)).toBe(666)
        expect(clampEditorWidth(1500, 520)).toBe(MIN_EDITOR_WIDTH)
        expect(520 - clampEditorWidth(1500, 520)).toBe(MIN_PREVIEW_WIDTH)
    })

    it('never goes below the minimum width when there is room', () => {
        expect(clampEditorWidth(100, 1600)).toBe(MIN_EDITOR_WIDTH)
        expect(minEditorWidth(1600)).toBe(MIN_EDITOR_WIDTH)
    })

    it('gives up space on both sides in a row too narrow for both minimums', () => {
        // A 640px window with the explorer open leaves a row of about 380px.
        expect(clampEditorWidth(400, 383)).toBe(160)
        expect(clampEditorWidth(100, 383)).toBe(160)
        expect(minEditorWidth(383)).toBe(160)
        expect(383 - maxEditorWidth(383)).toBeGreaterThan(200)

        // Narrower still, the editor takes at most 60%, so its right edge and handle stay in view.
        expect(clampEditorWidth(400, 250)).toBe(150)
        expect(minEditorWidth(250)).toBe(150)
        expect(clampEditorWidth(400, 100)).toBe(60)
    })
})
