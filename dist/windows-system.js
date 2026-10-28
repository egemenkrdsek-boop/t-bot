import { win32 } from 'node:path';
/** System helpers must not search an untrusted launch directory or PATH. */
export function windowsSystemExecutable(name, env = process.env) {
    const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
    if (!/^(?:[a-z]:[\\/]|\\\\)/i.test(root))
        throw new Error('Windows SystemRoot must be an absolute path.');
    return name === 'powershell'
        ? win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : win32.join(root, 'System32', 'taskkill.exe');
}
//# sourceMappingURL=windows-system.js.map