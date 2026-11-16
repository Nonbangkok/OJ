/** What one drop on the testcase FileDrop means (§7.9: one FileDrop for the set). */
export type TestcaseDropPlan =
  | { kind: 'append'; pairs: Array<{ input: File; output: File | null }> }
  | { kind: 'zip'; archive: File }
  | { kind: 'invalid'; reason: string };

export const TESTCASE_DROP_ACCEPT = ['.in', '.out', '.ans', '.zip'];
const OUTPUT_EXTENSIONS = new Set(['out', 'ans']);

const split = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? { stem: name, ext: '' } : { stem: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
};

/**
 * `05.in` + `05.out` (or `.ans`) append one case each — the output is optional;
 * a single `.zip` replaces every testcase. Anything else is refused with a reason.
 */
export function planTestcaseDrop(files: File[]): TestcaseDropPlan {
  const zips = files.filter((file) => split(file.name).ext === 'zip');
  if (zips.length > 0) {
    return files.length === 1 ? { kind: 'zip', archive: zips[0] } : { kind: 'invalid', reason: 'Drop a .zip on its own — it replaces every testcase.' };
  }
  const cases = new Map<string, { inputs: File[]; outputs: File[] }>();
  for (const file of files) {
    const { stem, ext } = split(file.name);
    if (ext !== 'in' && !OUTPUT_EXTENSIONS.has(ext)) {
      return { kind: 'invalid', reason: `${file.name} is not a .in, .out, .ans or .zip file.` };
    }
    const entry = cases.get(stem) ?? { inputs: [], outputs: [] };
    (ext === 'in' ? entry.inputs : entry.outputs).push(file);
    cases.set(stem, entry);
  }
  const pairs: Array<{ input: File; output: File | null }> = [];
  for (const [stem, { inputs, outputs }] of cases) {
    if (inputs.length === 0) return { kind: 'invalid', reason: `${outputs[0].name} has no matching ${stem}.in.` };
    if (inputs.length > 1) return { kind: 'invalid', reason: `Case ${stem} has more than one input file.` };
    if (outputs.length > 1) return { kind: 'invalid', reason: `Case ${stem} has more than one output file.` };
    pairs.push({ input: inputs[0], output: outputs[0] ?? null });
  }
  pairs.sort((a, b) => a.input.name.localeCompare(b.input.name, undefined, { numeric: true }));
  return { kind: 'append', pairs };
}
