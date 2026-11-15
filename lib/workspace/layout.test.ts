import { describe, expect, it } from 'vitest'
import { isPreviewShown } from './layout'

describe('isPreviewShown', () => {
    it('follows the preview setting while the editor is shown', () => {
        expect(isPreviewShown({ previewOpen: true, editorOpen: true })).toBe(true)
        expect(isPreviewShown({ previewOpen: false, editorOpen: true })).toBe(false)
    })

    it('shows the preview whenever the editor is hidden, even if its own setting is off', () => {
        expect(isPreviewShown({ previewOpen: true, editorOpen: false })).toBe(true)
        expect(isPreviewShown({ previewOpen: false, editorOpen: false })).toBe(true)
    })
})
