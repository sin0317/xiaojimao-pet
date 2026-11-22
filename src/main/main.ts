import { basename, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  Notification,
  protocol,
  screen,
  shell,
  Tray
} from "electron";
import Store from "electron-store";
import {
  createEmptyStats,
  DEFAULT_SETTINGS
} from "../shared/constants";
import { i18n, pick } from "../shared/i18n";
import { PET_STATE_ORDER } from "../shared/petAppearances";
import { computeWork, dateKeyOf, formatDuration } from "../shared/workClock";
import {
  applyWorkBuddyEvents,
  EMPTY_WORKBUDDY_STATUS,
  normalizeAgentName,
  primaryWorkBuddySession,
  summarizeWorkBuddy
} from "../shared/workbuddy";
import type {
  AgentHookTarget,
  AgentIntegration,
  WorkBuddyEvent,
  WorkBuddyHookPayload,
  WorkBuddyPhase,
  WorkBuddySession,
  WorkBuddyStatus
} from "../shared/workbuddy";
import type {
  AppSnapshot,
  AgentDiagnostics,
  BlockingMode,
  CustomPetAsset,
  Diagnostics,
  DistractionStatus,
  DemoTrigger,
  PetFacing,
  PetState,
  Settings,
  StatsHistory,
  SpeechBubble,
  TodayStats,
  UpdateCheckResult
} from "../shared/types";
import {
  APP_NAME,
  BREAK_RUN_TICK_MS,
  DISTRACTION_CHECK_INTERVAL_MS,
  DISTRACTION_WARNING_COOLDOWN_MS,
  IS_DEV,
  PET_WINDOW,
  PRELOAD_PATH,
  RELEASES_URL,
  RENDERER_HTML_PATH,
  SETTINGS_WINDOW,
  STORE_NAME
} from "./config";
import {
  initialWindowBounds,
  savedPositionFromBounds,
  visibleWindowBounds
} from "./displayPosition";
import type { DisplayBounds, SavedWindowPosition } from "./displayPosition";
import { classifyDistraction, isPermissionError, readActiveWindow } from "./distraction";
import { watchFullscreen } from "./fullscreen";
import { applyLaunchAtLoginPreference, getLaunchAtLoginState } from "./loginItem";
import {
  buildApplicationMenuTemplate,
  buildPetContextMenuTemplate,
  buildTrayMenuTemplate
} from "./menus";
import { createAppIcon, createTrayImage } from "./trayIcon";
import { getStoredSettings, normalizeSettings } from "./settingsStore";
import {
  getCurrentStats,
  getStatsHistory,
  resetCurrentStats,
  updateCurrentStats
} from "./statsStore";
import {
  checkGitHubReleasesForUpdates,
  createCheckingUpdateCheck,
  createInitialUpdateCheck
} from "./updates";
import {
  detectAgentIntegration,
  detectAllAgents,
  installAgentHooks,
  resolveWorkBuddyEventDir,
  SUPPORTED_AGENT_TARGETS,
  uninstallAgentHooks
} from "./workbuddyHooks";

type StoreSchema = {
  settings: Settings;
  stats: TodayStats;
  statsHistory: StatsHistory;
  petPosition?: SavedWindowPosition;
  petHiddenByUser?: boolean;
};

type PetPosition = {
  x: number;
  y: number;
};

app.setName(APP_NAME);

const store = new Store<StoreSchema>({
  name: STORE_NAME,
  defaults: {
    settings: DEFAULT_SETTINGS,
    stats: createEmptyStats(),
    statsHistory: {}
  }
});

let petWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let petState: PetState = "idle";
let petFacing: PetFacing = "right";
let blockingMode: BlockingMode = null;
let focusActive = false;
let focusStartedAt: number | null = null;
let breakRunTimer: NodeJS.Timeout | null = null;
let breakRunCountdownTimer: NodeJS.Timeout | null = null;
let breakRunMovementTimer: NodeJS.Timeout | null = null;
let breakTimer: NodeJS.Timeout | null = null;
let hydrationTimer: NodeJS.Timeout | null = null;
let focusTimer: NodeJS.Timeout | null = null;
let distractionTimer: NodeJS.Timeout | null = null;
let distractionStartupTimer: NodeJS.Timeout | null = null;
let displayChangeTimer: NodeJS.Timeout | null = null;
let stopFullscreenWatcher: (() => void) | null = null;
let petHiddenByFullscreen = false;
let breakDueAt: number | null = null;
let hydrationDueAt: number | null = null;
let focusEndsAt: number | null = null;
let bubbleTimer: NodeJS.Timeout | null = null;
let currentBubbleId: string | null = null;
let dragTimer: NodeJS.Timeout | null = null;
let dragSafetyTimer: NodeJS.Timeout | null = null;
let breakRunVelocity: PetPosition = { x: 0, y: 0 };
let breakRunFormatter: ((seconds: number) => string) | null = null;
let nextBreakRunTurnAt = 0;
let breakMutedToday = false;
let dragOffset: PetPosition = { x: 0, y: 0 };
let petMouseInteractive = true;
let distractionStatus: DistractionStatus = {
  state: "idle",
  activeApp: "",
  activeWindowTitle: "",
  matchedRule: null,
  lastCheckedAt: null,
  lastWarningAt: null,
  error: null
};
let updateCheck: UpdateCheckResult = createInitialUpdateCheck();
let workBuddySessions: Record<string, WorkBuddySession> = {};
let workBuddyStatus: WorkBuddyStatus = EMPTY_WORKBUDDY_STATUS;
let workBuddyIntegrations: AgentIntegration[] = [];

/** 诊断页用：本次运行里每个 agent 的事件统计（不落盘） */
type AgentEventStat = { lastAt: number; lastName: string; count: number };
const agentEventStats = new Map<string, AgentEventStat>();
let workBuddyTimer: NodeJS.Timeout | null = null;
let workBuddyIngesting = false;
let petRendererReady = false;
/** 渲染进程还没就绪时先把提醒挂起，就绪后补发 */
let pendingWorkBuddyNotice: WorkBuddyStatus | null = null;
/** 「等你选」晚 1.2 秒再弹，避开任务刚起步的瞬时抖动 */
let needsInputNoticeTimer: NodeJS.Timeout | null = null;
const NEEDS_INPUT_NOTICE_DELAY_MS = 1200;

function setPetMouseInteractive(interactive: boolean): void {
  if (!petWindow || petWindow.isDestroyed() || petMouseInteractive === interactive) return;
  petMouseInteractive = interactive;
  petWindow.setIgnoreMouseEvents(!interactive, { forward: true });
}

function getSettings(): Settings {
  return getStoredSettings(store);
}

function text(): ReturnType<typeof i18n> {
  return i18n(getSettings().language);
}

function setSettings(next: Settings): void {
  const fullscreenDetectionWasEnabled = getSettings().hideOnFullscreenEnabled;
  const normalized = normalizeSettings(next);
  applyLaunchAtLoginPreference(normalized.launchAtLoginEnabled);
  store.set("settings", normalized);
  sendToAll("settings:updated", getSettingsWithSystemState());
  settingsWindow?.setTitle(`${APP_NAME} ${text().menu.settings}`);
  scheduleReminderTimers();
  scheduleDistractionDetection();
  scheduleWorkBuddyBridge();
  if (fullscreenDetectionWasEnabled !== normalized.hideOnFullscreenEnabled) {
    configureFullscreenDetection();
  }
  updateTrayMenu();
}

