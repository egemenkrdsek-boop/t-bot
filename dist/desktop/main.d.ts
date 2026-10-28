/**
 * Returns a reliable workspace directory.
 * When launched via Desktop shortcut/installed exe, process.cwd() can be
 * 'AppData/Local/Programs/T Bot'. If so, prioritizes 'Desktop/T Bot' if existing,
 * or homedir() to avoid locking onto system installation folders.
 */
export declare function getDefaultWorkspace(): string;
