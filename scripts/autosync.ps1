# 
# chm-web 本地自动同步脚本
# 作用：每轮做 提交(commit) + 拉取(fetch/rebase) + 推送(push)，
# 网络很差时失败也不报错，留到下一轮再试（该脚本由“计划任务”每隔几分钟跑一次）。
# 仅处理这一个仓库（脚本所在目录），不做全局扫描。
# 由 Windows 计划任务调用，窗口由 vbs 隐藏。
#
# 用法:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "...\autosync.ps1"
# 开关:
#   -AttemptsPerRun N   每次 run 每个仓库最多尝试几次 push（默认 3）
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

# 捕获 git 输出，不抛错
function Invoke-Git {
    param([string]$Args, [string]$Cwd = $Repo)
    $out = & git -C $Cwd $Args 2>&1 | Out-String
    return @{ Ok = ($LASTEXITCODE -eq 0); Out = ($out -replace "\s+$","") }
}

# ---- 推送成功桌面提醒（一次性，不阻塞）----
# 注意：计划任务通过 vbs 隐藏窗口启动，NotifyIcon 放到一个临时的 hidden
# PowerShell 进程里足够弹出气泡；但若当前没有交互式桌面(锁屏/无人登录)，会失败并被忽略。
function Send-Notice {
    param([string]$Title, [string]$Text)
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
        if (-not ('System.Windows.Forms.NotifyIcon' -as [type])) { return }
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
$status = & git -C $Repo status --porcelain 2>$null
if ($LASTEXITCODE -ne 0) { Write-Log 'git status 失败，退出'; exit 0 }
if ([string]::IsNullOrWhiteSpace(($status -join "`n"))) {
    Write-Log '无未提交改动，跳过 commit'
} else {
    if ($DiscoverOnly) {
        Write-Log ('[Discover] 有改动待提交：' + (($status | Select-Object -First 3) -join '; '))
    } else {
        & git -C $Repo add -A 2>&1 | Out-Host
        $commitMsg = 'auto: 本地改动自动提交 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
        & git -C $Repo commit -m $commitMsg 2>&1 | Out-Host
        if ($LASTEXITCODE -eq 0) { Write-Log "提交完成: $commitMsg" }
        else { Write-Log '提交失败（可能无可提交内容）' }
    }
}

if ($DiscoverOnly) { Write-Log '[Discover] 不执行 fetch/push。'; Write-Log '==== end (Discover) ===='; exit 0 }

# ---------- 2) 拉取远端（fetch + rebase），失败就跳过 ----------
# 网络极差的机器上，git fetch 常会中途断；这里用 first-parent 单测对象绝对路径，避免误判。
$branch = (& git -C $Repo symbolic-ref --short HEAD 2>$null)
if (-not $branch) { $branch = 'main' }
$haveRemote = & git -C $Repo show-ref --verify -q "refs/remotes/origin/$branch" 2>$null; $haveRemote = ($LASTEXITCODE -eq 0)

$f = Invoke-Git ('fetch origin ' + $branch)
if (-not $f.Ok) {
    Write-Log ("拉取失败（网络不通？），本轮跳过。 " + $f.Out)
} else {
    # 检测 rebase 未完成则先放弃（一向冲突自动放弃）
    $inRebase = Test-Path (Join-Path $Repo '.git/rebase-merge')
    if ($inRebase) { & git -C $Repo rebase --abort 2>&1 | Out-Host }
    if ($haveRemote) {
        $r = Invoke-Git ('rebase origin/' + $branch)
        if ($r.Ok) { Write-Log 'rebase 完成' }
        else { Write-Log ("rebase 失败（留给处理）：" + $r.Out) }
    } else {
        Write-Log '尚未有本地 origin 引用，跳过 rebase'
    }
}

# ---------- 3) 推送未推送的提交（带重试）----------
# 仅在确实有远端引用时才统计并推送；绝不能让 git help 的输出或某个
# “对象不存在”的误读干扰计数，更不要在缺少 origin 时盲目 push。
$pendingCount = 0
if ($haveRemote) {
    $pending = Invoke-Git ("rev-list --count origin/$branch..HEAD")
    $pendingCount = if ($pending.Ok) { try { [int]$pending.Out } catch { 0 } } else { 0 }
} else {
    Write-Log '未找到远端引用，不计算待推送数（可能首次/克隆后未 fetch）。'
}
if ($pendingCount -le 0) {
    Write-Log '无待推送提交。'
} else {
    Write-Log ("检测到 {0} 个待推送提交，开始推送..." -f $pendingCount)
    $pushed = $false
    for ($i = 1; $i -le $AttemptsPerRun; $i++) {
        $p = Invoke-Git ('push origin ' + $branch)
        if ($p.Ok) {
            Write-Log ('推送成功: ' + $p.Out)
            $pushed = $true
            Send-Notice 'chm-web 推送成功' ("已自动推送 " + $pendingCount + " 个提交到 GitHub（" + $branch + " 分支）")
            break
        }
        if ($i -lt $AttemptsPerRun) {
            Write-Log ("  第 {0}/{1} 次推送失败，{2} 秒后重试: {3}" -f $i,$AttemptsPerRun,$RetryDelaySec,$p.Out)
            Start-Sleep -Seconds $RetryDelaySec
        } else {
            Write-Log ("本轮仍推送失败，留给下一次：{0}" -f $p.Out)
        }
    }
}

Write-Log '===== 同步结束 ====='