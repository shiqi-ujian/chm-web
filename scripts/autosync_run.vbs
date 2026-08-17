Option Explicit
Dim sh, ps1, cmd
Set sh = CreateObject("WScript.Shell")
' 用本 vbs 所在目录定位 autosync.ps1，不写死机器路径，脚本移动后仍可运行
ps1 = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\autosync.ps1"
cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"
sh.Run cmd, 0, False