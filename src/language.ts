// The KivaDB command language, as data: every command with its syntax, what
// it does, its sub-commands and the words that may follow it. Completion and
// hovers are built from this table.

export interface Command {
  name: string;
  syntax: string;
  description: string;
  /** Words that can come right after the command (json get, workspace create...). */
  subcommands?: string[];
  /** Clause keywords used further in the command. */
  options?: string[];
  /** Needs the admin role. */
  admin?: boolean;
}

export const DOCS = "https://github.com/fomadev/kiva-db/blob/main/DOCUMENTATION.md";

export const TYPES = ["string", "number", "boolean", "null", "array", "object", "bytes"];

const C = (name: string, syntax: string, description: string, more: Partial<Command> = {}): Command => ({ name, syntax, description, ...more });

export const COMMANDS: Command[] = [
  // Data
  C("set", "set [type] <key> <value> [ttl <seconds>] [if not exists] [and ...]", "Create a key. Fails if it exists; `if not exists` skips it instead.", { options: ["ttl", "if not exists", "and"] }),
  C("get", "get [type] <key>[.path] [and ...]\nget where <condition> [limit N] [return f1, f2]\nget similar <pattern>.<field> to <vector> [where ...] [limit N] [metric cosine|dot|l2] [ef N] [exact] [return ...]", "Read keys or document fields, query documents, or search by vector similarity.", { subcommands: ["where", "similar", "range"], options: ["and", "to", "limit", "return", "metric", "ef", "exact", "where"] }),
  C("update", "update [type] <key> <value> [and ...]", "Replace the value of an existing key, keeping its type and TTL.", { options: ["and"] }),
  C("del", "del [type] <key> [if exists] [and ...]\ndel all keys", "Delete keys. `del all keys` empties the workspace (admin).", { options: ["if exists", "and", "all keys"] }),
  C("has", "has [type] <key> [and ...]", "Whether a key exists (and has this type).", { options: ["and"] }),
  C("typeof", "typeof <key> [and ...]", "The type of a key.", { options: ["and"] }),
  C("change", "change [type] <old> to [type] <new> [value]", "Rename a key, or migrate it to a new value and type, atomically.", { options: ["to"] }),
  C("bump", "bump [type] <key> add|set <seconds>", "Extend (add) or restart (set) the TTL of a key.", { subcommands: [], options: ["add", "set"] }),
  C("print", "print <expression>, ...", "Compute and show values; `${...}` inside strings. Stores nothing."),
  // Listing
  C("keys", "keys [like <pattern>] [from <A> to <B>] [limit N] [reverse]", "Key names, sorted.", { options: ["like", "from", "to", "limit", "reverse"] }),
  C("scan", "scan [pattern] [limit N]", "Keys with type, size, date and TTL.", { options: ["limit"] }),
  C("range", "range <from> to <to> [reverse] [limit N] [return f1, f2]", "Keys and values between two bounds.", { options: ["to", "reverse", "limit", "return"] }),
  // Documents
  C("json", "json get|set|delete|append|insert|incr|type|len|keys <key> <.path> [value]", "Read or change the inside of a document.", { subcommands: ["get", "set", "delete", "append", "insert", "incr", "type", "len", "keys"] }),
  C("convert", "convert <key> to msgpack|json", "Store a document as MessagePack or JSON.", { options: ["to", "msgpack", "json"] }),
  // Queries
  C("count", "count where <condition>\ncount <pattern>[.field] [where <condition>] [group by <field>]", "Count matching documents.", { options: ["where", "group by", "limit", "and", "or", "not"] }),
  C("sum", "sum where <condition>\nsum <pattern>.<field> [where <condition>] [group by <field>]", "Sum a field.", { options: ["where", "group by", "limit", "and", "or", "not"] }),
  C("avg", "avg <pattern>.<field> [where <condition>] [group by <field>]", "Average of a field.", { options: ["where", "group by", "limit", "and", "or", "not"] }),
  C("min", "min <pattern>.<field> [where <condition>] [group by <field>]", "Smallest value of a field.", { options: ["where", "group by", "limit", "and", "or", "not"] }),
  C("max", "max <pattern>.<field> [where <condition>] [group by <field>]", "Largest value of a field.", { options: ["where", "group by", "limit", "and", "or", "not"] }),
  C("explain", "explain <query>", "Show how a query will run, and the index it lacks.", { subcommands: ["get", "count", "sum", "avg", "min", "max", "range"] }),
  C("create", "create index on <pattern> (<field>) [using btree|hash]\ncreate vector index on <pattern> (<field>) [using hnsw [metric m] [m N] [ef N] [ef_search N] [quantize sq8]]\ncreate user \"<name>\" identified by \"<password>\" [role admin|editor|viewer]\ncreate trigger [name] on set|update|del \"<pattern>\" run \"<script>\"", "Create an index, a vector index, a user or a trigger (admin).", { subcommands: ["index", "vector index", "user", "trigger"], options: ["on", "using", "btree", "hash", "hnsw", "metric", "m", "ef", "ef_search", "quantize", "identified by", "role", "run"], admin: true }),
  C("drop", "drop index on <pattern> (<field>)\ndrop vector index on <pattern> (<field>)\ndrop user \"<name>\"\ndrop trigger <name>", "Remove an index, a vector index, a user or a trigger (admin).", { subcommands: ["index", "vector index", "user", "trigger"], options: ["on"], admin: true }),
  C("indexes", "indexes", "List the secondary and vector indexes of the workspace."),
  C("tune", "tune vector index on <pattern> (<field>) [recall 0.95] [limit N] [sample N] [queries \"<pattern>\"] [auto | auto off | ef_search N|default]", "Measure the ef_search an HNSW index needs, and keep it tuned as it grows (admin).", { subcommands: ["vector index"], options: ["on", "recall", "limit", "sample", "queries", "auto", "auto off", "ef_search"], admin: true }),
  // Transactions
  C("begin", "begin", "Start a transaction: what follows is applied all together at commit, or not at all."),
  C("commit", "commit", "Apply the transaction."),
  C("rollback", "rollback [to <savepoint>]", "Cancel the transaction, or go back to a savepoint.", { options: ["to"] }),
  C("savepoint", "savepoint <name>", "A bookmark inside a transaction."),
  C("transaction", "transaction status", "The state of the current transaction.", { subcommands: ["status"] }),
  // Semantic cache
  C("semantic", "semantic lookup <cache> [text \"<q>\"] [vector [...]] [threshold <0-1>]\nsemantic store <cache> [text \"<q>\"] [vector [...]] answer <value> [ttl <s>] [depends \"<pattern>\", ...] [since <token>]\nsemantic stats\nsemantic clear [<cache>]", "Reuse the answers of a language model for questions asked again in other words.", { subcommands: ["lookup", "store", "stats", "clear"], options: ["text", "vector", "threshold", "answer", "ttl", "depends", "since"] }),
  // Administration
  C("workspace", "workspace list|current\nworkspace create|switch|remove <name>", "Independent databases inside one KivaDB.", { subcommands: ["list", "current", "create", "switch", "remove"] }),
  C("config", "config list\nconfig get <key>\nconfig set <key> <value>", "Read or change settings (admin).", { subcommands: ["list", "get", "set"], admin: true }),
  C("whoami", "whoami", "The current user, role and workspace."),
  C("auth", "auth <user> <password>", "Log in, or change user."),
  C("users", "users", "List the accounts (admin).", { admin: true }),
  C("modify", "modify user \"<name>\" password \"<password>\"\nmodify user \"<name>\" role \"<role>\"", "Change a password or a role.", { subcommands: ["user"], options: ["password", "role"] }),
  C("grant", "grant read|write on workspace \"<w>\" to \"<user>\"\ngrant read|write|admin on all to \"<user>\"", "Give access to a workspace (admin).", { subcommands: ["read", "write", "admin"], options: ["on", "workspace", "all", "to"], admin: true }),
  C("revoke", "revoke read|write on workspace \"<w>\" from \"<user>\"\nrevoke admin from \"<user>\"", "Take access back (admin).", { subcommands: ["read", "write", "admin"], options: ["on", "workspace", "all", "from"], admin: true }),
  C("audit", "audit last <N> | since \"<date>\" | failed-logins", "The audit log (admin).", { subcommands: ["last", "since", "failed-logins"], admin: true }),
  C("stats", "stats", "The dashboard of the workspace: keys, storage, fragmentation, durability..."),
  C("memory", "memory\nmemory pin|unpin \"<pattern>\"", "Where the memory goes; keep keys always in memory (admin).", { subcommands: ["pin", "unpin"] }),
  C("compact", "compact", "Rewrite the data file without dead records."),
  C("autocompact", "autocompact on|off|status|threshold <N>", "Automatic compaction.", { subcommands: ["on", "off", "status", "threshold"] }),
  C("check", "check [repair]", "Verify every record's checksum; repair removes damaged ones after a backup.", { subcommands: ["repair"] }),
  C("hint", "hint info", "The index snapshot file.", { subcommands: ["info"] }),
  C("compress", "compress lz4|zlib|none", "Rewrite the workspace with this compression (admin).", { subcommands: ["lz4", "zlib", "none"], admin: true }),
  C("encryption", "encryption", "State of the encryption at rest (admin).", { admin: true }),
  C("backup", "backup to \"<archive.tar.gz>\" [workspace <name>]", "Back up through the server (admin).", { subcommands: ["to"], options: ["workspace"], admin: true }),
  C("bench", "bench write|read <N>\nbench script \"<name>\" iterations <N> [args]", "Measure speed (admin).", { subcommands: ["write", "read", "script"], admin: true }),
  C("shutdown", "shutdown", "Stop the server (admin).", { admin: true }),
  // Scripts and events
  C("eval", "eval '<lua code>' [arguments]", "Run Lua next to the data, atomically. Arguments arrive in ARGV."),
  C("script", "script load \"<file>\" as \"<name>\"\nscript run \"<name>\" [arguments]\nscript list | show \"<name>\" | delete \"<name>\"", "Stored Lua scripts.", { subcommands: ["load", "run", "list", "show", "delete"], options: ["as"] }),
  C("triggers", "triggers", "List the triggers."),
  C("subscribe", "subscribe <pattern>", "Announce changes of matching keys as they happen."),
  C("unsubscribe", "unsubscribe [pattern]", "Stop announcing changes."),
  // Replication
  C("replica", "replica of <host> <port> | of none\nreplica status|start|stop|sync|promote", "Follow a master, or manage this replica (admin).", { subcommands: ["of", "status", "start", "stop", "sync", "promote"], admin: true }),
  C("wait", "wait <replicas> [timeout_ms]", "Wait until that many replicas have every write made so far."),
  C("failover", "failover to <replica> | status", "Hand the master role over, or show automatic failover.", { subcommands: ["to", "status"] }),
  // Shell
  C("ping", "ping", "PONG."),
  C("version", "version", "The server's version."),
  C("help", "help", "List the commands."),
  C("source", "source \"<file.kva>\"", "Run a command file."),
  C("clear", "clear", "Clear the screen."),
  C("exit", "exit", "Leave the shell."),
];

