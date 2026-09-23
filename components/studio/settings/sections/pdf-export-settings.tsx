'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { APP_THEME_IDS, APP_THEME_LABELS, type AppThemeId } from '@/lib/theme/catalog'
import {
    createPdfExportProfile,
    deletePdfExportProfile,
    duplicatePdfExportProfile,
    getActivePdfExportProfile,
    renamePdfExportProfile,
    setActivePdfExportProfile,
    updatePdfExportProfile,
} from '@/lib/settings/pdf-export-profiles'
import { PDF_EXPORT_LIMITS } from '@/lib/settings/pdf-export-defaults'
import { ensureFontOption, loadPdfExportFontOptions, PDF_EXPORT_FONT_OPTIONS, type PdfExportFontOption } from '@/lib/settings/pdf-export-fonts'
import type {
    PdfExportChrome,
    PdfExportChromeSide,
    PdfExportFooter,
    PdfExportProfile,
    PdfExportSettings as PdfExportSettingsValue,
    PdfHideOnFirstPages,
    PdfNewPageFromHeading,
    PdfPageNumberFormat,
    PdfPageOrientation,
    PdfPageSize,
    PdfTocDepth,
} from '@/lib/settings/pdf-export-types'
import type { ShikiTheme } from '@/lib/markdown/shiki-highlighter'
import { ColorField } from '@/components/studio/settings/color-field'
import { ImagePathField } from '@/components/studio/settings/image-path-field'
import { NumberSetting } from '@/components/studio/settings/number-setting'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { SwitchSetting } from '@/components/studio/settings/switch-setting'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { OptionSelect, type SelectOption } from '@/components/ui/option-select'

const PAGE_SIZE_OPTIONS: SelectOption<PdfPageSize>[] = [
    { label: 'A4', value: 'a4' },
    { label: 'Letter', value: 'letter' },
]
const ORIENTATION_OPTIONS: SelectOption<PdfPageOrientation>[] = [
    { label: 'Portrait', value: 'portrait' },
    { label: 'Landscape', value: 'landscape' },
]
const MARGIN_SIDES = ['top', 'right', 'bottom', 'left'] as const
const TOC_DEPTH_OPTIONS: SelectOption<`${PdfTocDepth}`>[] = [
    { label: 'H1', value: '1' },
    { label: 'H1–H2', value: '2' },
    { label: 'H1–H3', value: '3' },
    { label: 'H1–H4', value: '4' },
]
const NEW_PAGE_OPTIONS: SelectOption<`${PdfNewPageFromHeading}`>[] = [
    { label: 'Off', value: '0' },
    { label: 'H1', value: '1' },
    { label: 'H2 and above', value: '2' },
    { label: 'H3 and above', value: '3' },
    { label: 'H4 and above', value: '4' },
    { label: 'H5 and above', value: '5' },
    { label: 'H6 and above', value: '6' },
]
const CODE_THEME_OPTIONS: SelectOption<ShikiTheme>[] = [
    { label: 'GitHub Light', value: 'github-light' },
    { label: 'GitHub Dark', value: 'github-dark' },
]
const DIAGRAM_THEME_OPTIONS: SelectOption<AppThemeId>[] = APP_THEME_IDS.map((id) => ({ label: APP_THEME_LABELS[id], value: id }))
const HIDE_ON_OPTIONS: SelectOption<PdfHideOnFirstPages>[] = [
    { label: 'None', value: 'none' },
    { label: 'Title page', value: 'title' },
    { label: 'Title page + TOC', value: 'title+toc' },
]
const PAGE_NUMBER_OPTIONS: SelectOption<PdfPageNumberFormat>[] = [
    { label: 'None', value: 'none' },
    { label: 'Number', value: 'number' },
    { label: 'Page N', value: 'page-n' },
    { label: 'N / total', value: 'n-of-total' },
    { label: 'Custom text', value: 'custom' },
]

type ProfileSection = Exclude<keyof PdfExportProfile, 'id' | 'name'>

function FontSelect({
    id,
    value,
    options,
    onChange,
}: {
    id: string
    value: string
    options: PdfExportFontOption[]
    onChange: (value: string) => void
}) {
    const items = useMemo(() => ensureFontOption(options, value), [options, value])
    return (
        <OptionSelect
            id={id}
            value={value}
            options={items}
            onChange={onChange}
            renderOption={(option) => <span style={{ fontFamily: option.value }}>{option.label}</span>}
        />
    )
}

