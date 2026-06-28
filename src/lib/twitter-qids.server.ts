// Resolvedor de queryIds do GraphQL do X.
//
// O X rotaciona os queryIds de cada operação a cada ~2-4 semanas; quando isso
// acontece, o ID fixo no código passa a retornar HTTP 404. Para não quebrar:
//   1) Mantemos um FALLBACK com os últimos IDs bons conhecidos (caminho feliz,
//      sem nenhuma dependência de rede).
//   2) Quando uma chamada dá 404 (ID rotacionado), buscamos o mapa atual de
//      operationName -> queryId de uma fonte que rastreia o bundle real do X e
//      tentamos de novo. Os IDs novos ficam em cache na memória do processo.
//
// Resultado: se auto-corrige sozinho quando o X muda os IDs.

// IDs "última versão boa conhecida". Para a maioria das operações, IDs antigos
// que o X ainda honra (verificados em produção: detecção, like, retweet). Só o
// SearchTimeline foi aposentado e precisou do ID atual do bundle do X.
const FALLBACK: Record<string, string> = {
  CreateTweet: "DQIp0b4mKIciCAZ3bfrwAA",
  CreateRetweet: "ojPdsZsimiJrUGLR1sjUtA",
  FavoriteTweet: "lI07N6Otwv1PhnEgXILM7A",
  UserByScreenName: "681MIj51w00Aj6dY0GXnHw",
  UserTweets: "RyDU3I9VJtPF-Pnl6vrRlw",
  Viewer: "XdoyrgGBgyPmBDS7Snsd4A",
  SearchTimeline: "Bcw3RzK-PatNAmbnw54hFw",
};

// Fonte mantida (auto-atualizada a partir do bundle do X).
const SOURCE_URL =
  "https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/docs/json/GraphQL.json";

let overrides: Record<string, string> = {};
let lastRefresh = 0;
let inflight: Promise<void> | null = null;
const MIN_REFRESH_INTERVAL_MS = 60_000; // no máx 1 refresh por minuto

/** queryId atual da operação: override dinâmico > fallback fixo. */
export function resolveQID(operationName: string): string {
  return overrides[operationName] || FALLBACK[operationName] || "";
}

/** Varre o JSON da fonte e extrai todo par operationName -> queryId. */
function parseQIDs(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.queryId === "string" && typeof o.operationName === "string") {
      out[o.operationName] = o.queryId;
    }
    for (const key of Object.keys(o)) visit(o[key]);
  };
  visit(data);
  return out;
}

/** Busca os IDs atuais do X e atualiza SOMENTE a operação informada.
 *  Importante: NÃO mexe nas outras operações — assim uma operação que rotacionou
 *  nunca contamina/quebra as que já estão funcionando (a fonte externa pode estar
 *  atrasada para algumas operações). Chamado só quando há um 404. */
export async function refreshQID(operationName: string): Promise<void> {
  // throttle: no máx 1 fetch por minuto; se já temos override pra essa op, nem tenta.
  if (overrides[operationName]) return;
  if (Date.now() - lastRefresh < MIN_REFRESH_INTERVAL_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      let res: Response;
      try {
        res = await fetch(SOURCE_URL, {
          headers: { accept: "application/json" },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
      lastRefresh = Date.now();
      if (!res.ok) return;
      const data = await res.json();
      const map = parseQIDs(data);
      const id = map[operationName];
      // só aplica se a fonte tem um ID DIFERENTE do fallback (senão não adianta).
      if (id && id !== FALLBACK[operationName]) overrides[operationName] = id;
    } catch {
      /* sem rede / fonte fora do ar: segue com fallback */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
