// Fixed-width text layout for printed documents (receipts, faktur). Pure — used by the
// document builders in src/shared and by the printer encoders in the main process.

/** Word-wraps to `width` columns (long words are hard-split). Narrow receipts need it. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > width) {
      if (current) lines.push(current);
      lines.push(w.slice(0, width));
      w = w.slice(width);
      current = '';
    }
    if (!current) current = w;
    else if (current.length + 1 + w.length <= width) current += ` ${w}`;
    else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/** Pad/cut to an exact width, left-aligned. */
export function fitLeft(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padEnd(width);
}

/** Pad/cut to an exact width, right-aligned (numbers). Keeps the right end when too long. */
export function fitRight(text: string, width: number): string {
  return text.length >= width ? text.slice(text.length - width) : text.padStart(width);
}
