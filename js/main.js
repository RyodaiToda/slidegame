// ゲーム画面。入力・表示・対局の進行を受け持つ。

import { CENTER, MAX_MOVES, BONUS_APPEAR_AT, initialState, movesFor, applyMove } from './rules.js';
import { LEVELS, chooseMove } from './cpu.js';

const SETTINGS_KEY = 'slide-center-settings';
const SIDE_NAMES = ['先手', '後手'];
const SIDE_CLASSES = ['first', 'second'];
const ARROW_DIRS = { ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3 };
const SWIPE_MIN_PX = 24;
const CPU_DELAY_MS = 550;

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const cellEls = [];

let settings = loadSettings();
let state = initialState();
let human = 0; // あなたの側（0=先手, 1=後手）
let level = LEVELS[0];
let pieces = []; // { el, side, cell }
let selected = null; // 選択中のコマのマス
let lastFrom = null;
let animating = false;
let humanMoved = false;
let gameId = 0; // 古い対局のタイマーを無効にするための番号

// 解析表（「つよい」「最強」用）。特殊マスの位置ごとに別の表が要る。必要になった時点でWorkerに計算させる
// bonus（-1=なし）→ { promise, val, progress, failed }
const tables = new Map();

// ---- 設定 ----

function loadSettings() {
  const settings = { level: 'normal', side: 'first', bonus: 'off' };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    if (LEVELS.some((l) => l.id === saved.level)) settings.level = saved.level;
    if (['first', 'second', 'random'].includes(saved.side)) settings.side = saved.side;
    if (['off', 'start', 'mid'].includes(saved.bonus)) settings.bonus = saved.bonus;
  } catch {
    // 保存できない環境でも遊べるようにする
  }
  return settings;
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 同上
  }
}

// ---- 表示上の向き（自分のコマが常に手前に来るよう、後手なら盤を180度回す）----

const view = (cell) => (human === 1 ? 24 - cell : cell);
const viewDir = (d) => (human === 1 ? d ^ 1 : d);

function place(piece) {
  const v = view(piece.cell);
  piece.el.style.transform = `translate(${(v % 5) * 100}%, ${Math.floor(v / 5) * 100}%)`;
}

// ---- 解析表 ----

function ensureTable(bonus) {
  if (tables.has(bonus)) return tables.get(bonus).promise;
  const entry = { val: null, progress: 0, failed: false };
  entry.promise = new Promise((resolve) => {
    const fail = () => {
      entry.failed = true;
      resolve();
    };
    try {
      const worker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        if (e.data.type === 'progress') {
          entry.progress = e.data.p;
          render();
        } else {
          entry.val = e.data.val;
          worker.terminate();
          resolve();
        }
      };
      worker.onerror = fail;
      worker.postMessage({ bonus });
    } catch {
      fail();
    }
  });
  tables.set(bonus, entry);
  return entry.promise;
}

// ---- 対局の進行 ----

function newGame(side) {
  gameId++;
  human = side;
  level = LEVELS.find((l) => l.id === settings.level);
  state = initialState(settings.bonus);
  selected = null;
  lastFrom = null;
  animating = false;
  humanMoved = false;

  for (const p of pieces) p.el.remove();
  pieces = [];
  state.pieces.forEach((cells, s) => {
    for (const cell of cells) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `piece ${SIDE_CLASSES[s]}`;
      el.style.transitionDuration = '0ms';
      boardEl.append(el);
      const piece = { el, side: s, cell };
      pieces.push(piece);
      place(piece);
    }
  });

  $('result').hidden = true;
  if (level.needsTable) {
    ensureTable(state.bonus);
    // 「途中から」の特殊マス用の表も先に作っておく（CPUが使うのは現れてから）
    if (state.hiddenBonus >= 0) ensureTable(state.hiddenBonus);
  }
  render();
  if (state.turn !== human) cpuTurn();
}

function sideFromSettings() {
  if (settings.side === 'random') return Math.random() < 0.5 ? 0 : 1;
  return settings.side === 'first' ? 0 : 1;
}

const canInput = () => !state.result && !animating && state.turn === human;

