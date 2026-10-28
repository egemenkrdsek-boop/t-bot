import { readFileSync } from 'node:fs';
/** Source, compiled output and Electron ASAR all place this module one level below package.json. */
export const APP_VERSION = (() => {
    try {
        const value = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
        return typeof value === 'string' && value.trim() ? value : 'development';
    }
    catch {
        return 'development';
    }
})();
export const MINIMUM_NODE_VERSION = '22.12.0';
export function supportsNodeVersion(version) {
    const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
    return Number.isInteger(major) && Number.isInteger(minor) && (major > 22 || (major === 22 && minor >= 12));
}
//# sourceMappingURL=version.js.map