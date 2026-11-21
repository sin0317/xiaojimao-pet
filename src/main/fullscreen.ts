import { execFile, spawn } from "node:child_process";

export type ScreenRectangle = {
  Left: number;
  Top: number;
  Right: number;
  Bottom: number;
};

export type WindowsFullscreenSnapshot = {
  Ignored: boolean;
  Window: ScreenRectangle;
  Monitor: ScreenRectangle;
};

export function isFullscreenSnapshot(snapshot: WindowsFullscreenSnapshot): boolean {
  if (snapshot.Ignored) return false;

  const tolerance = 2;
  const window = snapshot.Window;
  const monitor = snapshot.Monitor;
  return (
    window.Left <= monitor.Left + tolerance &&
    window.Top <= monitor.Top + tolerance &&
    window.Right >= monitor.Right - tolerance &&
    window.Bottom >= monitor.Bottom - tolerance
  );
}

const WINDOWS_PROBE_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class PawPalFullscreenProbe
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO
    {
        public int Size;
        public RECT Monitor;
        public RECT Work;
        public uint Flags;
    }

    public class Snapshot
    {
        public bool Ignored = true;
        public RECT Window;
        public RECT Monitor;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder className, int maxCount);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out RECT rect);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    public static Snapshot ReadSnapshot()
    {
        var snapshot = new Snapshot();
        var window = GetForegroundWindow();
        if (window == IntPtr.Zero || window == GetDesktopWindow() || window == GetShellWindow() ||
            !IsWindowVisible(window) || IsIconic(window))
        {
            return snapshot;
        }

        var className = new StringBuilder(256);
        GetClassName(window, className, className.Capacity);
        var windowClass = className.ToString();
        if (windowClass == "Progman" || windowClass == "WorkerW" ||
            windowClass == "Shell_TrayWnd" || windowClass == "Shell_SecondaryTrayWnd")
        {
            return snapshot;
        }

        RECT windowRect;
        if (!GetWindowRect(window, out windowRect)) return snapshot;

        var monitor = MonitorFromWindow(window, 2);
        var monitorInfo = new MONITORINFO();
        monitorInfo.Size = Marshal.SizeOf(typeof(MONITORINFO));
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref monitorInfo)) return snapshot;

        snapshot.Window = windowRect;
        snapshot.Monitor = monitorInfo.Monitor;
        snapshot.Ignored = false;
        return snapshot;
    }
}
"@

while ($true) {
  try {
    $snapshot = [PawPalFullscreenProbe]::ReadSnapshot()
    [Console]::WriteLine((ConvertTo-Json -InputObject $snapshot -Compress -Depth 3))
  } catch {
    [Console]::WriteLine('{"Ignored":true,"Window":{"Left":0,"Top":0,"Right":0,"Bottom":0},"Monitor":{"Left":0,"Top":0,"Right":0,"Bottom":0}}')
  }
  Start-Sleep -Milliseconds 500
}
`;

const MAC_FULLSCREEN_SCRIPT = `
tell application "System Events"
  set frontProcess to first application process whose frontmost is true
  if (count of windows of frontProcess) is 0 then return false
  try
    return value of attribute "AXFullScreen" of front window of frontProcess
  on error
    return false
  end try
end tell
`;

function watchWindowsFullscreen(onChange: (fullscreen: boolean) => void): () => void {
  let stopped = false;
  let bufferedOutput = "";
  let errorOutput = "";
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROBE_SCRIPT],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
  );

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    bufferedOutput += chunk;
    const lines = bufferedOutput.split(/\r?\n/);
    bufferedOutput = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim() || stopped) continue;
      try {
        const snapshot = JSON.parse(line) as WindowsFullscreenSnapshot;
        onChange(isFullscreenSnapshot(snapshot));
      } catch {
        // 忽略外部检测进程尚未完整输出的内容。
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    errorOutput = `${errorOutput}${chunk}`.slice(-4000);
  });
  child.once("error", (error) => {
    if (stopped) return;
    onChange(false);
    console.error("Fullscreen detector failed to start:", error);
  });
  child.once("exit", (code) => {
    if (stopped) return;
    onChange(false);
    if (code !== 0) {
      console.error("Fullscreen detector stopped:", errorOutput.trim() || `exit code ${code}`);
    }
  });

  return () => {
    stopped = true;
    child.kill();
  };
}

function watchMacFullscreen(onChange: (fullscreen: boolean) => void): () => void {
  let stopped = false;
  let checking = false;

  const check = (): void => {
    if (stopped || checking) return;
    checking = true;
    execFile(
      "/usr/bin/osascript",
      ["-e", MAC_FULLSCREEN_SCRIPT],
      { timeout: 2500 },
      (error, stdout) => {
        checking = false;
        if (!stopped) onChange(!error && stdout.trim().toLowerCase() === "true");
      }
    );
  };

  check();
  const timer = setInterval(check, 1000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function watchFullscreen(onChange: (fullscreen: boolean) => void): () => void {
  if (process.platform === "win32") return watchWindowsFullscreen(onChange);
  if (process.platform === "darwin") return watchMacFullscreen(onChange);
  return () => undefined;
}
