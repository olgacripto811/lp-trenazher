const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(process.argv[2], 'utf8');
const src = html.slice(html.indexOf('/*MODEL-START*/'), html.indexOf('/*MODEL-END*/'));
const ctx = {}; vm.createContext(ctx); vm.runInContext(src + ';this.M=LPModel;', ctx);
const M = ctx.M;
let fails = 0, n = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('FAIL:', msg); } else console.log('ok  ', msg); }
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ` (${a} vs ${b})`); }
function setEth(st, v) { st.hist.ETH.push(v); st.hist.BTC.push(st.hist.BTC.at(-1)); st.hist.USDT.push(st.hist.USDT.at(-1)); }

// 1. Full range IL matches v2 formula
for (const k of [0.5, 0.7, 1.3, 2, 4]) {
  const st = M.newState(42, Date.now()); st.connected = true;
  const p = M.pool('eth-usdc-005'), P = M.price(st, p);
  const pos = M.executePlan(st, M.planMint(st, p.id, P / M.FULL, P * M.FULL, 2000, true));
  setEth(st, M.usd(st, 'ETH') * k);
  const m = M.metrics(st, pos, 'hold');
  near(m.div / m.dep, 2 * Math.sqrt(k) / (1 + k) - 1, 1e-6, `full-range IL k=${k}`);
}
// 2. Mint value equals deposit value; wallet debited
{
  const st = M.newState(7, Date.now());
  const p = M.pool('eth-usdc-005'), P = M.price(st, p);
  const w0 = { ...st.wallet };
  const pos = M.executePlan(st, M.planMint(st, p.id, P * 0.85, P * 1.15, 3000, false));
  const a = M.amounts(pos.L, P, pos.pa, pos.pb);
  near(a.x * M.usd(st, 'ETH') + a.y, 3000, 1e-9, 'deposit value = $3000');
  near(w0.USDC - st.wallet.USDC, a.y, 1e-9, 'USDC debited');
  ok(st.wallet.ETH < w0.ETH - a.x, 'ETH debited incl gas');
  // out of range above: all token1
  setEth(st, P * 1.3);
  const b = M.amounts(pos.L, M.price(st, p), pos.pa, pos.pb);
  ok(b.x === 0 && b.y > 0, 'above range -> only USDC');
  setEth(st, P * 0.7);
  const c = M.amounts(pos.L, M.price(st, p), pos.pa, pos.pb);
  ok(c.y === 0 && c.x > 0, 'below range -> only ETH');
}
// 3. PnL components sum; fees accrue in range, not out of range
{
  const st = M.newState(11, Date.now());
  const p = M.pool('eth-usdc-005'), P = M.price(st, p);
  const posIn = M.executePlan(st, M.planMint(st, p.id, P * 0.5, P * 2, 2000, false));
  const posOut = M.executePlan(st, M.planMint(st, p.id, P * 3, P * 4, 500, false));
  M.advance(st, 24 * 7, { drift: 0, volMult: 0.2, volume: 1 });
  ok(posIn.f0 > 0 && posIn.f1 > 0, 'fees accrue in range');
  ok(posOut.f0 === 0 && posOut.f1 === 0, 'no fees out of range');
  for (const b of ['hold', 'usd', 't0', 't1']) {
    const m = M.metrics(st, posIn, b);
    near(m.total, m.div + m.fees - m.gas, 1e-9, `PnL sum bench=${b}`);
  }
  const m = M.metrics(st, posIn, 'hold');
  ok(m.feeApr > 0.005 && m.feeApr < 1, `fee APR plausible for wide range: ${m.feeApr}`);
  // collect, decrease, close
  const usdc0 = st.wallet.USDC;
  M.executePlan(st, M.planCollect(st, posIn));
  ok(st.wallet.USDC > usdc0 && posIn.f0 === 0, 'collect moves fees to wallet');
  const mc = M.metrics(st, posIn, 'usd');
  M.executePlan(st, M.planDecrease(st, posIn, 0.5));
  const md = M.metrics(st, posIn, 'usd');
  near(md.pooledUsd, mc.pooledUsd / 2, 1e-9, 'decrease 50% halves position');
  near(md.div, mc.div, 1e-9, 'decrease keeps divergence (usd)');
  M.executePlan(st, M.planClose(st, posIn));
  ok(posIn.closed && posIn.L === 0, 'close');
  const mf = M.metrics(st, posIn, 'usd');
  near(mf.total, mf.div + mf.fees - mf.gas, 1e-9, 'closed PnL sum');
}
// 4. Rerange conserves value (minus swap loss)
{
  const st = M.newState(5, Date.now());
  const p = M.pool('eth-usdc-005'), P = M.price(st, p);
  const pos = M.executePlan(st, M.planMint(st, p.id, P * 0.9, P * 1.1, 4000, false));
  setEth(st, P * 0.8);
  ok(M.status(st, pos) === 'out', 'out of range after drop');
  const P2 = M.price(st, p);
  const plan = M.planRerange(st, pos, P2 * 0.85, P2 * 1.15, false);
  const q = plan.quote;
  near(q.oldUsd, q.newUsd + q.swapLossUsd + q.dust0 * M.usd(st, 'ETH') + q.dust1, 1e-6, 'rerange value conservation');
  const w = { ...st.wallet };
  const np = M.executePlan(st, plan);
  ok(np.id !== pos.id && pos.closed && pos.to === np.id, 'rerange makes new position');
  ok(M.status(st, np) === 'in', 'new position in range');
  ok(Object.values(st.wallet).every(v => v >= 0), 'wallet non-negative');
  near(st.wallet.USDC, w.USDC + q.dust1, 1e-6, 'USDC after rerange = before + dust');
  const one = M.amounts(np.L, P2, np.pa, np.pb);
  near(one.x * M.usd(st, 'ETH') + one.y, q.newUsd, 1e-9, 'new position value');
}
// 5. Gas shortage error; approvals
{
  const st = M.newState(3, Date.now());
  const p = M.pool('eth-usdc-005'), P = M.price(st, p);
  st.wallet.ETH = 0.0001;
  let err = null; try { M.executePlan(st, M.planMint(st, p.id, P * 0.9, P * 1.1, 100, false)); } catch (e) { err = e.message; }
  ok(err && /ETH/.test(err), 'gas shortage error: ' + err);
  ok(st.positions.length === 0 && st.wallet.USDC === 10000, 'no state change on failure');
  st.wallet.ETH = 2;
  const plan = M.planMint(st, p.id, P * 0.9, P * 1.1, 1000, false);
  ok(plan.txs[0].kind === 'approve', 'approve tx for USDC first time');
  M.executePlan(st, plan, { max: { 0: true } });
  ok(st.approvals['pm:USDC'] === 'max', 'unlimited approval stored');
  const plan2 = M.planMint(st, p.id, P * 0.9, P * 1.1, 1000, false);
  ok(plan2.txs.length === 1, 'no approve needed after unlimited');
  M.executePlan(st, M.planRevoke(st, 'pm:USDC'));
  ok(!st.approvals['pm:USDC'], 'revoke');
  // insufficient token
  let e2 = null; try { M.executePlan(st, M.planMint(st, p.id, P * 0.9, P * 1.1, 50000, false)); } catch (e) { e2 = e.message; }
  ok(e2 && /Не хватает/.test(e2), 'insufficient tokens error: ' + e2);
}
// 6. Other pools work, swap, stable pool
{
  const st = M.newState(9, Date.now());
  M.executePlan(st, M.planSwap(st, 'USDC', 'WBTC', 3000));
  ok(st.wallet.WBTC > 0, 'swap USDC->WBTC');
  M.executePlan(st, M.planSwap(st, 'USDC', 'USDT', 2000));
  for (const id of ['wbtc-eth-03', 'usdc-usdt-001', 'eth-usdc-03']) {
    const p = M.pool(id), P = M.price(st, p), r = p.presets[1];
    const mx = M.maxMintValue(st, id, P * (1 - r), P * (1 + r));
    const v = Math.min(1000, mx);
    const pos = M.executePlan(st, M.planMint(st, id, P * (1 - r), P * (1 + r), v, false));
    M.advance(st, 72, null);
    const m = M.metrics(st, pos, 'hold');
    console.log('   ', id, 'value', m.pooledUsd.toFixed(2), 'fees', m.feesUsdAll.toFixed(4), 'feeApr', m.feeApr && (m.feeApr * 100).toFixed(1) + '%', 'status', m.status);
    ok(isFinite(m.total), id + ' metrics finite');
  }
  ok(Object.values(st.wallet).every(v => v >= 0), 'wallet non-negative');
}
// 7. Crash scenario & JSON roundtrip & APR estimate sanity
{
  const st = M.newState(21, Date.now());
  const p = M.pool('eth-usdc-005'), P = M.price(st, p);
  const qq = M.quoteMint(st, p.id, P * 0.85, P * 1.15, 1000);
  console.log('    est fee APR ±15% 0.05%:', (qq.feeApr * 100).toFixed(1) + '%');
  const q5 = M.quoteMint(st, p.id, P * 0.95, P * 1.05, 1000);
  console.log('    est fee APR ±5%:', (q5.feeApr * 100).toFixed(1) + '%');
  const pos = M.executePlan(st, M.planMint(st, p.id, P * 0.85, P * 1.15, 1000, false));
  const e0 = M.usd(st, 'ETH');
  M.advance(st, 24, { drift: Math.log(0.7) / 24, volMult: 1.5, volume: 3 });
  const ch = M.usd(st, 'ETH') / e0 - 1;
  console.log('    crash ETH change', (ch * 100).toFixed(1) + '%', 'status', M.status(st, pos));
  ok(ch < -0.2 && ch > -0.4, 'crash ≈ −30%');
  const st2 = JSON.parse(JSON.stringify(st));
  M.advance(st2, 24, null);
  ok(M.metrics(st2, st2.positions[0], 'hold') != null, 'state survives JSON roundtrip');
  const size = JSON.stringify(st).length;
  console.log('    state size bytes', size);
}
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
