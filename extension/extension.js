const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ text: string, label: string, icon: string, submit: string, description: string, iconOnly: boolean, newRow: boolean }} MacroButton
 */

/** Shared sentinel prefix for built-in tool buttons (#tool:copilot-extension/<command>). */
const TOKEN_PREFIX = '#tool:copilot-extension/';

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
 * Parse a commands config file, returning its object or null when missing/invalid.
 * @param {string} file
 * @returns {{ rows?: object[] } | null}
 */
function readConfigFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

/**
 * Path to the default config shipped inside the extension.
 * @param {vscode.ExtensionContext} context
 * @returns {string}
 */
function bundledConfigPath(context) {
  return path.join(context.extensionPath, 'commands.json');
}

/**
 * Normalize one raw config button into the internal MacroButton shape.
 *   { label, icon, showLabel, tooltip, action }
 *     action = { type: 'builtin', command }      -> a #tool:copilot-extension/<command> sentinel
 *            | { type: 'prompt',  value, submit } -> text inserted into chat (submit => auto-send)
 * @param {any} c raw button
 * @param {boolean} breakLine whether this button starts a new toolbar line
 * @returns {MacroButton|null}
 */
function normalizeButton(c, breakLine) {
  if (!c || typeof c !== 'object' || !c.action || typeof c.action !== 'object') return null;
  const action = c.action;
  let text = '';
  let submit = 'send';
  if (action.type === 'builtin' && typeof action.command === 'string' && action.command.trim()) {
    text = TOKEN_PREFIX + action.command.trim();
  } else if (action.type === 'prompt' && typeof action.value === 'string') {
    text = action.value;
    submit = action.submit === true ? 'send' : 'type';
  }
  if (!text.trim()) return null;
  return {
    text,
    label: (typeof c.label === 'string' && c.label) ? c.label : text.trim().slice(0, 24),
    icon: typeof c.icon === 'string' ? c.icon.replace(/[^a-z0-9-]/gi, '') : '',
    submit,
    description: typeof c.tooltip === 'string' ? c.tooltip : '',
    iconOnly: c.showLabel === false,
    newRow: !!breakLine
  };
}

/**
 * Read the command buttons. The user-level override (globalStorage) wins when
 * present; otherwise the bundled default ships the buttons. Schema:
 * `{ rows: [{ buttons: [<Button>] }] }`. Invalid entries are skipped.
 * @param {vscode.ExtensionContext} context
 * @returns {MacroButton[]}
 */
