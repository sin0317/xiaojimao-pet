/**
 * WorkBuddy 接入：把桌宠的「任务状态桥」写进 ~/.workbuddy/settings.json。
 *
 * 只增删自己那几条钩子（command 里带 xiaojimao-status.sh 标记），
 * 其它用户已有钩子原样保留；写盘前先做一次带时间戳的备份。
 *
 * 之所以用「钩子写文件、桌宠读文件」而不是本地 HTTP 端口：
 * 不需要监听端口、不触发防火墙询问，钩子脚本也只是一次 printf + mv。
 */

import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { WorkBuddyIntegration } from "../shared/workbuddy";

export const WORKBUDDY_HOOK_SCRIPT_NAME = "xiaojimao-status.sh";
export const WORKBUDDY_HOOK_MARKER = WORKBUDDY_HOOK_SCRIPT_NAME;
const BACKUP_LIMIT = 3;

export type WorkBuddyPaths = {
  workBuddyDir: string;
  settingsPath: string;
  hooksDir: string;
  scriptPath: string;
  eventDir: string;
  hookCommand: string;
};

type HookCommandConfig = {
  type: string;
  command: string;
  timeout?: number;
};

type HookMatcherConfig = {
  matcher: string;
  hooks: HookCommandConfig[];
};

type HookConfig = Record<string, unknown>;

/** 需要挂载的事件。matcher 只对 PreToolUse / PostToolUse 生效。 */
const HOOK_EVENTS: Array<{ event: string; matcher: string; timeout: number }> = [
  { event: "UserPromptSubmit", matcher: "", timeout: 10 },
  { event: "PreToolUse", matcher: "AskUserQuestion|ExitPlanMode", timeout: 10 },
  { event: "Notification", matcher: "", timeout: 10 },
  { event: "Stop", matcher: "", timeout: 10 },
  { event: "FinalStop", matcher: "", timeout: 10 },
  { event: "SessionEnd", matcher: "", timeout: 10 }
];

const CORE_HOOK_EVENTS = ["UserPromptSubmit", "Notification", "Stop"];

export function resolveWorkBuddyEventDir(home = homedir()): string {
  return join(home, ".xiaojimao", "workbuddy-events");
}

/** Windows 路径转 Git Bash 风格，供钩子脚本里使用 */
export function toBashPath(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  const drive = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (drive) return `/${drive[1].toLowerCase()}/${drive[2]}`;
  return normalized;
}

export function workBuddyPaths(home = homedir()): WorkBuddyPaths {
  const workBuddyDir = join(home, ".workbuddy");
  const hooksDir = join(workBuddyDir, "hooks");
  const scriptPath = join(hooksDir, WORKBUDDY_HOOK_SCRIPT_NAME);
  return {
    workBuddyDir,
    settingsPath: join(workBuddyDir, "settings.json"),
    hooksDir,
    scriptPath,
    eventDir: resolveWorkBuddyEventDir(home),
    hookCommand: `bash '${toBashPath(scriptPath)}'`
  };
}

