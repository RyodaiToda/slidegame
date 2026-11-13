// CPUの手選び。「つよい」「最強」は後退解析の表（val）を使う。

import { legalMoves, movePiece, CENTER } from './rules.js';
import { posIndex } from './solver.js';

export const LEVELS = [
  { id: 'easy', name: 'よわい', needsTable: false },
  { id: 'normal', name: 'ふつう', needsTable: false },
  { id: 'hard', name: 'つよい', needsTable: true },
  { id: 'max', name: '最強', needsTable: true },
];

const HARD_SLIP_RATE = 0.3; // 「つよい」が表を見ずに打つ確率

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

// 表を使わない手選び。勝てる手は必ず打つ。careful なら相手の即勝ちも防ぐ
function basicMove(pieces, side, careful, rng) {
  const moves = legalMoves(pieces, side);
  const wins = moves.filter((m) => m.to === CENTER);
  if (wins.length) return pick(wins, rng);
  if (careful) {
    const safe = moves.filter(
      (m) => !legalMoves(movePiece(pieces, side, m), 1 - side).some((r) => r.to === CENTER),
    );
    if (safe.length) return pick(safe, rng);
  }
  return pick(moves, rng);
}

// その手を打った側から見た結果。+n=n手で勝ち、-n=n手で負け、0=引き分け
export function moveScore(val, pieces, side, move) {
  if (move.to === CENTER) return 1;
  const next = movePiece(pieces, side, move);
  const v = val[posIndex(next[1 - side], next[side])];
  if (v < 0) return 1 - v;
  if (v > 0) return -(v + 1);
  return 0;
}

// 最善手。勝ちは最短、負けは最長。引き分けなら相手が間違えやすい手を選ぶ
function bestMove(val, pieces, side, rng) {
  const scored = legalMoves(pieces, side).map((move) => ({
    move,
    score: moveScore(val, pieces, side, move),
  }));

  const wins = scored.filter((s) => s.score > 0);
  if (wins.length) {
    const best = Math.min(...wins.map((s) => s.score));
    return pick(wins.filter((s) => s.score === best), rng).move;
  }

  const draws = scored.filter((s) => s.score === 0);
  if (draws.length) {
    // 相手の応手のうち「負けになる手」の割合が高いほど罠として強い
    for (const s of draws) {
      const next = movePiece(pieces, side, s.move);
      const replies = legalMoves(next, 1 - side);
      const losing = replies.filter((r) => moveScore(val, next, 1 - side, r) < 0).length;
      s.trap = replies.length ? losing / replies.length : 0;
    }
    const best = Math.max(...draws.map((s) => s.trap));
    return pick(draws.filter((s) => s.trap === best), rng).move;
  }

  const longest = Math.min(...scored.map((s) => s.score));
  return pick(scored.filter((s) => s.score === longest), rng).move;
}

// val が無い（解析に失敗した）ときは「ふつう」相当で打つ
export function chooseMove(levelId, state, val, rng = Math.random) {
  const { pieces, turn } = state;
  if (levelId === 'easy') return basicMove(pieces, turn, false, rng);
  if (levelId === 'normal' || !val) return basicMove(pieces, turn, true, rng);
  if (levelId === 'hard' && rng() < HARD_SLIP_RATE) return basicMove(pieces, turn, true, rng);
  return bestMove(val, pieces, turn, rng);
}
