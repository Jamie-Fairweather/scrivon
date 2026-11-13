import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SpellcheckLanguage } from './languages'
import { createSpellcheckWorkerCore, type SpellcheckRequest } from './spellcheck-worker-core'

const root = join(import.meta.dirname, '..', '..')

/** The real dictionaries the app ships. */
function readDictionary(language: SpellcheckLanguage) {
    const dir = join(root, 'node_modules', language === 'en-GB' ? 'dictionary-en-gb' : 'dictionary-en')
    return { aff: readFileSync(join(dir, 'index.aff'), 'utf8'), dic: readFileSync(join(dir, 'index.dic'), 'utf8') }
}

const core = createSpellcheckWorkerCore(readDictionary)

let nextId = 1
function check(text: string, language: SpellcheckLanguage = 'en-US', words: string[] = []) {
    return core.handle({ type: 'check', id: nextId++, text, language, words })
}

async function misspelt(text: string, language: SpellcheckLanguage = 'en-US', words: string[] = []) {
    const response = await check(text, language, words)
    if (response.type !== 'checked') throw new Error(`Expected a check result, got ${JSON.stringify(response)}`)
    return response.misspellings
}

describe('spell check worker', () => {
    it('finds misspelt words in the prose, with where each one is', async () => {
        const text = 'Teh colour of `cde` is nice.'
        expect(await misspelt(text)).toEqual([
            { word: 'Teh', offset: 0 },
            { word: 'colour', offset: 4 },
        ])
        expect(await misspelt(text, 'en-GB')).toEqual([{ word: 'Teh', offset: 0 }])
    })

    it('leaves alone words in capitals, names like iPhone, other scripts, and accents the dictionary lacks', async () => {
        expect(await misspelt('NASA and FOOBAR, iPhone and McWibble, Привет, 東京, café, naïve, users’ notes, it’s')).toEqual([])
    })

    it('knows the words the user added, with their possessive, and forgets removed ones', async () => {
        expect(await misspelt('Scrivon’s editor', 'en-US', ['Scrivon'])).toEqual([])
        expect(await misspelt("Scrivon's editor", 'en-GB', ['Scrivon'])).toEqual([])
        expect(await misspelt('Scrivon’s editor', 'en-US', [])).toEqual([{ word: 'Scrivon’s', offset: 0 }])
    })

    it('suggests the likeliest fixes first, at most five, in the case the word was typed in', async () => {
        const suggest = async (word: string, language: SpellcheckLanguage = 'en-US') => {
            const response = await core.handle({ type: 'suggest', id: nextId++, word, language, words: [] })
            if (response.type !== 'suggested') throw new Error(`Expected suggestions, got ${JSON.stringify(response)}`)
            return response.suggestions
        }
        // Swapped letters are the commonest slip.
        expect((await suggest('teh'))[0]).toBe('the')
        expect((await suggest('Teh'))[0]).toBe('The')
        expect((await suggest('wiht'))[0]).toBe('with')
        expect((await suggest('adn'))[0]).toBe('and')
        expect((await suggest('thier'))[0]).toBe('their')
        expect((await suggest('recieve'))[0]).toBe('receive')
        expect(await suggest('colur', 'en-GB')).toContain('colour')
        expect(await suggest('colur', 'en-GB')).not.toContain('color')
        expect(await suggest('ot')).toHaveLength(5)
        expect((await suggest('teh')).every((s) => s === s.toLowerCase())).toBe(true)
        expect(await suggest('qqqqqqqqqqqqqqqq')).toEqual([])
    })

    it('loads each dictionary once, and says so when one fails to load, trying again next time', async () => {
        const load = vi.fn<(language: SpellcheckLanguage) => ReturnType<typeof readDictionary>>()
        load.mockImplementationOnce(() => {
            throw new Error('missing file')
        })
        load.mockImplementation(readDictionary)
        const worker = createSpellcheckWorkerCore(load)
        const request: SpellcheckRequest = { type: 'check', id: 7, text: 'Helo', language: 'en-US', words: [] }

        expect(await worker.handle(request)).toEqual({ type: 'failed', id: 7, message: 'missing file' })
        expect(await worker.handle(request)).toEqual({ type: 'checked', id: 7, misspellings: [{ word: 'Helo', offset: 0 }] })
        await worker.handle({ ...request, type: 'suggest', word: 'Helo' })
        expect(load).toHaveBeenCalledTimes(2)
    })

    it('keeps a dictionary word known after the user adds it and takes it away again', async () => {
        await misspelt('color', 'en-US', ['color'])
        expect(await misspelt('color', 'en-US', [])).toEqual([])
    })
})
