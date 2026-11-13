'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { APP_THEME_IDS, APP_THEME_LABELS, type AppThemeId } from '@/lib/theme/catalog'
import {
    createPdfExportProfile,
    deletePdfExportProfile,
    duplicatePdfExportProfile,
    getActivePdfExportProfile,
    otherProfileNamed,
    PDF_MIN_BODY_HEIGHT_MM,
    pdfBodyHeightMm,
    renamePdfExportProfile,
    setActivePdfExportProfile,
    updatePdfExportProfile,
} from '@/lib/settings/pdf-export-profiles'
import { PDF_EXPORT_LIMITS } from '@/lib/settings/pdf-export-defaults'
import {
    cachedPdfExportFontOptions,
    ensureFontOption,
    fontOptionsForSlot,
    groupFontOptions,
    isSymbolFont,
    loadPdfExportFontOptionsOnce,
    matchFontOption,
    PDF_EXPORT_FONT_OPTIONS,
    type PdfExportFontGroup,
    type PdfExportFontOption,
    type PdfExportFontSlot,
} from '@/lib/settings/pdf-export-fonts'
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
import { resolvePdfExportLayout } from '@/lib/markdown/export-html-css'
import type { ShikiTheme } from '@/lib/markdown/shiki-highlighter'
import { isWindowsTauri } from '@/lib/tauri/platform'
import { ColorField } from '@/components/studio/settings/color-field'
import { ImagePathField } from '@/components/studio/settings/image-path-field'
import { NumberSetting } from '@/components/studio/settings/number-setting'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { SwitchSetting } from '@/components/studio/settings/switch-setting'
import {
    AlertDialog,
    AlertDialogClose,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogPopup,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
    Combobox,
    ComboboxCollection,
    ComboboxEmpty,
    ComboboxGroup,
    ComboboxGroupLabel,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxPopup,
} from '@/components/ui/combobox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Fieldset, FieldsetLegend } from '@/components/ui/fieldset'
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
    slot,
    value,
    options,
    onChange,
}: {
    id: string
    slot: PdfExportFontSlot
    value: string
    options: PdfExportFontOption[]
    onChange: (value: string) => void
}) {
    // A new list (the system fonts finishing loading) gives every option a new identity, and
    // the combobox then puts the saved font's name back in the box, over what was being
    // typed. So while the box is in use it keeps the list it had; the new one comes after.
    const [open, setOpen] = useState(false)
    const [focused, setFocused] = useState(false)
    const [shownOptions, setShownOptions] = useState(options)
    if (!open && !focused && shownOptions !== options) setShownOptions(options)
    const slotOptions = useMemo(() => fontOptionsForSlot(shownOptions, slot), [shownOptions, slot])
    // Checked against the whole list: a saved font the Monospace picker leaves out may still be installed.
    const items = useMemo(() => ensureFontOption(slotOptions, value, shownOptions), [slotOptions, value, shownOptions])
    const groups = useMemo(() => groupFontOptions(items), [items])
    return (
        <Combobox
            items={groups}
            onOpenChange={setOpen}
            value={matchFontOption(items, value) ?? null}
            onValueChange={(option) => {
                if (option) onChange(option.value)
            }}
            itemToStringLabel={(option) => option.label}
            itemToStringValue={(option) => option.value}
            isItemEqualToValue={(option, selected) => option.value === selected.value}
        >
            <ComboboxInput id={id} placeholder="Search fonts" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
            <ComboboxPopup>
                <ComboboxEmpty>No matching fonts.</ComboboxEmpty>
                <ComboboxList>
                    {(group: PdfExportFontGroup) => (
                        <ComboboxGroup key={group.value} items={group.items}>
                            <ComboboxGroupLabel>{group.value}</ComboboxGroupLabel>
                            <ComboboxCollection>
                                {(option: PdfExportFontOption) => (
                                    <ComboboxItem key={option.value} value={option}>
                                        {/* Each font previews itself, except icon fonts, whose names would be unreadable. */}
                                        <span style={isSymbolFont(option.label) ? undefined : { fontFamily: option.value }}>{option.label}</span>
                                    </ComboboxItem>
                                )}
                            </ComboboxCollection>
                        </ComboboxGroup>
                    )}
                </ComboboxList>
            </ComboboxPopup>
        </Combobox>
    )
}

/**
 * Shows exactly what is typed while editing (trailing spaces, an empty box) and saves
 * each non-empty value; the saved name is trimmed. Leaving the box empty puts back the
 * name it had when you started, and Escape cancels the rename the same way.
 */
