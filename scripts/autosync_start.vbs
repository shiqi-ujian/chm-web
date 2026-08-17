Option Explicit
Dim sh, fso, logDir, logFile, ps1, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
logDir = "C:\Users\qiujian.shi\Desktop\chm-web\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = logDir & "\vbs_launcher_" & Year(Now) & Month(Now) & Day(Now) & ".log"
ps1 = "C:\Users\qiujian.shi\Desktop\chm-web\scripts\autosync.ps1"
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """ 1>>""" & logFile & """ 2>&1"
sh.Run cmd, 0, False