import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function acquireFileLock(
  lockPath: string,
  staleMs = 30_000,
  maxWaitMs = 5_000,
): Promise<() => Promise<void>> {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  const startTime = Date.now();
  let delayMs = 25;

  while (true) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(String(process.pid), 'utf8');
      } catch (writeError) {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
        throw writeError;
      }

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await handle.close();
        } catch {
          // Ignore handle close errors
        } finally {
          await unlink(lockPath).catch(() => undefined);
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      let isStale = false;
      try {
        const st = await stat(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          isStale = true;
        } else {
          const content = await readFile(lockPath, 'utf8').catch(() => '');
          const pid = parseInt(content.trim(), 10);
          if (!pid) {
            // 0-byte kilit dosyası yarış durumu: Eğer dosya son 2 saniye içinde oluşturulmuşsa
            // başka bir süreç henüz PID yazıyor demektir; bayat sayıp silme ve bekle!
            if (Date.now() - st.mtimeMs < 2000) {
              isStale = false;
            } else {
              isStale = true;
            }
          } else if (!isProcessAlive(pid)) {
            isStale = true;
          }
        }
      } catch {
        isStale = true;
      }

      if (isStale) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= maxWaitMs) {
        const lockError = new Error(`File lock is held by another active process: ${lockPath}`) as NodeJS.ErrnoException;
        lockError.code = 'EEXIST';
        throw lockError;
      }

      const waitMs = Math.min(delayMs, Math.max(1, maxWaitMs - elapsed));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      delayMs = Math.min(delayMs * 2, 500);
    }
  }
}

export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  staleMs = 30_000,
): Promise<T> {
  const release = await acquireFileLock(lockPath, staleMs);
  try {
    return await fn();
  } finally {
    await release();
  }
}
