/**
 * WorkBuddy 任务状态模型。
 *
 * WorkBuddy 通过 hooks（~/.workbuddy/settings.json）把对话生命周期事件写成
 * 一个个 JSON 文件放进事件目录，桌宠读取这些事件，折算成三种状态：
 *   - running    正在任务
 *   - needsInput 需选择（等你确认 / 等你回答）
 *   - done       已完成
 *
 * 这个模块不依赖 Node API，主进程和渲染进程都能直接用。
 */

export type WorkBuddyPhase = "running" | "needsInput" | "done";

export type WorkBuddyHookPayload = {
  session_id?: unknown;
  hook_event_name?: unknown;
  cwd?: unknown;
  prompt?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
  last_assistant_message?: unknown;
  final_stop_reason?: unknown;
  stop_hook_active?: unknown;
  reason?: unknown;
  /** 通知类事件的附加字段，用来判断是不是真的在等人 */
  notification_type?: unknown;
  type?: unknown;
  message?: unknown;
  notification?: unknown;
  text?: unknown;
  /** 部分宿主会带 client / agent 字段，用来标记来源 */
  client?: unknown;
  agent?: unknown;
};

export type WorkBuddySession = {
  id: string;
  phase: WorkBuddyPhase;
  /** 事件来源 agent 的展示名，例如 WorkBuddy / Qoder / Trae */
  agent: string;
  /** 项目目录名，例如 PawPal */
  project: string;
  /** 最近一次任务摘要，用于气泡展示 */
  title: string;
  updatedAt: number;
  /** 收到「需选择」事件的时间；非空且未过期时优先展示 needsInput */
  needsInputAt: number | null;
};

export type WorkBuddyStatus = {
  phase: WorkBuddyPhase | "idle";
  sessions: WorkBuddySession[];
  runningCount: number;
  needsInputCount: number;
  updatedAt: number | null;
};

export type AgentHookTarget = "workbuddy" | "qoder" | "qoderCn" | "trae";

export type AgentIntegration = {
  id: AgentHookTarget;
  /** 展示名，例如 WorkBuddy / Qoder / Trae */
  label: string;
  settingsPath: string;
  scriptPath: string;
  eventDir: string;
  installed: boolean;
  /** 本机是否存在该 agent 的配置目录 */
  detected: boolean;
  error: string | null;
  checkedAt: number;
};

export const WORKBUDDY_NEEDS_INPUT_TTL_MS = 10 * 60 * 1000;
/**
 * 「问完就停」的短窗口：只有在这个窗口内的 Stop 才算「用户还没回答」。
 * 超过它再 Stop，说明中间已经处理过了，不能再挂「等你选」。
 */
export const WORKBUDDY_NEEDS_INPUT_LATCH_MS = 2 * 60 * 1000;
export const WORKBUDDY_SESSION_TTL_MS = 3 * 60 * 60 * 1000;
export const WORKBUDDY_DONE_TTL_MS = 30 * 60 * 1000;
export const WORKBUDDY_MAX_SESSIONS = 5;
/** 任务刚起步的这段窗口里，没说清楚的通知一律当噪音丢掉 */
export const WORKBUDDY_STARTUP_GRACE_MS = 2500;

export const EMPTY_WORKBUDDY_STATUS: WorkBuddyStatus = {
  phase: "idle",
  sessions: [],
  runningCount: 0,
  needsInputCount: 0,
  updatedAt: null
};

/** 会把「等你选」透出来的工具名（AskUserQuestion / ExitPlanMode 等） */
const QUESTION_TOOL_PATTERN =
  /askuserquestion|ask_followup_question|ask_question|exitplanmode|request_permission|confirm|askfollowup/i;

/** 通知类事件里，能说明「真在等你」的关键词 */
const NEEDS_INPUT_PATTERN =
  /permission|approve|approval|confirm|allow|denied|waiting|needs?.{0,6}(input|attention)|requires?.{0,6}(input|approval)|需要|确认|批准|授权|等待|选择|点击/i;

/** 各 agent 写事件时可能用到的写法 → 桌面展示名 */
const AGENT_ALIASES: Record<string, string> = {
  workbuddy: "WorkBuddy",
  codebuddy: "WorkBuddy",
  qoder: "Qoder",
  qodercn: "Qoder CN",
  "qoder-cn": "Qoder CN",
  trae: "Trae",
  "trae-cn": "Trae",
  "trae cn": "Trae",
  dsh: "DeepSeek Harness",
  deepseek: "DeepSeek Harness",
  "deepseek-harness": "DeepSeek Harness",
  "deepseek harness": "DeepSeek Harness"
};

