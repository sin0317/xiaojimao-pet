# 小鸡毛桌宠

一只住在桌面上的小鸡毛，到点提醒你上班、下班，还告诉你离下班还剩多久。

> 本项目 fork 自 [zebangeth/PawPal](https://github.com/zebangeth/PawPal)（MIT），在其桌宠框架上增加了「上下班时钟」模块。
> 宠物素材版权见 [ASSET_LICENSE.md](./ASSET_LICENSE.md)，原项目版权归原作者所有。

## 本版本改动（Sin 定制）

维护者：[@sin0317](https://github.com/sin0317)

基于 PawPal v0.3.1，由 Sin 定制以下内容：

| 模块 | 改动 |
| --- | --- |
| 形象 | 默认改为「小鸡毛」（`pet_assets/小鸡毛`），保留线条小狗 / 金毛 puppy / 自定义 GIF |
| 上下班时钟 | 新增 `src/shared/workClock.ts`，移植 OffWorkNow 的工时模型：午休扣除、打卡冻结、加班计时、工资估算 |
| 提醒调度 | `src/main/main.ts` 新增上班 / 下班 / 整点 / 加班四类提醒，系统通知 + 宠物气泡 |
| 设置页 | 新增「上下班」分组：上下班时间、午休、工作日、提醒开关、月薪与计薪方式、打卡下班 |
| 桌面徽标 | 宠物窗口右下角常驻显示距下班倒计时与今日已赚 |
| WorkBuddy 任务状态 | 接入 WorkBuddy 钩子，桌宠顶部显示「任务中 / 等你选 / 已完成」三态，见下节 |
| 品牌 | 应用名改为「小鸡毛」，appId `com.xiaojimao.pet`，设置「关于」标注定制来源 |

完整版本记录见 [CHANGELOG.md](./CHANGELOG.md)。

原创部分（宠物素材、休息/喝水/专注提醒、分心检测）仍归 PawPal 作者所有。

## 在 PawPal 基础上加了什么

功能设计参考了 [OffWorkNow（下班啦）](https://github.com/niyao-rakuten/OffWorkNow) 的 `WorkdayCore`，并用 TypeScript 重写：

- **下班倒计时**：桌面挂件常驻显示「距下班 02:27:18」，秒级刷新
- **上班提醒**：上班前 5 分钟 + 正点各提醒一次
- **下班提醒**：下班前 15 分钟 + 正点各提醒一次
- **午休扣除**：12:00–13:00 默认不计入工时，倒计时和进度按实际工时算
- **加班催回家**：下班后每 5 分钟（可调 1–240 分钟）提醒一次，文案在两句里轮换
- **整点健康提醒**：工作时段每个整点提醒走动 / 喝水 / 护眼
- **工资估算**：填月薪后按「有效工作秒数 / 当日总工时」实时算今日已赚，支持固定计薪天数（默认 21.75）、当月工作日、自定义日薪三种算法
- **打卡下班**：手动打卡后冻结当日工时与收入，当天不再提醒
- **工作日配置**：周一到周日任选，默认周一到周五
- 原有能力保留：休息提醒、喝水提醒、专注模式、分心检测、自定义 GIF 形象

## 任务状态（WorkBuddy / Qoder / Trae）

接入后，桌宠抬头就能看出当前 agent 的任务进度，状态牌第二行标明来源（WorkBuddy / Qoder / Trae）：

| 状态 | 桌面表现 | 触发事件 |
| --- | --- | --- |
| 任务中 | 暖色任务牌 + 宠物专注姿态 + 暖光 | `UserPromptSubmit` |
| 等你选 | 橙红任务牌 + 宠物轻推一下 + 气泡/系统通知 | `Notification`、`PreToolUse`（AskUserQuestion / ExitPlanMode） |
| 已完成 | 绿牌 + 宠物跳两下 + 完成气泡 | `Stop`、`FinalStop` |

多会话、多 agent 并行时按「等你选 > 任务中 > 已完成」取最需要你注意的那个，任务牌上会显示次数。

**怎么接入**：设置 →「任务」→ 对应 agent 点「接入」，然后重启那个 agent。按钮只往配置里追加自己的钩子，
原有钩子保留，改动前自动备份为 `<配置名>.xiaojimao-<时间>`；点「移除接入」可完整还原。

| Agent | 配置文件 | 落盘脚本 | 执行 shell |
| --- | --- | --- | --- |
| WorkBuddy | `~/.workbuddy/settings.json` | `~/.workbuddy/hooks/xiaojimao-status.sh` | Git Bash |
| Qoder | `~/.qoder/settings.json` | `~/.qoder/hooks/xiaojimao-status.ps1` | PowerShell |
| Trae | `~/.trae-cn/hooks.json` | `~/.trae-cn/hooks/xiaojimao-status.ps1` | PowerShell |

**数据流**：钩子把事件 JSON 写进 `~/.xiaojimao/workbuddy-events/<Agent>/`（一次事件一个文件，
写完即改名，桌宠每 0.8 秒消费一次并删除），桌宠在 `src/shared/workbuddy.ts` 里把事件折算成三态。
不监听端口，不需要额外权限。

已知边界：

- 模型只用文字提问（没调用询问工具）时，钩子只能看到 `Stop`，会显示「已完成」；
  「等你选」靠询问工具与通知事件识别，命中后保持 45 分钟或直到你再次发消息
- Trae 需要在它自己的 Hooks 设置里打开开关，否则写了配置也不会触发
- DeepSeek Harness 没有钩子接口（只有 Cordis 插件体系），暂未接入

## 界面

- 宠物窗口：`220×340`，透明、置顶、可拖拽，右下角是上下班徽标
- 「小鸡毛」为默认形象（`pet_assets/小鸡毛`），也可在设置里换线条小狗 / 金毛 puppy / 自定义 GIF
- 设置窗口：上班时间、下班时间、午休、工作日、提醒开关、月薪与计薪方式、打卡

## 开发

需要 Node.js 20+ 与 pnpm 11。

```bash
corepack pnpm@11.1.1 install
corepack pnpm@11.1.1 dev
```

> Windows 上如果当前 shell 设置了 `ELECTRON_RUN_AS_NODE=1`，Electron 会退化成 Node 并报
> `does not provide an export named 'BrowserWindow'`，启动前先 `unset ELECTRON_RUN_AS_NODE`。

## 打包

```bash
# 1. 打免安装目录（dist/win-unpacked，桌面快捷方式指的就是这里）
corepack pnpm@11.1.1 dist:win

# 2. 给 exe 补图标与版本信息（版本号读自 package.json）
corepack pnpm@11.1.1 reicon
```

`dist:win` 带 `--config.win.signAndEditExecutable=false`，所以 exe 的图标 / 版本信息要靠 `reicon` 补写；
NSIS 安装包由 `corepack pnpm@11.1.1 dist` 或 CI 的 release 流水线产出。
改了代码后必须重跑这两步，桌面快捷方式才会打开新版。

### 装到固定目录（可选）

桌面快捷方式如果指向 `dist\win-unpacked`，清理构建产物时就会失效。建议把成品放到固定目录：

```powershell
# 首次
robocopy "dist\win-unpacked" "D:\Software\小鸡毛桌宠" /E
# 以后每次更新
robocopy "dist\win-unpacked" "D:\Software\小鸡毛桌宠" /MIR
```

再把快捷方式指向 `D:\Software\小鸡毛桌宠\小鸡毛桌宠.exe`。

## 目录

```
src/shared/workClock.ts            上下班计算（倒计时 / 午休 / 加班 / 工资），移植自 OffWorkNow
src/shared/workbuddy.ts            WorkBuddy 事件 → 三态聚合（纯函数，带单测）
src/main/workbuddyHooks.ts         WorkBuddy 钩子的安装 / 移除 / 检测
src/renderer/.../PetView.tsx       宠物窗口、左上角任务牌与右下角徽标
src/renderer/.../SettingsView.tsx  设置页（上下班 / 任务分组）
src/main/main.ts                   提醒调度：上班 / 下班 / 整点 / 加班，系统通知 + 气泡
pet_assets/                        宠物素材（小鸡毛、线条小狗、金毛 puppy）
_ref/                              OffWorkNow 参考源码，仅用于对照，不参与构建
```

## 协议

代码 MIT（见 [LICENSE](./LICENSE)）。宠物动画素材另有授权条款，见 [ASSET_LICENSE.md](./ASSET_LICENSE.md)。
