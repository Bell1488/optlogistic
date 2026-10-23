(() => {
  'use strict';

  const rate = 12.33;
  const amountInput = document.getElementById('buyout-amount');
  const output = document.getElementById('buyout-output');
  const outputLabel = document.getElementById('buyout-output-label');
  const currencyButtons = [...document.querySelectorAll('[data-currency]')];
  const serviceSelect = document.getElementById('buyout-service');
  const form = document.getElementById('buyout-form');
  const submitButton = document.getElementById('buyout-submit');
  const status = document.getElementById('buyout-status');
  let currency = 'CNY';
  let submitting = false;

  const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

  function updateEstimate() {
    const amount = Number(amountInput.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      output.textContent = 'Введите сумму';
      return;
    }
    if (currency === 'CNY') {
      outputLabel.textContent = 'Ориентир в рублях';
      output.textContent = `${numberFormat.format(amount * rate)} ₽`;
    } else {
      outputLabel.textContent = 'Ориентир в юанях';
      output.textContent = `${numberFormat.format(amount / rate)} CNY`;
    }
  }

  amountInput.addEventListener('input', updateEstimate);
  currencyButtons.forEach((button) => button.addEventListener('click', () => {
    currency = button.dataset.currency;
    currencyButtons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    updateEstimate();
  }));

  document.querySelectorAll('[data-preset]').forEach((link) => link.addEventListener('click', () => {
    serviceSelect.value = link.dataset.preset;
  }));

  function trackGoal(name) {
    if (typeof window.ym === 'function') window.ym(113700526, 'reachGoal', name);
  }

  function getClientId() {
    return new Promise((resolve) => {
      if (typeof window.ym !== 'function') return resolve('');
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value || '');
      };
      window.ym(113700526, 'getClientID', finish);
      window.setTimeout(() => finish(''), 900);
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (!form.reportValidity() || !amountInput.reportValidity()) return;
    const formData = new FormData(form);
    const contact = String(formData.get('contact') || '').trim();
    if (contact.length < 5) return;
    trackGoal('lead_form');
    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Отправляем заявку…';

    const amount = Number(amountInput.value);
    const serviceName = serviceSelect.options[serviceSelect.selectedIndex].text;
    const estimate = currency === 'CNY'
      ? `${numberFormat.format(amount)} CNY ≈ ${numberFormat.format(amount * rate)} RUB`
      : `${numberFormat.format(amount)} RUB ≈ ${numberFormat.format(amount / rate)} CNY`;
    const params = new URLSearchParams(location.search);
    const ymClientId = await getClientId();
    const lead = {
      source: `Страница выкупа и платежей: ${serviceName}`,
      name: String(formData.get('name') || '').trim(),
      contact,
      cargo: `${serviceName}${formData.get('orderLink') ? `; ссылка: ${String(formData.get('orderLink')).trim()}` : ''}`,
      volume: `${numberFormat.format(amount)} ${currency}`,
      priority: serviceName,
      calc: `${estimate}; предварительный курс 1 CNY = ${rate} RUB`,
      page_url: location.href,
      page_title: document.title,
      referrer: document.referrer,
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_content: params.get('utm_content') || '',
      utm_term: params.get('utm_term') || '',
      yclid: params.get('yclid') || '',
      ym_client_id: ymClientId
    };

    status.classList.remove('is-error');
    status.textContent = '';

    try {
      const response = await fetch((window.CONFIG && window.CONFIG.formEndpoint) || '/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(lead)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.saved === false) throw new Error('Заявка не сохранена');
      form.reset();
      form.elements.consent.checked = true;
      status.textContent = 'Заявка отправлена. Менеджер свяжется с вами и подтвердит условия до оплаты.';
      submitButton.textContent = 'Заявка отправлена';
    } catch (error) {
      status.classList.add('is-error');
      status.textContent = 'Не удалось отправить заявку. Напишите менеджеру в Telegram или позвоните по номеру в шапке.';
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Повторить отправку';
    }
  });

  updateEstimate();
  if (window.CONFIG) {
    document.querySelectorAll('[data-cfg]').forEach((node) => {
      const value = node.dataset.cfg.split('.').reduce((current, key) => current && current[key], window.CONFIG);
      if (value) node.textContent = value;
    });
    document.querySelectorAll('[data-cfg-href]').forEach((node) => {
      const key = node.dataset.cfgHref;
      if (key === 'tel') node.href = `tel:${window.CONFIG.phoneRaw}`;
      else if (key === 'mailto') node.href = `mailto:${window.CONFIG.email}`;
      else if (key === 'telegram') node.href = `https://t.me/${window.CONFIG.telegram}`;
      else if (key === 'max') node.href = window.CONFIG.max;
    });
  }
})();
