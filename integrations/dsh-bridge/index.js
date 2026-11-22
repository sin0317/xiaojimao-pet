/**
 * dsh-xiaojimao-bridge — 把 DeepSeek Harness 的会话事件写成小鸡毛桌宠能读的状态文件。
 *
 * 只做一件事：监听宿主的 `session/event`，把 turn/start、approval/asked、turn/end
 * 转成和 Claude 风格钩子同构的 JSON，落到 ~/.xiaojimao/workbuddy-events/DeepSeek Harness/。
 * 桌宠那边每 0.8 秒消费一次，不监听端口、不联网。
 *
 * 所有写入都包在 try/catch 里：插件出错绝不能拖累宿主。
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const name = "dsh-xiaojimao-bridge";

const AGENT = "DeepSeek Harness";

function eventDir() {
  return join(homedir(), ".xiaojimao", "workbuddy-events", AGENT);
}

function emit(payload) {
  try {
    const dir = eventDir();
    mkdirSync(dir, { recursive: true });
    const stamp = Date.now();
    const unique = `${process.pid}-${Math.floor(Math.random() * 1_000_000)}`;
    const tmpPath = join(dir, `.tmp-${stamp}-${unique}`);
    const filePath = join(dir, `${stamp}-${unique}.json`);
    writeFileSync(tmpPath, JSON.stringify(payload), "utf8");
    // 先写临时文件再改名，桌宠不会读到半截 JSON
    renameSync(tmpPath, filePath);
  } catch {
    // 落盘失败就算了，不能影响会话
  }
}

/** 子代理与深层委派的事件一律不发，避免一次任务弹好几条 */
function shouldSkip(session) {
  try {
    const header = session?.header ?? {};
    if (header.origin === "subagent") return true;
    if (Number(header.delegationDepth) > 0) return true;
    return false;
  } catch {
    return false;
  }
}

function sessionInfo(session) {
  const header = session?.header ?? {};
  const id = String(header.id ?? session?.id ?? "dsh");
  const cwd = header.cwd ?? session?.cwd ?? header.workspace ?? header.workspaceRoot ?? "";
  return { id, cwd: typeof cwd === "string" ? cwd : "" };
}

function handle(session, event) {
  const type = event?.type;
  if (!type) return;
  if (shouldSkip(session)) return;

  const { id, cwd } = sessionInfo(session);
  const base = { session_id: id, cwd, agent: AGENT, client: AGENT };

  if (type === "turn/start") {
    emit({ ...base, hook_event_name: "UserPromptSubmit" });
    return;
  }

  if (type === "approval/asked") {
    // 复用询问工具的事件名，桌宠那边就能识别成「等你选」
    emit({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      reason: event?.data?.reason
    });
    return;
  }

  if (type === "turn/end") {
    const kind = event?.data?.reason?.kind;
    if (kind === "aborted") return;
    emit({
      ...base,
      hook_event_name: "Stop",
      last_assistant_message: kind === "error" ? String(event?.data?.reason?.error?.message ?? "") : ""
    });
  }
}

export function apply(ctx) {
  // 加载标记：桌宠只看 .json，这个文件用来确认插件真的被宿主装上了
  try {
    const dir = eventDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".plugin-loaded"), new Date().toISOString(), "utf8");
  } catch {
    // 标记写不了不影响功能
  }

  ctx.effect(() => {
    const dispose = ctx.on("session/event", (session, event) => {
      try {
        handle(session, event);
      } catch {
        // 任何异常都吞掉，插件不能把宿主带崩
      }
    });
    return () => {
      try {
        dispose?.();
      } catch {
        // ignore
      }
    };
  });
}
