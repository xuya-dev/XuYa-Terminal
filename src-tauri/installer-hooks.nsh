; "Open in XuYa Terminal" shell verbs for folders, folder backgrounds, and drives.
; HKCU keeps the Explorer integration per-user. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInTerax"

  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInXuYaTerminal" "" "Open in XuYa Terminal"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInXuYaTerminal" "Icon" '"$INSTDIR\xuya-terminal.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInXuYaTerminal" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInXuYaTerminal\command" "" '"$INSTDIR\xuya-terminal.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInXuYaTerminal" "" "Open in XuYa Terminal"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInXuYaTerminal" "Icon" '"$INSTDIR\xuya-terminal.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInXuYaTerminal" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInXuYaTerminal\command" "" '"$INSTDIR\xuya-terminal.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInXuYaTerminal" "" "Open in XuYa Terminal"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInXuYaTerminal" "Icon" '"$INSTDIR\xuya-terminal.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInXuYaTerminal" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInXuYaTerminal\command" "" '"$INSTDIR\xuya-terminal.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInXuYaTerminal"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInXuYaTerminal"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInXuYaTerminal"
!macroend
