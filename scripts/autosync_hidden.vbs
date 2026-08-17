' autosync_hidden.vbs
' 用隐藏窗口调用 autosync.ps1（wscript 本无窗口，inner PowerShell 也隐藏），
' 所以计划任务每 N 分钟跑一次不会有任何窗口/蓝屏闪现。
' 0 = SW_HIDE, 2nd param False = 不等待。
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ""& { $s = 'C:\Users\qiujian.shi\Desktop\chm-web\scripts\autosync.ps1'; if (Test-Path $s) { & $s } }""", 0, False