const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

export function command(name: string): Command | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/** Words that may follow a given word, wherever it appears. */
export const AFTER: Record<string, string[]> = {
  metric: ["cosine", "dot", "l2"],
  using: ["btree", "hash", "hnsw"],
  quantize: ["sq8", "none"],
  role: ["admin", "editor", "viewer"],
  if: ["not exists", "exists"],
  group: ["by"],
  identified: ["by"],
  convert: [],
  to: [],
  auto: ["off"],
  ef_search: ["default"],
};

/** Short explanations of clause keywords and values, shown in completion and hovers. */
export const WORDS: Record<string, string> = {
  where: "Keep the documents that pass a condition: `<pattern>.<field> <op> <value>`, joined by and, or, not.",
  and: "Join comparisons (both true), or chain operations: `set a 1 and b 2`.",
  or: "Either comparison is true.",
  not: "The opposite of the comparison.",
  ttl: "Seconds until the key deletes itself.",
  "if not exists": "Create the key only when it is missing; otherwise skip without error.",
  "if exists": "Delete without a 'Not found' line when the key is missing.",
  limit: "Stop after N results.",
  return: "Keep only these fields of each document.",
  like: "Keys matching a pattern with * and ?.",
  reverse: "From the largest key down.",
  similar: "Find the documents whose vector is closest.",
  metric: "How vectors are compared: cosine (default), dot or l2.",
  cosine: "The angle between vectors: 1 is the same direction. The usual choice for text embeddings.",
  dot: "The dot product: higher is closer. For normalised vectors.",
  l2: "Straight-line distance: 0 is identical, lower is closer.",
  ef: "Candidates a HNSW search keeps: more finds more of the true closest, slower.",
  exact: "Compare every vector this time.",
  "group by": "One result per value of a field.",
  using: "The kind of index: btree (default; =, >, <), hash (= only) or hnsw (vectors).",
  btree: "Sorted index: answers =, >, >=, <, <=.",
  hash: "Hash index: answers = only, in constant time.",
  hnsw: "Approximate vector index for large collections.",
  quantize: "sq8 keeps one byte per number instead of four.",
  sq8: "One byte per number: a quarter of the memory, scores re-ranked exactly.",
  ef_search: "Candidates a HNSW search keeps by default; `tune` measures it.",
  recall: "Share of the true closest vectors to find, such as 0.95.",
  auto: "Tune again in the background each time the index doubles or halves.",
  depends: "Drop the cached answer as soon as a matching key changes.",
  since: "The token of the missed lookup: do not keep an answer built from data changed meanwhile.",
  threshold: "Similarity from which two questions count as the same (default 0.98).",
  answer: "The value to remember.",
  text: "The question's text: an identical question is found without a vector.",
  vector: "The question's embedding, computed by your model.",
};
