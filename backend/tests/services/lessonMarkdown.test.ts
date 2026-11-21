import { LessonContentError, renderLessonMarkdown } from '../../services/lessonMarkdown';

const lesson = [
  '## ทำไมต้อง prefix sum',
  '',
  'ถ้าต้องหาผลรวมช่วงบ่อย ๆ บวกใหม่ทุกรอบช้าแน่นอน เราเตรียมไว้ก่อนดีกว่า $P_i = P_{i-1} + a_i$',
  '',
  ':::note ลองคิดก่อนนะ',
  'ใช้ `long long` ด้วยล่ะ',
  ':::',
  '',
  ':::tabs',
  '```cpp',
  'P[i] = P[i - 1] + a[i];',
  '```',
  '```python',
  'P[i] = P[i - 1] + a[i]',
  '```',
  ':::',
  '',
  ':::problem P0142',
  '',
  ':::hint',
  'ลองนึกถึง P[r] - P[l-1] ดูสิ',
  ':::',
  '',
  ':::solution P0150',
  '### โค้ดเต็ม',
  '```cpp',
  'cout << P[r] - P[l - 1];',
  '```',
  ':::',
  '',
  '![รูปอธิบาย](assets/prefix-1.png)',
].join('\n');

describe('renderLessonMarkdown', () => {
  it('turns directives into fixed data-lesson markup and keeps code blocks', () => {
    const { html, problemRefs } = renderLessonMarkdown(lesson, ['prefix-1.png']);

    expect(html).toContain('<aside data-lesson="callout" data-tone="note"><p data-lesson="callout-title">ลองคิดก่อนนะ</p>');
    expect(html).toContain('<div data-lesson="code-tabs">');
    expect(html).toContain('class="language-cpp"');
    expect(html).toContain('class="language-python"');
    expect(html).toContain('<div data-lesson="problem" data-problem="P0142"></div>');
    expect(html).toContain('<details data-lesson="hint"><summary>Hint</summary><div data-lesson="body">');
    expect(html).toContain('<details data-lesson="solution" data-problem="P0150"><summary>Solution</summary>');
    expect(html).toContain('src="{{ASSET_BASE}}/prefix-1.png"');
    expect(html).not.toMatch(/OJLESSONTOKEN/);
    expect(problemRefs).toEqual(['P0142', 'P0150']);
  });

  it('renders math outside code and leaves code untouched', () => {
    const { html } = renderLessonMarkdown('ผลรวมคือ $a+b$\n\n```cpp\nint x = 1; // $not math$\n```', []);
    expect(html).toContain('class="katex"');
    expect(html).toContain('// $not math$');
  });

  it('numbers h2/h3 headings and builds the table of contents', () => {
    const { html, toc } = renderLessonMarkdown('## นิยาม\n\nข้อความ\n\n### โค้ด & ตัวอย่าง\n\n#### ไม่นับ', []);
    expect(html).toContain('<h2 id="section-1">นิยาม</h2>');
    expect(html).toContain('<h3 id="section-2">');
    expect(toc).toEqual([
      { id: 'section-1', text: 'นิยาม', level: 2 },
      { id: 'section-2', text: 'โค้ด & ตัวอย่าง', level: 3 },
    ]);
  });

  it('ignores directive-looking lines inside fenced code', () => {
    const { html } = renderLessonMarkdown('```\n:::hint\n```', []);
    expect(html).toContain(':::hint');
    expect(html).not.toContain('data-lesson');
  });

  it('escapes directive titles', () => {
    const { html } = renderLessonMarkdown(':::hint <img src=x onerror=alert(1)>\nข้อความ\n:::', []);
    expect(html).toContain('<summary>&lt;img src=x onerror=alert(1)&gt;</summary>');
    expect(html).not.toContain('<img src=x');
  });

  it.each([
    [':::hint\nไม่ได้ปิด', ':::hint is not closed'],
    [':::', 'closes nothing'],
    [':::quiz\n:::', 'unknown directive'],
    [':::problem', 'needs a problem id'],
    [':::problem ../../etc', 'not a valid problem id'],
    [':::solution "x"\n:::', 'not a valid problem id'],
    [':::tabs cpp\n:::', 'takes no argument'],
    [':::hint\n:::hint\n:::hint\n:::hint\n:::\n:::\n:::\n:::', 'nest deeper'],
    ['```cpp\nint x;', 'not closed'],
    ['- item\n\n  :::problem P1\n', 'must start at the beginning of a line'],
  ])('rejects bad directives: %j', (source, message) => {
    expect(() => renderLessonMarkdown(source, [])).toThrow(LessonContentError);
    expect(() => renderLessonMarkdown(source, [])).toThrow(message);
  });

  it('ends a list before a directive that follows it', () => {
    const { html } = renderLessonMarkdown('- item\n:::problem P0001', []);
    expect(html).toMatch(/<\/ul>\s*<div data-lesson="problem" data-problem="P0001"><\/div>/);
  });

  it('rejects unsafe HTML through the statement sanitizer', () => {
    expect(() => renderLessonMarkdown('<script>alert(1)</script>', [])).toThrow(LessonContentError);
    expect(() => renderLessonMarkdown('<div onclick="x()">hi</div>', [])).toThrow(LessonContentError);
    expect(() => renderLessonMarkdown('[x](javascript:alert(1))', [])).toThrow(LessonContentError);
  });

  it('rejects images that are not declared assets', () => {
    expect(() => renderLessonMarkdown('![x](assets/missing.png)', ['other.png'])).toThrow(LessonContentError);
  });

  it('rejects oversized lessons', () => {
    expect(() => renderLessonMarkdown('ก'.repeat(80_000), [])).toThrow('exceeds');
  });
});
