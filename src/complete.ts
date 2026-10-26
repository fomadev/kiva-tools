// What to suggest at the cursor: commands at the start of a command, then
// sub-commands, clause keywords and values that fit what is already typed.
// Pure: extension.ts turns these into VS Code completion items.

import { AFTER, COMMANDS, command, TYPES, WORDS } from "./language";
import { tokenize } from "./lexer";

export type SuggestionKind = "command" | "subcommand" | "keyword" | "value" | "type";

export interface Suggestion {
  label: string;
  kind: SuggestionKind;
  detail?: string;
  documentation?: string;
}

export interface Completion {
  suggestions: Suggestion[];
  /** The cursor is where a key goes: a live connection can offer existing keys. */
  wantsKeys: boolean;
  /** The part of the word typed so far. */
  typed: string;
}

/** Commands whose arguments are key names, and the ones that chain with `and`. */
const KEY_COMMANDS = new Set(["set", "get", "update", "del", "has", "typeof", "change", "bump", "convert"]);
const TYPED_COMMANDS = new Set(["set", "get", "update", "del", "has", "change", "bump"]);
const QUERY_COMMANDS = new Set(["count", "sum", "avg", "min", "max"]);

/** Suggestions for a cursor at the end of `before`: the text of the current command up to the cursor. */
export function complete(before: string): Completion {
  const tokens = tokenize(before);
  const partial = before.length > 0 && !/[\s,(]$/.test(before) && tokens.length > 0;
  const typed = partial ? tokens[tokens.length - 1].text : "";
  const done = partial ? tokens.slice(0, -1) : tokens;
  const words = done.map((t) => (t.kind === "word" ? t.text.toLowerCase() : ""));

  if (done.length === 0) {
    return {
      suggestions: COMMANDS.map((c) => ({
        label: c.name,
        kind: "command",
        detail: c.syntax.split("\n")[0],
        documentation: c.description + (c.admin ? " Needs the admin role." : ""),
      })),
      wantsKeys: false,
      typed,
    };
  }

  const name = words[0];
  const cmd = command(name);
  const prev = words[words.length - 1];
  const suggestions: Suggestion[] = [];
  const add = (labels: string[], kind: SuggestionKind) => {
    for (const label of labels) {
      if (!suggestions.some((s) => s.label === label)) suggestions.push({ label, kind, documentation: WORDS[label] });
    }
  };

  // A word that decides what comes next: metric cosine, using hash, role viewer...
  if (AFTER[prev]?.length) {
    add(AFTER[prev], "value");
    return { suggestions, wantsKeys: false, typed };
  }

  if (!cmd) return { suggestions, wantsKeys: false, typed };

  const first = done.length === 1;
  if (first && cmd.subcommands?.length) add(cmd.subcommands, "subcommand");
  if (first && TYPED_COMMANDS.has(name)) add(TYPES, "type");

  // Where a key name is expected: right after the command or its type,
  // after `and` in a chain, after `to` in change.
  const afterType = done.length === 2 && TYPES.includes(prev) && TYPED_COMMANDS.has(name);
  const keyPlace =
    KEY_COMMANDS.has(name) && (first || afterType || (prev === "and" && !words.includes("where") && !words.includes("similar")) || (name === "change" && prev === "to"));
  // json <sub> <key>
  const jsonKey = name === "json" && done.length === 2;

  if (!first) {
    add(cmd.options ?? [], "keyword");
    if (words.includes("where") && !QUERY_COMMANDS.has(name)) add(["and", "or", "not", "limit", "return"], "keyword");
    if (words.includes("similar")) add(["to", "where", "limit", "metric", "ef", "exact", "return"], "keyword");
  }

  return { suggestions, wantsKeys: keyPlace || jsonKey, typed };
}
