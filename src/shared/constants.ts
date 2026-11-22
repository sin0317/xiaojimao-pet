import { CREDIT_AGENTS, defaultCreditAlert } from "./credits";
import type { Settings, TodayStats } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  language: "zh-CN",
  petAppearanceId: "xiaoJiMao",
  customPetAppearance: null,
  onboardingDismissed: false,
  launchAtLoginEnabled: false,
  hideOnFullscreenEnabled: true,
  checkUpdatesOnLaunchEnabled: false,
  breakReminderEnabled: true,
  breakIntervalMinutes: 45,
  breakRunDurationSeconds: 60,
  hydrationReminderEnabled: true,
  hydrationIntervalMinutes: 90,
  focusDurationMinutes: 25,
  distractionDetectionEnabled: false,
  distractionGraceSeconds: 8,
  distractionBlockedApps: [
    "Steam",
    "Discord",
    "Telegram",
    "WeChat",
    "QQ"
  ],
  distractionBlockedKeywords: [
    "youtube",
    "youtu.be",
    "twitter",
    "x.com",
    "instagram",
    "reddit",
    "tiktok",
    "netflix",
    "twitch",
    "facebook",
    "bilibili",
    "weibo",
    "douyin",
    "xiaohongshu",
    "zhihu",
    "douban",
    "taobao",
    "jd.com",
    "小红书",
    "微博",
    "抖音",
    "知乎",
    "豆瓣",
    "淘宝",
    "京东",
    "哔哩哔哩",
    "虎扑",
    "贴吧"
  ],
  workClockEnabled: true,
  workStartTime: "09:00",
  workEndTime: "18:00",
  workDays: [1, 2, 3, 4, 5],
  workLunchEnabled: true,
  workLunchStart: "12:00",
  workLunchEnd: "13:00",
  workHourlyReminderEnabled: true,
  workOvertimeEnabled: true,
  workOvertimeIntervalMinutes: 5,
  monthlySalary: null,
  payMode: "fixedDays",
  fixedDays: 21.75,
  customDaily: null,
  hideEarnings: false,
  workCheckoutDate: null,
  workCheckoutAt: null,
  workBuddyEnabled: true,
  workBuddyNotifyEnabled: true,
  creditAlerts: CREDIT_AGENTS.map((agentId) => defaultCreditAlert(agentId))
};

export function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createEmptyStats(date = todayKey()): TodayStats {
  return {
    date,
    breaksTaken: 0,
    watersLogged: 0,
    focusMinutes: 0,
    focusWarnings: 0
  };
}
