# Copilot Extension

代码审查与提交辅助 prompt + 一个把命令渲染成 Chat 输入框按钮的 VS Code 扩展。命令列表由一个独立的 JSON 配置文件定义。

## 安装与更新

[`install.ps1`](install.ps1) 只做一件事：打包并（重新）安装**扩展**。prompt 文件随扩展打包，由扩展在激活时自动装到用户 prompts 目录——无需脚本单独处理。

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

脚本做的事：

- 用 `vsce` 把 `extension/` 打包成 `.vsix`，先卸载旧版再安装（确保同版本号也会重新解包）。

扩展激活（Reload 后）会做的事：

- 把打包进扩展的 `extension/prompts/*.prompt.md` 安装到 VS Code 用户 prompts 目录
  （Windows `%APPDATA%\Code\User\prompts\`；macOS `~/Library/Application Support/Code/User/prompts/`；
  Linux `~/.config/Code/User/prompts/`）。目录路径由 `globalStorageUri` 反推，跨平台/跨 VS Code 版本通用。
  仅在文件缺失或内容变化时写入，故扩展升级会自动更新 prompts。

运行后：

1. `Developer: Reload Window` 重载窗口（此时安装打包的 prompts 并注册面板）。
2. 打开「Copilot Extension」面板点 **应用配置**，把按钮（重新）应用到 Chat 输入框上方。
   扩展版本变化会改变注入文件路径，故每次更新扩展后需点一次应用配置。

前置依赖：`node` / `npx`（用于 `vsce` 打包）、VS Code 的 `code` CLI 在 PATH 中、
以及输入框按钮所需的 `Custom CSS and JS Loader` 扩展（见下文「输入框按钮」）。

### 更新流程速查

| 改了什么 | 怎么更新 |
|---|---|
| prompt 内容（`extension/prompts/*.prompt.md`） | `install.ps1` → Reload Window（扩展激活时重装 prompts） |
| 命令按钮配置（`commands.json` 增删/改名/排序/图标） | 面板「编辑配置」改 JSON → 面板「应用配置」 |
| 扩展代码（`extension/`） | `install.ps1` → Reload → 「应用配置」 |
| 想关闭输入框按钮 | 面板「恢复默认」→ 按提示重载 |
| **卸载扩展** | 先点面板「恢复默认」恢复默认 Chat，再卸载扩展（见下方「卸载」） |

> 发布到团队/他人：本扩展 `publisher` 为 `local`，走本地 `.vsix` 安装而非 Marketplace。
> `.vsix` 是构建产物（已被 `.gitignore` 忽略，不入库）。分发方式二选一：
> ① 把整个仓库给对方，对方运行 `install.ps1`（脚本会现场打包安装）；
> ② 自己运行 `install.ps1` 生成 `extension/copilot-extension.vsix`，单独把这个
> 文件发给对方，对方 `code --install-extension copilot-extension.vsix`（prompts 随扩展一起装）。

## What's Included

### Prompts (Slash Commands)

| 命令 | 说明 |
|---|---|
| `/simplify` | 审查变更代码的复用性、质量与效率，并修复发现的问题；并行启动三个审查代理。 |
| `/commit` | 依据本地实际 diff（而非会话上下文）生成符合 Conventional Commits 规范的提交；先询问提交信息用中文还是英文。 |

### Prompt Buttons Panel (扩展)

`extension/` 是一个轻量 VS Code 扩展。它依据一个 JSON 配置文件（`commands.json`）
把命令渲染成按钮，**注入到 Copilot Chat 输入框上方**；点击按钮等同于在 Chat 中执行
`/<command>`。扩展还提供一个底部面板，含「重载窗口」「开发工具」「编辑配置」「应用配置」「恢复默认」等控制按钮。

调试：用 VS Code 打开本仓库，按 `F5`（配置见 `.vscode/launch.json`）。
正式安装/更新：见上文「安装与更新」。

#### 输入框按钮（注入）

输入框上方的按钮通过 `Custom CSS and JS Loader`（`be5invis.vscode-custom-css`）
注入实现——VS Code 不提供官方 API 把自定义按钮放进 Chat 输入框，故采用该扩展加载
一段由本扩展自动生成的脚本（`extension/media/cpx-inject.js`）。

启用步骤：

1. 安装 `Custom CSS and JS Loader` 扩展。
2. 打开「Copilot Extension」面板，点 **应用配置**——它会写入配置、触发 Custom CSS 应用补丁。
3. 按提示确认（首次会弹「安装似乎已损坏」横幅，点齿轮忽略；可能需要管理员权限），然后重载窗口。

> 注意：这是非官方注入。VS Code 升级后 Custom CSS 补丁会失效，重新点一次「应用配置」即可。
> 不想用注入时点「恢复默认」恢复默认 Chat。

#### 卸载

本扩展**不做自动卸载清理**——VS Code 对本地 `.vsix` 安装的扩展走 `.obsolete` 标记路径，
不会调用 `vscode:uninstall` 钩子，因此无法可靠地在卸载时自动还原 `workbench.html`。

所以卸载前请手动清理：

1. 打开「Copilot Extension」面板，点 **恢复默认** → 按提示重载窗口（移除注入的按钮脚本，
   并从 `vscode_custom_css.imports` 移除配置）。
2. 然后再卸载扩展。

若先卸载了才想起没清理：在 `Custom CSS and JS Loader` 里运行 **Disable Custom CSS and JS**，
并手动从 `settings.json` 删掉 `vscode_custom_css.imports` 里含 `cpx-inject.js` 的那条即可。

#### 命令配置（`commands.json`）

按钮列表由一个独立的 JSON 配置文件定义（不再扫描 prompt.md frontmatter）。
每个按钮由 `label`/`icon` 等显示字段，加一个语义化的 `action` 行为字段定义。
`action` 按 `type` 判别：`prompt` 表示把一段文本 / slash 命令填入 Chat（可选自动
发送），`builtin` 表示调用扩展内建工具（专注 / 备忘录 / 记忆 / 终端等）。

按钮默认随扩展打包（[`extension/commands.json`](extension/commands.json)）并**直接生效**——改默认值就改它后重新安装扩展即可（扩展代码本身不硬编码任何命令）。
点面板「编辑配置」会在 globalStorage 生成一份**用户副本**供你修改；该副本一旦存在就**优先于**打包默认被读取（用户自定义覆盖默认）。改完点「应用配置」生效。

- 用户副本路径（Windows）`%APPDATA%\Code\User\globalStorage\local.copilot-extension-panel\commands.json`（删掉它即回退到打包默认）

格式为 `{ "rows": [{ "buttons": [...] }] }`，`rows` 显式分行，按钮顺序即显示顺序：

```jsonc
{
  "rows": [
    {
      "buttons": [
        {
          "label": "Commit",
          "icon": "git-commit",                 // codicon 名（见 https://microsoft.github.io/vscode-codicons），默认无图标
          "tooltip": "...",                      // 鼠标悬停 tooltip 文案
          // value 以 / 开头 → slash 命令（对应 commit.prompt.md）；submit:true=自动发送，false=仅填充待编辑
          "action": { "type": "prompt", "value": "/commit", "submit": true }
        },
        {
          "label": "Terminals",
          "icon": "terminal",
          "showLabel": true,                    // false = 仅显示图标，隐藏文字
          "tooltip": "...",
          // command 调用扩展内建工具：focus | memo | memory | terminals
          "action": { "type": "builtin", "command": "terminals" }
        }
      ]
    }
  ]
}
```

按钮字段：

| 字段 | 含义 | 默认 |
|---|---|---|
| `label` | 按钮显示文字 | `value` 前若干字 |
| `icon` | codicon 图标名 | 无 |
| `showLabel` | 是否显示文字（`false` = 仅图标） | `true` |
| `tooltip` | 悬停 tooltip 文案 | 无 |
| `action` | 点击行为（见下，必填） | — |

`action` 字段：

| 字段 | 含义 | 默认 |
|---|---|---|
| `type` | `prompt` = 填入文本 / `builtin` = 内建工具 | — |
| `value` | （`prompt`）填入 Chat 的文本；`/xxx` = slash 命令 | — |
| `submit` | （`prompt`）`true` = 自动发送 / `false` = 仅填充待编辑 | `false` |
| `command` | （`builtin`）内建命令：`focus` / `memo` / `memory` / `terminals` | — |

- 按钮顺序 = `rows` 内 `buttons` 数组中的顺序，调整顺序直接拖动条目即可。
- `prompt` 的 `value` 若为 `/xxx`，需对应一个真实存在的 prompt（如 `commit.prompt.md`），slash 命令才有效。
- 改完 `commands.json` 后点面板「应用配置」即可把变更应用到 Chat 输入框上方。

## License

MIT
