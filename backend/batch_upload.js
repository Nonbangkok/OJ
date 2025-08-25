const fs = require('fs').promises;
const path = require('path');
const unzipper = require('unzipper');
const db = require('./db');

const problemSourceDir = path.join(__dirname, 'problem_source');

async function processTestcasesFromZip(problemId, zipPath) {
  const zip = await unzipper.Open.file(zipPath);
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

  return processPairedFiles(problemId, testcaseFiles, async (file) => file.buffer());
}

async function processTestcasesFromInputOutputDirs(problemId, inputDir, outputDir) {
  // 1. อ่านไฟล์จากทั้งสองโฟลเดอร์
  let inputFilenames = await fs.readdir(inputDir);
  let outputFilenames = await fs.readdir(outputDir);

  // 2. กรองไฟล์ของระบบที่ไม่จำเป็นออกไป
  inputFilenames = inputFilenames.filter(f => f !== '.DS_Store');
  outputFilenames = outputFilenames.filter(f => f !== '.DS_Store');

  // 3. ตรวจสอบว่าจำนวนไฟล์เท่ากันหรือไม่
  if (inputFilenames.length !== outputFilenames.length) {
    console.log(`    - Mismatch: Found ${inputFilenames.length} input files but ${outputFilenames.length} output files. Cannot pair them.`);
    return 0;
  }

  if (inputFilenames.length === 0) {
    console.log(`    - No testcase files found in input/output directories.`);
    return 0;
  }

  // 4. เรียงลำดับไฟล์ทั้งสองชุดเพื่อให้แน่ใจว่าลำดับการจับคู่ถูกต้อง
  const sortOptions = { numeric: true, sensitivity: 'base' };
  inputFilenames.sort((a, b) => a.localeCompare(b, undefined, sortOptions));
  outputFilenames.sort((a, b) => a.localeCompare(b, undefined, sortOptions));

  const testcaseFiles = {};
  let caseCounter = 1;

  // 5. จับคู่ไฟล์ตามลำดับที่เรียงแล้ว
  for (let i = 0; i < inputFilenames.length; i++) {
    const key = caseCounter++;
    testcaseFiles[key] = {
      in: path.join(inputDir, inputFilenames[i]),
      out: path.join(outputDir, outputFilenames[i])
    };
  }
  
  // 6. ส่งต่อ object ที่จับคู่แล้วไปให้ฟังก์ชัน processPairedFiles
  return processPairedFiles(problemId, testcaseFiles, (filePath) => fs.readFile(filePath));
}

async function processPairedFiles(problemId, pairedFiles, readFileFunc) {
  const sortedKeys = Object.keys(pairedFiles).map(Number).sort((a, b) => a - b);
  const pairedCases = sortedKeys.filter(key => pairedFiles[key].in && pairedFiles[key].out);
  
  if (pairedCases.length === 0) {
    console.log(`    - No valid testcase pairs found.`);
    return 0;
  }

  let caseCounter = 1;
  for (const key of pairedCases) {
    const pair = pairedFiles[key];
    const inputData = await readFileFunc(pair.in);
    const outputData = await readFileFunc(pair.out);

    await db.query(
      'INSERT INTO testcases (problem_id, case_number, input_data, output_data) VALUES ($1, $2, $3, $4)',
      [problemId, caseCounter, inputData.toString('utf-8'), outputData.toString('utf-8')]
    );
    caseCounter++;
  }
  return pairedCases.length;
}


