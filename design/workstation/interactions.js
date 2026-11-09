/* Portable interactions. Native buttons/dialog provide focus and Escape semantics.
 * No backend, persistence or global keyboard interception belongs in this module.
 */
(() => {
  const root = document.querySelector('.wc-app');
  if (!root || root.dataset.wcReady) return;
  root.dataset.wcReady = 'true';
  function themeLabel() {
    root.querySelectorAll('[data-wc-theme]').forEach(button => {
      button.textContent = root.classList.contains('theme-dark') ? 'Light theme' : 'Dark theme';
    });
  }
  themeLabel();
  new MutationObserver(themeLabel).observe(root, { attributes: true, attributeFilter: ['class'] });
  window.WingDither?.apply();
  window.WingDither?.watch();
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-wc-theme')) {
      root.classList.toggle('theme-dark');
      themeLabel();
    }
    if (button.dataset.wcCollapse) {
      const panel = document.getElementById(button.dataset.wcCollapse);
      if (!panel) return;
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
      button.textContent = panel.hidden ? 'Expand' : 'Collapse';
    }
    if (button.dataset.wcDialog) {
      const dialog = document.getElementById(button.dataset.wcDialog);
      if (!dialog || dialog.open) return;
      dialog.addEventListener('close', () => button.focus(), { once: true });
      dialog.showModal();
    }
    if (button.getAttribute('role') === 'tab') activate(button);
  });
  function activate(tab) {
    const list = tab.closest('[role="tablist"]');
    if (!list) return;
    list.querySelectorAll('[role="tab"]').forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.classList.toggle('is-active', selected);
      item.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(item.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    });
  }
  root.addEventListener('keydown', event => {
    if (event.target.getAttribute('role') !== 'tab') return;
    const list = event.target.closest('[role="tablist"]');
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    let index = tabs.indexOf(event.target);
    const vertical = list.getAttribute('aria-orientation') === 'vertical';
    if (event.key === (vertical ? 'ArrowDown' : 'ArrowRight')) index = (index + 1) % tabs.length;
    else if (event.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) index = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault();
    activate(tabs[index]);
    tabs[index].focus();
  });
})();
