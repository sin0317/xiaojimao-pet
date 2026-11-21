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
| 品牌 | 应用名改为「小鸡毛」，appId `com.xiaojimao.pet`，设置「关于」标注定制来源 |

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
corepack pnpm@11.1.1 dist:win
```

产物在 `dist/`：NSIS 安装包（可改安装目录）+ 免安装目录。

## 目录

```
src/shared/workClock.ts            上下班计算（倒计时 / 午休 / 加班 / 工资），移植自 OffWorkNow
src/renderer/.../PetView.tsx       宠物窗口与右下角徽标
src/renderer/.../SettingsView.tsx  设置页（上下班分组）
src/main/main.ts                   提醒调度：上班 / 下班 / 整点 / 加班，系统通知 + 气泡
pet_assets/                        宠物素材（小鸡毛、线条小狗、金毛 puppy）
_ref/                              OffWorkNow 参考源码，仅用于对照，不参与构建
```

## 协议

代码 MIT（见 [LICENSE](./LICENSE)）。宠物动画素材另有授权条款，见 [ASSET_LICENSE.md](./ASSET_LICENSE.md)。
