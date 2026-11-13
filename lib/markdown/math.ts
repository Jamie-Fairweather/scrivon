import { mathFromMarkdown } from 'mdast-util-math'
import { math } from 'micromark-extension-math'
import type { Code, Construct, Effects } from 'micromark-util-types'
import type { Processor } from 'unified'

const DOLLAR = 36

/** A space, tab or line break. Micromark gives tabs and line breaks negative codes. */
function isSpace(code: Code): boolean {
    return code === 32 || (code !== null && code < 0)
}

function isDigit(code: Code): boolean {
    return code !== null && code >= 48 && code <= 57
}

/**
 * Whether `$…$` is math by Pandoc's rule: no space just inside either `$`, and no digit straight after the closing
 * one. So `$5 and $10` stays as prices. `$$…$$` is always math. `codes` is the math with its dollars, and `after` is
 * the character after it.
 */
function isPandocMath(codes: readonly Code[], after: Code): boolean {
    if (codes[1] === DOLLAR) return true
    return !isSpace(codes[1]) && !isSpace(codes[codes.length - 2]) && !isDigit(after)
}

/** micromark's inline math, but only where {@link isPandocMath} says it is math. Otherwise the `$` is plain text. */
function pandocMathText(base: Construct): Construct {
    return {
        ...base,
        tokenize(effects, ok, nok) {
            const codes: Code[] = []
            const watched: Effects = {
                ...effects,
                consume(code) {
                    codes.push(code)
                    effects.consume(code)
                },
            }
            return base.tokenize.call(this, watched, (code) => (isPandocMath(codes, code) ? ok(code) : nok(code)), nok)
        },
    }
}

/**
 * remark-math, but `$` follows Pandoc's rule. It is decided while the Markdown is read, so bold or a link between two
 * prices still works. Scrivon never writes Markdown back, so this only reads math.
 */
export function remarkMath(this: Processor): undefined {
    const { flow, text } = math()
    const inline = [text?.[DOLLAR] ?? []].flat().map(pandocMathText)
    const data = this.data()
    data.micromarkExtensions = [...(data.micromarkExtensions ?? []), { flow, text: { [DOLLAR]: inline } }]
    data.fromMarkdownExtensions = [...(data.fromMarkdownExtensions ?? []), mathFromMarkdown()]
}
