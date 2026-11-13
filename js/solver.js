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

// 戻り値 val[posIndex] : 0=引き分け、+n=手番側がn手で勝ち、-n=手番側がn手で負け（手数は両者合計）
export function solve(onProgress = () => {}) {
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

  const val = new Int8Array(NC * NC);
  const remaining = new Uint8Array(NC * NC); // まだ「相手の勝ち」と確定していない子の数
  const queue = new Int32Array(NC * NC);
  let head = 0;
  let tail = 0;
  const passParent = new Map(); // 子局面 → パスでそこへ進む局面
  let positions = 0;
  let passCount = 0;

  // 1) 各局面の合法手を数え、1手で勝てる局面を起点にする
  for (let mi = 0; mi < NC; mi++) {
    if ((mi & 127) === 0) onProgress((mi / NC) * 0.4);
    const mm = masks[mi];
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
          let cur = from;
          for (;;) {
            const nb = NEIGHBOR[cur * 4 + d];
            if (nb < 0 || (occ >> nb) & 1) break;
            cur = nb;
          }
          if (cur !== from) {
            n++;
            if (cur === CENTER) win = true;
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
    }
  }

  // 2) 確定した局面から、1手前の局面へさかのぼる
  let v = 0;
  const settle = (p) => {
    if (val[p] !== 0) return;
    if (v < 0) {
      // 相手を負け局面にできる → 勝ち（幅優先なので最短）
      val[p] = 1 - v;
      queue[tail++] = p;
    } else if (--remaining[p] === 0) {
      // どの手も相手の勝ち → 負け（最後に確定した子が最長）
      val[p] = -(v + 1);
      queue[tail++] = p;
    }
  };

  while (head < tail) {
    if ((head & 65535) === 0) onProgress(0.4 + 0.6 * (head / Math.max(tail, positions * 0.47)));
    const q = queue[head++];
    v = val[q];
    const mi = Math.floor(q / NC);
    const oi = q - mi * NC;
    const occ = masks[mi] | masks[oi];

    // 直前に動いたのは相手側（oi）のコマ。止まった理由のある向きについて元の位置を列挙する
    for (let k = 0; k < 3; k++) {
      const p = cells[oi * 3 + k];
      const o1 = cells[oi * 3 + ((k + 1) % 3)];
      const o2 = cells[oi * 3 + ((k + 2) % 3)];
      for (let d = 0; d < 4; d++) {
        const stop = NEIGHBOR[p * 4 + d];
        if (stop >= 0 && !((occ >> stop) & 1)) continue; // この向きでは p で止まらない
        const back = d ^ 1;
        let cur = NEIGHBOR[p * 4 + back];
        while (cur >= 0 && !((occ >> cur) & 1)) {
          if (cur !== CENTER) settle(comboRank(cur, o1, o2) * NC + mi);
          cur = NEIGHBOR[cur * 4 + back];
        }
      }
    }

    const pp = passParent.get(q);
    if (pp !== undefined) settle(pp);
  }

  let wins = 0;
  let losses = 0;
  let maxDepth = 0;
  for (let i = 0; i < val.length; i++) {
    const x = val[i];
    if (x > 0) wins++;
    else if (x < 0) losses++;
    if (x > maxDepth) maxDepth = x;
    if (-x > maxDepth) maxDepth = -x;
  }
  onProgress(1);
  return {
    val,
    stats: { positions, wins, losses, draws: positions - wins - losses, maxDepth, passCount },
  };
}