export function PdfExportSettings() {
    const { settings, updateSettings } = useAppSettings()
    const pdf = settings.pdfExport
    const active = getActivePdfExportProfile(pdf)
    const [fontOptions, setFontOptions] = useState<PdfExportFontOption[]>(PDF_EXPORT_FONT_OPTIONS)

    useEffect(() => {
        let cancelled = false
        void loadPdfExportFontOptions().then((options) => {
            if (!cancelled) setFontOptions(options)
        })
        return () => {
            cancelled = true
        }
    }, [])

    const setPdf = (update: (pdf: PdfExportSettingsValue) => PdfExportSettingsValue) =>
        updateSettings((current) => ({ ...current, pdfExport: update(current.pdfExport) }))
    const patch = (update: (profile: PdfExportProfile) => PdfExportProfile) => setPdf((current) => updatePdfExportProfile(current, active.id, update))
    /** Merge `changes` into one section of the active profile. */
    const setSection = <K extends ProfileSection>(key: K, changes: Partial<PdfExportProfile[K]>) =>
        patch((profile) => ({ ...profile, [key]: { ...profile[key], ...changes } }))

    return (
        <div className="space-y-6">
            <Field>
                <FieldLabel htmlFor="pdf-profile">Profile</FieldLabel>
                <FieldDescription>Named export styles for branded PDFs.</FieldDescription>
                <div className="flex flex-wrap gap-2">
                    <OptionSelect
                        id="pdf-profile"
                        className="min-w-48 flex-1"
                        value={pdf.activeProfileId}
                        options={pdf.profiles.map((profile) => ({ label: profile.name, value: profile.id }))}
                        onChange={(id) => setPdf((current) => setActivePdfExportProfile(current, id))}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={() => setPdf(createPdfExportProfile)}>
                        New
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPdf((current) => duplicatePdfExportProfile(current, current.activeProfileId))}
                    >
                        Duplicate
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pdf.profiles.length <= 1}
                        onClick={() => setPdf((current) => deletePdfExportProfile(current, current.activeProfileId))}
                    >
                        Delete
                    </Button>
                </div>
            </Field>

            <Field>
                <FieldLabel htmlFor="pdf-profile-name">Profile name</FieldLabel>
                <Input
                    id="pdf-profile-name"
                    value={active.name}
                    onChange={(event) => setPdf((current) => renamePdfExportProfile(current, active.id, event.target.value))}
                />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                    <FieldLabel htmlFor="pdf-page-size">Page size</FieldLabel>
                    <OptionSelect
                        id="pdf-page-size"
                        value={active.page.size}
                        options={PAGE_SIZE_OPTIONS}
                        onChange={(size) => setSection('page', { size })}
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor="pdf-orientation">Orientation</FieldLabel>
                    <OptionSelect
                        id="pdf-orientation"
                        value={active.page.orientation}
                        options={ORIENTATION_OPTIONS}
                        onChange={(orientation) => setSection('page', { orientation })}
                    />
                </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                {MARGIN_SIDES.map((side) => (
                    <NumberSetting
                        key={side}
                        id={`pdf-margin-${side}`}
                        label={`Margin ${side} (mm)`}
                        value={active.page.marginsMm[side]}
                        {...PDF_EXPORT_LIMITS.marginMm}
                        onChange={(value) =>
                            patch((profile) => ({ ...profile, page: { ...profile.page, marginsMm: { ...profile.page.marginsMm, [side]: value } } }))
                        }
                    />
                ))}
            </div>

            <Field>
                <FieldLabel htmlFor="pdf-heading-font">Heading font</FieldLabel>
                <FontSelect
                    id="pdf-heading-font"
                    value={active.typography.headingFont}
                    options={fontOptions}
                    onChange={(headingFont) => setSection('typography', { headingFont })}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="pdf-body-font">Body font</FieldLabel>
                <FontSelect
                    id="pdf-body-font"
                    value={active.typography.bodyFont}
                    options={fontOptions}
                    onChange={(bodyFont) => setSection('typography', { bodyFont })}
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="pdf-mono-font">Monospace font</FieldLabel>
                <FontSelect
                    id="pdf-mono-font"
                    value={active.typography.monoFont}
                    options={fontOptions}
                    onChange={(monoFont) => setSection('typography', { monoFont })}
                />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
                <NumberSetting
                    id="pdf-body-size"
                    label="Body size (pt)"
                    value={active.typography.bodySizePt}
                    {...PDF_EXPORT_LIMITS.bodySizePt}
                    onChange={(bodySizePt) => setSection('typography', { bodySizePt })}
                />
                <NumberSetting
                    id="pdf-line-height"
                    label="Line height"
                    description="Multiple of the font size, in both PDF and Word."
                    value={active.typography.lineHeight}
                    {...PDF_EXPORT_LIMITS.lineHeight}
                    onChange={(lineHeight) => setSection('typography', { lineHeight })}
                />
            </div>

            <SwitchSetting
                label="Justify body text"
                description="Normal paragraphs only. Headings, lists, tables, quotes, and code stay left aligned."
                checked={active.typography.justify}
                onChange={(justify) => setSection('typography', { justify })}
            />

            <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                    <FieldLabel htmlFor="pdf-accent">Brand colour</FieldLabel>
                    <ColorField id="pdf-accent" value={active.brand.accentColor} onChange={(accentColor) => setSection('brand', { accentColor })} />
                </Field>
                <Field>
                    <FieldLabel htmlFor="pdf-link">Link colour (optional)</FieldLabel>
                    <ColorField
                        id="pdf-link"
                        value={active.brand.linkColor}
                        placeholder="Falls back to brand"
                        allowEmpty
                        onChange={(linkColor) => setSection('brand', { linkColor })}
                    />
                </Field>
            </div>

            <Field>
                <FieldLabel htmlFor="pdf-logo">Title-page logo</FieldLabel>
                <ImagePathField
                    id="pdf-logo"
                    value={active.brand.logoPath}
                    title="Choose title-page logo"
                    onChange={(logoPath) => setSection('brand', { logoPath })}
                />
            </Field>

            <SwitchSetting
                label="Title-page image ignores margins"
                description="Stretch the image to the page edges as a full-bleed cover banner."
                checked={active.brand.logoIgnoreMargins}
                onChange={(logoIgnoreMargins) => setSection('brand', { logoIgnoreMargins })}
            />
            <SwitchSetting
                label="Title page"
                description="Include a cover page with title metadata and logo."
                checked={active.frontMatter.titlePage}
                onChange={(titlePage) => setSection('frontMatter', { titlePage })}
            />
            <SwitchSetting
                label="Table of contents"
                description="Generate a TOC from headings."
                checked={active.frontMatter.toc}
                onChange={(toc) => setSection('frontMatter', { toc })}
            />

            <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                    <FieldLabel htmlFor="pdf-toc-depth">TOC depth</FieldLabel>
                    <OptionSelect
                        id="pdf-toc-depth"
                        value={`${active.frontMatter.tocDepth}`}
                        options={TOC_DEPTH_OPTIONS}
                        onChange={(depth) => setSection('frontMatter', { tocDepth: Number(depth) as PdfTocDepth })}
                    />
                </Field>
                <SwitchSetting
                    label="Exclude H1 from TOC"
                    className="h-full pt-6"
                    checked={active.frontMatter.tocExcludeH1}
                    onChange={(tocExcludeH1) => setSection('frontMatter', { tocExcludeH1 })}
                />
            </div>

            <ChromeFields title="Header" chrome={active.header} onChange={(header) => setSection('header', header)} />
            <ChromeFields title="Footer" chrome={active.footer} onChange={(footer) => setSection('footer', footer)} />

            <Field>
                <FieldLabel htmlFor="pdf-new-page-heading">New page from heading</FieldLabel>
                <FieldDescription>That level and every heading above it start on a fresh page.</FieldDescription>
                <OptionSelect
                    id="pdf-new-page-heading"
                    value={`${active.flow.newPageFromHeading}`}
                    options={NEW_PAGE_OPTIONS}
                    onChange={(level) => setSection('flow', { newPageFromHeading: Number(level) as PdfNewPageFromHeading })}
                />
            </Field>

            <Field>
                <FieldLabel htmlFor="pdf-code-theme">Code theme</FieldLabel>
                <OptionSelect
                    id="pdf-code-theme"
                    value={active.content.codeTheme}
                    options={CODE_THEME_OPTIONS}
                    onChange={(codeTheme) => setSection('content', { codeTheme })}
                />
            </Field>

            <Field>
                <FieldLabel htmlFor="pdf-mermaid-theme">Diagram theme</FieldLabel>
                <OptionSelect
                    id="pdf-mermaid-theme"
                    value={active.content.mermaidThemeId}
                    options={DIAGRAM_THEME_OPTIONS}
                    onChange={(mermaidThemeId) => setSection('content', { mermaidThemeId })}
                />
            </Field>

            <Field>
                <FieldLabel htmlFor="pdf-watermark">Watermark</FieldLabel>
                <Input
                    id="pdf-watermark"
                    value={active.content.watermark}
                    placeholder="e.g. DRAFT"
                    onChange={(event) => setSection('content', { watermark: event.target.value })}
                />
            </Field>
        </div>
    )
}

