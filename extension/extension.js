const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ text: string, label: string, icon: string, submit: string, description: string }} MacroButton
 */

/**
 * Absolute path to the JSON config that defines the command buttons. Stored in
 * the extension's global storage so it persists across updates and is easy to
 * open via the panel's "编辑配置" button.
 * @param {vscode.ExtensionContext} context
 * @returns {string}
 */
function configPath(context) {
  return path.join(context.globalStorageUri.fsPath, 'commands.json');
}

/**
 * The default config written when none exists yet.
 * @returns {{ commands: object[] }}
 */
function defaultConfig() {
  return {
    commands: [
      { text: '/simplify', label: 'Simplify', icon: 'sparkle', submit: 'send', description: '审查变更代码的复用性、质量与效率，并修复发现的问题。' },
      { text: '/bump', label: 'Bump Version', icon: 'versions', submit: 'send', description: '探测当前仓库的版本管理方式并升级版本号（可选 major / minor / patch）。' },
      { text: '/commit', label: 'Commit', icon: 'git-commit', submit: 'send', description: '依据本地实际 diff 生成符合 Conventional Commits 规范的提交。' },
      { text: '/addtag', label: 'Add Tag', icon: 'tag', submit: 'send', description: '为当前版本号在本地创建对应的 git tag。' }
    ]
  };
}

/**
 * Ensure the config file exists, seeding it with defaults on first run.
 * @param {vscode.ExtensionContext} context
 * @returns {string} the config path
 */
function ensureConfig(context) {
  const p = configPath(context);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Write only if absent (atomic 'wx'); EEXIST is the expected no-op case.
    fs.writeFileSync(p, JSON.stringify(defaultConfig(), null, 2) + '\n', { flag: 'wx' });
  } catch { /* already exists or unwritable */ }
  return p;
}

/**
 * Read the command buttons from the JSON config. Accepts either a top-level
 * array or an object with a `commands` array. Invalid entries are skipped.
 * @param {vscode.ExtensionContext} context
 * @returns {CommandButton[]}
 */
function loadButtons(context) {
  let raw;
  try {
    raw = fs.readFileSync(configPath(context), 'utf8');
  } catch {
    return [];
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : Array.isArray(data && data.commands) ? data.commands : [];
  /** @type {Map<string, MacroButton>} */
  const byKey = new Map();
  for (const c of list) {
    if (!c) continue;
    // A macro is just the text to insert; a slash command is text starting '/'.
    const text = typeof c.text === 'string' ? c.text : '';
    if (!text.trim() || byKey.has(text)) continue;
    byKey.set(text, {
      text,
      label: typeof c.label === 'string' && c.label ? c.label : text.trim().slice(0, 24),
      icon: typeof c.icon === 'string' ? c.icon.replace(/[^a-z0-9-]/gi, '') : '',
      submit: String(c.submit || 'send').toLowerCase() === 'type' ? 'type' : 'send',
      description: typeof c.description === 'string' ? c.description : ''
    });
  }
  return [...byKey.values()];
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
      } else if (msg.type === 'editConfig') {
        vscode.commands.executeCommand('ohMyCopilot.editConfig');
      } else if (msg.type === 'reloadWindow') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      } else if (msg.type === 'toggleDevTools') {
        vscode.commands.executeCommand('workbench.action.toggleDevTools');
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
  <div class="ctl util">
    <button id="reload" title="重载窗口（Developer: Reload Window）">重载窗口</button>
    <button id="devtools" title="切换开发人员工具（Toggle Developer Tools）">开发工具</button>
  </div>
  <div class="ctl">
    <button id="edit" title="在 VS Code 中打开命令配置 JSON">编辑配置</button>
    <button id="enable" title="读取配置并刷新 Chat 输入框上方的命令按钮">应用配置</button>
    <button id="restore" title="清空注入并恢复默认 Chat 界面">恢复默认</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('reload').addEventListener('click', () => {
      vscode.postMessage({ type: 'reloadWindow' });
    });
    document.getElementById('devtools').addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleDevTools' });
    });
    document.getElementById('edit').addEventListener('click', () => {
      vscode.postMessage({ type: 'editConfig' });
    });
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
 * @param {MacroButton[]} buttons
 * @returns {string}
 */
