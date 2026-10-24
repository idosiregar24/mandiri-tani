; Custom NSIS steps for Mandiri Tani POS (desktop-runtime-standards §6, PRD §8.4).

!macro customInstall
  ; Phones and other PCs on the store Wi-Fi reach the embedded server on TCP 3000.
  ; Private network profile only — never Public.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Mandiri Tani POS (LAN)"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Mandiri Tani POS (LAN)" dir=in action=allow protocol=TCP localport=3000 profile=private'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Mandiri Tani POS (LAN)"'
  DetailPrint "Data toko TIDAK dihapus dan tetap tersimpan di folder %APPDATA%\pos-desktop."
!macroend
