import { createHighlighter, type BundledLanguage, type Highlighter } from 'shiki'

const THEMES = ['github-dark', 'github-light'] as const

const BUNDLED_LANGS = [
    'bash',
    'c',
    'cpp',
    'csharp',
    'css',
    'go',
    'html',
    'java',
    'javascript',
    'json',
    'kotlin',
    'markdown',
    'php',
    'python',
    'ruby',
    'rust',
    'shell',
    'sql',
    'swift',
    'toml',
    'tsx',
    'typescript',
    'xml',
    'yaml',
] as const satisfies BundledLanguage[]

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

export type ShikiTheme = (typeof THEMES)[number]

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
    if (!highlighterPromise) {
        highlighterPromise = createHighlighter({
            themes: [...THEMES],
            langs: [...BUNDLED_LANGS],
        })
    }
    return highlighterPromise
}

function normalizeLanguage(lang: string | undefined): string {
    if (!lang) return 'text'
    const key = lang.toLowerCase()
    return LANG_ALIASES[key] ?? key
}

async function ensureLanguage(highlighter: Highlighter, lang: string): Promise<string> {
    if (lang === 'text') return 'text'
    const loaded = highlighter.getLoadedLanguages()
    if (loaded.includes(lang)) return lang
    try {
        await highlighter.loadLanguage(lang as BundledLanguage)
        return lang
    } catch {
        return 'text'
    }
}

export async function highlightFencedCode(code: string, language: string | undefined, theme: ShikiTheme): Promise<string> {
    const highlighter = await getHighlighter()
    const lang = await ensureLanguage(highlighter, normalizeLanguage(language))
    return highlighter.codeToHtml(code.replace(/\n$/, ''), {
        lang,
        theme,
    })
}
