import { KEYWORDS, OPERATORS, SourceError, type Token } from './tokens';

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (source[i] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };

  while (i < source.length) {
    const c = source[i];

    if (/\s/.test(c)) {
      advance();
      continue;
    }
    if (source.startsWith('//', i)) {
      while (i < source.length && source[i] !== '\n') advance();
      continue;
    }
    if (source.startsWith('/*', i)) {
      const startLine = line;
      advance(2);
      while (i < source.length && !source.startsWith('*/', i)) advance();
      if (i >= source.length) throw new SourceError('Unterminated comment', startLine);
      advance(2);
      continue;
    }

    const startLine = line;
    const startCol = col;

    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) j++;
      const word = source.slice(i, j);
      tokens.push({ kind: KEYWORDS.has(word) ? 'keyword' : 'ident', value: word, line: startLine, col: startCol });
      advance(j - i);
      continue;
    }

    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < source.length && /[0-9_]/.test(source[j])) j++;
      let isDouble = false;
      if (source[j] === '.' && /[0-9]/.test(source[j + 1] ?? '')) {
        isDouble = true;
        j++;
        while (j < source.length && /[0-9]/.test(source[j])) j++;
      }
      let text = source.slice(i, j).replace(/_/g, '');
      const suffix = source[j];
      if (suffix === 'L' || suffix === 'l') {
        text += 'L';
        j++;
      } else if (suffix === 'd' || suffix === 'D' || suffix === 'f' || suffix === 'F') {
        isDouble = true;
        j++;
      }
      tokens.push({ kind: isDouble ? 'double' : 'int', value: text, line: startLine, col: startCol });
      advance(j - i);
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let text = '';
      while (j < source.length && source[j] !== quote) {
        if (source[j] === '\n') throw new SourceError('Unterminated literal', startLine, startCol);
        if (source[j] === '\\') {
          const esc = source[j + 1];
          text += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc === '0' ? '\0' : esc;
          j += 2;
        } else {
          text += source[j++];
        }
      }
      if (j >= source.length) throw new SourceError('Unterminated literal', startLine, startCol);
      if (quote === "'" && text.length !== 1) throw new SourceError('Invalid char literal', startLine, startCol);
      tokens.push({ kind: quote === '"' ? 'string' : 'char', value: text, line: startLine, col: startCol });
      advance(j + 1 - i);
      continue;
    }

    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (op) {
      tokens.push({ kind: 'op', value: op, line: startLine, col: startCol });
      advance(op.length);
      continue;
    }

    throw new SourceError(`Unexpected character '${c}'`, startLine, startCol);
  }

  tokens.push({ kind: 'eof', value: '', line, col });
  return tokens;
}
