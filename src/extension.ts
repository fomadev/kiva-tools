// KivaDB Tools: completion and hovers for .kva files, and a live connection
// to a KivaDB server to run the command under the cursor and complete key
// names with the keys that exist.

import * as vscode from "vscode";
import { KivaClient } from "./client";
import { complete, SuggestionKind } from "./complete";
import { command, DOCS, WORDS } from "./language";
import { split, statementAt } from "./lexer";

let client: KivaClient | undefined;
let output: vscode.OutputChannel;
let status: vscode.StatusBarItem;
let secrets: vscode.SecretStorage;

const KINDS: Record<SuggestionKind, vscode.CompletionItemKind> = {
  command: vscode.CompletionItemKind.Function,
  subcommand: vscode.CompletionItemKind.Method,
  keyword: vscode.CompletionItemKind.Keyword,
  value: vscode.CompletionItemKind.EnumMember,
  type: vscode.CompletionItemKind.TypeParameter,
};

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("KivaDB");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
  secrets = context.secrets;
  showStatus();
  status.show();
  const kva: vscode.DocumentSelector = { language: "kva" };
  context.subscriptions.push(
    output,
    status,
    vscode.languages.registerCompletionItemProvider(kva, { provideCompletionItems }, " ", "."),
    vscode.languages.registerHoverProvider(kva, { provideHover }),
    vscode.commands.registerCommand("kivadb.connect", () => connect()),
    vscode.commands.registerCommand("kivadb.disconnect", () => disconnect()),
    vscode.commands.registerCommand("kivadb.connectionMenu", () => connectionMenu()),
    vscode.commands.registerCommand("kivadb.runStatement", () => runStatements(false)),
    vscode.commands.registerCommand("kivadb.runAllStatements", () => runStatements(true)),
    vscode.commands.registerCommand("kivadb.forgetPassword", () => forgetPassword()),
    { dispose: () => client?.close() },
  );
}

export function deactivate(): void {
  client?.close();
}

function settings() {
  return vscode.workspace.getConfiguration("kivadb");
}

// -- completion and hovers ------------------------------------------------------

async function provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const line = document.lineAt(position.line).text;
  if (/^\s*(#|--)/.test(line)) return [];
  const stmt = statementAt(text, offset);
  const before = stmt ? text.slice(stmt.start, offset) : line.slice(0, position.character).trimStart();
  const { suggestions, wantsKeys, typed } = complete(before);
  const items = suggestions.map((s) => {
    const item = new vscode.CompletionItem(s.label, KINDS[s.kind]);
    item.detail = s.detail;
    if (s.documentation) item.documentation = new vscode.MarkdownString(s.documentation);
    return item;
  });
  if (wantsKeys && client && !client.isClosed && settings().get<boolean>("completeKeys", true)) {
    try {
      const prefix = typed.replace(/[*?].*$/, "");
      const r = await client.api<{ keys: { key: string; type: string; ttl: number | null }[] }>({ op: "scan", pattern: `${prefix}*`, limit: 200 });
      for (const k of r.keys) {
        const item = new vscode.CompletionItem(k.key, vscode.CompletionItemKind.Variable);
        item.detail = `${k.type}${k.ttl ? `, expires in ${k.ttl} s` : ""}`;
        item.sortText = `0${k.key}`;
        items.push(item);
      }
    } catch {
      // Keys are a bonus: a failed listing leaves the other suggestions.
    }
  }
  return items;
}

function provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][\w-]*/);
  if (!range) return undefined;
  const word = document.getText(range).toLowerCase();
  const stmt = statementAt(document.getText(), document.offsetAt(position));
  const isFirst = stmt !== undefined && document.offsetAt(range.start) === stmt.start;
  const cmd = isFirst ? command(word) : undefined;
  if (cmd) {
    const md = new vscode.MarkdownString();
    md.appendCodeblock(cmd.syntax, "kva");
    md.appendMarkdown(`${cmd.description}${cmd.admin ? " *Needs the admin role.*" : ""}\n\n[KivaDB documentation](${DOCS})`);
    return new vscode.Hover(md, range);
  }
  const explanation = WORDS[word];
  return explanation ? new vscode.Hover(new vscode.MarkdownString(`**${word}** — ${explanation}`), range) : undefined;
}

// -- the live connection ----------------------------------------------------------

function target(): { host: string; port: number; user: string } {
  const cfg = settings();
  return { host: cfg.get<string>("host") || "127.0.0.1", port: cfg.get<number>("port") || 2911, user: cfg.get<string>("user") || "kiva" };
}

function secretKey(): string {
  const t = target();
  return `kivadb.tools:${t.user}@${t.host}:${t.port}`;
}

