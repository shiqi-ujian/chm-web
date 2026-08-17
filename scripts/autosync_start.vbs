' autosync_start.vbs
' 隐藏窗口启动 autosync.ps1，并捕获其 stderr 到日志,方便查“弹窗”真正来源。
' 之前 wscript 直接 Run powershell 时，powershell 的 stderr 无处落地，
' 某些按键/环境会把 git 打印在 stderr 上的东西弹出到桌面。
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
logDir = "C:\Users\qiujian.shi\Desktop\chm-web\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = logDir & "\vbs_launcher_" & Year(Now) & Month(Now) & Day(Now) & ".log"
ps1 = "C:\Users\qiujian.shi\Desktop\chm-web\scripts\autosync.ps1"
' 用重定向把 PowerShell 的 stdout+stderr 都写进文件，绝不让它们在桌面弹出。
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """ 1>>""" & logFile & """ 2>&1"
sh.Run cmd, 0, False