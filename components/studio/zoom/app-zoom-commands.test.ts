import { describe, expect, it, vi } from 'vitest'
import { buildAppZoomCommands } from '@/components/studio/zoom/app-zoom-commands'

function commands(zoom: number) {
    const setZoom = vi.fn()
    const byId = new Map(buildAppZoomCommands({ zoom, setZoom }).map((command) => [command.id, command]))
    return { setZoom, byId }
}

describe('buildAppZoomCommands', () => {
    it('zooms in, out and back to 100% on their shortcuts, saying the zoom now', () => {
        const { setZoom, byId } = commands(1.25)

        expect(byId.get('app-zoom-in')).toMatchObject({ label: 'Zoom In', keybind: 'view.appZoomIn', detail: 'Now 125%', disabled: false })
        expect(byId.get('app-zoom-out')).toMatchObject({ label: 'Zoom Out', keybind: 'view.appZoomOut', disabled: false })
        expect(byId.get('app-zoom-reset')).toMatchObject({ label: 'Reset Zoom', keybind: 'view.appZoomReset', disabled: false })

        void byId.get('app-zoom-in')!.run()
        void byId.get('app-zoom-out')!.run()
        void byId.get('app-zoom-reset')!.run()
        expect(setZoom.mock.calls).toEqual([[1.5], [1.1], [1]])
    })

    it('is found by typing what people call zoom', () => {
        const { byId } = commands(1)
        expect(byId.get('app-zoom-in')?.keywords).toMatch(/bigger/)
        expect(byId.get('app-zoom-out')?.keywords).toMatch(/smaller/)
    })

    it("can't go past 200% or under 50%, or reset at 100%", () => {
        expect(commands(2).byId.get('app-zoom-in')).toMatchObject({ disabled: true, disabledReason: 'Already at 200%' })
        expect(commands(0.5).byId.get('app-zoom-out')).toMatchObject({ disabled: true, disabledReason: 'Already at 50%' })
        expect(commands(1).byId.get('app-zoom-reset')).toMatchObject({ disabled: true, disabledReason: 'Already at 100%' })
    })
})
