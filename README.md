# Oh My Copilot

代码审查与提交辅助 prompt + 一个把 prompt 渲染成 Chat 输入框按钮的 VS Code 扩展。

## 安装与更新

一个脚本 [`install.ps1`](install.ps1) 同时管理 **prompts** 和 **扩展**，重复运行即更新到当前仓库状态。

```powershell
# prompts + 扩展（默认）
powershell -ExecutionPolicy Bypass -File .\install.ps1

# 只更新 prompts
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Prompts

# 只更新扩展
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Extension
```

脚本做的事：

- **Prompts** → 复制 `prompts\*` 到 VS Code 用户 prompts 目录
  （Windows `%APPDATA%\Code\User\prompts\`；macOS `~/Library/Application Support/Code/User/prompts/`；
  Linux `~/.config/Code/User/prompts/`）。
- **扩展** → 用 `vsce` 打包成 `.vsix`，先卸载旧版再安装（确保同版本号也会重新解包）。

运行后：

1. `Developer: Reload Window` 重载窗口。
2. 打开「Oh My Copilot」面板点 **刷新命令**，把按钮（重新）应用到 Chat 输入框上方。
   扩展版本变化会改变注入文件路径，故每次更新扩展后需点一次刷新。

前置依赖：`node` / `npx`（用于 `vsce` 打包）、VS Code 的 `code` CLI 在 PATH 中、
以及输入框按钮所需的 `Custom CSS and JS Loader` 扩展（见下文「输入框按钮」）。

### 更新流程速查

| 改了什么 | 怎么更新 |
|---|---|
| 仅 prompt 内容（`*.prompt.md` 正文） | `install.ps1 -Prompts` → Reload Window（slash 命令即刻可用） |
| prompt 的 `button:` 配置（增删/改名/排序/图标） | `install.ps1 -Extension` → Reload → 面板「刷新命令」 |
| 扩展代码（`extension/`） | bump `extension/package.json` 的 `version` → `install.ps1 -Extension` → Reload → 「刷新命令」 |
| 想关闭输入框按钮 | 面板「清空命令」→ 按提示重载 |
| **卸载扩展** | 先点面板「清空命令」恢复默认 Chat，再卸载扩展（见下方「卸载」） |

> 发布到团队/他人：本扩展 `publisher` 为 `local`，走本地 `.vsix` 安装而非 Marketplace。
> `.vsix` 是构建产物（已被 `.gitignore` 忽略，不入库）。分发方式二选一：
> ① 把整个仓库给对方，对方运行 `install.ps1`（脚本会现场打包安装）；
> ② 自己运行 `install.ps1 -Extension` 生成 `extension/oh-my-copilot.vsix`，单独把这个
> 文件发给对方，对方 `code --install-extension oh-my-copilot.vsix`。

## What's Included

### Prompts (Slash Commands)

| 命令 | 说明 |
|---|---|
| `/simplify` | 审查变更代码的复用性、质量与效率，并修复发现的问题；并行启动三个审查代理。 |
| `/commit` | 依据本地实际 diff（而非会话上下文）生成符合 Conventional Commits 规范的提交；先询问提交信息用中文还是英文。 |

### Prompt Buttons Panel (扩展)

`extension/` 是一个轻量 VS Code 扩展。它把带 `button:` 配置的 `*.prompt.md`
渲染成命令按钮，**注入到 Copilot Chat 输入框上方**；点击按钮等同于在 Chat 中执行
`/<prompt 文件名>`。扩展还提供一个底部面板，含「刷新命令」「清空命令」两个控制按钮。

调试：用 VS Code 打开本仓库，按 `F5`（配置见 `.vscode/launch.json`）。
正式安装/更新：见上文「安装与更新」。

#### 输入框按钮（注入）

输入框上方的按钮通过 `Custom CSS and JS Loader`（`be5invis.vscode-custom-css`）
注入实现——VS Code 不提供官方 API 把自定义按钮放进 Chat 输入框，故采用该扩展加载
一段由本扩展自动生成的脚本（`extension/media/omc-inject.js`）。

启用步骤：

1. 安装 `Custom CSS and JS Loader` 扩展。
2. 打开「Oh My Copilot」面板，点 **刷新命令**——它会写入配置、触发 Custom CSS 应用补丁。
3. 按提示确认（首次会弹「安装似乎已损坏」横幅，点齿轮忽略；可能需要管理员权限），然后重载窗口。

> 注意：这是非官方注入。VS Code 升级后 Custom CSS 补丁会失效，重新点一次「刷新命令」即可。
> 不想用注入时点「清空命令」恢复默认 Chat。

#### 卸载

本扩展**不做自动卸载清理**——VS Code 对本地 `.vsix` 安装的扩展走 `.obsolete` 标记路径，
不会调用 `vscode:uninstall` 钩子，因此无法可靠地在卸载时自动还原 `workbench.html`。

所以卸载前请手动清理：

1. 打开「Oh My Copilot」面板，点 **清空命令** → 按提示重载窗口（移除注入的按钮脚本，
   并从 `vscode_custom_css.imports` 移除配置）。
2. 然后再卸载扩展。

若先卸载了才想起没清理：在 `Custom CSS and JS Loader` 里运行 **Disable Custom CSS and JS**，
并手动从 `settings.json` 删掉 `vscode_custom_css.imports` 里含 `omc-inject.js` 的那条即可。

#### 按钮规则（prompt frontmatter）

在任意 `*.prompt.md` 的 frontmatter 中加入 `button:` 配置块即可让它出现为按钮。
块存在即启用；所有子字段均为可选。

```yaml
---
name: commit
description: '...'
button:                # 存在即渲染按钮；下列子字段都可省略
  label: Commit        # 按钮文字，默认取 name / 文件名
  icon: git-commit     # codicon 名（见 https://microsoft.github.io/vscode-codicons），默认无图标
  order: 1             # 升序排序，越小越靠前，默认 999
  submit: send         # send（默认）= 填充并自动发送；type = 仅填充输入框待用户补充参数
---
```

最简写法（全部用默认值）：

```yaml
button: true
```

字段说明：

| 字段 | 含义 | 默认 |
|---|---|---|
| `button` | 配置块；存在即渲染按钮。`button: true` 为全默认简写 | — |
| `button.label` | 按钮显示文字 | `name` / 文件名 |
| `button.icon` | codicon 图标名 | 无 |
| `button.order` | 升序排序 | `999` |
| `button.submit` | `send` 自动发送 / `type` 仅填充待编辑 | `send` |

- 旧版扁平字段（`buttonLabel` / `buttonOrder` / `buttonIcon` + `button: true`）仍兼容读取，但建议迁移到 `button:` 块。
- 默认扫描 VS Code 用户 prompts 目录；可用设置 `ohMyCopilot.promptFolders`
  追加其他目录（支持 `${workspaceFolder}`）。
- prompt 文件改动时自动重新生成注入脚本；点面板的「刷新命令」按钮把变更应用到 Chat 输入框上方。

## License

MIT