export function buildStatusHookScript(eventDir: string): string {
  const bashDir = toBashPath(eventDir);
  return `#!/bin/sh
# ${WORKBUDDY_HOOK_SCRIPT_NAME} — 小鸡毛桌宠 <-> WorkBuddy 状态桥
# 由「小鸡毛桌宠」生成；在桌宠设置里点「移除接入」会删除本文件与对应钩子。
event_dir="${bashDir}"
payload=$(cat)
[ -n "$payload" ] || exit 0
mkdir -p "$event_dir" 2>/dev/null
tmp="$event_dir/.tmp-$$-$RANDOM"
if printf '%s' "$payload" > "$tmp" 2>/dev/null; then
  mv "$tmp" "$event_dir/$(date +%s)-$$-$RANDOM.json" 2>/dev/null || rm -f "$tmp"
fi
# 顺手清掉三天以上的残留事件
if command -v find >/dev/null 2>&1; then
  find "$event_dir" -name '*.json' -type f -mmin +4320 -delete 2>/dev/null
fi
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
  return hooks.some((hook) => isRecord(hook) && String(hook.command ?? "").includes(WORKBUDDY_HOOK_MARKER));
}

function hooksSection(config: Record<string, unknown>): HookConfig {
  return isRecord(config.hooks) ? { ...config.hooks } : {};
}

/** 合并前先剔掉自己旧的钩子，避免重复叠加 */
export function mergeWorkBuddyHooks(
  config: Record<string, unknown>,
  hookCommand: string
): Record<string, unknown> {
  const hooks = hooksSection(config);

  for (const spec of HOOK_EVENTS) {
    const current = Array.isArray(hooks[spec.event]) ? (hooks[spec.event] as unknown[]) : [];
    const kept = current.filter((entry) => !entryUsesOurHook(entry));
    const entry: HookMatcherConfig = {
      matcher: spec.matcher,
      hooks: [{ type: "command", command: hookCommand, timeout: spec.timeout }]
    };
    hooks[spec.event] = [...kept, entry];
  }

  return { ...config, hooks };
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

export function hasWorkBuddyHooks(config: Record<string, unknown>): boolean {
  const hooks = config.hooks;
  if (!isRecord(hooks)) return false;
  return CORE_HOOK_EVENTS.every((event) => {
    const entries = hooks[event];
    return Array.isArray(entries) && entries.some((entry) => entryUsesOurHook(entry));
  });
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
      return { config: null, exists: true, error: "settings.json 顶层不是对象" };
    }
    return { config: parsed, exists: true, error: null };
  } catch (error) {
    return {
      config: null,
      exists: true,
      error: `无法解析 settings.json：${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function backupSettings(settingsPath: string): Promise<void> {
  const backupPath = `${settingsPath}.xiaojimao-${timestampSuffix()}`;
  await copyFile(settingsPath, backupPath).catch(() => undefined);

  try {
    const dir = dirname(settingsPath);
    const prefix = "settings.json.xiaojimao-";
    const names = (await readdir(dir)).filter((name) => name.startsWith(prefix)).sort();
    for (const name of names.slice(0, Math.max(0, names.length - BACKUP_LIMIT))) {
      await unlink(join(dir, name)).catch(() => undefined);
    }
  } catch {
    // 备份清理失败不影响主流程
  }
}

async function writeConfigFile(settingsPath: string, config: Record<string, unknown>): Promise<void> {
  const tmpPath = `${settingsPath}.xiaojimao-tmp-${process.pid}`;
  await writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(tmpPath, settingsPath);
}

export async function installWorkBuddyHooks(home = homedir()): Promise<WorkBuddyIntegration> {
  const paths = workBuddyPaths(home);
  const base: WorkBuddyIntegration = {
    settingsPath: paths.settingsPath,
    scriptPath: paths.scriptPath,
    eventDir: paths.eventDir,
    installed: false,
    workBuddyDetected: existsSync(paths.workBuddyDir),
    error: null,
    checkedAt: Date.now()
  };

  try {
    await mkdir(paths.hooksDir, { recursive: true });
    await mkdir(paths.eventDir, { recursive: true });
    await writeFile(paths.scriptPath, buildStatusHookScript(paths.eventDir), "utf8");
    await chmod(paths.scriptPath, 0o755).catch(() => undefined);

    const { config, error } = await readConfigFile(paths.settingsPath);
    if (!config) return { ...base, error };

    const merged = mergeWorkBuddyHooks(config, paths.hookCommand);
    if (existsSync(paths.settingsPath)) await backupSettings(paths.settingsPath);
    await writeConfigFile(paths.settingsPath, merged);

    return { ...base, installed: hasWorkBuddyHooks(merged), checkedAt: Date.now() };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
      checkedAt: Date.now()
    };
  }
}

export async function uninstallWorkBuddyHooks(home = homedir()): Promise<WorkBuddyIntegration> {
  const paths = workBuddyPaths(home);
  const base: WorkBuddyIntegration = {
    settingsPath: paths.settingsPath,
    scriptPath: paths.scriptPath,
    eventDir: paths.eventDir,
    installed: false,
    workBuddyDetected: existsSync(paths.workBuddyDir),
    error: null,
    checkedAt: Date.now()
  };

  try {
    const { config, error } = await readConfigFile(paths.settingsPath);
    if (!config) return { ...base, error };

    if (existsSync(paths.settingsPath)) {
      const cleaned = removeWorkBuddyHooks(config);
      await backupSettings(paths.settingsPath);
      await writeConfigFile(paths.settingsPath, cleaned);
    }
    await unlink(paths.scriptPath).catch(() => undefined);

    return { ...base, installed: false, checkedAt: Date.now() };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
      checkedAt: Date.now()
    };
  }
}

export async function detectWorkBuddyIntegration(home = homedir()): Promise<WorkBuddyIntegration> {
  const paths = workBuddyPaths(home);
  const { config, error } = await readConfigFile(paths.settingsPath);
  return {
    settingsPath: paths.settingsPath,
    scriptPath: paths.scriptPath,
    eventDir: paths.eventDir,
    installed: Boolean(config && hasWorkBuddyHooks(config)),
    workBuddyDetected: existsSync(paths.workBuddyDir),
    error,
    checkedAt: Date.now()
  };
}
