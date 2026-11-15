import type { languages } from 'monaco-editor'
import { TokenizationRegistry } from 'monaco-editor/editor/common/languages.js'
import { compile } from 'monaco-editor/editor/standalone/common/monarch/monarchCompile.js'
import { MonarchTokenizer } from 'monaco-editor/editor/standalone/common/monarch/monarchLexer.js'

/**
 * Colours text with Monaco's own Monarch lexer, as the editor does, without loading the whole editor
 * (which takes over ten seconds in a test). Languages registered here can be embedded in each other,
 * as a ```mermaid block is in Markdown.
 */

/** One token: its text and its type, such as `keyword.mermaid`. */
export type ColouredText = [text: string, type: string]

const registered = new Set<string>()

const languageService = {
    languageIdCodec: { encodeLanguageId: () => 0, decodeLanguageId: () => '' },
    getLanguageIdByLanguageName: (name: string) => (registered.has(name.toLowerCase()) ? name.toLowerCase() : null),
    getLanguageIdByMimeType: () => null,
    isRegisteredLanguageId: (id: string) => registered.has(id),
    requestBasicLanguageFeatures: () => {},
}

const configurationService = {
    getValue: () => 20_000,
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
}

type Tokenizer = InstanceType<typeof MonarchTokenizer>
const tokenizers = new Map<string, Tokenizer>()

export function registerMonarchLanguage(id: string, language: languages.IMonarchLanguage): void {
    const tokenizer = new MonarchTokenizer(languageService, {}, id, compile(id, language), configurationService)
    tokenizers.set(id, tokenizer)
    registered.add(id)
    TokenizationRegistry.register(id, tokenizer)
}

/** Each line of `text` as its tokens, leaving out empty ones. */
export function tokenizeLines(id: string, text: string): ColouredText[][] {
    const tokenizer = tokenizers.get(id)
    if (!tokenizer) throw new Error(`${id} is not registered`)
    let state = tokenizer.getInitialState()
    return text.split('\n').map((line) => {
        const { tokens, endState } = tokenizer.tokenize(line, true, state)
        state = endState
        return tokens
            .map((token, i): ColouredText => [line.slice(token.offset, tokens[i + 1]?.offset ?? line.length), token.type])
            .filter(([part]) => part !== '')
    })
}
