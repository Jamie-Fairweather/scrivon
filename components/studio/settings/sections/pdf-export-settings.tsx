'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { APP_THEME_IDS, APP_THEME_LABELS } from '@/lib/theme/catalog'
import {
    createPdfExportProfile,
    deletePdfExportProfile,
    duplicatePdfExportProfile,
    getActivePdfExportProfile,
    renamePdfExportProfile,
    setActivePdfExportProfile,
    updatePdfExportProfile,
} from '@/lib/settings/pdf-export-profiles'
import { ensureFontOption, loadPdfExportFontOptions, PDF_EXPORT_FONT_OPTIONS, type PdfExportFontOption } from '@/lib/settings/pdf-export-fonts'
import { MAX_CHROME_HEIGHT_MM } from '@/lib/settings/pdf-export-normalize'
import type {
    PdfExportChromeSide,
    PdfExportProfile,
    PdfHideOnFirstPages,
    PdfNewPageFromHeading,
    PdfPageNumberFormat,
    PdfPageOrientation,
    PdfPageSize,
    PdfTocDepth,
} from '@/lib/settings/pdf-export-types'
import { ColorField } from '@/components/studio/settings/color-field'
import { PathField } from '@/components/studio/settings/path-field'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ShikiTheme } from '@/lib/markdown/shiki-highlighter'

