export interface MenuChoice {
    label: string;
    value: string;
    description?: string;
}
/** Select a fixed choice with arrow keys. Returns undefined when cancelled or not a TTY. */
export declare function selectOption(title: string, choices: MenuChoice[]): Promise<string | undefined>;
/** Read a secret without echoing its contents. */
export declare function inputSecret(prompt: string): Promise<string | undefined>;
