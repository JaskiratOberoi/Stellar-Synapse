; Custom NSIS steps for Stellar Synapse.
;
; Intentionally minimal. Synapse stores all its files (settings, instruments,
; offline result queue, logs) in the stable per-user data folder
; (%APPDATA%\stellar-synapse), which installers NEVER touch — so upgrades and
; downgrades keep every previously interfaced machine and all settings.
;
; We deliberately do NOT redirect data into the install directory: electron-
; builder wipes the install folder on every upgrade, which would reset all
; configuration (this was the cause of the "fresh install" behaviour on update).
;
; To put data on a non-C: drive, set a stable folder OUTSIDE the install dir in
; HKCU\Software\Stellar Synapse\DataDir; the app honours it and it survives
; upgrades (see src/main/dataDir.ts).
;
; Guarded for the installer pass — electron-builder compiles the uninstaller
; separately with BUILD_UNINSTALLER defined.

!ifndef BUILD_UNINSTALLER
  !macro customInstall
    ; no-op: data lives in the stable per-user location, not the install dir.
  !macroend
!endif
