'use client'

import { PipetteIcon } from 'lucide-react'
import {
    type ComponentProps,
    type CSSProperties,
    createContext,
    type HTMLAttributes,
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

/** Maps a pointer inside the saturation/lightness field. No-ops when the field is not mounted. */
export function colorSelectionFromPointer(
    node: Pick<HTMLElement, 'getBoundingClientRect'> | null,
    clientX: number,
    clientY: number,
    setSaturation: (saturation: number) => void,
    setLightness: (lightness: number) => void
): void {
    if (!node) return
    const rect = node.getBoundingClientRect()
    const x = clamp((clientX - rect.left) / rect.width, 0, 1)
    const y = clamp((clientY - rect.top) / rect.height, 0, 1)
    setSaturation(x * 100)
    const nextTopLightness = x < 0.01 ? 100 : 50 + 50 * (1 - x)
    setLightness(nextTopLightness * (1 - y))
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
    /** Receives the normalised hex (`#rrggbb` or `#rrggbbaa`) whenever the colour changes. */
    onChange?: (hex: string) => void
}

export function ColorPicker({ value, defaultValue = '#000000', onChange, className, children, ...props }: ColorPickerProps) {
    const [color, setColor] = useState(() => hexToHsl(value ?? defaultValue))
    const lastEmittedRef = useRef(colorToHex(color))

    const syncFromValue = useEffectEvent((next: string) => {
        const parsed = hexToHsl(next)
        // Remember the round-tripped hex so the emit effect below stays quiet for an external update.
        lastEmittedRef.current = colorToHex(parsed)
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
        onChange?.(nextHex)
    })

    useEffect(() => {
        emitChange(colorToHex(color))
    }, [color])

    const context = useMemo<ColorPickerContextValue>(
        () => ({
            ...color,
            setColor,
            setHue: (hue) => setColor((current) => ({ ...current, hue })),
            setSaturation: (saturation) => setColor((current) => ({ ...current, saturation })),
            setLightness: (lightness) => setColor((current) => ({ ...current, lightness })),
            setAlpha: (alpha) => setColor((current) => ({ ...current, alpha })),
        }),
        [color]
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

export const ColorPickerSelection = memo(function ColorPickerSelection({ className, ...props }: ColorPickerSelectionProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDragging, setIsDragging] = useState(false)
    const { hue, saturation, lightness, setSaturation, setLightness } = useColorPicker()

    const positionX = saturation / 100
    const topLightness = positionX < 0.01 ? 100 : 50 + 50 * (1 - positionX)
    const positionY = topLightness <= 0 ? 0 : 1 - lightness / topLightness

    const backgroundGradient = useMemo(
        () =>
            `linear-gradient(0deg, rgba(0,0,0,1), rgba(0,0,0,0)),
            linear-gradient(90deg, rgba(255,255,255,1), rgba(255,255,255,0)),
            hsl(${hue}, 100%, 50%)`,
        [hue]
    )

    const updateFromPointer = useCallback(
        (clientX: number, clientY: number) => {
            colorSelectionFromPointer(containerRef.current, clientX, clientY, setSaturation, setLightness)
        },
        [setSaturation, setLightness]
    )

    useEffect(() => {
        if (!isDragging) return
        const onMove = (event: PointerEvent) => updateFromPointer(event.clientX, event.clientY)
        const onUp = () => setIsDragging(false)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
        }
    }, [isDragging, updateFromPointer])

    return (
        <div
            ref={containerRef}
            className={cn('relative aspect-square w-full cursor-crosshair rounded-md', className)}
            style={{ background: backgroundGradient }}
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
                    left: `${positionX * 100}%`,
                    top: `${clamp(positionY, 0, 1) * 100}%`,
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
    'aria-label': ariaLabel,
}: {
    className?: string
    style?: CSSProperties
    value: number
    max: number
    onValueChange: (value: number) => void
    'aria-label': string
}) {
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
        >
            <SliderPrimitive.Control className="flex h-4 w-full touch-none items-center select-none">
                <SliderPrimitive.Track className="relative h-3 w-full grow rounded-full" data-slot="slider-track" style={style}>
                    <SliderPrimitive.Thumb
                        className="block size-4 shrink-0 rounded-full border border-primary/50 bg-background shadow outline-none
                            focus-visible:ring-[3px] focus-visible:ring-ring/24"
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
    const { alpha, setColor } = useColorPicker()
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