async function batchUpload() {
  console.log('Starting batch upload process...');
  try {
    const problemDirs = await fs.readdir(problemSourceDir, { withFileTypes: true });

    for (const dirent of problemDirs) {
      if (dirent.isDirectory()) {
        const problemDirName = dirent.name;
        const problemPath = path.join(problemSourceDir, problemDirName);
        
        // 1. Read and process config.json to get the problem ID first
        const configPath = path.join(problemPath, 'config.json');
        let config;
        try {
          const configFile = await fs.readFile(configPath, 'utf-8');
          config = JSON.parse(configFile);
        } catch (e) {
          console.error(`\n- Skipping directory '${problemDirName}': Cannot read or parse config.json.`);
          continue;
        }

        const { id: problemId, title, author, time_limit_ms, memory_limit_mb } = config;
        if (!problemId || !title || !author || !time_limit_ms || !memory_limit_mb) {
            console.error(`\n- Skipping directory '${problemDirName}': config.json is missing required fields (id, title, etc.).`);
            continue;
        }
        
        console.log(`\nProcessing problem: ${problemId} (from directory '${problemDirName}')`);

        // 2. Upsert problem into database
        try {
          await db.query(`
            INSERT INTO problems (id, title, author, time_limit_ms, memory_limit_mb)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              author = EXCLUDED.author,
              time_limit_ms = EXCLUDED.time_limit_ms,
              memory_limit_mb = EXCLUDED.memory_limit_mb;
          `, [problemId, title, author, time_limit_ms, memory_limit_mb]);
          console.log(`  - Upserted problem metadata.`);
        } catch (dbError) {
          console.error(`  - ERROR: Failed to upsert problem ${problemId} into DB.`, dbError);
          continue;
        }

        const filesInProblemDir = await fs.readdir(problemPath);

        // 3. Process PDF file (find first .pdf)
        const pdfFileName = filesInProblemDir.find(f => f.toLowerCase().endsWith('.pdf'));
        if (pdfFileName) {
            const pdfPath = path.join(problemPath, pdfFileName);
            try {
                const pdfBuffer = await fs.readFile(pdfPath);
                await db.query('UPDATE problems SET problem_pdf = $1 WHERE id = $2', [pdfBuffer, problemId]);
                console.log(`  - Uploaded ${pdfFileName}.`);
            } catch (e) {
                console.error(`  - ERROR: Could not read PDF file ${pdfFileName}.`);
            }
        } else {
            console.log('  - No .pdf file found, skipping PDF upload.');
        }

        // 4. Clear existing testcases
        await db.query('DELETE FROM testcases WHERE problem_id = $1', [problemId]);

        // 5. Process testcases (find first .zip or any suitable directory)
        const zipFileName = filesInProblemDir.find(f => f.toLowerCase().endsWith('.zip'));
        let processedCount = 0;
        let testcasesFound = false;

        if (zipFileName) {
            const zipPath = path.join(problemPath, zipFileName);
            try {
                processedCount = await processTestcasesFromZip(problemId, zipPath);
                console.log(`  - Processed ${processedCount} test cases from ${zipFileName}.`);
                testcasesFound = true;
            } catch(e) {
                console.error(`  - ERROR: Failed to process zip file ${zipFileName}.`);
            }
        } else {
            // No zip found, look for a directory containing 'input' and 'output' subdirectories
            const subdirectories = (await fs.readdir(problemPath, { withFileTypes: true }))
                .filter(d => d.isDirectory())
                .map(d => d.name);

            for (const dirName of subdirectories) {
                const testcaseRootPath = path.join(problemPath, dirName);
                const inputPath = path.join(testcaseRootPath, 'input');
                const outputPath = path.join(testcaseRootPath, 'output');

                try {
                    const inputStats = await fs.stat(inputPath);
                    const outputStats = await fs.stat(outputPath);

                    if (inputStats.isDirectory() && outputStats.isDirectory()) {
                        processedCount = await processTestcasesFromInputOutputDirs(problemId, inputPath, outputPath);
                        console.log(`  - Processed ${processedCount} test cases from '${dirName}/' directory.`);
                        testcasesFound = true;
                        break; // Found and processed, stop searching
                    }
                } catch (e) {
                    // This directory doesn't have the input/output structure, continue
                }
            }
        }

        if (!testcasesFound) {
            console.log('  - No .zip file or valid testcase directory found.');
        }
      }
    }
  } catch (error) {
    console.error('\nAn unexpected error occurred during the batch upload process:', error);
  } finally {
    await db.pool.end();
    console.log('\nBatch upload process finished. Database connection closed.');
  }
}

batchUpload(); 