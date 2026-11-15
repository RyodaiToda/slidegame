// CPUの手選び。「つよい」「最強」は後退解析の表（val）を使う。
// val は今有効な特殊マス（state.bonus）で解いた表を渡すこと。伏せてある特殊マスは見ない。
//
// 特殊マスに止まると、そのコマだけをもう一回動かせる。特殊マスは★の斜めにあるので、
// もう一回の手で★に止まることはない（特殊マス経由の即勝ちはない）。

import { legalMoves, movePiece, movesFor, CENTER } from './rules.js';
import { posIndex, EXTRA } from './solver.js';

export const LEVELS = [
  { id: 'easy', name: 'よわい', needsTable: false },
  { id: 'normal', name: 'ふつう', needsTable: false },
  { id: 'hard', name: 'つよい', needsTable: true },
  { id: 'max', name: '最強', needsTable: true },
];

const HARD_SLIP_RATE = 0.3; // 「つよい」が表を見ずに打つ確率

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

const canWinNow = (pieces, side) => legalMoves(pieces, side).some((m) => m.to === CENTER);

// 特殊マスにいるコマだけの手（「もう一回」の手）
const extraMoves = (pieces, side, bonus) =>
  legalMoves(pieces, side).filter((m) => m.from === bonus);

// 表を使わない手選び。勝てる手は必ず打つ。careful なら相手の即勝ちを防ぐ
function basicMove(pieces, side, moves, careful, bonus, rng) {
  const wins = moves.filter((m) => m.to === CENTER);
  if (wins.length) return pick(wins, rng);
  if (careful) {
    const safe = moves.filter((m) => {
      const next = movePiece(pieces, side, m);
      if (m.to === bonus) {
        // もう一回の手のどれかで、相手の即勝ちを防げればよい
        return extraMoves(next, side, bonus).some(
          (r) => !canWinNow(movePiece(next, side, r), 1 - side),
        );
      }
      return !canWinNow(next, 1 - side);
    });
    if (safe.length) return pick(safe, rng);
  }
  return pick(moves, rng);
}

// その手を打った側から見た結果。+n=n手で勝ち、-n=n手で負け、0=引き分け
// 「もう一回」の手番で指す手も、普通の手と同じ式で評価できる（次は必ず相手の普通の番）
export function moveScore(val, pieces, side, move, bonus = -1) {
  if (move.to === CENTER) return 1;
  const next = movePiece(pieces, side, move);
  if (move.to === bonus) {
    // 手番は変わらず、同じコマでもう一回
    const v = val[EXTRA + posIndex(next[side], next[1 - side])];
    return v > 0 ? v + 1 : v < 0 ? v - 1 : 0;
  }
  const v = val[posIndex(next[1 - side], next[side])];
  if (v < 0) return 1 - v;
  if (v > 0) return -(v + 1);
  return 0;
}

// 引き分けの手を指したあと、相手が間違えやすいか（相手の応手のうち負けになる手の割合）
function trapScore(val, pieces, side, move, bonus) {
  const next = movePiece(pieces, side, move);
  if (move.to === bonus) {
    // もう一回：続けて指す引き分けの手のうち、いちばん罠の多いもの
    let best = 0;
    for (const m of extraMoves(next, side, bonus)) {
      if (moveScore(val, next, side, m, bonus) === 0) {
        best = Math.max(best, trapScore(val, next, side, m, bonus));
      }
    }
    return best;
  }
  const replies = legalMoves(next, 1 - side);
  if (!replies.length) return 0;
  const losing = replies.filter((r) => moveScore(val, next, 1 - side, r, bonus) < 0).length;
  return losing / replies.length;
}

// 最善手。勝ちは最短、負けは最長。引き分けなら相手が間違えやすい手を選ぶ
function bestMove(val, pieces, side, moves, bonus, rng) {
  const scored = moves.map((move) => ({
    move,
    score: moveScore(val, pieces, side, move, bonus),
  }));

  const wins = scored.filter((s) => s.score > 0);
  if (wins.length) {
    const best = Math.min(...wins.map((s) => s.score));
    return pick(wins.filter((s) => s.score === best), rng).move;
  }

  const draws = scored.filter((s) => s.score === 0);
  if (draws.length) {
    for (const s of draws) s.trap = trapScore(val, pieces, side, s.move, bonus);
    const best = Math.max(...draws.map((s) => s.trap));
    return pick(draws.filter((s) => s.trap === best), rng).move;
  }

  const longest = Math.min(...scored.map((s) => s.score));
  return pick(scored.filter((s) => s.score === longest), rng).move;
}

// val が無い（解析に失敗した）ときは「ふつう」相当で打つ
export function chooseMove(levelId, state, val, rng = Math.random) {
  const { pieces, turn, bonus } = state;
  const moves = movesFor(state);
  if (levelId === 'easy') return basicMove(pieces, turn, moves, false, bonus, rng);
  if (levelId === 'normal' || !val || (levelId === 'hard' && rng() < HARD_SLIP_RATE)) {
    return basicMove(pieces, turn, moves, true, bonus, rng);
  }
  return bestMove(val, pieces, turn, moves, bonus, rng);
}