function getSettingsWithSystemState(): Settings {
  const settings = getSettings();
  return {
    ...settings,
    launchAtLoginEnabled: getLaunchAtLoginState(settings.launchAtLoginEnabled)
  };
}

function getStats(): TodayStats {
  return getCurrentStats(store);
}

function updateStats(mutator: (stats: TodayStats) => TodayStats): void {
  const next = updateCurrentStats(store, mutator);
  sendToAll("stats:updated", next);
}

function isCustomPetState(state: unknown): state is PetState {
  return typeof state === "string" && PET_STATE_ORDER.includes(state as PetState);
}

async function importCustomPetAsset(state: PetState, sourcePath: string): Promise<CustomPetAsset | null> {
  if (!isCustomPetState(state) || typeof sourcePath !== "string") return null;
  if (extname(sourcePath).toLowerCase() !== ".gif") return null;

  const customRoot = join(app.getPath("userData"), "custom_pet_assets");
  const stateDir = join(customRoot, state);
  await mkdir(stateDir, { recursive: true });

  const originalName = basename(sourcePath);
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]+/g, "-") || `${state}.gif`;
  const fileName = `${state}-${Date.now()}-${safeName}`;
  const targetPath = join(stateDir, fileName);
  await copyFile(sourcePath, targetPath);

  return {
    relativePath: `custom_pet_assets/${state}/${fileName}`,
    originalName,
    updatedAt: Date.now()
  };
}

function resetTodayStats(): void {
  breakMutedToday = false;
  const reset = resetCurrentStats(store);
  sendToAll("stats:updated", reset);
}

async function selectCustomPetAsset(state: PetState): Promise<CustomPetAsset | null> {
  if (!isCustomPetState(state)) return null;

  const options: Electron.OpenDialogOptions = {
    properties: ["openFile"],
    filters: [{ name: "GIF Images", extensions: ["gif"] }]
  };
  const result =
    settingsWindow && !settingsWindow.isDestroyed()
      ? await dialog.showOpenDialog(settingsWindow, options)
      : await dialog.showOpenDialog(options);

  if (result.canceled || !result.filePaths[0]) return null;
  return importCustomPetAsset(state, result.filePaths[0]);
}

function snapshot(): AppSnapshot {
  return {
    appInfo: {
      version: app.getVersion(),
      releaseNotesUrl: RELEASES_URL
    },
    updateCheck,
    settings: getSettingsWithSystemState(),
    stats: getStats(),
    statsHistory: getStatsHistory(store),
    timers: {
      breakDueAt,
      hydrationDueAt,
      focusEndsAt
    },
    distraction: distractionStatus,
    petState,
    petFacing,
    blockingMode,
    dogVisible: Boolean(petWindow?.isVisible()),
    focusActive,
    workBuddy: workBuddyStatus,
    workBuddyIntegrations
  };
}

function isPetHiddenByUser(): boolean {
  return store.get("petHiddenByUser") === true;
}

function setPetHiddenByUser(hidden: boolean): void {
  store.set("petHiddenByUser", hidden);
  updateTrayMenu();
  publishSnapshot();
}

function setPetHiddenByFullscreen(hidden: boolean): void {
  if (petHiddenByFullscreen === hidden) return;
  petHiddenByFullscreen = hidden;

  if (petWindow && !petWindow.isDestroyed()) {
    if (hidden) petWindow.hide();
    else if (!isPetHiddenByUser()) petWindow.showInactive();
  }
  updateTrayMenu();
  publishSnapshot();
}

function configureFullscreenDetection(): void {
  stopFullscreenWatcher?.();
  stopFullscreenWatcher = null;
  setPetHiddenByFullscreen(false);
  if (!getSettings().hideOnFullscreenEnabled) return;
  stopFullscreenWatcher = watchFullscreen(setPetHiddenByFullscreen);
}

function sendToPet<T>(channel: string, payload?: T): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send(channel, payload);
}

function sendToAll<T>(channel: string, payload?: T): void {
  sendToPet(channel, payload);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(channel, payload);
  }
}

function publishSnapshot(): void {
  sendToAll("app:snapshot", snapshot());
}

function setPetState(next: PetState): void {
  petState = next;
  sendToAll("pet:set-state", next);
}

function setPetFacing(next: PetFacing): void {
  if (petFacing === next) return;
  petFacing = next;
  publishSnapshot();
}

function showBubble(bubble: SpeechBubble): void {
  if (bubbleTimer) clearTimeout(bubbleTimer);
  currentBubbleId = bubble.id;
  sendToPet("pet:show-bubble", bubble);
  if (bubble.autoDismissMs) {
    const id = bubble.id;
    bubbleTimer = setTimeout(() => {
      if (currentBubbleId === id) hideBubble();
    }, bubble.autoDismissMs);
  }
}

function hideBubble(options: { onlyId?: string } = {}): void {
  if (options.onlyId && currentBubbleId !== options.onlyId) return;
  currentBubbleId = null;
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
  sendToPet("pet:hide-bubble");
}

function rendererUrl(route: "pet" | "settings"): string {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) return `${devServer}#${route}`;
  return RENDERER_HTML_PATH;
}

function loadRenderer(win: BrowserWindow, route: "pet" | "settings"): void {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) {
    void win.loadURL(rendererUrl(route));
    return;
  }
  void win.loadFile(rendererUrl(route), { hash: route });
}

function toDisplayBounds(display: Electron.Display): DisplayBounds {
  return {
    id: display.id,
    workArea: display.workArea
  };
}

function currentDisplays(): DisplayBounds[] {
  return screen.getAllDisplays().map(toDisplayBounds);
}

function primaryDisplay(): DisplayBounds {
  return toDisplayBounds(screen.getPrimaryDisplay());
}

function initialPetBounds(): Electron.Rectangle {
  const stored = store.get("petPosition");
  return initialWindowBounds({
    displays: currentDisplays(),
    primaryDisplay: primaryDisplay(),
    size: PET_WINDOW,
    saved: stored
  });
}

function persistPetPosition(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  store.set("petPosition", savedPositionFromBounds(currentDisplays(), bounds, primaryDisplay()));
}

function keepPetWindowInVisibleWorkArea(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  const nextBounds = visibleWindowBounds(currentDisplays(), primaryDisplay(), bounds);
  if (bounds.x !== nextBounds.x || bounds.y !== nextBounds.y) {
    petWindow.setBounds(nextBounds);
  }
  persistPetPosition();
  publishSnapshot();
}

function schedulePetDisplayRepair(): void {
  if (displayChangeTimer) clearTimeout(displayChangeTimer);
  displayChangeTimer = setTimeout(() => {
    displayChangeTimer = null;
    keepPetWindowInVisibleWorkArea();
  }, 250);
}

function registerDisplayChangeHandlers(): void {
  screen.on("display-added", schedulePetDisplayRepair);
  screen.on("display-removed", schedulePetDisplayRepair);
  screen.on("display-metrics-changed", schedulePetDisplayRepair);
}

