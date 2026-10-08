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
  let bar = null;
  let input = null;
  let empty = null;

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
    .pf-input {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; color: inherit;
      padding: 5px 26px 5px 9px; border-radius: 8px; outline: none;
      background: color-mix(in srgb, currentColor 7%, transparent);
      border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    }
    .pf-input:focus { border-color: color-mix(in srgb, currentColor 40%, transparent); }
    .pf-input::placeholder { color: color-mix(in srgb, currentColor 45%, transparent); }
    .pf-wrap { position: relative; }
    .pf-clear {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      border: 0; background: none; color: inherit; opacity: .5; cursor: pointer;
      font-size: 14px; line-height: 1; padding: 2px 5px; border-radius: 6px;
    }
    .pf-clear:hover { opacity: 1; background: color-mix(in srgb, currentColor 10%, transparent); }
    .pf-empty { font-size: 12px; opacity: .55; padding: 6px 10px 2px; }
  `;
  document.head.appendChild(style);

  const projectsSection = () => document.querySelector(PROJECT_SEL)?.closest('section') ?? null;

  // The sidebar background is translucent; sample it and make an opaque-enough copy for the sticky bar.
  const px = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  function syncBackground() {
    for (let e = bar; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      if (c === 'rgba(0, 0, 0, 0)' || c === 'transparent') continue;
      px.clearRect(0, 0, 1, 1);
      px.fillStyle = c;
      px.fillRect(0, 0, 1, 1);
      const [r, g, b] = px.getImageData(0, 0, 1, 1).data;
      bar.style.setProperty('--pf-bg', `rgb(${r} ${g} ${b} / 0.96)`);
      return;
    }
  }

  function buildBar() {
    bar = document.createElement('div');
    bar.className = 'pf-bar';
    bar.innerHTML =
      '<div class="pf-wrap"><input class="pf-input" type="text" spellcheck="false" ' +
      'autocomplete="off" placeholder="Project, then space + chat word…" aria-label="Filter projects">' +
      '<button class="pf-clear" type="button" aria-label="Clear filter" hidden>✕</button></div>' +
      '<div class="pf-empty" hidden>No matching projects</div>';
    input = bar.querySelector('.pf-input');
    empty = bar.querySelector('.pf-empty');
    const clear = bar.querySelector('.pf-clear');

    input.value = query;
    input.addEventListener('input', () => { query = input.value; apply(); });
    // Keep typing away from the app's own keyboard shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      input.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Escape') { setQuery(''); input.blur(); }
      });
    }
    clear.addEventListener('click', () => { setQuery(''); input.focus(); });
  }

  function setQuery(q) {
    query = q;
    if (input) input.value = q;
    apply();
  }

  const THREAD_SEL = '[data-app-action-sidebar-thread-row]';
  const lastExpand = new WeakMap();

  const setHidden = (el, hide) => {
    if (el.hasAttribute(HIDE_ATTR) !== hide) hide ? el.setAttribute(HIDE_ATTR, '') : el.removeAttribute(HIDE_ATTR);
  };

  // Projects only render a few chats until "Show more" is clicked; open them so chat search is complete.
  function expandAll(project) {
    for (const b of project.querySelectorAll('[data-app-action-sidebar-project-list-id] button')) {
      if (b.closest(THREAD_SEL) || !/^show more/i.test(b.textContent.trim())) continue;
      if (Date.now() - (lastExpand.get(b) ?? 0) < 300) continue;
      lastExpand.set(b, Date.now());
      b.click();
    }
  }

  // "project words  chat words": the first word filters projects, the rest filter chat titles.
  function apply() {
    const [projectToken = '', ...chatTokens] = norm(query).split(/\s+/).filter(Boolean);
    const projects = document.querySelectorAll(PROJECT_SEL);
    let visible = 0;
    for (const p of projects) {
      const name = norm(p.getAttribute('aria-label') ?? p.textContent ?? '');
      let match = name.includes(projectToken);

      if (match && chatTokens.length) expandAll(p);
      let anyChat = false;
      for (const t of p.querySelectorAll(THREAD_SEL)) {
        const ok = chatTokens.every((w) => norm(t.dataset.appActionSidebarThreadTitle ?? t.textContent).includes(w));
        anyChat ||= ok;
        // Same wrapper-row logic as projects: hide the listitem that holds the chat.
        setHidden(t.closest('[role="listitem"]') ?? t, !match ? false : !ok);
      }
      if (chatTokens.length && !anyChat) match = false;

      // The animated wrapper row sits one listitem above the project container.
      if (match) visible++;
      setHidden(p.parentElement?.closest('[role="listitem"]') ?? p, !match);
    }
    if (!bar) return;
    bar.querySelector('.pf-clear').hidden = query === '';
    empty.hidden = !(projectToken && projects.length && visible === 0);
  }

  // The sidebar is React-managed and re-renders; re-attach the bar and re-apply as needed.
  function ensure() {
    const section = projectsSection();
    if (!section) return;
    if (!bar) buildBar();
    if (!bar.isConnected) {
      const wrapper = section.firstElementChild; // div.group/nav-section: [title, content]
      const content = wrapper?.children[1];
      if (!wrapper || !content) return;
      wrapper.insertBefore(bar, content);
    }
    syncBackground();
    apply();
  }

  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(ensure, 60); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

  // Only paint the bar's background while it is actually pinned over scrolled content.
  document.addEventListener('scroll', (e) => {
    const sc = e.target;
    if (!bar?.isConnected || !(sc instanceof Element) || !sc.contains(bar)) return;
    bar.classList.toggle('pf-stuck', sc.scrollTop > 0 && bar.getBoundingClientRect().top <= sc.getBoundingClientRect().top + 8);
  }, true);

  window.addEventListener('keydown', (e) => {
    const s = FOCUS_SHORTCUT;
    if (e.code !== s.code || e.metaKey !== s.metaKey || e.altKey !== s.altKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    const section = projectsSection();
    if (section?.dataset.appActionSidebarSectionCollapsed === 'true') {
      section.querySelector('[data-app-action-sidebar-section-toggle]')?.click();
    }
    ensure();
    input?.focus();
    input?.select();
  }, true);

  window.__projectFilter = { ensure, setQuery };
  ensure();
})();
