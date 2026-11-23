/**
 * 待办提醒：纯逻辑，主进程与界面共用。
 *
 * 设计要点：
 * - remindAt 是本地时间戳（毫秒），由界面用「日期 + 时间」拼出来
 * - notifiedAt 记下已经提醒过的时刻，避免同一条反复弹
 * - 完成的任务保留几天给用户看，之后自动清理（在读取时过滤，不改数据）
 */

export type TodoItem = {
  id: string;
  title: string;
  /** 提醒时刻（本地时区换算好的毫秒时间戳） */
  remindAt: number;
  done: boolean;
  doneAt: number | null;
  createdAt: number;
  /** 已经提醒过的时刻；null 表示还没提醒 */
  notifiedAt: number | null;
};

/** 完成后还留在列表里多久 */
export const COMPLETED_KEEP_MS = 3 * 24 * 60 * 60 * 1000;
/** 开机后多久之内算「该补提醒」的过期任务 */
export const OVERDUE_GRACE_MS = 12 * 60 * 60 * 1000;

export function visibleTodos(todos: TodoItem[], now: number): TodoItem[] {
  const kept = todos.filter((todo) => {
    if (!todo.done) return true;
    const at = todo.doneAt ?? todo.remindAt;
    return now - at < COMPLETED_KEEP_MS;
  });

  return [...kept].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.remindAt !== b.remindAt) return a.remindAt - b.remindAt;
    return a.createdAt - b.createdAt;
  });
}

/**
 * 这一轮该弹出来的提醒：已到点、没提醒过、还没完成。
 * 过点太久的（超过 OVERDUE_GRACE_MS）不再弹，避免一开机轰炸一堆陈年旧事。
 */
export function dueTodos(todos: TodoItem[], now: number): TodoItem[] {
  return todos.filter((todo) => {
    if (todo.done || todo.notifiedAt !== null) return false;
    if (todo.remindAt > now) return false;
    return now - todo.remindAt <= OVERDUE_GRACE_MS;
  });
}

/** 下一次需要唤醒的提醒时刻；没有就返回 null */
export function nextReminderAt(todos: TodoItem[], now: number): number | null {
  let next: number | null = null;
  for (const todo of todos) {
    if (todo.done || todo.notifiedAt !== null) continue;
    if (todo.remindAt <= now) continue;
    if (next === null || todo.remindAt < next) next = todo.remindAt;
  }
  return next;
}

export function pendingCount(todos: TodoItem[]): number {
  return todos.filter((todo) => !todo.done).length;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 人性化时间：「今天 14:00」「明天 09:30」「周三 18:00」「11/26 10:00」。
 * 已经过期的会在前面加「已过期」由调用方决定怎么显示。
 */
export function describeRemindAt(ts: number, now: number, language: string): string {
  const target = new Date(ts);
  const clock = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
  const zh = language.toLowerCase().startsWith("zh");

  const dayDiff = Math.round((startOfDay(ts) - startOfDay(now)) / (24 * 60 * 60 * 1000));
  if (dayDiff === 0) return zh ? `今天 ${clock}` : `Today ${clock}`;
  if (dayDiff === 1) return zh ? `明天 ${clock}` : `Tomorrow ${clock}`;
  if (dayDiff === -1) return zh ? `昨天 ${clock}` : `Yesterday ${clock}`;
  if (dayDiff > 1 && dayDiff <= 6) {
    const weekday = (zh ? WEEKDAYS_ZH : WEEKDAYS_EN)[target.getDay()];
    return `${weekday} ${clock}`;
  }
  const date = `${target.getMonth() + 1}/${target.getDate()}`;
  return `${date} ${clock}`;
}

/** 从界面上的 date / time 输入拼出时间戳；无效返回 null */
export function composeRemindAt(date: string, time: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  const stamp = new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
  if (!Number.isFinite(stamp)) return null;
  // 2 月 31 日这种会被 Date 顺延，回读校验一下
  if (new Date(stamp).getDate() !== day) return null;
  return stamp;
}

/** 时间戳拆回 date / time 输入需要的字符串 */
export function splitRemindAt(ts: number): { date: string; time: string } {
  const target = new Date(ts);
  const date = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
  const time = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
  return { date, time };
}
