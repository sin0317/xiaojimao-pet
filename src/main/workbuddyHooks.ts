/**
 * 多 agent 接入：把桌宠的「任务状态桥」写进各家 agent 的钩子配置。
 *
 * 目前支持：
 *   - WorkBuddy  ~/.workbuddy/settings.json   （Git Bash 执行）
 *   - Qoder      ~/.qoder/settings.json       （PowerShell 执行）
 *   - Trae       ~/.trae-cn/hooks.json        （PowerShell 执行）
 *
 * 三家的事件名都是 Claude Code 风格，区别只在配置位置、执行 shell 和支持的事件集合。
 * 钩子只做一件事：把 stdin 的 JSON 落到 ~/.xiaojimao/workbuddy-events/<agent>/ 里。
 *
 * 只增删自己那几条（command 里带 xiaojimao-status 标记），
 * 其它用户已有钩子原样保留；写盘前先做一次带时间戳的备份。
 */

import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentHookTarget, AgentIntegration } from "../shared/workbuddy";

export const WORKBUDDY_HOOK_SCRIPT_NAME = "xiaojimao-status.sh";
export const AGENT_HOOK_SCRIPT_NAME = "xiaojimao-status.ps1";
export const AGENT_APPROVAL_SCRIPT_NAME = "xiaojimao-approve.ps1";
export const WORKBUDDY_HOOK_MARKER = "xiaojimao-status";
export const AGENT_APPROVAL_MARKER = "xiaojimao-approve";
const BACKUP_LIMIT = 3;

type HookEntry = {
  type: string;
  command: string;
  timeout?: number;
  shell?: string;
};

type HookGroup = {
  matcher: string;
  hooks: HookEntry[];
};

type HookConfig = Record<string, unknown>;

type EventSpec = {
  event: string;
  matcher: string;
  timeout: number;
  /** 用哪支脚本：状态桥，还是「等你决定」的审批桥 */
  script?: "status" | "approval";
};

export const AGENT_LABELS: Record<AgentHookTarget, string> = {
  workbuddy: "WorkBuddy",
  qoder: "Qoder",
  qoderCn: "Qoder CN",
  trae: "Trae"
};

/** 各家支持的事件不一样，多挂不认识的会报配置错误 */
const TARGET_EVENTS: Record<AgentHookTarget, EventSpec[]> = {
  workbuddy: [
    { event: "UserPromptSubmit", matcher: "", timeout: 10 },
    { event: "PreToolUse", matcher: "AskUserQuestion|ExitPlanMode", timeout: 10 },
    // 工具真的跑完了 = 刚才那个「等你选」已经被处理，必须订阅才能及时清掉
    { event: "PostToolUse", matcher: "", timeout: 10 },
    { event: "Notification", matcher: "", timeout: 10 },
    { event: "Stop", matcher: "", timeout: 10 },
    { event: "FinalStop", matcher: "", timeout: 10 },
    { event: "SessionEnd", matcher: "", timeout: 10 }
  ],
  qoder: [
    { event: "UserPromptSubmit", matcher: "", timeout: 10 },
    { event: "PreToolUse", matcher: "AskUserQuestion|ExitPlanMode", timeout: 10 },
    { event: "PostToolUse", matcher: "", timeout: 10 },
    { event: "Notification", matcher: "", timeout: 10 },
    { event: "Stop", matcher: "", timeout: 10 },
    { event: "SessionEnd", matcher: "", timeout: 10 },
    // 权限管道判定要问人之后、弹窗之前触发，可以在这里替用户回答
    { event: "PermissionRequest", matcher: "", timeout: 40, script: "approval" }
  ],
  trae: [
    // Trae 的钩子默认不执行，必须在「设置 > Hooks」里启用，且运行方式要选「本地自动运行」
    { event: "SessionStart", matcher: "", timeout: 10 },
    { event: "UserPromptSubmit", matcher: "", timeout: 10 },
    { event: "PreToolUse", matcher: "AskUserQuestion|ExitPlanMode", timeout: 10 },
    // Trae 的 Notification matcher 匹配 notification_type，空/星号表示全部
    { event: "Notification", matcher: "*", timeout: 10 },
    { event: "Stop", matcher: "", timeout: 10 }
  ],
  // Qoder CN 是独立客户端（~/.qoder-cn），事件名与 Qoder 一致。
  // 先只接状态：那个配置里已经有一份第三方 PermissionRequest 钩子，别去抢。
  qoderCn: [
    { event: "UserPromptSubmit", matcher: "", timeout: 10 },
    { event: "PreToolUse", matcher: "AskUserQuestion|ExitPlanMode", timeout: 10 },
    { event: "PostToolUse", matcher: "", timeout: 10 },
    { event: "Notification", matcher: "", timeout: 10 },
    { event: "Stop", matcher: "", timeout: 10 },
    { event: "SessionEnd", matcher: "", timeout: 10 }
  ]
};

