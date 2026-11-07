import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImagePathField } from '@/components/studio/settings/image-path-field'
import { isTauri } from '@/lib/tauri/platform'

describe('ImagePathField', () => {
    afterEach(() => {
        vi.mocked(isTauri).mockReturnValue(false)
        vi.mocked(open).mockReset()
        vi.mocked(invoke).mockReset()
    })

    it('records the image picked with Browse so it still exports after a restart', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(open).mockResolvedValue(String.raw`C:\Brand\logo.png`)
        const onChange = vi.fn()
        render(<ImagePathField value="" label="logo" onChange={onChange} />)

        fireEvent.click(screen.getByRole('button', { name: 'Browse for logo' }))

        await waitFor(() => expect(onChange).toHaveBeenCalledWith(String.raw`C:\Brand\logo.png`))
        expect(invoke).toHaveBeenCalledWith('remember_export_image', { path: String.raw`C:\Brand\logo.png` })
    })

    it('records nothing when the picker is cancelled', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(open).mockResolvedValue(null)
        const onChange = vi.fn()
        render(<ImagePathField value="C:/old.png" label="logo" onChange={onChange} />)

        fireEvent.click(screen.getByRole('button', { name: 'Browse for logo' }))

        await waitFor(() => expect(open).toHaveBeenCalled())
        await Promise.resolve()
        expect(onChange).not.toHaveBeenCalled()
        expect(invoke).not.toHaveBeenCalled()
    })

    it('clears the path', () => {
        const onChange = vi.fn()
        render(<ImagePathField value="C:/old.png" label="logo" onChange={onChange} />)

        fireEvent.click(screen.getByRole('button', { name: 'Clear logo' }))

        expect(onChange).toHaveBeenCalledWith('')
    })
})
