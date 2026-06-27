/**
 * Fetch HTTPS através de um proxy HTTP (CONNECT) usando `cloudflare:sockets`.
 *
 * O runtime do Cloudflare Workers (workerd) não suporta undici/ProxyAgent.
 * Para rotear cada conta pelo seu proxy residencial precisamos abrir um
 * socket TCP cru até o proxy, fazer CONNECT, fazer upgrade TLS e escrever a
 * request HTTP/1.1 na mão. Retornamos um objeto Response-like compatível
 * com o que o resto do código já espera (res.ok, res.status, res.text(),
 * res.headers.get / getSetCookie).
 */

export interface ProxyInfo {
  ip: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

interface ProxyFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

interface ProxyResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  text(): Promise<string>;
  json(): Promise<any>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function btoaAscii(s: string): string {
  // workerd has btoa
  return btoa(s);
}

async function readUntilDoubleCRLF(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initial: Uint8Array,
): Promise<{ headerBytes: Uint8Array; leftover: Uint8Array }> {
  let buf = initial;
  while (true) {
    const idx = findDoubleCRLF(buf);
    if (idx !== -1) {
      return {
        headerBytes: buf.slice(0, idx + 4),
        leftover: buf.slice(idx + 4),
      };
    }
    const { value, done } = await reader.read();
    if (done) throw new Error("Conexão fechada antes do fim dos headers HTTP");
    buf = concat(buf, value);
    if (buf.length > 1_000_000) throw new Error("Headers HTTP muito grandes");
  }
}

function findDoubleCRLF(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
  }
  return -1;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function parseStatusAndHeaders(headerBytes: Uint8Array): {
  status: number;
  statusText: string;
  headers: Headers;
} {
  const text = dec.decode(headerBytes);
  const lines = text.split("\r\n");
  const statusLine = lines.shift() ?? "";
  const m = /^HTTP\/\d\.\d\s+(\d+)\s*(.*)$/.exec(statusLine);
  if (!m) throw new Error(`Status line inválida: ${statusLine}`);
  const status = parseInt(m[1], 10);
  const statusText = m[2] ?? "";
  const headers = new Headers();
  for (const line of lines) {
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 1) continue;
    const name = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    headers.append(name, value);
  }
  return { status, statusText, headers };
}

async function readChunkedBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  leftover: Uint8Array,
): Promise<Uint8Array> {
  let buf = leftover;
  const parts: Uint8Array[] = [];

  const ensureLine = async (): Promise<{ line: string; rest: Uint8Array }> => {
    while (true) {
      for (let i = 0; i + 1 < buf.length; i++) {
        if (buf[i] === 13 && buf[i + 1] === 10) {
          const line = dec.decode(buf.slice(0, i));
          return { line, rest: buf.slice(i + 2) };
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("Conexão fechada no meio do chunked body");
      buf = concat(buf, value);
    }
  };

  const ensureBytes = async (n: number): Promise<Uint8Array> => {
    while (buf.length < n) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Conexão fechada no meio de um chunk");
      buf = concat(buf, value);
    }
    const out = buf.slice(0, n);
    buf = buf.slice(n);
    return out;
  };

  while (true) {
    const { line, rest } = await ensureLine();
    buf = rest;
    const sizeHex = line.split(";")[0].trim();
    const size = parseInt(sizeHex, 16);
    if (Number.isNaN(size)) throw new Error(`Chunk size inválido: ${line}`);
    if (size === 0) {
      // trailers até "\r\n\r\n" — descarta
      // já consumimos uma CRLF do tamanho; precisamos do CRLF final
      while (true) {
        const { line: trailer, rest: r2 } = await ensureLine();
        buf = r2;
        if (trailer === "") break;
      }
      break;
    }
    const data = await ensureBytes(size);
    parts.push(data);
    // CRLF após o chunk
    await ensureBytes(2);
  }

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function readFixedBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  leftover: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  let buf = leftover;
  while (buf.length < length) {
    const { value, done } = await reader.read();
    if (done) break;
    buf = concat(buf, value);
  }
  return buf.slice(0, length);
}

async function readUntilClose(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  leftover: Uint8Array,
): Promise<Uint8Array> {
  let buf = leftover;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf = concat(buf, value);
  }
  return buf;
}

