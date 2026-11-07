; NSIS installer hooks (bundle > windows > nsis > installerHooks in tauri.conf.json).
;
; Up to 1.4.0 the installer's publisher was "diagram" (from the old identifier
; com.diagram.app) and the program was diagram-app.exe. The installer remembers
; the install folder under HKCU\Software\<publisher>\Scrivon, so from 1.4.1 on it
; no longer found a folder the user had picked: updates went to the default
; folder and left the old copy behind, with the Start menu shortcut still
; opening it.
;
; After each install this finds that old copy, points its shortcuts at the new
; one, and removes the old program and uninstaller. It deletes only those
; files, and removes the folder only if it is then empty.
;
; This file is included before the template defines PRODUCTNAME and friends,
; so only the macro bodies (expanded where they are inserted) may use them.

!define SCRIVON_OLD_MANUKEY "Software\diagram"
!define SCRIVON_OLD_PRODUCTKEY "Software\diagram\Scrivon"
!define SCRIVON_OLD_BINARY "diagram-app.exe"

; Points `lnk` at the installed program if it currently opens `oldTarget`.
!macro SCRIVON_REPOINT_SHORTCUT lnk oldTarget
  ${If} ${FileExists} "${lnk}"
    !insertmacro IsShortcutTarget "${lnk}" "${oldTarget}"
    Pop $R8
    ${If} $R8 = 1
      !insertmacro SetShortcutTarget "${lnk}" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "${lnk}"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R9 HKCU "${SCRIVON_OLD_PRODUCTKEY}" ""
  ${If} $R9 != ""
    ${If} ${FileExists} "$R9\${SCRIVON_OLD_BINARY}"
      !insertmacro SCRIVON_REPOINT_SHORTCUT "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$R9\${SCRIVON_OLD_BINARY}"
      !insertmacro SCRIVON_REPOINT_SHORTCUT "$DESKTOP\${PRODUCTNAME}.lnk" "$R9\${SCRIVON_OLD_BINARY}"
      !insertmacro SCRIVON_REPOINT_SHORTCUT "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${PRODUCTNAME}.lnk" "$R9\${SCRIVON_OLD_BINARY}"
      Delete "$R9\${SCRIVON_OLD_BINARY}"
      ; Never touch the uninstaller of the copy that is installed now.
      ${IfNot} ${FileExists} "$R9\${SCRIVON_OLD_BINARY}"
      ${AndIf} $R9 != $INSTDIR
      ${AndIfNot} ${FileExists} "$R9\${MAINBINARYNAME}.exe"
        Delete "$R9\uninstall.exe"
        RMDir "$R9"
      ${EndIf}
    ${EndIf}

    ; Forget the old folder once its program is gone. If the old copy was still
    ; running, the file stays and the next install tries again.
    ${IfNot} ${FileExists} "$R9\${SCRIVON_OLD_BINARY}"
      ; Only the values the old NSIS installer wrote. An old MSI install keeps its own values here.
      DeleteRegValue HKCU "${SCRIVON_OLD_PRODUCTKEY}" ""
      DeleteRegValue HKCU "${SCRIVON_OLD_PRODUCTKEY}" "Installer Language"
      DeleteRegKey /ifempty HKCU "${SCRIVON_OLD_PRODUCTKEY}"
      DeleteRegKey /ifempty HKCU "${SCRIVON_OLD_MANUKEY}"
    ${EndIf}
  ${EndIf}
!macroend