function showStatus(): void {
  if (client && !client.isClosed) {
    const t = target();
    status.text = `$(database) ${t.user}@${t.host}:${t.port}`;
    status.tooltip = `Connected to ${client.server}. Click for the connection menu.`;
  } else {
    status.text = "$(debug-disconnect) KivaDB";
    status.tooltip = "Not connected to KivaDB. Click to connect.";
  }
  status.command = "kivadb.connectionMenu";
}

async function connect(): Promise<boolean> {
  client?.close();
  client = undefined;
  const cfg = settings();
  const t = target();
  let password = await secrets.get(secretKey());
  let asked = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Connecting to KivaDB at ${t.host}:${t.port}...` },
        () =>
          KivaClient.connect({
            ...t,
            password: password ?? "",
            tls: cfg.get<boolean>("tls", false),
            tlsFingerprint: cfg.get<string>("tlsFingerprint") || undefined,
          }),
      );
      const workspace = cfg.get<string>("workspace");
      if (workspace) {
        const r = await c.exec(`workspace switch ${workspace}`);
        if (r.lines.some((l) => l.error)) throw new Error(r.lines.map((l) => l.text).join(" "));
      }
      client = c;
      c.onClose(() => {
        if (client === c) client = undefined;
        showStatus();
      });
      if (asked && password !== undefined) {
        const keep = await vscode.window.showInformationMessage("Remember this password in VS Code's secret storage?", "Remember", "Not now");
        if (keep === "Remember") await secrets.store(secretKey(), password);
      }
      showStatus();
      vscode.window.setStatusBarMessage(`Connected to ${c.server}`, 4000);
      return true;
    } catch (err) {
      const message = (err as Error).message;
      const needsPassword = /password|authentication|invalid username/i.test(message);
      if (attempt === 0 && needsPassword) {
        password = await vscode.window.showInputBox({ title: `KivaDB password of ${t.user} (${t.host}:${t.port})`, password: true, ignoreFocusOut: true });
        if (password === undefined) break;
        asked = true;
        continue;
      }
      vscode.window.showErrorMessage(`KivaDB: ${message}`, "Open settings").then((a) => a && vscode.commands.executeCommand("workbench.action.openSettings", "kivadb."));
      break;
    }
  }
  showStatus();
  return false;
}

function disconnect(): void {
  client?.close();
  client = undefined;
  showStatus();
}

async function forgetPassword(): Promise<void> {
  await secrets.delete(secretKey());
  vscode.window.showInformationMessage("The KivaDB password was forgotten.");
}

async function connectionMenu(): Promise<void> {
  const connected = client && !client.isClosed;
  const choices = connected
    ? ["Run the command under the cursor", "Disconnect", "Open the KivaDB output", "Settings"]
    : ["Connect", "Settings"];
  const pick = await vscode.window.showQuickPick(choices, { title: connected ? client!.server : "KivaDB" });
  if (pick === "Connect") await connect();
  else if (pick === "Disconnect") disconnect();
  else if (pick === "Run the command under the cursor") await runStatements(false);
  else if (pick === "Open the KivaDB output") output.show();
  else if (pick === "Settings") vscode.commands.executeCommand("workbench.action.openSettings", "kivadb.");
}

/** Runs the command under the cursor (or the selected ones), or every command of the file. */
async function runStatements(all: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  const text = doc.getText();
  const { statements, unclosed } = split(text);
  let chosen = statements;
  if (!all) {
    const sel = editor.selection;
    const from = doc.offsetAt(sel.start);
    const to = doc.offsetAt(sel.end);
    chosen = sel.isEmpty
      ? statements.filter((s) => from >= s.start && from <= s.end)
      : statements.filter((s) => s.end >= from && s.start <= to);
    if (!chosen.length && unclosed && from >= unclosed.start) {
      vscode.window.showWarningMessage("This command opens a { or [ that is never closed.");
      return;
    }
    if (!chosen.length) {
      vscode.window.showInformationMessage("Put the cursor on a KivaDB command to run it.");
      return;
    }
  }
  if ((!client || client.isClosed) && !(await connect())) return;
  output.show(true);
  for (const s of chosen) {
    output.appendLine(`kiva> ${s.text.split("\n").join("\n ...> ")}`);
    try {
      const r = await client!.exec(s.text);
      for (const l of r.lines) output.appendLine(l.error ? `✖ ${l.text}` : l.text);
      if (all && r.lines.some((l) => l.error)) {
        output.appendLine(`Stopped at line ${s.line + 1}.`);
        break;
      }
    } catch (err) {
      output.appendLine(`✖ ${(err as Error).message}`);
      break;
    }
  }
}

