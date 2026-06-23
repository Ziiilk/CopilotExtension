const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ text: string, label: string, icon: string, submit: string, description: string, newRow: boolean }} MacroButton
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
 * The default config seeded into globalStorage when none exists yet. Read from
 * the `commands.json` bundled inside the extension (so the defaults are shipped
 * with the extension, not hard-coded here). Falls back to an empty list.
 * @param {vscode.ExtensionContext} context
 * @returns {{ commands: object[] }}
 */
function defaultConfig(context) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(context.extensionPath, 'commands.json'), 'utf8'));
    if (data && Array.isArray(data.commands)) return data;
  } catch { /* missing or invalid — fall back to empty */ }
  return { commands: [] };
}

/**
 * Ensure the config file exists, seeding it with the bundled defaults on first run.
 * @param {vscode.ExtensionContext} context
 * @returns {string} the config path
 */
function ensureConfig(context) {
  const p = configPath(context);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Write only if absent (atomic 'wx'); EEXIST is the expected no-op case.
    fs.writeFileSync(p, JSON.stringify(defaultConfig(context), null, 2) + '\n', { flag: 'wx' });
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
  // `commands` may be a flat list of buttons, or a list of rows (each row an
  // array of buttons). Nested arrays define the layout: every row after the
  // first starts on a new line. A flat list still honors per-button newRow.
  list.forEach((group, rowIdx) => {
    const isRow = Array.isArray(group);
    const buttons = isRow ? group : [group];
    buttons.forEach((c, btnIdx) => {
      if (!c) return;
      // A macro is just the text to insert; a slash command is text starting '/'.
      const text = typeof c.text === 'string' ? c.text : '';
      if (!text.trim() || byKey.has(text)) return;
      byKey.set(text, {
        text,
        label: typeof c.label === 'string' && c.label ? c.label : text.trim().slice(0, 24),
        icon: typeof c.icon === 'string' ? c.icon.replace(/[^a-z0-9-]/gi, '') : '',
        submit: String(c.submit || 'send').toLowerCase() === 'type' ? 'type' : 'send',
        description: typeof c.description === 'string' ? c.description : '',
        // A nested row breaks the line at its first button (except the first row);
        // a flat entry honors its explicit newRow/break flag.
        newRow: isRow ? (btnIdx === 0 && rowIdx > 0) : !!(c.newRow || c.break)
      });
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
  const bridgePortLit = Number(bridge && bridge.port) || 0;
  const bridgeTokenLit = JSON.stringify((bridge && bridge.token) || '');
  return `// AUTO-GENERATED by Copilot Extension. Do not edit; use the \"应用配置\" button instead.
(function () {
  'use strict';
  var BUTTONS = ${data};
  var MEMOS = ${memoData};
  var MEMO_TOKEN = ${JSON.stringify(MEMO_TOKEN)};
  var MEMORY_TOKEN = ${JSON.stringify(MEMORY_TOKEN)};
  var BRIDGE_PORT = ${bridgePortLit};
  var BRIDGE_TOKEN = ${bridgeTokenLit};
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
      // Our hover isn't sized by VS Code's hover service, so the absolute
      // .monaco-hover would shrink-to-min (a tall narrow column). max-content
      // makes it hug the text and wrap at the reused .hover-contents max-width.
      '.cpx-hover .monaco-hover{width:max-content}' +
      // The filled-state glyph is a custom inline SVG (not a codicon), so size
      // it to the 16px title-bar codicons and let it inherit currentColor.
      '.cpx-focus-on{display:flex;align-items:center;justify-content:center}' +
      '.cpx-focus-on>svg{width:16px;height:16px;display:block}';
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

  // POST a payload to the loopback bridge. When cb is given, the JSON response
  // is parsed and passed to it (null on failure); otherwise it's fire-and-forget.
  function bridgeRequest(payload, cb) {
    if (!BRIDGE_PORT) { if (cb) cb(null); return; }
    try {
      var p = fetch('http://127.0.0.1:' + BRIDGE_PORT + '/?token=' + encodeURIComponent(BRIDGE_TOKEN), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });
      if (cb) p.then(function (r) { return r.json(); }).then(cb).catch(function () { cb(null); });
      else p.catch(function () {});
    } catch (e) { if (cb) cb(null); }
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
  function hoverBg(el, varName) {
    el.addEventListener('mouseenter', function () { el.style.background = 'var(' + varName + ')'; });
    el.addEventListener('mouseleave', function () { el.style.background = 'transparent'; });
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
    var inCss = 'width:100%;box-sizing:border-box;margin-bottom:8px;padding:5px 7px;font-family:inherit;font-size:13px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border, transparent);border-radius:2px';
    var flabel = mkEl('input', inCss);
    flabel.placeholder = '名称（可留空，默认取内容前若干字）';
    var ftext = mkEl('textarea', inCss + ';resize:vertical');
    ftext.rows = 5;
    ftext.placeholder = '内容';
    var fbtns = mkEl('div', 'text-align:right');
    var cancelBtn = memoBtn('取消', false);
    var saveBtn = memoBtn('保存', true);
    cancelBtn.style.marginLeft = '6px';
    saveBtn.style.marginLeft = '6px';
    fbtns.appendChild(cancelBtn);
    fbtns.appendChild(saveBtn);
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

  // Build the row by REPLICATING the native pill structure and class names, so
  // the workbench's own stylesheet rules style it (font, padding, icon size,
  // color, separators, gap, spacing …). Nothing is hard-coded; if VS Code
  // changes those numbers in a future version our buttons follow automatically.
  // The OUTER .chat-input-toolbars wrapper is required so the rules scoped to
  // that plural container (icon 12px, icon color, actions gap, row margin) match.
  //   .chat-input-toolbars > .chat-input-toolbar > .monaco-action-bar
  //     > ul.actions-container > li.action-item.chat-input-picker-item
  //       > a.action-label > span.codicon.codicon-<x> + span.chat-input-picker-label
  // Build one native action item (li > a) for a button.
  function buildButtonItem(b) {
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
    a.addEventListener('click', function () {
      hideHover();
      if (b.text === MEMO_TOKEN) { triggerMemo(a); return; }
      if (b.text === MEMORY_TOKEN) { triggerMemory(); return; }
      submit(b.text, a, b.submit);
    });
    li.appendChild(a);
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
  var cpxFocusLabel = null;

  function wbHas(cls) {
    var e = document.querySelector('.monaco-workbench');
    return !!(e && e.classList.contains(cls));
  }

  // Filled-state glyph: the codicon-layout-centered shape but with its centre
  // column hollow instead of solid (the even-odd fill rule punches the hole).
  // Inlined because the codicon font has no hollow-centre variant.
  var CPX_FOCUS_ICON =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M3.5 1H12.5C13.879 1 15 2.121 15 3.5V12.5C15 13.879 13.879 15 12.5 15H3.5C2.121 15 1 13.879 1 12.5V3.5C1 2.121 2.121 1 3.5 1ZM2 3.5V12.5C2 13.327 2.673 14 3.5 14H6V2H3.5C2.673 2 2 2.673 2 3.5ZM12.5 14C13.327 14 14 13.327 14 12.5V3.5C14 2.673 13.327 2 12.5 2H10V14H12.5ZM7 2H9V14H7V2Z"/>' +
    '</svg>';

  function setFocusIcon() {
    if (!cpxFocusLabel) return;
    // Two glyphs: the native centred-layout codicon when off, our own
    // hollow-centre SVG when filled. The pressed state is the native checked
    // highlight. Guard the write so the per-tick re-sync from the poll loop is
    // a no-op.
    if (cpxFocusState) {
      var on = 'action-label cpx-focus-on checked';
      if (cpxFocusLabel.className !== on) {
        cpxFocusLabel.className = on;
        cpxFocusLabel.innerHTML = CPX_FOCUS_ICON;
      }
    } else {
      var off = 'action-label codicon codicon-layout-centered';
      if (cpxFocusLabel.className !== off) {
        cpxFocusLabel.className = off;
        cpxFocusLabel.innerHTML = '';
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

  function ensureEditorToggle() {
    if (document.querySelector('.cpx-focus-item')) {
      var ex = document.querySelector('.cpx-focus-item .action-label');
      if (ex) { cpxFocusLabel = ex; setFocusIcon(); }
      return true;
    }
    // Anchor on the primary-sidebar toggle (aria-label text or its codicon).
    var anchor = null;
    var items = document.querySelectorAll('.titlebar-right .action-label, .action-toolbar-container .action-label');
    for (var i = 0; i < items.length; i++) {
      var al = items[i].getAttribute('aria-label') || '';
      if (al.indexOf('主侧栏') !== -1 || al.indexOf('Primary Side Bar') !== -1 || /\bcodicon-panel-left\b/.test(items[i].className)) { anchor = items[i]; break; }
    }
    if (!anchor) return false;
    var li = anchor.closest ? anchor.closest('.action-item') : null;
    if (!li || !li.parentNode) return false;
    // Build our own action item right after the sidebar toggle. It is not
    // registered with the native ActionBar, so the ActionBar attaches no click
    // handler to it and it cannot misfire a native action. The toolbar may
    // re-render and drop it; the schedule/poll loop re-inserts it and restores
    // the checked state from cpxFocusState.
    var newLi = mkEl('li', ''); newLi.className = 'action-item cpx-focus-item';
    newLi.setAttribute('role', 'presentation');
    var a = mkEl('a', '');
    a.setAttribute('role', 'button'); a.setAttribute('tabindex', '0');
    a.setAttribute('aria-label', '聊天专注（铺满/还原）'); a.title = '聊天专注（铺满/还原）';
    a.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
    a.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleChatFocus(); });
    newLi.appendChild(a);
    cpxFocusLabel = a;
    setFocusIcon();
    li.parentNode.insertBefore(newLi, li.nextSibling);
    return true;
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
      try { ensureEditorToggle(); } catch (e) {}
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
      var tog = false;
      try { tog = ensureEditorToggle(); } catch (e) {}
      if ((done && tog) || ++ticks > 120) clearInterval(iv); // ~60s safety net
    }, 500);
    try { ensureRow(); } catch (e) {}
    try { ensureEditorToggle(); } catch (e) {}
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
  const next = buildInjectionScript(loadButtons(context), loadMemos(context), { port: bridgePort, token: bridgeToken });
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
 * Open the JSON command config in an editor, seeding defaults if missing.
 * @param {vscode.ExtensionContext} context
 */
async function editConfig(context) {
  const p = ensureConfig(context);
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
    await vscode.window.showTextDocument(doc);
  } catch (e) {
    vscode.window.showErrorMessage('Copilot Extension: 打开配置失败 — ' + String(e));
  }
}

/** Special macro token (a commands.json `text`) that opens the memo manager. */
const MEMO_TOKEN = '#tool:copilot-extension/memo';

/** Special macro token that opens the memory viewer. */
const MEMORY_TOKEN = '#tool:copilot-extension/memory';

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
 * Apply an operation sent by the injected script over the bridge. Memo ops:
 * `op:'set'` replaces the whole list (sanitized), `op:'copy'` copies text to the
 * clipboard.
 * @param {vscode.ExtensionContext} context
 * @param {{op?: string, memos?: any[], text?: string}} payload
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

function handleBridge(context, payload) {
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
      const sessionFiles = listMdFiles(path.join(wsDir, 'session'));
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
  }
}

/**
 * Start a loopback HTTP bridge so the injected chat-row script (which has no
 * Node and no access to the extension host) can trigger extension commands via
 * fetch. Bound to 127.0.0.1 and gated by a random token embedded into the
 * injection. The port is persisted and reused across reloads so an already-
 * inlined script keeps working; when it is taken we fall back to a random port.
 * @param {vscode.ExtensionContext} context
 */
function startBridge(context) {
  const http = require('http');
  const crypto = require('crypto');
  bridgeToken = context.globalState.get('cpxBridgeToken') || crypto.randomBytes(16).toString('hex');
  context.globalState.update('cpxBridgeToken', bridgeToken);
  const savedPort = Number(context.globalState.get('cpxBridgePort')) || 0;

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); res.end(); return; }
    if (url.searchParams.get('token') !== bridgeToken) { res.writeHead(403); res.end(); return; }

    // Memo writes arrive as a POST with a text/plain JSON body (a CORS-simple
    // request, so no preflight) from the in-DOM manager.
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const result = handleBridge(context, JSON.parse(body || '{}'));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result != null ? result : { ok: true }));
        }
        catch { res.writeHead(400); res.end(); }
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE' && savedPort) { try { server.listen(0, '127.0.0.1'); } catch { /* ignore */ } }
  });
  server.on('listening', () => {
    const addr = server.address();
    bridgePort = addr && typeof addr === 'object' ? addr.port : 0;
    context.globalState.update('cpxBridgePort', bridgePort);
    try { writeInjection(context); } catch { /* ignore */ }
  });
  try { server.listen(savedPort, '127.0.0.1'); } catch { /* ignore */ }
  context.subscriptions.push({ dispose: () => { try { server.close(); } catch { /* ignore */ } } });
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

  // Install the bundled prompt files, then seed the JSON config on first run and
  // keep the injection script current.
  installPrompts(context);
  ensureConfig(context);
  ensureMemos(context);
  startBridge(context);
  try { writeInjection(context); } catch { /* ignore */ }

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
