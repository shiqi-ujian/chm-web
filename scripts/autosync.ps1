# 
# chm-web 本地自动同步脚本
# 作用：每轮做 提交(commit) + 拉取(fetch/rebase) + 推送(push) 双向同步。
# 网络很差时失败也不报错，留到下一轮再试（由计划任务每隔几分钟跑一次）。
# 仅处理这一个仓库（脚本所在目录），不做全局扫描。
# 由 Windows 计划任务调用，窗口由 vbs 隐藏。
#
# 用法:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "...\autosync.ps1"
# 开关:
#   -AttemptsPerRun N   每次 run push 最多尝试几次（默认 3）
#   -RetryDelaySec N    两次尝试间隔秒（默认 20）
#   -DiscoverOnly       只打印将要做什么，不执行

param(
    [int]$AttemptsPerRun = 3,
    [int]$RetryDelaySec = 20,
    [switch]$DiscoverOnly
)

$ErrorActionPreference = 'Continue'

# 仓库根 = 本脚本所在目录的上一级（脚本放在 <repo>/scripts/ 下）
$Repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Repo '.git') )) {
    Write-Output "SKIP: 不是 git 仓库根目录: $Repo"
    exit 0
}

$LogDir = Join-Path $Repo 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir ('autosync_' + (Get-Date -Format 'yyyyMMdd') + '.log')

function Write-Log {
    param([string]$Msg)
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "  " + $Msg
    Write-Output $line
    try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
}

# 捕获 git 输出，不抛错。
# 关键：本机网络差时 git 常失败并打印帮助/进度，绝不让这些文本混进统计或日志
# （否则会误报“缺少对象 sh”之类的假错误）。这里只保留退出码 + 一行干净错误。
function Invoke-Git {
    param([string]$Git, [string]$Cwd = $Repo)
    # 把参数拆成数组逐个传给 git，避免 git 把这个长字符串当成一个命令名
    # （否则会报 "git: 'fetch origin main' is not a git command"，并打印帮助文本）。
    $parts = $Git.Trim() -split '\s+'
    $raw = & git -C $Cwd --no-pager @parts 2>&1
    $text = (($raw | ForEach-Object { "$_" }) -join "`n").Trim()
    $ok = ($LASTEXITCODE -eq 0)
    if (-not $ok -and $text.Length -gt 300) {
        $m = [regex]::Match($text, '(?im)^\s*(fatal|error)[^\r\n]*')
        $text = if ($m.Success) { $m.Value } else { $text.Substring(0, 200) }
    }
    return @{ Ok = $ok; Out = $text }
}

# 读取一个纯数字计数；失败/非数字一律返回 0，绝不抛错、也绝不把帮助文本当数。
function Get-GitCount {
    param([string]$Git)
    $r = Invoke-Git $Git
    if (-not $r.Ok) { return 0 }
    if ($r.Out -match '^\d+\s*$') { return [int]$r.Out }
    return 0
}

# ---- 桌面提醒（一次性，不阻塞）----
# 计划任务经 vbs 隐藏窗口启动，NotifyIcon 足以弹气泡；若无交互桌面则失败并被忽略。
function Send-Notice {
    param([string]$Title, [string]$Text)
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
        $t = [type]::GetType('System.Windows.Forms.NotifyIcon')
        if (-not $t) { return }
        $ni = New-Object System.Windows.Forms.NotifyIcon
        $ni.Icon = [System.Drawing.SystemIcons]::Information
        $ni.BalloonTipTitle = $Title
        $ni.BalloonTipText = $Text
        $ni.Visible = $true
        $ni.ShowBalloonTip(6000)
        Start-Sleep -Milliseconds 300
        $ni.Dispose()
    } catch { Write-Log ("通知提示失败（忽略）: " + $_.Exception.Message) }
}

Write-Log ('==== 自动同步开始 ==== repo=' + $Repo)