function play(move) {
  const id = gameId;
  const piece = pieces.find((p) => p.cell === move.from);
  const distance = Math.abs(move.to - move.from) >= 5
    ? Math.abs(move.to - move.from) / 5
    : Math.abs(move.to - move.from);
  const duration = 90 + 90 * distance;

  if (state.turn === human) humanMoved = true;
  state = applyMove(state, move);
  piece.cell = move.to;
  piece.el.style.transitionDuration = `${duration}ms`;
  place(piece);
  selected = null;
  lastFrom = move.from;
  animating = true;
  render();

  setTimeout(() => {
    if (id !== gameId) return;
    animating = false;
    // もう一回のときは、動かせる唯一のコマを選んだ状態にしておく
    if (state.extra && state.turn === human) selected = state.bonus;
    render();
    if (state.result) showResult();
    else if (state.turn !== human) cpuTurn();
  }, duration + 30);
}

function cpuTurn() {
  const id = gameId;
  const pause = new Promise((resolve) => setTimeout(resolve, CPU_DELAY_MS));
  // CPUが見るのは今見えている特殊マスだけ（伏せてある特殊マスの表は使わない）
  const { bonus } = state;
  const ready = level.needsTable ? Promise.all([pause, ensureTable(bonus)]) : pause;
  ready.then(() => {
    if (id !== gameId) return;
    render();
    const table = level.needsTable ? tables.get(bonus).val : null;
    play(chooseMove(level.id, state, table));
  });
}