function createPetWindow(): void {
  const bounds = initialPetBounds();
  petMouseInteractive = true;
  petWindow = new BrowserWindow({
    width: PET_WINDOW.width,
    height: PET_WINDOW.height,
    x: bounds.x,
    y: bounds.y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    icon: createAppIcon(),
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !IS_DEV
    }
  });

  petWindow.setAlwaysOnTop(true, process.platform === "darwin" ? "floating" : "normal");
  if (process.platform === "darwin") {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  setPetMouseInteractive(false);
  loadRenderer(petWindow, "pet");
  if (process.env.PAWPAL_DEBUG_SHOT) {
    petWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        void petWindow?.webContents
          .capturePage()
          .then((image) => writeFile(join(app.getPath("userData"), "debug-shot.png"), image.toPNG()))
          .catch(() => undefined);
      }, 3500);
    });
  }
  petWindow.once("ready-to-show", () => {
    petRendererReady = true;
    if (!petHiddenByFullscreen && !isPetHiddenByUser()) petWindow?.showInactive();
    petWindow?.setSkipTaskbar(true);
    updateTrayMenu();
    publishSnapshot();
    if (pendingWorkBuddyNotice) {
      const pending = pendingWorkBuddyNotice;
      pendingWorkBuddyNotice = null;
      reactToWorkBuddyPhase(pending);
    }
  });
  petWindow.on("show", () => {
    petWindow?.setSkipTaskbar(true);
    updateTrayMenu();
    publishSnapshot();
  });
  petWindow.on("hide", () => {
    stopPetDrag();
    updateTrayMenu();
    publishSnapshot();
  });
  petWindow.on("closed", () => {
    stopPetDrag();
    petRendererReady = false;
    petWindow = null;
    updateTrayMenu();
    publishSnapshot();
  });
}

function ensurePetWindowVisible(options: { ignoreUserHidden?: boolean } = {}): boolean {
  if (petHiddenByFullscreen || (isPetHiddenByUser() && !options.ignoreUserHidden)) {
    updateTrayMenu();
    publishSnapshot();
    return false;
  }
  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  if (petWindow && !petWindow.isVisible()) petWindow.showInactive();
  updateTrayMenu();
  publishSnapshot();
  return true;
}

function showPetWindowFromMenu(): void {
  setPetHiddenByUser(false);
  ensurePetWindowVisible({ ignoreUserHidden: true });
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: SETTINGS_WINDOW.width,
    height: SETTINGS_WINDOW.height,
    title: `${APP_NAME} ${text().menu.settings}`,
    resizable: true,
    minWidth: SETTINGS_WINDOW.width,
    maxWidth: SETTINGS_WINDOW.width,
    minHeight: 400,
    show: false,
    skipTaskbar: true,
    icon: createAppIcon(),
    backgroundColor: "#faf6ee",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !IS_DEV
    }
  });

  loadRenderer(settingsWindow, "settings");
  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
    publishSnapshot();
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createTray(): void {
  tray = new Tray(createTrayImage());
  tray.setToolTip(APP_NAME);
  tray.on("click", () => {
    tray?.popUpContextMenu();
  });
  if (process.platform !== "darwin") {
    nativeTheme.on("updated", () => tray?.setImage(createTrayImage()));
  }
  updateTrayMenu();
}

function togglePetWindowVisibility(): void {
  if (!petWindow) createPetWindow();
  if (!petWindow) return;
  if (petWindow.isVisible()) hidePetWindowFromMenu();
  else showPetWindowFromMenu();
}

function hidePetWindowFromMenu(): void {
  setPetHiddenByUser(true);
  petWindow?.hide();
  updateTrayMenu();
  sendToAll("app:snapshot", snapshot());
}

function menuState() {
  return {
    appName: APP_NAME,
    dogVisible: Boolean(petWindow?.isVisible()),
    focusActive,
    isPackaged: app.isPackaged
  };
}

function menuActions() {
  return {
    toggleDog: togglePetWindowVisibility,
    hideDog: hidePetWindowFromMenu,
    startFocus: startFocusMode,
    stopFocusFromMenu: () => stopFocusMode(true),
    stopFocusFromContext: () => stopFocusMode(false),
    openSettings: createSettingsWindow,
    quit: () => app.quit(),
    triggerDemo
  };
}

function updateApplicationMenu(): void {
  const labels = text().menu;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(buildApplicationMenuTemplate(labels, menuState(), menuActions()))
  );
}

function updateTrayMenu(): void {
  updateApplicationMenu();
  if (!tray) return;
  const labels = text().menu;
  tray.setContextMenu(
    Menu.buildFromTemplate(buildTrayMenuTemplate(labels, menuState(), menuActions()))
  );
}

function showPetContextMenu(): void {
  const labels = text().menu;
  Menu.buildFromTemplate(buildPetContextMenuTemplate(labels, menuState(), menuActions())).popup({
    window: petWindow ?? undefined
  });
}

function movePetWithCursor(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = visibleWindowBounds(currentDisplays(), primaryDisplay(), {
    width: PET_WINDOW.width,
    height: PET_WINDOW.height,
    x: cursor.x - dragOffset.x,
    y: cursor.y - dragOffset.y
  });
  petWindow.setBounds(bounds);
}

function startPetDrag(offset: { offsetX: number; offsetY: number }): void {
  if (blockingMode === "breakRun" || !petWindow || petWindow.isDestroyed()) return;
  dragOffset = {
    x: Math.min(Math.max(Math.round(offset.offsetX), 0), PET_WINDOW.width),
    y: Math.min(Math.max(Math.round(offset.offsetY), 0), PET_WINDOW.height)
  };
  if (dragTimer) clearInterval(dragTimer);
  if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
  movePetWithCursor();
  dragTimer = setInterval(movePetWithCursor, 16);
  dragSafetyTimer = setTimeout(stopPetDrag, 15_000);
}

function stopPetDrag(): void {
  const wasDragging = Boolean(dragTimer || dragSafetyTimer);
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
  if (dragSafetyTimer) {
    clearTimeout(dragSafetyTimer);
    dragSafetyTimer = null;
  }
  if (wasDragging) {
    persistPetPosition();
    sendToAll("app:snapshot", snapshot());
  }
}

function clearBreakRunTimers(): void {
  if (breakRunTimer) {
    clearTimeout(breakRunTimer);
    breakRunTimer = null;
  }
  if (breakRunCountdownTimer) {
    clearInterval(breakRunCountdownTimer);
    breakRunCountdownTimer = null;
  }
  if (breakRunMovementTimer) {
    clearInterval(breakRunMovementTimer);
    breakRunMovementTimer = null;
  }
}

function showBreakRunCountdown(endsAt: number): void {
  const labels = text();
  const remainingSeconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const formatter = breakRunFormatter ?? pick(labels.bubble.breakRun);
  showBubble({
    id: "break-run",
    message: formatter(remainingSeconds),
    actions: [{ id: "break-run:done", label: labels.actions.breakRunDone, kind: "primary" }]
  });
}

function chooseBreakRunVelocity(): PetPosition {
  const speed = 3.5 + Math.random() * 2.9;
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.cos(angle) * speed,
    y: Math.sin(angle) * speed
  };
}

