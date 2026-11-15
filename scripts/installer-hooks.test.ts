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

/** The body of one `Function name` ... `FunctionEnd` in the hooks file. */
function func(name: string): string {
    const match = hooks.match(new RegExp(`^Function ${name}\\n([\\s\\S]*?)^FunctionEnd`, 'm'))
    if (!match) throw new Error(`Function ${name} is not in installer-hooks.nsh`)
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

    it('stops on Windows older than the version the README names', () => {
        expect(hooks).toMatch(/^!define SCRIVON_MIN_BUILD 17763$/m)
        expect(readme).toContain('Windows 10 version 1809 (build 17763)')
        expect(func('ScrivonCheckPC')).toMatch(
            /\$\{IfNot\} \$\{AtLeastBuild\} \$\{SCRIVON_MIN_BUILD\}\s*\n\s*StrCpy \$ScrivonCantRun "Scrivon needs Windows 10 version 1809/
        )
    })

    it('stops the ARM64 installer on a PC without an ARM processor', () => {
        expect(func('ScrivonCheckPC')).toMatch(
            /!if "\$\{SCRIVON_ARCH\}" == "arm64"\s*\n\s*\$\{ElseIfNot\} \$\{IsNativeARM64\}\s*\n\s*StrCpy \$ScrivonCantRun "This installer is for Windows on ARM PCs/
        )
    })

    it('stops the x64 installer on Windows 10 on ARM, but not on Windows 11 on ARM', () => {
        expect(func('ScrivonCheckPC')).toMatch(
            /!else if "\$\{SCRIVON_ARCH\}" == "x64"\s*\n(?:\s*;[^\n]*\n)*\s*\$\{ElseIf\} \$\{IsNativeARM64\}\s*\n\s*\$\{AndIfNot\} \$\{AtLeastWin11\}\s*\n\s*StrCpy \$ScrivonCantRun "Windows 10 on ARM/
        )
    })

    it('reads the architecture itself, because the template defines ARCH after it includes the hooks', () => {
        expect(hooks).toMatch(/^!searchparse \/file "installer\.nsi" `!define ARCH "` SCRIVON_ARCH `"`$/m)
        // Outside a macro, ${ARCH} isn't defined yet, so a check on it would never match.
        expect(func('ScrivonCheckPC')).not.toContain('${ARCH}')
        // Where ARCH is defined, the build stops if the two differ.
        expect(macro('NSIS_HOOK_PREINSTALL')).toMatch(/!if "\$\{SCRIVON_ARCH\}" != "\$\{ARCH\}"\s*\n\s*!error /)
    })

    it('checks before the first page, so a PC this copy cannot run on keeps the copy it has', () => {
        // On an upgrade, the reinstall page uninstalls the installed copy as soon as you click Next.
        expect(hooks).toMatch(/^!define MUI_CUSTOMFUNCTION_GUIINIT ScrivonCheckWindows$/m)
        expect(func('ScrivonCheckWindows')).toMatch(
            /Call ScrivonCheckPC\s*\n\s*\$\{If\} \$ScrivonCantRun != ""\s*\n\s*MessageBox MB_ICONSTOP \$ScrivonCantRun\s*\n\s*Quit/
        )
    })

    it('checks again before copying any file (silent installs skip the pages) and leaves no empty folder', () => {
        const preinstall = macro('NSIS_HOOK_PREINSTALL')
        expect(preinstall).toMatch(/Call ScrivonCheckPC\s*\n\s*\$\{If\} \$ScrivonCantRun != ""/)
        const stop = guarded(preinstall, '$ScrivonCantRun != ""')
        expect(stop).toMatch(/MessageBox MB_ICONSTOP \$ScrivonCantRun \/SD IDOK/)
        // The template's SetOutPath made $INSTDIR its working folder, which Windows can't remove.
        // RMDir without /r removes it only if it is empty.
        expect(stop).toMatch(/SetOutPath "\$TEMP"\s*\n\s*RMDir "\$INSTDIR"\s*\n\s*Abort\s*$/)
    })
})