function patchProfile(
    updateSettings: ReturnType<typeof useAppSettings>['updateSettings'],
    profileId: string,
    updater: (profile: PdfExportProfile) => PdfExportProfile
) {
    updateSettings((current) => ({
        ...current,
        pdfExport: updatePdfExportProfile(current.pdfExport, profileId, updater),
    }))
}

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
        <Select items={items} value={value} onValueChange={(next) => next && onChange(next)}>
            <SelectTrigger id={id}>
                <SelectValue />
            </SelectTrigger>
            <SelectPopup>
                {items.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                        <span style={{ fontFamily: option.value }}>{option.label}</span>
                    </SelectItem>
                ))}
            </SelectPopup>
        </Select>
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

    return (
        <div className="space-y-6">
            <Field>
                <FieldLabel htmlFor="pdf-profile">Profile</FieldLabel>
                <FieldDescription>Named export styles for branded PDFs.</FieldDescription>
                <div className="flex flex-wrap gap-2">
                    <Select
                        items={pdf.profiles.map((profile) => ({ label: profile.name, value: profile.id }))}
                        value={pdf.activeProfileId}
                        onValueChange={(value) => {
                            if (!value) return
                            updateSettings((current) => ({
                                ...current,
                                pdfExport: setActivePdfExportProfile(current.pdfExport, value),
                            }))
                        }}
                    >
                        <SelectTrigger id="pdf-profile" className="min-w-48 flex-1">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectPopup>
                            {pdf.profiles.map((profile) => (
                                <SelectItem key={profile.id} value={profile.id}>
                                    {profile.name}
                                </SelectItem>
                            ))}
                        </SelectPopup>
                    </Select>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => updateSettings((current) => ({ ...current, pdfExport: createPdfExportProfile(current.pdfExport) }))}
                    >
                        New
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            updateSettings((current) => ({
                                ...current,
                                pdfExport: duplicatePdfExportProfile(current.pdfExport, current.pdfExport.activeProfileId),
                            }))
                        }
                    >
                        Duplicate
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pdf.profiles.length <= 1}
                        onClick={() =>
                            updateSettings((current) => ({
                                ...current,
                                pdfExport: deletePdfExportProfile(current.pdfExport, current.pdfExport.activeProfileId),
                            }))
                        }
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
                    onChange={(event) =>
                        updateSettings((current) => ({
                            ...current,
                            pdfExport: renamePdfExportProfile(current.pdfExport, active.id, event.target.value),
                        }))
                    }
                />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                    <FieldLabel htmlFor="pdf-page-size">Page size</FieldLabel>
                    <Select
                        items={[
                            { label: 'A4', value: 'a4' },
                            { label: 'Letter', value: 'letter' },
                        ]}
                        value={active.page.size}
                        onValueChange={(value) => {
                            if (!value) return
                            patchProfile(updateSettings, active.id, (profile) => ({
                                ...profile,
                                page: { ...profile.page, size: value as PdfPageSize },
                            }))
                        }}
                    >
                        <SelectTrigger id="pdf-page-size">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectPopup>
                            <SelectItem value="a4">A4</SelectItem>
                            <SelectItem value="letter">Letter</SelectItem>
                        </SelectPopup>
                    </Select>
                </Field>
                <Field>
                    <FieldLabel htmlFor="pdf-orientation">Orientation</FieldLabel>
                    <Select
                        items={[
                            { label: 'Portrait', value: 'portrait' },
                            { label: 'Landscape', value: 'landscape' },
                        ]}
                        value={active.page.orientation}
                        onValueChange={(value) => {
                            if (!value) return
                            patchProfile(updateSettings, active.id, (profile) => ({
                                ...profile,
                                page: { ...profile.page, orientation: value as PdfPageOrientation },
                            }))
                        }}
                    >
                        <SelectTrigger id="pdf-orientation">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectPopup>
                            <SelectItem value="portrait">Portrait</SelectItem>
                            <SelectItem value="landscape">Landscape</SelectItem>
                        </SelectPopup>
                    </Select>
                </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <Field key={side}>
                        <FieldLabel htmlFor={`pdf-margin-${side}`}>Margin {side} (mm)</FieldLabel>
                        <NumberField
                            id={`pdf-margin-${side}`}
                            value={active.page.marginsMm[side]}
                            min={0}
                            max={50}
                            step={1}
                            onValueChange={(value) => {
                                if (value == null) return
                                patchProfile(updateSettings, active.id, (profile) => ({
                                    ...profile,
                                    page: {
                                        ...profile.page,
                                        marginsMm: { ...profile.page.marginsMm, [side]: value },
                                    },
                                }))
                            }}
                        >
                            <NumberFieldGroup>
                                <NumberFieldDecrement />
                                <NumberFieldInput />
                                <NumberFieldIncrement />
                            </NumberFieldGroup>
                        </NumberField>
                    </Field>
                ))}
            </div>

            <Field>
                <FieldLabel htmlFor="pdf-heading-font">Heading font</FieldLabel>
                <FontSelect
                    id="pdf-heading-font"
                    value={active.typography.headingFont}
                    options={fontOptions}
                    onChange={(headingFont) =>
                        patchProfile(updateSettings, active.id, (profile) => ({
                            ...profile,
                            typography: { ...profile.typography, headingFont },
                        }))
                    }
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="pdf-body-font">Body font</FieldLabel>
                <FontSelect
                    id="pdf-body-font"
                    value={active.typography.bodyFont}
                    options={fontOptions}
                    onChange={(bodyFont) =>
                        patchProfile(updateSettings, active.id, (profile) => ({
                            ...profile,
                            typography: { ...profile.typography, bodyFont },
                        }))
                    }
                />
            </Field>
            <Field>
                <FieldLabel htmlFor="pdf-mono-font">Monospace font</FieldLabel>
                <FontSelect
                    id="pdf-mono-font"
                    value={active.typography.monoFont}
                    options={fontOptions}
                    onChange={(monoFont) =>
                        patchProfile(updateSettings, active.id, (profile) => ({
                            ...profile,
                            typography: { ...profile.typography, monoFont },
                        }))
                    }
                />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                    <FieldLabel htmlFor="pdf-body-size">Body size (pt)</FieldLabel>
                    <NumberField
                        id="pdf-body-size"
                        value={active.typography.bodySizePt}
                        min={8}
                        max={24}
                        step={0.5}
                        onValueChange={(value) => {
                            if (value == null) return
                            patchProfile(updateSettings, active.id, (profile) => ({
                                ...profile,
                                typography: { ...profile.typography, bodySizePt: value },
                            }))
                        }}
                    >
                        <NumberFieldGroup>
                            <NumberFieldDecrement />
                            <NumberFieldInput />
                            <NumberFieldIncrement />
                        </NumberFieldGroup>
                    </NumberField>
                </Field>
                <Field>
                    <FieldLabel htmlFor="pdf-line-height">Line height</FieldLabel>
                    <NumberField
                        id="pdf-line-height"
                        value={active.typography.lineHeight}
                        min={1}
                        max={2.5}
                        step={0.1}
                        onValueChange={(value) => {
                            if (value == null) return
                            patchProfile(updateSettings, active.id, (profile) => ({
                                ...profile,
                                typography: { ...profile.typography, lineHeight: value },
                            }))
                        }}
                    >
                        <NumberFieldGroup>
                            <NumberFieldDecrement />
                            <NumberFieldInput />
                            <NumberFieldIncrement />
                        </NumberFieldGroup>
                    </NumberField>
                </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                    <FieldLabel htmlFor="pdf-accent">Brand colour</FieldLabel>
                    <ColorField
                        id="pdf-accent"
                        value={active.brand.accentColor}
                        onChange={(accentColor) =>
                            patchProfile(updateSettings, active.id, (profile) => ({
                                ...profile,
                                brand: { ...profile.brand, accentColor },
                            }))
                        }
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor="pdf-link">Link colour (optional)</FieldLabel>
                    <ColorField
                        id="pdf-link"
                        value={active.brand.linkColor}
                        placeholder="Falls back to brand"
                        allowEmpty
                        onChange={(linkColor) =>
                            patchProfile(updateSettings, active.id, (profile) => ({
                                ...profile,
                                brand: { ...profile.brand, linkColor },
                            }))
                        }
                    />
                </Field>
            </div>

            <Field>
                <FieldLabel htmlFor="pdf-logo">Title-page logo</FieldLabel>
                <PathField
                    id="pdf-logo"
                    value={active.brand.logoPath}
                    title="Choose title-page logo"
                    placeholder="Choose an image"
                    onChange={(logoPath) =>
                        patchProfile(updateSettings, active.id, (profile) => ({
                            ...profile,
                            brand: { ...profile.brand, logoPath },
                        }))
                    }
                />
            </Field>

            <Field>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <FieldLabel>Title-page image ignores margins</FieldLabel>
                        <FieldDescription>Stretch the image to the page edges as a full-bleed cover banner.</FieldDescription>
                    </div>
                    <Switch
                        checked={active.brand.logoIgnoreMargins}
                        onCheckedChange={(checked) =>
                            patchProfile(updateSettings, active.id, (profile) => ({
                                ...profile,
                                brand: { ...profile.brand, logoIgnoreMargins: checked === true },
                            }))
                        }
                    />
                </div>
            </Field>

            <Field>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <FieldLabel>Title page</FieldLabel>
                        <FieldDescription>Include a cover page with title metadata and logo.</FieldDescription>
                    </div>
                    <Switch
                        checked={active.frontMatter.titlePage}
                        onCheckedChange={(checked) =>
                            patchProfile(updateSettings, active.id, (profile) => ({
                                ...profile,
                                frontMatter: { ...profile.frontMatter, titlePage: checked === true },
                            }))
                        }
                    />
                </div>
            </Field>

            <Field>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <FieldLabel>Table of contents</FieldLabel>
                        <FieldDescription>Generate a TOC from headings.</FieldDescription>
                    </div>
                    <Switch
                        checked={active.frontMatter.toc}
                        onCheckedChange={(checked) =>
                            patchProfile(updateSettings, active.id, (profile) => ({
                                ...profile,
                                frontMatter: { ...profile.frontMatter, toc: checked === true },
                            }))
                        }
                    />
                </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                    <FieldLabel htmlFor="pdf-toc-depth">TOC depth</FieldLabel>
                    <Select
                        items={[
                            { label: 'H1', value: '1' },
                            { label: 'H1–H2', value: '2' },
                            { label: 'H1–H3', value: '3' },
                            { label: 'H1–H4', value: '4' },
                        ]}
                        value={String(active.frontMatter.tocDepth)}
                        onValueChange={(value) => {
                            if (!value) return
                            patchProfile(updateSettings, active.id, (profile) => ({
                                ...profile,
                                frontMatter: { ...profile.frontMatter, tocDepth: Number(value) as PdfTocDepth },
                            }))
                        }}
                    >
                        <SelectTrigger id="pdf-toc-depth">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectPopup>
                            <SelectItem value="1">H1</SelectItem>
                            <SelectItem value="2">H1–H2</SelectItem>
                            <SelectItem value="3">H1–H3</SelectItem>
                            <SelectItem value="4">H1–H4</SelectItem>
                        </SelectPopup>
                    </Select>
                </Field>
                <Field>
                    <div className="flex h-full items-center justify-between gap-4 pt-6">
                        <FieldLabel>Exclude H1 from TOC</FieldLabel>
                        <Switch
                            checked={active.frontMatter.tocExcludeH1}
                            onCheckedChange={(checked) =>
                                patchProfile(updateSettings, active.id, (profile) => ({
                                    ...profile,
                                    frontMatter: { ...profile.frontMatter, tocExcludeH1: checked === true },
                                }))
                            }
                        />
                    </div>
                </Field>
            </div>

            <ChromeFields
                title="Header"
                chrome={active.header}
                onChange={(header) => patchProfile(updateSettings, active.id, (profile) => ({ ...profile, header }))}
            />
            <ChromeFields
                title="Footer"
                chrome={active.footer}
                showPageNumbers
                onChange={(footer) => patchProfile(updateSettings, active.id, (profile) => ({ ...profile, footer }))}
            />

            <Field>
                <FieldLabel htmlFor="pdf-new-page-heading">New page from heading</FieldLabel>
                <FieldDescription>That level and every heading above it start on a fresh page.</FieldDescription>
                <Select
                    items={[
                        { label: 'Off', value: '0' },
                        { label: 'H1', value: '1' },
                        { label: 'H2 and above', value: '2' },
                        { label: 'H3 and above', value: '3' },
                        { label: 'H4 and above', value: '4' },
                        { label: 'H5 and above', value: '5' },
                        { label: 'H6 and above', value: '6' },
                    ]}
                    value={String(active.flow.newPageFromHeading)}
                    onValueChange={(value) => {
                        if (!value) return
                        const level = Number(value) as PdfNewPageFromHeading
                        patchProfile(updateSettings, active.id, (profile) => ({
                            ...profile,
                            flow: { newPageFromHeading: level },
                        }))
                    }}
                >
                    <SelectTrigger id="pdf-new-page-heading">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                        <SelectItem value="0">Off</SelectItem>
                        <SelectItem value="1">H1</SelectItem>
                        <SelectItem value="2">H2 and above</SelectItem>
                        <SelectItem value="3">H3 and above</SelectItem>
                        <SelectItem value="4">H4 and above</SelectItem>
                        <SelectItem value="5">H5 and above</SelectItem>
                        <SelectItem value="6">H6 and above</SelectItem>
                    </SelectPopup>
                </Select>
            </Field>

            <Field>
                <FieldLabel htmlFor="pdf-code-theme">Code theme</FieldLabel>
                <Select
                    items={[
                        { label: 'GitHub Light', value: 'github-light' },
                        { label: 'GitHub Dark', value: 'github-dark' },
                    ]}
                    value={active.content.codeTheme}
                    onValueChange={(value) => {
                        if (!value) return
                        patchProfile(updateSettings, active.id, (profile) => ({
                            ...profile,
                            content: { ...profile.content, codeTheme: value as ShikiTheme },
                        }))
                    }}
                >
                    <SelectTrigger id="pdf-code-theme">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                        <SelectItem value="github-light">GitHub Light</SelectItem>
                        <SelectItem value="github-dark">GitHub Dark</SelectItem>
                    </SelectPopup>
                </Select>
            </Field>

            <Field>
                <FieldLabel htmlFor="pdf-mermaid-theme">Diagram theme</FieldLabel>
                <Select
                    items={APP_THEME_IDS.map((id) => ({ label: APP_THEME_LABELS[id], value: id }))}
                    value={active.content.mermaidThemeId}
                    onValueChange={(value) => {
                        if (!value) return
                        patchProfile(updateSettings, active.id, (profile) => ({
                            ...profile,
                            content: { ...profile.content, mermaidThemeId: value as PdfExportProfile['content']['mermaidThemeId'] },
                        }))
                    }}
                >
                    <SelectTrigger id="pdf-mermaid-theme">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                        {APP_THEME_IDS.map((id) => (
                            <SelectItem key={id} value={id}>
                                {APP_THEME_LABELS[id]}
                            </SelectItem>
                        ))}
                    </SelectPopup>
                </Select>
            </Field>

            <Field>
                <FieldLabel htmlFor="pdf-watermark">Watermark</FieldLabel>
                <Input
                    id="pdf-watermark"
                    value={active.content.watermark}
                    placeholder="e.g. DRAFT"
                    onChange={(event) =>
                        patchProfile(updateSettings, active.id, (profile) => ({
                            ...profile,
                            content: { ...profile.content, watermark: event.target.value },
                        }))
                    }
                />
            </Field>
        </div>
    )
}

