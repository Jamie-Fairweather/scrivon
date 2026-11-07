'use client'

import { PipetteIcon } from 'lucide-react'
import {
    type ComponentProps,
    type CSSProperties,
    createContext,
    type HTMLAttributes,
    type KeyboardEvent as ReactKeyboardEvent,
    memo,
    useCallback,
    useContext,
    useEffect,
    useEffectEvent,
    useMemo,
    useRef,
    useState,
} from 'react'
import { Button } from '@/components/ui/button'
import { SliderPrimitive } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

export type HslColor = {
    hue: number
    saturation: number
    lightness: number
    /** 0–100 */
    alpha: number
}

type ColorPickerContextValue = HslColor & {
    setHue: (hue: number) => void
    setSaturation: (saturation: number) => void
    setLightness: (lightness: number) => void
    setAlpha: (alpha: number) => void
    setColor: (color: HslColor) => void
    /** Marks the end of a change (pointer or key released, an eyedropper pick); `onChangeEnd` then gets the colour if it changed. */
    endChange: () => void
}

const ColorPickerContext = createContext<ColorPickerContextValue | undefined>(undefined)

export function useColorPicker(): ColorPickerContextValue {
    const context = useContext(ColorPickerContext)
    if (!context) throw new Error('useColorPicker must be used within a ColorPicker')
    return context
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

/** A point in the selection square, each axis 0–1 from the top-left corner. */
export type SelectionPoint = { x: number; y: number }

/**
 * The square is drawn as an HSV field (x = HSV saturation, y = 1 − value), so a
 * point in it converts HSV → HSL. Returns HSL saturation and lightness, 0–100.
 */
export function hslFromSelection(x: number, y: number): { saturation: number; lightness: number } {
    const hsvSaturation = clamp(x, 0, 1)
    const value = 1 - clamp(y, 0, 1)
    const lightness = value * (1 - hsvSaturation / 2)
    const saturation = lightness <= 0 || lightness >= 1 ? 0 : (value - lightness) / Math.min(lightness, 1 - lightness)
    return { saturation: saturation * 100, lightness: lightness * 100 }
}

/** Where an HSL colour sits in the selection square (the inverse of `hslFromSelection`). */
export function selectionFromHsl(saturation: number, lightness: number): SelectionPoint {
    const s = clamp(saturation, 0, 100) / 100
    const l = clamp(lightness, 0, 100) / 100
    const value = l + s * Math.min(l, 1 - l)
    return { x: value === 0 ? 0 : 2 * (1 - l / value), y: 1 - value }
}

/**
 * Maps a pointer inside the saturation/lightness field and returns the clamped point.
 * No-ops (returns `null`) when the field is not mounted.
 */
export function colorSelectionFromPointer(
    node: Pick<HTMLElement, 'getBoundingClientRect'> | null,
    clientX: number,
    clientY: number,
    setSaturation: (saturation: number) => void,
    setLightness: (lightness: number) => void
): SelectionPoint | null {
    if (!node) return null
    const rect = node.getBoundingClientRect()
    const x = clamp((clientX - rect.left) / rect.width, 0, 1)
    const y = clamp((clientY - rect.top) / rect.height, 0, 1)
    const next = hslFromSelection(x, y)
    setSaturation(next.saturation)
    setLightness(next.lightness)
    return { x, y }
}

export function isEyeDropperSupported(): boolean {
    return typeof window !== 'undefined' && 'EyeDropper' in window
}

/**
 * Accepts `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`; returns lowercase `#rrggbb`,
 * or `#rrggbbaa` when the colour is translucent. `null` for anything else.
 */
export function normalizeColorHex(value: string): string | null {
    const trimmed = value.trim()
    if (!HEX_PATTERN.test(trimmed)) return null
    let digits = trimmed.slice(1).toLowerCase()
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join('')
    if (digits.length === 8 && digits.endsWith('ff')) digits = digits.slice(0, 6)
    return `#${digits}`
}

export function hexToHsl(hex: string): HslColor {
    const normalized = normalizeColorHex(hex) ?? '#000000'
    const r = Number.parseInt(normalized.slice(1, 3), 16) / 255
    const g = Number.parseInt(normalized.slice(3, 5), 16) / 255
    const b = Number.parseInt(normalized.slice(5, 7), 16) / 255
    const alpha = normalized.length === 9 ? Math.round((Number.parseInt(normalized.slice(7, 9), 16) / 255) * 100) : 100
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const lightness = (max + min) / 2
    if (max === min) return { hue: 0, saturation: 0, lightness: lightness * 100, alpha }

    const delta = max - min
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    let hue = 0
    if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6
    else if (max === g) hue = ((b - r) / delta + 2) / 6
    else hue = ((r - g) / delta + 4) / 6

    return {
        hue: Math.round(hue * 360),
        saturation: Math.round(saturation * 1000) / 10,
        lightness: Math.round(lightness * 1000) / 10,
        alpha,
    }
}

function hueToRgb(p: number, q: number, t: number): number {
    let tone = t
    if (tone < 0) tone += 1
    if (tone > 1) tone -= 1
    if (tone < 1 / 6) return p + (q - p) * 6 * tone
    if (tone < 1 / 2) return q
    if (tone < 2 / 3) return p + (q - p) * (2 / 3 - tone) * 6
    return p
}

export function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
    const h = (((hue % 360) + 360) % 360) / 360
    const s = clamp(saturation, 0, 100) / 100
    const l = clamp(lightness, 0, 100) / 100
    if (s === 0) {
        const gray = Math.round(l * 255)
        return [gray, gray, gray]
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    return [Math.round(hueToRgb(p, q, h + 1 / 3) * 255), Math.round(hueToRgb(p, q, h) * 255), Math.round(hueToRgb(p, q, h - 1 / 3) * 255)]
}

/** `#rrggbb`, or `#rrggbbaa` when alpha is below 100. */
export function hslToHex(hue: number, saturation: number, lightness: number, alpha = 100): string {
    const channels: number[] = hslToRgb(hue, saturation, lightness)
    const a = clamp(alpha, 0, 100)
    if (a < 100) channels.push(Math.round((a / 100) * 255))
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function colorToHex(color: HslColor): string {
    return hslToHex(color.hue, color.saturation, color.lightness, color.alpha)
}

export type ColorPickerProps = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
    value?: string
    defaultValue?: string
    /** Receives the normalised hex (`#rrggbb` or `#rrggbbaa`) whenever the colour changes, including every move of a drag. */
    onChange?: (hex: string) => void
    /**
     * Receives the hex once a change ends: the pointer is released, a key that moved a slider or
     * the square is released (or focus leaves it), or the eyedropper picks a colour. Only called
     * when the colour really changed. Use it to save, so a drag or a held key saves once.
     */
    onChangeEnd?: (hex: string) => void
}

export function ColorPicker({ value, defaultValue = '#000000', onChange, onChangeEnd, className, children, ...props }: ColorPickerProps) {
    const [color, setColor] = useState(() => hexToHsl(value ?? defaultValue))
    const lastEmittedRef = useRef(colorToHex(color))
    // Whether the user changed the colour since the last change end (or the last outside value).
    // A press that changes nothing (a click on a thumb, End at the end) then reports no end, which
    // matters because the colour shown is the HSL round trip of the value and may differ from it.
    const changedRef = useRef(false)

    const syncFromValue = useEffectEvent((next: string) => {
        const parsed = hexToHsl(next)
        // Remember the round-tripped hex so the emit effect below stays quiet for an external update.
        lastEmittedRef.current = colorToHex(parsed)
        changedRef.current = false
        setColor(parsed)
    })

    useEffect(() => {
        if (value == null) return
        const normalized = normalizeColorHex(value)
        if (!normalized || normalized === lastEmittedRef.current) return
        syncFromValue(normalized)
    }, [value])

    const emitChange = useEffectEvent((nextHex: string) => {
        if (nextHex === lastEmittedRef.current) return
        lastEmittedRef.current = nextHex
        changedRef.current = true
        onChange?.(nextHex)
    })

    useEffect(() => {
        emitChange(colorToHex(color))
    }, [color])

    // Counted rather than called straight away, so the end is reported after the render that
    // applies the last change (an eyedropper pick sets the colour and ends the change in one go).
    const [changeEnds, setChangeEnds] = useState(0)
    const endChange = useCallback(() => setChangeEnds((count) => count + 1), [])
    const emitChangeEnd = useEffectEvent(() => onChangeEnd?.(colorToHex(color)))

    useEffect(() => {
        if (changeEnds === 0 || !changedRef.current) return
        changedRef.current = false
        emitChangeEnd()
    }, [changeEnds])

    const context = useMemo<ColorPickerContextValue>(
        () => ({
            ...color,
            setColor,
            endChange,
            setHue: (hue) => setColor((current) => ({ ...current, hue })),
            setSaturation: (saturation) => setColor((current) => ({ ...current, saturation })),
            setLightness: (lightness) => setColor((current) => ({ ...current, lightness })),
            setAlpha: (alpha) => setColor((current) => ({ ...current, alpha })),
        }),
        [color, endChange]
    )

    return (
        <ColorPickerContext.Provider value={context}>
            <div className={cn('flex w-full flex-col gap-3', className)} {...props}>
                {children}
            </div>
        </ColorPickerContext.Provider>
    )
}

export type ColorPickerSelectionProps = HTMLAttributes<HTMLDivElement>

/** Keys that move the point in the colour square. */
const SELECTION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])
/** Keys that move a Base UI slider thumb. */
const SLIDER_KEYS = new Set([...SELECTION_KEYS, 'PageUp', 'PageDown'])

