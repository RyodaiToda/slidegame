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

log(failed ? `\n${failed} 件が不一致` : '\nすべて一致');
if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