function ProfileNameInput({ id, ref, name, onRename }: { id: string; ref?: Ref<HTMLInputElement>; name: string; onRename: (name: string) => void }) {
    const [draft, setDraft] = useState<string | null>(null)
    // The name when the box got focus. Every non-empty keystroke is saved, so after
    // backspacing to nothing the saved name is the first letter, not the original.
    const nameAtFocus = useRef(name)
    return (
        <Input
            id={id}
            ref={ref}
            value={draft ?? name}
            onFocus={() => {
                nameAtFocus.current = name
            }}
            onChange={(event) => {
                const next = event.target.value
                setDraft(next)
                if (next.trim()) onRename(next)
            }}
            onBlur={() => {
                if (draft !== null && !draft.trim()) onRename(nameAtFocus.current)
                setDraft(null)
            }}
            onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape' && draft !== null) {
                    // Cancel just the rename and stay in the box; a second Escape closes Settings as usual.
                    event.stopPropagation()
                    onRename(nameAtFocus.current)
                    setDraft(null)
                }
            }}
        />
    )
}

/** Delete asks first: a profile holds a lot of hand-tuned settings and there is no undo. */
function DeleteProfileButton({
    profile,
    disabled,
    fallbackFocusId,
    onDelete,
}: {
    profile: PdfExportProfile
    disabled: boolean
    /** Gets focus after a delete leaves Delete disabled, since focus can't go back to it. */
    fallbackFocusId: string
    onDelete: (id: string) => void
}) {
    // Remember the profile when the dialog opens, so the one named is the one deleted
    // (and the title doesn't switch to the next profile while the dialog closes).
    const [target, setTarget] = useState({ id: profile.id, name: profile.name })
    const triggerRef = useRef<HTMLButtonElement>(null)
    return (
        <AlertDialog
            onOpenChange={(open) => {
                if (open) setTarget({ id: profile.id, name: profile.name })
            }}
        >
            <AlertDialogTrigger ref={triggerRef} render={<Button type="button" variant="destructive-outline" size="sm" disabled={disabled} />}>
                Delete
            </AlertDialogTrigger>
            <AlertDialogPopup
                // Deleting the second-last profile disables Delete, and focus would drop out of
                // Settings; send it to the profile picker instead so keyboard users keep their place.
                finalFocus={() => (triggerRef.current?.disabled ? document.getElementById(fallbackFocusId) : true)}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>{`Delete profile "${target.name}"?`}</AlertDialogTitle>
                    <AlertDialogDescription>
                        This removes its page, font, colour, cover image and header/footer settings. This cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogClose render={<Button type="button" variant="outline" />}>Cancel</AlertDialogClose>
                    <AlertDialogClose render={<Button type="button" variant="destructive" />} onClick={() => onDelete(target.id)}>
                        Delete profile
                    </AlertDialogClose>
                </AlertDialogFooter>
            </AlertDialogPopup>
        </AlertDialog>
    )
}

