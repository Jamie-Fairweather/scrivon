import { isSpellcheckLanguage, type SpellcheckLanguage } from '@/lib/spellcheck/languages'

export type SpellcheckSettings = {
    /** Underline spelling mistakes in Markdown files. */
    enabled: boolean
    language: SpellcheckLanguage
    /** The user's own dictionary: words added with Add to Dictionary. */
    words: string[]
}

/** Longer than any real word, so a pasted paragraph can't become one. */
const MAX_WORD_LENGTH = 64
const MAX_WORDS = 10_000
/** Places whose English is spelt the British way. */
const BRITISH_SPELLING = /^en-(?:GB|IE|AU|NZ|ZA|IN)\b/i

function systemLanguages(): readonly string[] {
    if (typeof navigator === 'undefined') return []
    return navigator.languages?.length ? navigator.languages : [navigator.language ?? '']
}

/** The system's first English, spelt the British or the American way (American when it has none). */
export function defaultSpellcheckLanguage(languages: readonly string[] = systemLanguages()): SpellcheckLanguage {
    const english = languages.find((language) => /^en\b/i.test(language))
    return english && BRITISH_SPELLING.test(english) ? 'en-GB' : 'en-US'
}

export function createDefaultSpellcheckSettings(): SpellcheckSettings {
    return { enabled: true, language: defaultSpellcheckLanguage(), words: [] }
}

/** The word to add for a misspelling: without a possessive 's, and with a plain apostrophe. */
export function dictionaryForm(word: string): string {
    return word.replace(/’/g, "'").replace(/'s$/i, '')
}

function isUsableWord(word: unknown): word is string {
    return typeof word === 'string' && word.length > 0 && word.length <= MAX_WORD_LENGTH && !/\s/.test(word)
}

/** The words with this one added (as {@link dictionaryForm} writes it), or the same list when there's nothing to add. */
export function withDictionaryWord(words: string[], word: string): string[] {
    const added = dictionaryForm(word.trim())
    if (!isUsableWord(added) || words.includes(added) || words.length >= MAX_WORDS) return words
    return [...words, added]
}

export function withoutDictionaryWord(words: string[], word: string): string[] {
    return words.filter((existing) => existing !== word)
}

/** Saved spelling settings, with anything unusable replaced by its default. */
export function normalizeSpellcheckSettings(raw: unknown, defaults: SpellcheckSettings): SpellcheckSettings {
    const source = typeof raw === 'object' && raw !== null ? (raw as Partial<Record<keyof SpellcheckSettings, unknown>>) : {}
    const savedWords = Array.isArray(source.words) ? source.words.filter(isUsableWord) : []
    return {
        enabled: typeof source.enabled === 'boolean' ? source.enabled : defaults.enabled,
        language: isSpellcheckLanguage(source.language) ? source.language : defaults.language,
        words: [...new Set(savedWords)].slice(0, MAX_WORDS),
    }
}