function ChromeFields<T extends PdfExportProfile['header'] | PdfExportProfile['footer']>({
    title,
    chrome,
    showPageNumbers,
    onChange,
}: {
    title: string
    chrome: T
    showPageNumbers?: boolean
    onChange: (chrome: T) => void
}) {
    return (
        <div className="space-y-4 rounded-lg border border-border p-3">
            <Field>
                <div className="flex items-center justify-between gap-4">
                    <FieldLabel>{title}</FieldLabel>
                    <Switch checked={chrome.enabled} onCheckedChange={(checked) => onChange({ ...chrome, enabled: checked === true })} />
                </div>
            </Field>
            <p className="text-sm text-muted-foreground">Images always sit outermost, nearest the page edge.</p>
            <div className="grid gap-4 sm:grid-cols-2">
                <ChromeSideFields side="Left" title={title} value={chrome.left} onChange={(left) => onChange({ ...chrome, left })} />
                <ChromeSideFields
                    side="Right"
                    title={title}
                    value={chrome.right}
                    onChange={(right) => onChange({ ...chrome, right })}
                    text={
                        showPageNumbers && 'pageNumbers' in chrome ? (
                            <FooterRightText
                                format={chrome.pageNumbers}
                                text={chrome.right.text}
                                onFormatChange={(pageNumbers) => onChange({ ...chrome, pageNumbers })}
                                onTextChange={(text) => onChange({ ...chrome, right: { ...chrome.right, text } })}
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
                        onChange={(backgroundColor) => onChange({ ...chrome, backgroundColor })}
                    />
                </Field>
                <Field>
                    <FieldLabel>Font colour</FieldLabel>
                    <ColorField
                        value={chrome.textColor}
                        placeholder="Default"
                        allowEmpty
                        onChange={(textColor) => onChange({ ...chrome, textColor })}
                    />
                </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                    <FieldLabel>Height (mm)</FieldLabel>
                    <FieldDescription>0 fits the content.</FieldDescription>
                    <NumberField
                        value={chrome.heightMm}
                        min={0}
                        max={MAX_CHROME_HEIGHT_MM}
                        step={1}
                        onValueChange={(value) => {
                            if (value == null) return
                            onChange({ ...chrome, heightMm: value })
                        }}
                    >
                        <NumberFieldGroup>
                            <NumberFieldDecrement />
                            <NumberFieldInput />
                            <NumberFieldIncrement />
                        </NumberFieldGroup>
                    </NumberField>
                </Field>
                <Field>
                    <FieldLabel>Gap to content (mm)</FieldLabel>
                    <FieldDescription>Space between the {title.toLowerCase()} and the body.</FieldDescription>
                    <NumberField
                        value={chrome.gapMm}
                        min={0}
                        max={MAX_CHROME_HEIGHT_MM}
                        step={1}
                        onValueChange={(value) => {
                            if (value == null) return
                            onChange({ ...chrome, gapMm: value })
                        }}
                    >
                        <NumberFieldGroup>
                            <NumberFieldDecrement />
                            <NumberFieldInput />
                            <NumberFieldIncrement />
                        </NumberFieldGroup>
                    </NumberField>
                </Field>
            </div>
            <Field>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <FieldLabel>Ignore margins</FieldLabel>
                        <FieldDescription>Bleed to the page edge.</FieldDescription>
                    </div>
                    <Switch checked={chrome.ignoreMargins} onCheckedChange={(checked) => onChange({ ...chrome, ignoreMargins: checked === true })} />
                </div>
            </Field>
            <Field>
                <FieldLabel>Hide on</FieldLabel>
                <Select
                    items={[
                        { label: 'None', value: 'none' },
                        { label: 'Title page', value: 'title' },
                        { label: 'Title page + TOC', value: 'title+toc' },
                    ]}
                    value={chrome.hideOnFirstPages}
                    onValueChange={(value) => {
                        if (!value) return
                        onChange({ ...chrome, hideOnFirstPages: value as PdfHideOnFirstPages })
                    }}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="title">Title page</SelectItem>
                        <SelectItem value="title+toc">Title page + TOC</SelectItem>
                    </SelectPopup>
                </Select>
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
                <PathField
                    value={value.imagePath}
                    title={`Choose ${title.toLowerCase()} ${side.toLowerCase()} image`}
                    placeholder="Choose an image"
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

const PAGE_NUMBER_OPTIONS: { label: string; value: PdfPageNumberFormat }[] = [
    { label: 'None', value: 'none' },
    { label: 'Number', value: 'number' },
    { label: 'Page N', value: 'page-n' },
    { label: 'N / total', value: 'n-of-total' },
    { label: 'Custom text', value: 'custom' },
]

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
                <Select
                    items={PAGE_NUMBER_OPTIONS}
                    value={format}
                    onValueChange={(value) => {
                        if (value) onFormatChange(value as PdfPageNumberFormat)
                    }}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                        {PAGE_NUMBER_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectPopup>
                </Select>
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
