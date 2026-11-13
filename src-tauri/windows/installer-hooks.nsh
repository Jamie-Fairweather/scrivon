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
; It also puts the app's taskbar ID on the shortcuts that open it (see
; SCRIVON_TAG_SHORTCUT), stops on a PC this copy can't run on, and lets
; "Delete the application data" remove the data folders from before 1.4.1.
;
; This file is included before the template defines PRODUCTNAME and friends,
; so only the macro bodies (expanded where they are inserted) may use them.

!include WinVer.nsh

!define SCRIVON_OLD_MANUKEY "Software\diagram"
!define SCRIVON_OLD_PRODUCTKEY "Software\diagram\Scrivon"
!define SCRIVON_OLD_BINARY "diagram-app.exe"
; The data folders were named after this identifier up to 1.4.0
; (src-tauri/src/legacy_profile.rs).
!define SCRIVON_OLD_IDENTIFIER "com.diagram.app"

; The oldest Windows Scrivon runs on: Windows 10 version 1809. README.md says
; the same; change both together.
!define SCRIVON_MIN_BUILD 17763
!define SCRIVON_TOO_OLD "Scrivon needs Windows 10 version 1809 or later, or Windows 11."

; Checks the Windows version before the first page, so nothing (not even the
; WebView2 Runtime) is installed on a PC Scrivon can't run on. Silent installs
; skip this; NSIS_HOOK_PREINSTALL checks again for them.
!define MUI_CUSTOMFUNCTION_GUIINIT ScrivonCheckWindows
Function ScrivonCheckWindows
  ${IfNot} ${AtLeastBuild} ${SCRIVON_MIN_BUILD}
    MessageBox MB_ICONSTOP "${SCRIVON_TOO_OLD}"
    Quit
  ${EndIf}
FunctionEnd

; Runs before any of the app's files are copied, in every install mode.
!macro NSIS_HOOK_PREINSTALL
  ${IfNot} ${AtLeastBuild} ${SCRIVON_MIN_BUILD}
    MessageBox MB_ICONSTOP "${SCRIVON_TOO_OLD}" /SD IDOK
    Abort
  ${EndIf}
  !if "${ARCH}" == "arm64"
    ${IfNot} ${IsNativeARM64}
      MessageBox MB_ICONSTOP "This installer is for Windows on ARM PCs. Download the x64 installer for this PC." /SD IDOK
      Abort
    ${EndIf}
  !else if "${ARCH}" == "x64"
    ; Windows 10 on ARM can't run x64 apps; Windows 11 on ARM can.
    ${If} ${IsNativeARM64}
    ${AndIfNot} ${AtLeastWin11}
      MessageBox MB_ICONSTOP "Windows 10 on ARM can't run this installer's copy of Scrivon. Download the ARM64 installer instead." /SD IDOK
      Abort
    ${EndIf}
  !endif
!macroend

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

; Puts the app's taskbar ID (AppUserModelID, the bundle identifier) on `lnk` if
; it opens the installed program. The app gives its windows that ID
; (set_taskbar_id in src-tauri/src/lib.rs), and Windows only shows a window on
; a pinned icon whose shortcut carries the same one. An update doesn't make the
; shortcuts again, so ones made before the ID was used never got it.
!macro SCRIVON_TAG_SHORTCUT lnk
  ${If} ${FileExists} "${lnk}"
    !insertmacro IsShortcutTarget "${lnk}" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $R8
    ${If} $R8 = 1
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

  ; Whether or not there was an old copy, so shortcuts that already open this
  ; one get the ID too.
  !insertmacro SCRIVON_TAG_SHORTCUT "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !insertmacro SCRIVON_TAG_SHORTCUT "$DESKTOP\${PRODUCTNAME}.lnk"
  !insertmacro SCRIVON_TAG_SHORTCUT "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${PRODUCTNAME}.lnk"
!macroend

; The template's "Delete the application data" removes the data folders named
; after the current identifier. This also removes the ones from before 1.4.1,
; which the app only copied from and left in place. Never during an update.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$APPDATA\${SCRIVON_OLD_IDENTIFIER}"
    RmDir /r "$LOCALAPPDATA\${SCRIVON_OLD_IDENTIFIER}"
  ${EndIf}
!macroend