const CORE_EVENTS = ["UserPromptSubmit", "Notification", "Stop"];

export type AgentHookPaths = {
  target: AgentHookTarget;
  label: string;
  /** 钩子配置文件 */
  settingsPath: string;
  /** 落盘脚本 */
  scriptPath: string;
  /** 审批脚本（只有支持拦截的 agent 才有实际内容） */
  approvalScriptPath: string;
  /** 事件目录（脚本写这里，桌宠读这里） */
  eventDir: string;
  /** 审批目录（脚本写请求，桌宠写答复） */
  approvalDir: string;
  /** 写进配置的命令 */
  hookCommand: string;
  /** 写进审批事件的命令 */
  approvalCommand: string;
  /** 该 agent 的配置目录是否存在 */
  detected: boolean;
};

export function resolveWorkBuddyEventDir(home = homedir()): string {
  return join(home, ".xiaojimao", "workbuddy-events");
}

/** 审批请求/答复文件放这里，桌宠每 400ms 轮询一次 */
export function resolveApprovalDir(home = homedir()): string {
  return join(home, ".xiaojimao", "workbuddy-approvals");
}

/** Windows 路径转 Git Bash 风格，供钩子脚本里使用 */
export function toBashPath(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  const drive = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (drive) return `/${drive[1].toLowerCase()}/${drive[2]}`;
  return normalized;
}

