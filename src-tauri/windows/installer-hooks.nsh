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
; SCRIVON_TAG_SHORTCUT), and keeps the app each file type opened with before
; (see SCRIVON_FILE_TYPES).
;
; This file is included before the template defines PRODUCTNAME and friends,
; so only the macro bodies (expanded where they are inserted) may use them.

!define SCRIVON_OLD_MANUKEY "Software\diagram"
!define SCRIVON_OLD_PRODUCTKEY "Software\diagram\Scrivon"
!define SCRIVON_OLD_BINARY "diagram-app.exe"

; Runs `do` for each file type Scrivon opens (bundle > fileAssociations in
; tauri.conf.json), with its extension, its class and a variable to keep the
; old backup in.
;
; Every install, updates too, the template's APP_ASSOCIATE saves the class
; that opened .<ext> before as <class>_backup, for the uninstaller to put back.
; From the second install on, that class is Scrivon's own. Then the app the
; user had before is lost, and uninstalling leaves the files pointing at the
; class it removes. So NSIS_HOOK_PREINSTALL reads each backup first, and
; NSIS_HOOK_POSTINSTALL puts it back if the install overwrote it.
!macro SCRIVON_FILE_TYPES do
  !insertmacro ${do} "md" "Scrivon.Markdown" $ScrivonMdBackup
  !insertmacro ${do} "markdown" "Scrivon.Markdown" $ScrivonMarkdownBackup
  !insertmacro ${do} "mmd" "Scrivon.Mermaid" $ScrivonMmdBackup
  !insertmacro ${do} "mermaid" "Scrivon.Mermaid" $ScrivonMermaidBackup
!macroend
Var ScrivonMdBackup
Var ScrivonMarkdownBackup
Var ScrivonMmdBackup
Var ScrivonMermaidBackup

; Keeps the class .<ext> opened with before Scrivon in `var`, or "" if none.
!macro SCRIVON_READ_ASSOC_BACKUP ext class var
  ReadRegStr ${var} SHCTX "Software\Classes\.${ext}" "${class}_backup"
  ${If} ${var} == "${class}"
    StrCpy ${var} ""
  ${EndIf}
!macroend

; Puts `var` back as the backup if this install saved Scrivon's own class there.
!macro SCRIVON_KEEP_ASSOC_BACKUP ext class var
  ReadRegStr $R7 SHCTX "Software\Classes\.${ext}" "${class}_backup"
  ${If} $R7 == "${class}"
    WriteRegStr SHCTX "Software\Classes\.${ext}" "${class}_backup" ${var}
  ${EndIf}
!macroend

; Runs before the template registers the file types.
!macro NSIS_HOOK_PREINSTALL
  !insertmacro SCRIVON_FILE_TYPES SCRIVON_READ_ASSOC_BACKUP
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

  !insertmacro SCRIVON_FILE_TYPES SCRIVON_KEEP_ASSOC_BACKUP
  ; Tells File Explorer the file types changed, so it shows the new icons now.
  !insertmacro UPDATEFILEASSOC
!macroend

; The template has removed the file types by now.
!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro UPDATEFILEASSOC
!macroend
