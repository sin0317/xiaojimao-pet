#!/usr/bin/env node
/**
 * 给打包出来的 exe 写入图标与版本信息。
 *
 * electron-builder 的 signAndEditExecutable 在缺少符号链接权限时会失败，
 * 所以打包命令用 --config.win.signAndEditExecutable=false，再单独跑这个脚本补图标：
 *
 *   corepack pnpm@11.1.1 dist:win
 *   corepack pnpm@11.1.1 reicon
 *
 * rcedit 查找顺序：scripts/tools/rcedit-x64.exe → D:/Software/rcedit/rcedit-x64.exe → PATH
 * 下载：https://github.com/electron/rcedit/releases
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const exe = join(root, "dist", "win-unpacked", "小鸡毛桌宠.exe");
const icon = join(root, "build", "icon.ico");

const candidates = [
  join(root, "scripts", "tools", "rcedit-x64.exe"),
  "D:/Software/rcedit/rcedit-x64.exe",
  "rcedit-x64.exe"
];
const rcedit = candidates.find((p) => p.includes("/") === false || existsSync(p));

if (!existsSync(exe)) {
  console.error(`找不到 exe：${exe}\n先执行打包：corepack pnpm@11.1.1 dist:win`);
  process.exit(1);
}
if (!existsSync(icon)) {
  console.error(`找不到图标：${icon}`);
  process.exit(1);
}
if (!rcedit) {
  console.error(
    "找不到 rcedit-x64.exe。\n下载 https://github.com/electron/rcedit/releases 后放到 scripts/tools/ 或 D:/Software/rcedit/"
  );
  process.exit(1);
}

execFileSync(
  rcedit,
  [
    exe,
    "--set-icon",
    icon,
    "--set-version-string",
    "ProductName",
    "小鸡毛桌宠",
    "--set-version-string",
    "FileDescription",
    "小鸡毛桌宠 - 上下班提醒与下班倒计时",
    "--set-version-string",
    "CompanyName",
    "Sin",
    "--set-version-string",
    "OriginalFilename",
    "小鸡毛桌宠.exe",
    "--set-file-version",
    "1.0.0.0",
    "--set-product-version",
    "1.0.0.0"
  ],
  { stdio: "inherit" }
);

console.log(`图标与版本信息已写入：${exe}`);
