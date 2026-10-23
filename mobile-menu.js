(() => {
  'use strict';

  document.querySelectorAll('.menu-toggle').forEach((button) => {
    const header = button.closest('.header__inner');
    const nav = header?.querySelector('.nav');
    if (!nav) return;

    const close = (restoreFocus = false) => {
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', 'Открыть меню');
      nav.classList.remove('is-open');
      if (restoreFocus) button.focus();
    };

    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      button.setAttribute('aria-label', expanded ? 'Открыть меню' : 'Закрыть меню');
      nav.classList.toggle('is-open', !expanded);
    });

    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) close();
    });

    document.addEventListener('click', (event) => {
      if (!header.contains(event.target)) close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') close(true);
    });

    window.addEventListener('resize', () => {
      if (window.matchMedia('(min-width: 1081px)').matches) close();
    });
  });
})();