export function normalizeAgentName(raw: unknown): string {
  const text = asText(raw).trim();
  if (!text) return "WorkBuddy";
  const key = text.toLowerCase().replace(/\s+/g, " ");
  return AGENT_ALIASES[key] ?? text;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function truncateText(text: string, max = 42): string {
  const clean = collapseWhitespace(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(1, max - 1))}…`;
}

export function projectNameFromCwd(cwd: unknown): string {
  const text = asText(cwd).trim().replace(/[\\/]+$/g, "");
  if (!text) return "";
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** 从一句提示 / 回复里提炼一行摘要，顺手去掉 markdown 记号 */
export function summarizeMessage(text: string, max = 42): string {
  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) return "";
  const stripped = line
    .replace(/^#+\s*/, "")
    .replace(/^[*\-•]\s*/, "")
    .replace(/[`*_>]/g, "");
  return truncateText(stripped, max);
}

export function isQuestionTool(toolName: unknown): boolean {
  return QUESTION_TOOL_PATTERN.test(asText(toolName));
}

/**
 * 通知事件是否真的意味着「需要你介入」。
 * 返回 true = 明确要人；false = 明确不要（比如任务开始的提示音）；null = 看不出来。
 */
export function notificationNeedsInput(payload: WorkBuddyHookPayload): boolean | null {
  const type = notificationType(payload);
  if (type) {
    return /permission|approval|attention|needs?.?input|elicitation|question/i.test(type);
  }
  const message =
    asText(payload.message) || asText(payload.notification) || asText(payload.text) || asText(payload.reason);
  if (message) return NEEDS_INPUT_PATTERN.test(message);
  return null;
}

export function notificationType(payload: WorkBuddyHookPayload): string {
  return asText(payload.notification_type) || asText(payload.type);
}

/** 登录 / 切换账号成功这类系统通知，跟任务状态无关 */
export function isAuthNotification(payload: WorkBuddyHookPayload): boolean {
  return /auth|login|signin|sign_in|account/i.test(notificationType(payload));
}

/**
 * 「闲下来了」的通知：Trae / WorkBuddy 任务收尾时都会发 idle_prompt。
 * 对桌宠来说这就是任务结束——比 Stop 更稳，因为它连「被用户掐断」的情况也跟着发。
 */
export function isIdleNotification(payload: WorkBuddyHookPayload): boolean {
  return /idle/i.test(notificationType(payload));
}

export function isWorkBuddyPhase(value: unknown): value is WorkBuddyPhase {
  return value === "running" || value === "needsInput" || value === "done";
}

export type WorkBuddyEvent = {
  payload: WorkBuddyHookPayload;
  /** 事件落盘时间（ms） */
  at: number;
  /** 事件来自哪个 agent（由落盘目录决定，优先于 payload 里的字段） */
  agent?: string;
};

/**
 * 把一批 hook 事件合并进 sessions。纯函数，方便单测。
 */