# ---------- 1) 提交本地改动 ----------
$status = (@(& git -C $Repo status --porcelain 2>$null) -join "`n").Trim()
if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Log '无未提交改动，跳过 commit'
} else {
    if ($DiscoverOnly) {
        Write-Log ('[Discover] 有改动待提交：' + (($status -split "`n" | Select-Object -First 3) -join '; '))
    } else {
        & git -C $Repo add -A 2>&1 | Out-Host
        $commitMsg = 'auto: 本地改动自动提交 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
        $cm = Invoke-Git ('commit -m "' + $commitMsg + '"')
        if ($cm.Ok) { Write-Log ("提交完成: $commitMsg") }
        else { Write-Log ("提交结果：" + $cm.Out) }
    }
}

if ($DiscoverOnly) { Write-Log '[Discover] 不执行 fetch/push。'; Write-Log '==== end (Discover) ===='; exit 0 }

# ---------- 2) 拉取远端（fetch + rebase = 自动 pull）----------
# 多设备场景：既会推本地改动，也会拉别处推到远端的改动。
$branch = (& git -C $Repo symbolic-ref --short HEAD 2>$null)
if (-not $branch) { $branch = 'main' }
$haveRemote = (& git -C $Repo show-ref --verify -q "refs/remotes/origin/$branch" 2>$null)
$haveRemote = ($LASTEXITCODE -eq 0)

# rebase 前：远端比本地多几条提交（即将被拉入）
$prevIssued = if ($haveRemote) { Get-GitCount ("rev-list --count HEAD..origin/$branch") } else { 0 }

$f = Invoke-Git ('fetch origin ' + $branch)
if (-not $f.Ok) {
    Write-Log ("拉取失败（网络不通？），本轮跳过 pull。 " + $f.Out)
} else {
    # 若有残留未完成的 rebase 则先放弃（一贯冲突自动放弃）
    $inRebase = Test-Path (Join-Path $Repo '.git\rebase-merge')
    if ($inRebase) { & git -C $Repo rebase --abort 2>&1 | Out-Host; Write-Log '放弃上次残留的 rebase' }
    if ($haveRemote) {
        $r = Invoke-Git ('rebase origin/' + $branch)
        if ($r.Ok) {
            Write-Log 'rebase 完成'
            $afterIssues = Get-GitCount ("rev-list --count HEAD..origin/$branch")
            $merged = ($prevIssued - $afterIssues)
            if ($merged -gt 0) {
                Write-Log ("已从远端拉取合并 {0} 条提交（其它设备/远程推送）" -f $merged)
                Send-Notice 'chm-web 已拉取更新' ("从远端拉合并入 " + $merged + " 条提交")
            }
        } else {
            Write-Log ('rebase 冲突/失败（未自动解决，稍后处理）：' + $r.Out)
        }
    } else {
        Write-Log '尚未有本地 origin 引用，跳过 rebase'
    }
}

# ---------- 3) 推送未推送的提交（带重试）----------
$pendingCount = if ($haveRemote) { Get-GitCount ("rev-list --count origin/$branch..HEAD") } else { 0 }
if ($pendingCount -le 0) {
    Write-Log '无待推送提交。'
} else {
    Write-Log ("检测到 {0} 个待推送提交，开始推送..." -f $pendingCount)
    $ok = $false
    for ($i = 1; $i -le $AttemptsPerRun; $i++) {
        $p = Invoke-Git ('push origin ' + $branch)
        if ($p.Ok) {
            Write-Log '推送成功'
            $ok = $true
            Send-Notice 'chm-web 推送成功' ("已自动推送 " + $pendingCount + " 个提交到 GitHub（" + $branch + " 分支）")
            break
        }
        if ($i -lt $AttemptsPerRun) {
            Write-Log ("  第 {0}/{1} 次推送失败，{2} 秒后重试。" -f $i, $AttemptsPerRun, $RetryDelaySec)
            Start-Sleep -Seconds $RetryDelaySec
        } else {
            Write-Log ('本轮仍推送失败，留给下一次。')
        }
    }
}

Write-Log '===== 同步结束 ====='