export function PdfExportSettings() {
    const { settings, updateSettings } = useAppSettings()
    const pdf = settings.pdfExport
    const active = getActivePdfExportProfile(pdf)
    const [fontOptions, setFontOptions] = useState<PdfExportFontOption[]>(() => cachedPdfExportFontOptions() ?? PDF_EXPORT_FONT_OPTIONS)

    useEffect(() => {
        let cancelled = false
        void loadPdfExportFontOptionsOnce().then((options) => {
            if (!cancelled) setFontOptions(options)
        })
        return () => {
            cancelled = true
        }
    }, [])

    const nameInputRef = useRef<HTMLInputElement>(null)
    // Set by New and Duplicate: once the new profile is active, focus and select its
    // name so the user can type over the generated one straight away.
    const focusNameRef = useRef(false)
    useEffect(() => {
        if (!focusNameRef.current) return
        focusNameRef.current = false
        nameInputRef.current?.focus()
        nameInputRef.current?.select()
    }, [active.id])

    const setPdf = (update: (pdf: PdfExportSettingsValue) => PdfExportSettingsValue) =>
        updateSettings((current) => ({ ...current, pdfExport: update(current.pdfExport) }))
    const addProfile = (update: (pdf: PdfExportSettingsValue) => PdfExportSettingsValue) => {
        focusNameRef.current = true
        setPdf(update)
    }
    const patch = (update: (profile: PdfExportProfile) => PdfExportProfile) => setPdf((current) => updatePdfExportProfile(current, active.id, update))
    /** Merge `changes` into one section of the active profile. */
    const setSection = <K extends ProfileSection>(key: K, changes: Partial<PdfExportProfile[K]>) =>
        patch((profile) => ({ ...profile, [key]: { ...profile[key], ...changes } }))

    const layout = resolvePdfExportLayout(active)
    const bodyHeightMm = pdfBodyHeightMm(active)
    // New and Duplicate pick unique names, but a rename can still copy another profile's.
    const twin = otherProfileNamed(pdf.profiles, active.id, active.name)

    return (
        <div className="space-y-8">
            <div className="space-y-6">
                <Field>
                    <FieldLabel htmlFor="pdf-profile">Default export profile</FieldLabel>
                    <FieldDescription>
                        Styles for both PDF and Word export. The Export dialog starts with this profile, and you can pick another there for one
                        export.
                    </FieldDescription>
                    <div className="flex flex-wrap gap-2">
                        <OptionSelect
                            id="pdf-profile"
                            className="min-w-48 flex-1"
                            value={pdf.activeProfileId}
                            options={pdf.profiles.map((profile) => ({ label: profile.name, value: profile.id }))}
                            onChange={(id) => setPdf((current) => setActivePdfExportProfile(current, id))}
                        />
                        <Button type="button" variant="outline" size="sm" onClick={() => addProfile((current) => createPdfExportProfile(current))}>
                            New
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => addProfile((current) => duplicatePdfExportProfile(current, current.activeProfileId))}
                        >
                            Duplicate
                        </Button>
                        <DeleteProfileButton
                            profile={active}
                            disabled={pdf.profiles.length <= 1}
                            fallbackFocusId="pdf-profile"
                            onDelete={(id) => setPdf((current) => deletePdfExportProfile(current, id))}
                        />
                    </div>
                </Field>

                <Field>
                    <FieldLabel htmlFor="pdf-profile-name">Profile name</FieldLabel>
                    <ProfileNameInput
                        id="pdf-profile-name"
                        ref={nameInputRef}
                        name={active.name}
                        onRename={(name) => setPdf((current) => renamePdfExportProfile(current, active.id, name))}
                    />
                    {twin ? (
                        // A description, so screen readers read it with the box.
                        <FieldDescription className="text-warning-foreground">{`Another profile is already called "${twin.name}".`}</FieldDescription>
                    ) : null}
                </Field>
            </div>

            <SettingsGroup title="Page">
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
                                patch((profile) => ({
                                    ...profile,
                                    page: { ...profile.page, marginsMm: { ...profile.page.marginsMm, [side]: value } },
                                }))
                            }
                        />
                    ))}
                </div>
                <PageSpaceWarning bodyHeightMm={bodyHeightMm} />
            </SettingsGroup>

            <SettingsGroup title="Text">
                <Field>
                    <FieldLabel htmlFor="pdf-heading-font">Heading font</FieldLabel>
                    <FontSelect
                        id="pdf-heading-font"
                        slot="heading"
                        value={active.typography.headingFont}
                        options={fontOptions}
                        onChange={(headingFont) => setSection('typography', { headingFont })}
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor="pdf-body-font">Body font</FieldLabel>
                    <FontSelect
                        id="pdf-body-font"
                        slot="body"
                        value={active.typography.bodyFont}
                        options={fontOptions}
                        onChange={(bodyFont) => setSection('typography', { bodyFont })}
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor="pdf-mono-font">Monospace font</FieldLabel>
                    <FontSelect
                        id="pdf-mono-font"
                        slot="mono"
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
            </SettingsGroup>

            <SettingsGroup title="Colours">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                        <FieldLabel htmlFor="pdf-accent">Brand colour</FieldLabel>
                        <ColorField
                            id="pdf-accent"
                            value={active.brand.accentColor}
                            onChange={(accentColor) => setSection('brand', { accentColor })}
                        />
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
            </SettingsGroup>

            <SettingsGroup title="Title page">
                <SwitchSetting
                    label="Include a title page"
                    description="A cover page with the title, subtitle, author, date and cover image."
                    checked={active.frontMatter.titlePage}
                    onChange={(titlePage) => setSection('frontMatter', { titlePage })}
                />
                <DependentFields enabled={active.frontMatter.titlePage}>
                    <Field>
                        <FieldLabel htmlFor="pdf-logo">Cover image</FieldLabel>
                        <ImagePathField
                            id="pdf-logo"
                            value={active.brand.logoPath}
                            label="cover image"
                            onChange={(logoPath) => setSection('brand', { logoPath })}
                        />
                    </Field>
                    <SwitchSetting
                        label="Cover image ignores margins"
                        description="Stretch the image to the page edges as a full-bleed banner."
                        checked={active.brand.logoIgnoreMargins}
                        onChange={(logoIgnoreMargins) => setSection('brand', { logoIgnoreMargins })}
                    />
                </DependentFields>
            </SettingsGroup>

            <SettingsGroup title="Table of contents">
                <SwitchSetting
                    label="Include a table of contents"
                    description="Built from the document's headings."
                    checked={active.frontMatter.toc}
                    onChange={(toc) => setSection('frontMatter', { toc })}
                />
                <DependentFields enabled={active.frontMatter.toc}>
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
                    {active.frontMatter.toc && active.frontMatter.tocDepth === 1 && active.frontMatter.tocExcludeH1 ? (
                        <SettingsWarning>
                            With TOC depth H1 and Exclude H1 on, no headings are left, so no table of contents is added.
                        </SettingsWarning>
                    ) : null}
                </DependentFields>
            </SettingsGroup>

            <ChromeFields
                title="Header"
                chrome={active.header}
                drawn={layout.showHeader}
                bodyHeightMm={bodyHeightMm}
                onChange={(header) => setSection('header', header)}
            />
            <ChromeFields
                title="Footer"
                chrome={active.footer}
                drawn={layout.showFooter}
                bodyHeightMm={bodyHeightMm}
                onChange={(footer) => setSection('footer', footer)}
            />

            <SettingsGroup title="Content">
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
            </SettingsGroup>
        </div>
    )
}

