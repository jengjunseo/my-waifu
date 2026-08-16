export interface TextSegment {
  kind: "dialogue" | "narration";
  text: string;
}

export function parseNarration(input: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = /\*([^*]+)\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    if (match.index > cursor) {
      const text = input.slice(cursor, match.index);
      if (text) segments.push({ kind: "dialogue", text });
    }
    segments.push({ kind: "narration", text: match[1] });
    cursor = match.index + match[0].length;
  }

  if (cursor < input.length) segments.push({ kind: "dialogue", text: input.slice(cursor) });
  if (segments.length === 0 && input) segments.push({ kind: "dialogue", text: input });
  return segments;
}
