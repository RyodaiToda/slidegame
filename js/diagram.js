// 遊び方ページの盤の図。<div class="board" data-first="…" data-second="…" data-move="from>to"> から組み立てる。
// data-move があれば、そのコマが滑る様子を繰り返し再生する。data-mark は強調するだけ。

const SIDE_CLASSES = ['first', 'second'];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const cellsOf = (text) => (text ? text.split(',').map(Number) : []);
const translate = (cell) => `translate(${(cell % 5) * 100}%, ${Math.floor(cell / 5) * 100}%)`;

for (const board of document.querySelectorAll('.board[data-first]')) {
  const cellEls = [];
  const bonus = board.dataset.bonus ? Number(board.dataset.bonus) : -1;
  for (let i = 0; i < 25; i++) {
    const el = document.createElement('div');
    el.className = i === 12 ? 'cell center' : i === bonus ? 'cell bonus' : 'cell';
    board.append(el);
    cellEls.push(el);
  }

  const [from, to] = board.dataset.move ? board.dataset.move.split('>').map(Number) : [];
  const mark = board.dataset.mark ? Number(board.dataset.mark) : from;
  let mover = null;

  [cellsOf(board.dataset.first), cellsOf(board.dataset.second)].forEach((cells, side) => {
    for (const cell of cells) {
      const el = document.createElement('div');
      el.className = `piece ${SIDE_CLASSES[side]}`;
      el.style.transform = translate(cell);
      el.style.transitionDuration = '0ms';
      if (cell === mark) el.classList.add('marked');
      if (cell === from) mover = el;
      board.append(el);
    }
  });

  if (!mover) continue;

  // 通り道と到着マスに印をつける
  const step = Math.sign(to - from) * (Math.abs(to - from) >= 5 ? 5 : 1);
  for (let c = from; c !== to; ) {
    c += step;
    cellEls[c].classList.add('path');
  }

  if (reduceMotion) {
    mover.style.transform = translate(to);
    continue;
  }

  const distance = Math.abs(to - from) / Math.abs(step);
  const duration = 150 + 150 * distance;
  const loop = () => {
    mover.style.transitionDuration = '0ms';
    mover.style.transform = translate(from);
    setTimeout(() => {
      mover.style.transitionDuration = `${duration}ms`;
      mover.style.transform = translate(to);
    }, 900);
    setTimeout(loop, 900 + duration + 1400);
  };
  loop();
}
