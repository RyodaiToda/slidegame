// スライド・センターのルール本体。画面には触れない。
// マス番号は 行×5+列（0始まり）。行0が後手側（上）、行4が先手側（下）。

export const SIZE = 5;
export const CENTER = 12;
export const MAX_MOVES = 60; // 両者合計の手数上限
export const REPEAT_LIMIT = 3; // 同じ配置・同じ手番がこの回数現れたら引き分け

// 特殊マス（ちょうど止まればもう一回動かせる）の候補：真ん中の斜め4マス
export const BONUS_CELLS = [6, 8, 16, 18];
export const BONUS_APPEAR_AT = 10; // 「途中から」のとき、この手数が終わった時点で現れる

// 方向: 0=上 1=下 2=左 3=右（d ^ 1 で逆方向になる）
const DR = [-1, 1, 0, 0];
const DC = [0, 0, -1, 1];

// NEIGHBOR[cell * 4 + d] = 隣のマス。盤の外なら -1
export const NEIGHBOR = new Int8Array(SIZE * SIZE * 4);
for (let cell = 0; cell < SIZE * SIZE; cell++) {
  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  for (let d = 0; d < 4; d++) {
    const nr = r + DR[d];
    const nc = c + DC[d];
    NEIGHBOR[cell * 4 + d] =
      nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE ? nr * SIZE + nc : -1;
  }
}

export function occupancy(pieces) {
  let mask = 0;
  for (const side of pieces) for (const p of side) mask |= 1 << p;
  return mask;
}

// from のコマを d 方向へ止まるまで滑らせた到着マス。動けなければ from を返す
export function slideDest(occ, from, d) {
  let cur = from;
  for (;;) {
    const n = NEIGHBOR[cur * 4 + d];
    if (n < 0 || (occ >> n) & 1) return cur;
    cur = n;
  }
}

export function legalMoves(pieces, side) {
  const occ = occupancy(pieces);
  const moves = [];
  for (const from of pieces[side]) {
    for (let d = 0; d < 4; d++) {
      const to = slideDest(occ, from, d);
      if (to !== from) moves.push({ from, to, dir: d });
    }
  }
  return moves;
}

// 今の手番で指せる手。「もう一回」のときは特殊マスにいるコマだけ
export function movesFor(state) {
  const moves = legalMoves(state.pieces, state.turn);
  return state.extra ? moves.filter((m) => m.from === state.bonus) : moves;
}

export function movePiece(pieces, side, move) {
  const next = [pieces[0].slice(), pieces[1].slice()];
  next[side][next[side].indexOf(move.from)] = move.to;
  return next;
}

export function posKey(pieces, turn, bonus = -1, extra = false) {
  const a = pieces[0].slice().sort((x, y) => x - y);
  const b = pieces[1].slice().sort((x, y) => x - y);
  return `${a.join(',')}|${b.join(',')}|${turn}|${bonus}|${extra ? 1 : 0}`;
}

// bonusMode: 'off'（なし） / 'start'（最初から） / 'mid'（途中から）
// 特殊マスの位置は斜め4マスからランダムに選ぶ。'mid' では BONUS_APPEAR_AT 手が終わるまで伏せておく
export function initialState(bonusMode = 'off', rng = Math.random) {
  // 先手=行5の列1・2・5、後手=行1の列1・4・5（真ん中について点対称）
  const pieces = [
    [20, 21, 24],
    [0, 3, 4],
  ];
  const cell = BONUS_CELLS[Math.floor(rng() * BONUS_CELLS.length)];
  const bonus = bonusMode === 'start' ? cell : -1;
  const hiddenBonus = bonusMode === 'mid' ? cell : -1;
  const counts = new Map([[posKey(pieces, 0, bonus), 1]]);
  return {
    pieces,
    turn: 0,
    moveCount: 0,
    bonus, // 今有効な特殊マス（-1 ならなし）
    hiddenBonus, // まだ現れていない特殊マス
    bonusAppeared: false, // 直前の手のあとに特殊マスが現れたか
    extra: false, // 特殊マスに止まって、同じコマをもう一回動かせる手番か
    counts,
    repeat: 1,
    passed: false,
    result: null,
  };
}

// result: null（続行） / { winner: 0|1 } / { winner: null, reason: 'repetition'|'moves' }
export function applyMove(state, move) {
  const side = state.turn;
  const pieces = movePiece(state.pieces, side, move);
  const next = {
    pieces,
    turn: side,
    moveCount: state.moveCount + 1,
    bonus: state.bonus,
    hiddenBonus: state.hiddenBonus,
    bonusAppeared: false,
    extra: false,
    counts: new Map(state.counts),
    repeat: 1,
    passed: false,
    result: null,
  };

  // 真ん中で「止まった」ときだけ勝ち（通過は到着マスにならない）
  if (move.to === CENTER) {
    next.result = { winner: side };
    return next;
  }

  if (move.to === state.bonus) {
    // 特殊マスにちょうど止まった → 同じコマをもう一回。来た方向へは必ず戻れるのでパスにはならない
    next.extra = true;
  } else if (legalMoves(pieces, 1 - side).length === 0) {
    // 相手に動かせるコマがなければパス（手数には数えない）
    next.passed = true;
  } else {
    next.turn = 1 - side;
  }

  // 「途中から」の特殊マスが現れる
  if (next.hiddenBonus >= 0 && next.moveCount >= BONUS_APPEAR_AT) {
    next.bonus = next.hiddenBonus;
    next.hiddenBonus = -1;
    next.bonusAppeared = true;
  }

  const key = posKey(pieces, next.turn, next.bonus, next.extra);
  next.repeat = (next.counts.get(key) || 0) + 1;
  next.counts.set(key, next.repeat);

  if (next.repeat >= REPEAT_LIMIT) next.result = { winner: null, reason: 'repetition' };
  else if (next.moveCount >= MAX_MOVES) next.result = { winner: null, reason: 'moves' };
  return next;
}
