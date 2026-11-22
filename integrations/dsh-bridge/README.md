# DeepSeek Harness 接入

dsh 没有 Claude 那样的钩子配置文件，但它是 Cordis 插件体系，宿主会在 `session/event` 上广播
`turn/start`、`approval/asked`、`turn/end`。这个桥接插件只做一件事：把这些事件写成和钩子同构的 JSON，
落到 `~/.xiaojimao/workbuddy-events/DeepSeek Harness/`，桌宠照常消费。

## 安装

**必须用 dsh 自己的 CLI 装**，不要手工往 `node_modules` 里复制——那样 dsh 不会加载：
它按 profile 的依赖 + 插件包里的 `dsh.bundle.patch` 清单来挂载，缺一个都不生效。

```powershell
# 桌面端自带的 CLI（路径随安装位置变化）
& "D:\Software\dsh-desktop\resources\runtime\cli\bin\dsh.cmd" `
    plugin --profile desktop add "<本目录的绝对路径>"
```

CLI 实际做两件事：把包加进 profile 的依赖（`file:` 链接），以及追加到 `dsh.profile.bundles`。
然后**重启 DeepSeek Harness** 才会加载。

验证是否加载：该目录下会出现 `.plugin-loaded`（桌宠只读 `.json`，不会误读这个文件）。

## 包里有什么

| 文件 | 作用 |
| --- | --- |
| `index.js` | 插件本体：`export const name` + `apply(ctx)`，监听 `session/event` |
| `cordis.patch.yml` | bundle patch：`- insert:` 一条，把插件挂进 DSH 配置树 |
| `package.json` | `dsh.bundle.patch` 指向上面那份 patch，`dsh.compatibility` 标明验证过的宿主版本 |

## 事件映射

| dsh 事件 | 写成 | 桌宠看到 |
| --- | --- | --- |
| `turn/start` | `UserPromptSubmit` | 任务中 |
| `approval/asked` | `PreToolUse` + `tool_name: AskUserQuestion` | 等你选 |
| `turn/end`（completed / error） | `Stop` | 已完成 |
| `turn/end`（aborted） | 不写 | — |
| 子代理、深层委派 | 不写 | — |

## 卸载

```powershell
& "D:\Software\dsh-desktop\resources\runtime\cli\bin\dsh.cmd" `
    plugin --profile desktop remove dsh-xiaojimao-bridge
```

再删掉 `~/.xiaojimao/workbuddy-events/DeepSeek Harness/`，重启 dsh。

## 注意

- 插件全程 try/catch，落盘失败不会影响会话
- 只写本地文件，不联网、不监听端口
- 这是社区桥接，不是 dsh 官方接口；dsh 换事件名时改 `index.js` 里的 `handle()` 即可
- `dsh.compatibility.dshReleases` 里列的是验证过的宿主版本，宿主大版本升级后可能要补一条
