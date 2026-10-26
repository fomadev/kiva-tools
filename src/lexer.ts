// How KivaDB reads a .kva file: commands, one per line, or over several lines
// while a JSON document ({ or [) is open; `#` and `--` comment lines between
// them. The same rules as KivaDB's own src/kva.rs, so that the editor and
// `kivadb run` always agree on where a command starts and ends.

export interface Statement {
  /** 0-based line where it starts. */
  line: number;
  /** Offset of its first character in the whole text. */
  start: number;
  /** Offset just after its last character. */
  end: number;
  text: string;
}

/** Whether `text` opened a JSON document that is not closed yet. */
export function isOpen(text: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  let inJsonString = false;
  let escaped = false;
  let wordStart = true;
  for (const c of text) {
    if (depth > 0) {
      if (inJsonString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inJsonString = false;
        continue;
      }
      if (c === '"') inJsonString = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") depth--;
      if (depth === 0) wordStart = false;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ((c === "{" || c === "[") && wordStart) depth = 1;
    else if (/\s/.test(c) || c === "," || c === "(" || c === ")") {
      wordStart = true;
      continue;
    }
    wordStart = false;
  }
  return depth > 0;
}

export function isComment(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("#") || t.startsWith("--");
}

export interface SplitResult {
  statements: Statement[];
  /** A command still open at the end of the text. */
  unclosed?: Statement;
}

/** The commands of a .kva text. */
export function split(source: string): SplitResult {
  const statements: Statement[] = [];
  let pending: Statement | undefined;
  let offset = 0;
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\r$/, "");
    const lineStart = offset;
    offset += raw.length + 1;
    if (pending) {
      pending.text += "\n" + line;
      pending.end = lineStart + line.length;
    } else {
      if (!line.trim() || isComment(line)) continue;
      const indent = line.length - line.trimStart().length;
      pending = { line: i, start: lineStart + indent, end: lineStart + line.length, text: line.trimStart() };
    }
    if (!isOpen(pending.text)) {
      statements.push(pending);
      pending = undefined;
    }
  }
  return { statements, unclosed: pending };
}

/** The command that contains `offset`, or the one being typed just before it. */
export function statementAt(source: string, offset: number): Statement | undefined {
  const { statements, unclosed } = split(source);
  const all = unclosed ? [...statements, unclosed] : statements;
  return all.find((s) => offset >= s.start && offset <= s.end);
}

export type TokenKind = "word" | "string" | "backtick" | "document" | "punct";

export interface Token {
  kind: TokenKind;
  text: string;
  /** Offset in the statement text. */
  start: number;
  end: number;
}

/**
 * The tokens of one command. A word is anything up to a space, a comma or a
 * parenthesis; quoted text and JSON documents are single tokens, even when
 * unfinished (the last token of a command being typed).
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const start = i;
    if (c === '"' || c === "'" || c === "`") {
      const close = text.indexOf(c, i + 1);
      i = close < 0 ? text.length : close + 1;
      out.push({ kind: c === "`" ? "backtick" : "string", text: text.slice(start, i), start, end: i });
      continue;
    }
    if (c === "{" || c === "[") {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (; i < text.length; i++) {
        const d = text[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (d === "\\") escaped = true;
          else if (d === '"') inString = false;
          continue;
        }
        if (d === '"') inString = true;
        else if (d === "{" || d === "[") depth++;
        else if (d === "}" || d === "]") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      out.push({ kind: "document", text: text.slice(start, i), start, end: i });
      continue;
    }
    if (c === "," || c === "(" || c === ")") {
      i++;
      out.push({ kind: "punct", text: c, start, end: i });
      continue;
    }
    while (i < text.length && !/[\s,()]/.test(text[i])) {
      if (text[i] === '"' || text[i] === "'") break;
      i++;
    }
    if (i === start) i++;
    out.push({ kind: "word", text: text.slice(start, i), start, end: i });
  }
  return out;
}
