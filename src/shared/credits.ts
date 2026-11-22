/**
 * 积分到期提醒的纯计算部分。
 *
 * 三家（WorkBuddy / Qoder / Trae）的积分都记在服务端，本地只有加密后的登录态，
 * 读不到余额。所以这里只算「用户自己填的数字还剩几天」——不做任何联网请求。
 */

export type CreditAgentId = "workbuddy" | "qoder" | "trae";

export const CREDIT_AGENTS: CreditAgentId[] = ["workbuddy", "qoder", "trae"];

export const CREDIT_AGENT_LABELS: Record<CreditAgentId, string> = {
  workbuddy: "WorkBuddy",
  qoder: "Qoder",
  trae: "Trae"
};

export type CreditAlert = {
  agentId: CreditAgentId;
  /** 剩余积分，用户可以留空 */
  balance: number | null;
  /** 到期日（YYYY-MM-DD），与 resetDay 二选一 */
  expiresOn: string | null;
  /** 每月 N 号重置/清零，1-31 */
  resetDay: number | null;
  /** 提前几天提醒 */
  remindDays: number;
  enabled: boolean;
};

export function defaultCreditAlert(agentId: CreditAgentId): CreditAlert {
  return {
    agentId,
    balance: null,
    expiresOn: null,
    resetDay: null,
    remindDays: 3,
    enabled: false
  };
}

/** 只取日期部分，避免时区把「今天」算成「昨天」 */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * 下一次到期时间。
 * - expiresOn 优先：直接按那天的零点
 * - resetDay：本月还没到就本月，过了就到下个月（31 号在小月按月末算）
 */
export function resolveExpiryMs(alert: CreditAlert, now: Date): number | null {
  if (alert.expiresOn) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(alert.expiresOn);
    if (!match) return null;
    const time = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
    return Number.isFinite(time) ? time : null;
  }

  const day = alert.resetDay;
  if (!day || day < 1 || day > 31) return null;

  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  if (today <= day) {
    return new Date(year, month, Math.min(day, daysInMonth(year, month))).getTime();
  }
  const nextMonth = month + 1;
  const nextYear = year + (nextMonth > 11 ? 1 : 0);
  const normalizedMonth = nextMonth % 12;
  return new Date(
    nextYear,
    normalizedMonth,
    Math.min(day, daysInMonth(nextYear, normalizedMonth))
  ).getTime();
}

/** 还剩几天到期；算不出来返回 null */
export function creditDaysLeft(alert: CreditAlert, now: Date): number | null {
  const expiry = resolveExpiryMs(alert, now);
  if (expiry === null) return null;
  return Math.round((startOfDay(new Date(expiry)) - startOfDay(now)) / 86_400_000);
}

/** 到了该提醒的窗口里（含当天） */
export function isCreditDueSoon(alert: CreditAlert, now: Date): boolean {
  const days = creditDaysLeft(alert, now);
  if (days === null) return false;
  const window = Math.max(0, Math.min(30, Math.round(alert.remindDays)));
  return days >= 0 && days <= window;
}

/**
 * 同一天、同一个剩余天数只提醒一次；日期变了才会生成新 key。
 * 返回 null 表示今天不该提醒。
 */
export function creditReminderKey(alert: CreditAlert, now: Date): string | null {
  if (!alert.enabled) return null;
  if (!isCreditDueSoon(alert, now)) return null;
  const days = creditDaysLeft(alert, now);
  if (days === null) return null;
  const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  return `${alert.agentId}:${days}:${dateKey}`;
}
