const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Resolve the VS Code user prompts folder for the current OS / product.
 * @returns {string[]}
 */
function defaultPromptFolders() {
  const home = os.homedir();
  /** @type {string[]} */
  const candidates = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'Code', 'User', 'prompts'));
    candidates.push(path.join(appData, 'Code - Insiders', 'User', 'prompts'));
  } else if (process.platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    candidates.push(path.join(base, 'Code', 'User', 'prompts'));
    candidates.push(path.join(base, 'Code - Insiders', 'User', 'prompts'));
  } else {
    const base = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    candidates.push(path.join(base, 'Code', 'User', 'prompts'));
    candidates.push(path.join(base, 'Code - Insiders', 'User', 'prompts'));
  }
  return candidates;
}

/**
 * Resolve all folders to scan, expanding ${workspaceFolder}.
 * @returns {string[]}
 */
function resolveFolders() {
  const folders = new Set(defaultPromptFolders());
  const extra = vscode.workspace.getConfiguration('ohMyCopilot').get('promptFolders') || [];
  const wsFolder =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : '';
  for (const f of extra) {
    if (typeof f !== 'string' || !f.trim()) continue;
    folders.add(f.replace(/\$\{workspaceFolder\}/g, wsFolder));
  }
  return [...folders];
}

/**
 * Strip a single pair of matching surrounding quotes.
 * @param {string} v
 * @returns {string}
 */
function unquote(v) {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse the YAML-ish frontmatter block of a prompt file. Supports flat
 * `key: value` pairs and one level of nesting (an empty `key:` followed by
 * indented `  subkey: value` lines becomes an object).
 * @param {string} content
 * @returns {Record<string, string | Record<string, string>>}
 */
function parseFrontmatter(content) {
  /** @type {Record<string, string | Record<string, string>>} */
  const result = {};
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return result;
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const top = lines[i].match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!top) continue;
    const key = top[1];
    const value = top[2].trim();
    if (value !== '') {
      result[key] = unquote(value);
      continue;
    }
    // Empty value: gather an indented nested block, if any.
    /** @type {Record<string, string>} */
    const nested = {};
    let consumed = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const sub = lines[j].match(/^(\s+)([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (!sub) break;
      nested[sub[2]] = unquote(sub[3].trim());
      consumed++;
    }
    result[key] = nested;
    i += consumed;
  }
  return result;
}

/**
 * @typedef {{ command: string, label: string, order: number, icon: string, submit: string, description: string }} PromptButton
 */

/**
 * Resolve the button config from frontmatter. Returns null when the prompt
 * does not opt in. Accepts the `button:` object form, the `button: true`
 * shorthand, and the legacy flat `buttonLabel` / `buttonOrder` / `buttonIcon`
 * fields as a fallback.
 * @param {Record<string, string | Record<string, string>>} fm
 * @param {string} command
 * @returns {PromptButton | null}
 */
function buttonFromFrontmatter(fm, command) {
  const raw = fm.button;
  /** @type {Record<string, string>} */
  let cfg;
  if (raw && typeof raw === 'object') {
    cfg = raw;
  } else if (String(raw).toLowerCase() === 'true') {
    cfg = {};
  } else {
    return null;
  }
  const name = typeof fm.name === 'string' ? fm.name : '';
  const description = typeof fm.description === 'string' ? fm.description : '';
  const order = Number.parseFloat(cfg.order || /** @type {string} */ (fm.buttonOrder));
  const submit = String(cfg.submit || 'send').toLowerCase() === 'type' ? 'type' : 'send';
  return {
    command,
    label: cfg.label || /** @type {string} */ (fm.buttonLabel) || name || command,
    order: Number.isFinite(order) ? order : 999,
    icon: (cfg.icon || /** @type {string} */ (fm.buttonIcon) || '').replace(/[^a-z0-9-]/gi, ''),
    submit,
    description
  };
}

/**
 * Scan all folders and return the buttons that opted in via frontmatter.
 * @returns {PromptButton[]}
 */
function collectButtons() {
  /** @type {Map<string, PromptButton>} */
  const byCommand = new Map();
  for (const folder of resolveFolders()) {
    let entries;
    try {
      entries = fs.readdirSync(folder);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!file.toLowerCase().endsWith('.prompt.md')) continue;
      const full = path.join(folder, file);
      let content;
      try {
        content = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const command = file.slice(0, -'.prompt.md'.length);
      if (byCommand.has(command)) continue; // earlier folder wins
      const button = buttonFromFrontmatter(parseFrontmatter(content), command);
      if (button) byCommand.set(command, button);
    }
  }
  return [...byCommand.values()].sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label)
  );
}

