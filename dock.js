(() => {
  const dock = document.querySelector('.icon-dock');
  const items = [...dock.querySelectorAll('.dock-item')];
  const cloud = dock.querySelector('[data-view="cloud"]');
  const user = dock.querySelector('[data-view="user"]');
  const panel = document.querySelector('#dock-panel');
  const panelContent = panel.querySelector('.dock-panel-content');
  const weatherSummary = panel.querySelector('#weather-summary');
  const biography = panel.querySelector('#bio-summary');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activePanel = null;

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
      panel.setAttribute('aria-label', view === 'cloud' ? 'Current weather in San Francisco' : 'About Chris');
    }
    dock.dataset.instantExpand = String(instant || reducedMotion.matches);
    dock.dataset.panelOpen = String(open);
    panel.setAttribute('aria-hidden', String(!open));
    panel.inert = !open;
    cloud.setAttribute('aria-expanded', String(view === 'cloud'));
    user.setAttribute('aria-expanded', String(view === 'user'));
    updatePanelHeight();
  }

  function dismissPanel(instant = false) {
    if (!activePanel) return;
    setPanel(null, instant);
    playSound('close');
  }

  items.forEach(item => item.addEventListener('click', event => {
    select(item);
    const view = item.dataset.view;
    const nextPanel = (item === cloud || item === user) && activePanel !== view ? view : null;
    setPanel(nextPanel, event.detail === 0);
    playSound(nextPanel || view === 'mail' ? 'select' : 'close');
    // The email link retains its native mailto navigation.
  }));

  document.addEventListener('pointerdown', event => {
    if (!dock.contains(event.target)) dismissPanel();
  });
  document.addEventListener('focusin', event => {
    if (!dock.contains(event.target)) dismissPanel(true);
  });

  // Dismiss the disclosure before the page's video shortcut handles Escape.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activePanel) {
      const trigger = activePanel === 'cloud' ? cloud : user;
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
