import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { frame, KivaClient, parseLines, readFrames, sameFingerprint } from "../src/client";
import { complete } from "../src/complete";
import { COMMANDS } from "../src/language";
import { isOpen, split, statementAt, tokenize } from "../src/lexer";

const labels = (before: string) => complete(before).suggestions.map((s) => s.label);

// -- lexer ----------------------------------------------------------------------

test("documents keep a command open, as in KivaDB", () => {
  assert.ok(isOpen("set user:1 {"));
  assert.ok(isOpen('set x {"a": [1, 2'));
  assert.ok(!isOpen('set user:1 {"a": 1}'));
  assert.ok(!isOpen('set note "a { b"'));
  assert.ok(!isOpen('set k {"t": "} and {"}'));
  assert.ok(!isOpen("get user:{id}"));
});

test("a file splits into commands with their positions", () => {
  const src = '# shop\nset a 1\n\n-- docs\n  set user:1 {\n  "nom": "Fordi"\n}\nget a\nset b {\n';
  const { statements, unclosed } = split(src);
  assert.deepEqual(statements.map((s) => [s.line, s.text]), [
    [1, "set a 1"],
    [4, 'set user:1 {\n  "nom": "Fordi"\n}'],
    [7, "get a"],
  ]);
  assert.equal(src.slice(statements[1].start, statements[1].start + 3), "set");
  assert.equal(unclosed?.line, 8);
  assert.equal(statementAt(src, src.indexOf("Fordi"))?.line, 4);
  assert.equal(statementAt(src, 1), undefined);
});

test("tokens: words, strings, backticks, documents", () => {
  const t = tokenize('set `get` "a b" {"x": [1, "}"]} and n:1,(y)');
  assert.deepEqual(t.map((x) => [x.kind, x.text]), [
    ["word", "set"],
    ["backtick", "`get`"],
    ["string", '"a b"'],
    ["document", '{"x": [1, "}"]}'],
    ["word", "and"],
    ["word", "n:1"],
    ["punct", ","],
    ["punct", "("],
    ["word", "y"],
    ["punct", ")"],
  ]);
});

// -- completion -------------------------------------------------------------------

test("at the start of a command, every command", () => {
  const c = complete("");
  assert.equal(c.suggestions.length, COMMANDS.length);
  assert.ok(labels("se").includes("semantic"));
  assert.equal(complete("se").typed, "se");
});

test("sub-commands follow their command", () => {
  assert.deepEqual(labels("json "), ["get", "set", "delete", "append", "insert", "incr", "type", "len", "keys"]);
  assert.ok(labels("semantic ").includes("lookup"));
  assert.ok(labels("workspace sw").includes("switch"));
});

test("values follow the word that decides them", () => {
  assert.deepEqual(labels("get similar doc:*.v to [1, 0] metric "), ["cosine", "dot", "l2"]);
  assert.deepEqual(labels("create index on user: (email) using "), ["btree", "hash", "hnsw"]);
  assert.deepEqual(labels('create user "a" identified by "b" role '), ["admin", "editor", "viewer"]);
  assert.deepEqual(labels("set a 1 if "), ["not exists", "exists"]);
  assert.deepEqual(labels("count user:* group "), ["by"]);
});

test("options of the command after its first argument", () => {
  const set = labels('set session:1 "x" ');
  assert.ok(set.includes("ttl") && set.includes("if not exists"));
  const query = labels("get where user:*.age > 3 ");
  assert.ok(query.includes("and") && query.includes("or") && query.includes("limit"));
  assert.ok(labels("get similar doc:*.v to [1] ").includes("exact"));
});

test("key places ask for live keys", () => {
  assert.equal(complete("get ").wantsKeys, true);
  assert.equal(complete("get cli").wantsKeys, true);
  assert.equal(complete("set number ").wantsKeys, true);
  assert.equal(complete("get a and ").wantsKeys, true);
  assert.equal(complete("get where user:*.a = 1 and ").wantsKeys, false);
  assert.equal(complete("change a to ").wantsKeys, true);
  assert.equal(complete("json get ").wantsKeys, true);
  assert.equal(complete("json get ").suggestions.length, 0);
  assert.equal(complete("json get post:").wantsKeys, true);
  assert.ok(labels("set ").includes("number"));
});

// -- protocol -----------------------------------------------------------------------

test("frames: length, code, payload", () => {
  assert.deepEqual([...frame(3, Buffer.from("get age"))], [0, 0, 0, 9, 0, 3, ...Buffer.from("get age")]);
  assert.deepEqual([...frame(4)], [0, 0, 0, 2, 0, 4]);
  const two = Buffer.concat([frame(0, Buffer.from("+OK")), frame(9, Buffer.from("set a")), frame(1).subarray(0, 3)]);
  const { frames, rest } = readFrames(two);
  assert.deepEqual(frames.map((f) => [f.status, f.payload.toString()]), [[0, "+OK"], [9, "set a"]]);
  assert.equal(rest.length, 3);
});

test("output lines keep their errors", () => {
  assert.deepEqual(parseLines("+OK: x saved.\n-Error: oups\n"), [
    { error: false, text: "OK: x saved." },
    { error: true, text: "Error: oups" },
  ]);
});

test("fingerprints compare without colons or case", () => {
  const hex = "7745f556d23365c3021a0cf792c5d919bc44b77d6fafa9a355fbcbe43ca121ae6".slice(0, 64);
  const colons = hex.toUpperCase().match(/../g)!.join(":");
  assert.ok(sameFingerprint(hex, colons));
  assert.ok(!sameFingerprint(hex, "abcd"));
});

// -- against a real server, when kivadb is installed ----------------------------------

const kivadb = process.env.KIVADB || "kivadb";

test("a real KivaDB: connect, run commands, read every line", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kiva-tools-"));
  const port = 29000 + Math.floor(Math.random() * 900);
  const server = spawn(kivadb, ["--home", home, "serve", "--port", String(port), "--no-http", "--no-resp"], {
    env: { ...process.env, KIVADB_NO_UPDATE_CHECK: "1" },
    stdio: "ignore",
  });
  const missing = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(true));
    setTimeout(() => resolve(false), 300);
  });
  if (missing) {
    t.skip(`${kivadb} is not installed`);
    return;
  }
  try {
    let client: KivaClient | undefined;
    for (let i = 0; i < 50 && !client; i++) {
      try {
        client = await KivaClient.connect({ host: "127.0.0.1", port, timeout: 1000 });
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    assert.ok(client, "the server answers");
    assert.match(client.server, /^KivaDB \d/);
    const r = await client.exec("set x 1 and y oups and z 3");
    assert.deepEqual(r.lines.map((l) => l.error), [false, true, false]);
    assert.deepEqual((await client.exec("get z")).lines, [{ error: false, text: "z: 3 [number]" }]);
    const scan = await client.api<{ keys: { key: string }[] }>({ op: "scan", pattern: "*", limit: 10 });
    assert.deepEqual(scan.keys.map((k) => k.key).sort(), ["x", "z"]);
    client.close();
  } finally {
    server.kill();
    await new Promise((r) => server.once("exit", r));
    fs.rmSync(home, { recursive: true, force: true });
  }
});
