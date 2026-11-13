import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const isTauri = vi.hoisted(() => vi.fn(() => true))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri }))

/** A fresh copy of the module, so what one test wrote doesn't stop the next one writing. */
async function load() {
    vi.resetModules()
    return import('@/lib/settings/settings-file')
}

function written(): unknown[] {
    return invoke.mock.calls.map(([, args]) => JSON.parse((args as { text: string }).text) as unknown)
}

describe('settings.json copy', () => {
    beforeEach(() => {
        invoke.mockReset()
        invoke.mockResolvedValue(undefined)
        isTauri.mockReturnValue(true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('saves the settings to settings.json, readable by hand', async () => {
        const { mirrorSettingsFile, settingsFileSaved } = await load()

        mirrorSettingsFile({ theme: { id: 'scrivon-light' }, schemaVersion: 1 })
        await settingsFileSaved()

        expect(invoke).toHaveBeenCalledTimes(1)
        expect(invoke).toHaveBeenCalledWith('save_settings_file', {
            text: '{\n  "theme": {\n    "id": "scrivon-light"\n  },\n  "schemaVersion": 1\n}',
        })
    })

    it('writes one copy at a time, and only the latest of those asked for meanwhile', async () => {
        const { mirrorSettingsFile, settingsFileSaved } = await load()
        let finishFirst: () => void = () => {}
        invoke.mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirst = resolve)))

        mirrorSettingsFile({ n: 1 })
        mirrorSettingsFile({ n: 2 })
        mirrorSettingsFile({ n: 3 })
        expect(written()).toEqual([{ n: 1 }])

        finishFirst()
        await settingsFileSaved()

        expect(written()).toEqual([{ n: 1 }, { n: 3 }])
    })

    it("doesn't write the same settings twice in a row", async () => {
        const { mirrorSettingsFile, settingsFileSaved } = await load()

        mirrorSettingsFile({ n: 1 })
        await settingsFileSaved()
        mirrorSettingsFile({ n: 1 })
        await settingsFileSaved()

        expect(written()).toEqual([{ n: 1 }])
    })

    it('only logs a failed write, and tries the same settings again next time', async () => {
        const { mirrorSettingsFile, settingsFileSaved } = await load()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        invoke.mockRejectedValueOnce('Access is denied. (os error 5)')

        mirrorSettingsFile({ n: 1 })
        await settingsFileSaved()
        mirrorSettingsFile({ n: 1 })
        await settingsFileSaved()

        expect(warn).toHaveBeenCalledTimes(1)
        expect(written()).toEqual([{ n: 1 }, { n: 1 }])
    })

    it('does nothing outside the desktop app', async () => {
        const { mirrorSettingsFile, settingsFileSaved } = await load()
        isTauri.mockReturnValue(false)

        mirrorSettingsFile({ n: 1 })
        await settingsFileSaved()

        expect(invoke).not.toHaveBeenCalled()
    })
})
