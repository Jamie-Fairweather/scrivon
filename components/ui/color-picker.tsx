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
import { Input } from '@/components/ui/input'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SliderPrimitive } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

type HslColor = {
    hue: number
    saturation: number
    lightness: number
    alpha: number
}

type ColorPickerContextValue = HslColor & {
    mode: string
    setHue: (hue: number) => void
    setSaturation: (saturation: number) => void
    setLightness: (lightness: number) => void
    setAlpha: (alpha: number) => void
    setMode: (mode: string) => void
}

const ColorPickerContext = createContext<ColorPickerContextValue | undefined>(undefined)

export function useColorPicker(): ColorPickerContextValue {
    const context = useContext(ColorPickerContext)
    if (!context) throw new Error('useColorPicker must be used within a ColorPicker')
    return context
}

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

export function normalizeColorHex(value: string): string | null {
    const trimmed = value.trim()
    if (!HEX_PATTERN.test(trimmed)) return null
    if (trimmed.length === 4) {
        const [, r, g, b] = trimmed
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
    }
    return trimmed.toLowerCase()
}

export function hexToHsl(hex: string): HslColor {
    const normalized = normalizeColorHex(hex) ?? '#000000'
    const r = Number.parseInt(normalized.slice(1, 3), 16) / 255
    const g = Number.parseInt(normalized.slice(3, 5), 16) / 255
    const b = Number.parseInt(normalized.slice(5, 7), 16) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const lightness = (max + min) / 2
    if (max === min) return { hue: 0, saturation: 0, lightness: lightness * 100, alpha: 100 }

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
        alpha: 100,
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

export function hslToHex(hue: number, saturation: number, lightness: number): string {
    const [r, g, b] = hslToRgb(hue, saturation, lightness)
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export type ColorPickerProps = HTMLAttributes<HTMLDivElement> & {
    value?: string
    defaultValue?: string
    onChange?: (hex: string) => void
}

export function ColorPicker({ value, defaultValue = '#000000', onChange, className, children, ...props }: ColorPickerProps) {
    const initial = hexToHsl(value ?? defaultValue)
    const [hue, setHue] = useState(initial.hue)
    const [saturation, setSaturation] = useState(initial.saturation)
    const [lightness, setLightness] = useState(initial.lightness)
    const [alpha, setAlpha] = useState(initial.alpha)
    const [mode, setMode] = useState('hex')
    const lastEmittedRef = useRef(hslToHex(initial.hue, initial.saturation, initial.lightness))

    const syncFromValue = useEffectEvent((next: string) => {
        const parsed = hexToHsl(next)
        setHue(parsed.hue)
        setSaturation(parsed.saturation)
        setLightness(parsed.lightness)
        setAlpha(parsed.alpha)
    })

    useEffect(() => {
        if (value == null) return
        const normalized = normalizeColorHex(value)
        if (!normalized || normalized === lastEmittedRef.current) return
        lastEmittedRef.current = normalized
        syncFromValue(normalized)
    }, [value])

    const emitChange = useEffectEvent((nextHex: string) => {
        if (nextHex === lastEmittedRef.current) return
        lastEmittedRef.current = nextHex
        onChange?.(nextHex)
    })

    useEffect(() => {
        emitChange(hslToHex(hue, saturation, lightness))
    }, [hue, saturation, lightness])

    return (
        <ColorPickerContext.Provider
            value={{
                hue,
                saturation,
                lightness,
                alpha,
                mode,
                setHue,
                setSaturation,
                setLightness,
                setAlpha,
                setMode,
            }}
        >
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
            const node = containerRef.current
            if (!node) return
            const rect = node.getBoundingClientRect()
            const x = clamp((clientX - rect.left) / rect.width, 0, 1)
            const y = clamp((clientY - rect.top) / rect.height, 0, 1)
            setSaturation(x * 100)
            const nextTopLightness = x < 0.01 ? 100 : 50 + 50 * (1 - x)
            setLightness(nextTopLightness * (1 - y))
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
            onValueChange={(next) => {
                const first = Array.isArray(next) ? next[0] : next
                if (typeof first === 'number') onValueChange(first)
            }}
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
                    background: `linear-gradient(90deg, transparent, ${solid}),
                      url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyRCgLaBCAAgXwixzAS0pgAAAABJRU5ErkJggg==")`,
                }}
            />
        </div>
    )
}

