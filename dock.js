(() => {
  const dock = document.querySelector('.icon-dock');
  const items = [...dock.querySelectorAll('.dock-item')];
  const cloud = dock.querySelector('[data-view="cloud"]');
  const user = dock.querySelector('[data-view="user"]');
  const mail = dock.querySelector('[data-view="mail"]');
  const panel = document.querySelector('#dock-panel');
  const panelContent = panel.querySelector('.dock-panel-content');
  const weatherSummary = panel.querySelector('#weather-summary');
  const copySummary = panel.querySelector('#copy-summary');
  const biography = panel.querySelector('#bio-summary');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activePanel = null;
  let copyTimer;
  let copyRequest = 0;
  let copyPending = false;

  function playSound(cue) {
    try {
      window.DockSounds?.play(cue);
    } catch {
      // Audio support must never prevent a dock action.
    }
  }

  function select(item) {
    dock.dataset.selection = item.dataset.view;
    items.forEach(control => {
      const selected = control === item;
      control.dataset.selected = String(selected);
      if (control.tagName === 'BUTTON') control.setAttribute('aria-pressed', String(selected));
    });
  }

  function updatePanelHeight() {
    biography.tabIndex = activePanel === 'user' && biography.scrollHeight > biography.clientHeight ? 0 : -1;
    panel.style.height = activePanel ? `${panelContent.scrollHeight}px` : '0px';
  }

  function setPanel(view, instant = false) {
    activePanel = view;
    const open = Boolean(view);
    if (open) {
      weatherSummary.hidden = view !== 'cloud';
      biography.hidden = view !== 'user';
      copySummary.hidden = view !== 'mail';
      panel.setAttribute('aria-label', view === 'cloud' ? 'Current weather in San Francisco'
        : view === 'user' ? 'About Chris' : 'Email address');
    }
    dock.dataset.instantExpand = String(instant || reducedMotion.matches);
    dock.dataset.panelOpen = String(open);
    panel.setAttribute('aria-hidden', String(!open));
    panel.inert = !open;
    cloud.setAttribute('aria-expanded', String(view === 'cloud'));
    user.setAttribute('aria-expanded', String(view === 'user'));
    mail.setAttribute('aria-expanded', String(view === 'mail'));
    updatePanelHeight();
  }

  function cancelCopyFeedback() {
    clearTimeout(copyTimer);
    copyRequest++;
    copyPending = false;
  }

  async function copyEmail(instant) {
    const request = copyRequest;
    copyPending = true;
    let copied = false;
    try {
      // Invoke directly in the click gesture, including on mobile Safari.
      await navigator.clipboard.writeText('chris@paradigm.xyz');
      copied = true;
    } catch { /* Never show success when clipboard access was refused. */ }
    if (request !== copyRequest) return;
    copyPending = false;
    copySummary.textContent = copied ? 'Copied!' : 'Couldn’t copy. Try again.';
    setPanel('mail', instant);
    copyTimer = setTimeout(() => {
      if (request === copyRequest && activePanel === 'mail') setPanel(null, instant);
    }, copied ? 500 : 3000);
  }

  function dismissPanel(instant = false) {
    cancelCopyFeedback();
    if (!activePanel) return;
    setPanel(null, instant);
    playSound('close');
  }

  items.forEach(item => item.addEventListener('click', event => {
    cancelCopyFeedback();
    select(item);
    if (item === mail) {
      playSound('select');
      void copyEmail(event.detail === 0);
      return;
    }
    const view = item.dataset.view;
    const nextPanel = (item === cloud || item === user) && activePanel !== view ? view : null;
    setPanel(nextPanel, event.detail === 0);
    playSound(nextPanel ? 'select' : 'close');
  }));

  document.addEventListener('pointerdown', event => {
    if (!dock.contains(event.target)) dismissPanel();
  });
  document.addEventListener('focusin', event => {
    if (!dock.contains(event.target)) dismissPanel(true);
  });

  // Dismiss the disclosure before the page's video shortcut handles Escape.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (activePanel || copyPending)) {
      const trigger = activePanel === 'cloud' ? cloud : activePanel === 'user' ? user : mail;
      const restoreFocus = panel.contains(document.activeElement);
      dismissPanel(true);
      if (restoreFocus) trigger.focus();
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  dock.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = items.indexOf(event.target.closest('.dock-item'));
    if (index < 0) return;
    let target;
    if (event.key === 'ArrowRight') target = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') target = (index + items.length - 1) % items.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = items.length - 1;
    else return;
    event.preventDefault();
    items[target].focus();
  });

  // Keep the disclosure fitted to either view and to viewport/text-size changes.
  new ResizeObserver(updatePanelHeight).observe(panelContent);
  reducedMotion.addEventListener('change', () => setPanel(activePanel, true));
})();
