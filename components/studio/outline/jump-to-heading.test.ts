import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { registerPreviewHeadingReveal } from '@/components/studio/markdown/preview-heading'
import { jumpToHeading } from './jump-to-heading'

describe('jumpToHeading', () => {
    const revealInPreview = vi.fn()
    const coordinator = { revealInEditor: { current: vi.fn() } }
    const stop = registerPreviewHeadingReveal(revealInPreview)

    afterEach(() => {
        revealInPreview.mockClear()
        coordinator.revealInEditor.current.mockClear()
    })

    afterAll(() => stop())

    it('moves the preview and the editor to the heading', () => {
        jumpToHeading(coordinator, '/ws/guide.md', { id: 'install', line: 3 }, true)
        expect(revealInPreview).toHaveBeenCalledWith('install')
        expect(coordinator.revealInEditor.current).toHaveBeenCalledWith('/ws/guide.md', 3, 1)
    })

    it('moves only the preview while the editor is hidden', () => {
        jumpToHeading(coordinator, '/ws/guide.md', { id: 'install', line: 3 }, false)
        expect(revealInPreview).toHaveBeenCalledWith('install')
        expect(coordinator.revealInEditor.current).not.toHaveBeenCalled()
    })

    it('moves only the preview when there is no file path', () => {
        jumpToHeading(coordinator, null, { id: 'install', line: 3 }, true)
        expect(revealInPreview).toHaveBeenCalledWith('install')
        expect(coordinator.revealInEditor.current).not.toHaveBeenCalled()
    })
})
