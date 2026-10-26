// A light client of the KivaDB binary protocol (port 2911), enough for the
// editor: log in, run commands, send structured requests.
//
// Every frame, in both directions: [length u32 BE][code u16 BE][payload],
// where length counts the code and the payload. Requests carry a command
// code, answers a status. Answers come back in the order of the requests;
// change notifications (status 9) can arrive between them and are skipped.
//
// Applications should use the official driver, @fomadev/kivadb, which does
// the same and more. This one keeps every output line of a command, errors
// included, as the shell shows them.

import * as net from "node:net";
import * as tls from "node:tls";
import { createHash } from "node:crypto";

const CMD = { HELLO: 1, AUTH: 2, EXEC: 3, PING: 4, API: 8 } as const;
export const STATUS = { OK: 0, ERROR: 1, NOT_FOUND: 2, BYE: 3, CLEAR: 4, EVENT: 9 } as const;

export interface ClientOptions {
  host: string;
  port: number;
  user?: string;
  password?: string;
  /** Encrypt the connection; with a fingerprint, accept only that certificate. */
  tls?: boolean;
  tlsFingerprint?: string;
  /** Milliseconds to connect and log in. */
  timeout?: number;
}

export interface Line {
  error: boolean;
  text: string;
}

export interface ExecResult {
  status: number;
  lines: Line[];
}

export class KivaError extends Error {}

/** Encodes one frame. */
export function frame(code: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt32BE(payload.length + 2, 0);
  head.writeUInt16BE(code, 4);
  return Buffer.concat([head, payload]);
}

/** Reads the complete frames at the start of `buffer`; returns them and what is left. */
export function readFrames(buffer: Buffer): { frames: { status: number; payload: Buffer }[]; rest: Buffer } {
  const frames: { status: number; payload: Buffer }[] = [];
  let b = buffer;
  while (b.length >= 6) {
    const length = b.readUInt32BE(0);
    if (b.length < 4 + length) break;
    frames.push({ status: b.readUInt16BE(4), payload: b.subarray(6, 4 + length) });
    b = b.subarray(4 + length);
  }
  return { frames, rest: b };
}

/** EXEC answers: one line each, starting with + (output) or - (error). */
export function parseLines(payload: string): Line[] {
  return payload
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => ({ error: l.startsWith("-"), text: l.startsWith("+") || l.startsWith("-") ? l.slice(1) : l }));
}

/** "AB:CD:..." and "abcd..." are the same fingerprint. */
export function sameFingerprint(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/^(sha256\/|SHA256:)/i, "").replace(/:/g, "").toLowerCase();
  return norm(a).length === 64 && norm(a) === norm(b);
}

export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || h.startsWith("127.");
}

export class KivaClient {
  /** First line of the server's greeting, such as "KivaDB 1.6.1". */
  server = "";
  private buffer: Buffer = Buffer.alloc(0);
  private waiting: { resolve: (f: { status: number; payload: Buffer }) => void; reject: (e: Error) => void }[] = [];
  private closed = false;
  private closeListeners: (() => void)[] = [];

  private constructor(private socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (err) => this.fail(err));
    socket.on("close", () => this.fail(new KivaError("The connection to KivaDB was closed.")));
  }

  static connect(o: ClientOptions): Promise<KivaClient> {
    const user = o.user || "kiva";
    const password = o.password ?? "";
    if (!isLocalHost(o.host) && !password) {
      return Promise.reject(new KivaError("A password is required to connect to a remote server."));
    }
    return new Promise((resolve, reject) => {
      const secure = o.tls || !!o.tlsFingerprint;
      const socket = secure
        ? tls.connect({
            host: o.host,
            port: o.port,
            servername: net.isIP(o.host) ? undefined : o.host,
            // A pinned fingerprint replaces the authority check: KivaDB's own
            // certificate is signed by nobody but itself.
            rejectUnauthorized: !o.tlsFingerprint,
          })
        : net.connect({ host: o.host, port: o.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new KivaError(`No answer from ${o.host}:${o.port}.`));
      }, o.timeout ?? 8000);
      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(new KivaError(`Cannot reach KivaDB at ${o.host}:${o.port}: ${err.message}`));
      });
      socket.once(secure ? "secureConnect" : "connect", async () => {
        clearTimeout(timer);
        if (o.tlsFingerprint) {
          const cert = (socket as tls.TLSSocket).getPeerCertificate();
          const seen = cert?.raw ? createHash("sha256").update(cert.raw).digest("hex") : "";
          if (!sameFingerprint(seen, o.tlsFingerprint)) {
            socket.destroy();
            reject(new KivaError("The server's certificate is not the one expected (kivadb.tlsFingerprint). Check it with `kivadb tls` on the server."));
            return;
          }
        }
        const client = new KivaClient(socket);
        try {
          const hello = (await client.call(CMD.HELLO)).payload.toString();
          if (!hello.startsWith("KivaDB")) throw new KivaError(`${o.host}:${o.port} is not a KivaDB server.`);
          client.server = hello.split("\n")[0];
          if (hello.includes("auth=required") || password || user !== "kiva") {
            const r = await client.call(CMD.AUTH, Buffer.concat([Buffer.from(user), Buffer.from([0]), Buffer.from(password)]));
            if (r.status !== STATUS.OK) throw new KivaError(r.payload.toString().replace(/^permission denied: /, ""));
          }
          resolve(client);
        } catch (err) {
          client.close();
          reject(err);
        }
      });
    });
  }

  /** Runs one command of the shell language; every output line comes back, errors included. */
  async exec(command: string): Promise<ExecResult> {
    const r = await this.call(CMD.EXEC, Buffer.from(command));
    return { status: r.status, lines: parseLines(r.payload.toString()) };
  }

  /** A structured request ({op: ...}); the JSON answer. */
  async api<T = any>(request: { op: string; [field: string]: unknown }): Promise<T> {
    const r = await this.call(CMD.API, Buffer.from(JSON.stringify(request)));
    const text = r.payload.toString();
    if (r.status !== STATUS.OK) throw new KivaError(text);
    return JSON.parse(text) as T;
  }

  async ping(): Promise<void> {
    await this.call(CMD.PING);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  close(): void {
    this.socket.end();
    this.fail(new KivaError("Disconnected."));
  }

  private call(code: number, payload?: Buffer): Promise<{ status: number; payload: Buffer }> {
    if (this.closed) return Promise.reject(new KivaError("Not connected to KivaDB."));
    this.socket.write(frame(code, payload));
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  private onData(chunk: Buffer): void {
    const { frames, rest } = readFrames(this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk);
    this.buffer = rest;
    for (const f of frames) {
      if (f.status === STATUS.EVENT) continue;
      this.waiting.shift()?.resolve(f);
    }
  }

  private fail(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiting.splice(0)) w.reject(err instanceof KivaError ? err : new KivaError(err.message));
    for (const l of this.closeListeners) l();
  }
}
