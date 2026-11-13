import nspell from 'nspell'
import type { SpellcheckLanguage } from '@/lib/spellcheck/languages'
import { createProseWordFinder } from '@/lib/spellcheck/prose-words'
import { rankSuggestions } from '@/lib/spellcheck/rank-suggestions'

/** A Hunspell dictionary: its affix rules and its word list. */
export type DictionaryFiles = { aff: string; dic: string }

/** A word the dictionary doesn't know, and where it starts in the text. */
export type Misspelling = { word: string; offset: number }

export type SpellcheckRequest =
    | { type: 'check'; id: number; language: SpellcheckLanguage; words: readonly string[]; text: string; document: string }
    | { type: 'suggest'; id: number; language: SpellcheckLanguage; words: readonly string[]; word: string }

export type SpellcheckResponse =
    | { type: 'checked'; id: number; misspellings: Misspelling[] }
    | { type: 'suggested'; id: number; suggestions: string[] }
    | { type: 'failed'; id: number; message: string }

type Checker = {
    spell: ReturnType<typeof nspell>
    /** The user's words that were added to the dictionary (ones it already knew are not). */
    added: Set<string>
    /** Each word's answer, so the same word isn't looked up again on every check. */
    known: Map<string, boolean>
}

/** How many documents' blocks the worker remembers: enough for the tabs someone switches between. */
const REMEMBERED_DOCUMENTS = 4

/** A capital after the first letter: NASA, iPhone, McWibble. Names and acronyms, left alone as Word does. */
const INNER_CAPITAL = /^.+\p{Lu}/u
/** Letters of another script than Latin, which an English dictionary can't judge. */
const NOT_LATIN = /[^\p{Script=Latin}\p{M}']/u
const POSSESSIVE = /'s$/i

/** Curly apostrophes as the dictionary writes them. */
function plainApostrophes(word: string): string {
    return word.replace(/’/g, "'")
}

function lookUp(spell: Checker['spell'], word: string): boolean {
    if (spell.correct(word)) return true
    // A possessive of a word the user added: the dictionary only knows its own words' possessives.
    if (POSSESSIVE.test(word) && spell.correct(word.slice(0, -2))) return true
    // café, naïve: the dictionary only has some words with their accents.
    const unaccented = word.normalize('NFD').replace(/\p{M}/gu, '')
    return unaccented !== word && spell.correct(unaccented)
}

function isKnown(checker: Checker, word: string): boolean {
    if (INNER_CAPITAL.test(word)) return true
    const plain = plainApostrophes(word)
    if (NOT_LATIN.test(plain)) return true
    let known = checker.known.get(plain)
    if (known === undefined) {
        known = lookUp(checker.spell, plain)
        checker.known.set(plain, known)
    }
    return known
}

/** Brings the user's own words into the dictionary, and takes out ones they removed. */
function applyUserWords(checker: Checker, words: readonly string[]): void {
    const wanted = new Set(words.map(plainApostrophes))
    let changed = false
    for (const word of checker.added) {
        if (wanted.has(word)) continue
        checker.spell.remove(word)
        checker.added.delete(word)
        changed = true
    }
    for (const word of wanted) {
        if (checker.added.has(word) || checker.spell.correct(word)) continue
        checker.spell.add(word)
        checker.added.add(word)
        changed = true
    }
    if (changed) checker.known.clear()
}

/**
 * The spell check that runs in the worker (lib/spellcheck/spellcheck.worker.ts), so checking a long
 * document never slows typing. Each language's dictionary is loaded the first time it is used.
 */
export function createSpellcheckWorkerCore(loadDictionary: (language: SpellcheckLanguage) => DictionaryFiles | Promise<DictionaryFiles>) {
    // Each recent document's blocks, so a check after an edit, or on going back to a tab, only reads the
    // blocks that changed. The document used longest ago is forgotten first.
    const finders = new Map<string, ReturnType<typeof createProseWordFinder>>()
    const findProseWords = (document: string, text: string) => {
        const finder = finders.get(document) ?? createProseWordFinder()
        finders.delete(document)
        finders.set(document, finder)
        if (finders.size > REMEMBERED_DOCUMENTS) finders.delete(finders.keys().next().value!)
        return finder(text)
    }
    const checkers = new Map<SpellcheckLanguage, Promise<Checker>>()

    const checkerFor = (language: SpellcheckLanguage) => {
        let checker = checkers.get(language)
        if (!checker) {
            checker = (async () => {
                const { aff, dic } = await loadDictionary(language)
                return { spell: nspell(aff, dic), added: new Set<string>(), known: new Map<string, boolean>() }
            })()
            // A dictionary that didn't load is tried again by the next request.
            checker.catch(() => checkers.delete(language))
            checkers.set(language, checker)
        }
        return checker
    }

    const answer = async (request: SpellcheckRequest): Promise<SpellcheckResponse> => {
        const checker = await checkerFor(request.language)
        applyUserWords(checker, request.words)
        if (request.type === 'check') {
            const misspellings = findProseWords(request.document, request.text).filter(({ word }) => !isKnown(checker, word))
            return { type: 'checked', id: request.id, misspellings }
        }
        return {
            type: 'suggested',
            id: request.id,
            suggestions: rankSuggestions(request.word, checker.spell.suggest(plainApostrophes(request.word))),
        }
    }

    return {
        /** Answers one request. Never throws: a failure is answered with its message. */
        async handle(request: SpellcheckRequest): Promise<SpellcheckResponse> {
            try {
                return await answer(request)
            } catch (err) {
                return { type: 'failed', id: request.id, message: err instanceof Error ? err.message : String(err) }
            }
        },
    }
}
