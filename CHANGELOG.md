# 更新日志

版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 1.2.0 — 2026-11-22

### 新增

- **多 agent 接入**：WorkBuddy、Qoder、Trae 三家都能把任务状态同步到桌宠
  - 状态牌第二行显示来源 agent（WorkBuddy / Qoder / Trae），气泡文案也带上 agent 名
  - 设置页按 agent 分别显示「已接入 / 未接入」，可逐个接入 / 移除
  - Qoder 写入 `~/.qoder/settings.json`，Trae 写入 `~/.trae-cn/hooks.json`，均使用 PowerShell 桥脚本
- 事件目录按 agent 分文件夹（`~/.xiaojimao/workbuddy-events/<Agent>/`），多 agent 并行互不干扰

### 变更

- 气泡文案不再附加项目名后缀，改为「Qoder 在等你选一下～」这种带 agent 的说法

### 说明

- DeepSeek Harness 没有钩子接口，只有 Cordis 插件体系，暂未接入

## 1.1.1 — 2026-11-22

### 修复

- 任务牌从窗口左上角移到宠物头顶正上方居中显示，气泡在它上面叠加，不再离宠物很远
- 「检查更新」报 `Cannot convert argument to a ByteString`：`User-Agent` 里用了中文应用名，
  HTTP 头只支持 Latin-1，改用 ASCII 的 `xiaojimao-pet/<version>`
- 更新检查改为查询本仓库 `sin0317/xiaojimao-pet`；还没有正式 Release 时按「已是最新」处理，不再飘红

## 1.1.0 — 2026-11-22

### 新增

- **WorkBuddy 任务状态**：桌宠顶部常驻任务牌，区分「任务中 / 等你选 / 已完成」三种状态，
  一眼就能看出 WorkBuddy 任务的进度
  - 任务中：暖色任务牌，宠物切到专注姿态
  - 等你选：橙红任务牌 + 宠物轻推 + 气泡与系统通知
  - 已完成：绿色任务牌 + 宠物跳两下 + 完成气泡
- 多会话并行时按「等你选 > 任务中 > 已完成」取最需要关注的那个，任务牌显示 `×N`
- 点任务牌可在气泡里查看各会话的项目名与最近一条任务摘要
- 设置页新增「任务」分组：开关、状态提醒、一键接入 / 移除 WorkBuddy、事件目录
- 新增 `src/shared/workbuddy.ts`（事件 → 三态聚合）与 `src/main/workbuddyHooks.ts`（钩子安装 / 卸载）

### 说明

- 接入方式为「钩子写文件 → 桌宠读文件」，不监听端口、不申请额外权限；
  写入 `~/.workbuddy/settings.json` 前会自动备份，且不影响已有钩子
- 安装钩子后需重启 WorkBuddy 才能生效

### 测试

- 新增 16 条单元测试（任务状态聚合 10 条、钩子合并 / 卸载 6 条）

## 1.0.0 — 2026-11-21

首个定制版本：小鸡毛形象、上下班倒计时与提醒、工资估算、打卡下班、全屏自动隐藏。