function movePetForBreakRun(): void {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;

  const bounds = petWindow.getBounds();
  const workArea = screen.getDisplayNearestPoint({
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2)
  }).workArea;
  const now = Date.now();
  const minX = workArea.x + 8;
  const maxX = workArea.x + workArea.width - PET_WINDOW.width - 8;
  const minY = workArea.y + 8;
  const maxY = workArea.y + workArea.height - PET_WINDOW.height - 8;

  if (now >= nextBreakRunTurnAt && Math.random() < 0.45) {
    breakRunVelocity = chooseBreakRunVelocity();
  }

  let nextX = bounds.x + breakRunVelocity.x;
  let nextY = bounds.y + breakRunVelocity.y;

  if (nextX <= minX) {
    nextX = minX;
    breakRunVelocity.x = Math.abs(breakRunVelocity.x);
  }
  if (nextX >= maxX) {
    nextX = maxX;
    breakRunVelocity.x = -Math.abs(breakRunVelocity.x);
  }
  if (nextY <= minY) {
    nextY = minY;
    breakRunVelocity.y = Math.abs(breakRunVelocity.y);
  }
  if (nextY >= maxY) {
    nextY = maxY;
    breakRunVelocity.y = -Math.abs(breakRunVelocity.y);
  }

  if (now >= nextBreakRunTurnAt) {
    nextBreakRunTurnAt = now + 350 + Math.round(Math.random() * 850);
  }

  setPetFacing(breakRunVelocity.x >= 0 ? "right" : "left");
  petWindow.setBounds({
    ...bounds,
    x: Math.round(nextX),
    y: Math.round(nextY)
  });
}

function finishBreakRun(): void {
  clearBreakRunTimers();
  breakRunFormatter = null;
  blockingMode = null;
  hideBubble();
  showBubble({ id: "break-run-complete", message: pick(text().bubble.breakRunComplete), autoDismissMs: 2200 });
  setPetState("breakDone");
  scheduleBreakReminderTimer();
  setTimeout(() => {
    if (!blockingMode && !focusActive) {
      if (showOverdueReminder()) return;
      hideBubble();
      setPetState("idle");
    }
  }, 2300);
  publishSnapshot();
}

function startBreakRun(): void {
  ensurePetWindowVisible();
  clearBreakRunTimers();
  blockingMode = "breakRun";
  breakDueAt = null;
  breakRunFormatter = pick(text().bubble.breakRun);
  breakRunVelocity = chooseBreakRunVelocity();
  nextBreakRunTurnAt = Date.now();
  setPetState("breakRunning");
  setPetFacing(breakRunVelocity.x >= 0 ? "right" : "left");
  const durationMs = getSettings().breakRunDurationSeconds * 1000;
  const endsAt = Date.now() + durationMs;
  showBreakRunCountdown(endsAt);
  breakRunCountdownTimer = setInterval(() => showBreakRunCountdown(endsAt), 1000);
  breakRunMovementTimer = setInterval(movePetForBreakRun, BREAK_RUN_TICK_MS);
  breakRunTimer = setTimeout(finishBreakRun, durationMs);
  publishSnapshot();
}

function clearBreakReminderTimer(): void {
  if (breakTimer) {
    clearTimeout(breakTimer);
    breakTimer = null;
  }
}

function clearHydrationReminderTimer(): void {
  if (hydrationTimer) {
    clearTimeout(hydrationTimer);
    hydrationTimer = null;
  }
}

function scheduleBreakReminderTimer(delayMs?: number): void {
  clearBreakReminderTimer();
  const settings = getSettings();
  if (!settings.breakReminderEnabled || breakMutedToday) {
    breakDueAt = null;
    publishSnapshot();
    return;
  }

  const nextDelayMs = delayMs ?? settings.breakIntervalMinutes * 60 * 1000;
  breakDueAt = Date.now() + nextDelayMs;
  breakTimer = setTimeout(() => triggerBreakReminder(false), nextDelayMs);
  publishSnapshot();
}

function scheduleHydrationReminderTimer(delayMs?: number): void {
  clearHydrationReminderTimer();
  const settings = getSettings();
  if (!settings.hydrationReminderEnabled) {
    hydrationDueAt = null;
    publishSnapshot();
    return;
  }

  const nextDelayMs = delayMs ?? settings.hydrationIntervalMinutes * 60 * 1000;
  hydrationDueAt = Date.now() + nextDelayMs;
  hydrationTimer = setTimeout(() => triggerHydrationReminder(false), nextDelayMs);
  publishSnapshot();
}

let workReminderTimer: NodeJS.Timeout | null = null;
let workReminderFirstTickTimer: NodeJS.Timeout | null = null;
let workReminderFired = new Set<string>();

function clearWorkReminderTimer(): void {
  if (workReminderTimer) {
    clearInterval(workReminderTimer);
    workReminderTimer = null;
  }
  if (workReminderFirstTickTimer) {
    clearTimeout(workReminderFirstTickTimer);
    workReminderFirstTickTimer = null;
  }
}

function emitWorkReminder(id: string, message: string, autoDismissMs = 15000): void {
  if (blockingMode || focusActive) return;
  ensurePetWindowVisible();
  setPetState("happy");
  showBubble({ id, message, autoDismissMs });
  showSystemNotification(message);
  setTimeout(() => {
    if (!blockingMode) setPetState(focusActive ? "focusGuard" : "idle");
  }, autoDismissMs + 200);
}

function checkWorkReminders(): void {
  const settings = getSettings();
  if (!settings.workClockEnabled) return;

  const now = new Date();
  const nowMs = now.getTime();
  const day = now.getDay() === 0 ? 7 : now.getDay();
  if (!settings.workDays.includes(day)) return;

  const work = computeWork(settings, now);
  if (work.checkedOut) return;

  const labels = text();
  const dayKey = dateKeyOf(now);

  const fire = (suffix: string, message: string, holdMs = 15000): void => {
    const key = `${dayKey}:${suffix}`;
    if (workReminderFired.has(key)) return;
    workReminderFired.add(key);
    if (workReminderFired.size > 240) workReminderFired = new Set([key]);
    emitWorkReminder(suffix, message, holdMs);
  };

  if (nowMs >= work.startMs - 5 * 60_000 && nowMs < work.startMs - 4 * 60_000) {
    fire("start-soon", pick(labels.bubble.workStartSoon));
  } else if (nowMs >= work.startMs && nowMs < work.startMs + 60_000) {
    fire("start", pick(labels.bubble.workStart));
  } else if (nowMs >= work.endMs - 15 * 60_000 && nowMs < work.endMs - 14 * 60_000) {
    fire("end-soon", pick(labels.bubble.workEndSoon));
  } else if (nowMs >= work.endMs && nowMs < work.endMs + 60_000) {
    fire("end", pick(labels.bubble.workEnd), 20000);
  }

  if (
    settings.workHourlyReminderEnabled &&
    work.state === "working" &&
    now.getMinutes() === 0 &&
    now.getSeconds() < 20 &&
    nowMs > work.startMs
  ) {
    fire(`hourly-${now.getHours()}`, pick(labels.bubble.workHourly));
  }

  if (settings.workOvertimeEnabled && work.state === "after" && work.overtimeSeconds > 0) {
    const intervalSeconds = Math.max(1, settings.workOvertimeIntervalMinutes) * 60;
    const step = Math.floor(work.overtimeSeconds / intervalSeconds);
    const inWindow = work.overtimeSeconds % intervalSeconds < 20;
    if (step >= 1 && inWindow) {
      const template = pick(labels.bubble.workOvertime);
      fire(`overtime-${step}`, template(formatDuration(work.overtimeSeconds)), 20000);
    }
  }
}

