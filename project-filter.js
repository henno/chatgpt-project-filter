// Live project filter for the ChatGPT/Codex desktop sidebar.
// Injected into the renderer by inject.mjs (CDP); safe to evaluate more than once.
(function init() {
  if (window.__projectFilter) return;
  // Runs before the document exists when injected on new documents; wait for <head>/<body>.
  if (!document.head || !document.body) {
    document.addEventListener('DOMContentLoaded', init, { once: true });
    return;
  }

  const FOCUS_SHORTCUT = { code: 'KeyP', metaKey: true, altKey: true }; // Cmd+Option+P
  // The attribute also sits on drag-and-drop helpers; real project rows are the aria-labelled listitems.
  const PROJECT_SEL = '[role="listitem"][data-sidebar-project-container-id][aria-label]';
  const HIDE_ATTR = 'data-pf-hidden';

  // Lowercase + strip diacritics so "tahvli" also finds "tähvli".
  const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  let query = '';
  // The app mounts one sidebar per mode (Codex / ChatGPT), each with its own Projects section;
  // every section gets its own filter bar, all sharing the same query.
  const allBars = () => [...document.querySelectorAll('.pf-bar')];
  const visibleBar = () => allBars().find((b) => b.getBoundingClientRect().width > 0);

  const style = document.createElement('style');
  style.textContent = `
    [${HIDE_ATTR}] { display: none !important; }
    .pf-bar {
      position: sticky; top: 0; z-index: 5; padding: 4px 8px 6px 8px;
    }
    .pf-bar.pf-stuck {
      background: var(--pf-bg, transparent); backdrop-filter: blur(14px);
      box-shadow: 0 1px 0 color-mix(in srgb, currentColor 10%, transparent);
    }
    /* Cover the scroll container's top padding so nothing peeks through above the pinned bar. */
    .pf-bar.pf-stuck::before {
      content: ''; position: absolute; left: -16px; right: -16px; bottom: 100%; height: 16px;
      background: var(--pf-bg, transparent);
    }
    .pf-bar.pf-stuck { margin-inline: -16px; padding-inline: 24px; }
    .pf-input {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; color: inherit;
      padding: 5px 26px 5px 9px; border-radius: 8px; outline: none;
      background: color-mix(in srgb, currentColor 7%, transparent);
      border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    }
    .pf-input:focus { border-color: color-mix(in srgb, currentColor 40%, transparent); }
    .pf-input::placeholder { color: color-mix(in srgb, currentColor 45%, transparent); }
    .pf-wrap { display: flex; gap: 6px; align-items: center; }
    .pf-field { position: relative; flex: 1; min-width: 0; }
    .pf-fold {
      flex: none; width: 28px; height: 28px; display: grid; place-items: center; padding: 0;
      border-radius: 8px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
      background: color-mix(in srgb, currentColor 7%, transparent); color: inherit; opacity: .75; cursor: pointer;
    }
    .pf-fold:hover { opacity: 1; background: color-mix(in srgb, currentColor 14%, transparent); }
    .pf-fold svg { width: 14px; height: 14px; }
    .pf-clear {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      border: 0; background: none; color: inherit; opacity: .5; cursor: pointer;
      font-size: 14px; line-height: 1; padding: 2px 5px; border-radius: 6px;
    }
    .pf-clear:hover { opacity: 1; background: color-mix(in srgb, currentColor 10%, transparent); }
    .pf-empty { font-size: 12px; opacity: .55; padding: 6px 10px 2px; }
  `;
  document.head.appendChild(style);

  const projectsSections = () => [...new Set([...document.querySelectorAll(PROJECT_SEL)].map((p) => p.closest('section')).filter(Boolean))];

  // The sidebar background is translucent; sample it and make an opaque-enough copy for the sticky bar.
  const px = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  function syncBackground(bar) {
    for (let e = bar; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      if (c === 'rgba(0, 0, 0, 0)' || c === 'transparent') continue;
      px.clearRect(0, 0, 1, 1);
      px.fillStyle = '#000';
      px.fillStyle = c;
      px.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = px.getImageData(0, 0, 1, 1).data;
      if (a < 128) continue; // too see-through to represent the surface
      // Guard against a stale/mismatched sample (e.g. light surface under light-on-dark text).
      const lum = (R, G, B) => (0.299 * R + 0.587 * G + 0.114 * B) / 255;
      const [tr, tg, tb] = getComputedStyle(bar).color.match(/[\d.]+/g).map(Number);
      const textL = lum(tr, tg, tb);
      let fill = `rgb(${r} ${g} ${b})`;
      if (Math.abs(lum(r, g, b) - textL) < 0.35) fill = textL > 0.5 ? 'rgb(25 25 25)' : 'rgb(250 250 250)';
      bar.style.setProperty('--pf-bg', fill);
      return;
    }
  }

  const svg = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const ICON_COLLAPSE = svg('M4 3l4 3 4-3M4 13l4-3 4 3');
  const ICON_EXPAND = svg('M4 6l4-3 4 3M4 10l4 3 4-3');

  // One-shot: click every project whose native expanded state differs from the target.
  // Scoped to one sidebar: the other mode's sidebar shares the state, so clicking both would cancel out.
  function setAllExpanded(expanded, section) {
    for (const p of section.querySelectorAll(PROJECT_SEL)) {
      const row = p.querySelector('[data-app-action-sidebar-project-row]');
      if (row && (row.getAttribute('aria-expanded') === 'true') !== expanded) row.click();
    }
  }

  function buildBar() {
    const bar = document.createElement('div');
    bar.className = 'pf-bar';
    bar.innerHTML =
      '<div class="pf-wrap"><div class="pf-field"><input class="pf-input" type="text" spellcheck="false" ' +
      'autocomplete="off" placeholder="project  chat word  ·  /chat only" aria-label="Filter projects">' +
      '<button class="pf-clear" type="button" aria-label="Clear filter" hidden>✕</button></div>' +
      '<button class="pf-fold" type="button" data-pf="collapse" title="Collapse all projects" aria-label="Collapse all projects">' + ICON_COLLAPSE + '</button>' +
      '<button class="pf-fold" type="button" data-pf="expand" title="Expand all projects" aria-label="Expand all projects">' + ICON_EXPAND + '</button></div>' +
      '<div class="pf-empty" hidden>No matches</div>';
    const input = bar.querySelector('.pf-input');
    const clear = bar.querySelector('.pf-clear');

    input.value = query;
    input.addEventListener('input', () => setQuery(input.value, input));
    // Keep typing away from the app's own keyboard shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      input.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Escape') { setQuery(''); input.blur(); }
      });
    }
    clear.addEventListener('click', () => { setQuery(''); input.focus(); });
    for (const b of bar.querySelectorAll('.pf-fold')) {
      b.addEventListener('click', () => setAllExpanded(b.dataset.pf === 'expand', bar.closest('section')));
    }
    return bar;
  }

  function setQuery(q, source) {
    query = q;
    for (const i of document.querySelectorAll('.pf-input')) if (i !== source && i.value !== q) i.value = q;
    apply();
  }

  const THREAD_SEL = '[data-app-action-sidebar-thread-row]';
  const lastExpand = new WeakMap();

  const setAttr = (el, attr, on) => {
    if (el.hasAttribute(attr) !== on) on ? el.setAttribute(attr, '') : el.removeAttribute(attr);
  };
  const setHidden = (el, hide) => setAttr(el, HIDE_ATTR, hide);

  // Projects only render a few chats until "Show more" is clicked: click it for the user and hide
  // the row, so every chat is always listed.
  function expandAll(project) {
    for (const b of project.querySelectorAll('[data-app-action-sidebar-project-list-id] button')) {
      if (b.closest(THREAD_SEL)) continue;
      const label = b.textContent.trim();
      if (!/^show (more|less)/i.test(label)) continue;
      const row = b.closest('[role="listitem"]');
      if (row) setHidden(row, true);
      if (!/^show more/i.test(label) || Date.now() - (lastExpand.get(b) ?? 0) < 300) continue;
      lastExpand.set(b, Date.now());
      b.click();
    }
  }

  // Alphabetical order via CSS `order` on the wrapper rows: React owns the DOM, so nodes are never moved.
  const collator = new Intl.Collator('et', { sensitivity: 'base', numeric: true });
  function sortProjects(projects) {
    const rows = [...projects].map((p) => ({ name: p.getAttribute('aria-label') ?? '', row: p.parentElement?.closest('[role="listitem"]') }));
    sortChats(projects);
    rows.filter((r) => r.row).sort((a, b) => collator.compare(a.name, b.name)).forEach(({ row }, i) => {
      if (row.style.order !== String(i)) row.style.order = String(i);
    });
  }

  // Same trick for the chats inside each project (only the chats the app has rendered).
  function sortChats(projects) {
    for (const p of projects) {
      const rows = [...p.querySelectorAll(THREAD_SEL)]
        .map((t) => ({ name: t.dataset.appActionSidebarThreadTitle ?? t.textContent, row: t.closest('[role="listitem"]') }))
        .filter((r) => r.row);
      rows.sort((a, b) => collator.compare(a.name, b.name)).forEach(({ row }, i) => {
        if (row.style.order !== String(i)) row.style.order = String(i);
      });
      // Non-chat siblings (the "Show more" row) stay at the end.
      const mine = new Set(rows.map((r) => r.row));
      for (const parent of new Set(rows.map((r) => r.row.parentElement))) {
        for (const el of parent.children) {
          if (!mine.has(el) && el.style.order !== '1000000') el.style.order = '1000000';
        }
      }
    }
  }

  // "project chat words": the first word filters projects, the rest filter chat titles ("/chat words": chats only).
  function apply() {
    // A leading "/" searches chat titles only, across all projects.
    const chatOnly = /^\s*\//.test(query);
    const words = norm(query).replace(/^\s*\//, '').split(/\s+/).filter(Boolean);
    const [projectToken = '', ...chatTokens] = chatOnly ? ['', ...words] : words;
    const projects = document.querySelectorAll(PROJECT_SEL);
    const visibleIn = new Map(); // section -> number of projects left showing
    for (const p of projects) {
      const name = norm(p.getAttribute('aria-label') ?? p.textContent ?? '');
      let match = name.includes(projectToken);

      expandAll(p);
      let anyChat = false;
      for (const t of p.querySelectorAll(THREAD_SEL)) {
        const ok = chatTokens.every((w) => norm(t.dataset.appActionSidebarThreadTitle ?? t.textContent).includes(w));
        anyChat ||= ok;
        // Same wrapper-row logic as projects: hide the listitem that holds the chat.
        setHidden(t.closest('[role="listitem"]') ?? t, !match ? false : !ok);
      }
      if (chatTokens.length && !anyChat) match = false;

      // The animated wrapper row sits one listitem above the project container.
      const sec = p.closest('section');
      visibleIn.set(sec, (visibleIn.get(sec) ?? 0) + (match ? 1 : 0));
      setHidden(p.parentElement?.closest('[role="listitem"]') ?? p, !match);
    }
    sortProjects(projects);
    for (const bar of allBars()) {
      bar.querySelector('.pf-clear').hidden = query === '';
      const shown = visibleIn.get(bar.closest('section'));
      bar.querySelector('.pf-empty').hidden = !((projectToken || chatTokens.length) && shown === 0);
    }
  }

  // The sidebar is React-managed and re-renders; re-attach the bar and re-apply as needed.
  function ensure() {
    for (const section of projectsSections()) {
      let bar = section.querySelector('.pf-bar');
      if (!bar) {
        const wrapper = section.firstElementChild; // div.group/nav-section: [title, content]
        const content = wrapper?.children[1];
        if (!wrapper || !content) continue;
        bar = buildBar();
        bar.querySelector('.pf-input').value = query;
        wrapper.insertBefore(bar, content);
        syncBackground(bar);
      }
    }
    apply();
  }

  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(ensure, 60); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

  // Only paint the bar's background while it is actually pinned over scrolled content.
  document.addEventListener('scroll', (e) => {
    const sc = e.target;
    const bar = sc instanceof Element ? sc.querySelector('.pf-bar') : null;
    if (!bar) return;
    const stuck = sc.scrollTop > 0 && bar.getBoundingClientRect().top <= sc.getBoundingClientRect().top + 8;
    if (stuck) syncBackground(bar); // the theme may have changed since the last sample
    bar.classList.toggle('pf-stuck', stuck);
  }, true);

  window.addEventListener('keydown', (e) => {
    const s = FOCUS_SHORTCUT;
    if (e.code !== s.code || e.metaKey !== s.metaKey || e.altKey !== s.altKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    ensure();
    const bar = visibleBar();
    if (!bar) return;
    const section = bar.closest('section');
    if (section?.dataset.appActionSidebarSectionCollapsed === 'true') {
      section.querySelector('[data-app-action-sidebar-section-toggle]')?.click();
    }
    const input = bar.querySelector('.pf-input');
    input.focus();
    input.select();
  }, true);

  // Re-sample the surface color when the app or OS theme changes.
  const resync = () => requestAnimationFrame(() => allBars().forEach(syncBackground));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', resync);
  new MutationObserver(resync).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });

  window.__projectFilter = { ensure, setQuery };
  ensure();
})();