export type ColorPickerEyeDropperProps = ComponentProps<typeof Button>

export function ColorPickerEyeDropper({ className, ...props }: ColorPickerEyeDropperProps) {
    const { setHue, setSaturation, setLightness, setAlpha } = useColorPicker()
    // Only ever rendered inside a client-opened popover, so reading `window` in the initialiser is safe.
    const [supported] = useState(() => typeof window !== 'undefined' && 'EyeDropper' in window)

    if (!supported) return null

    return (
        <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn('shrink-0 text-muted-foreground', className)}
            onClick={async () => {
                try {
                    const EyeDropperCtor = (window as Window & { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
                    const result = await new EyeDropperCtor().open()
                    const next = hexToHsl(result.sRGBHex)
                    setHue(next.hue)
                    setSaturation(next.saturation)
                    setLightness(next.lightness)
                    setAlpha(100)
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

const FORMAT_ITEMS = [
    { label: 'HEX', value: 'hex' },
    { label: 'RGB', value: 'rgb' },
    { label: 'CSS', value: 'css' },
    { label: 'HSL', value: 'hsl' },
]

export function ColorPickerOutput({ className, ...props }: ComponentProps<typeof SelectTrigger>) {
    const { mode, setMode } = useColorPicker()
    return (
        <Select items={FORMAT_ITEMS} value={mode} onValueChange={(next) => next && setMode(next)}>
            <SelectTrigger className={cn('h-8 w-20 shrink-0 text-xs', className)} size="sm" {...props}>
                <SelectValue />
            </SelectTrigger>
            <SelectPopup>
                {FORMAT_ITEMS.map((format) => (
                    <SelectItem key={format.value} value={format.value}>
                        {format.label}
                    </SelectItem>
                ))}
            </SelectPopup>
        </Select>
    )
}

function PercentageInput({ value }: { value: number }) {
    return (
        <div className="relative">
            <Input readOnly type="text" value={Math.round(value)} className="h-8 w-[3.25rem] rounded-l-none bg-secondary px-2 text-xs shadow-none" />
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
        </div>
    )
}

export type ColorPickerFormatProps = HTMLAttributes<HTMLDivElement>

export function ColorPickerFormat({ className, ...props }: ColorPickerFormatProps) {
    const { hue, saturation, lightness, alpha, mode } = useColorPicker()
    const hex = hslToHex(hue, saturation, lightness)
    const rgb = hslToRgb(hue, saturation, lightness)

    if (mode === 'hex') {
        return (
            <div className={cn('relative flex w-full items-center -space-x-px rounded-md shadow-sm', className)} {...props}>
                <Input readOnly type="text" value={hex} className="h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none" />
                <PercentageInput value={alpha} />
            </div>
        )
    }

    if (mode === 'rgb') {
        return (
            <div className={cn('flex items-center -space-x-px rounded-md shadow-sm', className)} {...props}>
                {rgb.map((channel, index) => (
                    <Input
                        key={index}
                        readOnly
                        type="text"
                        value={channel}
                        className={cn('h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none', index > 0 && 'rounded-l-none')}
                    />
                ))}
                <PercentageInput value={alpha} />
            </div>
        )
    }

    if (mode === 'css') {
        return (
            <div className={cn('w-full rounded-md shadow-sm', className)} {...props}>
                <Input
                    readOnly
                    type="text"
                    value={`rgba(${rgb.join(', ')}, ${Math.round(alpha)}%)`}
                    className="h-8 w-full bg-secondary px-2 text-xs shadow-none"
                />
            </div>
        )
    }

    return (
        <div className={cn('flex items-center -space-x-px rounded-md shadow-sm', className)} {...props}>
            {[Math.round(hue), Math.round(saturation), Math.round(lightness)].map((channel, index) => (
                <Input
                    key={index}
                    readOnly
                    type="text"
                    value={channel}
                    className={cn('h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none', index > 0 && 'rounded-l-none')}
                />
            ))}
            <PercentageInput value={alpha} />
        </div>
    )
}