function scheduleWorkReminders(): void {
  clearWorkReminderTimer();
  workReminderFired.clear();
  if (!getSettings().workClockEnabled) return;
  checkWorkReminders();
  workReminderFirstTickTimer = setTimeout(checkWorkReminders, 3_000);
  workReminderTimer = setInterval(checkWorkReminders, 15_000);
}

function scheduleReminderTimers(): void {
  clearBreakReminderTimer();
  clearHydrationReminderTimer();
  breakDueAt = null;
  hydrationDueAt = null;

  scheduleBreakReminderTimer();
  scheduleHydrationReminderTimer();
  scheduleWorkReminders();
}

/* ------------------------------------------------------------------ *
 * WorkBuddy 任务状态桥
 * 钩子把对话事件写进 ~/.xiaojimao/workbuddy-events，这里折算成三态。
 * ------------------------------------------------------------------ */

function workBuddyPhaseLabel(phase: WorkBuddyPhase | "idle"): string {
  const labels = text().settings;
  if (phase === "running") return labels.workBuddyPhaseRunning;
  if (phase === "needsInput") return labels.workBuddyPhaseNeedsInput;
  if (phase === "done") return labels.workBuddyPhaseDone;
  return labels.workBuddyPhaseIdle;
}

function showSystemNotification(message: string): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: APP_NAME, body: message, silent: false });
  notification.on("click", () => ensurePetWindowVisible());
  notification.show();
}

function reactToWorkBuddyPhase(next: WorkBuddyStatus): void {
  const settings = getSettings();
  if (!settings.workBuddyEnabled) return;
  if (blockingMode) return;

  const labels = text();
  const primary = primaryWorkBuddySession(next);
  const agentName = primary?.agent || "WorkBuddy";

  if (next.phase === "needsInput") {
    ensurePetWindowVisible();
    if (!focusActive) setPetState("focusAlert");
    if (!settings.workBuddyNotifyEnabled) return;

    // 任务刚起步时状态会抖一下，等 1.2 秒确认还在等你再弹
    if (needsInputNoticeTimer) clearTimeout(needsInputNoticeTimer);
    needsInputNoticeTimer = setTimeout(() => {
      needsInputNoticeTimer = null;
      if (workBuddyStatus.phase !== "needsInput") return;
      if (!petRendererReady) {
        pendingWorkBuddyNotice = workBuddyStatus;
        return;
      }
      const message = pick(labels.bubble.workBuddyNeedsInput)(agentName);
      showBubble({
        id: "workbuddy-needs-input",
        message,
        actions: [
          { id: "workbuddy:dismiss", label: labels.actions.workBuddyDismiss, kind: "primary" }
        ],
        autoDismissMs: 20000
      });
      showSystemNotification(message);
    }, NEEDS_INPUT_NOTICE_DELAY_MS);
    return;
  }

  if (next.phase === "done") {
    if (!focusActive) setPetState("happy");
    if (!settings.workBuddyNotifyEnabled) return;
    if (!petRendererReady) {
      pendingWorkBuddyNotice = next;
      return;
    }
    const message = pick(labels.bubble.workBuddyDone)(agentName);
    showBubble({ id: "workbuddy-done", message, autoDismissMs: 3200 });
    showSystemNotification(message);
    setTimeout(() => {
      if (blockingMode) return;
      hideBubble();
      setPetState(focusActive ? "focusGuard" : "idle");
    }, 3300);
    return;
  }

  if (next.phase === "running") {
    if (!focusActive && petState !== "breakRunning") setPetState("focusGuard");
    return;
  }

  if (!focusActive && (petState === "focusGuard" || petState === "focusAlert")) {
    setPetState("idle");
  }
}

function applyWorkBuddyStatus(next: WorkBuddyStatus): void {
  const previous = workBuddyStatus;
  const changed = JSON.stringify(previous) !== JSON.stringify(next);
  workBuddyStatus = next;

  // 状态离开了「等你选」，之前那条气泡就不该继续挂着
  if (previous.phase === "needsInput" && next.phase !== "needsInput") {
    if (needsInputNoticeTimer) {
      clearTimeout(needsInputNoticeTimer);
      needsInputNoticeTimer = null;
    }
    hideBubble({ onlyId: "workbuddy-needs-input" });
  }

  if (previous.phase !== next.phase) reactToWorkBuddyPhase(next);
  if (changed) publishSnapshot();
}

async function ingestWorkBuddyEvents(): Promise<void> {
  if (workBuddyIngesting || !getSettings().workBuddyEnabled) return;
  workBuddyIngesting = true;

  try {
    const eventDir = resolveWorkBuddyEventDir();
    const now = Date.now();
    const events: WorkBuddyEvent[] = [];
    const pending: Array<{ path: string; agent?: string }> = [];

    try {
      // 根目录是 WorkBuddy 的老位置，子目录是各 agent 的事件（名字即 agent）
      for (const entry of await readdir(eventDir, { withFileTypes: true })) {
        const fullPath = join(eventDir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith(".")) continue;
          let files: string[] = [];
          try {
            files = await readdir(fullPath);
          } catch {
            continue;
          }
          for (const name of files) {
            if (name.endsWith(".json")) pending.push({ path: join(fullPath, name), agent: entry.name });
          }
        } else if (entry.name.endsWith(".json")) {
          pending.push({ path: fullPath });
        }
      }
    } catch {
      // 目录还没建好
    }

    for (const item of pending.slice(0, 400)) {
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(item.path)).mtimeMs;
      } catch {
        continue;
      }
      // 刚落的文件可能还没写完，留到下一轮
      if (now - mtimeMs < 150) continue;

      try {
        const raw = await readFile(item.path, "utf8");
        const payload = JSON.parse(raw) as unknown;
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          const hookPayload = payload as WorkBuddyHookPayload;
          events.push({ payload: hookPayload, at: mtimeMs, agent: item.agent });

          // 诊断页：记录每个 agent 最近一条事件与累计条数
          const label = normalizeAgentName(
            hookPayload.agent ?? hookPayload.client ?? item.agent
          );
          const stat = agentEventStats.get(label) ?? { lastAt: 0, lastName: "", count: 0 };
          stat.lastAt = mtimeMs;
          stat.lastName = typeof hookPayload.hook_event_name === "string" ? hookPayload.hook_event_name : "";
          stat.count += 1;
          agentEventStats.set(label, stat);
        }
      } catch {
        // 坏文件直接清掉，避免反复重试
      }
      await unlink(item.path).catch(() => undefined);
    }

    if (events.length) {
      workBuddySessions = applyWorkBuddyEvents(workBuddySessions, events);
    }
    applyWorkBuddyStatus(summarizeWorkBuddy(workBuddySessions, Date.now()));
  } finally {
    workBuddyIngesting = false;
  }
}

