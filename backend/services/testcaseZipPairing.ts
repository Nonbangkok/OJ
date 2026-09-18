import path from 'path';
import { TestcasePairMap } from '../types/service';

/**
 * Shared testcase filename pairing.
 *
 * Both the admin testcase-zip replacement (`problemQueryService`) and the
 * batch-upload pipeline (`batchUploadService`) accept flat archives of files
 * named like `1.in`/`1.out`, `input1.txt`/`output1.txt`, `2.sol`, etc. This
 * module owns that single classification so the two entry points cannot drift.
 */

/** Matches `1.in`, `input2.txt`, `output3.sol`, `04.out`, … (case-insensitive). */
const TESTCASE_FILE_REGEX = /^(?:input|output)?(\d+)\.(?:in|out|txt|sol)$/i;

function isJunkEntry(entryPath: string): boolean {
    const fileName = path.basename(entryPath);
    return entryPath.startsWith('__MACOSX/') || fileName.startsWith('._');
}

/**
 * Classify one archive entry's filename into the testcase pair map.
 * Returns true when the entry was consumed as an input or output file.
 */
function classifyTestcaseEntry<TSource>(
    entryPath: string,
    source: TSource,
    pairs: TestcasePairMap<TSource>
): boolean {
    const fileName = path.basename(entryPath);
    const match = fileName.match(TESTCASE_FILE_REGEX);
    if (!match) {
        return false;
    }

    const number = Number.parseInt(match[1], 10);
    pairs[number] ??= {};

    const lowerFileName = fileName.toLowerCase();
    if (lowerFileName.endsWith('.in') || lowerFileName.includes('input')) {
        pairs[number].in = source;
        return true;
    }
    if (lowerFileName.endsWith('.out') || lowerFileName.endsWith('.sol') || lowerFileName.includes('output')) {
        pairs[number].out = source;
        return true;
    }
    return false;
}

export interface ZippedTestcaseFile {
    path: string;
    type?: string;
}

/**
 * Pair files of a flat testcase archive (zip entries) by testcase number.
 * Junk entries (`__MACOSX/…`, `._…`) and non-file entries are skipped.
 */
export function pairZippedTestcaseFiles<TSource extends ZippedTestcaseFile>(
    files: TSource[]
): TestcasePairMap<TSource> {
    const pairs: TestcasePairMap<TSource> = {};

    for (const file of files) {
        if (file.type !== 'File' || isJunkEntry(file.path)) {
            continue;
        }
        classifyTestcaseEntry(file.path, file, pairs);
    }

    return pairs;
}

/**
 * Pair filenames of an extracted flat directory by testcase number.
 * Junk filenames (`._…`, `.DS_Store`) are skipped.
 */
export function pairFlatDirTestcaseFiles(
    fileNames: string[],
    dirPath: string
): TestcasePairMap<string> {
    const pairs: TestcasePairMap<string> = {};

    for (const fileName of fileNames) {
        if (fileName.startsWith('._') || fileName === '.DS_Store') {
            continue;
        }
        classifyTestcaseEntry(fileName, path.join(dirPath, fileName), pairs);
    }

    return pairs;
}

/** Sorted testcase numbers that have both an input and an output file. */
export function fullyPairedCaseNumbers<TSource>(pairs: TestcasePairMap<TSource>): number[] {
    return Object.keys(pairs)
        .map(Number)
        .sort((a, b) => a - b)
        .filter((key) => pairs[key].in && pairs[key].out);
}
