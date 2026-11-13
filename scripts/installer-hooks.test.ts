import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '..')
// A Windows checkout may have CRLF line endings.
const read = (...path: string[]) => readFileSync(join(repoRoot, ...path), 'utf8').replace(/\r\n/g, '\n')
const hooks = read('src-tauri', 'windows', 'installer-hooks.nsh')
const readme = read('README.md')

/** The body of one `!macro name` ... `!macroend` in the hooks file. */
function macro(name: string): string {
    const match = hooks.match(new RegExp(`^!macro ${name}\\b[^\\n]*\\n([\\s\\S]*?)^!macroend`, 'm'))
    if (!match) throw new Error(`${name} is not in installer-hooks.nsh`)
    return match[1]
}

/** The lines of `body` between `${If} <condition>` (and any `${AndIf}` lines) and its `${EndIf}`. */
function guarded(body: string, ...conditions: string[]): string {
    const head = conditions.map((condition, i) => `\\$\\{${i === 0 ? 'If' : 'AndIf'}\\} ${condition.replace(/[$<>]/g, '\\$&')}\\s*\\n\\s*`).join('')
    const match = body.match(new RegExp(`${head}([\\s\\S]*?)\\$\\{EndIf\\}`))
    return match?.[1] ?? ''
}

describe('installer hooks', () => {
    it('uninstalling with "Delete the application data" also removes the folders from before 1.4.1', () => {
        const removed = guarded(macro('NSIS_HOOK_POSTUNINSTALL'), '$DeleteAppDataCheckboxState = 1', '$UpdateMode <> 1')
        expect(removed).toMatch(/RmDir \/r "\$APPDATA\\\$\{SCRIVON_OLD_IDENTIFIER\}"/)
        expect(removed).toMatch(/RmDir \/r "\$LOCALAPPDATA\\\$\{SCRIVON_OLD_IDENTIFIER\}"/)
        expect(hooks).toMatch(/^!define SCRIVON_OLD_IDENTIFIER "com\.diagram\.app"$/m)
    })

    it('stops before copying any file on Windows older than the version the README names', () => {
        expect(hooks).toMatch(/^!define SCRIVON_MIN_BUILD 17763$/m)
        expect(readme).toContain('Windows 10 version 1809 (build 17763)')
        expect(macro('NSIS_HOOK_PREINSTALL')).toMatch(/\$\{IfNot\} \$\{AtLeastBuild\} \$\{SCRIVON_MIN_BUILD\}\s*\n[^\n]*MessageBox[^\n]*\n\s*Abort/)
    })

    it('stops the ARM64 installer on a PC without an ARM processor', () => {
        expect(macro('NSIS_HOOK_PREINSTALL')).toMatch(
            /!if "\$\{ARCH\}" == "arm64"\s*\n\s*\$\{IfNot\} \$\{IsNativeARM64\}\s*\n[^\n]*MessageBox[^\n]*\n\s*Abort/
        )
    })
})
