export function processBatchUpload(zipFilePath: any, onProgress: any): Promise<{
    added: never[];
    skipped: never[];
    errors: never[];
}>;
