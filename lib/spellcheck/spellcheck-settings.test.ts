import { describe, expect, it } from 'vitest'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { mergeStoredSettings } from '@/lib/settings/migrate'
import { defaultSpellcheckLanguage, dictionaryForm, withDictionaryWord, withoutDictionaryWord } from './spellcheck-settings'

describe('spell check settings', () => {
    it('checks spelling by default, with no words of the user’s own yet', () => {
        expect(createDefaultSettings().spellcheck).toMatchObject({ enabled: true, words: [] })
    })

    it('picks British English for English speakers outside North America, else American English', () => {
        expect(defaultSpellcheckLanguage(['en-GB', 'en-US'])).toBe('en-GB')
        expect(defaultSpellcheckLanguage(['fr-FR', 'en-AU'])).toBe('en-GB')
        expect(defaultSpellcheckLanguage(['en-US', 'en-GB'])).toBe('en-US')
        expect(defaultSpellcheckLanguage(['en'])).toBe('en-US')
        expect(defaultSpellcheckLanguage(['de-DE'])).toBe('en-US')
        expect(defaultSpellcheckLanguage([])).toBe('en-US')
    })

    it('reads saved settings, keeping only usable words, and falls back to the defaults for the rest', () => {
        const defaults = createDefaultSettings().spellcheck
        expect(mergeStoredSettings({ spellcheck: { enabled: false, language: 'en-GB', words: ['Scrivon', 'Tauri'] } }).spellcheck).toEqual({
            enabled: false,
            language: 'en-GB',
            words: ['Scrivon', 'Tauri'],
        })
        expect(
            mergeStoredSettings({ spellcheck: { enabled: 'no', language: 'xx', words: ['ok', 'ok', ' two words ', '', 7, 'x'.repeat(200)] } })
                .spellcheck
        ).toEqual({ ...defaults, words: ['ok'] })
        expect(mergeStoredSettings({}).spellcheck).toEqual(defaults)
    })

    it('adds a word once, as the dictionary writes it, and removes it again', () => {
        expect(dictionaryForm('Scrivon’s')).toBe('Scrivon')
        expect(dictionaryForm("Tauri's")).toBe('Tauri')
        expect(dictionaryForm('don’tt')).toBe("don'tt")
        const words = withDictionaryWord(['Tauri'], 'Scrivon’s')
        expect(words).toEqual(['Tauri', 'Scrivon'])
        expect(withDictionaryWord(words, 'Scrivon')).toBe(words)
        expect(withDictionaryWord(words, 'two words')).toBe(words)
        expect(withoutDictionaryWord(words, 'Tauri')).toEqual(['Scrivon'])
    })
})
