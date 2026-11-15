import { solve } from './solver.js';

// { bonus } を受け取り、その特殊マスで解いた表を返す
onmessage = (e) => {
  const { bonus } = e.data;
  const { val } = solve((p) => postMessage({ type: 'progress', p }), bonus);
  postMessage({ type: 'done', val }, [val.buffer]);
};
