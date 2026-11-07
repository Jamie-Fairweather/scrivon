import { describe, expect, it } from 'vitest'
import { markdownPreviewBody, markdownPreviewLang } from './markdown-preview-body'

const JAPANESE = '# 会議の議事録\n\n今日は新しい機能について話し合いました。次回までに資料を準備します。'

describe('markdownPreviewBody', () => {
    it('leaves the front matter out', () => {
        expect(markdownPreviewBody('---\ntitle: Notes\n---\n# Body')).toBe('# Body')
    })
})

describe('markdownPreviewLang (B104)', () => {
    it('uses the front matter’s lang: first, as export does', () => {
        expect(markdownPreviewLang(`---\nlang: zh-TW\n---\n${JAPANESE}`)).toBe('zh-TW')
        expect(markdownPreviewLang('---\nlang: ja\n---\nPlain English words.')).toBe('ja')
    })

    it('guesses the language from the prose otherwise', () => {
        expect(markdownPreviewLang(JAPANESE)).toBe('ja')
        expect(markdownPreviewLang('# Notes\n\nPlain English words.')).toBe('en')
        // Not a language tag, so it is guessed.
        expect(markdownPreviewLang(`---\nlang: not a tag\n---\n${JAPANESE}`)).toBe('ja')
    })

    it('leaves fenced code out of the guess, closed or not', () => {
        const code = '// 日本語のコメントです。これはコードの中です。\nconst x = 1'
        expect(markdownPreviewLang(`\`\`\`js\n${code}\n\`\`\``)).toBe('en')
        expect(markdownPreviewLang(`Intro.\n\n~~~~\n${code}\n~~~~~\n\nOutro.`)).toBe('en')
        expect(markdownPreviewLang(`Intro.\n\n\`\`\`\n${code}`)).toBe('en')
        // A shorter or different fence doesn't close the block, so the Japanese after it is still code.
        expect(markdownPreviewLang(`\`\`\`\`\n${code}\n\`\`\`\n~~~\n${code}\n\`\`\`\``)).toBe('en')
        // The prose around a closed block still counts.
        expect(markdownPreviewLang(`\`\`\`\nlet english = words + more + words\n\`\`\`\n\n${JAPANESE}`)).toBe('ja')
    })

    it('reads only the start of a very long document', () => {
        expect(markdownPreviewLang(`${'English words. '.repeat(2_000)}\n\n${JAPANESE.repeat(200)}`)).toBe('en')
    })
})
