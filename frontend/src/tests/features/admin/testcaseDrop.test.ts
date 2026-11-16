import { planTestcaseDrop } from '../../../features/admin/authoring/testcaseDrop';

const f = (name: string) => new File(['x'], name);

describe('planTestcaseDrop (one FileDrop for the testcase set)', () => {
  it('pairs inputs with outputs by name and orders cases naturally; the output is optional', () => {
    const plan = planTestcaseDrop([f('10.in'), f('2.out'), f('2.in'), f('10.ans'), f('3.in')]);
    expect(plan.kind).toBe('append');
    if (plan.kind !== 'append') return;
    expect(plan.pairs.map((p) => [p.input.name, p.output?.name ?? null])).toEqual([
      ['2.in', '2.out'], ['3.in', null], ['10.in', '10.ans'],
    ]);
  });

  it('one .zip on its own replaces the set', () => {
    const plan = planTestcaseDrop([f('cases.ZIP')]);
    expect(plan).toEqual({ kind: 'zip', archive: expect.objectContaining({ name: 'cases.ZIP' }) });
  });

  it('refuses a .zip mixed with other files, an output without its input, and duplicates', () => {
    expect(planTestcaseDrop([f('cases.zip'), f('1.in')])).toEqual({ kind: 'invalid', reason: 'Drop a .zip on its own — it replaces every testcase.' });
    expect(planTestcaseDrop([f('1.in'), f('4.out')])).toEqual({ kind: 'invalid', reason: '4.out has no matching 4.in.' });
    expect(planTestcaseDrop([f('1.out'), f('1.ans'), f('1.in')])).toEqual({ kind: 'invalid', reason: 'Case 1 has more than one output file.' });
    expect(planTestcaseDrop([f('notes.txt')])).toEqual({ kind: 'invalid', reason: 'notes.txt is not a .in, .out, .ans or .zip file.' });
  });
});
