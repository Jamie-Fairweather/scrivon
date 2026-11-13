'use client'

import { useCallback } from 'react'
import { useAppSettings } from '@/components/studio/settings/settings-provider'

/** The saved app zoom (1 is 100%), and a setter that takes a value or a change to the latest one. */
export function useAppZoom(): { zoom: number; setZoom: (next: number | ((zoom: number) => number)) => void } {
    const { settings, updateSettings } = useAppSettings()
    const setZoom = useCallback(
        (next: number | ((zoom: number) => number)) => {
            updateSettings((current) => {
                const zoom = typeof next === 'function' ? next(current.appearance.zoom) : next
                return zoom === current.appearance.zoom ? current : { ...current, appearance: { ...current.appearance, zoom } }
            })
        },
        [updateSettings]
    )
    return { zoom: settings.appearance.zoom, setZoom }
}
