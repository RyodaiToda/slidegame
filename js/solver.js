// 後退解析。全局面について「手番側が何手で勝つか／負けるか／引き分けか」を求める。
// ルールは色を入れ替えても同じなので、局面は（手番側の3個, 相手の3個）だけで表せる。
// 60手上限と同一局面3回は含めない（上限なしの理論値）。

import { NEIGHBOR, CENTER } from './rules.js';

// 真ん中以外の24マスから3個選ぶ組み合わせの数
export const NC = 2024;

const to24 = (cell) => (cell < CENTER ? cell : cell - 1);
const from24 = (i) => (i < CENTER ? i : i + 1);

// 盤上の3マス（順不同、真ん中以外）→ 組み合わせ番号 0..2023
export function comboRank(a, b, c) {
  let t;
  if (a > b) { t = a; a = b; b = t; }
  if (b > c) { t = b; b = c; c = t; }
  if (a > b) { t = a; a = b; b = t; }
  a = to24(a);
  b = to24(b);
  c = to24(c);
  return a + (b * (b - 1)) / 2 + (c * (c - 1) * (c - 2)) / 6;
}

export function posIndex(mover, opp) {
  return comboRank(mover[0], mover[1], mover[2]) * NC + comboRank(opp[0], opp[1], opp[2]);
}

// 「もう一回」の局面の添字は EXTRA + posIndex（手番側の、特殊マスにいるコマだけを動かせる）
export const EXTRA = NC * NC;

