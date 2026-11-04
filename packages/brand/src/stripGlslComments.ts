/**
 * Removes comments and redundant whitespace from GLSL source. The line count is kept, so a driver's `0:N` message
 * names line N of the unstripped source. A `//` comment ends at the line end unless the line ends in a backslash.
 */
export function stripGlslComments(source: string): string {
  const text = source.replace(/\r\n?/g, '\n');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      for (;;) {
        const end = text.indexOf('\n', i);
        if (end < 0) {
          i = text.length;
          break;
        }
        const continued = text[end - 1] === '\\';
        i = end;
        if (!continued) break;
        out += '\n';
        i = end + 1;
      }
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`Unterminated block comment in GLSL source at line ${lineOf(text, i)}`);
      out += ' ' + text.slice(i + 2, end).replace(/[^\n]/g, '');
      i = end + 2;
    } else {
      out += text[i];
      i += 1;
    }
  }
  const lines = out.split('\n');
  return lines
    .map((line, n) => {
      const body = line.trim().replace(/\s+/g, ' ');
      // A continued line joins the previous one without an added space, so its own leading space is meaning.
      const continued = n > 0 && lines[n - 1]!.trimEnd().endsWith('\\') && /^\s/.test(line);
      return continued && body !== '' ? ' ' + body : body;
    })
    .join('\n');
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}
