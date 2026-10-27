#!/usr/bin/env node
import { main } from './app.js';
main(process.argv.slice(2)).catch(error => {
    console.error(`T Bot: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map