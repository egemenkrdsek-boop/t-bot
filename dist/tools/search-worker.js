/**
 * Regex worker for `file_search`.
 *
 * A catastrophic pattern such as `(a|a?)+$` blocks the JavaScript event loop
 * inside `RegExp.exec`; running it on a worker keeps the agent responsive and
 * lets the parent terminate the thread after a short budget. This file is
 * compiled to `dist/tools/search-worker.js` and ships inside the package.
 */
import { parentPort } from 'node:worker_threads';
if (parentPort) {
    parentPort.on('message', (task) => {
        let regex;
        try {
            regex = new RegExp(task.query);
        }
        catch (error) {
            parentPort?.postMessage({ id: task.id, error: error instanceof Error ? error.message : String(error) });
            return;
        }
        const matches = task.lines.map(line => {
            const found = regex.exec(line);
            return found ? { index: found.index, length: Math.max(1, found[0].length) } : null;
        });
        parentPort?.postMessage({ id: task.id, matches });
    });
}
//# sourceMappingURL=search-worker.js.map