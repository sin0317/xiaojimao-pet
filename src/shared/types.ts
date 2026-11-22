export type Language = "zh-CN" | "en";

import type { AgentIntegration, WorkBuddyStatus } from "./workbuddy";
import type { CreditAlert } from "./credits";

export type { CreditAlert, CreditAgentId } from "./credits";

export type {
  AgentHookTarget,
  AgentIntegration,
  WorkBuddyPhase,
  WorkBuddySession,
  WorkBuddyStatus
} from "./workbuddy";

export type BuiltInPetAppearanceId = "lovartPuppy" | "lineDog" | "xiaoJiMao";

/** 诊断页里单个 agent 的健康状况 */
export type AgentDiagnostics = {
  id: string;
  label: string;
  /** 钩子/插件是否已接入 */
  installed: boolean;
  /** 本机有没有这个 agent 的配置目录 */
  detected: boolean;
  settingsPath: string;
  settingsExists: boolean;
  scriptPath: string;
  scriptExists: boolean;
  /** 本次运行收到的最后一条事件 */
  lastEventAt: number | null;
  lastEventName: string | null;
  eventsThisRun: number;
  error: string | null;
};

export type Diagnostics = {
  version: string;
  platform: string;
  arch: string;
  userDataPath: string;
  eventDir: string;
  eventDirExists: boolean;
  generatedAt: number;
  agents: AgentDiagnostics[];
};

/** workbuddy-switch 里一个账号的积分快照（不含 token） */
export type WbSwitchAccount = {
  id: string;
  nickname: string;
  email: string;
  remaining: number;
  total: number;
  planQuota?: number | null;
  expiresAt: number | null;
  error: string | null;
};

export type WbSwitchSnapshot = {
  updatedAt: number;
  accounts: WbSwitchAccount[];
};

/** WorkBuddy 扫码取数的状态（只暴露昵称和余额，token 永远不出主进程） */
export type WorkBuddyLinkStatus = {
  state: "idle" | "waiting" | "success" | "error";
  message: string;
  nickname: string | null;
  balance: number | null;
  expiresAt: number | null;
  updatedAt: number | null;
};

export type PetAppearanceId = BuiltInPetAppearanceId | "custom";

export type PetFacing = "left" | "right";

export type PetState =
  | "idle"
  | "sitting"
  | "happy"
  | "breakPrompt"
  | "breakRunning"
  | "breakDone"
  | "hydrationPrompt"
  | "drinking"
  | "hydrationDone"
  | "focusGuard"
  | "focusAlert"
  | "focusDone"
  | "sad"
  | "sleeping";

export type CustomPetAsset = {
  relativePath: string;
  originalName: string;
  updatedAt: number;
};

export type CustomPetAppearance = {
  name: string;
  assets: Partial<Record<PetState, CustomPetAsset>>;
};

export type BubbleAction = {
  id: string;
  label: string;
  kind?: "primary" | "secondary" | "danger";
};

export type SpeechBubble = {
  id: string;
  message: string;
  actions?: BubbleAction[];
  autoDismissMs?: number;
};

export type BlockingMode = "break" | "breakRun" | "hydration" | "focusWarning" | null;

export type Settings = {
  language: Language;
  petAppearanceId: PetAppearanceId;
  customPetAppearance: CustomPetAppearance | null;
  onboardingDismissed: boolean;
  launchAtLoginEnabled: boolean;
  hideOnFullscreenEnabled: boolean;
  checkUpdatesOnLaunchEnabled: boolean;
  breakReminderEnabled: boolean;
  breakIntervalMinutes: number;
  breakRunDurationSeconds: number;
  hydrationReminderEnabled: boolean;
  hydrationIntervalMinutes: number;
  focusDurationMinutes: number;
  distractionDetectionEnabled: boolean;
  distractionGraceSeconds: number;
  distractionBlockedApps: string[];
  distractionBlockedKeywords: string[];
  workClockEnabled: boolean;
  workStartTime: string;
  workEndTime: string;
  workDays: number[];
  workLunchEnabled: boolean;
  workLunchStart: string;
  workLunchEnd: string;
  workHourlyReminderEnabled: boolean;
  workOvertimeEnabled: boolean;
  workOvertimeIntervalMinutes: number;
  monthlySalary: number | null;
  payMode: "fixedDays" | "plannedDays" | "customDaily";
  fixedDays: number;
  customDaily: number | null;
  hideEarnings: boolean;
  workCheckoutDate: string | null;
  workCheckoutAt: number | null;
  workBuddyEnabled: boolean;
  workBuddyNotifyEnabled: boolean;
  /** 积分到期提醒：用户自己登记，桌宠只负责到点喊人 */
  creditAlerts: CreditAlert[];
};

export type TodayStats = {
  date: string;
  breaksTaken: number;
  watersLogged: number;
  focusMinutes: number;
  focusWarnings: number;
};

export type StatsHistory = Record<string, TodayStats>;

export type TimerStatus = {
  breakDueAt: number | null;
  hydrationDueAt: number | null;
  focusEndsAt: number | null;
};

export type DistractionStatus = {
  state: "idle" | "watching" | "permission-needed" | "unsupported" | "error";
  activeApp: string;
  activeWindowTitle: string;
  matchedRule: string | null;
  lastCheckedAt: number | null;
  lastWarningAt: number | null;
  error: string | null;
};

export type AppSnapshot = {
  appInfo: AppInfo;
  updateCheck: UpdateCheckResult;
  settings: Settings;
  stats: TodayStats;
  statsHistory: StatsHistory;
  timers: TimerStatus;
  distraction: DistractionStatus;
  petState: PetState;
  petFacing: PetFacing;
  blockingMode: BlockingMode;
  focusActive: boolean;
  dogVisible: boolean;
  workBuddy: WorkBuddyStatus;
  workBuddyIntegrations: AgentIntegration[];
  /** DeepSeek Harness 的桥接插件（Cordis 插件，不是钩子） */
  dshBridge: { installed: boolean; path: string };
};

export type AppInfo = {
  version: string;
  releaseNotesUrl: string;
};

export type UpdateCheckStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "error";

export type UpdateCheckResult = {
  status: UpdateCheckStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  checkedAt: number | null;
  error: string | null;
};

export type DemoTrigger =
  | "break"
  | "hydration"
  | "focusWarning"
  | "happy";

export type RendererEventMap = {
  "pet:set-state": PetState;
  "pet:show-bubble": SpeechBubble;
  "pet:hide-bubble": void;
  "settings:updated": Settings;
  "stats:updated": TodayStats;
  "app:snapshot": AppSnapshot;
};
