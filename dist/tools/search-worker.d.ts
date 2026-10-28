export interface SearchWorkerTask {
    id: number;
    query: string;
    lines: string[];
}
export interface SearchWorkerMatch {
    index: number;
    length: number;
}