function showResult() {
  const r = state.result;
  let text;
  let detail = `${state.moveCount}手で終局`;
  if (r.winner === null) {
    text = '引き分け';
    detail = r.reason === 'repetition'
      ? '同じ局面が3回現れました'
      : `${MAX_MOVES}手で決着がつきませんでした`;
  } else if (r.winner === human) {
    text = 'あなたの勝ち！';
  } else {
    text = 'CPUの勝ち';
  }
  $('result-text').textContent = text;
  $('result-detail').textContent = detail;
  $('result').hidden = false;
  // スマホでは結果が画面外に出やすいので見える位置までスクロール
  $('result').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---- 描画 ----

function render() {
  const targets = new Map(); // 到着マス → 手
  if (selected !== null && canInput()) {
    for (const m of movesFor(state)) {
      if (m.from === selected) targets.set(m.to, m);
    }
  }

  cellEls.forEach((el, v) => {
    const cell = view(v);
    el.classList.toggle('bonus', cell === state.bonus);
    el.classList.toggle('appear', cell === state.bonus && state.bonusAppeared);
    el.classList.toggle('target', targets.has(cell));
    el.classList.toggle('last-from', cell === lastFrom && !pieces.some((p) => p.cell === cell));
  });

  const input = canInput();
  for (const p of pieces) {
    const mine = p.side === human;
    p.el.classList.toggle('movable', mine && input && (!state.extra || p.cell === state.bonus));
    p.el.classList.toggle('selected', mine && p.cell === selected);
    p.el.classList.toggle('winner', Boolean(state.result) && p.cell === CENTER);
    p.el.tabIndex = mine ? 0 : -1;
    const v = view(p.cell);
    p.el.setAttribute(
      'aria-label',
      `${mine ? 'あなた' : 'CPU'}のコマ（上から${Math.floor(v / 5) + 1}段目、左から${(v % 5) + 1}列目）`,
    );
  }

  $('chip-you').className = `chip ${SIDE_CLASSES[human]}`;
  $('chip-cpu').className = `chip ${SIDE_CLASSES[1 - human]}`;
  $('label-you').textContent = `あなた（${SIDE_NAMES[human]}）`;
  $('label-cpu').textContent = `CPU・${level.name}（${SIDE_NAMES[1 - human]}）`;

  const entry = tables.get(state.bonus);
  let main;
  const sub = [];
  if (state.result) {
    main = '対局終了';
  } else if (state.turn === human) {
    main = state.extra ? '特殊マス！同じコマをもう一回動かせます' : 'あなたの番です';
    if (state.passed) sub.push('CPUは動かせるコマがないのでパスしました');
    else if (!humanMoved) sub.push('コマを選んで行き先をタップ（スワイプや矢印キーでも動かせます）');
  } else {
    main = state.extra ? 'CPUが特殊マスに止まりました。もう一回動きます' : 'CPUが考えています…';
    if (state.passed) sub.push('あなたは動かせるコマがないのでパスになりました');
    if (level.needsTable && entry && !entry.val && !entry.failed) {
      sub.push(`読みを準備中 ${Math.round(entry.progress * 100)}%`);
    }
  }
  if (level.needsTable && entry && entry.failed) sub.push('読みの準備に失敗したため「ふつう」相当で対戦します');
  if (!state.result && state.bonusAppeared) sub.push('特殊マス（+1）が現れました');
  if (!state.result && state.hiddenBonus >= 0) {
    sub.push(`特殊マスはあと${BONUS_APPEAR_AT - state.moveCount}手で現れます`);
  }
  if (!state.result && state.repeat === 2) sub.push('この局面は2回目です（3回目で引き分け）');
  sub.push(`${state.moveCount} / ${MAX_MOVES} 手`);
  $('status-main').textContent = main;
  $('status-sub').textContent = sub.join(' ・ ');

  return targets;
}

// ---- 入力 ----

function moveFor(cell, dir) {
  return movesFor(state).find((m) => m.from === cell && m.dir === dir);
}

function setupBoard() {
  for (let v = 0; v < 25; v++) {
    const el = document.createElement('div');
    el.className = v === CENTER ? 'cell center' : 'cell';
    boardEl.append(el);
    cellEls.push(el);
  }

  let swipe = null;
  let swiped = false;

  boardEl.addEventListener('pointerdown', (e) => {
    const piece = pieces.find((p) => p.el === e.target);
    swiped = false;
    swipe = piece && piece.side === human && canInput()
      ? { piece, x: e.clientX, y: e.clientY }
      : null;
  });

  window.addEventListener('pointercancel', () => {
    swipe = null;
  });

  // 指やマウスが盤の外で離れてもスワイプとして扱えるよう、window で受ける
  window.addEventListener('pointerup', (e) => {
    if (!swipe || !canInput()) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    const { piece } = swipe;
    swipe = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
    swiped = true;
    const shown = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : dy < 0 ? 0 : 1;
    const move = moveFor(piece.cell, viewDir(shown));
    if (move) play(move);
  });

  boardEl.addEventListener('click', (e) => {
    if (swiped) {
      swiped = false;
      return;
    }
    if (!canInput()) return;
    const piece = pieces.find((p) => p.el === e.target);
    if (piece) {
      if (piece.side !== human) return;
      if (state.extra && piece.cell !== state.bonus) return; // もう一回は同じコマだけ
      selected = selected === piece.cell ? null : piece.cell;
      render();
      return;
    }
    const v = cellEls.indexOf(e.target);
    const targets = render();
    const move = v >= 0 ? targets.get(view(v)) : undefined;
    if (move) {
      play(move);
    } else {
      selected = null;
      render();
    }
  });

  boardEl.addEventListener('keydown', (e) => {
    if (!(e.key in ARROW_DIRS)) return;
    const piece = pieces.find((p) => p.el === e.target);
    if (!piece || piece.side !== human) return;
    e.preventDefault();
    if (!canInput()) return;
    const move = moveFor(piece.cell, viewDir(ARROW_DIRS[e.key]));
    if (move) play(move);
  });
}

function setupSettings() {
  const levelBox = $('level-options');
  for (const l of LEVELS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'level';
    input.value = l.id;
    const span = document.createElement('span');
    span.textContent = l.name;
    label.append(input, span);
    levelBox.append(label);
  }

  const form = $('settings');
  form.elements.level.value = settings.level;
  form.elements.side.value = settings.side;
  form.elements.bonus.value = settings.bonus;

  form.addEventListener('change', () => {
    settings = {
      level: form.elements.level.value,
      side: form.elements.side.value,
      bonus: form.elements.bonus.value,
    };
    saveSettings();
    // まだ指していない（または終局後）なら、その場で新しい設定の対局を始める
    if (!humanMoved || state.result) newGame(sideFromSettings());
  });

  $('new-game').addEventListener('click', () => newGame(sideFromSettings()));
  $('rematch').addEventListener('click', () => newGame(1 - human));
}

setupBoard();
setupSettings();
newGame(sideFromSettings());