class PanelViewProvider {
  /** @param {vscode.ExtensionContext} context */
  constructor(context) {
    this.context = context;
    /** @type {vscode.WebviewView | undefined} */
    this.view = undefined;
  }

  /** @param {vscode.WebviewView} webviewView */
  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (!msg) return;
      if (msg.type === 'enableInjection') {
        vscode.commands.executeCommand('ohMyCopilot.enableInjection');
      } else if (msg.type === 'restoreDefault') {
        vscode.commands.executeCommand('ohMyCopilot.restoreDefault');
      }
    });
    this.refresh();
  }

  refresh() {
    if (!this.view) return;
    this.view.webview.html = render();
  }
}

function render() {
  return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
  :root { color-scheme: light dark; }
  html, body { height: auto; }
  body {
    margin: 0;
    padding: 8px 12px;
    font-family: var(--vscode-font-family);
    font-size: 12px;
    color: var(--vscode-foreground);
    background: transparent;
  }
  .ctl {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: 8px;
    padding: 2px 8px;
  }
  /* Exact replica of VS Code's .monaco-text-button (primary button). */
  .ctl button {
    box-sizing: border-box;
    display: flex;
    padding: 4px 14px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 4px;
    text-align: center;
    cursor: pointer;
    justify-content: center;
    align-items: center;
    line-height: 16px;
    font-size: 12px;
    font-family: inherit;
    overflow-wrap: normal;
    color: var(--vscode-button-foreground);
    background-color: var(--vscode-button-background);
  }
  .ctl button:hover {
    background-color: var(--vscode-button-hoverBackground);
  }
  .ctl button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }
</style>
</head>
<body>
  <div class="ctl">
    <button id="enable" title="重新扫描 prompts 并刷新 Chat 输入框上方的命令按钮">刷新命令</button>
    <button id="restore" title="清空注入并恢复默认 Chat 界面">清空命令</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('enable').addEventListener('click', () => {
      vscode.postMessage({ type: 'enableInjection' });
    });
    document.getElementById('restore').addEventListener('click', () => {
      vscode.postMessage({ type: 'restoreDefault' });
    });
  </script>
</body>
</html>`;
}

/**
 * Build the workbench injection script that renders a button row above the
 * Chat input and submits the matching slash command on click.
 * @param {PromptButton[]} buttons
 * @returns {string}
 */
function buildInjectionScript(buttons) {
  const data = JSON.stringify(
    buttons.map((b) => ({ command: b.command, label: b.label, icon: b.icon, submit: b.submit, description: b.description }))
  );
  return `// AUTO-GENERATED by Oh My Copilot. Do not edit; use the \"刷新命令\" button instead.
