import { createHighlighter, type BundledLanguage, type BundledTheme, type Highlighter, type SpecialLanguage } from 'shiki'
import type { AppThemeId } from '@/lib/theme/catalog'

const THEMES = ['github-dark', 'github-light'] as const

const LANG_ALIASES: Record<string, BundledLanguage | 'text'> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    py: 'python',
    sh: 'bash',
    zsh: 'bash',
    shell: 'bash',
    yml: 'yaml',
    md: 'markdown',
    'c#': 'csharp',
    cs: 'csharp',
    rs: 'rust',
    rb: 'ruby',
    kt: 'kotlin',
}

/** The code themes export offers. The preview also uses others; see {@link previewCodeTheme}. */
export type ShikiTheme = (typeof THEMES)[number]

/** Shiki's own version of a palette. Palettes Shiki doesn't have use GitHub's colours. */
const PALETTE_CODE_THEMES = new Map<AppThemeId, BundledTheme>([
    ['tokyo-night', 'tokyo-night'],
    ['tokyo-night-storm', 'tokyo-night'],
    ['catppuccin-mocha', 'catppuccin-mocha'],
    ['catppuccin-latte', 'catppuccin-latte'],
    ['nord', 'nord'],
    ['dracula', 'dracula'],
    ['github-light', 'github-light'],
    ['github-dark', 'github-dark'],
    ['solarized-light', 'solarized-light'],
    ['solarized-dark', 'solarized-dark'],
    ['one-dark', 'one-dark-pro'],
])

/** The code colours for preview code blocks in this palette, so they match the rest of the theme. */
export function previewCodeTheme(themeId: AppThemeId, isLight: boolean): BundledTheme {
    return PALETTE_CODE_THEMES.get(themeId) ?? (isLight ? 'github-light' : 'github-dark')
}

/**
 * Longest block {@link highlightFencedCodeNow} highlights. Shiki takes about 3 ms per 1,000 characters, so this
 * keeps a keystroke in a code block to about a frame; longer blocks wait for a pause in typing instead.
 */
const MAX_HIGHLIGHT_NOW_CHARS = 4_000

/**
 * Time {@link highlightFencedCodeNow} may take in one frame, across every block. Typing in a block stays well
 * inside it, but a document with dozens of blocks opening, or every block redrawing for a new theme, would hold
 * up the frame; past the budget, blocks get their colours a moment later instead.
 */
const HIGHLIGHT_NOW_BUDGET_MS = 8
let highlightNowSpentMs = 0
let highlightBudgetResetPending = false

function spendHighlightBudget(ms: number): void {
    highlightNowSpentMs += ms
    if (highlightBudgetResetPending) return
    highlightBudgetResetPending = true
    const reset = () => {
        highlightNowSpentMs = 0
        highlightBudgetResetPending = false
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reset)
    else setTimeout(reset, 0)
}

let highlighterPromise: Promise<Highlighter> | null = null
/** The highlighter once it has started, for highlighting without waiting. */
let readyHighlighter: Highlighter | null = null
/** Languages Shiki doesn't have. They show as plain text, without trying to load them again on every keystroke. */
const unavailableLanguages = new Set<string>()

function getHighlighter(): Promise<Highlighter> {
    if (!highlighterPromise) {
        // No grammars up front: ensureLanguage loads each one the first time a block uses it, so a document with
        // one bash snippet doesn't load two dozen grammars. A failed start is forgotten so the next block retries.
        highlighterPromise = createHighlighter({ themes: [...THEMES], langs: [] }).then(
            (highlighter) => {
                readyHighlighter = highlighter
                return highlighter
            },
            (err: unknown) => {
                highlighterPromise = null
                throw err
            }
        )
    }
    return highlighterPromise
}

function normalizeLanguage(lang: string | undefined): string {
    if (!lang) return 'text'
    const key = lang.toLowerCase()
    return LANG_ALIASES[key] ?? key
}

/** The grammar to highlight with if it's ready now: `lang`, 'text' for a language Shiki doesn't have, or null. */
function loadedLanguage(highlighter: Highlighter, lang: string): string | null {
    if (lang === 'text' || unavailableLanguages.has(lang)) return 'text'
    return highlighter.getLoadedLanguages().includes(lang) ? lang : null
}

async function ensureLanguage(highlighter: Highlighter, lang: string): Promise<string> {
    const loaded = loadedLanguage(highlighter, lang)
    if (loaded) return loaded
    try {
        await highlighter.loadLanguage(lang as BundledLanguage)
        return lang
    } catch {
        unavailableLanguages.add(lang)
        return 'text'
    }
}

/** Loads a palette's code theme the first time a block needs it; GitHub's two are loaded at start. */
async function ensureTheme(highlighter: Highlighter, theme: BundledTheme): Promise<void> {
    if (!highlighter.getLoadedThemes().includes(theme)) await highlighter.loadTheme(theme)
}

export async function highlightFencedCode(code: string, language: string | undefined, theme: BundledTheme): Promise<string> {
    const highlighter = await getHighlighter()
    const lang = await ensureLanguage(highlighter, normalizeLanguage(language))
    await ensureTheme(highlighter, theme)
    return highlighter.codeToHtml(code.replace(/\n$/, ''), {
        lang,
        theme,
    })
}

/**
 * The HTML {@link highlightFencedCode} would give, without waiting, or null when it can't be had straight away:
 * Shiki hasn't started, the block's grammar or theme isn't loaded yet, the block is too long to highlight per
 * keystroke, or this frame's highlighting time is used up.
 */
export function highlightFencedCodeNow(code: string, language: string | undefined, theme: BundledTheme): string | null {
    const highlighter = readyHighlighter
    if (!highlighter || code.length > MAX_HIGHLIGHT_NOW_CHARS || highlightNowSpentMs >= HIGHLIGHT_NOW_BUDGET_MS) return null
    const lang = loadedLanguage(highlighter, normalizeLanguage(language))
    if (!lang || !highlighter.getLoadedThemes().includes(theme)) return null
    const started = performance.now()
    try {
        return highlighter.codeToHtml(code.replace(/\n$/, ''), { lang, theme })
    } catch {
        return null
    } finally {
        spendHighlightBudget(performance.now() - started)
    }
}

export type HighlightedToken = {
    text: string
    color?: string
}

/** Coloured runs for the same highlight {@link highlightFencedCode} draws as HTML. */
export async function highlightFencedCodeTokens(code: string, language: string | undefined, theme: ShikiTheme): Promise<HighlightedToken[][]> {
    const highlighter = await getHighlighter()
    const lang = await ensureLanguage(highlighter, normalizeLanguage(language))
    const { tokens } = highlighter.codeToTokens(code.replace(/\n$/, ''), { lang: lang as BundledLanguage | SpecialLanguage, theme })
    return tokens.map((line) => line.map((token) => ({ text: token.content, color: token.color })))
}
