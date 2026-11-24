(function () {
  var log = [], errs = [];
  window.addEventListener('error', function (e) { errs.push('ERR ' + e.message + ' @' + e.lineno); });
  function $(s) { return document.querySelector(s); }
  function click(sel, label) {
    var el = $(sel);
    if (!el) { errs.push('MISSING ' + (label || sel)); return false; }
    try { el.click(); } catch (e) { errs.push('THROW ' + sel + ': ' + e.message); }
    return true;
  }
  function type(sel, v) { var el = $(sel); if (!el) { errs.push('MISSING ' + sel); return; } el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  function text() { return document.body.innerText; }
  function check(cond, msg) { log.push((cond ? 'ok   ' : 'FAIL ') + msg); }
  try { localStorage.clear(); } catch (e) {}
  click('[data-act=reset]'); click('[data-act=reset-ok]');
  check(/ДЕМО-РЕЖИМ/.test(text()), 'demo banner');
  click('[data-act=connect]'); click('[data-act=connect-ok]');
  check(/Демо-кошелёк/.test(text()), 'wallet connected');
  click('[data-act=tab][data-tab=new]');
  check(!!$('[data-chart=mint] svg'), 'mint chart drawn');
  type('[data-f=amount]', '2000');
  check(/Ты внесёшь/.test($('#mint-preview').innerText), 'mint preview');
  // custom range typing
  click('[data-act=fpreset][data-v="custom"]');
  check(!!$('[data-act=fpreset][data-v="custom"].on'), 'custom preset on');
  click('[data-act=fpreset][data-v="1"]');
  click('[data-act=mint]');
  check(/Подтверждение/.test($('#modal-root').innerText), 'sign modal');
  check(/approve/.test($('#modal-root').innerText), 'approve tx shown');
  click('[data-act=sign-ok]');
  check(!$('#modal-root .modal'), 'modal closed after sign');
  check(/Результат/.test(text()), 'navigated to position page');
  click('[data-act=adv][data-h="168"]');
  check(/Прошла 1 неделя/.test($('#toasts').innerText), 'advance toast');
  ['usd', 't0', 't1', 'hold'].forEach(function (b) { click('[data-act=bench][data-v=' + b + ']'); });
  check(!!$('[data-chart=pos] svg'), 'position chart drawn');
  click('[data-act=tip][data-k=div]'); check(/Divergence/.test($('#modal-root').innerText), 'tip modal'); click('[data-act=close-modal]');
  click('[data-act=sc][data-k=crash]');
  log.push('after crash: ' + (($('.chip.out') || $('.chip.in') || $('.chip.edge') || {}).innerText));
  // rerange
  click('[data-act=rerange]');
  check(/Новая позиция/.test($('#modal-preview').innerText), 'rerange preview');
  click('[data-act=rr-go]'); click('[data-act=sign-ok]');
  check(/перенесена из #1/.test(text()), 'rerange -> new position page');
  click('[data-act=adv][data-h="24"]');
  click('[data-act=collect]'); click('[data-act=sign-ok]');
  check(/Комиссии в кошельке/.test($('#toasts').innerText), 'collect ok');
  click('[data-act=wd]'); click('[data-act=wd-set][data-v="25"]'); click('[data-act=wd-go]'); click('[data-act=sign-ok]');
  check(/выведены/.test($('#toasts').innerText), 'withdraw ok');
  click('[data-act=add]'); type('[data-f=m-amount]', '300'); click('[data-act=add-go]');
  if ($('[data-act=sign-ok]')) click('[data-act=sign-ok]');
  click('[data-act=close-pos]'); click('[data-act=sign-ok]');
  check(/Позиция закрыта/.test(text()), 'close ok');
  // wallet
  click('[data-act=tab][data-tab=wallet]');
  type('[data-f=s-amount]', '500');
  check(/Получишь/.test($('#swap-preview').innerText), 'swap preview');
  click('[data-act=swap-go]');
  var ap = $('[data-act=apmode][data-v="1"]'); if (ap) ap.click();
  click('[data-act=sign-ok]');
  check(/Обмен выполнен/.test($('#toasts').innerText), 'swap ok');
  var rv = $('[data-act=revoke]'); if (rv) { rv.click(); click('[data-act=sign-ok]'); check(/отозвано/.test($('#toasts').innerText), 'revoke ok'); }
  click('[data-act=tab][data-tab=history]'); check(/Всего транзакций/.test(text()), 'history');
  click('[data-act=tab][data-tab=learn]'); check(/Памятка безопасности/.test(text()), 'learn');
  click('[data-act=tab][data-tab=positions]'); click('[data-act=show-closed]');
  check(document.querySelectorAll('.pcard').length >= 2, 'closed positions listed');
  // gas shortage path: spend ETH
  click('[data-act=tab][data-tab=wallet]');
  var s = document.querySelector('[data-f=s-from]'); s.value = 'ETH'; s.dispatchEvent(new Event('change', { bubbles: true }));
  var t = document.querySelector('[data-f=s-to]'); t.value = 'USDC'; t.dispatchEvent(new Event('change', { bubbles: true }));
  type('[data-f=s-amount]', '9'); // больше, чем есть ETH, — должна быть ошибка
  click('[data-act=swap-go]'); click('[data-act=sign-ok]');
  check(/Не хватает/.test($('#modal-root').innerText), 'gas shortage error shown');
  click('[data-act=close-modal]');
  // persistence
  var saved = null; try { saved = localStorage.getItem('lp-trenazher-v1'); } catch (e) {}
  check(saved && saved.length > 1000, 'state saved (' + (saved ? saved.length : 0) + ' bytes)');
  var pre = document.createElement('pre'); pre.id = 'selftest';
  pre.textContent = 'SELFTEST\n' + log.concat(errs).join('\n') + '\nERRORS=' + errs.length + '\nEND';
  document.body.appendChild(pre);
})();