function ChromeFields({
    title,
    chrome,
    onChange,
}: {
    title: string
    chrome: PdfExportChrome | PdfExportFooter
    /** Only the footer ever receives `pageNumbers`. */
    onChange: (changes: Partial<PdfExportFooter>) => void
}) {
    const lower = title.toLowerCase()
    return (
        <div className="space-y-4 rounded-lg border border-border p-3">
            <SwitchSetting label={title} checked={chrome.enabled} onChange={(enabled) => onChange({ enabled })} />
            <p className="text-sm text-muted-foreground">Images always sit outermost, nearest the page edge.</p>
            <div className="grid gap-4 sm:grid-cols-2">
                <ChromeSideFields side="Left" title={title} value={chrome.left} onChange={(left) => onChange({ left })} />
                <ChromeSideFields
                    side="Right"
                    title={title}
                    value={chrome.right}
                    onChange={(right) => onChange({ right })}
                    text={
                        'pageNumbers' in chrome ? (
                            <FooterRightText
                                format={chrome.pageNumbers}
                                text={chrome.right.text}
                                onFormatChange={(pageNumbers) => onChange({ pageNumbers })}
                                onTextChange={(text) => onChange({ right: { ...chrome.right, text } })}
                            />
                        ) : undefined
                    }
                />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                    <FieldLabel>Background colour</FieldLabel>
                    <ColorField
                        value={chrome.backgroundColor}
                        placeholder="Transparent"
                        allowEmpty
                        onChange={(backgroundColor) => onChange({ backgroundColor })}
                    />
                </Field>
                <Field>
                    <FieldLabel>Font colour</FieldLabel>
                    <ColorField value={chrome.textColor} placeholder="Default" allowEmpty onChange={(textColor) => onChange({ textColor })} />
                </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <NumberSetting
                    label="Height (mm)"
                    description="0 fits the content."
                    value={chrome.heightMm}
                    {...PDF_EXPORT_LIMITS.chromeMm}
                    onChange={(heightMm) => onChange({ heightMm })}
                />
                <NumberSetting
                    label="Gap to content (mm)"
                    description={`Space between the ${lower} and the body.`}
                    value={chrome.gapMm}
                    {...PDF_EXPORT_LIMITS.chromeMm}
                    onChange={(gapMm) => onChange({ gapMm })}
                />
            </div>
            <SwitchSetting
                label="Ignore margins"
                description="Bleed to the page edge."
                checked={chrome.ignoreMargins}
                onChange={(ignoreMargins) => onChange({ ignoreMargins })}
            />
            <Field>
                <FieldLabel>Hide on</FieldLabel>
                <OptionSelect
                    value={chrome.hideOnFirstPages}
                    options={HIDE_ON_OPTIONS}
                    onChange={(hideOnFirstPages) => onChange({ hideOnFirstPages })}
                />
            </Field>
        </div>
    )
}

