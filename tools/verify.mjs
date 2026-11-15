// 解析結果を仕様書の数値と照合し、CPU同士の自動対戦で強さを確かめる。
// 実行: ローカルサーバー経由で tools/verify.html を開く（Node があれば node tools/verify.mjs でも可）

import { initialState, applyMove, legalMoves, slideDest, occupancy } from '../js/rules.js';
import { solve, posIndex } from '../js/solver.js';
import { chooseMove, moveScore } from '../js/cpu.js';

const out = typeof document !== 'undefined' ? document.getElementById('out') : null;
function log(line) {
  console.log(line);
  if (out) out.textContent += line + '\n';
}

let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  log(`${ok ? 'OK ' : 'NG '} ${label}: ${actual}${ok ? '' : `（期待値 ${expected}）`}`);
}

const t0 = performance.now();
const { val, stats } = solve();
log(`解析時間: ${((performance.now() - t0) / 1000).toFixed(2)} 秒\n`);

log('— 仕様書「ゲーム性の解析」との照合 —');
check('局面数', stats.positions, 2691920);
check('手番側が必勝', stats.wins, 962836);
check('手番側が必敗', stats.losses, 282188);
check('引き分け', stats.draws, 1446896);
check('最長の必勝手順', stats.maxDepth, 45);
check('動かせるコマがない局面', stats.passCount, 4);

const init = initialState();
const firstMoves = legalMoves(init.pieces, 0);
check('初期配置の結論（0=引き分け）', val[posIndex(init.pieces[0], init.pieces[1])], 0);
check('初期配置の先手の合法手', firstMoves.length, 5);
check(
  '先手の初手で引き分けを保てる手',
  firstMoves.filter((m) => moveScore(val, init.pieces, 0, m) === 0).length,
  5,
);

log('\n— 序盤の落とし穴 —');
const UP = 0, LEFT = 2, RIGHT = 3;
function playLine(steps) {
  let s = initialState();
  for (const [from, dir] of steps) {
    const to = slideDest(occupancy(s.pieces), from, dir);
    s = applyMove(s, { from, to, dir });
  }
  return val[posIndex(s.pieces[s.turn], s.pieces[1 - s.turn])];
}
const trap1 = playLine([[24, UP], [3, LEFT]]);
const trap2 = playLine([[24, LEFT], [0, RIGHT]]);
check('列5上→列4左 は先手必勝', trap1 > 0, true);
check('列5左→列1右 は先手必勝', trap2 > 0, true);
log(`    必勝までの手数（両者合計）: ${trap1} 手 / ${trap2} 手`);

log('\n— CPU同士の自動対戦 —');
function playGame(levels) {
  let s = initialState();
  while (!s.result) s = applyMove(s, chooseMove(levels[s.turn], s, val));
  return s.result;
}
function series(a, b, games) {
  const tally = { a: 0, b: 0, draw: 0 };
  for (let i = 0; i < games; i++) {
    const aSide = i % 2;
    const r = playGame(aSide === 0 ? [a, b] : [b, a]);
    if (r.winner === null) tally.draw++;
    else if (r.winner === aSide) tally.a++;
    else tally.b++;
  }
  log(`    ${a} 対 ${b}（${games}局）: ${a} ${tally.a}勝 / ${b} ${tally.b}勝 / 引き分け ${tally.draw}`);
  return tally;
}
check('最強 対 最強 はすべて引き分け', series('max', 'max', 200).draw, 200);
check('最強は よわい に負けない', series('max', 'easy', 400).b, 0);
check('最強は ふつう に負けない', series('max', 'normal', 400).b, 0);
check('最強は つよい に負けない', series('max', 'hard', 400).b, 0);
series('hard', 'normal', 400);
series('normal', 'easy', 400);

// ---- 特殊マス（ちょうど止まればもう一回）----

