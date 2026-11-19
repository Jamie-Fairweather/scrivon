import { Math as WordMath } from 'docx'
import { latexToMath } from 'docx/math'

/**
 * TeX math as one of Word's own equations (`m:oMath`), which Word shows and edits as it does those typed into it.
 * docx's `latexToMath` reads it: fractions, scripts, roots, sums and integrals, functions, `\left`/`\right`,
 * accents, `\mathbb`, `\text`, Greek letters and symbols, matrices, `cases` and `aligned`. docx escapes the text.
 *
 * Null when it can't: TeX that isn't well formed, a command or environment it doesn't know, or no math at all. The
 * caller then writes the TeX source instead, so no math is lost. This module holds docx's TeX reader (about 77 KB),
 * so the Word export loads it only for a document with math in it.
 */
export function texToWordMath(tex: string): WordMath | null {
    if (!tex.trim()) return null
    try {
        return new WordMath({ children: latexToMath(tex) })
    } catch {
        return null
    }
}
