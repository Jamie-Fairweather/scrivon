/** The dictionaries the spell check can use. */
export type SpellcheckLanguage = 'en-US' | 'en-GB'

export const SPELLCHECK_LANGUAGES: readonly { id: SpellcheckLanguage; label: string }[] = [
    { id: 'en-US', label: 'English (US)' },
    { id: 'en-GB', label: 'English (UK)' },
]

export function isSpellcheckLanguage(value: unknown): value is SpellcheckLanguage {
    return SPELLCHECK_LANGUAGES.some((language) => language.id === value)
}
