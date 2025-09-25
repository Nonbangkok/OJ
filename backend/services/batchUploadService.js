const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const unzipper = require('unzipper');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const db = require('../db');

// ================================================================= //
// == Helper functions directly adapted from batch_upload.js == //
// ================================================================= //

async function processTestcasesFromZip(problemId, zipPath, log) {
  const zip = await unzipper.Open.file(zipPath);

  // Check for input/output directory structure within the zip
  const inputDirPattern = /\/input\//i;
  const outputDirPattern = /\/output\//i;

  const firstInputFile = zip.files.find(file => !file.path.startsWith('__MACOSX') && inputDirPattern.test('/' + file.path));
  const firstOutputFile = zip.files.find(file => !file.path.startsWith('__MACOSX') && outputDirPattern.test('/' + file.path));

  if (firstInputFile && firstOutputFile) {
    // --- New Logic: Handle zipped input/output directories ---
    log.push('Detected input/output directory structure inside zip.');

    const tempExtractDir = path.join(os.tmpdir(), `oj_inner_zip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
    
    try {
        await fsPromises.mkdir(tempExtractDir, { recursive: true });
        
        // Extract the entire zip to the temporary directory
        // unzipper.Open.file returns a CentralDirectory object which has an extract method.
        await zip.extract({ path: tempExtractDir });

        // Find the common base path of the input/output directories.
        // e.g., if path is 'Invasion-testcases/input/01.txt', we want 'Invasion-testcases'
        const basePathInZip = path.dirname(firstInputFile.path).split('/input')[0];
        
        const inputDir = path.join(tempExtractDir, basePathInZip, 'input');
        const outputDir = path.join(tempExtractDir, basePathInZip, 'output');

        return await processTestcasesFromInputOutputDirs(problemId, inputDir, outputDir, log);

    } finally {
        // Clean up the temporary extraction directory
        await execPromise(`rm -rf ${tempExtractDir}`);
    }

  } else {
    // --- Fallback to original logic for flat zip files ---
    log.push('Detected flat file structure inside zip.');
    const testcaseFiles = {};
    const fileRegex = /^(?:input|output)?(\d+)\.(?:in|out|txt)$/i;

    for (const file of zip.files) {
        const fileName = path.basename(file.path);
        const isJunk = file.path.startsWith('__MACOSX/') || fileName.startsWith('._');
        if (file.type !== 'File' || isJunk) continue;

        const match = fileName.match(fileRegex);
        if (match) {
            const number = parseInt(match[1], 10);
            if (!testcaseFiles[number]) testcaseFiles[number] = {};
            const lowerFileName = fileName.toLowerCase();
            if (lowerFileName.endsWith('.in') || lowerFileName.includes('input')) {
                testcaseFiles[number].in = file;
            } else if (lowerFileName.endsWith('.out') || lowerFileName.includes('output')) {
                testcaseFiles[number].out = file;
            }
        }
    }
    return processPairedFiles(problemId, testcaseFiles, (file) => file.stream(), log);
  }
}

async function processTestcasesFromInputOutputDirs(problemId, inputDir, outputDir, log) {
  let inputFilenames = (await fsPromises.readdir(inputDir)).filter(f => f !== '.DS_Store');
  let outputFilenames = (await fsPromises.readdir(outputDir)).filter(f => f !== '.DS_Store');

  if (inputFilenames.length !== outputFilenames.length) {
    log.push(`Mismatch: Found ${inputFilenames.length} input files but ${outputFilenames.length} output files. Cannot pair them.`);
    return 0;
  }

  if (inputFilenames.length === 0) {
    log.push(`No testcase files found in input/output directories.`);
    return 0;
  }

  const sortOptions = { numeric: true, sensitivity: 'base' };
  inputFilenames.sort((a, b) => a.localeCompare(b, undefined, sortOptions));
  outputFilenames.sort((a, b) => a.localeCompare(b, undefined, sortOptions));

  const testcaseFiles = {};
  for (let i = 0; i < inputFilenames.length; i++) {
    const key = i + 1; // Use 1-based indexing for pairs
    testcaseFiles[key] = {
      in: path.join(inputDir, inputFilenames[i]),
      out: path.join(outputDir, outputFilenames[i])
    };
  }
  
  return processPairedFiles(problemId, testcaseFiles, (filePath) => fsPromises.readFile(filePath), log);
}

async function processTestcasesFromFlatDir(problemId, dirPath, log) {
  const testcaseFiles = {};
  const fileRegex = /^(?:input|output)?(\d+)\.(?:in|out|txt)$/i;

  const allFiles = await fsPromises.readdir(dirPath);

  for (const fileName of allFiles) {
    const isJunk = fileName.startsWith('._') || fileName === '.DS_Store';
    if (isJunk) continue;

    const match = fileName.match(fileRegex);
    if (match) {
      const number = parseInt(match[1], 10);
      if (!testcaseFiles[number]) testcaseFiles[number] = {};
      const lowerFileName = fileName.toLowerCase();
      if (lowerFileName.endsWith('.in') || lowerFileName.includes('input')) {
        testcaseFiles[number].in = path.join(dirPath, fileName);
      } else if (lowerFileName.endsWith('.out') || lowerFileName.includes('output')) {
        testcaseFiles[number].out = path.join(dirPath, fileName);
      }
    }
  }
  return processPairedFiles(problemId, testcaseFiles, (filePath) => fsPromises.readFile(filePath), log);
}

async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function processPairedFiles(problemId, pairedFiles, readFileFunc, log) {
  const sortedKeys = Object.keys(pairedFiles).map(Number).sort((a, b) => a - b);
  const pairedCases = sortedKeys.filter(key => pairedFiles[key].in && pairedFiles[key].out);
  
  if (pairedCases.length === 0) {
    log.push(`No valid testcase pairs found.`);
    return 0;
  }

  // NOTE: Clearing testcases is now done once in processProblemDirectory
  // await db.query('DELETE FROM testcases WHERE problem_id = $1', [problemId]);

  let caseCounter = 1;
  for (const key of sortedKeys) {
    const pair = pairedFiles[key];
    // Ensure the pair is valid before processing
    if (pair && pair.in && pair.out) {
        const inputContent = await readFileFunc(pair.in);
        const outputContent = await readFileFunc(pair.out);

        const inputData = inputContent instanceof require('stream').Readable ? await streamToBuffer(inputContent) : inputContent;
        const outputData = outputContent instanceof require('stream').Readable ? await streamToBuffer(outputContent) : outputContent;

        await db.query(
            'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, $2, $3, $4)',
            [problemId, caseCounter, inputData.toString('utf-8'), outputData.toString('utf-8')]
        );
        caseCounter++;
    }
  }
  return caseCounter - 1;
}

async function processProblemDirectory(problemPath) {
    const problemDirName = path.basename(problemPath);
    const log = []; // Log for this specific problem

    // 1. Read config.json
    const configPath = path.join(problemPath, 'config.json');
    let config;
    try {
        const configFile = await fsPromises.readFile(configPath, 'utf-8');
        config = JSON.parse(configFile);
    } catch (e) {
        throw new Error(`Cannot read or parse config.json.`);
    }

    const { id: problemId, title, author, time_limit_ms, memory_limit_mb } = config;
    if (!problemId || !title || !author || !time_limit_ms || !memory_limit_mb) {
        throw new Error(`config.json is missing required fields (id, title, etc.).`);
    }

    // 2. Insert problem, skip if it exists
    const insertResult = await db.query(`
        INSERT INTO problems (id, title, author, time_limit_ms, memory_limit_mb, is_visible)
        VALUES ($1, $2, $3, $4, $5, false)
        ON CONFLICT (id) DO NOTHING;
    `, [problemId, title, author, time_limit_ms, memory_limit_mb]);

    if (insertResult.rowCount === 0) {
        return { status: 'skipped', problemId };
    }

    // --- Problem was newly inserted, proceed with file uploads ---
    
    const filesInProblemDir = await fsPromises.readdir(problemPath);

    // 3. Process PDF
    const pdfFileName = filesInProblemDir.find(f => f.toLowerCase().endsWith('.pdf'));
    if (pdfFileName) {
        try {
            const pdfPath = path.join(problemPath, pdfFileName);
            const pdfBuffer = await fsPromises.readFile(pdfPath);
            await db.query('UPDATE problems SET problem_pdf = $1 WHERE id = $2', [pdfBuffer, problemId]);
            log.push(`Uploaded ${pdfFileName}.`);
        } catch (e) {
            log.push(`ERROR: Could not read PDF file ${pdfFileName}.`);
        }
    } else {
        log.push('No .pdf file found, skipping PDF upload.');
    }

    // 4. Clear existing testcases before inserting new ones
    await db.query('DELETE FROM testcases WHERE problem_id = $1', [problemId]);

    // 5. Process testcases
    const zipFileName = filesInProblemDir.find(f => f.toLowerCase().endsWith('.zip'));
    let testcasesFound = false;

    if (zipFileName) {
        const zipPath = path.join(problemPath, zipFileName);
        try {
            const processedCount = await processTestcasesFromZip(problemId, zipPath, log);
            log.push(`Processed ${processedCount} test cases from ${zipFileName}.`);
            testcasesFound = true;
        } catch(e) {
            log.push(`ERROR: Failed to process zip file ${zipFileName}.`);
        }
    } else {
        const subdirectories = (await fsPromises.readdir(problemPath, { withFileTypes: true }))
            .filter(d => d.isDirectory())
            .map(d => d.name);

        for (const dirName of subdirectories) {
            const testcaseRootPath = path.join(problemPath, dirName);

            // --- Attempt 1: Look for input/output sub-subdirectories ---
            const inputPath = path.join(testcaseRootPath, 'input');
            const outputPath = path.join(testcaseRootPath, 'output');

            try {
                const inputStats = await fsPromises.stat(inputPath);
                const outputStats = await fsPromises.stat(outputPath);

                if (inputStats.isDirectory() && outputStats.isDirectory()) {
                    const processedCount = await processTestcasesFromInputOutputDirs(problemId, inputPath, outputPath, log);
                    if (processedCount > 0) {
                        log.push(`Processed ${processedCount} test cases from '${dirName}/input-output' subdirectories.`);
                        testcasesFound = true;
                    }
                }
            } catch (e) {
                // This structure doesn't exist, so we will try the next method below.
            }

            // --- Attempt 2: If not found above, look for flat files in the directory itself ---
            if (!testcasesFound) {
                try {
                    const processedCount = await processTestcasesFromFlatDir(problemId, testcaseRootPath, log);
                    if (processedCount > 0) {
                        log.push(`Processed ${processedCount} flat test cases from '${dirName}/' directory.`);
                        testcasesFound = true;
                    }
                } catch (flatDirError) {
                    // This directory also doesn't contain valid flat testcases, log nothing and continue.
                }
            }

            if (testcasesFound) {
                break; // Found and processed, stop searching in other directories
            }
        }
    }
    
    if (!testcasesFound) {
        log.push('No .zip file or valid testcase directory found.');
    }

    return { status: 'added', problemId, log };
}

// ================================================================= //
// == Main exported function for the API == //
// ================================================================= //

async function processBatchUpload(zipFilePath) {
  const results = { added: [], skipped: [], errors: [] };
  const tempDir = path.join(os.tmpdir(), `oj_batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  
  try {
    await fsPromises.mkdir(tempDir, { recursive: true });
    
    // Using a more robust method to extract the zip file
    const directory = await unzipper.Open.file(zipFilePath);
    await directory.extract({ path: tempDir });

    const junkDirs = new Set(['__MACOSX', '.vscode']);
    const topLevelItems = await fsPromises.readdir(tempDir, { withFileTypes: true });
    let problemSourceDir = tempDir;

    const significantTopLevelItems = topLevelItems.filter(item => !junkDirs.has(item.name));

    if (significantTopLevelItems.length === 1 && significantTopLevelItems[0].isDirectory()) {
        problemSourceDir = path.join(tempDir, significantTopLevelItems[0].name);
    }
    
    const itemsInSource = await fsPromises.readdir(problemSourceDir);
    const problemPathsToProcess = [];

    if (itemsInSource.includes('config.json')) {
      // Case 1: The source directory itself is a single problem.
      problemPathsToProcess.push(problemSourceDir);
    } else {
      // Case 2: The source directory contains multiple problem directories.
      const dirents = await fsPromises.readdir(problemSourceDir, { withFileTypes: true });
      for (const dirent of dirents) {
        if (dirent.isDirectory() && !junkDirs.has(dirent.name)) {
          problemPathsToProcess.push(path.join(problemSourceDir, dirent.name));
        }
      }
    }

    for (const problemPath of problemPathsToProcess) {
      try {
        const result = await processProblemDirectory(problemPath);
        if (result.status === 'added') {
          results.added.push(result.problemId);
        } else if (result.status === 'skipped') {
          results.skipped.push(result.problemId);
        }
      } catch (error) {
        results.errors.push({ directory: path.basename(problemPath), message: error.message });
      }
    }
  } catch (error) {
    console.error('An unexpected error occurred during the batch upload process:', error);
    results.errors.push({ directory: 'Batch Process', message: error.message || 'A critical error occurred.' });
  } finally {
    const delay = ms => new Promise(res => setTimeout(res, ms));
    try {
        await delay(200);
        await execPromise(`rm -rf ${tempDir}`);
    } catch (err) {
        console.warn(`[Robust Cleanup] Failed to remove temp directory ${tempDir}:`, err);
    }

    try {
      await fsPromises.unlink(zipFilePath);
    } catch (unlinkError) {
      if (unlinkError.code !== 'ENOENT') {
        console.warn('Failed to delete uploaded zip file:', unlinkError);
      }
    }
  }

  return results;
}

module.exports = { processBatchUpload };