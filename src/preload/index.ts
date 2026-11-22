import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AgentHookTarget,
  AgentIntegration,
  AppSnapshot,
  CustomPetAsset,
  DemoTrigger,
  Diagnostics,
  PetState,
  Settings,
  SpeechBubble,
  TodayStats,
  UpdateCheckResult,
  WbSwitchSnapshot,
  WorkBuddyLinkStatus
} from "../shared/types";

type Unsubscribe = () => void;

function onChannel<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  getSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke("app:get-snapshot"),
  openReleaseNotes: (): void => ipcRenderer.send("app:open-release-notes"),
  checkForUpdates: (): Promise<UpdateCheckResult> => ipcRenderer.invoke("app:check-for-updates"),
  selectCustomPetAsset: (state: PetState): Promise<CustomPetAsset | null> =>
    ipcRenderer.invoke("custom-pet:select-asset", state),
  importCustomPetAsset: (state: PetState, sourcePath: string): Promise<CustomPetAsset | null> =>
    ipcRenderer.invoke("custom-pet:import-asset", state, sourcePath),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  petClicked: (): void => ipcRenderer.send("pet:clicked"),
  petContextMenu: (): void => ipcRenderer.send("pet:context-menu"),
  petDragStart: (offset: { offsetX: number; offsetY: number }): void =>
    ipcRenderer.send("pet:drag-start", offset),
  petDragStop: (): void => ipcRenderer.send("pet:drag-stop"),
  setMouseInteractive: (interactive: boolean): void =>
    ipcRenderer.send("pet:set-mouse-interactive", interactive),
  bubbleAction: (actionId: string): void => ipcRenderer.send("bubble:action", actionId),
  updateSettings: (settings: Partial<Settings>): void =>
    ipcRenderer.send("settings:update", settings),
  triggerDemo: (trigger: DemoTrigger): void => ipcRenderer.send("demo:trigger", trigger),
  isPackaged: !process.defaultApp,
  assetUrl: (relativePath: string): string => {
    return `pawpal-asset://asset/${encodeURIComponent(relativePath)}`;
  },
  startFocus: (): void => ipcRenderer.send("focus:start"),
  stopFocus: (): void => ipcRenderer.send("focus:stop"),
  resetToday: (): void => ipcRenderer.send("stats:reset-today"),
  checkoutWork: (): void => ipcRenderer.send("work:checkout"),
  installWorkBuddyHooks: (target: AgentHookTarget): Promise<AgentIntegration | null> =>
    ipcRenderer.invoke("workbuddy:install-hooks", target),
  removeWorkBuddyHooks: (target: AgentHookTarget): Promise<AgentIntegration | null> =>
    ipcRenderer.invoke("workbuddy:remove-hooks", target),
  openWorkBuddyEventDir: (): void => ipcRenderer.send("workbuddy:open-event-dir"),
  showWorkBuddyStatus: (): void => ipcRenderer.send("workbuddy:show-status"),
  getDiagnostics: (): Promise<Diagnostics> => ipcRenderer.invoke("diagnostics:get"),
  startWorkBuddyLink: (): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke("workbuddy:link-start"),
  getWorkBuddyLinkStatus: (): Promise<WorkBuddyLinkStatus> =>
    ipcRenderer.invoke("workbuddy:link-status"),
  refreshWorkBuddyLink: (): Promise<WorkBuddyLinkStatus> =>
    ipcRenderer.invoke("workbuddy:link-refresh"),
  clearWorkBuddyLink: (): Promise<WorkBuddyLinkStatus> =>
    ipcRenderer.invoke("workbuddy:link-clear"),
  startQoderLink: (): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke("qoder:link-start"),
  getQoderLinkStatus: (): Promise<WorkBuddyLinkStatus> =>
    ipcRenderer.invoke("qoder:link-status"),
  refreshQoderLink: (): Promise<WorkBuddyLinkStatus> =>
    ipcRenderer.invoke("qoder:link-refresh"),
  clearQoderLink: (): Promise<WorkBuddyLinkStatus> =>
    ipcRenderer.invoke("qoder:link-clear"),
  syncWbSwitch: (): Promise<WbSwitchSnapshot> => ipcRenderer.invoke("wbswitch:sync"),
  redetectAgents: (): Promise<AgentIntegration[]> => ipcRenderer.invoke("agents:redetect"),
  getWbSwitchStatus: (): Promise<WbSwitchSnapshot | null> =>
    ipcRenderer.invoke("wbswitch:status"),
  writeClipboard: (text: string): Promise<boolean> => ipcRenderer.invoke("clipboard:write", text),
  onPetState: (callback: (state: PetState) => void): Unsubscribe =>
    onChannel("pet:set-state", callback),
  onShowBubble: (callback: (bubble: SpeechBubble) => void): Unsubscribe =>
    onChannel("pet:show-bubble", callback),
  onHideBubble: (callback: () => void): Unsubscribe => onChannel("pet:hide-bubble", callback),
  onSettingsUpdated: (callback: (settings: Settings) => void): Unsubscribe =>
    onChannel("settings:updated", callback),
  onStatsUpdated: (callback: (stats: TodayStats) => void): Unsubscribe =>
    onChannel("stats:updated", callback),
  onSnapshot: (callback: (snapshot: AppSnapshot) => void): Unsubscribe =>
    onChannel("app:snapshot", callback)
};

contextBridge.exposeInMainWorld("pawpal", api);

export type PawPalApi = typeof api;
