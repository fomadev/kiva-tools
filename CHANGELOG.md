# Changelog

Every version of the extension, newest first. A version tag `v<version>` publishes the section of that version as the GitHub release notes, so add the section before tagging.

## 1.0.0 - 2026-10-26

### Added

* Completion in `.kva` files: every KivaDB command at the start of a command, then its sub-commands (`json get`, `semantic lookup`, `workspace switch`...), its options (`ttl`, `if not exists`, `where`, `limit`, `group by`...), type prefixes, and the values that fit the word before (`metric` → `cosine`, `dot`, `l2`; `using` → `btree`, `hash`, `hnsw`; `role` → `admin`, `editor`, `viewer`...).
* Hovers: the syntax and purpose of each command, and short explanations of clause keywords.
* A live connection to a KivaDB server (**KivaDB: Connect to a Server**, or the status bar), over the binary protocol, with TLS and certificate fingerprints. Passwords are kept in VS Code's secret storage, never in the settings.
* **KivaDB: Run the Command Under the Cursor** (Ctrl+Enter): runs the command, or the selected ones, on the connection and shows every output line in the **KivaDB** output channel. **KivaDB: Run Every Command on the Connection** runs the whole file, stopping at the first error.
* While connected, the keys that exist are offered where a key name is expected.