function buildInjectionScript(buttons) {
  const data = JSON.stringify(buttons);
  return `// AUTO-GENERATED by Oh My Copilot. Do not edit; use the \"应用配置\" button instead.
(function () {
  'use strict';
  var BUTTONS = ${data};
  var ROW_CLASS = 'omc-button-row';

  // Minimal overrides that can't come from reused classes: a pointer cursor and
  // the hover background (reuses a VS Code variable — no hard-coded numbers).
  // We also relax two constraints the plural container imposes so our separate
  // row isn't width-limited or clipped.
  function ensureStyle() {
    if (document.getElementById('omc-style')) return;
    var st = document.createElement('style');
    st.id = 'omc-style';
    st.textContent =
      '.omc-button-row{max-width:none}' +
      '.omc-button-row>.chat-input-toolbar{width:auto;min-width:0;overflow:visible}' +
      '.omc-button-row .action-label{cursor:pointer}' +
      '.omc-button-row .action-label:hover{background-color:var(--vscode-toolbar-hoverBackground)}' +
      // Our hover isn't sized by VS Code's hover service, so the absolute
      // .monaco-hover would shrink-to-min (a tall narrow column). max-content
      // makes it hug the text and wrap at the reused .hover-contents max-width.
      '.omc-hover .monaco-hover{width:max-content}';
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- Custom hover, matching VS Code's native pill tooltip --------------
  // VS Code's native hover is its own .monaco-hover widget anchored to the
  // element (NOT the browser title attribute, which floats at the cursor). We
  // replicate it by REUSING the native classes and mounting into the same
  // .monaco-editor overflow container so the themed rules apply.
  var hoverEl = null;
  var hoverTimer = null;

  // Mount into the chat editor's overflow widgets so the themed editor-hover
  // rules (.monaco-editor .monaco-hover → bg/border/radius/color/shadow) apply.
  // The width fix is the .markdown-hover > .hover-contents wrapper, which reuses
  // .monaco-hover .markdown-hover>.hover-contents (max-width 500px + word-wrap)
  // and .hover-contents (padding 4px 8px).
  function hoverContainer() {
    return (
      document.querySelector('.chat-editor-overflow.monaco-editor .overflowingContentWidgets') ||
      document.querySelector('.monaco-editor .overflowingContentWidgets') ||
      document.body
    );
  }

  function buildHover(text) {
    var wrap = document.createElement('div');
    wrap.className = 'monaco-resizable-hover omc-hover';
    var hover = document.createElement('div');
    hover.className = 'monaco-hover';
    hover.setAttribute('role', 'tooltip');
    var content = document.createElement('div');
    content.className = 'monaco-hover-content';
    var row = document.createElement('div');
    row.className = 'hover-row';
    var md = document.createElement('div');
    md.className = 'markdown-hover';
    var contents = document.createElement('div');
    contents.className = 'hover-contents';
    contents.textContent = text;
    md.appendChild(contents);
    row.appendChild(md);
    content.appendChild(row);
    hover.appendChild(content);
    wrap.appendChild(hover);
    return wrap;
  }

  function hideHover() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    if (hoverEl && hoverEl.parentNode) hoverEl.parentNode.removeChild(hoverEl);
    hoverEl = null;
  }

  function showHover(anchor, text) {
    hideHover();
    var container = hoverContainer();
    var useFixed = container === document.body;
    hoverEl = buildHover(text);
    hoverEl.style.position = useFixed ? 'fixed' : 'absolute';
    hoverEl.style.zIndex = '50';
    hoverEl.style.visibility = 'hidden';
    container.appendChild(hoverEl);
    // Anchor below the button, left edges aligned (clamped to the viewport).
    var a = anchor.getBoundingClientRect();
    var top, left;
    if (useFixed) {
      top = a.bottom + 2;
      left = a.left;
    } else {
      var c = container.getBoundingClientRect();
      top = a.bottom - c.top + 2;
      left = a.left - c.left;
    }
    hoverEl.style.top = Math.round(top) + 'px';
    hoverEl.style.left = Math.round(Math.max(0, left)) + 'px';
    hoverEl.style.visibility = '';
  }

  function attachHover(anchor, text) {
    anchor.addEventListener('mouseenter', function () {
      hoverTimer = setTimeout(function () { showHover(anchor, text); }, 300);
    });
    anchor.addEventListener('mouseleave', hideHover);
  }

  // Build the row by REPLICATING the native pill structure and class names, so
  // the workbench's own stylesheet rules style it (font, padding, icon size,
  // color, separators, gap, spacing …). Nothing is hard-coded; if VS Code
  // changes those numbers in a future version our buttons follow automatically.
  // The OUTER .chat-input-toolbars wrapper is required so the rules scoped to
  // that plural container (icon 12px, icon color, actions gap, row margin) match.
  //   .chat-input-toolbars > .chat-input-toolbar > .monaco-action-bar
  //     > ul.actions-container > li.action-item.chat-input-picker-item
  //       > a.action-label > span.codicon.codicon-<x> + span.chat-input-picker-label
  function buildRow() {
    var root = document.createElement('div');
    root.className = ROW_CLASS + ' chat-input-toolbars';
    var tb = document.createElement('div');
    tb.className = 'chat-input-toolbar';
    var bar = document.createElement('div');
    bar.className = 'monaco-action-bar';
    var ul = document.createElement('ul');
    ul.className = 'actions-container';
    ul.setAttribute('role', 'toolbar');
    BUTTONS.forEach(function (b) {
      var li = document.createElement('li');
      li.className = 'action-item chat-input-picker-item';
      li.setAttribute('role', 'presentation');
      var a = document.createElement('a');
      a.className = 'action-label';
      a.setAttribute('role', 'button');
      a.setAttribute('tabindex', '0');
      var tip = b.description || b.text.trim();
      a.setAttribute('aria-label', tip);
      if (b.icon) {
        var ic = document.createElement('span');
        ic.className = 'codicon codicon-' + b.icon;
        a.appendChild(ic);
      }
      var lbl = document.createElement('span');
      lbl.className = 'chat-input-picker-label';
      lbl.textContent = b.label;
      a.appendChild(lbl);
      attachHover(a, tip);
      a.addEventListener('click', function () { hideHover(); submit(b.text, a, b.submit); });
      li.appendChild(a);
      ul.appendChild(li);
    });
    bar.appendChild(ul);
    tb.appendChild(bar);
    root.appendChild(tb);
    return root;
  }

  // Shift the whole row so our first item's left edge lines up with the
  // toolbar's first native pill. Idempotent: resets the offset before
  // measuring so repeated calls don't accumulate drift.
  function alignLeft(row, toolbar) {
    try {
      var pill =
        toolbar.querySelector('.monaco-action-bar .actions-container > .action-item .action-label') ||
        toolbar.querySelector('.action-label');
      var mine = row.querySelector('.action-label');
      if (!pill || !mine) return false;
      row.style.marginLeft = '0px';
      var pl = pill.getBoundingClientRect().left;
      var bl = mine.getBoundingClientRect().left;
      if (!pl || !bl) return false;
      row.style.marginLeft = (pl - bl) + 'px';
      return true;
    } catch (e) {
      return false;
    }
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

  function trySend(session, editor, needle) {
    var content = editorText(editor);
    if (content.indexOf(needle) === -1) return false;
    pressEnter(editor);
    // If text is still there shortly after, fall back to clicking the send button.
    setTimeout(function () {
      if (editorText(editor).indexOf(needle) !== -1) {
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

  function submit(text, originNode, mode) {
    var session = findSession(originNode);
    if (!session) { console.warn('[omc] no session'); return; }
    var editor = session.querySelector('.chat-editor-container .monaco-editor');
    if (!editor) { console.warn('[omc] no monaco editor'); return; }

    // The needle verifies the paste landed; trailing whitespace is normalized
    // away so it matches regardless of how the editor trims the macro text.
    var needle = text.replace(/\s+$/, '');

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
      if (!trySend(session, editor, needle)) {
        // One retry in case the editor mounted/focused late.
        pasteIntoEditor();
        setTimeout(function () { trySend(session, editor, needle); }, 90);
      }
    }, 80);
  }

  function ensureRow() {
    var sessions = document.querySelectorAll('.interactive-session');
    var allDone = sessions.length > 0;
    for (var i = 0; i < sessions.length; i++) {
      var session = sessions[i];
      // The pill row holding Agent / model / High / 1M.
      var toolbar = session.querySelector('.chat-input-toolbars');
      if (!toolbar || !toolbar.parentNode) { allDone = false; continue; }
      var host = toolbar.parentNode;
      var existing = host.querySelector(':scope > .' + ROW_CLASS);
      if (existing) {
        // Keep our row directly after the toolbar row.
        if (existing.previousSibling !== toolbar) {
          host.insertBefore(existing, toolbar.nextSibling);
        }
        // Pills may mount after our row; align once positions are known.
        if (existing.dataset.omcAligned !== '1' && alignLeft(existing, toolbar)) {
          existing.dataset.omcAligned = '1';
        }
        if (existing.dataset.omcAligned !== '1') allDone = false;
        continue;
      }
      var row = buildRow();
      host.insertBefore(row, toolbar.nextSibling);
      if (alignLeft(row, toolbar)) row.dataset.omcAligned = '1';
      else allDone = false;
    }
    return allDone;
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
    try { ensureStyle(); } catch (e) {}
    try {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    // Also poll for a while in case the chat view mounts late or the observer
    // misses it; stop early once every session has an installed, aligned row.
    var ticks = 0;
    var iv = setInterval(function () {
      var done = false;
      try { done = ensureRow(); } catch (e) {}
      if (done || ++ticks > 120) clearInterval(iv); // ~60s safety net
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

/** Filename of the workbench injection script (also the marker in imports). */
const INJECT_FILE = 'omc-inject.js';

/**
 * Absolute path to the workbench injection script under the extension's media.
 * @param {vscode.ExtensionContext} context
 * @returns {string}
 */
function injectionFilePath(context) {
  return path.join(context.extensionPath, 'media', INJECT_FILE);
}

/**
 * Write the injection script to media/omc-inject.js.
 * @param {vscode.ExtensionContext} context
 * @returns {string} the absolute file path
 */
function writeInjection(context) {
  const file = injectionFilePath(context);
  fs.writeFileSync(file, buildInjectionScript(loadButtons(context)), 'utf8');
  return file;
}

/**
 * Overwrite the injection script with a no-op so the injected row disappears
 * after the next reload, restoring the default Chat UI.
 * @param {vscode.ExtensionContext} context
 * @returns {string} the absolute file path
 */
function clearInjection(context) {
  const file = injectionFilePath(context);
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
    (x) => typeof x === 'string' && !x.includes(INJECT_FILE)
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
  let file;
  try {
    file = writeInjection(context);
  } catch (e) {
    vscode.window.showErrorMessage('Oh My Copilot: 生成注入脚本失败 — ' + String(e));
    return;
  }
  const url = vscode.Uri.file(file).toString(true);

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

  // Replace any stale entry. If ours was already present this is a refresh, so
  // we can use the lighter "update" command instead of the first-time install.
  const imports = customCssImportsWithoutOurs();
  const wasRegistered = imports.length !== (vscode.workspace.getConfiguration('vscode_custom_css').get('imports') || []).length;
  imports.push(url);
  try {
    await vscode.workspace
      .getConfiguration('vscode_custom_css')
      .update('imports', imports, vscode.ConfigurationTarget.Global);
  } catch (e) {
    vscode.window.showErrorMessage('Oh My Copilot: 写入 vscode_custom_css.imports 失败 — ' + String(e));
    return;
  }

  // Custom CSS shows its own reload prompt; don't add another.
  const applied = await applyCustomCss(!wasRegistered);
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

/**
 * Open the JSON command config in an editor, seeding defaults if missing.
 * @param {vscode.ExtensionContext} context
 */
async function editConfig(context) {
  const p = ensureConfig(context);
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
    await vscode.window.showTextDocument(doc);
  } catch (e) {
    vscode.window.showErrorMessage('Oh My Copilot: 打开配置失败 — ' + String(e));
  }
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const provider = new PanelViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ohMyCopilot.panel', provider)
  );

  // Seed the JSON config on first run, then keep the injection script current.
  ensureConfig(context);
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

  context.subscriptions.push(
    vscode.commands.registerCommand('ohMyCopilot.editConfig', () => editConfig(context))
  );

  // Regenerate the injection script when the JSON config changes.
  try {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(path.dirname(configPath(context))), 'commands.json')
    );
    const onChange = () => {
      try { writeInjection(context); } catch { /* ignore */ }
    };
    watcher.onDidCreate(onChange);
    watcher.onDidChange(onChange);
    watcher.onDidDelete(onChange);
    context.subscriptions.push(watcher);
  } catch {
    // ignore if the config folder cannot be watched
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