export const ColorPickerSelection = memo(function ColorPickerSelection({ className, ...props }: ColorPickerSelectionProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDragging, setIsDragging] = useState(false)
    const { hue, saturation, lightness, setSaturation, setLightness, endChange } = useColorPicker()
    // The last point the user picked. Along the black bottom row (and at white) HSL drops the
    // HSV saturation, so rebuilding the thumb from the colour alone would jump it to the left edge.
    const [picked, setPicked] = useState<(SelectionPoint & { saturation: number; lightness: number }) | null>(null)

    const position = picked && picked.saturation === saturation && picked.lightness === lightness ? picked : selectionFromHsl(saturation, lightness)

    const backgroundGradient = useMemo(
        () =>
            `linear-gradient(0deg, rgba(0,0,0,1), rgba(0,0,0,0)),
            linear-gradient(90deg, rgba(255,255,255,1), rgba(255,255,255,0)),
            hsl(${hue}, 100%, 50%)`,
        [hue]
    )

    const updateFromPointer = useCallback(
        (clientX: number, clientY: number) => {
            const point = colorSelectionFromPointer(containerRef.current, clientX, clientY, setSaturation, setLightness)
            if (point) setPicked({ ...point, ...hslFromSelection(point.x, point.y) })
        },
        [setSaturation, setLightness]
    )

    /**
     * Arrow keys nudge the point (Shift for bigger steps), Home/End jump to the left/right edge.
     * The change ends when the key is released, so holding a key down saves once.
     */
    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 0.1 : 0.01
        let { x, y } = position
        if (event.key === 'ArrowLeft') x -= step
        else if (event.key === 'ArrowRight') x += step
        else if (event.key === 'ArrowUp') y -= step
        else if (event.key === 'ArrowDown') y += step
        else if (event.key === 'Home') x = 0
        else if (event.key === 'End') x = 1
        else return
        event.preventDefault()
        const point = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) }
        const next = hslFromSelection(point.x, point.y)
        setSaturation(next.saturation)
        setLightness(next.lightness)
        setPicked({ ...point, ...next })
    }

    const onKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (SELECTION_KEYS.has(event.key)) endChange()
    }

    useEffect(() => {
        if (!isDragging) return
        const onMove = (event: PointerEvent) => updateFromPointer(event.clientX, event.clientY)
        const onUp = () => {
            setIsDragging(false)
            endChange()
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
        }
    }, [isDragging, updateFromPointer, endChange])

    return (
        <div
            ref={containerRef}
            role="slider"
            tabIndex={0}
            aria-label="Saturation and brightness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clamp(position.x, 0, 1) * 100)}
            aria-valuetext={`Saturation ${Math.round(clamp(position.x, 0, 1) * 100)}%, brightness ${Math.round((1 - clamp(position.y, 0, 1)) * 100)}%`}
            className={cn(
                // A full-strength ring with a gap in the popover colour, so it reads against the popover, not the gradient.
                // outline-none, not outline-hidden: that keeps a transparent outline at rest, which Windows Contrast themes
                // paint. There, globals.css draws a Highlight outline on focus instead.
                `relative aspect-square w-full cursor-crosshair rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring
                focus-visible:ring-offset-2 focus-visible:ring-offset-popover`,
                className
            )}
            style={{ background: backgroundGradient }}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            // A key still held when focus leaves never sends its key up here.
            onBlur={endChange}
            onPointerDown={(event) => {
                event.preventDefault()
                setIsDragging(true)
                updateFromPointer(event.clientX, event.clientY)
            }}
            {...props}
        >
            <div
                className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
                style={{
                    left: `${clamp(position.x, 0, 1) * 100}%`,
                    top: `${clamp(position.y, 0, 1) * 100}%`,
                    boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
                }}
            />
        </div>
    )
})

