import { describe, expect, it, vi } from 'vitest'
import { buildPresentCommand, presentUnavailableReason } from './present-commands'

const markdown = (content: string) => ({ id: 'C:\\ws\\talk.md', name: 'talk.md', content })

describe('presentUnavailableReason', () => {
    it('lets a Markdown document with something to show be presented', () => {
        expect(presentUnavailableReason(true, markdown('# Talk'))).toBeNull()
    })

    it('says why it can’t be presented', () => {
        expect(presentUnavailableReason(false, markdown('# Talk'))).toBe('No folder open')
        expect(presentUnavailableReason(true, null)).toBe('No document open')
        expect(presentUnavailableReason(true, { id: 'C:\\ws\\flow.mmd', name: 'flow.mmd', content: 'flowchart TD' })).toBe(
            'Only Markdown documents can be presented'
        )
        expect(presentUnavailableReason(true, markdown('  \n\n'))).toBe('The document is empty')
        // The preview leaves front matter out, so a document of only front matter has nothing to show either.
        expect(presentUnavailableReason(true, markdown('---\ntitle: Talk\n---\n'))).toBe('The document is empty')
    })
})

describe('buildPresentCommand', () => {
    it('presents the active tab, with F5 (view.present) as its shortcut', () => {
        const present = vi.fn()
        const command = buildPresentCommand({ activeTabId: 'C:\\ws\\talk.md', unavailableReason: null, present })

        expect(command).toMatchObject({ id: 'present', label: 'Present', keybind: 'view.present', disabled: false })
        void command.run()
        expect(present).toHaveBeenCalledWith('C:\\ws\\talk.md')
    })

    it('is greyed out with the reason, and does nothing', () => {
        const present = vi.fn()
        const command = buildPresentCommand({
            activeTabId: 'C:\\ws\\flow.mmd',
            unavailableReason: 'Only Markdown documents can be presented',
            present,
        })

        expect(command.disabled).toBe(true)
        expect(command.disabledReason).toBe('Only Markdown documents can be presented')
        void command.run()
        expect(present).not.toHaveBeenCalled()
    })

    it('is greyed out with no tab open', () => {
        const command = buildPresentCommand({ activeTabId: null, unavailableReason: 'No document open', present: vi.fn() })

        expect(command).toMatchObject({ disabled: true, disabledReason: 'No document open' })
    })
})
