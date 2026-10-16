// Admin "Sistem Testi" sayfası: /admin/test/api üzerinden testleri çalıştırır ve raporlar.
(function () {
  var results = document.getElementById('testResults');
  var top = document.getElementById('testTop');
  if (!results || !top) return;

  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  function run() {
    top.className = 'alert';
    top.style.background = '#eef1f6';
    top.style.borderColor = '#d8dce3';
    top.style.color = '#333';
    top.textContent = 'Testler çalışıyor…';
    results.innerHTML = '';
    fetch((window.__BASE__ || '') + '/admin/test/api', { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var groups = (data && data.groups) || [];
        var pass = 0,
          fail = 0,
          warn = 0;
        groups.forEach(function (g) {
          (g.results || []).forEach(function (x) {
            if (x.ok) pass++;
            else if (x.severity === 'warning') warn++;
            else fail++;
          });
        });
        if (fail) {
          top.className = 'alert alert-danger';
          top.textContent =
            '✗ ' +
            fail +
            ' hata' +
            (warn ? ', ' + warn + ' uyarı' : '') +
            ', ' +
            pass +
            ' test geçti.  (' +
            new Date(data.time).toLocaleString('tr-TR') +
            ')';
        } else if (warn) {
          top.className = 'alert';
          top.style.background = '#fff7e6';
          top.style.borderColor = '#f0c36d';
          top.style.color = '#7a5900';
          top.textContent =
            '✓ Hata yok — ' +
            pass +
            ' test geçti, ' +
            warn +
            ' uyarı (yapılandırma).  (' +
            new Date(data.time).toLocaleString('tr-TR') +
            ')';
        } else {
          top.className = 'alert alert-success';
          top.textContent = '✓ Tüm testler başarılı — ' + pass + ' test geçti.  (' + new Date(data.time).toLocaleString('tr-TR') + ')';
        }
        results.innerHTML = groups
          .map(function (g) {
            var rs = g.results || [];
            var f = rs.filter(function (x) {
              return !x.ok && x.severity !== 'warning';
            }).length;
            var w = rs.filter(function (x) {
              return !x.ok && x.severity === 'warning';
            }).length;
            var rows = rs
              .map(function (x) {
                var warnRow = !x.ok && x.severity === 'warning';
                var mark = x.ok ? '✓' : warnRow ? '!' : '✗';
                var cls = x.ok ? 'ok' : warnRow ? 'warn' : 'no';
                return (
                  '<tr><td style="width:26px" class="' +
                  cls +
                  '">' +
                  mark +
                  '</td>' +
                  '<td>' +
                  esc(x.name) +
                  (warnRow ? ' <span class="badge-warn">UYARI</span>' : '') +
                  '</td>' +
                  '<td class="muted">' +
                  esc(x.detail || '') +
                  '</td></tr>'
                );
              })
              .join('');
            return (
              '<div class="tg"><h3>' +
              esc(g.name) +
              ' <span class="cnt">(' +
              rs.length +
              ' test, ' +
              f +
              ' hata' +
              (w ? ', ' + w + ' uyarı' : '') +
              ')</span> ' +
              (f
                ? '<span class="badge-no">HATA</span>'
                : w
                  ? '<span class="badge-warn">UYARI</span>'
                  : '<span class="badge-ok">TAMAM</span>') +
              '</h3>' +
              '<table class="tres"><tbody>' +
              rows +
              '</tbody></table></div>'
            );
          })
          .join('');
      })
      .catch(function (e) {
        top.className = 'alert alert-danger';
        top.textContent = 'Testler çalıştırılamadı: ' + e.message;
      });
  }

  run();
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'runTest') run();
  });

  // Otomatik onarım: güvenli düzeltmeleri çalıştırıp testleri yeniler.
  var repairBox = document.getElementById('repairBox');
  var CSRF = (document.querySelector('input[name="_csrf"]') || {}).value || '';
  function repair() {
    if (repairBox)
      repairBox.innerHTML = '<div class="alert" style="background:#eef1f6;border-color:#d8dce3;color:#333">Onarım çalışıyor…</div>';
    fetch((window.__BASE__ || '') + '/admin/test/onar', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: CSRF })
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var reps = (d && d.repairs) || [];
        if (repairBox) {
          repairBox.innerHTML =
            '<div class="alert ' +
            (d.fixedCount > 0 ? 'alert-success' : 'alert') +
            '">' +
            'Otomatik onarım tamamlandı: <b>' +
            (d.fixedCount || 0) +
            '</b> düzeltme uygulandı.</div>' +
            '<table class="tres"><tbody>' +
            reps
              .map(function (x) {
                return (
                  '<tr><td style="width:26px" class="' +
                  (x.fixed ? 'ok' : '') +
                  '">' +
                  (x.fixed ? '✓' : '·') +
                  '</td><td>' +
                  esc(x.name) +
                  '</td><td class="muted">' +
                  esc(x.detail || '') +
                  '</td></tr>'
                );
              })
              .join('') +
            '</tbody></table>';
        }
        run();
      })
      .catch(function (e) {
        if (repairBox) repairBox.innerHTML = '<div class="alert alert-danger">Onarım başarısız: ' + esc(e.message) + '</div>';
      });
  }
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'repairBtn') repair();
  });
})();