function scheduleWorkBuddyBridge(): void {
  if (workBuddyTimer) {
    clearInterval(workBuddyTimer);
    workBuddyTimer = null;
  }

  if (!getSettings().workBuddyEnabled) {
    if (needsInputNoticeTimer) {
      clearTimeout(needsInputNoticeTimer);
      needsInputNoticeTimer = null;
    }
    workBuddySessions = {};
    applyWorkBuddyStatus(EMPTY_WORKBUDDY_STATUS);
    return;
  }

  void mkdir(resolveWorkBuddyEventDir(), { recursive: true }).catch(() => undefined);
  // 等桌宠窗口挂好监听再消费历史事件，否则气泡会打在空气里
  setTimeout(() => void ingestWorkBuddyEvents(), 900);
  workBuddyTimer = setInterval(() => void ingestWorkBuddyEvents(), 800);
}

async function refreshWorkBuddyIntegration(): Promise<void> {
  workBuddyIntegrations = await detectAllAgents();
  publishSnapshot();
}

function toAgentDiagnostics(input: {
  id: string;
  label: string;
  installed: boolean;
  detected: boolean;
  settingsPath: string;
  scriptPath: string;
  error: string | null;
}): AgentDiagnostics {
  const stat = agentEventStats.get(input.label);
  return {
    ...input,
    settingsExists: input.settingsPath ? existsSync(input.settingsPath) : false,
    scriptExists: input.scriptPath ? existsSync(input.scriptPath) : false,
    lastEventAt: stat?.lastAt ?? null,
    lastEventName: stat?.lastName || null,
    eventsThisRun: stat?.count ?? 0
  };
}

/**
 * 诊断页的数据源：每个 agent 装没装、文件在不在、这次运行有没有收到事件。
 * 「装了但没事件」和「压根没装」要能一眼分开，排障就靠这个。
 */
async function buildDiagnostics(): Promise<Diagnostics> {
  const eventDir = resolveWorkBuddyEventDir();
  const agents: AgentDiagnostics[] = [];

  for (const target of SUPPORTED_AGENT_TARGETS) {
    const integration = await detectAgentIntegration(target);
    agents.push(
      toAgentDiagnostics({
        id: target,
        label: integration.label,
        installed: integration.installed,
        detected: integration.detected,
        settingsPath: integration.settingsPath,
        scriptPath: integration.scriptPath,
        error: integration.error
      })
    );
  }

  // DeepSeek Harness 走 Cordis 插件，检查 profile 里的依赖是否装了
  const home = app.getPath("home");
  const dshProfile = join(home, ".dsh", "profiles", "desktop");
  const dshPlugin = join(dshProfile, "node_modules", "dsh-xiaojimao-bridge");
  agents.push(
    toAgentDiagnostics({
      id: "dsh",
      label: "DeepSeek Harness",
      installed: existsSync(dshPlugin),
      detected: existsSync(join(home, ".dsh")),
      settingsPath: join(dshProfile, "cordis.patch.yml"),
      scriptPath: join(dshPlugin, "index.js"),
      error: null
    })
  );

  return {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    userDataPath: app.getPath("userData"),
    eventDir,
    eventDirExists: existsSync(eventDir),
    generatedAt: Date.now(),
    agents
  };
}

function showWorkBuddyDetails(): void {
  ensurePetWindowVisible();
  const labels = text();

  if (!workBuddyStatus.sessions.length) {
    showBubble({
      id: "workbuddy-empty",
      message: labels.settings.workBuddyEmptyHint,
      autoDismissMs: 6000
    });
    return;
  }

  const lines = workBuddyStatus.sessions.slice(0, 3).map((session) => {
    const project = session.project ? ` · ${session.project}` : "";
    const title = session.title ? `：${session.title}` : "";
    return `· ${session.agent}｜${workBuddyPhaseLabel(session.phase)}${project}${title}`;
  });

  showBubble({ id: "workbuddy-details", message: lines.join("\n"), autoDismissMs: 15000 });
}

function openWorkBuddyEventDir(): void {
  const eventDir = resolveWorkBuddyEventDir();
  void mkdir(eventDir, { recursive: true })
    .then(() => shell.openPath(eventDir))
    .catch(() => undefined);
}

function showOverdueReminder(): boolean {
  if (blockingMode || focusActive) return false;

  const now = Date.now();
  const settings = getSettings();
  if (settings.breakReminderEnabled && !breakMutedToday && breakDueAt !== null && breakDueAt <= now) {
    triggerBreakReminder(false);
    return true;
  }
  if (settings.hydrationReminderEnabled && hydrationDueAt !== null && hydrationDueAt <= now) {
    triggerHydrationReminder(false);
    return true;
  }

  return false;
}

function setDistractionStatus(partial: Partial<DistractionStatus>): void {
  distractionStatus = { ...distractionStatus, ...partial };
  publishSnapshot();
}

async function checkDistractionNow(): Promise<void> {
  const settings = getSettings();
  if (!settings.distractionDetectionEnabled) return;

  try {
    const active = await readActiveWindow();
    const matchedRule = classifyDistraction(active, settings);
    const now = Date.now();

    setDistractionStatus({
      state: "watching",
      activeApp: active.appName,
      activeWindowTitle: active.windowTitle,
      matchedRule,
      lastCheckedAt: now,
      error: null
    });

    if (!focusActive || blockingMode === "focusWarning") return;
    if (!matchedRule) return;
    if (
      distractionStatus.lastWarningAt &&
      now - distractionStatus.lastWarningAt < DISTRACTION_WARNING_COOLDOWN_MS
    ) {
      return;
    }

    setDistractionStatus({ lastWarningAt: now });
    triggerFocusWarning(matchedRule.replace(/^(app|keyword):/, ""));
  } catch (error) {
    setDistractionStatus({
      state: isPermissionError(error) ? "permission-needed" : "error",
      error: error instanceof Error ? error.message : String(error),
      lastCheckedAt: Date.now()
    });
  }
}

function scheduleDistractionDetection(): void {
  if (distractionTimer) {
    clearInterval(distractionTimer);
    distractionTimer = null;
  }
  if (distractionStartupTimer) {
    clearTimeout(distractionStartupTimer);
    distractionStartupTimer = null;
  }

  const settings = getSettings();
  if (!settings.distractionDetectionEnabled) {
    setDistractionStatus({
      state: "idle",
      matchedRule: null,
      error: null
    });
    return;
  }

  setDistractionStatus({
    state: process.platform === "darwin" ? "watching" : "unsupported",
    error: process.platform === "darwin" ? null : text().system.unsupportedDistraction
  });

  if (process.platform !== "darwin") return;

  const firstCheckDelay = focusActive ? Math.max(0, settings.distractionGraceSeconds * 1000) : 0;
  distractionStartupTimer = setTimeout(() => {
    void checkDistractionNow();
    distractionTimer = setInterval(() => void checkDistractionNow(), DISTRACTION_CHECK_INTERVAL_MS);
  }, firstCheckDelay);
}

function resumeLongTermState(): void {
  blockingMode = null;
  hideBubble();
  if (showOverdueReminder()) return;
  if (focusActive) {
    setPetState("focusGuard");
    sendToAll("app:snapshot", snapshot());
    return;
  }
  setPetState("idle");
  sendToAll("app:snapshot", snapshot());
}

