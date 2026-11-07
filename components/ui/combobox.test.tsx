import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Combobox, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup } from './combobox'

describe('ComboboxPopup', () => {
    it('draws the list at z-60, over the title bar that is raised while a dialog is open', async () => {
        render(
            <Combobox items={['Arial', 'Georgia']} defaultOpen>
                <ComboboxInput aria-label="Font" />
                <ComboboxPopup>
                    <ComboboxList>
                        {(item: string) => (
                            <ComboboxItem key={item} value={item}>
                                {item}
                            </ComboboxItem>
                        )}
                    </ComboboxList>
                </ComboboxPopup>
            </Combobox>
        )

        await waitFor(() => expect(document.querySelector('[data-slot="combobox-positioner"]')).not.toBeNull())
        // Same as Select and Popover; see TITLEBAR_ABOVE_DIALOGS_CLASS.
        expect(document.querySelector('[data-slot="combobox-positioner"]')!.className.split(/\s+/)).toContain('z-[60]')
    })
})
