/* =====================================================================
   Логика лендинга КаргоМост
   - Динамическая подмена контента под Яндекс.Директ (Мультилендинг)
   - Полная система макро- и микро-целей Яндекс.Метрики
   - Сбор ClientID, YCLID, UTM и отправка на бэкенд (с поддержкой socks5h)
   - Калькулятор, расписание рейсов Китая, квиз и exit-intent лид-магнит
   ===================================================================== */
(function () {
  'use strict';
  const C = window.CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const get = (path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), C);
  const fmtRub = (n) => Math.round(n).toLocaleString('ru-RU') + ' ₽';
  const fmtUsd = (n) => '$' + Math.round(n).toLocaleString('ru-RU');

  /* ===================================================================
     1. ЯНДЕКС.МЕТРИКА: Инициализация и цели
     =================================================================== */
  window.dataLayer = window.dataLayer || [];

  // Автоподключение счетчика, если указан metrikaId
  if (C.metrikaId && !window['yaCounter' + C.metrikaId]) {
    (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
    m[i].l=1*new Date();
    for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
    k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
    (window, document, "script", "https://mc.yandex.ru/metrika/tag.js?id=" + C.metrikaId, "ym");

    ym(C.metrikaId, "init", {
      ssr: true,
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: true,
      ecommerce: "dataLayer",
      referrer: document.referrer,
      url: location.href
    });
  }

  function goal(name, params) {
    try {
      if (C.metrikaId && window.ym) {
        ym(C.metrikaId, 'reachGoal', name, params);
      }
      window.dataLayer.push({ event: name, goalParams: params });
      console.log('[Metrika Goal]:', name, params || '');
    } catch (e) {}
  }

  // Получение ClientID Метрики для сквозной аналитики и оффлайн-конверсий Директа.
  // getClientID асинхронен, поэтому заявка ждёт callback, а не читает значение сразу.
  let clientIdPromise;
  function getClientId() {
    if (clientIdPromise) return clientIdPromise;
    clientIdPromise = new Promise((resolve) => {
      try {
        const match = document.cookie.match(/(?:^|; )_ym_uid=([^;]*)/);
        if (match) { resolve(decodeURIComponent(match[1])); return; }
        if (!(C.metrikaId && window.ym)) { resolve(null); return; }

        let settled = false;
        const finish = (id) => {
          if (!settled) { settled = true; resolve(id || null); }
        };
        const timer = setTimeout(() => finish(null), 1500);
        ym(C.metrikaId, 'getClientID', (id) => { clearTimeout(timer); finish(id); });
      } catch (e) { resolve(null); }
    });
    return clientIdPromise;
  }

  /* ===================================================================
     2. МУЛЬТИЛЕНДИНГ (Динамическая адаптация под запросы Яндекс.Директа)
     =================================================================== */
  const urlParams = new URLSearchParams(window.location.search);
  const utmTerm = (urlParams.get('utm_term') || urlParams.get('keyword') || urlParams.get('text') || '').toLowerCase();
  const utmCampaign = (urlParams.get('utm_campaign') || '').toLowerCase();
  const utmContent = (urlParams.get('utm_content') || '').toLowerCase();
  const queryAll = `${utmTerm} ${utmCampaign} ${utmContent}`;

  const heroPill = $('#heroPill');
  const heroTitle = $('#heroTitle');
  const calcCatSelect = $('#calcCategory');

  function applyUtmAdaptation() {
    if (!heroTitle) return;

    // Сценарий 1: Селлеры маркетплейсов (Wildberries, Ozon)
    if (/wildberries|вайлдберриз|вб|ozon|озон|маркетплейс|селлер/.test(queryAll)) {
      if (heroPill) heroPill.textContent = '🛍️ Спецусловия и маркировка для селлеров WB и Ozon';
      heroTitle.innerHTML = 'Карго из Китая <span class="accent">для Wildberries и Ozon</span> с гарантией сроков';
      if (calcCatSelect) calcCatSelect.value = 'clothes';
      goal('utm_segment_wb_ozon');
    }
    // Сценарий 2: Оборудование и станки
    else if (/станк|оборудован|линия|производств|запчаст/.test(queryAll)) {
      if (heroPill) heroPill.textContent = '⚙️ Доставка тяжелого оборудования, станков и линий';
      heroTitle.innerHTML = 'Доставка оборудования и станков из Китая <span class="accent">под ключ с договором</span>';
      if (calcCatSelect) calcCatSelect.value = 'parts';
      goal('utm_segment_machinery');
    }
    // Сценарий 3: Срочная / Авиадоставка
    else if (/авиа|срочн|быстр|экспресс|самолет/.test(queryAll)) {
      if (heroPill) heroPill.textContent = '✈️ Срочная авиадоставка коммерческих партий от 10 кг';
      heroTitle.innerHTML = 'Срочная авиадоставка из Китая <span class="accent">от 7 дней</span> с фиксированной ценой';
      goal('utm_segment_air');
    }
    // Сценарий 4: Белая доставка / таможня / НДС
    else if (/белая|официальн|гтд|ндс|документ|растаможк|юрлиц/.test(queryAll)) {
      if (heroPill) heroPill.textContent = '📑 100% официальный ввоз, ГТД и закрывающие документы';
      heroTitle.innerHTML = 'Белая доставка грузов из Китая <span class="accent">с НДС и ГТД</span> на ваше юрлицо';
      goal('utm_segment_white');
    }
    // Сценарий 5: Города и регионы
    else if (/петербург|спб/.test(queryAll)) {
      heroTitle.innerHTML = 'Карго из Китая <span class="accent">в Санкт-Петербург</span> с договором и страховкой';
    } else if (/екатеринбург|урал/.test(queryAll)) {
      heroTitle.innerHTML = 'Карго из Китая <span class="accent">в Екатеринбург</span> с договором и страховкой';
    } else if (/казань|татарстан/.test(queryAll)) {
      heroTitle.innerHTML = 'Карго из Китая <span class="accent">в Казань</span> с договором и страховкой';
    } else if (/краснодар|ростов/.test(queryAll)) {
      heroTitle.innerHTML = 'Карго из Китая <span class="accent">на Юг России</span> с договором и страховкой';
    }
  }

  /* ===================================================================
     3. ПОДСТАНОВКА ДАННЫХ ИЗ CONFIG.JS
     =================================================================== */
  $$('[data-cfg]').forEach((el) => { const v = get(el.dataset.cfg); if (v != null) el.textContent = v; });
  if (!get('stats.enabled')) {
    const stats = document.querySelector('.hero__stats');
    if (stats) stats.hidden = true;
  }
  const hrefs = {
    tel: 'tel:' + (C.phoneRaw || ''),
    mailto: 'mailto:' + (C.email || ''),
    telegram: 'https://t.me/' + (C.telegram || ''),
    telegramChecklist: 'https://t.me/' + (C.telegramChecklist || C.telegram || ''),
    max: C.max || '',
    privacy: C.privacyUrl || '#'
  };
  $$('[data-cfg-href]').forEach((el) => { const h = hrefs[el.dataset.cfgHref]; if (h) el.href = h; });
  $('#year').textContent = new Date().getFullYear();

  // Трекинг кликов по прямым контактам (Макро-цели для Директа)
  $$('a[href^="tel:"]').forEach((a) => a.addEventListener('click', () => goal('click_phone')));
  $$('a[href*="t.me"]').forEach((a) => a.addEventListener('click', () => goal('click_telegram')));
  $$('a[href*="max.ru"]').forEach((a) => a.addEventListener('click', () => goal('click_max')));

  /* ===================================================================
     4. ТАЙМЕР РЕАЛЬНОГО ЗАКРЫТИЯ РЕЙСА СО СКЛАДА В ГУАНЧЖОУ
     =================================================================== */
  function nextCutoff() {
    const dep = C.departures || { weekdays: [2, 5], cutoffHour: 18 };
    const now = Date.now();
    const cn = new Date(now + 8 * 3600e3);
    for (let d = 0; d < 15; d++) {
      const dayUtc = Date.UTC(cn.getUTCFullYear(), cn.getUTCMonth(), cn.getUTCDate() + d);
      const wd = new Date(dayUtc).getUTCDay();
      const cutoff = dayUtc + dep.cutoffHour * 3600e3 - 8 * 3600e3;
      if (dep.weekdays.includes(wd) && cutoff > now) return cutoff;
    }
    return now + 3 * 86400e3;
  }
  let cutoff = nextCutoff();
  const depLabel = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Asia/Shanghai' }).format(cutoff);
  ['#nextDepartureDate', '#quizDepartureDate'].forEach((s) => { const el = $(s); if (el) el.textContent = depLabel; });

  function tick() {
    let ms = cutoff - Date.now();
    if (ms <= 0) { cutoff = nextCutoff(); ms = cutoff - Date.now(); }
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    const txt = (d > 0 ? d + 'д ' : '') + pad(h) + ':' + pad(m) + ':' + pad(sec);
    ['#topCountdown', '#quizCountdown'].forEach((sel) => { const el = $(sel); if (el) el.textContent = txt; });
  }
  tick(); setInterval(tick, 1000);

  /* ===================================================================
     5. КАЛЬКУЛЯТОР
     =================================================================== */
  const M = C.methods || {};
  let method = (/авиа|срочн|быстр/.test(queryAll) && M.air) ? 'air' : 'auto';

  function calc(weight, volume, cat, key) {
    const m = M[key];
    const coef = (C.categories || {})[cat] || 1;
    const density = volume > 0 ? weight / volume : 0;
    const usd = Math.max(weight * m.perKg, volume * m.perM3) * coef;
    return { usd, rub: usd * C.usdRate, perKg: usd / weight, density, days: m.days, minKg: m.minKg };
  }

  function renderCalc() {
    const w = Math.max(1, parseFloat($('#calcWeight').value) || 0);
    const v = Math.max(0.01, parseFloat($('#calcVolume').value) || 0);
    const cat = $('#calcCategory').value;
    const r = calc(w, v, cat, method);

    $('#resPrice').textContent = fmtRub(r.rub * 0.95) + ' – ' + fmtRub(r.rub * 1.05);
    $('#resPriceUsd').textContent = '≈ ' + fmtUsd(r.usd) + ' по курсу ' + C.usdRate + ' ₽';
    $('#resDays').textContent = r.days[0] + '–' + r.days[1] + ' дн.';
    $('#resPerKg').textContent = '$' + r.perKg.toFixed(2);
    $('#resDensity').textContent = Math.round(r.density) + ' кг/м³';

    const sav = $('#resSaving');
    if (w < r.minKg) {
      sav.hidden = false; sav.className = 'calc__saving warn';
      sav.textContent = 'Минимальная партия для «' + M[method].name + '» — ' + r.minKg + ' кг. Менеджер предложит сборный вариант.';
    } else if (method !== 'air' && M.air) {
      const air = calc(w, v, cat, 'air');
      const diff = air.rub - r.rub;
      sav.hidden = diff <= 0; sav.className = 'calc__saving';
      sav.innerHTML = 'Экономия против авиа: <b>' + fmtRub(diff) + '</b>';
    } else if (M.auto) {
      const auto = calc(w, v, cat, 'auto');
      sav.hidden = false; sav.className = 'calc__saving';
      sav.innerHTML = 'Быстрее авто на <b>' + (auto.days[0] - r.days[0]) + '–' + (auto.days[1] - r.days[1]) + ' дней</b>';
    }

    const summary = M[method].name + ', ' + w + ' кг, ' + v + ' м³, ' + $('#calcCategory').selectedOptions[0].text + ', ≈ ' + fmtRub(r.rub);
    $('#quizCalc').value = summary;
    try { localStorage.setItem('cargoCalc', JSON.stringify({ w, v, cat, method })); } catch (e) {}
  }

  // Восстановление прошлого расчета
  try {
    const saved = JSON.parse(localStorage.getItem('cargoCalc') || 'null');
    if (saved && M[saved.method]) {
      $('#calcWeight').value = saved.w; $('#calcVolume').value = saved.v;
      $('#calcCategory').value = saved.cat; method = saved.method;
    }
  } catch (e) {}

  function setMethod(key) {
    method = key;
    $$('#calcMethod button').forEach((b) => {
      const active = b.dataset.method === key;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    renderCalc();
  }

  $$('#calcMethod button').forEach((b) => b.addEventListener('click', () => {
    setMethod(b.dataset.method);
    goal('calc_method_change', { method: b.dataset.method });
  }));

  ['#calcWeight', '#calcVolume', '#calcCategory'].forEach((s) => $(s).addEventListener('input', () => {
    renderCalc();
    goal('calc_interact');
  }));

  $('#calcCta').addEventListener('click', () => {
    goal('calc_cta_click');
    $('#quiz').scrollIntoView({ behavior: 'smooth' });
  });

  applyUtmAdaptation();
  setMethod(method);

  /* ===================================================================
     6. СПОСОБЫ ДОСТАВКИ
     =================================================================== */
  const order = ['air', 'auto', 'rail', 'sea'].filter((k) => M[k]);
  $('#methodsGrid').innerHTML = order.map((k) => {
    const m = M[k];
    return '<div class="method' + (m.highlight ? ' method--hl' : '') + '">' +
      (m.highlight ? '<span class="method__badge">Оптимальный выбор</span>' : '') +
      '<div class="method__ico">' + m.icon + '</div>' +
      '<h3>' + m.name + '</h3>' +
      '<p class="method__tag">' + m.tagline + '</p>' +
      '<div class="method__price">от <b>$' + m.perKg.toFixed(1) + '</b>/кг</div>' +
      '<div class="method__rub">≈ ' + Math.round(m.perKg * C.usdRate) + ' ₽/кг</div>' +
      '<ul><li>Срок: <b>' + m.days[0] + '–' + m.days[1] + ' дней</b></li><li>Минимум: <b>' + m.minKg + ' кг</b></li></ul>' +
      '<button class="btn ' + (m.highlight ? 'btn--primary' : 'btn--outline') + ' btn--block" data-pick="' + k + '">Рассчитать</button>' +
      '</div>';
  }).join('');

  $$('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    setMethod(b.dataset.pick);
    goal('method_card_click', { method: b.dataset.pick });
    $('#calc').scrollIntoView({ behavior: 'smooth' });
  }));

  /* ===================================================================
     7. ОТЗЫВЫ
     =================================================================== */
  const reviews = C.reviews || [];
  if (!reviews.length) { $('#reviews').hidden = true; }
  else {
    $('#reviewsGrid').innerHTML = reviews.map((r) =>
      '<figure class="review card"><div class="review__stars">' + '★'.repeat(r.rating || 5) + '</div>' +
      '<blockquote>' + r.text + '</blockquote>' +
      '<figcaption><b>' + r.name + '</b><span>' + r.role + '</span></figcaption></figure>'
    ).join('');
  }

  /* ===================================================================
     8. КВИЗ-ФОРМА (Воронка шагов)
     =================================================================== */
  const steps = $$('.quiz__step');
  const total = steps.length;
  let cur = 1;
  const next = $('#quizNext'), back = $('#quizBack'), submit = $('#quizSubmit');
  let quizSubmitting = false;

  function showStep(n) {
    cur = n;
    steps.forEach((s) => s.classList.toggle('active', +s.dataset.step === n));
    $('#quizBar').style.width = (15 + ((n - 1) / (total - 1)) * 85) + '%';
    $('#quizStepLabel').textContent = n < total ? 'Шаг ' + n + ' из ' + total : 'Последний шаг';
    back.hidden = n === 1;
    next.hidden = n === total;
    submit.hidden = n !== total;
    next.disabled = !steps[n - 1].querySelector('input:checked');
  }

  steps.forEach((s) => s.addEventListener('change', (e) => {
    if (e.target.type !== 'radio') return;
    next.disabled = false;
    if (cur === 1) goal('quiz_start');
    if (cur === 2) goal('quiz_step_2');
    if (cur === 3) goal('quiz_step_3');
    setTimeout(() => { if (cur < total) showStep(cur + 1); }, 280);
  }));

  const contactInput = $('input[name="contact"]');
  if (contactInput) {
    contactInput.addEventListener('focus', () => goal('quiz_contact_focus'), { once: true });
  }

  next.addEventListener('click', () => {
    if (cur === 1) goal('quiz_start');
    if (cur === 2) goal('quiz_step_2');
    if (cur === 3) goal('quiz_step_3');
    showStep(Math.min(total, cur + 1));
  });
  back.addEventListener('click', () => showStep(Math.max(1, cur - 1)));
  showStep(1);

  /* ===================================================================
     9. ОТПРАВКА ЗАЯВОК (POST JSON на бэкенд / Socks5h Telegram)
     =================================================================== */
  async function collectLeadData(formElement) {
    const fd = new FormData(formElement);
    const data = Object.fromEntries(fd.entries());
    data.page_url = location.href;
    data.page_title = document.title;
    data.referrer = document.referrer;
    data.ym_client_id = await getClientId();

    // UTM и YCLID для аналитики и оффлайн-конверсий Директа
    data.utm_source = urlParams.get('utm_source') || '';
    data.utm_medium = urlParams.get('utm_medium') || '';
    data.utm_campaign = urlParams.get('utm_campaign') || '';
    data.utm_content = urlParams.get('utm_content') || '';
    data.utm_term = urlParams.get('utm_term') || '';
    data.yclid = urlParams.get('yclid') || '';

    return data;
  }

  async function sendLeadToServer(data) {
    const endpoint = C.formEndpoint || '/api/lead';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        return { ok: true, json };
      }
    } catch (e) {
      console.warn('Lead API request failed:', e);
    }
    return { ok: false };
  }

  // Обработка основной квиз-формы
  $('#quizForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (quizSubmitting) return;
    const f = e.target;
    const contact = f.contact.value.trim();
    if (contact.length < 5) { f.contact.focus(); f.contact.classList.add('invalid'); return; }
    if (!f.consent.checked) { f.consent.focus(); return; }

    quizSubmitting = true;
    submit.disabled = true;
    submit.textContent = 'Отправляем заявку…';

    // Считаем конверсию по отправке валидной формы, не дожидаясь API/Telegram.
    goal('lead_form', { yclid: urlParams.get('yclid') || '' });

    const data = await collectLeadData(f);
    data.source = 'Квиз-форма (основная)';

    const result = await sendLeadToServer(data);
    if (!result.ok) {
      goal('lead_api_error', { yclid: data.yclid });
    }

    sessionStorage.setItem('cargoLead', '1');

    $$('.quiz__step, .quiz__nav, .quiz__progress, .quiz__step-label', f).forEach((el) => (el.hidden = true));
    $('#quizDone').hidden = false;
  });

  // Обработка формы Exit-intent модалки
  const exitForm = $('#exitForm');
  if (exitForm) {
    exitForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = exitForm.querySelector('input[name="contact"]');
      const contactVal = input ? input.value.trim() : '';
      if (contactVal.length < 5) return;

      const data = await collectLeadData(exitForm);
      data.source = 'Exit-intent чек-лист';
      data.contact = contactVal;

      const btn = exitForm.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Отправляем…'; }

      const result = await sendLeadToServer(data);
      if (!result.ok) {
        goal('lead_api_error', { yclid: data.yclid });
      }

      if (result.ok && result.json && result.json.saved !== false) {
        goal('lead_exit', { yclid: data.yclid });
      }
      sessionStorage.setItem('cargoLead', '1');

      exitForm.innerHTML = '<div style="color:var(--green); font-weight:700; padding:10px 0; text-align:center;">✓ Чек-лист отправлен! Менеджер свяжется с вами в течение 15 минут.</div>';
      setTimeout(() => { modal.hidden = true; }, 3000);
    });
  }

  /* ===================================================================
     10. EXIT-INTENT МОДАЛКА
     =================================================================== */
  const modal = $('#exitModal');
  const openedAt = Date.now();
  function openModal() {
    if (sessionStorage.getItem('cargoExit') || sessionStorage.getItem('cargoLead')) return;
    if (Date.now() - openedAt < 12000) return;
    sessionStorage.setItem('cargoExit', '1');
    modal.hidden = false;
    goal('exit_popup');
  }

  if (window.matchMedia('(pointer:fine)').matches) {
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget && e.clientY <= 0) openModal(); });
  }
  $$('[data-close]', modal).forEach((el) => el.addEventListener('click', () => (modal.hidden = true)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.hidden = true; });

  /* ===================================================================
     11. СКРОЛЛ-ТРЕКИНГ И СТАЙЛИНГ
     =================================================================== */
  const header = $('#header');
  window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 10), { passive: true });

  let scroll50 = false, scroll90 = false;
  window.addEventListener('scroll', () => {
    const pct = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight * 100;
    if (!scroll50 && pct > 50) { scroll50 = true; goal('scroll_50'); }
    if (!scroll90 && pct > 90) { scroll90 = true; goal('scroll_90'); }
  }, { passive: true });

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }), { threshold: 0.12 });
    $$('.pain, .method, .step, .review, .compare, .guarantee, .included__list li').forEach((el) => { el.classList.add('reveal'); io.observe(el); });
  }
})();
