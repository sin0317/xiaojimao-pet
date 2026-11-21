import type { Settings } from "./types";

/**
 * 上下班时钟核心计算。
 * 逻辑参考 OffWorkNow (github.com/niyao-rakuten/OffWorkNow) 的
 * WorkdayCore/Calculators.swift 与 Checkout.swift，按 MIT 协议重写为 TypeScript。
 */

export type WorkState = "before" | "working" | "lunch" | "after" | "rest";

export type WorkSnapshot = {
  dateKey: string;
  state: WorkState;
  startMs: number;
  endMs: number;
  totalSeconds: number;
  workedSeconds: number;
  remainingSeconds: number;
  overtimeSeconds: number;
  progress: number;
  checkedOut: boolean;
  dailyWage: number | null;
  earned: number | null;
};

export function dateKeyOf(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function minutesOf(hhmm: string): number {
  const [hours, minutes] = String(hhmm || "").split(":").map(Number);
  const safeHours = Number.isFinite(hours) ? Math.min(23, Math.max(0, hours)) : 0;
  const safeMinutes = Number.isFinite(minutes) ? Math.min(59, Math.max(0, minutes)) : 0;
  return safeHours * 60 + safeMinutes;
}

export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60));
  if (minutes < 60) return `${minutes}分钟`;
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`;
}

export function isWorkday(settings: Settings, date: Date): boolean {
  const day = date.getDay() === 0 ? 7 : date.getDay();
  return settings.workDays.includes(day);
}

export function plannedWorkdays(settings: Settings, now: Date): number {
  const year = now.getFullYear();
  const month = now.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= last; day += 1) {
    const date = new Date(year, month, day, 12);
    if (isWorkday(settings, date)) count += 1;
  }
  return count;
}

export function dailyWageOf(settings: Settings, now: Date): number | null {
  if (settings.payMode === "customDaily") {
    return settings.customDaily && settings.customDaily > 0 ? settings.customDaily : null;
  }
  if (!settings.monthlySalary || settings.monthlySalary <= 0) return null;
  const divisor =
    settings.payMode === "plannedDays" ? plannedWorkdays(settings, now) : settings.fixedDays;
  if (!divisor || divisor <= 0) return null;
  return settings.monthlySalary / divisor;
}

export function isCheckedOutToday(settings: Settings, now: Date): boolean {
  return Boolean(
    settings.workCheckoutDate &&
      settings.workCheckoutAt &&
      settings.workCheckoutDate === dateKeyOf(now)
  );
}

export function computeWork(settings: Settings, now: Date): WorkSnapshot {
  const startMinute = minutesOf(settings.workStartTime);
  const endMinute = minutesOf(settings.workEndTime);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const startMs = dayStart.getTime() + startMinute * 60_000;
  const endMs = dayStart.getTime() + endMinute * 60_000;

  const lunchStartMs = dayStart.getTime() + minutesOf(settings.workLunchStart) * 60_000;
  const lunchEndMs = dayStart.getTime() + minutesOf(settings.workLunchEnd) * 60_000;

  const ranges: Array<[number, number]> = settings.workLunchEnabled
    ? [
        [startMs, Math.min(lunchStartMs, endMs)],
        [Math.max(startMs, lunchEndMs), endMs]
      ]
    : [[startMs, endMs]];
  const intervals = ranges.filter(([from, to]) => to > from);

  const totalSeconds = intervals.reduce((sum, [from, to]) => sum + (to - from) / 1000, 0);
  const workday = isWorkday(settings, now);
  const checkedOut = isCheckedOutToday(settings, now);
  const cutoffMs = checkedOut ? Math.max(now.getTime(), settings.workCheckoutAt || 0) : now.getTime();

  const workedSeconds = workday
    ? intervals.reduce(
        (sum, [from, to]) => sum + Math.min((to - from) / 1000, Math.max(0, (cutoffMs - from) / 1000)),
        0
      )
    : 0;

  let state: WorkState = "working";
  if (!workday) state = "rest";
  else if (now.getTime() < startMs) state = "before";
  else if (now.getTime() >= endMs) state = "after";
  else if (settings.workLunchEnabled && now.getTime() >= lunchStartMs && now.getTime() < lunchEndMs) {
    state = "lunch";
  }

  const remainingSeconds = Math.max(0, (endMs - now.getTime()) / 1000);
  const overtimeSeconds = state === "rest" ? 0 : Math.max(0, (cutoffMs - endMs) / 1000);
  const progress = totalSeconds > 0 ? Math.min(1, Math.max(0, workedSeconds / totalSeconds)) : 0;
  const dailyWage = dailyWageOf(settings, now);
  const earned =
    dailyWage !== null && totalSeconds > 0 ? (dailyWage * workedSeconds) / totalSeconds : null;

  return {
    dateKey: dateKeyOf(now),
    state,
    startMs,
    endMs,
    totalSeconds,
    workedSeconds,
    remainingSeconds,
    overtimeSeconds,
    progress,
    checkedOut,
    dailyWage,
    earned
  };
}

/** 下一次整点提醒的时间戳（仅工作时段内） */
export function nextHourlyMark(settings: Settings, now: Date): number | null {
  if (!settings.workHourlyReminderEnabled) return null;
  const work = computeWork(settings, now);
  if (work.state !== "working" && work.state !== "lunch") return null;
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  if (next.getTime() <= work.startMs || next.getTime() >= work.endMs) return null;
  return next.getTime();
}
