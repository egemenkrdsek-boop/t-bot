/** System helpers must not search an untrusted launch directory or PATH. */
export declare function windowsSystemExecutable(name: 'powershell' | 'taskkill', env?: NodeJS.ProcessEnv): string;
