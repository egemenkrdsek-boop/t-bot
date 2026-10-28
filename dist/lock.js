import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}
export async function acquireFileLock(lockPath, staleMs = 30_000, maxWaitMs = 5_000) {
    await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
    const startTime = Date.now();
    let delayMs = 25;
    while (true) {
        try {
            const handle = await open(lockPath, 'wx', 0o600);
            const ownership = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
            try {
                await handle.writeFile(ownership, 'utf8');
            }
            catch (writeError) {
                await handle.close().catch(() => undefined);
                await unlink(lockPath).catch(() => undefined);
                throw writeError;
            }
            let released = false;
            return async () => {
                if (released)
                    return;
                released = true;
                try {
                    await handle.close();
                }
                catch {
                    // Ignore handle close errors
                }
                finally {
                    // Preserve a replacement lock if this pathname no longer belongs to us.
                    if (await readFile(lockPath, 'utf8').catch(() => '') === ownership) {
                        await unlink(lockPath).catch(() => undefined);
                    }
                }
            };
        }
        catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
            let isStale = false;
            try {
                const st = await stat(lockPath);
                const content = await readFile(lockPath, 'utf8').catch(() => '');
                let pid = Number(content.trim()); // Compatibility with older PID-only locks.
                try {
                    const parsed = JSON.parse(content);
                    if (parsed && typeof parsed === 'object')
                        pid = parsed.pid;
                }
                catch { /* Invalid/incomplete locks get an age grace period below. */ }
                if (!pid) {
                    // 0-byte kilit dosyası yarış durumu: Eğer dosya son 2 saniye içinde oluşturulmuşsa
                    // başka bir süreç henüz PID yazıyor demektir; bayat sayıp silme ve bekle!
                    if (Date.now() - st.mtimeMs < Math.max(2000, staleMs)) {
                        isStale = false;
                    }
                    else {
                        isStale = true;
                    }
                }
                else if (!isProcessAlive(pid)) {
                    isStale = true;
                }
            }
            catch {
                isStale = true;
            }
            if (isStale) {
                await unlink(lockPath).catch(() => undefined);
                continue;
            }
            const elapsed = Date.now() - startTime;
            if (elapsed >= maxWaitMs) {
                const lockError = new Error(`File lock is held by another active process: ${lockPath}`);
                lockError.code = 'EEXIST';
                throw lockError;
            }
            const waitMs = Math.min(delayMs, Math.max(1, maxWaitMs - elapsed));
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            delayMs = Math.min(delayMs * 2, 500);
        }
    }
}
export async function withFileLock(lockPath, fn, staleMs = 30_000) {
    const release = await acquireFileLock(lockPath, staleMs);
    try {
        return await fn();
    }
    finally {
        await release();
    }
}
//# sourceMappingURL=lock.js.map