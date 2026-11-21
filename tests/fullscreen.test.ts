import assert from "node:assert/strict";
import { isFullscreenSnapshot } from "../src/main/fullscreen";
import type { ScreenRectangle, WindowsFullscreenSnapshot } from "../src/main/fullscreen";

const primaryMonitor: ScreenRectangle = { Left: 0, Top: 0, Right: 1920, Bottom: 1080 };

function snapshot(
  window: ScreenRectangle,
  monitor: ScreenRectangle = primaryMonitor,
  ignored = false
): WindowsFullscreenSnapshot {
  return { Ignored: ignored, Window: window, Monitor: monitor };
}

export const tests = [
  {
    name: "isFullscreenSnapshot detects a foreground window covering the monitor",
    run(): void {
      assert.equal(isFullscreenSnapshot(snapshot(primaryMonitor)), true);
    }
  },
  {
    name: "isFullscreenSnapshot accepts borderless fullscreen bounds with small overscan",
    run(): void {
      assert.equal(
        isFullscreenSnapshot(snapshot({ Left: -2, Top: -2, Right: 1922, Bottom: 1082 })),
        true
      );
    }
  },
  {
    name: "isFullscreenSnapshot does not treat a maximized window above the taskbar as fullscreen",
    run(): void {
      assert.equal(
        isFullscreenSnapshot(snapshot({ Left: -8, Top: -8, Right: 1928, Bottom: 1048 })),
        false
      );
    }
  },
  {
    name: "isFullscreenSnapshot ignores ordinary windows and desktop windows",
    run(): void {
      assert.equal(
        isFullscreenSnapshot(snapshot({ Left: 100, Top: 100, Right: 1300, Bottom: 900 })),
        false
      );
      assert.equal(isFullscreenSnapshot(snapshot(primaryMonitor, primaryMonitor, true)), false);
    }
  },
  {
    name: "isFullscreenSnapshot supports monitors with negative coordinates",
    run(): void {
      const secondaryMonitor = { Left: -2560, Top: 0, Right: 0, Bottom: 1440 };
      assert.equal(isFullscreenSnapshot(snapshot(secondaryMonitor, secondaryMonitor)), true);
    }
  }
];