function loadButtons(context) {
  const data = readConfigFile(configPath(context)) || readConfigFile(bundledConfigPath(context));
  if (!data || !Array.isArray(data.rows)) return [];
  /** @type {Map<string, MacroButton>} */
  const byKey = new Map();
  // Each row is { buttons: [...] } (a bare array is also accepted). Every button
  // after the first row's start opens a fresh toolbar line.
  data.rows.forEach((row, rowIdx) => {
    const buttons = Array.isArray(row) ? row : (Array.isArray(row && row.buttons) ? row.buttons : []);
    buttons.forEach((c, btnIdx) => {
      const norm = normalizeButton(c, rowIdx > 0 && btnIdx === 0);
      if (norm && !byKey.has(norm.text)) byKey.set(norm.text, norm);
    });
  });
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
        vscode.commands.executeCommand('copilotExtension.enableInjection');
      } else if (msg.type === 'restoreDefault') {
        vscode.commands.executeCommand('copilotExtension.restoreDefault');
      } else if (msg.type === 'editConfig') {
        vscode.commands.executeCommand('copilotExtension.editConfig');
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
function buildInjectionScript(buttons, memos, bridge) {
  const data = JSON.stringify(buttons);
  const memoData = JSON.stringify(memos || []);
  const endpointsLit = JSON.stringify((bridge && bridge.endpoints) || []);
  const tokenLit = JSON.stringify((bridge && bridge.token) || '');
  const dirPortLit = Number(bridge && bridge.directoryPort) || 0;
  return `// AUTO-GENERATED by Copilot Extension. Do not edit; use the \"应用配置\" button instead.
(function () {
  'use strict';
  var BUTTONS = ${data};
  var MEMOS = ${memoData};
  var MEMO_TOKEN = ${JSON.stringify(MEMO_TOKEN)};
  var MEMORY_TOKEN = ${JSON.stringify(MEMORY_TOKEN)};
  var TERMINALS_TOKEN = ${JSON.stringify(TERMINALS_TOKEN)};
  var FOCUS_TOKEN = ${JSON.stringify(FOCUS_TOKEN)};
  var FIND_TOKEN = ${JSON.stringify(FIND_TOKEN)};
  var BADGE_TOKENS = ${JSON.stringify([...badgeProviders.keys()])};
  var BRIDGE_ENDPOINTS = ${endpointsLit};
  var CPX_TOKEN = ${tokenLit};
  var CPX_DIR_PORT = ${dirPortLit};
  var ROW_CLASS = 'cpx-button-row';

  // Minimal overrides that can't come from reused classes: a pointer cursor and
  // the hover background (reuses a VS Code variable — no hard-coded numbers).
  // We also relax two constraints the plural container imposes so our separate
  // row isn't width-limited or clipped.
  function ensureStyle() {
    if (document.getElementById('cpx-style')) return;
    var st = document.createElement('style');
    st.id = 'cpx-style';
    st.textContent =
      // Stack toolbar groups vertically so a button flagged newRow begins a
      // fresh line; align-items keeps every line flush-left under the offset.
      '.cpx-button-row{max-width:none;display:flex;flex-direction:column;align-items:flex-start;gap:4px}' +
      '.cpx-button-row>.chat-input-toolbar{width:auto;min-width:0;overflow:visible}' +
      '.cpx-button-row .action-label{cursor:pointer}' +
      '.cpx-button-row .action-label:hover{background-color:var(--vscode-toolbar-hoverBackground)}' +
      // Generic top-right count bubble for any badge-enabled button (BADGE_TOKENS).
      // The action-bar chain clips overflow by default, so open it up along the
      // whole path or the bubble's protruding corner gets cut off.
      '.cpx-button-row .monaco-action-bar,.cpx-button-row .actions-container,.cpx-button-row .action-item{overflow:visible}' +
      '.cpx-badge-item{position:relative;overflow:visible}' +
      '.cpx-badge{position:absolute;top:0;right:-7px;display:none;min-width:14px;height:14px;box-sizing:border-box;padding:0 4px;border-radius:8px;font-size:9px;line-height:14px;font-weight:600;text-align:center;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);pointer-events:none;z-index:5}' +
      // Our hover isn't sized by VS Code's hover service, so the absolute
      // .monaco-hover would shrink-to-min (a tall narrow column). max-content
      // makes it hug the text and wrap at the reused .hover-contents max-width.
      '.cpx-hover .monaco-hover{width:max-content}' +
      // Floating find bar pinned to the top-right of the chat list (positioned
      // in JS from the list rect; fixed so it stays put while the list scrolls).
      '.cpx-find-widget{position:fixed;z-index:2600;display:flex;align-items:center;gap:3px;padding:4px 6px;border-radius:4px;background:var(--vscode-editorWidget-background);color:var(--vscode-editorWidget-foreground,var(--vscode-foreground));border:1px solid var(--vscode-editorWidget-border,var(--vscode-widget-border,transparent));box-shadow:0 2px 8px var(--vscode-widget-shadow,rgba(0,0,0,.36));font-family:var(--vscode-font-family);font-size:12px}' +
      '.cpx-find-widget .cpx-find-input{width:180px;height:22px;box-sizing:border-box;padding:2px 6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:2px;outline:0}' +
      '.cpx-find-widget .cpx-find-input:focus{border-color:var(--vscode-focusBorder)}' +
      '.cpx-find-widget .cpx-find-count{min-width:58px;text-align:center;white-space:nowrap;color:var(--vscode-descriptionForeground);font-variant-numeric:tabular-nums}' +
      '.cpx-find-widget .cpx-find-btn{width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:4px;cursor:pointer;color:inherit;font-size:16px;line-height:1}' +
      '.cpx-find-widget .cpx-find-btn.disabled{opacity:.4;pointer-events:none}' +
      'mark.cpx-find-hl{background-color:var(--vscode-editor-findMatchHighlightBackground,rgba(234,92,0,.33));color:inherit;padding:0;border:1px solid var(--vscode-editor-findMatchHighlightBorder,transparent);border-radius:2px;box-sizing:border-box}' +
      'mark.cpx-find-current{background-color:var(--vscode-editor-findMatchBackground,rgba(234,92,0,.66));border:1px solid var(--vscode-editor-findMatchBorder,var(--vscode-focusBorder,transparent))}';
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
    wrap.className = 'monaco-resizable-hover cpx-hover';
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

  // ---- Memo manager (in-DOM, native-styled) -------------------------------
  // Rendered straight into the workbench DOM by this injected script: no webview
  // and no bridge round-trip to open, so it appears instantly and inherits the
  // native theme variables (matching the built-in manager editors). Writes are
  // persisted to disk through the loopback bridge optimistically — the UI
  // updates first, the POST happens in the background — since the bridge is the
  // only host channel available to injected workbench code.
  var memoState = {
    memos: (MEMOS || []).map(function (m) { return { label: m.label, text: m.text }; }),
    filter: '',
    editIndex: null
  };
  var memoRoot = null;

  function hideMemo() {
    if (memoRoot && memoRoot.parentNode) memoRoot.parentNode.removeChild(memoRoot);
    memoRoot = null;
  }

  // Pick the bridge endpoint that belongs to THIS window from a list, by
  // matching the workspace name against the window title (longest match wins).
  // With several windows we must NOT blindly grab the sole/first endpoint —
  // that's how requests leaked to another project's window — so when no name
  // matches the title we only trust a lone endpoint (the single-window case)
  // and otherwise refuse (null) rather than guess.
  function cpxPick(list) {
    if (!list || !list.length) return null;
    var title = document.title || '';
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e && e.name && title.indexOf(e.name) !== -1 && (!best || String(e.name).length > String(best.name).length)) best = e;
    }
    if (best) return best;
    return list.length === 1 ? list[0] : null;
  }

  // Resolve this window's live endpoint, caching the pick for a short window so
  // the recurring badge poll doesn't hit the directory service every tick. The
  // TTL is deliberately tiny: a stale or wrong pick (e.g. resolved before this
  // window's own bridge registered) self-corrects within seconds — unlike the
  // old indefinite cache that kept routing to another project's window forever.
  var __cpxEp = null, __cpxEpTs = 0, CPX_EP_TTL = 4000;
  function cpxResolve(cb) {
    if (__cpxEp && (Date.now() - __cpxEpTs) < CPX_EP_TTL) { cb(__cpxEp); return; }
    if (CPX_DIR_PORT) {
      fetch('http://127.0.0.1:' + CPX_DIR_PORT + '/registry?token=' + encodeURIComponent(CPX_TOKEN))
        .then(function (r) { return r.json(); })
        .then(function (list) { var ep = cpxPick(Array.isArray(list) && list.length ? list : BRIDGE_ENDPOINTS); __cpxEp = ep; __cpxEpTs = Date.now(); cb(ep); })
        .catch(function () { cb(cpxPick(BRIDGE_ENDPOINTS)); });
    } else { cb(cpxPick(BRIDGE_ENDPOINTS)); }
  }

  // POST a payload to this window's loopback bridge. When cb is given, the JSON
  // response is parsed and passed to it (null on failure); else fire-and-forget.
  function bridgeRequest(payload, cb) {
    cpxResolve(function (ep) {
      if (!ep || !ep.port) { if (cb) cb(null); return; }
      try {
        var p = fetch('http://127.0.0.1:' + ep.port + '/?token=' + encodeURIComponent(CPX_TOKEN), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        });
        if (cb) p.then(function (r) { return r.json(); }).then(cb).catch(function () { cb(null); });
      } catch (e) { if (cb) cb(null); }
    });
  }

  function bridgePost(payload) { bridgeRequest(payload); }
  function bridgeFetch(payload, cb) { bridgeRequest(payload, cb); }

  function mkEl(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  // Apply the given VS Code hover-background var on enter, clear on leave
  // (reused by the title actions, the search clear button and the list rows).
  // An optional foreground var is swapped in tandem for menu-style selections.
  function hoverBg(el, varName, fgVar) {
    el.addEventListener('mouseenter', function () { el.style.background = 'var(' + varName + ')'; if (fgVar) el.style.color = 'var(' + fgVar + ')'; });
    el.addEventListener('mouseleave', function () { el.style.background = 'transparent'; if (fgVar) el.style.color = ''; });
  }

  // Reuse VS Code's own button classes verbatim: .monaco-button gives the
  // themed colors, .monaco-text-button the padding/radius/layout, .default-colors
  // the hover, and .secondary the secondary palette — all from the workbench
  // stylesheet, no copied numbers. We only relax the block width to auto.
  function memoBtn(label, primary) {
    var b = mkEl('a', 'width:auto;white-space:nowrap', label);
    b.className = 'monaco-button monaco-text-button default-colors' + (primary ? '' : ' secondary');
    b.setAttribute('role', 'button');
    b.setAttribute('tabindex', '0');
    return b;
  }

  // Build VS Code's native modal-editor shell — the chrome the built-in
  // managers use: a dimmed full-screen block, a centered shadowed window, and a
  // titleBar-colored header (icon + title + a close action). Backdrop click and
  // Esc both close. Returns the pieces a manager fills in; the caller appends
  // its own body to the part node and may add extra buttons before closeBtn.
  function buildModalShell(opts) {
    var block = mkEl('div', '');
    block.className = 'monaco-modal-editor-block ' + opts.cssClass;
    var resizable = mkEl('div', 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:' + opts.width + ';height:' + opts.height);
    resizable.className = 'modal-editor-resizable';
    var shadow = mkEl('div', '');
    shadow.className = 'modal-editor-shadow';
    var part = mkEl('div', '');
    part.className = 'modal-editor-part';

    var header = mkEl('div', '');
    header.className = 'modal-editor-header';
    var title = mkEl('div', '');
    title.className = 'modal-editor-title';
    var tIcon = mkEl('span', 'margin-right:6px;vertical-align:middle');
    tIcon.className = 'codicon codicon-' + opts.icon;
    title.appendChild(tIcon);
    title.appendChild(mkEl('span', 'vertical-align:middle', opts.title));
    var actions = mkEl('div', '');
    actions.className = 'modal-editor-action-container';
    var actbar = mkEl('div', 'display:flex;align-items:center;gap:2px');
    actbar.className = 'actions-container';

    function titleAction(icon, tip) {
      var a = mkEl('a', 'width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:5px;cursor:pointer;color:inherit');
      a.className = 'action-label codicon codicon-' + icon;
      a.title = tip;
      hoverBg(a, '--vscode-toolbar-hoverBackground');
      return a;
    }
    var closeBtn = titleAction('close', '关闭 (Esc)');
    closeBtn.addEventListener('click', opts.onClose);
    actbar.appendChild(closeBtn);
    actions.appendChild(actbar);
    header.appendChild(title);
    header.appendChild(actions);

    part.appendChild(header);
    shadow.appendChild(part);
    resizable.appendChild(shadow);
    block.appendChild(resizable);
    block.addEventListener('mousedown', function (e) { if (e.target === block) opts.onClose(); });
    block.addEventListener('keydown', function (e) { if (e.key === 'Escape') opts.onClose(); });

    // Mount inside .monaco-workbench (not document.body) so the workbench's
    // theme variables and .modal-editor-* rules apply.
    (document.querySelector('.monaco-workbench') || document.body).appendChild(block);
    return { block: block, part: part, resizable: resizable, actbar: actbar, closeBtn: closeBtn, titleAction: titleAction };
  }

  function openMemoManager(anchor) {
    hideMemo();
    var wb = 'var(--vscode-editorWidget-border, var(--vscode-widget-border, var(--vscode-contrastBorder, transparent)))';

    // Native modal-editor shell (block/header/close/backdrop), themed by the
    // workbench's own .modal-editor-* rules — the chrome the built-in "语言模型"
    // manager uses. We add a maximize toggle before the close button.
    var DEF_W = 'min(1080px, 90vw)', DEF_H = 'min(660px, 86vh)';
    var shell = buildModalShell({ cssClass: 'cpx-memo', icon: 'note', title: '备忘录', width: DEF_W, height: DEF_H, onClose: hideMemo });
    var block = shell.block, part = shell.part;
    var maximized = false;
    var maxBtn = shell.titleAction('screen-full', '最大化');
    maxBtn.addEventListener('click', function () {
      maximized = !maximized;
      shell.resizable.style.width = maximized ? '96vw' : DEF_W;
      shell.resizable.style.height = maximized ? '92vh' : DEF_H;
      maxBtn.classList.remove(maximized ? 'codicon-screen-full' : 'codicon-screen-normal');
      maxBtn.classList.add(maximized ? 'codicon-screen-normal' : 'codicon-screen-full');
      maxBtn.title = maximized ? '还原' : '最大化';
    });
    shell.actbar.insertBefore(maxBtn, shell.closeBtn);

    // Body: toolbar (search + add) over a scrollable table.
    var bodyWrap = mkEl('div', 'grid-row:2;grid-column:1 / -1;display:flex;flex-direction:column;overflow:hidden;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:13px');
    var bar = mkEl('div', 'display:flex;align-items:center;gap:8px;padding:10px 12px');
    // Search box: reuse .monaco-inputbox + .input. The structural CSS comes from
    // those classes; the themed bg/border are normally applied by the InputBox
    // widget at runtime, so we point them at the same --vscode-input-* vars.
    var searchWrap = mkEl('div', 'flex:1 1 auto;display:flex;align-items:center;gap:6px;min-width:0;padding:0 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border, var(--vscode-contrastBorder, transparent));border-radius:2px');
    searchWrap.className = 'monaco-inputbox';
    var sIcon = mkEl('span', 'flex:0 0 auto;opacity:.75');
    sIcon.className = 'codicon codicon-search';
    var ibwrap = mkEl('div', 'flex:1 1 auto;min-width:0;position:relative;height:100%');
    ibwrap.className = 'ibwrapper';
    var search = mkEl('input', 'background:transparent;color:var(--vscode-input-foreground);border:0;outline:0');
    search.className = 'input';
    search.placeholder = '键入以搜索...';
    search.addEventListener('focus', function () { searchWrap.style.borderColor = 'var(--vscode-focusBorder)'; });
    search.addEventListener('blur', function () { searchWrap.style.borderColor = 'var(--vscode-input-border, var(--vscode-contrastBorder, transparent))'; });
    ibwrap.appendChild(search);
    // Clear button — shows only when there is text (reuses .action-label + codicon).
    var clearBtn = mkEl('a', 'flex:0 0 auto;display:none;width:20px;height:20px;align-items:center;justify-content:center;border-radius:5px;cursor:pointer;opacity:.85;font-size:16px;line-height:1');
    clearBtn.className = 'action-label codicon codicon-close';
    clearBtn.title = '清除';
    hoverBg(clearBtn, '--vscode-toolbar-hoverBackground');
    clearBtn.addEventListener('click', function () { search.value = ''; memoState.filter = ''; clearBtn.style.display = 'none'; render(); search.focus(); });
    searchWrap.appendChild(sIcon);
    searchWrap.appendChild(ibwrap);
    searchWrap.appendChild(clearBtn);
    var addBtn = memoBtn('添加备忘录', true);
    var addIcon = mkEl('span', 'margin-right:4px;font-size:16px;line-height:16px');
    addIcon.className = 'codicon codicon-add';
    addBtn.insertBefore(addIcon, addBtn.firstChild);
    bar.appendChild(searchWrap);
    bar.appendChild(addBtn);

    // Table: reuse the native .monaco-table / .monaco-list / .monaco-table-tr /
    // .monaco-table-th / .monaco-table-td hierarchy so cell ellipsis, the bold
    // header weight and the list row hover come from the workbench's own
    // stylesheet. Rows are made static (the native ones are virtual/absolute).
    var COL1 = 'flex:0 0 220px;width:auto;min-width:0;padding:6px 14px';
    var COL2 = 'flex:1 1 0;width:auto;min-width:0;padding:6px 14px';
    var COL3 = 'flex:0 0 230px;width:auto;padding:4px 14px;display:flex;justify-content:center;align-items:center;gap:4px';
    var tableEl = mkEl('div', 'flex:1 1 auto;min-height:0;display:flex;flex-direction:column');
    tableEl.className = 'monaco-table';
    var headerRow = mkEl('div', 'display:flex;flex:0 0 auto;border-bottom:1px solid ' + wb);
    var th1 = mkEl('div', COL1); th1.className = 'monaco-table-th'; th1.textContent = '名称';
    var th2 = mkEl('div', COL2); th2.className = 'monaco-table-th'; th2.textContent = '内容';
    var th3 = mkEl('div', COL3); th3.className = 'monaco-table-th'; th3.textContent = '操作';
    headerRow.appendChild(th1); headerRow.appendChild(th2); headerRow.appendChild(th3);
    var list = mkEl('div', 'flex:1 1 auto;min-height:0;overflow:auto;position:relative');
    list.className = 'monaco-list mouse-support';
    var rowsC = mkEl('div', 'position:relative;width:100%;height:auto');
    rowsC.className = 'monaco-list-rows';
    var empty = mkEl('div', 'padding:14px;color:var(--vscode-descriptionForeground)', '还没有备忘录，点「添加备忘录」新建。');
    list.appendChild(rowsC);
    list.appendChild(empty);
    tableEl.appendChild(headerRow);
    tableEl.appendChild(list);

    // Inline add/edit form.
    var form = mkEl('div', 'display:none;padding:12px;border-top:1px solid ' + wb + ';background:var(--vscode-editor-background)');
    var inCss = 'width:100%;box-sizing:border-box;margin-bottom:8px;padding:5px 7px;font-family:inherit;font-size:13px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border, transparent);border-radius:2px;outline:none';
    var flabel = mkEl('input', inCss);
    flabel.placeholder = '名称（可留空，默认取内容前若干字）';
    var ftext = mkEl('textarea', inCss + ';resize:vertical');
    ftext.rows = 5;
    ftext.placeholder = '内容';
    var fbtns = mkEl('div', 'display:flex;justify-content:flex-end;gap:6px');
    var cancelBtn = memoBtn('取消', false);
    var saveBtn = memoBtn('保存', true);
    cancelBtn.style.width = 'auto'; cancelBtn.style.flex = '0 0 auto';
    saveBtn.style.width = 'auto'; saveBtn.style.flex = '0 0 auto';
    fbtns.appendChild(saveBtn);
    fbtns.appendChild(cancelBtn);

    // Focus/blur highlight for the form inputs — matches the search box above.
    function focusBorder(el) { el.style.borderColor = 'var(--vscode-focusBorder)'; }
    function blurBorder(el) { el.style.borderColor = 'var(--vscode-input-border, var(--vscode-contrastBorder, transparent))'; }
    flabel.addEventListener('focus', function () { focusBorder(flabel); });
    flabel.addEventListener('blur', function () { blurBorder(flabel); });
    ftext.addEventListener('focus', function () { focusBorder(ftext); });
    ftext.addEventListener('blur', function () { blurBorder(ftext); });

    form.appendChild(flabel);
    form.appendChild(ftext);
    form.appendChild(fbtns);

    bodyWrap.appendChild(bar);
    bodyWrap.appendChild(tableEl);
    bodyWrap.appendChild(form);

    part.appendChild(bodyWrap);
    memoRoot = block;

    function visible() {
      var f = memoState.filter.trim().toLowerCase();
      var out = [];
      memoState.memos.forEach(function (m, i) {
        if (!f || (m.label || '').toLowerCase().indexOf(f) !== -1 || (m.text || '').toLowerCase().indexOf(f) !== -1) out.push({ m: m, i: i });
      });
      return out;
    }

    function persist() { bridgePost({ op: 'set', memos: memoState.memos }); }

    function act(a, i) {
      var m = memoState.memos[i];
      if (a === 'insert') { if (m) { hideMemo(); submit(m.text, anchor, 'type'); } }
      else if (a === 'copy') { if (m) bridgePost({ op: 'copy', text: m.text }); }
      else if (a === 'delete') { memoState.memos.splice(i, 1); persist(); render(); }
      else if (a === 'edit') openForm(i);
    }

    function render() {
      rowsC.textContent = '';
      var vis = visible();
      empty.style.display = memoState.memos.length ? 'none' : '';
      vis.forEach(function (x) {
        var row = mkEl('div', 'position:static;display:flex;width:100%;box-sizing:border-box;cursor:default');
        row.className = 'monaco-list-row';
        hoverBg(row, '--vscode-list-hoverBackground');
        var tr = mkEl('div', 'display:flex;flex:1 1 auto;min-width:0;align-items:center');
        tr.className = 'monaco-table-tr';
        var name = x.m.label || x.m.text;
        var td1 = mkEl('div', COL1); td1.className = 'monaco-table-td'; td1.textContent = name; td1.title = name;
        var td2 = mkEl('div', COL2 + ';color:var(--vscode-descriptionForeground)'); td2.className = 'monaco-table-td'; td2.textContent = x.m.text; td2.title = x.m.text;
        var td3 = mkEl('div', COL3); td3.className = 'monaco-table-td';
        [['插入', 'insert'], ['复制', 'copy'], ['编辑', 'edit'], ['删除', 'delete']].forEach(function (p) {
          var b = memoBtn(p[0], false);
          b.addEventListener('click', function (ev) { ev.stopPropagation(); act(p[1], x.i); });
          td3.appendChild(b);
        });
        tr.appendChild(td1);
        tr.appendChild(td2);
        tr.appendChild(td3);
        row.appendChild(tr);
        rowsC.appendChild(row);
      });
    }

    function openForm(i) {
      memoState.editIndex = i;
      flabel.value = i == null ? '' : (memoState.memos[i].label || '');
      ftext.value = i == null ? '' : (memoState.memos[i].text || '');
      form.style.display = '';
      flabel.focus();
    }

    search.addEventListener('input', function () { memoState.filter = search.value; clearBtn.style.display = search.value ? 'flex' : 'none'; render(); });
    addBtn.addEventListener('click', function () { openForm(null); });
    cancelBtn.addEventListener('click', function () { form.style.display = 'none'; });
    saveBtn.addEventListener('click', function () {
      var text = ftext.value;
      if (!text.trim()) return;
      var label = flabel.value.trim();
      var entry = { label: label || text.trim().slice(0, 24), text: text };
      if (memoState.editIndex != null && memoState.memos[memoState.editIndex]) memoState.memos[memoState.editIndex] = entry;
      else memoState.memos.push(entry);
      memoState.editIndex = null;
      form.style.display = 'none';
      persist();
      render();
    });

    render();
    search.focus();
  }

  // Entry point for the #memo chat button: open the in-DOM manager directly.
  // Instant — no webview spin-up and no bridge round-trip on open.
  function triggerMemo(anchor) {
    try {
      openMemoManager(anchor);
    } catch (e) {
      console.error('[cpx] memo manager failed:', e);
    }
  }

  // ---- Memory viewer (in-DOM, native-styled) --------------------------------
  var memoryRoot = null;

  function hideMemory() {
    if (memoryRoot && memoryRoot.parentNode) memoryRoot.parentNode.removeChild(memoryRoot);
    memoryRoot = null;
  }

  function openMemoryViewer(scopes) {
    hideMemory();
    var shell = buildModalShell({ cssClass: 'cpx-memory', icon: 'book', title: '记忆查看器', width: 'min(640px, 80vw)', height: 'min(480px, 72vh)', onClose: hideMemory });
    var block = shell.block;

    var bodyWrap = mkEl('div', 'grid-row:2;grid-column:1 / -1;display:flex;flex-direction:column;overflow:hidden;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:13px');
    var contentArea = mkEl('div', 'flex:1 1 auto;overflow:auto;padding:8px 0');

    if (!scopes || !scopes.length) {
      contentArea.appendChild(mkEl('div', 'padding:14px;color:var(--vscode-descriptionForeground)', '没有找到任何记忆文件。'));
    } else {
      scopes.forEach(function (scope) {
        var section = mkEl('div', 'margin-bottom:4px');
        var sHeader = mkEl('div', 'padding:6px 16px;font-weight:700;font-size:11px;text-transform:uppercase;color:var(--vscode-foreground);opacity:0.8');
        sHeader.textContent = scope.label;
        section.appendChild(sHeader);
        (scope.files || []).forEach(function (f) {
          var row = mkEl('div', 'display:flex;align-items:center;padding:4px 16px 4px 28px;cursor:pointer');
          hoverBg(row, '--vscode-list-hoverBackground');
          var icon = mkEl('span', 'margin-right:8px;flex:0 0 auto;opacity:0.75');
          icon.className = 'codicon codicon-file';
          var label = mkEl('span', 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
          label.textContent = f.name;
          label.title = f.path;
          row.appendChild(icon);
          row.appendChild(label);
          row.addEventListener('click', function () {
            bridgePost({ op: 'openMemory', path: f.path });
            hideMemory();
          });
          section.appendChild(row);
        });
        contentArea.appendChild(section);
      });
    }

    bodyWrap.appendChild(contentArea);
    shell.part.appendChild(bodyWrap);
    memoryRoot = block;

    block.setAttribute('tabindex', '-1');
    block.focus();
  }

  function triggerMemory() {
    bridgeFetch({ op: 'listMemory' }, function (data) {
      if (!data || !data.scopes) return;
      try { openMemoryViewer(data.scopes); } catch (e) {
        console.error('[cpx] memory viewer failed:', e);
      }
    });
  }

  // ---- Terminal viewer (in-DOM, native-styled) ------------------------------
  // Lists every workbench terminal (including ones hidden from the user) and
  // offers a one-click cleanup of all completed/inactive terminals. The data is
  // fetched from the loopback bridge; mutating ops re-render from the response.
  var terminalsRoot = null;

  function hideTerminals() {
    if (terminalsRoot && terminalsRoot.parentNode) terminalsRoot.parentNode.removeChild(terminalsRoot);
    terminalsRoot = null;
  }

  function openTerminalViewer(terminals) {
    hideTerminals();
    var shell = buildModalShell({ cssClass: 'cpx-terminals', icon: 'terminal', title: '终端查看器', width: 'min(640px, 80vw)', height: 'min(480px, 72vh)', onClose: hideTerminals });
    var block = shell.block;

    var bodyWrap = mkEl('div', 'grid-row:2;grid-column:1 / -1;display:flex;flex-direction:column;overflow:hidden;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:13px');
    var bar = mkEl('div', 'display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, transparent))');
    var countLbl = mkEl('div', 'flex:1 1 auto;min-width:0;color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
    var cleanBtn = memoBtn('清理空闲终端', false);
    var cleanIcon = mkEl('span', 'margin-right:4px;font-size:16px;line-height:16px');
    cleanIcon.className = 'codicon codicon-trash';
    cleanBtn.insertBefore(cleanIcon, cleanBtn.firstChild);
    bar.appendChild(countLbl);
    bar.appendChild(cleanBtn);

    var contentArea = mkEl('div', 'flex:1 1 auto;overflow:auto;padding:6px 0');

    bodyWrap.appendChild(bar);
    bodyWrap.appendChild(contentArea);
    shell.part.appendChild(bodyWrap);
    terminalsRoot = block;

    function render(list) {
      list = list || [];
      contentArea.textContent = '';
      var done = cleanableCount(list);
      countLbl.textContent = '共 ' + list.length + ' 个终端，' + done + ' 个可清理';
      cleanBtn.style.opacity = done ? '1' : '.5';
      cleanBtn.style.pointerEvents = done ? 'auto' : 'none';
      badgeCounts[TERMINALS_TOKEN] = done;
      try { updateBadges(); } catch (e) {}
      if (!list.length) {
        contentArea.appendChild(mkEl('div', 'padding:14px;color:var(--vscode-descriptionForeground)', '没有打开的终端。'));
        return;
      }
      list.forEach(function (t) {
        var row = mkEl('div', 'display:flex;align-items:center;padding:5px 16px;cursor:pointer');
        hoverBg(row, '--vscode-list-hoverBackground');
        var icon = mkEl('span', 'margin-right:8px;flex:0 0 auto');
        if (t.state === 'busy') {
          icon.className = 'codicon codicon-circle-filled';
          icon.style.color = 'var(--vscode-charts-green, var(--vscode-terminal-ansiGreen))';
        } else if (t.state === 'idle') {
          icon.className = 'codicon codicon-circle-outline';
          icon.style.opacity = '0.8';
        } else {
          icon.className = 'codicon codicon-circle-slash';
          icon.style.opacity = '0.7';
        }
        var label = mkEl('span', 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
        label.textContent = t.name + (t.active ? '  (活动)' : '');
        label.title = t.name;
        var status = mkEl('span', 'flex:0 0 auto;margin-left:8px;font-size:11px;color:var(--vscode-descriptionForeground)');
        status.textContent =
          t.state === 'busy' ? '运行中' :
          t.state === 'idle' ? '空闲' :
          t.exitCode == null ? '已退出' : '已退出 (' + t.exitCode + ')';
        row.appendChild(icon);
        row.appendChild(label);
        row.appendChild(status);
        row.addEventListener('click', function () {
          bridgePost({ op: 'showTerminal', index: t.index });
          hideTerminals();
        });
        contentArea.appendChild(row);
      });
    }

    cleanBtn.addEventListener('click', function () {
      bridgeFetch({ op: 'cleanupTerminals' }, function (data) {
        if (data && data.terminals) render(data.terminals);
      });
    });

    render(terminals);
    block.setAttribute('tabindex', '-1');
    block.focus();
  }

  function triggerTerminals() {
    bridgeFetch({ op: 'listTerminals' }, function (data) {
      if (!data) return;
      try { openTerminalViewer(data.terminals || []); } catch (e) {
        console.error('[cpx] terminal viewer failed:', e);
      }
    });
  }

  // ---- Terminals split-button behavior -------------------------------------
  // Primary click cleans idle terminals by default; the caret menu exposes a
  // persistent "only open the viewer" toggle that switches the primary click to
  // open the terminal viewer instead. The preference lives in localStorage so
  // it survives reloads (the injected script has no host storage of its own).
  var TERMINALS_PREF_KEY = 'cpx.terminals.openViewerOnly';

  function terminalsViewerOnly() {
    try { return localStorage.getItem(TERMINALS_PREF_KEY) === '1'; } catch (e) { return false; }
  }
  function setTerminalsViewerOnly(v) {
    try { localStorage.setItem(TERMINALS_PREF_KEY, v ? '1' : '0'); } catch (e) {}
  }

  function cleanupTerminalsNow() {
    bridgeFetch({ op: 'cleanupTerminals' }, function (data) {
      if (data && data.terminals) {
        badgeCounts[TERMINALS_TOKEN] = cleanableCount(data.terminals);
        try { updateBadges(); } catch (e) {}
      }
    });
  }

  function triggerTerminalsPrimary() {
    if (terminalsViewerOnly()) triggerTerminals();
    else cleanupTerminalsNow();
  }

  // ---- Find in conversation (Ctrl+F-style, in-DOM) --------------------------
  // A floating find bar pinned to the top-right of the chat list. It searches
  // the WHOLE conversation, not just the rows currently rendered: the chat list
  // is a virtualized monaco-list (only visible messages exist in the DOM), so we
  // drive it with synthetic wheel events (the same gesture its ScrollableElement
  // listens for), walk from top to bottom collecting each message row's text
  // keyed by its stable data-index, then compute matches. Navigating a match
  // scrolls its row back into view and highlights the exact occurrence. All
  // purely in the workbench DOM: no bridge round-trip is involved.
  var findState = null;
  var findHls = [];
  var findSearchTimer = null;
  var findScanSeq = 0;

  // Resolve the chat list's scroll pieces: the list viewport, the rows
  // container, and the scrollable element that consumes wheel events.
  function getFindScroller(session) {
    var listEl = session.querySelector('.interactive-list .monaco-list') || session.querySelector('.monaco-list');
    if (!listEl) return null;
    var rows = listEl.querySelector('.monaco-list-rows');
    if (!rows) return null;
    var scrollable = listEl.querySelector('.monaco-scrollable-element') || listEl;
    return { listEl: listEl, rows: rows, scrollable: scrollable };
  }

  // The message-content node inside a row. Restricting to it (instead of the
  // whole row) keeps toolbar/label chrome out of the searched text, and lets the
  // scan text and the highlight walk agree on offsets.
  function rowContentEl(rowEl) {
    return rowEl.querySelector('.interactive-item-container .value') ||
      rowEl.querySelector('.interactive-item-container') || rowEl;
  }
  function rowText(rowEl) {
    var c = rowContentEl(rowEl);
    return c ? (c.textContent || '') : '';
  }

  // Currently rendered rows, ascending by data-index.
  function findRenderedRows(scr) {
    var out = [];
    var els = scr.rows.querySelectorAll('.monaco-list-row');
    for (var i = 0; i < els.length; i++) {
      var di = els[i].getAttribute('data-index');
      if (di == null) continue;
      out.push({ index: Number(di), el: els[i] });
    }
    out.sort(function (a, b) { return a.index - b.index; });
    return out;
  }
  function findTotalItems(scr) {
    var el = scr.rows.querySelector('.monaco-list-row[aria-setsize]');
    if (el) { var n = Number(el.getAttribute('aria-setsize')); if (n > 0) return n; }
    return -1;
  }
  function findPageHeight(scr) {
    var r = scr.listEl.getBoundingClientRect();
    return Math.max(120, Math.round(r.height * 0.85));
  }
  function findWheel(scr, dy) {
    try {
      scr.scrollable.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true }));
    } catch (e) {}
  }
  function findRowByIndex(scr, index) {
    return scr.rows.querySelector('.monaco-list-row[data-index="' + index + '"]');
  }
  // Signed distance to move a rect's center onto the list viewport's center.
  function findCenterDelta(rect, viewportRect) {
    return (rect.top + rect.height / 2) - (viewportRect.top + viewportRect.height / 2);
  }

  // Scroll the virtualized list top-to-bottom, recording every message row's
  // text by data-index, then compute match positions. cb receives an array of
  // { index, occ } (occ = occurrence number within that row's text).
  function scanConversation(scr, query, seq, cb) {
    var q = query.toLowerCase();
    var seen = Object.create(null);
    var total = -1;
    var capTop = 400, capDown = 1500;
    var lastSig = '', stuck = 0;
    // Bail out of the async scroll chain once this scan is superseded (new query)
    // or the find bar closed — otherwise it keeps dispatching wheel events and
    // scrolling the user's chat after we're done with it.
    function aborted() { return !findState || seq !== findScanSeq; }

    function record() {
      var rows = findRenderedRows(scr);
      for (var i = 0; i < rows.length; i++) {
        if (!(rows[i].index in seen)) seen[rows[i].index] = rowText(rows[i].el);
      }
      var t = findTotalItems(scr);
      if (t > 0) total = t;
      return rows;
    }
    function sig(rows) {
      if (!rows.length) return 'empty';
      return rows[0].index + '/' + Math.round(rows[0].el.getBoundingClientRect().top) + '/' + rows[rows.length - 1].index;
    }
    function toTop() {
      if (aborted()) return;
      var rows = record();
      var s = sig(rows);
      var lr = scr.listEl.getBoundingClientRect();
      var atTop = rows.length && rows[0].index === 0 && rows[0].el.getBoundingClientRect().top >= (lr.top - 2);
      if (atTop || (s === lastSig && ++stuck >= 3) || --capTop <= 0) {
        lastSig = ''; stuck = 0; downStep(); return;
      }
      if (s !== lastSig) { stuck = 0; lastSig = s; }
      findWheel(scr, -findPageHeight(scr));
      setTimeout(toTop, 70);
    }
    function downStep() {
      if (aborted()) return;
      var rows = record();
      var s = sig(rows);
      var lr = scr.listEl.getBoundingClientRect();
      var haveLast = total > 0 && ((total - 1) in seen);
      var lastRow = rows.length ? rows[rows.length - 1] : null;
      var lastVisible = lastRow && lastRow.el.getBoundingClientRect().bottom <= lr.bottom + 2;
      if ((haveLast && lastVisible) || (s === lastSig && ++stuck >= 3) || --capDown <= 0) {
        finish(); return;
      }
      if (s !== lastSig) { stuck = 0; lastSig = s; }
      findWheel(scr, findPageHeight(scr));
      setTimeout(downStep, 70);
    }
    function finish() {
      record();
      var idxs = Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
      var matches = [];
      for (var k = 0; k < idxs.length; k++) {
        var di = idxs[k];
        var text = (seen[di] || '').toLowerCase();
        if (!text) continue;
        var pos = 0, occ = 0;
        while ((pos = text.indexOf(q, pos)) !== -1) {
          matches.push({ index: di, occ: occ });
          occ++; pos += q.length;
          if (occ > 5000) break;
        }
      }
      cb(matches);
    }
    toTop();
  }

  // Text nodes under a root, in document order.
  function findTextNodes(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) { if (n.nodeValue && n.nodeValue.length) nodes.push(n); }
    return nodes;
  }

  // Remove every highlight mark, restoring the original text nodes.
  function clearFindHighlights() {
    var parents = [];
    for (var i = 0; i < findHls.length; i++) {
      var mk = findHls[i];
      if (mk && mk.parentNode) {
        var p = mk.parentNode;
        p.replaceChild(document.createTextNode(mk.textContent || ''), mk);
        if (parents.indexOf(p) === -1) parents.push(p);
      }
    }
    findHls = [];
    for (var j = 0; j < parents.length; j++) { try { parents[j].normalize(); } catch (e) {} }
  }

  // Highlight every occurrence of query inside a row, tagging the occ-th one as
  // current. Matches are computed on the row's concatenated text (same basis as
  // the scan) so occ numbering lines up. Occurrences that straddle element
  // boundaries aren't wrapped (kept simple) but the current one still yields a
  // scroll target. Returns the current mark/element to center on, or null.
  function highlightOccurrence(rowEl, query, occ) {
    var root = rowContentEl(rowEl);
    if (!root) return null;
    var q = query.toLowerCase();
    var nodes = findTextNodes(root);
    var s = '', map = [];
    for (var i = 0; i < nodes.length; i++) { map.push({ node: nodes[i], start: s.length }); s += nodes[i].nodeValue; }
    var lower = s.toLowerCase();
    var occs = [], pos = 0;
    while ((pos = lower.indexOf(q, pos)) !== -1) { occs.push(pos); pos += q.length; }
    if (!occs.length) return null;
    function locate(offset) {
      for (var k = map.length - 1; k >= 0; k--) { if (offset >= map[k].start) return { node: map[k].node, local: offset - map[k].start }; }
      return null;
    }
    var groups = [], groupMap = new Map(), straddleTarget = null;
    for (var oi = 0; oi < occs.length; oi++) {
      var start = occs[oi], end = occs[oi] + q.length;
      var a = locate(start), b = locate(end - 1);
      var isCur = oi === occ;
      if (a && b && a.node === b.node) {
        var g = groupMap.get(a.node);
        if (!g) { g = { node: a.node, segs: [] }; groupMap.set(a.node, g); groups.push(g); }
        g.segs.push({ start: a.local, end: a.local + q.length, current: isCur });
      } else if (a && isCur) {
        straddleTarget = a.node.parentNode || a.node;
      }
    }
    var currentMark = null;
    for (var gi = 0; gi < groups.length; gi++) {
      var grp = groups[gi], node = grp.node, text = node.nodeValue;
      grp.segs.sort(function (x, y) { return x.start - y.start; });
      var frag = document.createDocumentFragment(), last = 0;
      for (var si = 0; si < grp.segs.length; si++) {
        var seg = grp.segs[si];
        if (seg.start > last) frag.appendChild(document.createTextNode(text.slice(last, seg.start)));
        var mk = document.createElement('mark');
        mk.className = 'cpx-find-hl' + (seg.current ? ' cpx-find-current' : '');
        mk.textContent = text.slice(seg.start, seg.end);
        if (seg.current) currentMark = mk;
        frag.appendChild(mk); findHls.push(mk); last = seg.end;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
    return currentMark || straddleTarget;
  }

  // Bring the row with the given data-index into view (wheel-scrolling the
  // virtualized list until it renders), roughly center it, then invoke cb(row).
  function findScrollToRow(scr, target, cb) {
    var cap = 800;
    function rowOf() { return findRowByIndex(scr, target); }
    function step() {
      if (!findState) { cb(null); return; }
      var row = rowOf();
      if (row) {
        var lr = scr.listEl.getBoundingClientRect();
        var rr = row.getBoundingClientRect();
        var delta = findCenterDelta(rr, lr);
        if (Math.abs(delta) > 8 && cap-- > 0) {
          findWheel(scr, delta);
          setTimeout(function () { cb(rowOf() || row); }, 80);
        } else {
          cb(row);
        }
        return;
      }
      if (cap-- <= 0) { cb(null); return; }
      var rows = findRenderedRows(scr);
      var dir = 1;
      if (rows.length && target < rows[0].index) dir = -1;
      findWheel(scr, dir * findPageHeight(scr));
      setTimeout(step, 70);
    }
    step();
  }

  function findUpdateCount() {
    if (!findState) return;
    var n = findState.matches.length;
    var el = findState.countEl;
    if (!findState.query) el.textContent = '';
    else if (findState.scanning) el.textContent = '搜索中…';
    else if (!n) el.textContent = '无结果';
    else el.textContent = (findState.current + 1) + ' / ' + n;
    var disabled = n <= 0;
    findState.prevBtn.classList.toggle('disabled', disabled);
    findState.nextBtn.classList.toggle('disabled', disabled);
  }

  // Re-highlight every match in the currently rendered rows, tagging the active
  // match as current. Clears first so it's idempotent and
  // safe to re-run after the virtualized list re-renders a row (which wipes our
  // injected marks). Off-screen rows can't be highlighted — they don't exist in
  // the DOM — so this mirrors what's visible, like a scroll-following overlay.
  function findCurrentMatch() {
    return (findState && findState.current >= 0) ? findState.matches[findState.current] : null;
  }

  function refreshHighlights() {
    if (!findState || !findState.query) return;
    clearFindHighlights();
    var q = findState.query;
    var cur = findCurrentMatch();
    var curIndex = cur ? cur.index : -1;
    var curOcc = cur ? cur.occ : -1;
    var rows = findRenderedRows(findState.scr);
    for (var i = 0; i < rows.length; i++) {
      var occ = (rows[i].index === curIndex) ? curOcc : -1;
      highlightOccurrence(rows[i].el, q, occ);
    }
  }

  // After navigating to a match, the chat list often re-renders that row a beat
  // later (streaming, re-measure, recycling), discarding our marks. Poll briefly
  // and re-apply whenever the current mark has gone missing, so the active match
  // stays visibly highlighted instead of flashing once and vanishing.
  function keepCurrentHighlight() {
    if (findState.keepTimer) { clearInterval(findState.keepTimer); findState.keepTimer = null; }
    var tries = 0;
    findState.keepTimer = setInterval(function () {
      if (!findState) return;
      tries++;
      var cur = findCurrentMatch();
      var row = cur ? findRowByIndex(findState.scr, cur.index) : null;
      if (row && !row.querySelector('mark.cpx-find-current')) refreshHighlights();
      if (tries >= 12) { clearInterval(findState.keepTimer); findState.keepTimer = null; }
    }, 150);
  }

  function findGoto(i) {
    if (!findState || !findState.matches.length) return;
    var n = findState.matches.length;
    i = ((i % n) + n) % n;
    findState.current = i;
    findUpdateCount();
    var m = findState.matches[i];
    var scr = findState.scr;
    findScrollToRow(scr, m.index, function (rowEl) {
      if (!rowEl || !findState) return;
      refreshHighlights();
      var curRow = findRowByIndex(scr, m.index);
      var cur = curRow && curRow.querySelector('mark.cpx-find-current');
      if (cur && cur.getBoundingClientRect) {
        var delta = findCenterDelta(cur.getBoundingClientRect(), scr.listEl.getBoundingClientRect());
        if (Math.abs(delta) > 24) {
          findWheel(scr, delta);
          setTimeout(function () { if (findState) refreshHighlights(); }, 80);
        }
      }
      keepCurrentHighlight();
    });
  }

  function findNavigate(delta) {
    if (!findState || !findState.matches.length) return;
    findGoto(findState.current + delta);
  }

  function findRunSearch() {
    if (!findState) return;
    var q = findState.query;
    clearFindHighlights();
    if (findState.keepTimer) { clearInterval(findState.keepTimer); findState.keepTimer = null; }
    if (!q) { findState.matches = []; findState.current = -1; findState.scanning = false; findUpdateCount(); return; }
    findState.scanning = true;
    findUpdateCount();
    var pre = findRenderedRows(findState.scr);
    var preIndex = pre.length ? pre[0].index : 0;
    var seq = ++findScanSeq;
    scanConversation(findState.scr, q, seq, function (matches) {
      if (!findState || seq !== findScanSeq) return;
      findState.matches = matches;
      findState.scanning = false;
      findState.current = matches.length ? 0 : -1;
      findUpdateCount();
      if (matches.length) findGoto(0);
      else findScrollToRow(findState.scr, preIndex, function () {});
    });
  }

  function findPositionWidget() {
    if (!findState) return;
    var r = findState.scr.listEl.getBoundingClientRect();
    var w = findState.widget;
    var ww = w.offsetWidth || 320;
    w.style.top = Math.round(r.top + 6) + 'px';
    w.style.left = Math.round(Math.max(6, r.right - ww - 16)) + 'px';
  }

  function closeFind() {
    if (!findState) return;
    clearFindHighlights();
    if (findSearchTimer) { clearTimeout(findSearchTimer); findSearchTimer = null; }
    if (findState.keepTimer) { clearInterval(findState.keepTimer); findState.keepTimer = null; }
    findScanSeq++;
    window.removeEventListener('resize', findState.reposition, true);
    if (findState.widget && findState.widget.parentNode) findState.widget.parentNode.removeChild(findState.widget);
    findState = null;
  }

  function findBtn(icon, tip) {
    var a = mkEl('a', '');
    a.className = 'cpx-find-btn codicon codicon-' + icon;
    a.title = tip;
    a.setAttribute('role', 'button');
    a.setAttribute('tabindex', '0');
    hoverBg(a, '--vscode-toolbar-hoverBackground');
    return a;
  }

  function buildFindWidget(session, scr) {
    var widget = mkEl('div', '');
    widget.className = 'cpx-find-widget';
    var input = mkEl('input', '');
    input.className = 'cpx-find-input';
    input.type = 'text';
    input.placeholder = '在会话中查找';
    var count = mkEl('span', '', '');
    count.className = 'cpx-find-count';
    var prev = findBtn('arrow-up', '上一个匹配 (Shift+Enter)');
    var next = findBtn('arrow-down', '下一个匹配 (Enter)');
    var close = findBtn('close', '关闭 (Esc)');
    widget.appendChild(input);
    widget.appendChild(count);
    widget.appendChild(prev);
    widget.appendChild(next);
    widget.appendChild(close);
    (document.querySelector('.monaco-workbench') || document.body).appendChild(widget);

    findState = {
      session: session, scr: scr, widget: widget, input: input, countEl: count,
      prevBtn: prev, nextBtn: next, query: '', matches: [], current: -1, scanning: false,
      reposition: function () { findPositionWidget(); }
    };

    prev.addEventListener('click', function () { findNavigate(-1); });
    next.addEventListener('click', function () { findNavigate(1); });
    close.addEventListener('click', closeFind);
    input.addEventListener('input', function () {
      findState.query = input.value;
      if (findSearchTimer) clearTimeout(findSearchTimer);
      findSearchTimer = setTimeout(findRunSearch, 300);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (findState.scanning) return;
        findNavigate(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFind();
      }
    });
    window.addEventListener('resize', findState.reposition, true);
    findPositionWidget();
    findUpdateCount();
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 0);
  }

  // Entry point for the #find chat button. Toggles the find bar for the chat
  // session that owns the clicked button.
  function triggerFind(anchor) {
    try {
      var session = findSession(anchor);
      if (!session) return;
      if (findState) {
        if (findState.session === session) { closeFind(); return; }
        closeFind();
      }
      var scr = getFindScroller(session);
      if (!scr) { console.warn('[cpx] find: no chat list'); return; }
      buildFindWidget(session, scr);
    } catch (e) {
      console.error('[cpx] find failed:', e);
    }
  }

  // Generic count bubble for any #tool:copilot-extension/* button whose token
  // the host registered a badge provider for (BADGE_TOKENS). Per-token counts
  // come from the badgeCounts bridge op and are re-applied after every row
  // rebuild (ensureRow may recreate a button with an empty badge).
  var badgeCounts = {};

  function cleanableCount(list) {
    var n = 0;
    list.forEach(function (t) { if (t.state !== 'busy') n++; });
    return n;
  }

  function updateBadges() {
    var items = document.querySelectorAll('.cpx-badge-item');
    for (var i = 0; i < items.length; i++) {
      var badge = items[i].querySelector('.cpx-badge');
      if (!badge) continue;
      var n = badgeCounts[items[i].dataset.cpxToken] || 0;
      if (n > 0) {
        var txt = n > 99 ? '99+' : String(n);
        if (badge.textContent !== txt) badge.textContent = txt;
        if (badge.style.display !== 'block') badge.style.display = 'block';
      } else if (badge.style.display !== 'none') {
        badge.style.display = 'none';
      }
    }
  }

  function pollBadges() {
    // No badge-bearing button mounted (e.g. chat closed) — skip the round-trip
    // rather than polling the host every few seconds for nothing.
    if (!BADGE_TOKENS.length || !document.querySelector('.cpx-badge-item')) return;
    bridgeFetch({ op: 'badgeCounts' }, function (data) {
      if (!data || !data.counts) return;
      badgeCounts = data.counts;
      updateBadges();
    });
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
  // ---- Generic split-button dropdown ---------------------------------------
  // A reusable caret menu for toolbar buttons: a button keeps its primary click
  // action while a small chevron opens a themed popup of extra options
  // (checkable toggles or one-off actions). Styling reuses the workbench menu
  // variables so it matches native context menus. Only one menu is open at a
  // time; an outside click or Esc dismisses it. To make a button a split
  // button, return a descriptor from splitButtonSpec.
  var dropdownRoot = null;

  function closeDropdown() {
    if (dropdownRoot && dropdownRoot.parentNode) dropdownRoot.parentNode.removeChild(dropdownRoot);
    dropdownRoot = null;
    document.removeEventListener('mousedown', onDropdownDocDown, true);
    document.removeEventListener('keydown', onDropdownDocKey, true);
  }

  function onDropdownDocDown(e) {
    if (dropdownRoot && !dropdownRoot.contains(e.target)) closeDropdown();
  }
  function onDropdownDocKey(e) {
    if (e.key === 'Escape') closeDropdown();
  }

  // Build the popup body from an item list. Each item is either
  //   { type:'checkbox', label, checked():bool, onToggle(next) }  or
  //   { type:'action',   label, icon?, onClick() }
  function buildDropdownMenu(items) {
    var menu = mkEl('div', 'position:fixed;z-index:2600;min-width:200px;padding:4px;border-radius:5px;background:var(--vscode-menu-background, var(--vscode-editorWidget-background));color:var(--vscode-menu-foreground, var(--vscode-foreground));border:1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));box-shadow:0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,.36));font-family:var(--vscode-font-family);font-size:13px');
    menu.className = 'cpx-dropdown-menu';
    items.forEach(function (it) {
      var row = mkEl('div', 'display:flex;align-items:center;gap:8px;padding:4px 10px;border-radius:4px;cursor:pointer;white-space:nowrap');
      var mark = mkEl('span', 'flex:0 0 auto;width:16px;text-align:center;font-size:14px');
      if (it.type === 'checkbox') {
        mark.className = 'codicon codicon-check';
        mark.style.visibility = it.checked() ? 'visible' : 'hidden';
      } else if (it.icon) {
        mark.className = 'codicon codicon-' + it.icon;
      }
      var lbl = mkEl('span', 'flex:1 1 auto', it.label);
      row.appendChild(mark);
      row.appendChild(lbl);
      hoverBg(row, '--vscode-menu-selectionBackground', '--vscode-menu-selectionForeground');
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        if (it.type === 'checkbox') {
          var nv = !it.checked();
          if (it.onToggle) it.onToggle(nv);
          mark.style.visibility = nv ? 'visible' : 'hidden';
        } else if (it.onClick) {
          it.onClick();
        }
        closeDropdown();
      });
      menu.appendChild(row);
    });
    return menu;
  }

  function openDropdown(anchorEl, items) {
    if (dropdownRoot) { closeDropdown(); return; }
    var menu = buildDropdownMenu(items);
    (document.querySelector('.monaco-workbench') || document.body).appendChild(menu);
    dropdownRoot = menu;
    var r = anchorEl.getBoundingClientRect();
    var mr = menu.getBoundingClientRect();
    // The chat toolbar sits near the bottom, so prefer opening upward; flip
    // below when there isn't room above. Left edges align with the button.
    var top = r.top - mr.height - 4;
    if (top < 4) top = r.bottom + 4;
    var left = Math.min(r.left, window.innerWidth - mr.width - 4);
    menu.style.top = Math.round(Math.max(4, top)) + 'px';
    menu.style.left = Math.round(Math.max(4, left)) + 'px';
    // The opening click's mousedown already fired before this click handler, so
    // attaching synchronously won't immediately self-close the freshly opened
    // menu (and avoids a timer that could leak listeners on rapid re-open).
    document.addEventListener('mousedown', onDropdownDocDown, true);
    document.addEventListener('keydown', onDropdownDocKey, true);
  }

  // Append a chevron to a button anchor that opens the given menu. Clicking the
  // chevron stops the click from reaching the anchor's primary action.
  function attachCaret(anchor, getItems) {
    var caret = mkEl('span', 'margin-left:2px;opacity:.85;cursor:pointer');
    caret.className = 'codicon codicon-chevron-down cpx-caret';
    caret.title = '更多选项';
    caret.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      hideHover();
      openDropdown(anchor, getItems());
    });
    anchor.appendChild(caret);
  }

  // Split-button descriptor { primary: fn(anchor), items: fn(): MenuItem[] }.
  // Only the Terminals builtin opts in today; new split buttons add a case.
  function splitButtonSpec(b) {
    if (b.text === TERMINALS_TOKEN) {
      return {
        primary: triggerTerminalsPrimary,
        items: function () {
          return [{
            type: 'checkbox',
            label: '仅打开终端查看器',
            checked: terminalsViewerOnly,
            onToggle: setTerminalsViewerOnly
          }];
        }
      };
    }
    return null;
  }

  // Build one native action item (li > a) for a button.
  function buildButtonItem(b) {
    var li = document.createElement('li');
    var hasBadge = BADGE_TOKENS.indexOf(b.text) !== -1;
    var split = splitButtonSpec(b);
    li.className = 'action-item chat-input-picker-item' + (b.text === FOCUS_TOKEN ? ' cpx-focus-item' : '') + (hasBadge ? ' cpx-badge-item' : '');
    li.setAttribute('role', 'presentation');
    var a = document.createElement('a');
    a.className = 'action-label' + (b.iconOnly ? ' compact' : '');
    a.setAttribute('role', 'button');
    a.setAttribute('tabindex', '0');
    var tip = b.description || b.text.trim();
    a.setAttribute('aria-label', tip);
    if (b.icon) {
      var ic = document.createElement('span');
      ic.className = 'codicon codicon-' + b.icon;
      a.appendChild(ic);
    }
    if (!b.iconOnly) {
      var lbl = document.createElement('span');
      lbl.className = 'chat-input-picker-label';
      lbl.textContent = b.label;
      a.appendChild(lbl);
    }
    if (split) attachCaret(a, split.items);
    attachHover(a, tip);
    a.addEventListener('click', function () {
      hideHover();
      if (split) { split.primary(a); return; }
      if (b.text === MEMO_TOKEN) { triggerMemo(a); return; }
      if (b.text === MEMORY_TOKEN) { triggerMemory(); return; }
      if (b.text === FIND_TOKEN) { triggerFind(a); return; }
      if (b.text === FOCUS_TOKEN) { toggleChatFocus(); return; }
      submit(b.text, a, b.submit);
    });
    li.appendChild(a);
    if (hasBadge) {
      li.dataset.cpxToken = b.text;
      var badge = document.createElement('span');
      badge.className = 'cpx-badge';
      li.appendChild(badge);
    }
    return li;
  }

  // One toolbar line: returns the toolbar node plus the action list to fill.
  function buildToolbarLine() {
    var tb = document.createElement('div');
    tb.className = 'chat-input-toolbar';
    var bar = document.createElement('div');
    bar.className = 'monaco-action-bar';
    var ul = document.createElement('ul');
    ul.className = 'actions-container';
    ul.setAttribute('role', 'toolbar');
    bar.appendChild(ul);
    tb.appendChild(bar);
    return { toolbar: tb, actionList: ul };
  }

  function buildRow() {
    var root = document.createElement('div');
    root.className = ROW_CLASS + ' chat-input-toolbars';
    // Each button flagged newRow starts a fresh toolbar line; all lines stack
    // vertically (CSS column) under the same left offset.
    var line = buildToolbarLine();
    root.appendChild(line.toolbar);
    BUTTONS.forEach(function (b, idx) {
      if (b.newRow && idx > 0) {
        line = buildToolbarLine();
        root.appendChild(line.toolbar);
      }
      line.actionList.appendChild(buildButtonItem(b));
    });
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
    if (!session) { console.warn('[cpx] no session'); return; }
    var editor = session.querySelector('.chat-editor-container .monaco-editor');
    if (!editor) { console.warn('[cpx] no monaco editor'); return; }

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
      } catch (e) { console.warn('[cpx] paste dispatch failed', e); }
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

  // Chat-focus toggle. The button uses its OWN .monaco-action-bar so it gets
  // native styling but is isolated from the real layout toolbar's click
  // delegation and re-rendering. cpxFocusState is null when off; when on it
  // records which parts we hid (read from the workbench's nosidebar/nopanel/
  // noauxiliarybar classes) so toggling is idempotent. Commands run via the bridge.
  var cpxFocusState = null;

  function wbHas(cls) {
    var e = document.querySelector('.monaco-workbench');
    return !!(e && e.classList.contains(cls));
  }

  // Restored-state glyph: the codicon-layout-centered shape but with its centre
  // column hollow instead of solid (the even-odd fill rule punches the hole).
  // Inlined because the codicon font has no hollow-centre variant.
  var CPX_FOCUS_ICON =
    '<svg width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M3.5 1H12.5C13.879 1 15 2.121 15 3.5V12.5C15 13.879 13.879 15 12.5 15H3.5C2.121 15 1 13.879 1 12.5V3.5C1 2.121 2.121 1 3.5 1ZM2 3.5V12.5C2 13.327 2.673 14 3.5 14H6V2H3.5C2.673 2 2 2.673 2 3.5ZM12.5 14C13.327 14 14 13.327 14 12.5V3.5C14 2.673 13.327 2 12.5 2H10V14H12.5ZM7 2H9V14H7V2Z"/>' +
    '</svg>';

  // Icon-span class for each focus state. Filled = native solid codicon;
  // restored = our hollow-centre SVG (cleared codicon classes so the codicon
  // pseudo-element doesn't double-render beside the SVG).
  var FOCUS_GLYPH_FILLED = 'codicon codicon-layout-centered';
  var FOCUS_GLYPH_HOLLOW = 'cpx-focus-svg';

  function setFocusIcon() {
    // Sync the icon span inside every focus pill. The per-element className
    // guards below make redundant ticks a no-op; we can't short-circuit on
    // cpxFocusState alone because ensureRow may rebuild the pill with the
    // default solid codicon, which must then be re-synced to the current state.
    var items = document.querySelectorAll('.cpx-focus-item');
    for (var i = 0; i < items.length; i++) {
      var a = items[i].querySelector('.action-label');
      var ic = items[i].querySelector('.codicon, .cpx-focus-svg');
      if (!a || !ic) continue;
      if (cpxFocusState) {
        if (!a.classList.contains('checked')) a.classList.add('checked');
        if (ic.className !== FOCUS_GLYPH_FILLED) {
          ic.className = FOCUS_GLYPH_FILLED;
          ic.innerHTML = '';
        }
      } else {
        a.classList.remove('checked');
        if (ic.className !== FOCUS_GLYPH_HOLLOW) {
          ic.className = FOCUS_GLYPH_HOLLOW;
          ic.innerHTML = CPX_FOCUS_ICON;
        }
      }
    }
  }

  function toggleChatFocus() {
    var cmds = [];
    if (!cpxFocusState) {
      var s = { panel: !wbHas('nopanel'), aux: !wbHas('noauxiliarybar') };
      cmds.push('workbench.action.chat.openInEditor');
      if (s.panel) cmds.push('workbench.action.togglePanel');
      if (s.aux) cmds.push('workbench.action.toggleAuxiliaryBar');
      cpxFocusState = s;
    } else {
      if (cpxFocusState.aux && wbHas('noauxiliarybar')) cmds.push('workbench.action.toggleAuxiliaryBar');
      if (cpxFocusState.panel && wbHas('nopanel')) cmds.push('workbench.action.togglePanel');
      cmds.push('workbench.action.chat.openInSidebar');
      cpxFocusState = null;
    }
    setFocusIcon();
    bridgePost({ op: 'runCommands', commands: cmds });
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
        if (existing.dataset.cpxAligned !== '1' && alignLeft(existing, toolbar)) {
          existing.dataset.cpxAligned = '1';
        }
        if (existing.dataset.cpxAligned !== '1') allDone = false;
        continue;
      }
      var row = buildRow();
      host.insertBefore(row, toolbar.nextSibling);
      if (alignLeft(row, toolbar)) row.dataset.cpxAligned = '1';
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
      try { setFocusIcon(); } catch (e) {}
      try { updateBadges(); } catch (e) {}
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
      try { setFocusIcon(); } catch (e) {}
      try { updateBadges(); } catch (e) {}
      if (done || ++ticks > 120) clearInterval(iv); // ~60s safety net
    }, 500);
    try { ensureRow(); } catch (e) {}
    try { setFocusIcon(); } catch (e) {}
    try { pollBadges(); } catch (e) {}
    setInterval(function () { try { pollBadges(); } catch (e) {} }, 3000);
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
const INJECT_FILE = 'cpx-inject.js';

/**
 * Absolute path to the workbench injection script under the extension's media.
 * @param {vscode.ExtensionContext} context
 * @returns {string}
 */
function injectionFilePath(context) {
  return path.join(context.extensionPath, 'media', INJECT_FILE);
}

/**
 * Write the injection script to media/cpx-inject.js.
 * @param {vscode.ExtensionContext} context
 * @returns {string} the absolute file path
 */
function writeInjection(context) {
  const file = injectionFilePath(context);
  const next = buildInjectionScript(loadButtons(context), loadMemos(context), {
    endpoints: activeBridgeEndpoints(context),
    token: bridgeToken,
    directoryPort: bridgeDirectoryPort
  });
  let cur = null;
  try { cur = fs.readFileSync(file, 'utf8'); } catch { /* missing */ }
  if (cur !== next) fs.writeFileSync(file, next, 'utf8');
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
    '// Copilot Extension injection disabled (restored to default).\n',
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
    vscode.window.showErrorMessage('Copilot Extension: 生成注入脚本失败 — ' + String(e));
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
    vscode.window.showErrorMessage('Copilot Extension: 写入 vscode_custom_css.imports 失败 — ' + String(e));
    return;
  }

  // Custom CSS shows its own reload prompt; don't add another.
  const applied = await applyCustomCss(!wasRegistered);
  if (!applied) {
    const pick = await vscode.window.showWarningMessage(
      'Copilot Extension: 已写入配置，但未找到 Custom CSS 的启用命令。请手动运行「Enable Custom CSS and JS」，然后重载窗口。',
      '打开命令面板'
    );
    if (pick === '打开命令面板') {
      vscode.commands.executeCommand('workbench.action.quickOpen', '>Custom CSS');
    }
  }
}

/**
 * Open the user-level command config for editing, creating it from the bundled
 * default on first use so there's something to edit. Once the override exists it
 * takes priority over the bundled default (loadButtons reads it first).
 * @param {vscode.ExtensionContext} context
 */
async function editConfig(context) {
  const p = configPath(context);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Seed the override from the bundled default only when absent — EXCL makes
    // the copy fail (and we ignore it) if it already exists, so no pre-check.
    try { fs.copyFileSync(bundledConfigPath(context), p, fs.constants.COPYFILE_EXCL); } catch { /* already exists */ }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
    await vscode.window.showTextDocument(doc);
  } catch (e) {
    vscode.window.showErrorMessage('Copilot Extension: 打开配置失败 — ' + String(e));
  }
}

/** Special macro token (normalized button text) that opens the memo manager. */
const MEMO_TOKEN = TOKEN_PREFIX + 'memo';

/** Special macro token that opens the memory viewer. */
const MEMORY_TOKEN = TOKEN_PREFIX + 'memory';

/** Special macro token that opens the terminal viewer. */
const TERMINALS_TOKEN = TOKEN_PREFIX + 'terminals';

/** Special macro token that toggles chat-focus (spread / restore). */
const FOCUS_TOKEN = TOKEN_PREFIX + 'focus';

/** Special macro token that opens the in-conversation find bar. */
const FIND_TOKEN = TOKEN_PREFIX + 'find';

/**
 * @typedef {{ label: string, text: string }} Memo
 */

/** @param {vscode.ExtensionContext} context @returns {string} */
function memosPath(context) {
  return path.join(context.globalStorageUri.fsPath, 'memos.json');
}

/** Create an empty memos store if absent. @param {vscode.ExtensionContext} context */
function ensureMemos(context) {
  const p = memosPath(context);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ memos: [] }, null, 2) + '\n', { flag: 'wx' });
  } catch { /* already exists or unwritable */ }
  return p;
}

/**
 * Normalize a raw list into clean Memo objects: drop empty-text entries and
 * default a missing label to the first chars of the text.
 * @param {any[]} list
 * @returns {Memo[]}
 */
function sanitizeMemos(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || typeof m.text !== 'string' || !m.text.trim()) continue;
    out.push({ label: (typeof m.label === 'string' && m.label.trim()) ? m.label.trim() : m.text.trim().slice(0, 24), text: m.text });
  }
  return out;
}

/** @param {vscode.ExtensionContext} context @returns {Memo[]} */
function loadMemos(context) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(memosPath(context), 'utf8'));
  } catch {
    return [];
  }
  return sanitizeMemos(Array.isArray(data) ? data : (data && data.memos));
}

/** @param {vscode.ExtensionContext} context @param {Memo[]} memos */
function saveMemos(context, memos) {
  const p = memosPath(context);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ memos }, null, 2) + '\n', 'utf8');
  try { writeInjection(context); } catch { /* keep injection in sync */ }
}

let bridgePort = 0;
let bridgeToken = '';
let bridgeId = '';
let bridgeName = '';
let bridgeDirectoryPort = 0;
let directoryServer = null;

const FOCUS_CMD_WHITELIST = new Set([
  'workbench.action.chat.openInEditor',
  'workbench.action.chat.openInSidebar',
  'workbench.action.togglePanel',
  'workbench.action.toggleAuxiliaryBar'
]);

/**
 * Run an ordered list of layout/chat commands requested by the injected
 * chat-focus toggle, restricted to a fixed whitelist (no arbitrary execution).
 * @param {any[]} commands
 */
async function runFocusCommands(commands) {
  for (const id of commands) {
    if (typeof id === 'string' && FOCUS_CMD_WHITELIST.has(id)) {
      try { await vscode.commands.executeCommand(id); } catch { /* ignore */ }
    }
  }
}

/**
 * Handle a bridge request from the injected script.
 * @param {vscode.ExtensionContext} context
 * @param {{op?: string, memos?: any[], text?: string, commands?: string[], path?: string}} payload
 */
/**
 * Resolve the user-level Copilot memory directory.
 * @param {vscode.ExtensionContext} context
 * @returns {string}
 */
function memoryUserDir(context) {
  return path.join(path.dirname(context.globalStorageUri.fsPath), 'github.copilot-chat', 'memory-tool', 'memories');
}

/**
 * Resolve the workspace-level Copilot memory directory.
 * @param {vscode.ExtensionContext} context
 * @returns {string|null}
 */
function memoryWorkspaceDir(context) {
  if (!context.storageUri) return null;
  const base = path.dirname(context.storageUri.fsPath);
  for (const name of ['GitHub.copilot-chat', 'github.copilot-chat']) {
    const d = path.join(base, name, 'memory-tool', 'memories');
    // Read the dir directly to both confirm it exists and pick the right
    // casing variant in one syscall (no separate stat existence pre-check).
    try { fs.readdirSync(d); return d; } catch { /* try next */ }
  }
  return null;
}

/**
 * List .md files directly inside a directory.
 * @param {string} dir
 * @returns {{name: string, path: string}[]}
 */
function listMdFiles(dir) {
  const out = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md')) out.push({ name: e.name, path: path.join(dir, e.name) });
    }
  } catch { /* dir doesn't exist */ }
  return out;
}

/**
 * Resolve the current conversation's session-memory folder. Copilot stores each
 * conversation's session memory in its own `<base64(sessionId)>` subfolder of
 * the workspace memory dir (there is no literal `session` folder), so the
 * extension can't know the active session id directly. We approximate "current
 * conversation" as the most-recently-written non-`repo` subfolder.
 * @param {string} wsDir
 * @returns {string|null}
 */
function currentSessionDir(wsDir) {
  let best = null;
  let bestTs = -1;
  try {
    for (const e of fs.readdirSync(wsDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === 'repo') continue;
      const dir = path.join(wsDir, e.name);
      const ts = latestMdMtime(dir);
      if (ts > bestTs) { bestTs = ts; best = dir; }
    }
  } catch { /* dir doesn't exist */ }
  return best;
}

/**
 * Newest .md modification time (ms) directly inside a directory, or -1 if none.
 * @param {string} dir
 * @returns {number}
 */
function latestMdMtime(dir) {
  let ts = -1;
  try {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith('.md')) {
        const m = fs.statSync(path.join(dir, f.name)).mtimeMs;
        if (m > ts) ts = m;
      }
    }
  } catch { /* unreadable subfolder */ }
  return ts;
}

/**
 * Terminals that are currently executing a shell command, tracked via the
 * shell-integration execution events. A terminal NOT in this set is idle (its
 * command finished and it sits at a prompt) — that's the "completed/inactive"
 * case the cleanup targets, distinct from a still-running command. exitStatus
 * (whole shell process gone) is a third, separate state.
 * @type {Set<vscode.Terminal>}
 */
const busyTerminals = new Set();

/**
 * Snapshot every workbench terminal (including ones hidden from the user, which
 * are still present in vscode.window.terminals). `state` is one of:
 *   'busy'   — a shell command is currently executing (active, not cleanable)
 *   'idle'   — shell alive but at a prompt, command finished (cleanable)
 *   'exited' — the shell process itself has exited (cleanable)
 * `index` is the live position used as an opaque handle for showTerminal.
 * @returns {{index:number,name:string,state:string,exitCode:number|null,active:boolean}[]}
 */
function listTerminalsData() {
  const active = vscode.window.activeTerminal;
  return vscode.window.terminals.map((t, i) => {
    let state;
    if (t.exitStatus) state = 'exited';
    else if (busyTerminals.has(t)) state = 'busy';
    else state = 'idle';
    return {
      index: i,
      name: t.name,
      state,
      exitCode: t.exitStatus ? (t.exitStatus.code == null ? null : t.exitStatus.code) : null,
      active: t === active
    };
  });
}

/**
 * Count-bubble providers keyed by button token. Registering one is the whole
 * "interface": the matching #tool:copilot-extension/* button then auto-shows a
 * bubble — the injected script reads the token list (BADGE_TOKENS) to render the
 * badge element and polls the badgeCounts bridge op for the live numbers.
 * @type {Map<string, (context: vscode.ExtensionContext) => number>}
 */
const badgeProviders = new Map();
function registerBadgeProvider(token, getCount) { badgeProviders.set(token, getCount); }

// Terminals bubble: how many terminals are cleanable (not actively running).
registerBadgeProvider(TERMINALS_TOKEN, () => listTerminalsData().filter(t => t.state !== 'busy').length);

async function handleBridge(context, payload) {
  if (!payload || typeof payload !== 'object') return;
  if (payload.op === 'set' && Array.isArray(payload.memos)) {
    saveMemos(context, sanitizeMemos(payload.memos));
  } else if (payload.op === 'copy' && typeof payload.text === 'string') {
    vscode.env.clipboard.writeText(payload.text).then(undefined, () => { /* ignore */ });
  } else if (payload.op === 'runCommands' && Array.isArray(payload.commands)) {
    runFocusCommands(payload.commands);
  } else if (payload.op === 'listMemory') {
    const scopes = [];
    const userDir = memoryUserDir(context);
    const userFiles = listMdFiles(userDir);
    if (userFiles.length) scopes.push({ id: 'user', label: '用户记忆', files: userFiles });
    const wsDir = memoryWorkspaceDir(context);
    if (wsDir) {
      const repoFiles = listMdFiles(path.join(wsDir, 'repo'));
      if (repoFiles.length) scopes.push({ id: 'repo', label: '项目记忆', files: repoFiles });
      const sessionDir = currentSessionDir(wsDir);
      const sessionFiles = sessionDir ? listMdFiles(sessionDir) : [];
      if (sessionFiles.length) scopes.push({ id: 'session', label: '会话记忆', files: sessionFiles });
    }
    return { scopes };
  } else if (payload.op === 'openMemory' && typeof payload.path === 'string') {
    const norm = path.normalize(payload.path);
    const allowed = [memoryUserDir(context), memoryWorkspaceDir(context)].filter(Boolean).map(d => path.normalize(d));
    if (allowed.some(d => norm.startsWith(d + path.sep) || norm === d)) {
      vscode.workspace.openTextDocument(vscode.Uri.file(norm)).then(
        doc => vscode.window.showTextDocument(doc),
        () => { /* ignore */ }
      );
    }
  } else if (payload.op === 'listTerminals') {
    return { terminals: listTerminalsData() };
  } else if (payload.op === 'badgeCounts') {
    const counts = {};
    for (const [token, getCount] of badgeProviders) {
      try { counts[token] = getCount(context) | 0; } catch { counts[token] = 0; }
    }
    return { counts };
  } else if (payload.op === 'cleanupTerminals') {
    // Dispose every terminal that is NOT actively executing a command (idle or
    // already exited), then let the array settle before re-reading so the
    // freshly recomputed indices match the live state.
    vscode.window.terminals.forEach(t => { if (!busyTerminals.has(t)) { try { t.dispose(); } catch { /* ignore */ } } });
    await new Promise(r => setTimeout(r, 80));
    return { terminals: listTerminalsData() };
  } else if (payload.op === 'showTerminal' && typeof payload.index === 'number') {
    const t = vscode.window.terminals[payload.index];
    if (t) { try { t.show(); } catch { /* ignore */ } }
  }
}

/** How long a registered bridge entry stays valid without a heartbeat. */
const BRIDGE_TTL_MS = 5 * 60 * 1000;

/** Loopback port range the shared cross-window directory service binds within. */
const DIRECTORY_PORT_BASE = 49500;
const DIRECTORY_PORT_SPAN = 2000;

/**
 * The match string baked into this window's bridge endpoint. It must appear in
 * the workbench window title (which includes the workspace/root name) so the
 * shared injection script can tell which endpoint belongs to which window.
 * @returns {string}
 */
function bridgeWindowName() {
  return vscode.workspace.name || ('window-' + bridgeId);
}

/**
 * Path to the cross-window bridge registry in (shared) global storage.
 * @param {vscode.ExtensionContext} context
 * @returns {string}
 */
function bridgesRegistryPath(context) {
  return path.join(context.globalStorageUri.fsPath, 'bridges.json');
}

/**
 * Read the bridge registry object: `{ [id]: { port, name, ts } }`.
 * @param {vscode.ExtensionContext} context
 * @returns {Record<string, {port:number, name:string, ts:number}>}
 */
function readBridges(context) {
  const obj = readConfigFile(bridgesRegistryPath(context));
  return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
}

/**
 * Persist the bridge registry object.
 * @param {vscode.ExtensionContext} context
 * @param {object} obj
 */
function writeBridges(context, obj) {
  try {
    fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
    fs.writeFileSync(bridgesRegistryPath(context), JSON.stringify(obj), 'utf8');
  } catch { /* ignore */ }
}

/**
 * Drop entries whose heartbeat has gone stale (a closed window that didn't get
 * to unregister, or a crashed host).
 * @param {object} obj
 * @returns {object}
 */
function pruneBridges(obj) {
  const cutoff = Date.now() - BRIDGE_TTL_MS;
  const out = {};
  for (const id of Object.keys(obj)) {
    const e = obj[id];
    if (e && typeof e.port === 'number' && typeof e.ts === 'number' && e.ts >= cutoff) out[id] = e;
  }
  return out;
}

/**
 * Record/refresh this window's bridge in the shared registry.
 * @param {vscode.ExtensionContext} context
 */
function registerBridge(context) {
  if (!bridgePort) return;
  const obj = pruneBridges(readBridges(context));
  obj[bridgeId] = { port: bridgePort, name: bridgeName, ts: Date.now() };
  writeBridges(context, obj);
}

/**
 * Remove this window's bridge from the shared registry.
 * @param {vscode.ExtensionContext} context
 */
function unregisterBridge(context) {
  const obj = pruneBridges(readBridges(context));
  delete obj[bridgeId];
  writeBridges(context, obj);
}

/**
 * The active bridge endpoints to bake into the shared injection script. Always
 * includes this window so its own script can reach it immediately.
 * @param {vscode.ExtensionContext} context
 * @returns {{port:number, name:string}[]}
 */
function activeBridgeEndpoints(context) {
  const obj = pruneBridges(readBridges(context));
  if (bridgePort) obj[bridgeId] = { port: bridgePort, name: bridgeName, ts: Date.now() };
  return Object.keys(obj).map((id) => ({ port: obj[id].port, name: obj[id].name }));
}

/**
 * Set CORS, parse the request URL, and check the shared token. Returns the URL,
 * or null after writing the error response (the caller should then stop).
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {URL|null}
 */
function bridgeGuard(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); res.end(); return null; }
  if (url.searchParams.get('token') !== bridgeToken) { res.writeHead(403); res.end(); return null; }
  return url;
}

/**
 * Start a loopback HTTP bridge so the injected chat-row script (which has no
 * Node and no access to the extension host) can trigger extension commands via
 * fetch. Bound to 127.0.0.1 and gated by a token. Every window runs its own
 * bridge on a fresh ephemeral port and registers it (with a title-match name)
 * in a shared registry, so the injected script routes to the right window.
 * @param {vscode.ExtensionContext} context
 */
function startBridge(context) {
  const http = require('http');
  const crypto = require('crypto');
  bridgeToken = context.globalState.get('cpxBridgeToken') || crypto.randomBytes(16).toString('hex');
  context.globalState.update('cpxBridgeToken', bridgeToken);
  bridgeId = crypto.randomBytes(8).toString('hex');
  bridgeName = bridgeWindowName();
  bridgeDirectoryPort = Number(context.globalState.get('cpxDirectoryPort')) || (DIRECTORY_PORT_BASE + Math.floor(Math.random() * DIRECTORY_PORT_SPAN));
  context.globalState.update('cpxDirectoryPort', bridgeDirectoryPort);

  const server = http.createServer((req, res) => {
    if (!bridgeGuard(req, res)) return;

    // Memo writes arrive as a POST with a text/plain JSON body (a CORS-simple
    // request, so no preflight) from the in-DOM manager.
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body || '{}'); } catch { res.writeHead(400); res.end(); return; }
        Promise.resolve(handleBridge(context, parsed)).then((result) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result != null ? result : { ok: true }));
        }).catch(() => { res.writeHead(400); res.end(); });
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  server.on('error', () => { /* an ephemeral (port 0) bind shouldn't collide; ignore */ });
  server.on('listening', () => {
    const addr = server.address();
    bridgePort = addr && typeof addr === 'object' ? addr.port : 0;
    try { registerBridge(context); } catch { /* ignore */ }
    try { writeInjection(context); } catch { /* ignore */ }
  });
  // Always take a fresh ephemeral port: every window runs its own bridge, so a
  // shared/persisted port would make windows answer each other's requests.
  try { server.listen(0, '127.0.0.1'); } catch { /* ignore */ }
  const heartbeat = setInterval(() => { try { registerBridge(context); } catch { /* ignore */ } }, 60000);
  context.subscriptions.push({ dispose: () => {
    clearInterval(heartbeat);
    try { unregisterBridge(context); } catch { /* ignore */ }
    try { server.close(); } catch { /* ignore */ }
  } });
  startDirectory(context);
}

/**
 * Hold (or fail over to) a fixed-port directory service that hands the live
 * bridge registry to injected scripts. Only one window binds the port at a
 * time; the others keep retrying so the directory survives the holder closing.
 * Because the list is read fresh from the shared registry on every request,
 * injected scripts always get each window's CURRENT port.
 * @param {vscode.ExtensionContext} context
 */
function startDirectory(context) {
  const http = require('http');
  const tryBind = () => {
    if (directoryServer) return;
    const srv = http.createServer((req, res) => {
      if (!bridgeGuard(req, res)) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(activeBridgeEndpoints(context)));
    });
    srv.on('error', () => { try { srv.close(); } catch { /* ignore */ } });
    srv.on('listening', () => { directoryServer = srv; });
    try { srv.listen(bridgeDirectoryPort, '127.0.0.1'); } catch { /* ignore */ }
  };
  tryBind();
  const timer = setInterval(tryBind, 5000);
  context.subscriptions.push({ dispose: () => {
    clearInterval(timer);
    if (directoryServer) { try { directoryServer.close(); } catch { /* ignore */ } directoryServer = null; }
  } });
}

/**
 * The VS Code user prompts folder, derived from globalStorageUri:
 *   <userData>/User/globalStorage/<ext-id>  →  <userData>/User/prompts
 * @param {vscode.ExtensionContext} context
 * @returns {string}
 */
function userPromptsDir(context) {
  return path.join(path.dirname(path.dirname(context.globalStorageUri.fsPath)), 'prompts');
}

/**
 * Install the prompt files bundled with the extension into the user prompts
 * folder, so the slash commands ship with the extension (no external script).
 * Writes only when missing or changed, so it self-updates on extension upgrade
 * without clobbering identical files on every activation.
 * @param {vscode.ExtensionContext} context
 */
function installPrompts(context) {
  const src = path.join(context.extensionPath, 'prompts');
  let files;
  try { files = fs.readdirSync(src).filter((f) => f.endsWith('.prompt.md')); }
  catch { return; }
  if (!files.length) return;
  const dst = userPromptsDir(context);
  try { fs.mkdirSync(dst, { recursive: true }); } catch { /* ignore */ }
  for (const f of files) {
    try {
      const data = fs.readFileSync(path.join(src, f));
      const to = path.join(dst, f);
      let cur = null;
      try { cur = fs.readFileSync(to); } catch { /* missing */ }
      if (!cur || !cur.equals(data)) fs.writeFileSync(to, data);
    } catch { /* ignore individual failures */ }
  }
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const provider = new PanelViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('copilotExtension.panel', provider)
  );

  // Install the bundled prompt files and keep the injection script current. The
  // bundled commands.json drives the buttons directly; a user override is only
  // created on demand via "编辑配置".
  installPrompts(context);
  // One-time cleanup: older versions auto-seeded a globalStorage copy of the
  // config that would now shadow the bundled default. Move it aside once (rename,
  // not delete, so any hand-edits stay recoverable) so the bundled config drives
  // by default; users opt into a fresh override via "编辑配置".
  if (!context.globalState.get('cpxConfigMigrated')) {
    try { fs.renameSync(configPath(context), configPath(context) + '.bak'); } catch { /* nothing to move */ }
    context.globalState.update('cpxConfigMigrated', true);
  }
  ensureMemos(context);
  startBridge(context);
  try { writeInjection(context); } catch { /* ignore */ }

  // Track which terminals are actively running a command via shell integration,
  // so the terminal viewer can tell "busy" apart from "idle at a prompt". These
  // events exist on recent VS Code; guard so older hosts still load.
  if (typeof vscode.window.onDidStartTerminalShellExecution === 'function') {
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution(e => { if (e && e.terminal) busyTerminals.add(e.terminal); }),
      vscode.window.onDidEndTerminalShellExecution(e => { if (e && e.terminal) busyTerminals.delete(e.terminal); })
    );
  }
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(t => busyTerminals.delete(t))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotExtension.restoreDefault', async () => {
      try {
        clearInjection(context);
      } catch (e) {
        vscode.window.showErrorMessage('Copilot Extension: 清空命令失败 — ' + String(e));
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
    vscode.commands.registerCommand('copilotExtension.enableInjection', () => enableInjection(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotExtension.editConfig', () => editConfig(context))
  );

  // Regenerate the injection script when the JSON config or memos change.
  try {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(path.dirname(configPath(context))), '{commands,memos}.json')
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
