import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { AuthoringSpool } = require('/runner/authoring/spool.js');
const { jobResultSchema } = require('/runner/authoring/protocol.js');
let verifyAll;
try { ({ verifyAll } = require('/runner/authoring/verify.js')); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const echo = '#include <iostream>\nint main(){std::cout << std::cin.rdbuf();}';

test('Verify All uses stored pairs, optional compile-only generator, and bounded isolated execution', async () => {
  assert.equal(typeof verifyAll, 'function', 'Verify All runner must exist');
  const root = await mkdtemp('/work/verify-test-'); await chmod(root, 0o755);
  try {
    const spool = new AuthoringSpool(path.join(root, 'spool')); await spool.initialize();
    const avatar = await readFile('/fixtures/red-gate-logo-alpha.png');
    const meta = (content, filename) => ({ filename, sizeBytes: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex') });
    const document = { templateVersion: 'red-gate-v1', title: 'Verify', taskCode: 'verify', akaName: 'Author',
      realName: 'Author', language: 'English', countryCode: 'THA', statementHtml: '<p>Echo the input.</p>' };
    async function run({ source = echo, generatorSource, inputs = [' \talpha\r\nbeta\n'], expected = ['alpha\nbeta\t\n'],
      limits = { timeLimitMs: 1000, memoryLimitMb: 256 }, tamper, statementHtml, signal } = {}) {
      const cases = inputs.map((text, index) => ({ ...meta(text, `${index + 1}.in`), caseId: randomUUID(), caseNumber: index + 1 }));
      const job = { version: 1, jobId: randomUUID(), draftId: randomUUID(), revision: 1, kind: 'verify_all', source,
        ...(generatorSource === undefined ? {} : { generatorSource }), cases,
        expectedOutputs: cases.map((c, i) => ({ ...c, ...meta(expected[i], c.filename) })), limits,
        deadline: new Date(Date.now() + 120_000).toISOString(),
        pdf: { document: { ...document, ...(statementHtml ? { statementHtml } : {}) }, assets: [],
          avatar: { ...meta(avatar, 'avatar.png'), mimeType: 'image/png' } } };
      await spool.deliver(job, async i => inputs[i], async name => name === 'avatar' ? avatar
        : Buffer.from(expected[cases.findIndex(c => name === `output:${c.caseId}`)]));
      await spool.claim();
      if (tamper) await writeFile(path.join(spool.root, 'active', job.jobId, 'expected', '0.txt'), 'tampered');
      const result = await verifyAll(job, root, spool, { signal });
      assert.equal(jobResultSchema.safeParse(result).success, true, JSON.stringify(result));
      assert.equal(result.outputs, undefined); assert.equal(result.inputs, undefined);
      assert.equal(result.verification.peakMemoryBytes, null); assert.ok(result.verification.warnings.length);
      assert.deepEqual(await readdir(path.join(spool.root, 'staging')), []);
      if (result.status === 'succeeded') {
        assert.equal((await spool.readPdf(job.jobId, result.pdf)).subarray(0, 5).toString(), '%PDF-');
        assert.deepEqual(await readdir(path.join(spool.root, 'artifacts', job.jobId)), ['document.pdf']);
      } else assert.equal(result.pdf, undefined);
      await spool.cleanup(job.jobId);
      return { result, cases };
    }
    const success = (await run()).result;
    assert.equal(success.status, 'succeeded', JSON.stringify(success));
    assert.deepEqual(success.verification.checks, { pdf: 'passed', solution: 'passed', generator: 'skipped', execution: 'passed' });
    // 14 input bytes + 12 expected bytes, including CR/LF/tab characters.
    assert.equal(success.verification.caseCount, 1); assert.equal(success.verification.totalTestcaseBytes, 26);
    assert.equal(success.verification.cases.length, 1);
    const optional = (await run({ generatorSource: 'int main(){for(;;){}}' })).result;
    assert.equal(optional.status, 'succeeded', JSON.stringify(optional));
    assert.equal(optional.verification.checks.generator, 'passed');
    assert.ok(optional.verification.warnings.some(warning => /reproducib/i.test(warning)));
    const wrong = await run({ inputs: ['one', 'two', 'three'], expected: ['one', 'wrong', 'three'] });
    assert.equal(wrong.result.errorCode, 'wrong_answer');
    assert.equal(wrong.result.failedCase.caseId, wrong.cases[1].caseId);
    assert.equal(wrong.result.verification.cases.length, 2);
    const spaced = (await run({ inputs: ['one  two'], expected: ['one two'] })).result;
    assert.equal(spaced.errorCode, 'wrong_answer');
    const generator = (await run({ generatorSource: 'not C++' })).result;
    assert.equal(generator.errorCode, 'compile_error');
    assert.equal(generator.verification.checks.solution, 'passed');
    assert.equal(generator.verification.checks.generator, 'failed');
    assert.equal(generator.verification.checks.execution, 'pending'); assert.match(generator.log, /generator/);
    for (const [config, code] of [
      [{ source: 'not C++' }, 'compile_error'],
      [{ source: '#include "/etc/passwd"\nint main(){}' }, 'forbidden_include'],
      [{ source: 'int main(){return 17;}' }, 'solution_runtime_error'],
      [{ source: 'int main(){for(;;){}}', limits: { timeLimitMs: 60, memoryLimitMb: 256 } }, 'solution_timeout'],
      [{ source: '#include <unistd.h>\nint main(){char x[65536]={};for(;;)write(1,x,sizeof x);}' }, 'solution_output_limit'],
      [{ tamper: true }, 'invalid_expected_outputs'],
      [{ statementHtml: '<script>unsafe()</script>' }, 'invalid_statement'],
      [{ signal: AbortSignal.abort() }, 'runner_interrupted'],
    ]) {
      const result = (await run(config)).result;
      assert.equal(result.errorCode, code, JSON.stringify(result));
    }
    const diagnostics = (await run({ source: '#warning SOLUTION_WARNING\n' + echo,
      generatorSource: '#warning GENERATOR_WARNING\nint main(){}' })).result;
    assert.equal(diagnostics.status, 'succeeded', JSON.stringify(diagnostics));
    assert.match(diagnostics.log, /SOLUTION_WARNING/); assert.match(diagnostics.log, /GENERATOR_WARNING/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