(function () {
  'use strict';
  var BUTTONS = ${data};
  var ROW_CLASS = 'omc-button-row';

  function buildRow() {
    var row = document.createElement('div');
    row.className = ROW_CLASS;
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:0 8px 4px 6px;';
    BUTTONS.forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.title = b.description || '/' + b.command;
      btn.style.cssText = [
        'box-sizing:content-box',
        'display:flex','align-items:center','gap:4px',
        'height:16px','padding:3px 8px','border:none','border-radius:4px',
        'cursor:pointer','font-family:var(--vscode-font-family)','font-size:12px',
        'line-height:normal','color:var(--vscode-icon-foreground)','background:transparent'
      ].join(';');
      if (b.icon) {
        var ic = document.createElement('span');
        ic.className = 'codicon codicon-' + b.icon;
        btn.appendChild(ic);
      }
      var lbl = document.createElement('span');
      lbl.textContent = b.label;
      btn.appendChild(lbl);
      btn.addEventListener('mouseenter', function () {
        btn.style.background = 'var(--vscode-toolbar-hoverBackground)';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.background = 'transparent';
      });
      btn.addEventListener('click', function () { submit(b.command, btn, b.submit); });
      row.appendChild(btn);
    });
    return row;
  }

  // Find the chat session that owns the clicked button row.
  function findSession(node) {
    while (node && node !== document.body) {
      if (node.classList && node.classList.contains('interactive-session')) return node;
      node = node.parentNode;
    }
    var all = document.querySelectorAll('.interactive-session');
    return all.length ? all[all.length - 1] : null;
  }

  function clickSendButton(session) {
    var labels = session.querySelectorAll('.action-label, a.action-label, .monaco-button');
    for (var i = 0; i < labels.length; i++) {
      var el = labels[i];
      var al = el.getAttribute('aria-label') || el.getAttribute('title') || '';
      if (al.indexOf('发送') === 0 || al.toLowerCase().indexOf('send') === 0) {
        if (el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled')) return false;
        el.click();
        return true;
      }
    }
    return false;
  }

  // The editable surface Monaco actually listens to (not the readOnly ime proxy).
  function findInput(editor) {
    return (
      editor.querySelector('textarea.inputarea') ||
      editor.querySelector('.native-edit-context') ||
      editor.querySelector('textarea:not(.ime-text-area)')
    );
  }

  // Press Enter inside Monaco's input area — the chat's default submit gesture.
  function pressEnter(editor) {
    var el = findInput(editor) || editor;
    try { el.focus(); } catch (e) {}
    ['keydown', 'keypress', 'keyup'].forEach(function (type) {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
    });
  }

  function editorText(editor) {
    var vl = editor.querySelector('.view-lines');
    return vl ? vl.textContent || '' : '';
  }

  function trySend(session, editor, command) {
    var content = editorText(editor);
    if (content.indexOf('/' + command) === -1) return false;
    // Press Enter to submit.
    pressEnter(editor);
    // If text is still there shortly after, fall back to clicking the send button.
    setTimeout(function () {
      if (editorText(editor).indexOf('/' + command) !== -1) {
        clickSendButton(session);
      }
    }, 70);
    return true;
  }

  function focusEditorInput(editor) {
    var target = findInput(editor) || editor.querySelector('.view-lines') || editor;
    try { target.focus(); } catch (e) {}
    if (target.click) { try { target.click(); } catch (e) {} }
    return target;
  }

  function submit(command, originNode, mode) {
    var session = findSession(originNode);
    if (!session) { console.warn('[omc] no session'); return; }
    var editor = session.querySelector('.chat-editor-container .monaco-editor');
    if (!editor) { console.warn('[omc] no monaco editor'); return; }

    var text = '/' + command + ' ';

    // Monaco rejects synthetic insertText/beforeinput, but honors a paste event
    // carrying a DataTransfer. Clipboard API write is blocked in the workbench
    // sandbox, so we build the DataTransfer ourselves and dispatch paste directly.
    function pasteIntoEditor() {
      var el = focusEditorInput(editor);
      var dt = null;
      try { dt = new DataTransfer(); dt.setData('text/plain', text); } catch (e) {}
      var targetEl = document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : el;
      try {
        var ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        if (dt && !ev.clipboardData) { Object.defineProperty(ev, 'clipboardData', { value: dt }); }
        targetEl.dispatchEvent(ev);
      } catch (e) { console.warn('[omc] paste dispatch failed', e); }
    }

    pasteIntoEditor();
    // mode "type": only fill the input so the user can add arguments, then stop.
    if (mode === 'type') return;
    setTimeout(function () {
      if (!trySend(session, editor, command)) {
        // One retry in case the editor mounted/focused late.
        pasteIntoEditor();
        setTimeout(function () { trySend(session, editor, command); }, 90);
      }
    }, 80);
  }

  function ensureRow() {
    var sessions = document.querySelectorAll('.interactive-session');
    for (var i = 0; i < sessions.length; i++) {
      var session = sessions[i];
      // The pill row holding Agent / model / High / 1M.
      var toolbar = session.querySelector('.chat-input-toolbars');
      if (!toolbar || !toolbar.parentNode) continue;
      var host = toolbar.parentNode;
      var existing = host.querySelector(':scope > .' + ROW_CLASS);
      if (existing) {
        // Keep our row directly after the toolbar row.
        if (existing.previousSibling !== toolbar) {
          host.insertBefore(existing, toolbar.nextSibling);
        }
        continue;
      }
      host.insertBefore(buildRow(), toolbar.nextSibling);
    }
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(function () {
      scheduled = false;
      try { ensureRow(); } catch (e) {}
    });
  }

  function start() {
    if (!document.body) { setTimeout(start, 50); return; }
    try {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    // Also poll for a while in case the chat view mounts late or the observer misses it.
    var ticks = 0;
    var iv = setInterval(function () {
      try { ensureRow(); } catch (e) {}
      if (++ticks > 120) clearInterval(iv); // ~60s safety net
    }, 500);
    try { ensureRow(); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
`;
}

/**
 * Write the injection script to media/omc-inject.js.
 * @param {vscode.ExtensionContext} context
 * @returns {string} the absolute file path
 */
function writeInjection(context) {
  const file = path.join(context.extensionPath, 'media', 'omc-inject.js');
  fs.writeFileSync(file, buildInjectionScript(collectButtons()), 'utf8');
  return file;
}

/**
 * Overwrite the injection script with a no-op so the injected row disappears
 * after the next reload, restoring the default Chat UI.
 * @param {vscode.ExtensionContext} context
 * @returns {string} the absolute file path
 */
function clearInjection(context) {
  const file = path.join(context.extensionPath, 'media', 'omc-inject.js');
  fs.writeFileSync(
    file,
    '// Oh My Copilot injection disabled (restored to default).\n',
    'utf8'
  );
  return file;
}

const CUSTOM_CSS_EXT = 'be5invis.vscode-custom-css';

/**
 * Read vscode_custom_css.imports with any of our injected entries removed.
 * @returns {string[]}
 */
function customCssImportsWithoutOurs() {
  const cfg = vscode.workspace.getConfiguration('vscode_custom_css');
  return (cfg.get('imports') || []).filter(
    (x) => typeof x === 'string' && !x.includes('omc-inject.js')
  );
}

/**
 * Find and run Custom CSS's apply command so it (re)patches workbench.html.
 * @param {boolean} preferEnable true to prefer the first-time "Enable" command.
 * @returns {Promise<boolean>} whether a command was found and executed.
 */
async function applyCustomCss(preferEnable) {
  const available = await vscode.commands.getCommands(true);
  const order = preferEnable
    ? ['extension.installCustomCSS', 'extension.enableCustomCSS', 'extension.updateCustomCSS']
    : ['extension.updateCustomCSS', 'extension.installCustomCSS'];
  const cmd = order.find((c) => available.includes(c));
  if (!cmd) return false;
  await vscode.commands.executeCommand(cmd);
  return true;
}

/**
 * One-click: generate the injection, register it with Custom CSS and JS Loader,
 * and trigger its enable command. Falls back to guidance when the loader is
 * missing or its enable command is unavailable.
 * @param {vscode.ExtensionContext} context
 */
async function enableInjection(context) {
  // 1. Generate the script.
  let file;
  try {
    file = writeInjection(context);
  } catch (e) {
    vscode.window.showErrorMessage('Oh My Copilot: 生成注入脚本失败 — ' + String(e));
    return;
  }
  const url = vscode.Uri.file(file).toString(true);

  // 2. Ensure the Custom CSS and JS Loader extension is installed.
  if (!vscode.extensions.getExtension(CUSTOM_CSS_EXT)) {
    const pick = await vscode.window.showWarningMessage(
      '一键启用需要扩展「Custom CSS and JS Loader」。请先安装，安装后再次点击「一键启用注入」。',
      '打开安装页'
    );
    if (pick === '打开安装页') {
      vscode.commands.executeCommand('workbench.extensions.installExtension', CUSTOM_CSS_EXT).then(
        () => vscode.window.showInformationMessage('安装完成后，请再次点击「一键启用注入」。'),
        () => vscode.commands.executeCommand('extension.open', CUSTOM_CSS_EXT)
      );
    }
    return;
  }

  // 3. Register our file:// URL (replacing any stale omc-inject entry).
  const imports = customCssImportsWithoutOurs();
  imports.push(url);
  try {
    await vscode.workspace
      .getConfiguration('vscode_custom_css')
      .update('imports', imports, vscode.ConfigurationTarget.Global);
  } catch (e) {
    vscode.window.showErrorMessage('Oh My Copilot: 写入 vscode_custom_css.imports 失败 — ' + String(e));
    return;
  }

  // 4. Patch workbench (Custom CSS shows its own reload prompt; don't add another).
  const applied = await applyCustomCss(true);
  if (!applied) {
    const pick = await vscode.window.showWarningMessage(
      'Oh My Copilot: 已写入配置，但未找到 Custom CSS 的启用命令。请手动运行「Enable Custom CSS and JS」，然后重载窗口。',
      '打开命令面板'
    );
    if (pick === '打开命令面板') {
      vscode.commands.executeCommand('workbench.action.quickOpen', '>Custom CSS');
    }
  }
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const provider = new PanelViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ohMyCopilot.panel', provider)
  );

  // Keep the workbench injection script up to date.
  try { writeInjection(context); } catch { /* ignore */ }

  context.subscriptions.push(
    vscode.commands.registerCommand('ohMyCopilot.restoreDefault', async () => {
      try {
        clearInjection(context);
      } catch (e) {
        vscode.window.showErrorMessage('Oh My Copilot: 清空命令失败 — ' + String(e));
        return;
      }

      // Stop importing our script.
      try {
        await vscode.workspace
          .getConfiguration('vscode_custom_css')
          .update('imports', customCssImportsWithoutOurs(), vscode.ConfigurationTarget.Global);
      } catch { /* ignore */ }

      // Re-patch workbench so the inlined script is removed (Custom CSS shows
      // its own reload prompt; only prompt ourselves if no command was found).
      const applied = await applyCustomCss(false);
      if (!applied) {
        const choice = await vscode.window.showInformationMessage(
          '已清空命令注入。请重载窗口以恢复默认 Chat 界面。',
          '重载窗口'
        );
        if (choice === '重载窗口') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ohMyCopilot.enableInjection', () => enableInjection(context))
  );

  // Regenerate the injection script when any prompt file changes.
  for (const folder of resolveFolders()) {
    try {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(folder), '*.prompt.md')
      );
      const onChange = () => {
        try { writeInjection(context); } catch { /* ignore */ }
      };
      watcher.onDidCreate(onChange);
      watcher.onDidChange(onChange);
      watcher.onDidDelete(onChange);
      context.subscriptions.push(watcher);
    } catch {
      // ignore folders that cannot be watched
    }
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ohMyCopilot.promptFolders')) {
        try { writeInjection(context); } catch { /* ignore */ }
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
