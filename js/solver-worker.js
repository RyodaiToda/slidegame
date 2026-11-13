import { solve } from './solver.js';

const { val } = solve((p) => postMessage({ type: 'progress', p }));
postMessage({ type: 'done', val }, [val.buffer]);
