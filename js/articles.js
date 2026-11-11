// Раздел статей: лёгкий скрипт без 3D-сцены и без three.js.
// Курсор и зерно — как на лендинге; фильтр списка по меткам и тегам; подсказка у «Исследовано ИИ»;
// полоска чтения и оглавление. Без скрипта страницы читаются целиком, просто без фильтра.
(function () {
  var doc = document.documentElement;
  var fine = matchMedia('(pointer: fine)').matches;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  doc.classList.add('js');

  /* зерно: плитка шума рисуется один раз */
  var grain = $('.grain');
  if (grain) {
    var c = document.createElement('canvas'); c.width = c.height = 160;
    var g = c.getContext('2d'), img = g.createImageData(160, 160), d = img.data;
    for (var i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = Math.random() < 0.5 ? 255 : 0; d[i + 3] = Math.random() * 255; }
    g.putImageData(img, 0, 0);
    grain.style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')';
  }

  /* курсор: точка сразу, кольцо догоняет; кадры идут, только пока кольцо в пути */
  var cursor = $('.cursor');
  if (fine && cursor) {
    doc.classList.add('fine');
    var dot = $('.c-dot', cursor), ring = $('.c-ring', cursor);
    var px = innerWidth / 2, py = innerHeight / 2, rx = px, ry = py, run = false, last = 0, seen = false;
    cursor.style.opacity = '0';                              // до первого движения мыши курсора не видно
    var frame = function (now) {
      var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
      var k = reduce ? 1 : 1 - Math.pow(0.0001, dt);
      rx += (px - rx) * k; ry += (py - ry) * k;
      ring.style.transform = 'translate3d(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px,0)';
      if (Math.abs(rx - px) + Math.abs(ry - py) > 0.1) requestAnimationFrame(frame); else run = false;
    };
    addEventListener('pointermove', function (e) {
      px = e.clientX; py = e.clientY;
      if (!seen) { seen = true; rx = px; ry = py; cursor.style.opacity = ''; }
      dot.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)';
      var t = e.target.closest ? e.target : null;
      cursor.classList.toggle('hover', !!(t && t.closest('a, button')));
      if (!run) { run = true; last = performance.now(); requestAnimationFrame(frame); }
    }, { passive: true });
    addEventListener('pointerdown', function () { cursor.classList.add('down'); });
    addEventListener('pointerup', function () { cursor.classList.remove('down'); });
    document.addEventListener('pointerleave', function () { cursor.style.opacity = '0'; });
    document.addEventListener('pointerenter', function () { cursor.style.opacity = ''; });
  }

  /* «Исследовано ИИ»: подсказка по нажатию (на телефоне наведения нет) */
  var ais = $$('.label.ai');
  var closeTips = function (except) {
    ais.forEach(function (b) { if (b !== except) { b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); } });
  };
  ais.forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var on = !b.classList.contains('open');
      closeTips(b);
      b.classList.toggle('open', on); b.setAttribute('aria-expanded', String(on));
    });
  });
  document.addEventListener('click', function () { closeTips(null); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape') closeTips(null); });

  /* фильтр списка: состояние живёт в адресе (#tag=… или #label=…), так что ссылка на тег из статьи открывает отбор */
  var list = $('#list'), filter = $('#filter');
  if (list && filter) {
    var rows = $$('.a-row', list), empty = $('#empty'), chips = $$('.f-chip', filter), rowTags = $$('.tag', list);
    var apply = function () {
      var m = /^#(tag|label)=(.+)$/.exec(location.hash), kind = m && m[1], val = '';
      if (m) { try { val = decodeURIComponent(m[2]); } catch (err) { kind = null; } }
      var shown = 0;
      rows.forEach(function (r) {
        var ok = !kind || (r.getAttribute(kind === 'tag' ? 'data-tags' : 'data-labels') || '').split('|').indexOf(val) !== -1;
        r.hidden = !ok; if (ok) shown++;
      });
      chips.forEach(function (ch) {
        var on = kind ? ch.getAttribute('data-' + kind) === val : ch.hasAttribute('data-all');
        ch.classList.toggle('on', on);
        if (on) ch.setAttribute('aria-current', 'true'); else ch.removeAttribute('aria-current');
      });
      rowTags.forEach(function (t) { t.classList.toggle('on', kind === 'tag' && t.getAttribute('data-tag') === val); });
      empty.hidden = shown > 0;
    };
    // «Все» и повторное нажатие на выбранный чип снимают отбор, не дёргая страницу вверх
    filter.addEventListener('click', function (e) {
      var ch = e.target.closest && e.target.closest('.f-chip'); if (!ch) return;
      if (ch.hasAttribute('data-all') || ch.classList.contains('on')) {
        e.preventDefault();
        history.replaceState(null, '', location.pathname + location.search);
        apply();
      }
    });
    list.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('.a-empty a'); if (!a) return;
      e.preventDefault(); history.replaceState(null, '', location.pathname + location.search); apply();
    });
    addEventListener('hashchange', apply);
    apply();
  }

  /* статья: полоска чтения справа и текущий раздел в оглавлении */
  var bar = $('.progress i'), toc = $$('.toc a');
  if (bar || toc.length) {
    var heads = toc.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
    var queued = false;
    var onScroll = function () {
      queued = false;
      var max = Math.max(1, doc.scrollHeight - innerHeight);
      if (bar) bar.style.transform = 'scaleY(' + Math.min(1, scrollY / max).toFixed(3) + ')';
      var cur = -1;
      heads.forEach(function (h, i) { if (h && h.getBoundingClientRect().top < innerHeight * 0.35) cur = i; });
      toc.forEach(function (a, i) { a.classList.toggle('on', i === cur); });
    };
    addEventListener('scroll', function () { if (!queued) { queued = true; requestAnimationFrame(onScroll); } }, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    onScroll();
  }
})();