function happyFeedback(message: string | null = pick(text().bubble.woof), after?: () => void): void {
  if (blockingMode) return;
  const returnState = focusActive ? "focusGuard" : "idle";
  setPetState("happy");
  if (message) {
    showBubble({ id: "happy", message, autoDismissMs: 1800 });
  }
  setTimeout(() => {
    hideBubble();
    setPetState(returnState);
    after?.();
  }, 1900);
}

function setUpdateCheck(next: UpdateCheckResult): void {
  updateCheck = next;
  publishSnapshot();
}

function openReleaseNotes(): void {
  void shell.openExternal(updateCheck.releaseUrl || RELEASES_URL).catch((error) => {
    console.error("Failed to open PawPal releases:", error);
  });
}

function showUpdateAvailableNotice(result: UpdateCheckResult): void {
  if (blockingMode || result.status !== "available" || !result.latestVersion) return;
  ensurePetWindowVisible();
  setPetState("happy");
  showBubble({
    id: "update-available",
    message: pick(text().bubble.updateAvailable)(result.latestVersion),
    actions: [
      { id: "app:open-release-notes", label: text().settings.openReleaseNotes, kind: "primary" }
    ],
    autoDismissMs: 12000
  });
  setTimeout(() => {
    if (!blockingMode && petState === "happy") setPetState(focusActive ? "focusGuard" : "idle");
  }, 12_100);
}

async function checkForUpdates(options: { notifyAvailable?: boolean } = {}): Promise<UpdateCheckResult> {
  const checking = createCheckingUpdateCheck(updateCheck);
  setUpdateCheck(checking);
  const result = await checkGitHubReleasesForUpdates(checking);
  setUpdateCheck(result);
  if (options.notifyAvailable) showUpdateAvailableNotice(result);
  return result;
}

function triggerBreakReminder(fromDemo: boolean): void {
  if (!fromDemo) {
    breakTimer = null;
    if (breakMutedToday) {
      breakDueAt = null;
      publishSnapshot();
      return;
    }
    if (blockingMode || focusActive) {
      publishSnapshot();
      return;
    }
  } else if (blockingMode === "focusWarning" || blockingMode === "breakRun") {
    return;
  }
  ensurePetWindowVisible();
  blockingMode = "break";
  breakDueAt = null;
  publishSnapshot();
  setPetState("breakPrompt");
  const labels = text();
  showBubble({
    id: "break",
    message: pick(labels.bubble.breakReminder),
    actions: [
      { id: "break:done", label: labels.actions.breakDone, kind: "primary" },
      { id: "break:snooze", label: labels.actions.breakSnooze },
      { id: "break:mute", label: labels.actions.breakMute, kind: "danger" }
    ]
  });
}

function triggerHydrationReminder(fromDemo: boolean): void {
  if (!fromDemo) {
    hydrationTimer = null;
    if (blockingMode || focusActive) {
      publishSnapshot();
      return;
    }
  } else if (blockingMode) {
    return;
  }
  ensurePetWindowVisible();
  blockingMode = "hydration";
  hydrationDueAt = null;
  publishSnapshot();
  setPetState("hydrationPrompt");
  const labels = text();
  showBubble({
    id: "hydration",
    message: pick(labels.bubble.hydrationReminder),
    actions: [
      { id: "hydration:done", label: labels.actions.hydrationDone, kind: "primary" },
      { id: "hydration:snooze", label: labels.actions.hydrationSnooze }
    ]
  });
}

function triggerFocusWarning(rule?: string): void {
  if (blockingMode === "breakRun") return;
  ensurePetWindowVisible();
  if (!focusActive) startFocusMode();
  blockingMode = "focusWarning";
  updateStats((stats) => ({ ...stats, focusWarnings: stats.focusWarnings + 1 }));
  setPetState("focusAlert");
  sendToAll("app:snapshot", snapshot());
  const labels = text();
  showBubble({
    id: "focus-warning",
    message: pick(labels.bubble.focusWarning)(rule ?? "?"),
    actions: [
      { id: "focus:back", label: labels.actions.focusBack, kind: "primary" },
      { id: "focus:end", label: labels.actions.focusEnd }
    ]
  });
}

function startFocusMode(): void {
  if (focusActive || blockingMode) return;
  ensurePetWindowVisible();
  const settings = getSettings();
  focusActive = true;
  focusStartedAt = Date.now();
  blockingMode = null;
  setPetState("focusGuard");
  focusEndsAt = Date.now() + settings.focusDurationMinutes * 60 * 1000;
  sendToAll("app:snapshot", snapshot());
  showBubble({
    id: "focus-start",
    message: pick(text().bubble.focusStart)(settings.focusDurationMinutes),
    autoDismissMs: 4500
  });
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = setTimeout(
    () => stopFocusMode(true),
    settings.focusDurationMinutes * 60 * 1000
  );
  scheduleDistractionDetection();
  updateTrayMenu();
}

function stopFocusMode(completed: boolean): void {
  if (!focusActive) return;
  const startedAt = focusStartedAt ?? Date.now();
  const elapsedMinutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  focusActive = false;
  focusStartedAt = null;
  blockingMode = null;
  if (focusTimer) {
    clearTimeout(focusTimer);
    focusTimer = null;
  }
  focusEndsAt = null;
  scheduleDistractionDetection();
  updateStats((stats) => ({
    ...stats,
    focusMinutes: stats.focusMinutes + elapsedMinutes
  }));
  sendToAll("app:snapshot", snapshot());
  setPetState("focusDone");
  showBubble({
    id: "focus-complete",
    message: completed ? pick(text().bubble.focusComplete) : pick(text().bubble.focusCancelled),
    autoDismissMs: 2800
  });
  setTimeout(() => {
    if (!focusActive && !blockingMode) {
      if (showOverdueReminder()) return;
      hideBubble();
      setPetState("idle");
    }
  }, 2900);
  updateTrayMenu();
}

function triggerDemo(trigger: DemoTrigger): void {
  ensurePetWindowVisible();
  if (trigger === "break") triggerBreakReminder(true);
  if (trigger === "hydration") triggerHydrationReminder(true);
  if (trigger === "focusWarning") triggerFocusWarning("Twitter");
  if (trigger === "happy") happyFeedback(pick(text().bubble.woof));
}