export async function proxyFetch(
  url: string,
  init: ProxyFetchInit,
  proxy: ProxyInfo,
): Promise<ProxyResponse> {
  const u = new URL(url);
  if (u.protocol !== "https:") {
    throw new Error(`proxyFetch só suporta HTTPS, recebeu ${u.protocol}`);
  }
  const targetHost = u.hostname;
  const targetPort = u.port ? parseInt(u.port, 10) : 443;

  // Import dinâmico — só existe em workerd
  // Import dinâmico ofuscado — `cloudflare:sockets` só existe no runtime workerd
  // e o bundler tenta resolvê-lo em build se o specifier ficar literal.
  const modName = "cloudflare" + ":sockets";
  const { connect } = await import(/* @vite-ignore */ modName) as { connect: any };

  let socket: any = connect(
    { hostname: proxy.ip, port: proxy.port },
    { secureTransport: "starttls", allowHalfOpen: false },
  );

  try {
    const writer = socket.writable.getWriter();
    let reader = socket.readable.getReader();

    // 1. CONNECT
    const connectLines = [
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
      `Host: ${targetHost}:${targetPort}`,
      `User-Agent: x-runner/1.0`,
      `Proxy-Connection: keep-alive`,
    ];
    if (proxy.username) {
      const auth = btoaAscii(`${proxy.username}:${proxy.password ?? ""}`);
      connectLines.push(`Proxy-Authorization: Basic ${auth}`);
    }
    connectLines.push("", "");
    await writer.write(enc.encode(connectLines.join("\r\n")));

    const connectResp = await readUntilDoubleCRLF(reader, new Uint8Array(0));
    const connectParsed = parseStatusAndHeaders(connectResp.headerBytes);
    if (connectParsed.status !== 200) {
      throw new Error(
        `Proxy ${proxy.ip}:${proxy.port} recusou CONNECT: HTTP ${connectParsed.status} ${connectParsed.statusText}`,
      );
    }
    if (connectResp.leftover.length) {
      // Dados antes do upgrade TLS — protocolo violado
      throw new Error("Proxy enviou bytes antes do upgrade TLS");
    }

    // 2. Upgrade TLS
    writer.releaseLock();
    reader.releaseLock();
    socket = socket.startTls({ expectedServerHostname: targetHost });

    const tlsWriter = socket.writable.getWriter();
    reader = socket.readable.getReader();

    // 3. Request HTTP/1.1 sobre TLS
    const method = (init.method ?? "GET").toUpperCase();
    const path = `${u.pathname}${u.search}`;

    const reqHeaders: Record<string, string> = {};
    if (init.headers) {
      for (const [k, v] of Object.entries(init.headers)) reqHeaders[k.toLowerCase()] = v;
    }
    reqHeaders["host"] = targetHost;
    reqHeaders["connection"] = "close";
    // Sem compressão — não temos zlib/brotli/zstd inline
    reqHeaders["accept-encoding"] = "identity";

    let bodyBytes: Uint8Array | undefined;
    if (init.body !== undefined && init.body !== null) {
      bodyBytes = typeof init.body === "string" ? enc.encode(init.body) : init.body;
      reqHeaders["content-length"] = String(bodyBytes.length);
    } else if (method !== "GET" && method !== "HEAD") {
      reqHeaders["content-length"] = "0";
    }

    const lines = [`${method} ${path} HTTP/1.1`];
    for (const [k, v] of Object.entries(reqHeaders)) lines.push(`${k}: ${v}`);
    lines.push("", "");
    await tlsWriter.write(enc.encode(lines.join("\r\n")));
    if (bodyBytes && bodyBytes.length) {
      await tlsWriter.write(bodyBytes);
    }

    // 4. Ler resposta
    const head = await readUntilDoubleCRLF(reader, new Uint8Array(0));
    const parsed = parseStatusAndHeaders(head.headerBytes);

    let bodyData: Uint8Array;
    const te = parsed.headers.get("transfer-encoding")?.toLowerCase();
    const cl = parsed.headers.get("content-length");
    if (te && te.includes("chunked")) {
      bodyData = await readChunkedBody(reader, head.leftover);
    } else if (cl) {
      bodyData = await readFixedBody(reader, head.leftover, parseInt(cl, 10));
    } else {
      bodyData = await readUntilClose(reader, head.leftover);
    }

    try { await tlsWriter.close(); } catch { /* ignore */ }
    try { reader.releaseLock(); } catch { /* ignore */ }
    try { await socket.close(); } catch { /* ignore */ }

    const text = dec.decode(bodyData);
    return {
      ok: parsed.status >= 200 && parsed.status < 300,
      status: parsed.status,
      statusText: parsed.statusText,
      headers: parsed.headers,
      async text() { return text; },
      async json() { return JSON.parse(text); },
    };
  } catch (e: any) {
    try { await socket.close(); } catch { /* ignore */ }
    throw new Error(`proxy ${proxy.ip}:${proxy.port}: ${e?.message ?? String(e)}`);
  }
}
