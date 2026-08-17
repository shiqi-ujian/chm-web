Option Explicit
Dim sh, ps1, cmd
Set sh = CreateObject("WScript.Shell")
ps1 = "C:\Users\qiujian.shi\Desktop\chm-web\scripts\autosync.ps1"
cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"
sh.Run cmd, 0, False