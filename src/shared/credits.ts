/**
 * 积分到期提醒的纯计算部分。
 *
 * 三家（WorkBuddy / Qoder / Trae）的积分都记在服务端，本地只有加密后的登录态，
 * 读不到余额。所以这里只算「用户自己填的数字还剩几天」——不做任何联网请求。
 */

export type CreditAgentId = "workbuddy" | "qoder" | "qoderCn" | "trae";

/**
 * 顺序即界面顺序。
 * 注意：`qoder` 是国际版（qoder.ai），`qoderCn` 是国内版（qoder.cn）。
 * 自动抓取（设备授权 + usage 接口）目前只接了国内版 `qoderCn`；
 * 国际版只能手填——没有对应的开放接口，别硬猜。
 */
export const CREDIT_AGENTS: CreditAgentId[] = ["workbuddy", "qoder", "qoderCn", "trae"];

export const CREDIT_AGENT_LABELS: Record<CreditAgentId, string> = {
  workbuddy: "WorkBuddy",
  qoder: "Qoder",
  qoderCn: "Qoder CN",
  trae: "Trae"
};

/** 能扫码自动抓余额的那几家 */
export const CREDIT_CAPTURE_AGENTS: CreditAgentId[] = ["workbuddy", "qoderCn"];

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
  /**
   * balance 是不是「就是这批要过期的量」。
   * 手动填的是（用户自己说这批多少），自动抓来的不是——
   * 接口只给总余额和最早到期日，那一刻到底过期多少查不到。
   */
  amountIsExact: boolean;
};

