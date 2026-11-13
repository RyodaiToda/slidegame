// スライド・センターのルール本体。画面には触れない。
// マス番号は 行×5+列（0始まり）。行0が後手側（上）、行4が先手側（下）。

export const SIZE = 5;
export const CENTER = 12;
export const MAX_MOVES = 60; // 両者合計の手数上限
export const REPEAT_LIMIT = 3; // 同じ配置・同じ手番がこの回数現れたら引き分け

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

export function movePiece(pieces, side, move) {
  const next = [pieces[0].slice(), pieces[1].slice()];
  next[side][next[side].indexOf(move.from)] = move.to;
  return next;
}

export function posKey(pieces, turn) {
  const a = pieces[0].slice().sort((x, y) => x - y);
  const b = pieces[1].slice().sort((x, y) => x - y);
  return `${a.join(',')}|${b.join(',')}|${turn}`;
}

export function initialState() {
  // 先手=行5の列1・2・5、後手=行1の列1・4・5（真ん中について点対称）
  const pieces = [
    [20, 21, 24],
    [0, 3, 4],
  ];
  const counts = new Map([[posKey(pieces, 0), 1]]);
  return { pieces, turn: 0, moveCount: 0, counts, repeat: 1, passed: false, result: null };
}

// result: null（続行） / { winner: 0|1 } / { winner: null, reason: 'repetition'|'moves' }
export function applyMove(state, move) {
  const side = state.turn;
  const pieces = movePiece(state.pieces, side, move);
  const next = {
    pieces,
    turn: side,
    moveCount: state.moveCount + 1,
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

  // 相手に動かせるコマがなければパス（手数には数えない）
  if (legalMoves(pieces, 1 - side).length === 0) next.passed = true;
  else next.turn = 1 - side;

  const key = posKey(pieces, next.turn);
  next.repeat = (next.counts.get(key) || 0) + 1;
  next.counts.set(key, next.repeat);

  if (next.repeat >= REPEAT_LIMIT) next.result = { winner: null, reason: 'repetition' };
  else if (next.moveCount >= MAX_MOVES) next.result = { winner: null, reason: 'moves' };
  return next;
}