const PLACEHOLDER_HINT = `Use {{title}} or {{date}} placeholders.`

function ChromeSideFields({
    side,
    title,
    value,
    onChange,
    text,
}: {
    side: 'Left' | 'Right'
    title: string
    value: PdfExportChromeSide
    onChange: (value: PdfExportChromeSide) => void
    /** Replaces the plain text field (the footer's right slot is the page counter). */
    text?: ReactNode
}) {
    return (
        <div className="space-y-3">
            <Field>
                <FieldLabel>{side} image</FieldLabel>
                <ImagePathField
                    value={value.imagePath}
                    title={`Choose ${title.toLowerCase()} ${side.toLowerCase()} image`}
                    onChange={(imagePath) => onChange({ ...value, imagePath })}
                />
            </Field>
            {text ?? (
                <Field>
                    <FieldLabel>{side} text</FieldLabel>
                    <FieldDescription>{PLACEHOLDER_HINT}</FieldDescription>
                    <Input value={value.text} onChange={(event) => onChange({ ...value, text: event.target.value })} />
                </Field>
            )}
        </div>
    )
}

function FooterRightText({
    format,
    text,
    onFormatChange,
    onTextChange,
}: {
    format: PdfPageNumberFormat
    text: string
    onFormatChange: (format: PdfPageNumberFormat) => void
    onTextChange: (text: string) => void
}) {
    return (
        <>
            <Field>
                <FieldLabel>Right text</FieldLabel>
                <OptionSelect value={format} options={PAGE_NUMBER_OPTIONS} onChange={onFormatChange} />
            </Field>
            {format === 'custom' ? (
                <Field>
                    <FieldDescription>
                        Use {'{{page}}'}, {'{{total}}'}, {'{{title}}'} or {'{{date}}'} placeholders.
                    </FieldDescription>
                    <Input value={text} placeholder="e.g. Page {{page}} of {{total}}" onChange={(event) => onTextChange(event.target.value)} />
                </Field>
            ) : null}
        </>
    )
}