/** A titled group of settings; the title names the group for screen readers too. */
function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
    return (
        <Fieldset className="min-w-0 space-y-4 border-t border-border pt-6">
            <FieldsetLegend className="text-base sm:text-sm">{title}</FieldsetLegend>
            {children}
        </Fieldset>
    )
}

/**
 * Settings that only matter while a switch is on. When `enabled` is false every
 * control inside is disabled (Base UI fields through context, plain buttons and
 * inputs through the native fieldset) and greyed out.
 */
function DependentFields({ enabled, children }: { enabled: boolean; children: ReactNode }) {
    return (
        <Fieldset disabled={!enabled} render={<fieldset disabled={!enabled} />} className="min-w-0 space-y-4">
            {children}
        </Fieldset>
    )
}

/** A short note under settings that won't give the result the user probably expects. */
function SettingsWarning({ children }: { children: ReactNode }) {
    return <p className="text-xs text-warning-foreground">{children}</p>
}

/** Warns when the margins and header/footer leave little or no page height for the text. */
function PageSpaceWarning({ bodyHeightMm }: { bodyHeightMm: number }) {
    if (bodyHeightMm >= PDF_MIN_BODY_HEIGHT_MM) return null
    return (
        <SettingsWarning>
            {bodyHeightMm <= 0
                ? 'Margins, header and footer are taller than the page, so there is no room left for the text.'
                : `Margins, header and footer leave only ${Math.floor(bodyHeightMm)} mm of page height for the text.`}
        </SettingsWarning>
    )
}