export function applyWorkBuddyEvents(
  current: Record<string, WorkBuddySession>,
  events: WorkBuddyEvent[]
): Record<string, WorkBuddySession> {
  const next: Record<string, WorkBuddySession> = { ...current };
  const ordered = [...events].sort((a, b) => a.at - b.at);

  for (const { payload, at, agent: agentFromDir } of ordered) {
    const id = asText(payload.session_id);
    if (!id) continue;

    const name = asText(payload.hook_event_name);
    const project = projectNameFromCwd(payload.cwd);
    const agent = normalizeAgentName(
      asText(payload.agent) || asText(payload.client) || agentFromDir
    );

    if (name === "SessionEnd") {
      delete next[id];
      continue;
    }
    // SessionStart 只说明会话被打开（含恢复历史会话），不作为任务状态依据
    if (name === "SessionStart") {
      // 例外：Trae 每开一个任务就新建会话，旧会话被切走后不会再收到 Stop / idle，
      // 会一直以「任务中」挂着（最长 3 小时）。新会话一开，就把同 agent 的旧会话判成结束。
      if (agent === "Trae") {
        for (const [otherId, other] of Object.entries(next)) {
          if (otherId === id || other.agent !== "Trae") continue;
          if (other.phase === "done" && other.needsInputAt === null) continue;
          next[otherId] = { ...other, phase: "done", needsInputAt: null, updatedAt: at };
        }
      }
      continue;
    }

    const base: WorkBuddySession = next[id] ?? {
      id,
      phase: "running",
      agent,
      project,
      title: "",
      updatedAt: at,
      needsInputAt: null
    };
    const mergedProject = project || base.project;
    const mergedAgent = base.agent || agent;

    if (name === "UserPromptSubmit") {
      const prompt = summarizeMessage(asText(payload.prompt));
      next[id] = {
        ...base,
        agent: mergedAgent,
        project: mergedProject,
        phase: "running",
        needsInputAt: null,
        updatedAt: at,
        title: prompt || base.title
      };
      continue;
    }

    if (name === "Notification") {
      // 登录 / 切换账号：跟任务无关，但顺手把可能残留的「等你选」清掉
      // （切号会让上一轮会话直接作废，不清理的话徽标会一直挂着）
      if (isAuthNotification(payload)) {
        if (base.needsInputAt !== null) {
          next[id] = {
            ...base,
            agent: mergedAgent,
            project: mergedProject,
            needsInputAt: null,
            updatedAt: at
          };
        }
        continue;
      }

      const explicit = notificationNeedsInput(payload);

      // 「闲下来了」= 任务结束：Trae 的 Stop 有时不发（用户掐断任务时），
      // 但 idle_prompt 一定会来，用它兜底比等 Stop 靠谱。
      // 注意：正在「等你选」的会话不能被它判定成结束——问题还摆在那儿呢。
      if (isIdleNotification(payload) && base.needsInputAt === null) {
        next[id] = {
          ...base,
          agent: mergedAgent,
          project: mergedProject,
          phase: "done",
          needsInputAt: null,
          updatedAt: at
        };
        continue;
      }
      // 明确不是求助的通知（任务开始/结束的提示音）直接忽略
      if (explicit === false) continue;
      // 看不出类型时，只接受任务已经跑了一会儿之后的通知，
      // 否则开局那条提示会把状态误判成「等你选」
      if (explicit === null && at - base.updatedAt < WORKBUDDY_STARTUP_GRACE_MS) continue;

      // needsInput 是叠加态：底层 phase 保持不动，靠 needsInputAt 浮到最前
      next[id] = {
        ...base,
        agent: mergedAgent,
        project: mergedProject,
        needsInputAt: at,
        updatedAt: at
      };
      continue;
    }

    if (name === "PreToolUse" && isQuestionTool(payload.tool_name)) {
      next[id] = {
        ...base,
        agent: mergedAgent,
        project: mergedProject,
        needsInputAt: at,
        updatedAt: at
      };
      continue;
    }

    // 工具真的跑完了（或开始跑了）：说明刚才那个「等你选」已经被处理，
    // 不能靠 45 分钟的 TTL 慢慢过期，否则选完之后徽标还挂着「等你选」
    if (name === "PostToolUse" || name === "PreToolUse") {
      next[id] = {
        ...base,
        agent: mergedAgent,
        project: mergedProject,
        phase: "running",
        needsInputAt: null,
        updatedAt: at
      };
      continue;
    }

    if (name === "Stop" || name === "FinalStop") {
      // 只在「刚问完就停」这个很短的窗口里保持等你选：
      // 用户答完后模型继续跑、稍后才 Stop 的，不该再算「等你选」
      const latching =
        base.needsInputAt !== null &&
        at >= base.needsInputAt &&
        at - base.needsInputAt < WORKBUDDY_NEEDS_INPUT_LATCH_MS;
      const summary = summarizeMessage(asText(payload.last_assistant_message));
      next[id] = {
        ...base,
        agent: mergedAgent,
        project: mergedProject,
        // 刚问过问题就 Stop：用户还没回答，保持「等你选」
        phase: latching ? "needsInput" : "done",
        updatedAt: at,
        title: summary || base.title
      };
    }
  }

  return next;
}

/**
 * 把 sessions 折算成桌宠要展示的单一状态。需选择 > 正在任务 > 已完成。
 */
export function summarizeWorkBuddy(
  sessions: Record<string, WorkBuddySession>,
  now: number
): WorkBuddyStatus {
  const live: WorkBuddySession[] = [];

  for (const session of Object.values(sessions)) {
    const phase: WorkBuddyPhase =
      session.needsInputAt !== null &&
      now >= session.needsInputAt &&
      now - session.needsInputAt < WORKBUDDY_NEEDS_INPUT_TTL_MS
        ? "needsInput"
        : session.phase;
    const age = now - session.updatedAt;
    if (age < 0) {
      live.push({ ...session, phase });
      continue;
    }
    if (phase === "done" && age > WORKBUDDY_DONE_TTL_MS) continue;
    if (phase !== "done" && age > WORKBUDDY_SESSION_TTL_MS) continue;
    live.push({ ...session, phase });
  }

  const needsInput = live.filter((session) => session.phase === "needsInput");
  const running = live.filter((session) => session.phase === "running");
  const done = live.filter((session) => session.phase === "done");
  const phase: WorkBuddyStatus["phase"] = needsInput.length
    ? "needsInput"
    : running.length
      ? "running"
      : done.length
        ? "done"
        : "idle";

  live.sort((a, b) => b.updatedAt - a.updatedAt);
  const updatedAt = live.length ? live[0].updatedAt : null;

  return {
    phase,
    sessions: live.slice(0, WORKBUDDY_MAX_SESSIONS),
    runningCount: running.length,
    needsInputCount: needsInput.length,
    updatedAt
  };
}

/** 供气泡展示的首选会话：优先需要你选择的那个 */
export function primaryWorkBuddySession(
  status: WorkBuddyStatus
): WorkBuddySession | null {
  const needsInput = status.sessions.find((session) => session.phase === "needsInput");
  if (needsInput) return needsInput;
  return status.sessions[0] ?? null;
}
