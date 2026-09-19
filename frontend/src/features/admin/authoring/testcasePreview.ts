// Bound retained and rendered text by UTF-8 bytes without encoding the entire response.
export interface PreviewText {
  text: string;
  truncated: boolean;
}

export function previewText(value: string): PreviewText {
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    const size = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + size > 32 * 1024) break;
    bytes += size;
    end += character.length;
  }
  return { text: value.slice(0, end), truncated: end < value.length };
}