function ChromeFields({
    title,
    chrome,
    drawn,
    bodyHeightMm,
    onChange,
}: {
    title: string
    chrome: PdfExportChrome | PdfExportFooter
    /**
     * Whether the export draws this bar at all. A switched-off footer still prints its page
     * numbers, and "Hide on" still applies to them, but none of its other fields do.
     */
    drawn: boolean
    /** Page height left for the text, for the warning next to this bar's size fields. */
    bodyHeightMm: number
    /** Only the footer ever receives `pageNumbers`. */
    onChange: (changes: Partial<PdfExportFooter>) => void
}) {
    const lower = title.toLowerCase()
    const footer = 'pageNumbers' in chrome ? chrome : null
    return (
        <SettingsGroup title={title}>
            <SwitchSetting
                label={`Show ${lower}`}
                description={footer ? "Page numbers still print when this is off; the rest of the footer doesn't." : undefined}
                checked={chrome.enabled}
                onChange={(enabled) => onChange({ enabled })}
            />
            {footer ? (
                <>
                    <FooterPageNumbers
                        format={footer.pageNumbers}
                        text={footer.right.text}
                        onFormatChange={(pageNumbers) => onChange({ pageNumbers })}
                        onTextChange={(text) => onChange({ right: { ...footer.right, text } })}
                    />
                    <SwitchSetting
                        label="Number pages from the body"
                        description="Page 1 is the first page after the title page and contents. Also used for the contents page and Word."
                        checked={footer.numberFromBody}
                        onChange={(numberFromBody) => onChange({ numberFromBody })}
                    />
                </>
            ) : null}
            <DependentFields enabled={chrome.enabled}>
                <p className="text-sm text-muted-foreground">Images always sit outermost, nearest the page edge.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                    <ChromeSideFields side="Left" title={title} value={chrome.left} onChange={(left) => onChange({ left })} />
                    <ChromeSideFields
                        side="Right"
                        title={title}
                        value={chrome.right}
                        // The footer's right-hand text is the page counter above.
                        showText={!footer}
                        onChange={(right) => onChange({ right })}
                    />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                        <FieldLabel htmlFor={`pdf-${lower}-bg`}>Background colour</FieldLabel>
                        <ColorField
                            id={`pdf-${lower}-bg`}
                            value={chrome.backgroundColor}
                            placeholder="Transparent"
                            allowEmpty
                            onChange={(backgroundColor) => onChange({ backgroundColor })}
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor={`pdf-${lower}-text`}>Font colour</FieldLabel>
                        <ColorField
                            id={`pdf-${lower}-text`}
                            value={chrome.textColor}
                            placeholder="Default"
                            allowEmpty
                            onChange={(textColor) => onChange({ textColor })}
                        />
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
                {chrome.enabled ? <PageSpaceWarning bodyHeightMm={bodyHeightMm} /> : null}
                <SwitchSetting
                    label="Ignore margins"
                    description="Bleed to the page edge."
                    checked={chrome.ignoreMargins}
                    onChange={(ignoreMargins) => onChange({ ignoreMargins })}
                />
            </DependentFields>
            <DependentFields enabled={drawn}>
                <Field>
                    <FieldLabel>Hide on</FieldLabel>
                    <OptionSelect
                        value={chrome.hideOnFirstPages}
                        options={HIDE_ON_OPTIONS}
                        onChange={(hideOnFirstPages) => onChange({ hideOnFirstPages })}
                    />
                </Field>
            </DependentFields>
        </SettingsGroup>
    )
}

const PLACEHOLDER_HINT = 'Use {{title}}, {{subtitle}}, {{author}} or {{date}} (today if no date is set).'

/**
 * The stamper draws the text between the counters in the footer's own font when that font has
 * every letter of every page's label. The export draws a sample of the label's letters inside
 * the footer marker (`pdfStampGlyphText`) so the font holds them, unless the font has no such
 * letter at all. Otherwise it uses Helvetica, where anything outside Latin prints as `?`, and it
 * always does for scripts that need shaping (Arabic, Hebrew, Indic).
 */
const PAGE_NUMBER_TEXT_HINT =
    'Use {{page}}, {{total}}, {{title}}, {{subtitle}}, {{author}} or {{date}}. Between {{page}} and {{total}}, Arabic, Hebrew, Hindi and letters the footer font lacks print as ?.'

function ChromeSideFields({
    side,
    title,
    value,
    showText = true,
    onChange,
}: {
    side: 'Left' | 'Right'
    title: string
    value: PdfExportChromeSide
    showText?: boolean
    onChange: (value: PdfExportChromeSide) => void
}) {
    return (
        <div className="space-y-3">
            <Field>
                <FieldLabel>{side} image</FieldLabel>
                <ImagePathField
                    value={value.imagePath}
                    label={`${title.toLowerCase()} ${side.toLowerCase()} image`}
                    onChange={(imagePath) => onChange({ ...value, imagePath })}
                />
            </Field>
            {showText ? (
                <Field>
                    <FieldLabel>{side} text</FieldLabel>
                    <FieldDescription>{PLACEHOLDER_HINT}</FieldDescription>
                    <Input value={value.text} onChange={(event) => onChange({ ...value, text: event.target.value })} />
                </Field>
            ) : null}
        </div>
    )
}

function FooterPageNumbers({
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
                <FieldLabel>Page numbers</FieldLabel>
                <FieldDescription>Shown on the right of the footer.</FieldDescription>
                {/* Only the Windows app stamps numbers into the PDF; elsewhere the print dialog draws what it can. */}
                {isWindowsTauri() ? null : (
                    <FieldDescription>
                        Outside the Windows app, the table of contents has no page numbers and footer numbers may not print.
                    </FieldDescription>
                )}
                <OptionSelect value={format} options={PAGE_NUMBER_OPTIONS} onChange={onFormatChange} />
            </Field>
            {format === 'custom' ? (
                <Field>
                    <FieldLabel>Custom text</FieldLabel>
                    <FieldDescription>{PAGE_NUMBER_TEXT_HINT}</FieldDescription>
                    <Input value={text} placeholder="e.g. Page {{page}} of {{total}}" onChange={(event) => onTextChange(event.target.value)} />
                </Field>
            ) : null}
        </>
    )
}
