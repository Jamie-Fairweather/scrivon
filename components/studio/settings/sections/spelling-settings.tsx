'use client'

import { X } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Fieldset, FieldsetLegend } from '@/components/ui/fieldset'
import { OptionSelect, type SelectOption } from '@/components/ui/option-select'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { SwitchSetting } from '@/components/studio/settings/switch-setting'
import { SPELLCHECK_LANGUAGES, type SpellcheckLanguage } from '@/lib/spellcheck/languages'
import { withoutDictionaryWord, type SpellcheckSettings } from '@/lib/spellcheck/spellcheck-settings'

const LANGUAGE_OPTIONS: SelectOption<SpellcheckLanguage>[] = SPELLCHECK_LANGUAGES.map(({ id, label }) => ({ value: id, label }))

/** Spell check settings: on or off, the dictionary's language, and the words the user added. */
export function SpellingSettings() {
    const { settings, updateSettings } = useAppSettings()
    const spelling = settings.spellcheck
    const dictionaryId = useId()
    const setSpelling = (changes: Partial<SpellcheckSettings>) =>
        updateSettings((current) => ({ ...current, spellcheck: { ...current.spellcheck, ...changes } }))
    const words = [...spelling.words].sort((a, b) => a.localeCompare(b))

    return (
        <Fieldset className="min-w-0 space-y-6 border-t border-border pt-6">
            <FieldsetLegend className="text-base sm:text-sm">Spelling</FieldsetLegend>

            <SwitchSetting
                label="Check spelling"
                description="Underline spelling mistakes in Markdown files. Code, links and front matter are skipped."
                checked={spelling.enabled}
                onChange={(enabled) => setSpelling({ enabled })}
            />

            <Field>
                <FieldLabel htmlFor="spelling-language">Spelling language</FieldLabel>
                <OptionSelect
                    id="spelling-language"
                    className="w-40"
                    value={spelling.language}
                    options={LANGUAGE_OPTIONS}
                    onChange={(language) => setSpelling({ language })}
                />
            </Field>

            <Field>
                <FieldLabel id={dictionaryId}>Your dictionary</FieldLabel>
                {words.length === 0 ? (
                    <FieldDescription>No words yet. Right-click an underlined word and choose Add to Dictionary.</FieldDescription>
                ) : (
                    <ul aria-labelledby={dictionaryId} className="flex max-h-48 w-full flex-wrap gap-1.5 overflow-y-auto">
                        {words.map((word) => (
                            <li key={word} className="flex items-center gap-0.5 rounded-md border border-border py-0.5 pr-0.5 pl-2 text-sm">
                                {word}
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`Remove “${word}”`}
                                    onClick={() => setSpelling({ words: withoutDictionaryWord(spelling.words, word) })}
                                >
                                    <X aria-hidden />
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </Field>
        </Fieldset>
    )
}
