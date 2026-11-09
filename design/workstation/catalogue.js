// Demo adapters: no remote operations, hardware or persisted settings.
(() => {
  const get = id => document.getElementById(id);
  const log = message => {
    const line = document.createElement('div');
    line.textContent = message;
    get('sample-log').append(line);
  };
  document.querySelectorAll('[data-demo-action]').forEach(item => item.addEventListener('click', () => log(item.dataset.demoAction)));
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
  get('latched').onclick = event => {
    const button = event.currentTarget, on = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(on));
    button.textContent = `Latched: ${on ? 'on' : 'off'}`;
  };
  get('sample-range').oninput = event => { get('range-value').value = event.target.value; };
  get('validation').oninput = event => {
    const invalid = !event.target.value.trim();
    event.target.classList.toggle('is-invalid', invalid);
    event.target.setAttribute('aria-invalid', String(invalid));
    get('validation-note').textContent = invalid ? 'Enter a name before saving.' : 'Name is valid.';
  };
  document.querySelectorAll('[data-select-row]').forEach(button => button.onclick = () => {
    document.querySelectorAll('#sample-rows tr').forEach(row => {
      const selected = row === button.closest('tr');
      row.setAttribute('aria-selected', String(selected));
      row.classList.toggle('wc-selected-row', selected);
    });
  });
  get('step-edit').onclick = () => {
    const container = get('step-name');
    if (container.querySelector('input')) return;
    const value = container.textContent;
    const input = document.createElement('input');
    input.value = value;
    input.setAttribute('aria-label', 'Step name');
    const finish = save => { container.textContent = save ? (input.value.trim() || value) : value; get('step-edit').focus(); };
    input.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter');
    };
    input.onblur = () => { if (input.isConnected) finish(true); };
    container.replaceChildren(input);
    input.focus(); input.select();
  };
  get('sample-prompt').addEventListener('close', () => {
    if (get('sample-prompt').returnValue === 'save') get('step-name').textContent = get('prompt-name').value;
    get('sample-prompt').returnValue = '';
  });
  let anchor = 0;
  const cells = [];
  for (let i = 0; i < 24; i++) {
    const cell = document.createElement('button');
    cell.className = 'matrix-cell';
    cell.textContent = String(i + 1);
    cell.setAttribute('aria-pressed', 'false');
    cell.onclick = event => {
      const on = cell.getAttribute('aria-pressed') !== 'true';
      const targets = event.shiftKey ? cells.slice(Math.min(anchor, i), Math.max(anchor, i) + 1) : [cell];
      targets.forEach(target => { target.setAttribute('aria-pressed', String(on)); target.classList.toggle('is-selected', on); });
      anchor = i;
      get('matrix-status').textContent = `${cells.filter(item => item.getAttribute('aria-pressed') === 'true').length} selected`;
    };
    cells.push(cell);
    get('sample-matrix').append(cell);
  }
  get('notice-trigger').onclick = () => { get('sample-notice').hidden = false; };
  get('notice-close').onclick = () => { get('sample-notice').hidden = true; };
  const menu = get('sample-menu'), trigger = get('menu-trigger');
  const closeMenu = () => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); };
  trigger.onclick = () => {
    if (!menu.hidden) return closeMenu();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const rect = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(rect.bottom + 2, innerHeight - menu.offsetHeight - 4))}px`;
    menu.querySelector('[role=menuitem]').focus();
  };
  menu.addEventListener('click', event => { if (event.target.closest('[role=menuitem]')) closeMenu(); });
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('[role=menuitem]')], index = items.indexOf(document.activeElement);
    if (event.key === 'Escape' || event.key === 'Tab') closeMenu();
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.activeElement.click(); }
  });
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) closeMenu();
  });
  // The drawing implementation is the production renderer; the value is labelled demo data.
  const canvas = get('sample-vu');
  const drawMeter = () => window.WingVu?.drawAnalog(canvas.getContext('2d'), { width: canvas.width, height: canvas.height, db: -12, dark: document.body.classList.contains('theme-dark') });
  drawMeter();
  new MutationObserver(drawMeter).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  menu.addEventListener('focusin', event => {
    menu.querySelectorAll('[role=menuitem]').forEach(item => item.classList.toggle('is-focused', item === event.target));
  });
})();
