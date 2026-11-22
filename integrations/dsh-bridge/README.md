# DeepSeek Harness 接入

dsh 没有 Claude 那样的钩子配置文件，但它是 Cordis 插件体系，宿主会在 `session/event` 上广播
`turn/start`、`approval/asked`、`turn/end`。这个桥接插件只做一件事：把这些事件写成和钩子同构的 JSON，
落到 `~/.xiaojimao/workbuddy-events/DeepSeek Harness/`，桌宠照常消费。

## 安装

1. 把本目录整个复制进 dsh 的 profile 依赖目录（Windows 默认 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\`）：

   ```powershell
   Copy-Item -Recurse integrations\dsh-bridge "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-xiaojimao-bridge"
   ```

2. 在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 末尾追加：

   ```yaml
   - id: xiaojimao-bridge
     name: 'dsh-xiaojimao-bridge'
   ```

3. 重启 DeepSeek Harness（profile 改动不支持热加载）。

## 事件映射

| dsh 事件 | 写成 | 桌宠看到 |
| --- | --- | --- |
| `turn/start` | `UserPromptSubmit` | 任务中 |
| `approval/asked` | `PreToolUse` + `tool_name: AskUserQuestion` | 等你选 |
| `turn/end`（completed / error） | `Stop` | 已完成 |
| `turn/end`（aborted） | 不写 | — |
| 子代理、深层委派 | 不写 | — |

## 卸载

删掉 `node_modules/dsh-xiaojimao-bridge` 和 `cordis.patch.yml` 里那两行，重启 dsh。

## 注意

- 插件全程 try/catch，落盘失败不会影响会话
- 只写本地文件，不联网、不监听端口
- 这是社区桥接，不是 dsh 官方接口；dsh 换事件名时按上表改 `index.js` 里的映射即可
