import { type IRunPropertiesOptions, MathRun, RunProperties, Math as WordMath } from 'docx'
import { latexToMath } from 'docx/math'

/** What docx keeps of a part of the file: its children, in the order they are written. */
type Component = { root?: unknown }

/**
 * Gives every run of letters in an equation (`m:r`) the run properties, such as a link's colour and underline, as
 * Word does when you format a selected equation. docx's MathRun takes none of its own: they go after its math
 * properties (`m:rPr`) and before its text (`m:t`), the last thing it holds.
 */
function formatRuns(component: unknown, run: IRunPropertiesOptions): void {
    const children = (component as Component | null)?.root
    if (!Array.isArray(children)) return
    if (component instanceof MathRun) children.splice(children.length - 1, 0, new RunProperties(run))
    else for (const child of children) formatRuns(child, run)
}

/**
 * TeX math as one of Word's own equations (`m:oMath`), which Word shows and edits as it does those typed into it.
 * docx's `latexToMath` reads it: fractions, scripts, roots, sums and integrals, functions, `\left`/`\right`,
 * accents, `\mathbb`, `\text`, Greek letters and symbols, matrices, `cases` and `aligned`. docx escapes the text.
 * With `run`, the equation's letters take those run properties, such as a size or colour.
 *
 * Null when it can't: TeX that isn't well formed, a command or environment it doesn't know, or no math at all,
 * such as `\text{}`, which would be an empty equation. The caller then writes the TeX source instead, so no math is
 * lost. This module holds docx's TeX reader (about 77 KB), so the Word export loads it only for a document with
 * math in it.
 */
export function texToWordMath(tex: string, run?: IRunPropertiesOptions): WordMath | null {
    if (!tex.trim()) return null
    let children: ReturnType<typeof latexToMath>
    try {
        children = latexToMath(tex)
    } catch {
        return null
    }
    if (children.length === 0) return null
    if (run) for (const child of children) formatRuns(child, run)
    return new WordMath({ children })
}