export function defaultCreditAlert(agentId: CreditAgentId): CreditAlert {
  return {
    agentId,
    balance: null,
    expiresOn: null,
    resetDay: null,
    remindDays: 3,
    enabled: false,
    amountIsExact: true
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

/* ------------------------------------------------------------------ */
/* WorkBuddy 官方接口返回值的解析（扫码登录后才有 token，见 workbuddyLink） */
/* ------------------------------------------------------------------ */

const REMAINING_KEYS = [
  "CycleCapacityRemainPrecise",
  "CycleCapacityRemain",
  "CycleRemainCapacity",
  "CapacityRemainPrecise",
  "CapacityRemain",
  "SlicePeriodCapacityRemainPrecise",
  "SlicePeriodCapacityRemain"
];

const TOTAL_KEYS = [
  "CycleCapacitySizePrecise",
  "CycleCapacitySize",
  "CycleTotalCapacity",
  "CapacitySizePrecise",
  "CapacitySize",
  "SlicePeriodCapacitySizePrecise",
  "SlicePeriodCapacitySize"
];

const USED_KEYS = [
  "CycleCapacityUsedPrecise",
  "CycleCapacityUsed",
  "CycleUsedCapacity",
  "CapacityUsedPrecise",
  "CapacityUsed",
  "SlicePeriodCapacityUsedPrecise",
  "SlicePeriodCapacityUsed"
];

const DEDUCTION_KEYS = ["DeductionEndTime", "deductionEndTime", "ExpiredTime", "expiredTime"];
const CYCLE_KEYS = ["CycleEndTime", "cycleEndTime"];

/** 730 天以外当作「长期有效」，不拿它去提醒 */
const FAR_FUTURE_MS = 730 * 86_400_000;
/** DeductionEndTime 比 CycleEndTime 晚太多时视为占位值 */
const EXPIRY_OVERRIDE_MS = 365 * 86_400_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstNumber(raw: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function firstTimestamp(raw: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = normalizeTimestampMs(raw[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

/** 秒 / 毫秒 / RFC3339 / 本地时间字符串，统一成毫秒 */
export function normalizeTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.abs(value) < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return normalizeTimestampMs(Number(text));

  const parsed = Date.parse(text.includes("T") ? text : text.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : null;
}

export type WorkBuddyCredits = {
  remaining: number;
  total: number;
  expiresAt: number | null;
  /** 套餐每月给的额度（plan_base），重置日到底给多少就看这个 */
  planQuota?: number | null;
};

/**
 * 解析 `/billing/meter/get-user-resource-summary` 的返回。
 * 字段名有 Pascal 和 camel 两套，按优先级依次尝试；解析不出来返回 null。
 */
export function parseResourceSummary(raw: unknown, now = Date.now()): WorkBuddyCredits | null {
  const root = asRecord(raw);
  if (!root) return null;
  const data = asRecord(root.data) ?? root;

  // 这个接口把明细放在 CreditGroups 里，顶层没有 CycleRemainCapacity
  const groups = Array.isArray(data.CreditGroups)
    ? data.CreditGroups
    : Array.isArray(data.creditGroups)
      ? data.creditGroups
      : null;

  if (groups) {
    let remaining = 0;
    let total = 0;
    let planQuota: number | null = null;
    for (const entry of groups) {
      const item = asRecord(entry);
      if (!item) continue;
      remaining +=
        firstNumber(item, [
          "CycleRemainCapacity",
          "CycleCapacityRemainPrecise",
          "CycleCapacityRemain"
        ]) ?? 0;
      const groupTotal =
        firstNumber(item, ["CycleTotalCapacity", "CycleCapacitySizePrecise", "CycleCapacitySize"]) ??
        0;
      total += groupTotal;
      if (String(item.Kind ?? "") === "plan_base" && groupTotal > 0) planQuota = groupTotal;
    }
    // 有 CreditGroups 就以它为准；即使全是 0 也算「读到了」，不要退回按字段猜
    return {
      remaining: Math.round(remaining),
      total: Math.round(total || remaining),
      expiresAt: null,
      planQuota: planQuota === null ? null : Math.round(planQuota)
    };
  }

  const remaining = firstNumber(data, REMAINING_KEYS);
  const total = firstNumber(data, TOTAL_KEYS);
  const used = firstNumber(data, USED_KEYS);
  if (remaining === null && total === null && used === null) return null;

  const remainingValue = Math.max(0, remaining ?? Math.max(0, (total ?? 0) - (used ?? 0)));
  const totalValue = Math.max(0, total ?? remainingValue + (used ?? 0));

  const deduction = firstTimestamp(data, DEDUCTION_KEYS);
  const cycle = firstTimestamp(data, CYCLE_KEYS);
  let expiresAt = deduction ?? cycle;
  if (deduction !== null && cycle !== null && deduction - cycle > EXPIRY_OVERRIDE_MS) {
    expiresAt = cycle;
  }
  if (expiresAt !== null && expiresAt - now > FAR_FUTURE_MS) expiresAt = null;

  return {
    remaining: Math.round(remainingValue),
    total: Math.round(totalValue),
    expiresAt
  };
}

/**
 * 解析积分包的发放明细（`get-user-resource-free-packages` 的 data.Accounts）。
 * 每一笔发放都有剩余量和到期时间：
 *  - 余额 = 所有发放的剩余量之和
 *  - 到期 = 还有剩余的那些里最早的一个（这才是「最近要过期的积分」）
 */
export function parsePackageGrants(raw: unknown, now = Date.now()): WorkBuddyCredits | null {
  const root = asRecord(raw);
  if (!root) return null;
  const data = asRecord(root.data) ?? root;
  const list = Array.isArray(data.Accounts)
    ? data.Accounts
    : Array.isArray(data.accounts)
      ? data.accounts
      : null;
  if (!list) return null;

  let remaining = 0;
  let total = 0;
  let expiresAt: number | null = null;

  for (const entry of list) {
    const item = asRecord(entry);
    if (!item) continue;
    const remain =
      firstNumber(item, [
        "CapacityRemainPrecise",
        "CapacityRemain",
        "CycleCapacityRemainPrecise",
        "CycleCapacityRemain"
      ]) ?? 0;
    const size =
      firstNumber(item, [
        "CapacitySizePrecise",
        "CapacitySize",
        "CycleCapacitySizePrecise",
        "CycleCapacitySize"
      ]) ?? 0;

    remaining += remain;
    total += size;

    // 发放明细里的剩余量常年是 0（真实余额在 summary 里），所以到期只看「还在生效」的那批
    const status = typeof item.Status === "number" ? item.Status : 0;
    if (status !== 0) continue;
    const end = firstTimestamp(item, ["CycleEndTime", "DeductionEndTime", "ExpiredTime"]);
    if (end === null || end <= now || end - now > FAR_FUTURE_MS) continue;
    if (expiresAt === null || end < expiresAt) expiresAt = end;
  }

  return {
    remaining: Math.round(remaining),
    total: Math.round(total || remaining),
    expiresAt
  };
}

/** 毫秒 → YYYY-MM-DD（本地时区），给设置里的日期框用 */
export function toDateInputValue(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const QODER_EXPIRY_KEYS = [
  "expireAt",
  "expiredAt",
  "expireTime",
  "expiredTime",
  "validUntil",
  "endTime",
  "quotaExpireAt",
  "expire_at"
];

function quotaRemaining(quota: Record<string, unknown>): number {
  const remaining = firstNumber(quota, ["remaining", "remain", "left"]);
  if (remaining !== null) return Math.max(0, remaining);
  const total = firstNumber(quota, ["total", "quota", "limit"]);
  const used = firstNumber(quota, ["used", "usage", "consumed"]);
  if (total !== null) return Math.max(0, total - (used ?? 0));
  return 0;
}

/**
 * Qoder `/sash/api/v2/me/usage`：套餐内 + 资源包 + 组织资源包三块要加在一起，
 * 到期取最近的（签到攒的资源包通常 30 天先到期）。
 */
export function parseQoderUsage(raw: unknown, now = Date.now()): WorkBuddyCredits | null {
  const root = asRecord(raw);
  if (!root) return null;
  const usage = asRecord(root.qoderUsage) ?? root;
  const buckets: Array<{ key: string; item: Record<string, unknown> }> = [];
  for (const key of ["userQuota", "addOnQuota", "orgResourcePackage"]) {
    const item = asRecord(usage[key]);
    if (item) buckets.push({ key, item });
  }

  if (!buckets.length) return null;

  let remaining = 0;
  let total = 0;
  let expiresAt: number | null = null;
  let planQuota: number | null = null;

  for (const { key, item } of buckets) {
    remaining += quotaRemaining(item);
    const bucketTotal = firstNumber(item, ["total", "quota", "limit"]) ?? 0;
    total += bucketTotal;
    if (key === "userQuota" && bucketTotal > 0) planQuota = bucketTotal;

    const expiry = firstTimestamp(item, QODER_EXPIRY_KEYS);
    if (expiry !== null && expiry > now && expiry - now < FAR_FUTURE_MS) {
      if (expiresAt === null || expiry < expiresAt) expiresAt = expiry;
    }
  }

  return {
    remaining: Math.round(remaining),
    total: Math.round(total || remaining),
    expiresAt,
    planQuota: planQuota === null ? null : Math.round(planQuota)
  };
}
