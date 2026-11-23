import { app } from "electron";

export function supportsLoginItemSettings(): boolean {
  return (process.platform === "darwin" || process.platform === "win32") && app.isPackaged;
}

export function applyLaunchAtLoginPreference(enabled: boolean): void {
  if (!supportsLoginItemSettings()) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    // 显式给出当前 exe：程序目录搬过家之后，注册表里的旧路径会被这条覆盖掉
    path: process.execPath,
    args: []
  });
}

export function getLaunchAtLoginState(fallback: boolean): boolean {
  if (!supportsLoginItemSettings()) return fallback;
  return app.getLoginItemSettings().openAtLogin;
}
