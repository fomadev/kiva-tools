# KivaDB Tools

Completion, hovers and a live connection to **KivaDB** for `.kva` files, by [FomaDev](https://github.com/fomadev).

[KivaDB](https://github.com/fomadev/kiva-db) is a typed key-value, document and vector database in a single executable. This extension helps you write its commands, and runs them on a server while you write.

## Completion and hovers

* At the start of a command: every KivaDB command, with its syntax.
* After a command: its sub-commands (`json get`, `semantic lookup`, `workspace switch`...), its options (`ttl`, `if not exists`, `where`, `limit`, `group by`, `return`...) and type prefixes (`number`, `object`...).
* After a word that decides what follows: `metric` → `cosine`, `dot`, `l2`; `using` → `btree`, `hash`, `hnsw`; `quantize` → `sq8`; `role` → `admin`, `editor`, `viewer`; `if` → `not exists`, `exists`.
* While connected: the **keys that exist**, where a key name is expected (`get `, `del `, `json set `...).
* Hover a command for its syntax and what it does; hover a keyword for a short explanation.

## Live connection

Click **KivaDB** in the status bar, or run **KivaDB: Connect to a Server**. Then:

| Action | How |
| :--- | :--- |
| Run the command under the cursor, or the selected commands | **Ctrl+Enter** (**Cmd+Enter** on macOS), or right-click → **KivaDB: Run the Command Under the Cursor** |
| Run every command of the file, stopping at the first error | **KivaDB: Run Every Command on the Connection** |
| Disconnect | Click the status bar item |

A command written over several lines (a JSON document) is found whole, as KivaDB reads it. The **KivaDB** output channel shows each command and every line of its answer, errors included:

```text
kiva> set x 1 and y oups and z 3
OK: x saved.
✖ Error: String values like 'oups' must be quoted ("" or '').
OK: z saved.
```

## Settings

| Setting | Default | Effect |
| :--- | :--- | :--- |
| `kivadb.host` | `127.0.0.1` | The server |
| `kivadb.port` | `2911` | Its KivaDB protocol port |
| `kivadb.user` | `kiva` | The user to log in as |
| `kivadb.workspace` | | Workspace to switch to after connecting |
| `kivadb.tls` | `false` | Encrypt the connection, checking the certificate against the usual authorities |
| `kivadb.tlsFingerprint` | | Encrypt and accept only the certificate with this SHA-256, as `kivadb tls` shows it |
| `kivadb.completeKeys` | `true` | Offer existing keys while connected |

**Passwords.** When the server asks for one, the extension asks you, and can keep it in VS Code's secret storage (the system keychain), never in the settings. **KivaDB: Forget the Connection Password** removes it. A remote server always needs a password; over the Internet, use TLS.

## Companion extensions

* **KivaDB Language** (`fomadev.kiva-kva`): colours and snippets for `.kva` files.
* **KivaDB Runner** (`fomadev.kiva-runner`): run a whole file with `kivadb run`.
* **KivaDB Formatter** (`fomadev.kva-formatter`): Format Document and problems.

## Development

```bash
npm install
npm test          # lexer, completion, protocol; and a real server when kivadb is installed
npx vsce package  # builds kiva-tools-<version>.vsix
```

Press **F5** in VS Code to try the extension in a new window. `src/client.ts` is a small client of the KivaDB binary protocol; applications should use the official driver, [`@fomadev/kivadb`](https://www.npmjs.com/package/@fomadev/kivadb).

**Releasing.** Add a `## <version>` section to `CHANGELOG.md`, set the same `version` in `package.json`, commit, then:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The `Release` workflow tests the extension, packages it and publishes a GitHub release with the `.vsix` and the notes of that version. Publishing on the Marketplace is manual: download the `.vsix` from the release, then upload it at <https://marketplace.visualstudio.com/manage/publishers/fomadev>.

## License

[Fordima Public License (FPL)](LICENSE).