function ColorSliderTrack({
    className,
    style,
    value,
    max,
    onValueChange,
    unit,
    'aria-label': ariaLabel,
}: {
    className?: string
    style?: CSSProperties
    value: number
    max: number
    onValueChange: (value: number) => void
    /** Read out after the value, e.g. "°" or "%". */
    unit: string
    'aria-label': string
}) {
    const { endChange } = useColorPicker()
    return (
        <SliderPrimitive.Root
            aria-label={ariaLabel}
            className={cn('w-full', className)}
            max={max}
            min={0}
            step={1}
            thumbAlignment="edge"
            value={[value]}
            onValueChange={([next]) => onValueChange(next)}
            // Base UI commits when a drag is released and on every key down, auto-repeat included,
            // so a key change ends when the key is released instead (or focus leaves mid-press).
            onValueCommitted={(_next, details) => {
                if (details.reason !== 'keyboard') endChange()
            }}
            onKeyUp={(event) => {
                if (SLIDER_KEYS.has(event.key)) endChange()
            }}
            onBlur={endChange}
        >
            <SliderPrimitive.Control className="flex h-4 w-full touch-none items-center select-none">
                <SliderPrimitive.Track className="relative h-3 w-full grow rounded-full" data-slot="slider-track" style={style}>
                    {/* Focus lands on the range input inside the thumb, so it carries the name and the ring uses has-focus-visible. */}
                    <SliderPrimitive.Thumb
                        aria-label={ariaLabel}
                        getAriaValueText={(_formatted, thumbValue) => `${Math.round(thumbValue)}${unit}`}
                        className="block size-4 shrink-0 rounded-full border border-primary/50 bg-background shadow outline-none
                            has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-1
                            has-focus-visible:ring-offset-popover"
                        data-slot="slider-thumb"
                        index={0}
                    />
                </SliderPrimitive.Track>
            </SliderPrimitive.Control>
        </SliderPrimitive.Root>
    )
}