function handleBubbleAction(actionId: string): void {
  if (actionId === "workbuddy:dismiss") {
    hideBubble();
    if (!blockingMode) {
      setPetState(
        focusActive ? "focusGuard" : workBuddyStatus.phase === "needsInput" ? "focusAlert" : "idle"
      );
    }
    return;
  }
  if (actionId === "app:open-release-notes") {
    hideBubble();
    setPetState(focusActive ? "focusGuard" : "idle");
    openReleaseNotes();
    return;
  }
  if (actionId === "break-run:done") {
    finishBreakRun();
    return;
  }
  if (actionId === "break:done") {
    updateStats((stats) => ({ ...stats, breaksTaken: stats.breaksTaken + 1 }));
    startBreakRun();
    return;
  }
  if (actionId === "break:snooze") {
    resumeLongTermState();
    scheduleBreakReminderTimer(10 * 60 * 1000);
    return;
  }
  if (actionId === "break:mute") {
    breakMutedToday = true;
    breakDueAt = null;
    blockingMode = null;
    sendToAll("app:snapshot", snapshot());
    setPetState("sad");
    showBubble({ id: "break-muted", message: pick(text().bubble.breakIgnore), autoDismissMs: 2600 });
    setTimeout(resumeLongTermState, 2700);
    return;
  }
  if (actionId === "hydration:done") {
    updateStats((stats) => ({ ...stats, watersLogged: stats.watersLogged + 1 }));
    blockingMode = null;
    sendToAll("app:snapshot", snapshot());
    setPetState("drinking");
    hideBubble();
    setTimeout(() => {
      if (blockingMode) return;
      setPetState("hydrationDone");
      showBubble({ id: "hydration-complete", message: pick(text().bubble.hydrationDone), autoDismissMs: 1800 });
      setTimeout(() => {
        scheduleHydrationReminderTimer();
        if (showOverdueReminder()) return;
        hideBubble();
        setPetState(focusActive ? "focusGuard" : "idle");
      }, 1900);
    }, 2400);
    return;
  }
  if (actionId === "hydration:snooze") {
    resumeLongTermState();
    scheduleHydrationReminderTimer(15 * 60 * 1000);
    return;
  }
  if (actionId === "focus:back") {
    blockingMode = null;
    sendToAll("app:snapshot", snapshot());
    setPetState("focusGuard");
    showBubble({ id: "focus-back", message: pick(text().bubble.focusBack), autoDismissMs: 1800 });
    setTimeout(() => {
      if (focusActive && !blockingMode) hideBubble();
    }, 1900);
    return;
  }
  if (actionId === "focus:end") {
    stopFocusMode(false);
  }
}

function registerIpc(): void {
  ipcMain.handle("app:get-snapshot", () => snapshot());
  ipcMain.handle("app:check-for-updates", () => checkForUpdates({ notifyAvailable: true }));
  ipcMain.handle("custom-pet:select-asset", (_event, state: PetState) =>
    selectCustomPetAsset(state)
  );
  ipcMain.handle("custom-pet:import-asset", (_event, state: PetState, sourcePath: string) =>
    importCustomPetAsset(state, sourcePath)
  );
  ipcMain.on("app:open-release-notes", openReleaseNotes);
  ipcMain.on("pet:clicked", () => {
    if (blockingMode) return;
    happyFeedback(null);
  });
  ipcMain.on("pet:context-menu", showPetContextMenu);
  ipcMain.on("pet:drag-start", (_event, offset: { offsetX: number; offsetY: number }) =>
    startPetDrag(offset)
  );
  ipcMain.on("pet:drag-stop", stopPetDrag);
  ipcMain.on("pet:set-mouse-interactive", (_event, interactive: boolean) => {
    setPetMouseInteractive(interactive);
  });
  ipcMain.on("bubble:action", (_event, actionId: string) => handleBubbleAction(actionId));
  ipcMain.on("settings:update", (_event, partial: Partial<Settings>) => {
    setSettings({ ...getSettings(), ...partial });
  });
  ipcMain.on("demo:trigger", (_event, trigger: DemoTrigger) => triggerDemo(trigger));
  ipcMain.on("focus:start", startFocusMode);
  ipcMain.on("focus:stop", () => stopFocusMode(false));
  ipcMain.on("stats:reset-today", resetTodayStats);
  ipcMain.handle("workbuddy:install-hooks", async (_event, target: AgentHookTarget) => {
    await installAgentHooks(target);
    await refreshWorkBuddyIntegration();
    return workBuddyIntegrations.find((item) => item.id === target) ?? null;
  });
  ipcMain.handle("workbuddy:remove-hooks", async (_event, target: AgentHookTarget) => {
    await uninstallAgentHooks(target);
    await refreshWorkBuddyIntegration();
    return workBuddyIntegrations.find((item) => item.id === target) ?? null;
  });
  ipcMain.on("workbuddy:open-event-dir", openWorkBuddyEventDir);
  ipcMain.on("workbuddy:show-status", showWorkBuddyDetails);

  ipcMain.handle("diagnostics:get", () => buildDiagnostics());
  ipcMain.handle("clipboard:write", (_event, text: unknown) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });
  ipcMain.on("work:checkout", () => {
    const settings = getSettings();
    const now = new Date();
    setSettings({
      ...settings,
      workCheckoutDate: dateKeyOf(now),
      workCheckoutAt: now.getTime()
    });
    hideBubble();
    ensurePetWindowVisible();
    setPetState("happy");
    showBubble({
      id: "work-checkout",
      message: pick(text().bubble.workCheckout),
      autoDismissMs: 12000
    });
    setTimeout(() => {
      if (!blockingMode) setPetState(focusActive ? "focusGuard" : "idle");
    }, 12200);
  });
}

protocol.registerSchemesAsPrivileged([
  { scheme: "pawpal-asset", privileges: { bypassCSP: true, supportFetchAPI: true } }
]);

app.whenReady().then(() => {
  protocol.handle("pawpal-asset", (request) => {
    let relativePath = "";
    try {
      const url = new URL(request.url);
      relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    } catch {
      return new Response("Invalid asset URL", { status: 404 });
    }

    const appBase = app.isPackaged ? process.resourcesPath : process.cwd();
    const builtInAssetRoot = resolve(appBase, "pet_assets");
    const customAssetRoot = resolve(app.getPath("userData"), "custom_pet_assets");
    const assetPath = relativePath.startsWith("custom_pet_assets/")
      ? resolve(app.getPath("userData"), relativePath)
      : resolve(appBase, relativePath);
    const isInsideBuiltInAssetRoot =
      assetPath === builtInAssetRoot || assetPath.startsWith(`${builtInAssetRoot}${sep}`);
    const isInsideCustomAssetRoot =
      assetPath === customAssetRoot || assetPath.startsWith(`${customAssetRoot}${sep}`);

    if (!isInsideBuiltInAssetRoot && !isInsideCustomAssetRoot) {
      return new Response("Asset not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(assetPath).href);
  });

  getStats();
  registerIpc();
  createPetWindow();
  createTray();
  registerDisplayChangeHandlers();
  scheduleReminderTimers();
  scheduleDistractionDetection();
  configureFullscreenDetection();
  scheduleWorkBuddyBridge();
  void refreshWorkBuddyIntegration();
  if (IS_DEV) {
    createSettingsWindow();
  }
  if (getSettings().checkUpdatesOnLaunchEnabled) {
    setTimeout(() => void checkForUpdates({ notifyAvailable: true }), 1500);
  }

  app.on("activate", () => {
    if (!petWindow) createPetWindow();
  });
});

app.on("before-quit", () => {
  stopFullscreenWatcher?.();
  stopFullscreenWatcher = null;
  for (const timer of [
    breakRunTimer,
    breakRunCountdownTimer,
    breakRunMovementTimer,
    breakTimer,
    hydrationTimer,
    focusTimer,
    distractionTimer,
    distractionStartupTimer,
    displayChangeTimer,
    bubbleTimer,
    dragTimer,
    dragSafetyTimer,
    workBuddyTimer
  ]) {
    if (timer) clearTimeout(timer);
  }
});

app.on("window-all-closed", () => {
  // Keep the menu-bar utility alive after the settings window is closed.
});