function toWindowsPath(input: string): string {
  return input.replace(/\//g, "\\");
}

export function agentHookPaths(target: AgentHookTarget, home = homedir()): AgentHookPaths {
  const eventDir = resolveWorkBuddyEventDir(home);
  const approvalDir = resolveApprovalDir(home);

  if (target === "workbuddy") {
    const dir = join(home, ".workbuddy");
    const scriptPath = join(dir, "hooks", WORKBUDDY_HOOK_SCRIPT_NAME);
    const approvalScriptPath = join(dir, "hooks", AGENT_APPROVAL_SCRIPT_NAME);
    return {
      target,
      label: AGENT_LABELS[target],
      settingsPath: join(dir, "settings.json"),
      scriptPath,
      approvalScriptPath,
      eventDir,
      approvalDir,
      hookCommand: `bash '${toBashPath(scriptPath)}'`,
      // WorkBuddy 桌面端权限在自己的原生弹窗里，钩子拿不到，留空
      approvalCommand: "",
      detected: existsSync(dir)
    };
  }

  const base =
    target === "qoder"
      ? join(home, ".qoder")
      : target === "qoderCn"
        ? join(home, ".qoder-cn")
        : join(home, ".trae-cn");
  const scriptPath = join(base, "hooks", AGENT_HOOK_SCRIPT_NAME);
  const approvalScriptPath = join(base, "hooks", AGENT_APPROVAL_SCRIPT_NAME);
  return {
    target,
    label: AGENT_LABELS[target],
    settingsPath:
      target === "trae" ? join(base, "hooks.json") : join(base, "settings.json"),
    scriptPath,
    approvalScriptPath,
    eventDir,
    approvalDir,
    hookCommand: `powershell -NoProfile -ExecutionPolicy Bypass -File "${toWindowsPath(
      scriptPath
    )}"`,
    // 只有 Qoder 的 PermissionRequest 能回答；Trae 的 Notification 是异步的，拦不住
    approvalCommand:
      target === "qoder"
        ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${toWindowsPath(approvalScriptPath)}"`
        : "",
    detected: existsSync(base)
  };
}

/** WorkBuddy 用：Git Bash 脚本，agent 体现在事件目录名上 */
export function buildStatusHookScript(eventDir: string): string {
  const bashDir = toBashPath(eventDir);
  return `#!/bin/sh
# ${WORKBUDDY_HOOK_SCRIPT_NAME} — 小鸡毛桌宠 <-> WorkBuddy 状态桥
# 由「小鸡毛桌宠」生成；在桌宠设置里点「移除接入」会删除本文件与对应钩子。
event_dir="${bashDir}"
agent="\${XIAOJIMAO_AGENT:-WorkBuddy}"
dir="$event_dir/$agent"
payload=$(cat)
[ -n "$payload" ] || exit 0
mkdir -p "$dir" 2>/dev/null
tmp="$dir/.tmp-$$-$RANDOM"
if printf '%s' "$payload" > "$tmp" 2>/dev/null; then
  mv "$tmp" "$dir/$(date +%s)-$$-$RANDOM.json" 2>/dev/null || rm -f "$tmp"
fi
# 顺手清掉三天以上的残留事件
if command -v find >/dev/null 2>&1; then
  find "$event_dir" -name '*.json' -type f -mmin +4320 -delete 2>/dev/null
fi
exit 0
`;
}

/** Qoder / Trae 用：PowerShell 脚本（这两家在 Windows 上默认用 PowerShell 跑钩子） */
export function buildPowerShellHookScript(eventDir: string, agent: string): string {
  return `# ${AGENT_HOOK_SCRIPT_NAME} — 小鸡毛桌宠 <-> ${agent} 状态桥
# 由「小鸡毛桌宠」生成；在桌宠设置里点「移除接入」会删除本文件与对应钩子。
$ErrorActionPreference = 'SilentlyContinue'
$agent = '${agent}'
$root  = '${toWindowsPath(eventDir)}'
$dir   = Join-Path $root $agent

# 宿主用重定向 stdin 传 JSON；读不到就退回 PowerShell 管道变量。
# 最多等 2 秒，任何情况下都不能把 agent 卡住。
$payload = $null
try {
  if ([Console]::IsInputRedirected) {
    $stdin = [Console]::OpenStandardInput()
    $reader = New-Object System.IO.StreamReader($stdin, [System.Text.Encoding]::UTF8)
    $task = $reader.ReadToEndAsync()
    if ($task.Wait(2000)) { $payload = $task.Result }
  }
} catch { }
if ([string]::IsNullOrWhiteSpace($payload)) {
  $payload = ($input | Out-String)
}
if ([string]::IsNullOrWhiteSpace($payload)) { exit 0 }

New-Item -ItemType Directory -Force -Path $dir | Out-Null
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$name  = "$stamp-$PID-" + ([guid]::NewGuid().ToString('N').Substring(0, 6))
$tmp   = Join-Path $dir ".tmp-$name"
$enc   = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmp, $payload.Trim(), $enc)
Move-Item -LiteralPath $tmp -Destination (Join-Path $dir "$name.json") -Force
exit 0
`;
}

/**
 * Qoder 用：权限审批桥。挂在 PermissionRequest（判定要问人之后、弹窗前），
 * 把请求丢给桌宠，等用户点「允许 / 拒绝」，再按 Qoder 的协议回话。
 * 等不到答复就什么都不输出，交回 Qoder 自己的弹窗——绝不能让 agent 卡住。
 */
export function buildApprovalScript(
  agent: string,
  eventDir: string,
  approvalDir: string,
  waitSeconds = 25
): string {
  return `# ${AGENT_APPROVAL_SCRIPT_NAME} — 小鸡毛桌宠 <-> ${agent} 权限审批桥
# 由「小鸡毛桌宠」生成；在桌宠设置里点「移除接入」会删除本文件与对应钩子。
$ErrorActionPreference = 'SilentlyContinue'
$agent        = '${agent}'
$root         = '${toWindowsPath(eventDir)}'
$approvalRoot = '${toWindowsPath(approvalDir)}'
$waitSeconds  = ${waitSeconds}

# 宿主用重定向 stdin 传 JSON；最多等 2 秒，任何情况下都不能卡住 agent
$payload = $null
try {
  if ([Console]::IsInputRedirected) {
    $stdin  = [Console]::OpenStandardInput()
    $reader = New-Object System.IO.StreamReader($stdin, [System.Text.Encoding]::UTF8)
    $task   = $reader.ReadToEndAsync()
    if ($task.Wait(2000)) { $payload = $task.Result }
  }
} catch { }
if ([string]::IsNullOrWhiteSpace($payload)) { $payload = ($input | Out-String) }
if ([string]::IsNullOrWhiteSpace($payload)) { exit 0 }

$enc = New-Object System.Text.UTF8Encoding($false)

# 顺手报一条状态，桌宠重启过也能知道「在等你」
$dir = Join-Path $root $agent
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$statusTmp = Join-Path $dir ".tmp-$stamp-$PID"
[System.IO.File]::WriteAllText($statusTmp, $payload.Trim(), $enc)
Move-Item -LiteralPath $statusTmp -Destination (Join-Path $dir "$stamp-$PID.json") -Force

# 取出工具名与参数摘要
$tool = ''
$detail = ''
try {
  $obj = $payload | ConvertFrom-Json
  $tool = [string]$obj.tool_name
  if ($null -ne $obj.tool_input) {
    $cmd = [string]$obj.tool_input.command
    if ($cmd) {
      $detail = $cmd
    } else {
      $detail = ($obj.tool_input | ConvertTo-Json -Compress -Depth 4)
    }
    if ($detail.Length -gt 160) { $detail = $detail.Substring(0, 160) + '...' }
  }
} catch { }

# 桌宠没开着就别等：心跳超过 20 秒就当作没人看，直接交回 Qoder
New-Item -ItemType Directory -Force -Path $approvalRoot | Out-Null
$alive = Join-Path $approvalRoot '.pet-alive'
$aliveFresh = $false
if (Test-Path $alive) {
  $age = ((Get-Date) - (Get-Item $alive).LastWriteTime).TotalSeconds
  if ($age -lt 20) { $aliveFresh = $true }
}
if (-not $aliveFresh) { exit 0 }

$id = "$stamp-$PID"
$req = @{
  id        = $id
  agent     = $agent
  tool      = $tool
  detail    = $detail
  at        = $stamp
  expiresAt = ($stamp + $waitSeconds)
} | ConvertTo-Json -Compress
$reqTmp = Join-Path $approvalRoot ".tmp-$id"
[System.IO.File]::WriteAllText($reqTmp, $req, $enc)
Move-Item -LiteralPath $reqTmp -Destination (Join-Path $approvalRoot "$id.req.json") -Force

# 等桌宠答复
$ansPath  = Join-Path $approvalRoot "$id.ans.json"
$deadline = (Get-Date).AddSeconds($waitSeconds)
$decision = ''
while ((Get-Date) -lt $deadline) {
  if (Test-Path $ansPath) {
    try {
      $ans = Get-Content -Raw $ansPath | ConvertFrom-Json
      $decision = [string]$ans.decision
    } catch { }
    break
  }
  Start-Sleep -Milliseconds 200
}
Remove-Item -LiteralPath $ansPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $approvalRoot "$id.req.json") -Force -ErrorAction SilentlyContinue

# 没等到答复：不输出、正常退出，把决定权还给 Qoder
if ($decision -ne 'allow' -and $decision -ne 'deny') { exit 0 }

$reason = ''
if ($decision -eq 'allow') { $reason = '在桌宠上点了允许' } else { $reason = '在桌宠上点了拒绝' }
$out = @{
  hookSpecificOutput = @{
    hookEventName = 'PermissionRequest'
    decision      = @{ behavior = $decision; message = $reason }
  }
} | ConvertTo-Json -Compress -Depth 5
Write-Output $out
exit 0
`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entryUsesOurHook(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((hook) => {
    if (!isRecord(hook)) return false;
    const command = String(hook.command ?? "");
    return (
      command.includes(WORKBUDDY_HOOK_MARKER) || command.includes(AGENT_APPROVAL_MARKER)
    );
  });
}

function hooksSection(config: Record<string, unknown>): HookConfig {
  return isRecord(config.hooks) ? { ...config.hooks } : {};
}

function hookEntryFor(
  target: AgentHookTarget,
  hookCommand: string,
  timeout: number
): HookEntry {
  if (target === "workbuddy") {
    return { type: "command", command: hookCommand, timeout };
  }
  // Qoder 支持 shell 字段；Trae 忽略未知字段，写上也无害
  return { type: "command", command: hookCommand, timeout, shell: "powershell" };
}

/** 合并前先剔掉自己旧的钩子，避免重复叠加 */
export function mergeAgentHooks(
  config: Record<string, unknown>,
  target: AgentHookTarget,
  hookCommand: string,
  approvalCommand = ""
): Record<string, unknown> {
  const hooks = hooksSection(config);

  for (const spec of TARGET_EVENTS[target]) {
    const command = spec.script === "approval" ? approvalCommand : hookCommand;
    // 没有审批命令的（WorkBuddy / Trae）就跳过这类事件，别写进配置
    if (!command) continue;

    const current = Array.isArray(hooks[spec.event]) ? (hooks[spec.event] as unknown[]) : [];
    const kept = current.filter((item) => !entryUsesOurHook(item));
    const group: HookGroup = {
      matcher: spec.matcher,
      hooks: [hookEntryFor(target, command, spec.timeout)]
    };
    hooks[spec.event] = [...kept, group];
  }

  return { ...config, hooks };
}

/** 兼容旧调用：WorkBuddy 的合并 */
export function mergeWorkBuddyHooks(
  config: Record<string, unknown>,
  hookCommand: string
): Record<string, unknown> {
  return mergeAgentHooks(config, "workbuddy", hookCommand);
}

export function removeWorkBuddyHooks(config: Record<string, unknown>): Record<string, unknown> {
  const hooks = hooksSection(config);

  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((entry) => !entryUsesOurHook(entry));
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }

  const next = { ...config };
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

export function hasAgentHooks(
  config: Record<string, unknown>,
  target: AgentHookTarget = "workbuddy"
): boolean {
  const hooks = config.hooks;
  if (!isRecord(hooks)) return false;
  const core = TARGET_EVENTS[target].filter((spec) => CORE_EVENTS.includes(spec.event));
  return core.every((spec) => {
    const entries = hooks[spec.event];
    return Array.isArray(entries) && entries.some((entry) => entryUsesOurHook(entry));
  });
}

/** 兼容旧调用 */
export function hasWorkBuddyHooks(config: Record<string, unknown>): boolean {
  return hasAgentHooks(config, "workbuddy");
}

function timestampSuffix(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

async function readConfigFile(settingsPath: string): Promise<{
  config: Record<string, unknown> | null;
  exists: boolean;
  error: string | null;
}> {
  if (!existsSync(settingsPath)) return { config: {}, exists: false, error: null };
  try {
    const raw = await readFile(settingsPath, "utf8");
    if (!raw.trim()) return { config: {}, exists: true, error: null };
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return { config: null, exists: true, error: "配置文件顶层不是对象" };
    }
    return { config: parsed, exists: true, error: null };
  } catch (error) {
    return {
      config: null,
      exists: true,
      error: `无法解析配置：${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function backupSettings(settingsPath: string): Promise<void> {
  const backupPath = `${settingsPath}.xiaojimao-${timestampSuffix()}`;
  await copyFile(settingsPath, backupPath).catch(() => undefined);

  try {
    const dir = dirname(settingsPath);
    const fileName = settingsPath.split(/[\\/]/).pop() ?? "";
    const prefix = `${fileName}.xiaojimao-`;
    const names = (await readdir(dir)).filter((name) => name.startsWith(prefix)).sort();
    for (const name of names.slice(0, Math.max(0, names.length - BACKUP_LIMIT))) {
      await unlink(join(dir, name)).catch(() => undefined);
    }
  } catch {
    // 备份清理失败不影响主流程
  }
}

async function writeConfigFile(settingsPath: string, config: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.xiaojimao-tmp-${process.pid}`;
  await writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(tmpPath, settingsPath);
}

function integrationOf(
  paths: AgentHookPaths,
  installed: boolean,
  error: string | null
): AgentIntegration {
  return {
    id: paths.target,
    label: paths.label,
    settingsPath: paths.settingsPath,
    scriptPath: paths.scriptPath,
    eventDir: paths.eventDir,
    installed,
    detected: paths.detected,
    error,
    checkedAt: Date.now()
  };
}

async function writeScript(paths: AgentHookPaths): Promise<void> {
  await mkdir(dirname(paths.scriptPath), { recursive: true });
  const body =
    paths.target === "workbuddy"
      ? buildStatusHookScript(paths.eventDir)
      : buildPowerShellHookScript(paths.eventDir, paths.label);
  await writeFile(paths.scriptPath, body, "utf8");
  await chmod(paths.scriptPath, 0o755).catch(() => undefined);

  // 只有能回答权限的 agent 才需要审批脚本
  if (!paths.approvalCommand) return;
  const approvalBody = buildApprovalScript(paths.label, paths.eventDir, paths.approvalDir);
  await writeFile(paths.approvalScriptPath, approvalBody, "utf8");
  await chmod(paths.approvalScriptPath, 0o755).catch(() => undefined);
}

export async function installAgentHooks(
  target: AgentHookTarget,
  home = homedir()
): Promise<AgentIntegration> {
  const paths = agentHookPaths(target, home);
  try {
    await writeScript(paths);
    await mkdir(join(paths.eventDir, paths.label), { recursive: true });

    const { config, error } = await readConfigFile(paths.settingsPath);
    if (!config) return integrationOf(paths, false, error);

    const merged = mergeAgentHooks(config, target, paths.hookCommand, paths.approvalCommand);
    if (existsSync(paths.settingsPath)) await backupSettings(paths.settingsPath);
    await writeConfigFile(paths.settingsPath, merged);

    return integrationOf(paths, hasAgentHooks(merged, target), null);
  } catch (error) {
    return integrationOf(paths, false, error instanceof Error ? error.message : String(error));
  }
}

export async function uninstallAgentHooks(
  target: AgentHookTarget,
  home = homedir()
): Promise<AgentIntegration> {
  const paths = agentHookPaths(target, home);
  try {
    const { config, error } = await readConfigFile(paths.settingsPath);
    if (!config) return integrationOf(paths, false, error);

    if (existsSync(paths.settingsPath)) {
      await backupSettings(paths.settingsPath);
      await writeConfigFile(paths.settingsPath, removeWorkBuddyHooks(config));
    }
    await unlink(paths.scriptPath).catch(() => undefined);

    return integrationOf(paths, false, null);
  } catch (error) {
    return integrationOf(paths, false, error instanceof Error ? error.message : String(error));
  }
}

export async function detectAgentIntegration(
  target: AgentHookTarget,
  home = homedir()
): Promise<AgentIntegration> {
  const paths = agentHookPaths(target, home);
  const { config, error } = await readConfigFile(paths.settingsPath);
  return integrationOf(paths, Boolean(config && hasAgentHooks(config, target)), error);
}

export const SUPPORTED_AGENT_TARGETS: AgentHookTarget[] = ["workbuddy", "qoder", "qoderCn", "trae"];

export async function detectAllAgents(home = homedir()): Promise<AgentIntegration[]> {
  return Promise.all(SUPPORTED_AGENT_TARGETS.map((target) => detectAgentIntegration(target, home)));
}

/* ---------- 兼容旧导出 ---------- */

export function workBuddyPaths(home = homedir()): AgentHookPaths {
  return agentHookPaths("workbuddy", home);
}

export async function installWorkBuddyHooks(home = homedir()): Promise<AgentIntegration> {
  return installAgentHooks("workbuddy", home);
}

export async function uninstallWorkBuddyHooks(home = homedir()): Promise<AgentIntegration> {
  return uninstallAgentHooks("workbuddy", home);
}

export async function detectWorkBuddyIntegration(home = homedir()): Promise<AgentIntegration> {
  return detectAgentIntegration("workbuddy", home);
}