export type ColorPickerHueProps = HTMLAttributes<HTMLDivElement>

export function ColorPickerHue({ className, ...props }: ColorPickerHueProps) {
    const { hue, setHue } = useColorPicker()
    return (
        <div className={cn('w-full', className)} {...props}>
            <ColorSliderTrack
                aria-label="Hue"
                unit="°"
                max={360}
                value={hue}
                onValueChange={setHue}
                style={{
                    background: 'linear-gradient(90deg,#FF0000,#FFFF00,#00FF00,#00FFFF,#0000FF,#FF00FF,#FF0000)',
                }}
            />
        </div>
    )
}

export type ColorPickerAlphaProps = HTMLAttributes<HTMLDivElement>

/** 8px checkerboard used behind translucent colours. */
export const COLOR_CHECKERBOARD =
    'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)'
export const COLOR_CHECKERBOARD_SIZE = '8px 8px, 8px 8px, 8px 8px, 8px 8px'
export const COLOR_CHECKERBOARD_POSITION = '0 0, 0 4px, 4px -4px, -4px 0'

export function ColorPickerAlpha({ className, ...props }: ColorPickerAlphaProps) {
    const { alpha, setAlpha, hue, saturation, lightness } = useColorPicker()
    const solid = hslToHex(hue, saturation, lightness)
    return (
        <div className={cn('w-full', className)} {...props}>
            <ColorSliderTrack
                aria-label="Alpha"
                unit="%"
                max={100}
                value={alpha}
                onValueChange={setAlpha}
                style={{
                    backgroundImage: `linear-gradient(90deg, transparent, ${solid}), ${COLOR_CHECKERBOARD}`,
                    backgroundSize: `100% 100%, ${COLOR_CHECKERBOARD_SIZE}`,
                    backgroundPosition: `0 0, ${COLOR_CHECKERBOARD_POSITION}`,
                }}
            />
        </div>
    )
}

export type ColorPickerEyeDropperProps = ComponentProps<typeof Button>

type EyeDropperWindow = { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }

export function ColorPickerEyeDropper({ className, ...props }: ColorPickerEyeDropperProps) {
    const { alpha, setColor, endChange } = useColorPicker()
    const [supported] = useState(() => isEyeDropperSupported())

    if (!supported) return null

    return (
        <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn('shrink-0 text-muted-foreground', className)}
            aria-label="Pick a colour from the screen"
            onClick={async () => {
                try {
                    const result = await new (window as unknown as EyeDropperWindow).EyeDropper().open()
                    // Screen colours are opaque; keep whatever alpha the user had dialled in.
                    setColor({ ...hexToHsl(result.sRGBHex), alpha })
                    endChange()
                } catch {
                    // Cancelled or unavailable.
                }
            }}
            {...props}
        >
            <PipetteIcon className="size-4" />
        </Button>
    )
}
