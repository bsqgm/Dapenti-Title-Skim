// ==UserScript==
// @name         Dapenti more.asp title skim
// @namespace    https://github.com/greasemonkey
// @version      1.1.1
// @description  Extract numbered item titles (【n】...) from dapenti blog more.asp pages for quick daily skim
// @author       you
// @match        *://www.dapenti.com/blog/more.asp*
// @match        *://dapenti.com/blog/more.asp*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'dapenti-title-skim-panel';
  const STORAGE_KEY = 'dapenti-title-skim-settings-v1';
  const ITEM_RE = /【\s*(\d+)\s*】\s*([^\n【]+)/g;

  const BLOCK_TAGS = new Set([
    'P',
    'DIV',
    'TD',
    'CENTER',
    'BLOCKQUOTE',
    'LI',
    'SECTION',
    'ARTICLE',
    'TABLE',
  ]);

  function parseSettingsBlob(raw) {
    if (raw == null || raw === '') return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
    if (typeof raw !== 'string') return {};
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }

  function loadSettings() {
    let raw = null;
    if (typeof GM_getValue === 'function') {
      try {
        raw = GM_getValue(STORAGE_KEY, null);
      } catch {
        raw = null;
      }
    }
    if (raw == null) {
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch {
        raw = null;
      }
    }
    return parseSettingsBlob(raw);
  }

  function saveSettings(partial) {
    const cur = loadSettings();
    Object.assign(cur, partial);
    const str = JSON.stringify(cur);
    if (typeof GM_setValue === 'function') {
      try {
        GM_setValue(STORAGE_KEY, str);
      } catch {
        /* ignore */
      }
    }
    try {
      localStorage.setItem(STORAGE_KEY, str);
    } catch {
      /* ignore */
    }
  }

  function collectFromText(text) {
    const items = [];
    let m;
    const re = new RegExp(ITEM_RE.source, 'g');
    while ((m = re.exec(text)) !== null) {
      const num = parseInt(m[1], 10);
      const title = (m[2] || '').replace(/\s+/g, ' ').trim();
      if (!Number.isFinite(num) || num < 1 || num > 999 || !title) continue;
      items.push({ num, title });
    }
    return items;
  }

  function dedupeByNum(items) {
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.num)) map.set(it.num, it.title);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([num, title]) => ({ num, title }));
  }

  function extractItems() {
    const bodyText = document.body ? document.body.innerText : '';
    let items = collectFromText(bodyText);

    if (items.length < 3) {
      const article =
        document.querySelector('[id*="content" i], [class*="content" i], td[width="760"], .oblog_text, #oblog_body') ||
        document.querySelector('table table td') ||
        document.body;
      if (article && article !== document.body) {
        items = collectFromText(article.innerText || '');
      }
    }

    return dedupeByNum(items);
  }

  function buildPlainList(items) {
    return items.map((it) => `【${it.num}】${it.title}`).join('\n');
  }

  function findScrollTarget(num, panelEl) {
    const needle = `【${num}】`;
    const needleLoose = new RegExp(`【\\s*${num}\\s*】`);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (panelEl && panelEl.contains(node)) return NodeFilter.FILTER_REJECT;
        const t = node.textContent;
        if (!t) return NodeFilter.FILTER_SKIP;
        if (t.includes(needle) || needleLoose.test(t)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      },
    });

    let node = walker.nextNode();
    if (!node) return null;

    let el = node.parentElement;
    while (el && el !== document.body) {
      if (BLOCK_TAGS.has(el.tagName)) return el;
      el = el.parentElement;
    }
    return node.parentElement;
  }

  function flashTarget(el) {
    if (!el) return;
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = '3px solid rgba(59, 130, 246, 0.85)';
    el.style.outlineOffset = '2px';
    window.setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.outlineOffset = prevOffset;
    }, 1600);
  }

  function removePanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) snapshotPanelToStorage();
    if (el && typeof el._dapentiCleanup === 'function') el._dapentiCleanup();
    if (el) el.remove();
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function readFontPxFromPanel(el) {
    if (!el) return null;
    const inline = parseFloat(el.style.fontSize);
    if (Number.isFinite(inline)) return clamp(inline, 10, 28);
    const px = parseFloat(getComputedStyle(el).fontSize);
    return Number.isFinite(px) ? clamp(px, 10, 28) : null;
  }

  /** Persist current panel box + font (close / leave page / after drag-resize). */
  function snapshotPanelToStorage() {
    const el = document.getElementById(PANEL_ID);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const payload = {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
    const fp = readFontPxFromPanel(el);
    if (fp != null) payload.fontPx = fp;
    saveSettings(payload);
  }

  function showPanel(items) {
    removePanel();

    const settings = loadSettings();
    const fontPx = clamp(Number(settings.fontPx) || 14, 10, 28);
    const width = clamp(Number(settings.width) || 420, 260, Math.max(280, window.innerWidth - 16));
    const height = clamp(Number(settings.height) || Math.min(Math.round(window.innerHeight * 0.72), 520), 160, Math.max(200, window.innerHeight - 16));
    let left =
      typeof settings.left === 'number'
        ? settings.left
        : Math.round(window.innerWidth - width - 12);
    let top = typeof settings.top === 'number' ? settings.top : 12;
    left = clamp(left, 0, Math.max(0, window.innerWidth - 80));
    top = clamp(top, 0, Math.max(0, window.innerHeight - 80));

    const wrap = document.createElement('div');
    wrap.id = PANEL_ID;
    wrap.style.cssText = [
      'position:fixed',
      `left:${left}px`,
      `top:${top}px`,
      `width:${width}px`,
      `height:${height}px`,
      'z-index:2147483646',
      'box-sizing:border-box',
      `font:${fontPx}px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif`,
      'color:#111',
      'background:rgba(255,255,255,0.96)',
      'border:1px solid #ccc',
      'border-radius:10px',
      'box-shadow:0 8px 28px rgba(0,0,0,0.18)',
      'padding:10px 10px 14px',
      'overflow:hidden',
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'min-width:260px',
      'min-height:160px',
    ].join(';');

    const ac = new AbortController();
    const sig = ac.signal;

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-shrink:0;cursor:move;user-select:none;';
    const titleCol = document.createElement('div');
    titleCol.style.cssText = 'flex:1;min-width:0;';
    const title = document.createElement('div');
    title.textContent = `Titles (${items.length})`;
    title.style.cssText = `font-weight:600;font-size:${Math.round(fontPx * 1.08)}px;`;
    titleCol.appendChild(title);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;cursor:default;user-select:none;';

    function mkBtn(label) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText =
        'cursor:pointer;padding:3px 8px;border:1px solid #bbb;border-radius:6px;background:#f4f4f4;font-size:12px;user-select:none;';
      return b;
    }

    const fontMinus = mkBtn('A−');
    const fontPlus = mkBtn('A+');
    const copyBtn = mkBtn('Copy');
    const refreshBtn = mkBtn('Refresh');
    const closeBtn = mkBtn('Close');

    let currentFontPx = fontPx;

    function applyFont(nextPx) {
      currentFontPx = clamp(nextPx, 10, 28);
      wrap.style.fontSize = `${currentFontPx}px`;
      title.style.fontSize = `${Math.round(currentFontPx * 1.08)}px`;
      list.style.fontSize = `${currentFontPx}px`;
      hint.style.fontSize = `${Math.max(10, Math.round(currentFontPx * 0.78))}px`;
      saveSettings({ fontPx: currentFontPx });
    }

    fontMinus.addEventListener(
      'click',
      () => applyFont(currentFontPx - 1),
      { signal: sig },
    );
    fontPlus.addEventListener(
      'click',
      () => applyFont(currentFontPx + 1),
      { signal: sig },
    );

    copyBtn.addEventListener(
      'click',
      () => {
        const text = buildPlainList(items);
        if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(text, 'text');
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(() => window.prompt('Copy:', text));
        } else {
          window.prompt('Copy:', text);
        }
      },
      { signal: sig },
    );

    closeBtn.addEventListener('click', () => removePanel(), { signal: sig });
    refreshBtn.addEventListener('click', () => showPanel(extractItems()), { signal: sig });

    btnRow.append(fontMinus, fontPlus, copyBtn, refreshBtn, closeBtn);
    header.append(titleCol, btnRow);

    const list = document.createElement('ol');
    list.style.cssText =
      'margin:0;padding:0 0 0 1.2em;overflow:auto;flex:1;min-height:0;cursor:default;user-select:text;';
    list.style.fontSize = `${fontPx}px`;

    for (const it of items) {
      const li = document.createElement('li');
      li.style.cssText =
        'margin:5px 0;padding:4px 6px;border-radius:6px;cursor:pointer;user-select:text;';
      li.title = 'Click to scroll to this item on the page';
      li.addEventListener(
        'mouseenter',
        () => {
          li.style.background = 'rgba(0,0,0,0.06)';
        },
        { signal: sig },
      );
      li.addEventListener(
        'mouseleave',
        () => {
          li.style.background = '';
        },
        { signal: sig },
      );
      li.addEventListener(
        'click',
        (e) => {
          if (e.target.closest('button')) return;
          const target = findScrollTarget(it.num, wrap);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            flashTarget(target);
          }
        },
        { signal: sig },
      );

      const strong = document.createElement('strong');
      strong.textContent = `【${it.num}】`;
      strong.style.cssText = 'font-weight:600;margin-right:4px;';
      const span = document.createElement('span');
      span.textContent = it.title;
      li.append(strong, span);
      list.appendChild(li);
    }

    const hint = document.createElement('div');
    hint.style.cssText = `font-size:${Math.max(10, Math.round(fontPx * 0.78))}px;color:#666;flex-shrink:0;user-select:none;`;
    hint.textContent =
      'Alt+Shift+D: toggle · Drag title bar · Resize corner · A±: font · Layout & font auto-saved';

    const resizeHandle = document.createElement('div');
    resizeHandle.setAttribute('aria-hidden', 'true');
    resizeHandle.style.cssText =
      'position:absolute;right:2px;bottom:2px;width:18px;height:18px;cursor:nwse-resize;opacity:0.45;background:linear-gradient(135deg,transparent 50%,#888 50%,#888 55%,transparent 55%,transparent 60%,#888 60%,#888 65%,transparent 65%);border-radius:0 0 8px 0;';

    wrap.style.position = 'fixed';
    wrap.append(header, list, hint, resizeHandle);
    document.documentElement.appendChild(wrap);

    let drag = null;
    header.addEventListener(
      'mousedown',
      (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button')) return;
        const r = wrap.getBoundingClientRect();
        drag = { type: 'move', sx: e.clientX, sy: e.clientY, sl: r.left, st: r.top, sw: r.width, sh: r.height };
        e.preventDefault();
      },
      { signal: sig },
    );

    let resize = null;
    resizeHandle.addEventListener(
      'mousedown',
      (e) => {
        if (e.button !== 0) return;
        const r = wrap.getBoundingClientRect();
        resize = { sx: e.clientX, sy: e.clientY, sw: r.width, sh: r.height };
        e.preventDefault();
        e.stopPropagation();
      },
      { signal: sig },
    );

    window.addEventListener(
      'mousemove',
      (e) => {
        if (drag && drag.type === 'move') {
          const dx = e.clientX - drag.sx;
          const dy = e.clientY - drag.sy;
          let nl = drag.sl + dx;
          let nt = drag.st + dy;
          nl = clamp(nl, 0, window.innerWidth - 60);
          nt = clamp(nt, 0, window.innerHeight - 60);
          wrap.style.left = `${Math.round(nl)}px`;
          wrap.style.top = `${Math.round(nt)}px`;
          wrap.style.right = '';
          wrap.style.bottom = '';
        }
        if (resize) {
          const dx = e.clientX - resize.sx;
          const dy = e.clientY - resize.sy;
          const nw = clamp(resize.sw + dx, 260, window.innerWidth - 8);
          const nh = clamp(resize.sh + dy, 160, window.innerHeight - 8);
          wrap.style.width = `${Math.round(nw)}px`;
          wrap.style.height = `${Math.round(nh)}px`;
        }
      },
      { signal: sig },
    );

    function onPointerEnd() {
      if (drag || resize) snapshotPanelToStorage();
      drag = null;
      resize = null;
    }
    document.addEventListener('mouseup', onPointerEnd, { capture: true, signal: sig });
    document.addEventListener('touchend', onPointerEnd, { capture: true, signal: sig });

    wrap._dapentiCleanup = () => ac.abort();
  }

  function toggle() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      removePanel();
      return;
    }
    showPanel(extractItems());
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      toggle();
    }
  });

  window.addEventListener('pagehide', () => snapshotPanelToStorage(), { capture: true });

  showPanel(extractItems());
})();