log('\n— 特殊マス：ルール —');
{
  // 特殊マスを行4列2（16）に置き、行3列2（11）に相手のコマを置く。行5列2（21）を上へ → 16で止まる
  let s = initialState('start', () => 0.5); // BONUS_CELLS[2] = 16
  check('「最初から」の特殊マスの位置', s.bonus, 16);
  s = { ...s, pieces: [[20, 21, 24], [0, 4, 11]] };
  s = applyMove(s, { from: 21, to: 16, dir: UP });
  check('特殊マスに止まると同じ側がもう一回', s.turn === 0 && s.extra, true);
  const { movesFor } = await import('../js/rules.js');
  check('もう一回で動かせるのは特殊マスのコマだけ', movesFor(s).every((m) => m.from === 16), true);
  check('もう一回で動かせる手の数（下・右・左）', movesFor(s).length, 3);
  s = applyMove(s, { from: 16, to: 21, dir: 1 });
  check('もう一回のあとは相手の番', s.turn === 1 && !s.extra, true);

  let m = initialState('mid', () => 0);
  check('「途中から」は最初は特殊マスなし', m.bonus === -1 && m.hiddenBonus === 6, true);
  for (let i = 0; i < 10 && !m.result; i++) {
    const mv = legalMoves(m.pieces, m.turn).find((x) => x.to !== 12 && x.to !== m.bonus);
    m = applyMove(m, mv);
  }
  check('「途中から」は10手目のあとに現れる', m.bonus === 6 && m.bonusAppeared, true);
}

log('\n— 特殊マス：解析 —');
const { BONUS_CELLS } = await import('../js/rules.js');
const bonusTables = new Map([[-1, val]]);
const cells24 = [...Array(25).keys()].filter((c) => c !== 12);
const combos = [];
for (let a = 0; a < 24; a++) {
  for (let b = a + 1; b < 24; b++) {
    for (let c = b + 1; c < 24; c++) combos.push([cells24[a], cells24[b], cells24[c]]);
  }
}
const { EXTRA } = await import('../js/solver.js');
const expectFrom = (ws, passValue) => {
  if (!ws.length) return passValue < 0 ? 1 - passValue : passValue > 0 ? -(passValue + 1) : 0;
  if (ws.some((w) => w > 0)) return Math.min(...ws.filter((w) => w > 0));
  if (ws.every((w) => w < 0)) return Math.min(...ws);
  return 0;
};
for (const b of BONUS_CELLS) {
  const { val: t, stats: st } = solve(() => {}, b);
  bonusTables.set(b, t);
  log(`    特殊マス${b}: 勝ち${st.wins} 負け${st.losses} 引き分け${st.draws}（${((100 * st.draws) / st.positions).toFixed(1)}%） 最長${st.maxDepth}手`);
  check(`特殊マス${b}：初期配置は引き分け`, t[posIndex(init.pieces[0], init.pieces[1])], 0);
  // どの局面でも、表の値が「指せる手の先の値」から計算したものと一致するか（「もう一回」の局面も含む）
  let bad = 0;
  for (const m of combos) {
    for (const o of combos) {
      if (m.some((x) => o.includes(x))) continue;
      const pieces = [m, o];
      const moves = legalMoves(pieces, 0);
      const pass = t[posIndex(o, m)];
      if (expectFrom(moves.map((mv) => moveScore(t, pieces, 0, mv, b)), pass) !== t[posIndex(m, o)]) bad++;
      if (m.includes(b)) {
        const ws = moves.filter((mv) => mv.from === b).map((mv) => moveScore(t, pieces, 0, mv, b));
        if (expectFrom(ws, 0) !== t[EXTRA + posIndex(m, o)]) bad++;
      }
    }
  }
  check(`特殊マス${b}：表と指し手の整合しない局面`, bad, 0);
}

log('\n— 特殊マス：CPU同士の自動対戦（最初から）—');
function playBonus(levels, mode) {
  let s = initialState(mode);
  while (!s.result) s = applyMove(s, chooseMove(levels[s.turn], s, bonusTables.get(s.bonus)));
  return s.result;
}
function seriesBonus(a, b, games, mode) {
  const tally = { a: 0, b: 0, draw: 0 };
  for (let i = 0; i < games; i++) {
    const aSide = i % 2;
    const r = playBonus(aSide === 0 ? [a, b] : [b, a], mode);
    if (r.winner === null) tally.draw++;
    else if (r.winner === aSide) tally.a++;
    else tally.b++;
  }
  log(`    ${a} 対 ${b}（${mode}・${games}局）: ${a} ${tally.a}勝 / ${b} ${tally.b}勝 / 引き分け ${tally.draw}`);
  return tally;
}
check('最強 対 最強 はすべて引き分け', seriesBonus('max', 'max', 200, 'start').draw, 200);
check('最強は ふつう に負けない', seriesBonus('max', 'normal', 400, 'start').b, 0);
check('最強は つよい に負けない', seriesBonus('max', 'hard', 400, 'start').b, 0);
seriesBonus('max', 'max', 400, 'mid');

log(failed ? `\n${failed} 件が不一致` : '\nすべて一致');
if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