// 戻り値 val : 0=引き分け、+n=手番側がn手で勝ち、-n=手番側がn手で負け（手数は両者合計）
//   val[posIndex]         普通の局面
//   val[EXTRA + posIndex] 特殊マスに止まった直後の「もう一回」の局面（bonus を指定したときだけ使う）
// bonus: 「ちょうど止まれば、同じコマをもう一回動かせる」マス（-1 ならなし）
export function solve(onProgress = () => {}, bonus = -1) {
  const cells = new Uint8Array(NC * 3);
  const masks = new Int32Array(NC);
  for (let c = 2; c < 24; c++) {
    for (let b = 1; b < c; b++) {
      for (let a = 0; a < b; a++) {
        const r = a + (b * (b - 1)) / 2 + (c * (c - 1) * (c - 2)) / 6;
        const ca = from24(a), cb = from24(b), cc = from24(c);
        cells[r * 3] = ca;
        cells[r * 3 + 1] = cb;
        cells[r * 3 + 2] = cc;
        masks[r] = (1 << ca) | (1 << cb) | (1 << cc);
      }
    }
  }

  const size = bonus >= 0 ? 2 * EXTRA : EXTRA;
  const val = new Int8Array(size);
  const remaining = new Uint8Array(size); // まだ「負け」と確定していない子の数
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  const passParent = new Map(); // 子局面 → パスでそこへ進む局面
  let positions = 0;
  let passCount = 0;

  // from のコマを d 方向へ滑らせた到着マス
  const dest = (occ, from, d) => {
    let cur = from;
    for (;;) {
      const nb = NEIGHBOR[cur * 4 + d];
      if (nb < 0 || (occ >> nb) & 1) return cur;
      cur = nb;
    }
  };

  // 1) 各局面の合法手を数え、1手で勝てる局面を起点にする
  for (let mi = 0; mi < NC; mi++) {
    if ((mi & 127) === 0) onProgress((mi / NC) * 0.4);
    const mm = masks[mi];
    const hasBonus = bonus >= 0 && (mm >> bonus) & 1;
    for (let oi = 0; oi < NC; oi++) {
      if (mm & masks[oi]) continue;
      positions++;
      const occ = mm | masks[oi];
      const idx = mi * NC + oi;
      let n = 0;
      let win = false;
      for (let k = 0; k < 3; k++) {
        const from = cells[mi * 3 + k];
        for (let d = 0; d < 4; d++) {
          const to = dest(occ, from, d);
          if (to !== from) {
            n++;
            if (to === CENTER) win = true;
          }
        }
      }
      if (win) {
        val[idx] = 1;
        queue[tail++] = idx;
      } else if (n === 0) {
        // 動かせない → パス。子は「同じ盤面で相手番」の1つだけ
        remaining[idx] = 1;
        passParent.set(oi * NC + mi, idx);
        passCount++;
      } else {
        remaining[idx] = n;
      }

      // 「もう一回」の局面：特殊マスにいるコマだけ動かせる。
      // 特殊マスは★の斜めなので、このコマで★に止まることはない。来た方向へは必ず戻れるので手は1つ以上ある
      if (hasBonus) {
        let nx = 0;
        for (let d = 0; d < 4; d++) if (dest(occ, bonus, d) !== bonus) nx++;
        remaining[EXTRA + idx] = nx;
      }
    }
  }

  // 2) 確定した局面から、1手前の局面へさかのぼる
  // w = その手を選んだときの、親局面の手番側から見た結果（+n=n手で勝ち、-n=n手で負け）
  const settle = (p, w) => {
    if (val[p] !== 0) return;
    if (w > 0) {
      // 勝てる手がある → 勝ち（幅優先なので最短）
      val[p] = w;
      queue[tail++] = p;
    } else if (--remaining[p] === 0) {
      // どの手も負け → 負け（最後に確定した子が最長）
      val[p] = w;
      queue[tail++] = p;
    }
  };

  // 今 p にいるコマ（mover3 の k 番目）が直前に動いたとして、元の位置を列挙する。
  // onlyFrom >= 0 なら、そのマスから動いた場合だけ
  const unmove = (occ, mover3, k, onlyFrom, toParent, w) => {
    const p = cells[mover3 + k];
    const o1 = cells[mover3 + ((k + 1) % 3)];
    const o2 = cells[mover3 + ((k + 2) % 3)];
    for (let d = 0; d < 4; d++) {
      const stop = NEIGHBOR[p * 4 + d];
      if (stop >= 0 && !((occ >> stop) & 1)) continue; // この向きでは p で止まらない
      const back = d ^ 1;
      let cur = NEIGHBOR[p * 4 + back];
      while (cur >= 0 && !((occ >> cur) & 1)) {
        if (cur !== CENTER && (onlyFrom < 0 || cur === onlyFrom)) {
          settle(toParent(comboRank(cur, o1, o2)), w);
        }
        cur = NEIGHBOR[cur * 4 + back];
      }
    }
  };

  while (head < tail) {
    if ((head & 65535) === 0) onProgress(0.4 + 0.6 * (head / Math.max(tail, positions * 0.47)));
    const q = queue[head++];
    const v = val[q];
    const extra = q >= EXTRA;
    const base = extra ? q - EXTRA : q;
    const mi = Math.floor(base / NC);
    const oi = base - mi * NC;
    const occ = masks[mi] | masks[oi];

    if (extra) {
      // 「もう一回」の局面へは、手番側が普通の手で特殊マスに止まって来る。手番は変わらない
      const wSame = v > 0 ? v + 1 : v - 1;
      for (let k = 0; k < 3; k++) {
        if (cells[mi * 3 + k] === bonus) unmove(occ, mi * 3, k, -1, (r) => r * NC + oi, wSame);
      }
      continue;
    }

    // 普通の局面へは、相手が普通の手か「もう一回」の手を指して来る。手番が入れ替わるので結果は逆
    const wSwap = v < 0 ? 1 - v : -(v + 1);
    for (let k = 0; k < 3; k++) {
      // 特殊マスにいるコマが最後に動いたなら、相手は今「もう一回」の番のはずなので除く
      if (cells[oi * 3 + k] === bonus) continue;
      unmove(occ, oi * 3, k, -1, (r) => r * NC + mi, wSwap);
      // 相手の「もう一回」の手：特殊マスから動いてきた
      if (bonus >= 0) unmove(occ, oi * 3, k, bonus, (r) => EXTRA + r * NC + mi, wSwap);
    }

    const pp = passParent.get(q);
    if (pp !== undefined) settle(pp, wSwap);
  }

  // 統計は普通の局面について数える（特殊マスなしの数値は仕様書と同じになる）
  let wins = 0;
  let losses = 0;
  let maxDepth = 0;
  for (let i = 0; i < size; i++) {
    const x = val[i];
    if (i < EXTRA) {
      if (x > 0) wins++;
      else if (x < 0) losses++;
    }
    if (x > maxDepth) maxDepth = x;
    if (-x > maxDepth) maxDepth = -x;
  }
  onProgress(1);
  return {
    val,
    stats: { positions, wins, losses, draws: positions - wins - losses, maxDepth, passCount },
  };
}
