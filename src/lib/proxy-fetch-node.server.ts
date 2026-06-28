/**
 * Fetch HTTPS através de um proxy HTTP (CONNECT) usando `undici` (Node/Vercel).
 *
 * Substitui o caminho `cloudflare:sockets` (que só roda no workerd) para que o
 * roteamento por proxy residencial funcione no runtime Node da Vercel.
 * Retorna a Response do undici, que já expõe ok/status/headers.getSetCookie()/text().
 */
import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { ProxyInfo } from "./proxy-fetch.server";

interface ProxyFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export async function nodeProxyFetch(
  url: string,
  init: ProxyFetchInit,
  proxy: ProxyInfo,
) {
  const cred =
    proxy.username
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? "")}@`
      : "";
  const uri = `http://${cred}${proxy.ip}:${proxy.port}`;
  const agent = new ProxyAgent({ uri, requestTls: { rejectUnauthorized: false } });

  // undici descomprime gzip/deflate/br, mas não zstd — evita corpo corrompido.
  const headers = { ...(init.headers ?? {}) };
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === "accept-encoding") headers[k] = "gzip, deflate, br";
  }

  return await undiciFetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body as any,
    dispatcher: agent,
  });
}
