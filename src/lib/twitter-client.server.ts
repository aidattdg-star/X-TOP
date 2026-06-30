// X (Twitter) client using web session cookies (ct0 + auth_token).
// Quando um ProxyInfo é fornecido roteamos via CONNECT+TLS pelo proxy
// (cloudflare:sockets). Sem proxy, usa fetch nativo do Worker.
import { ClientTransaction, handleXMigration } from "x-client-transaction-id";
import { type ProxyInfo as PFProxyInfo } from "./proxy-fetch.server";
import { resolveQID, refreshQID } from "./twitter-qids.server";

const WEB_BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

// Os queryIds das operações são resolvidos dinamicamente (com fallback fixo e
// auto-correção em 404) em "./twitter-qids.server". As chamadas passam só o
// operationName; gqlGet/gqlPost montam o caminho e tentam de novo se o X
// rotacionar o ID.

let transactionPromise: Promise<ClientTransaction> | null = null;

function apiPath(urlOrPath: string): string {
  const pathname = urlOrPath.startsWith("http")
    ? new URL(urlOrPath).pathname
    : urlOrPath;
  return pathname.replace(/^\/i\/api/, "") || "/";
}

async function transactionId(method: string, urlOrPath: string): Promise<string | undefined> {
  try {
    transactionPromise ??= ClientTransaction.create(await handleXMigration());
    const transaction = await transactionPromise;
    return transaction.generateTransactionId(method.toUpperCase(), apiPath(urlOrPath));
  } catch {
    transactionPromise = null;
    return undefined;
  }
}

export interface AuthTokens {
  ct0: string;
  auth_token: string;
  cookie_string?: string;
  refreshed?: boolean;
}

export type ProxyInfo = PFProxyInfo;

// Dispatcher = ProxyInfo (ou nada). Mantemos o nome por compat com o resto.
export type Dispatcher = ProxyInfo | null | undefined;
export function buildDispatcher(proxy?: ProxyInfo | null): Dispatcher {
  if (!proxy || !proxy.ip || !proxy.port) return undefined;
  return proxy;
}

interface FetchRespLike {
  ok: boolean;
  status: number;
  headers: Headers;
  text(): Promise<string>;
}

async function doFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  d?: Dispatcher,
): Promise<FetchRespLike> {
  if (d) {
    // Node/Vercel: roteia via undici ProxyAgent (cloudflare:sockets não existe aqui).
    const { nodeProxyFetch } = await import("./proxy-fetch-node.server");
    return (await nodeProxyFetch(url, init, d)) as unknown as FetchRespLike;
  }
  const res = await fetch(url, init as RequestInit);
  return res;
}

// Realistic Chrome 131 on Windows 10 — must stay internally consistent
// (User-Agent ↔ sec-ch-ua brand/version ↔ platform). Inconsistencies are
// one of the strongest signals X uses to fingerprint automation.
const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SEC_CH_UA = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
const SEC_CH_UA_FULL =
  '"Google Chrome";v="131.0.6778.86", "Chromium";v="131.0.6778.86", "Not_A Brand";v="24.0.0.0"';


async function headers(tokens: AuthTokens, method: string, urlOrPath: string): Promise<Record<string, string>> {
  // Quando temos o cookie completo, garantimos que o ct0 ali bate com tokens.ct0
  // (que pode ter sido rotacionado pelo X). Caso contrário, montamos o mínimo.
  const cookie = tokens.cookie_string
    ? syncCt0InCookieString(tokens.cookie_string, tokens.ct0)
    : `auth_token=${tokens.auth_token}; ct0=${tokens.ct0}`;

  const h: Record<string, string> = {
    authorization: WEB_BEARER,
    "x-csrf-token": tokens.ct0,
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
    "x-twitter-client-version": "Twitter-TweetDeck-blackbird-chrome/4.0.250109094932 web/",
    "content-type": "application/json",
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "gzip, deflate, br, zstd",
    "user-agent": UA_CHROME,
    origin: "https://x.com",
    referer: "https://x.com/home",
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-ch-ua-platform-version": '"15.0.0"',
    "sec-ch-ua-arch": '"x86"',
    "sec-ch-ua-bitness": '"64"',
    "sec-ch-ua-model": '""',
    "sec-ch-ua-full-version-list": SEC_CH_UA_FULL,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    dnt: "1",
    priority: "u=1, i",
    cookie,
  };
  const id = await transactionId(method, urlOrPath);
  if (id) h["x-client-transaction-id"] = id;
  return h;
}

function syncCt0InCookieString(cookieString: string, freshCt0: string): string {
  if (!freshCt0) return cookieString;
  if (/(?:^|;\s*)ct0=/.test(cookieString)) {
    return cookieString.replace(/(^|;\s*)ct0=[^;]*/i, `$1ct0=${freshCt0}`);
  }
  return `${cookieString.replace(/;\s*$/, "")}; ct0=${freshCt0}`;
}

/** Captura Set-Cookie da resposta do X e atualiza tokens IN PLACE.
 *  X rotaciona ct0 com frequência e pode atualizar att/kdt/twid — se ignorarmos,
 *  a próxima request usa cookie velho e cai em 401/403 silencioso. */
function applySetCookies(tokens: AuthTokens, res: { headers: Headers }): void {
  // Workers/undici expõem getSetCookie(); Headers.get("set-cookie") só dá o primeiro.
  const setCookies: string[] =
    typeof (res.headers as any).getSetCookie === "function"
      ? (res.headers as any).getSetCookie()
      : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
  if (!setCookies.length) return;

  let cookieString = tokens.cookie_string ?? `auth_token=${tokens.auth_token}; ct0=${tokens.ct0}`;
  let mutated = false;

  for (const raw of setCookies) {
    const first = raw.split(";")[0];
    const eq = first.indexOf("=");
    if (eq < 1) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name || value === "" || /^(deleted|"")$/i.test(value)) continue;
    // Atualiza dentro da cookie_string
    if (new RegExp(`(?:^|;\\s*)${escapeRe(name)}=`).test(cookieString)) {
      cookieString = cookieString.replace(
        new RegExp(`(^|;\\s*)${escapeRe(name)}=[^;]*`, "i"),
        `$1${name}=${value}`,
      );
    } else {
      cookieString = `${cookieString.replace(/;\s*$/, "")}; ${name}=${value}`;
    }
    if (name === "ct0" && value && value !== tokens.ct0) {
      tokens.ct0 = value;
      mutated = true;
    }
    if (name === "auth_token" && value && value !== tokens.auth_token) {
      tokens.auth_token = value;
      mutated = true;
    }
  }
  if (cookieString !== tokens.cookie_string) {
    tokens.cookie_string = cookieString;
    mutated = true;
  }
  if (mutated) tokens.refreshed = true;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Recebe o operationName (ex.: "CreateRetweet"); o queryId é resolvido na hora.
// Em HTTP 404 (ID rotacionado pelo X) atualiza os IDs e tenta de novo 1x.
async function gqlPost(op: string, tokens: AuthTokens, body: unknown, d?: Dispatcher) {
  const send = async () => {
    const path = `${resolveQID(op)}/${op}`;
    const finalBody =
      body && typeof body === "object" && !Array.isArray(body)
        ? { ...(body as Record<string, unknown>), queryId: resolveQID(op) }
        : body;
    const res = await doFetch(`https://x.com/i/api/graphql/${path}`, {
      method: "POST",
      headers: await headers(tokens, "POST", `/graphql/${path}`),
      body: JSON.stringify(finalBody),
    }, d);
    applySetCookies(tokens, res);
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { res, json, text };
  };

  let { res, json, text } = await send();
  if (res.status === 404) {
    await refreshQID(op);
    ({ res, json, text } = await send());
  }
  if (!res.ok || (json?.errors && !json?.data)) {
    throw xApiError("X API", res.status, text, json);
  }
  return json;
}

async function gqlGet(
  op: string,
  tokens: AuthTokens,
  variables: object,
  features: object,
  fieldToggles?: object,
  d?: Dispatcher,
) {
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
  });
  if (fieldToggles) params.set("fieldToggles", JSON.stringify(fieldToggles));
  const qs = params.toString();
  const send = async () => {
    const path = `${resolveQID(op)}/${op}`;
    const url = `https://x.com/i/api/graphql/${path}?${qs}`;
    const res = await doFetch(url, { method: "GET", headers: await headers(tokens, "GET", `/graphql/${path}`) }, d);
    applySetCookies(tokens, res);
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { res, json, text };
  };

  let { res, json, text } = await send();
  if (res.status === 404) {
    await refreshQID(op);
    ({ res, json, text } = await send());
  }
  if (!res.ok || json?.errors) {
    throw xApiError("X API", res.status, text, json);
  }
  return json;
}

const TWEET_FEATURES = {
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: false,
  tweet_awards_web_tipping_enabled: false,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

const USER_FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

const USER_FIELD_TOGGLES = {
  withPayments: false,
  withAuxiliaryUserLabels: false,
};

const VIEWER_FEATURES = {
  subscriptions_upsells_api_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

const VIEWER_FIELD_TOGGLES = {
  isDelegate: false,
  withPayments: false,
  withAuxiliaryUserLabels: false,
};

function xApiError(prefix: string, status: number, text: string, json: any): Error {
  const err = json?.errors?.[0];
  const code = err?.code;
  const msg = err?.message || `HTTP ${status}: ${text.slice(0, 200)}`;
  if (code === 32 || code === 89 || code === 215 || status === 401) {
    return new Error(
      `Cookies inválidos ou expirados (code ${code ?? status}). Refaça login no X e atualize ct0 + auth_token.`,
    );
  }
  if (code === 34) {
    return new Error(
      `${prefix}: o X recusou a chamada como página inexistente (code 34). Confirme que os cookies são de x.com e tente copiar ct0 + auth_token novamente.`,
    );
  }
  return new Error(`${prefix}: ${msg}`);
}

function parseUserResult(result: any, fallbackScreenName: string) {
  const legacy = result?.legacy ?? {};
  const core = result?.core ?? {};
  const avatar = result?.avatar ?? {};
  return {
    id: String(result?.rest_id ?? legacy?.id_str ?? ""),
    screen_name: String(core?.screen_name ?? legacy?.screen_name ?? fallbackScreenName),
    name: String(core?.name ?? legacy?.name ?? ""),
    profile_picture_url: String(avatar?.image_url ?? legacy?.profile_image_url_https ?? "").replace("_normal", ""),
    followers_count: Number(legacy?.followers_count ?? 0),
  };
}

/** Sobe uma imagem pro X (cookie-auth) e devolve o media_id_string.
 *  `imageBase64` = base64 sem prefixo data:. Rota pelo proxy quando há dispatcher. */
export async function uploadTweetMedia(
  tokens: AuthTokens,
  imageBase64: string,
  d?: Dispatcher,
): Promise<string> {
  const path = "media/upload.json";
  const body = new URLSearchParams({ media_data: imageBase64, media_category: "tweet_image" }).toString();
  const h = await headers(tokens, "POST", `/1.1/${path}`);
  h["content-type"] = "application/x-www-form-urlencoded";
  const res = await doFetch(`https://upload.twitter.com/1.1/${path}`, { method: "POST", headers: h, body }, d);
  applySetCookies(tokens, res);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || json?.errors) throw xApiError("X media/upload", res.status, text, json);
  const id = json?.media_id_string;
  if (!id) throw new Error(`Upload de mídia falhou: ${text.slice(0, 160)}`);
  return String(id);
}

/** Sobe um VÍDEO pro X via upload em pedaços (INIT→APPEND→FINALIZE→STATUS).
 *  `bytes` = conteúdo bruto do vídeo. Espera o X processar (com teto de tempo). */
export async function uploadTweetVideo(
  tokens: AuthTokens,
  bytes: Uint8Array,
  mediaType: string,
  d?: Dispatcher,
): Promise<string> {
  const url = "https://upload.twitter.com/1.1/media/upload.json";
  const sigPath = "/1.1/media/upload.json";
  const total = bytes.length;
  const post = async (body: string) => {
    const h = await headers(tokens, "POST", sigPath);
    h["content-type"] = "application/x-www-form-urlencoded";
    const res = await doFetch(url, { method: "POST", headers: h, body }, d);
    applySetCookies(tokens, res);
    const text = await res.text();
    let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { res, text, json };
  };

  // INIT
  let r = await post(new URLSearchParams({
    command: "INIT", total_bytes: String(total), media_type: mediaType, media_category: "tweet_video",
  }).toString());
  if (!r.res.ok || r.json?.errors) throw xApiError("X video INIT", r.res.status, r.text, r.json);
  const mediaId = String(r.json?.media_id_string ?? "");
  if (!mediaId) throw new Error(`INIT de vídeo falhou: ${r.text.slice(0, 160)}`);

  // APPEND em pedaços de ~2MB
  const CHUNK = 2 * 1024 * 1024;
  let seg = 0;
  for (let off = 0; off < total; off += CHUNK) {
    const slice = bytes.subarray(off, Math.min(off + CHUNK, total));
    let bin = "";
    const sub = 0x8000;
    for (let i = 0; i < slice.length; i += sub) bin += String.fromCharCode(...slice.subarray(i, Math.min(i + sub, slice.length)));
    r = await post(new URLSearchParams({
      command: "APPEND", media_id: mediaId, segment_index: String(seg), media_data: btoa(bin),
    }).toString());
    if (!r.res.ok) throw xApiError("X video APPEND", r.res.status, r.text, r.json);
    seg++;
  }

  // FINALIZE
  r = await post(new URLSearchParams({ command: "FINALIZE", media_id: mediaId }).toString());
  if (!r.res.ok || r.json?.errors) throw xApiError("X video FINALIZE", r.res.status, r.text, r.json);

  // STATUS poll — espera processar (teto de ~25s pra não estourar a função)
  let info = r.json?.processing_info;
  let waited = 0;
  while (info && (info.state === "pending" || info.state === "in_progress")) {
    const wait = Math.min(Math.max(Number(info.check_after_secs) || 2, 1), 5);
    if (waited + wait > 25) throw new Error("Vídeo demorou demais pra processar no X — use um vídeo menor/mais curto.");
    await new Promise((res) => setTimeout(res, wait * 1000));
    waited += wait;
    const h = await headers(tokens, "GET", sigPath);
    const res = await doFetch(`${url}?command=STATUS&media_id=${mediaId}`, { method: "GET", headers: h }, d);
    applySetCookies(tokens, res);
    const text = await res.text();
    try { info = JSON.parse(text)?.processing_info; } catch { info = null; }
    if (info?.state === "failed") throw new Error(`X rejeitou o vídeo: ${JSON.stringify(info).slice(0, 160)}`);
  }
  return mediaId;
}

export async function postTweet(tokens: AuthTokens, text: string, d?: Dispatcher, mediaIds?: string[]) {
  const media_entities = (mediaIds ?? []).map((id) => ({ media_id: id, tagged_users: [] }));
  const json = await gqlPost("CreateTweet", tokens, {
    variables: {
      tweet_text: text,
      dark_request: false,
      media: { media_entities, possibly_sensitive: false },
      semantic_annotation_ids: [],
    },
    features: TWEET_FEATURES,
  }, d);
  const result = json?.data?.create_tweet?.tweet_results?.result;
  const restId = result?.rest_id ?? result?.tweet?.rest_id;
  const reason = result?.reason || result?.result?.reason;
  if (!restId) {
    throw new Error(
      `X aceitou a chamada mas não criou o tweet (provável shadow-block / nudge${reason ? ": " + reason : ""}). Resposta: ${JSON.stringify(json).slice(0, 400)}`,
    );
  }
  return { rest_id: String(restId), raw: json };
}

/** Apaga um tweet (usado no teste "postar e apagar" pra confirmar que a conta consegue publicar). */
export async function deleteTweet(tokens: AuthTokens, tweetId: string, d?: Dispatcher) {
  const json = await gqlPost("DeleteTweet", tokens, {
    variables: { tweet_id: tweetId, dark_request: false },
  }, d);
  return { ok: !!json?.data?.delete_tweet, raw: json };
}

export async function retweet(tokens: AuthTokens, tweetId: string, _d?: Dispatcher) {
  const json = await gqlPost("CreateRetweet", tokens, {
    variables: { tweet_id: tweetId, dark_request: false },
  });
  const restId = json?.data?.create_retweet?.retweet_results?.result?.rest_id;
  if (restId) return { rest_id: String(restId), raw: json };
  // "You have already retweeted this Tweet" (code 327) = efetivamente já está RT'ado
  const code = json?.errors?.[0]?.code;
  if (code === 327) return { already: true, raw: json };
  // X devolveu 200 com create_retweet.retweet_results VAZIO ({}), sem erro:
  // a conta está limitada/em verificação (read-only) — consegue curtir mas o RT é
  // descartado silenciosamente. Marcamos com um prefixo pro worker sinalizar a conta.
  const emptyResults =
    json?.data?.create_retweet &&
    (!json.data.create_retweet.retweet_results ||
      Object.keys(json.data.create_retweet.retweet_results).length === 0);
  if (emptyResults) {
    throw new Error(
      `__RT_LIMITED__: X descartou o RT (conta provavelmente limitada/em verificação — like funciona, RT não). Resposta: ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  throw new Error(`Retweet não confirmado pelo X. Resposta: ${JSON.stringify(json).slice(0, 400)}`);
}

export async function commentReply(
  tokens: AuthTokens,
  tweetId: string,
  text: string,
  _d?: Dispatcher,
) {
  const json = await gqlPost("CreateTweet", tokens, {
    variables: {
      tweet_text: text,
      reply: { in_reply_to_tweet_id: tweetId, exclude_reply_user_ids: [] },
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    },
    features: TWEET_FEATURES,
  });
  const result = json?.data?.create_tweet?.tweet_results?.result;
  const restId = result?.rest_id ?? result?.tweet?.rest_id;
  if (!restId) {
    throw new Error(`Reply não confirmado pelo X. Resposta: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return { rest_id: String(restId), raw: json };
}

export async function likeTweet(tokens: AuthTokens, tweetId: string, _d?: Dispatcher) {
  const json = await gqlPost("FavoriteTweet", tokens, {
    variables: { tweet_id: tweetId },
  });
  if (json?.data?.favorite_tweet === "Done") return { done: true };
  // "already favorited" (code 139) = já curtido
  const code = json?.errors?.[0]?.code;
  if (code === 139) return { already: true };
  throw new Error(`Like não confirmado pelo X. Resposta: ${JSON.stringify(json).slice(0, 400)}`);
}

/** Confirma que os cookies (ct0 + auth_token) estão válidos via GraphQL UserByScreenName. */
export async function verifySession(
  tokens: AuthTokens,
  screenName: string,
  _d?: Dispatcher,
): Promise<{ ok: true; id: string; screen_name: string; name: string; followers_count: number }> {
  const clean = screenName.replace(/^@/, "");
  const json = await gqlGet(
    "UserByScreenName",
    tokens,
    { screen_name: clean, withSafetyModeUserFields: true },
    USER_FEATURES,
    USER_FIELD_TOGGLES,
  );
  const user = parseUserResult(json?.data?.user?.result, clean);
  if (!user.id) throw new Error(`Usuário @${clean} não encontrado ou cookies sem permissão.`);
  return {
    ok: true,
    id: user.id,
    screen_name: user.screen_name,
    name: user.name,
    followers_count: user.followers_count,
  };
}

/** Detecta a conta autenticada pelos cookies, sem precisar informar @. */
export async function getAuthenticatedUserFromCookies(
  tokens: AuthTokens,
): Promise<{ id: string; screen_name: string; name: string; profile_picture_url: string }> {
  const json = await gqlGet(
    "Viewer",
    tokens,
    {},
    VIEWER_FEATURES,
    VIEWER_FIELD_TOGGLES,
  );
  const result = json?.data?.viewer?.user_results?.result;
  const user = parseUserResult(result, "");
  if (!user.screen_name) throw new Error("Cookies aceitos, mas o X não retornou o @ da conta.");
  return user;
}

/** Pega um ct0 novo a partir de só o auth_token.
 *  O X devolve `ct0` via Set-Cookie em qualquer request autenticada sem CSRF. */
export async function bootstrapCt0FromAuthToken(
  auth_token: string,
): Promise<{ ct0: string; cookie_string: string }> {
  const clean = auth_token.trim().replace(/^auth_token=/, "");
  if (!clean) throw new Error("auth_token vazio.");

  // Endpoint barato que sempre responde com Set-Cookie: ct0=...
  const url = "https://api.x.com/1.1/account/settings.json";
  const res = await fetch(url, {
    method: "GET",
    headers: {
      authorization: WEB_BEARER,
      "user-agent": UA_CHROME,
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      origin: "https://x.com",
      referer: "https://x.com/",
      "sec-ch-ua": SEC_CH_UA,
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      cookie: `auth_token=${clean}`,
    },
  });

  const setCookies: string[] =
    typeof (res.headers as any).getSetCookie === "function"
      ? (res.headers as any).getSetCookie()
      : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);

  let ct0 = "";
  const extras: Record<string, string> = {};
  for (const raw of setCookies) {
    const first = raw.split(";")[0];
    const eq = first.indexOf("=");
    if (eq < 1) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name || !value || /^(deleted|"")$/i.test(value)) continue;
    if (name === "ct0") ct0 = value;
    else extras[name] = value;
  }

  if (!ct0) {
    // Resposta 401 sem ct0 => auth_token inválido/expirado.
    throw new Error(
      `auth_token inválido ou expirado — o X não devolveu ct0 (HTTP ${res.status}). Copie o auth_token de novo do x.com (DevTools → Application → Cookies).`,
    );
  }

  // Monta um cookie_string mínimo coerente. Os campos extras (guest_id, att, kdt…)
  // que vierem nos Set-Cookie são incluídos, o resto o keepalive completa depois.
  const parts = [`auth_token=${clean}`, `ct0=${ct0}`];
  for (const [k, v] of Object.entries(extras)) parts.push(`${k}=${v}`);
  return { ct0, cookie_string: parts.join("; ") };
}

export async function getUserIdByScreenName(
  tokens: AuthTokens,
  screenName: string,
  _d?: Dispatcher,
): Promise<string> {
  const clean = screenName.replace(/^@/, "");
  const json = await gqlGet(
    "UserByScreenName",
    tokens,
    { screen_name: clean, withSafetyModeUserFields: true },
    USER_FEATURES,
    USER_FIELD_TOGGLES,
  );
  const id = json?.data?.user?.result?.rest_id;
  if (!id) throw new Error(`Usuário @${clean} não encontrado`);
  return id as string;
}

export interface RecentTweet { id: string; favorite_count: number; view_count: number; created_at: string; }

function collectTweetResults(value: any, results: any[] = [], seen = new Set<any>()): any[] {
  if (!value || typeof value !== "object" || seen.has(value)) return results;
  seen.add(value);

  const result = value?.tweet_results?.result;
  if (result) results.push(result);

  if (Array.isArray(value)) {
    for (const item of value) collectTweetResults(item, results, seen);
    return results;
  }

  for (const child of Object.values(value)) {
    collectTweetResults(child, results, seen);
  }

  return results;
}

function normalizeTweetResult(result: any): RecentTweet | null {
  const tweet = result?.tweet ?? result;
  const legacy = tweet?.legacy ?? result?.legacy;
  const views = tweet?.views ?? result?.views;
  const id = legacy?.id_str ?? tweet?.rest_id ?? result?.rest_id;
  if (!id || legacy?.retweeted_status_result) return null;

  return {
    id: String(id),
    favorite_count: Number(legacy?.favorite_count ?? 0),
    view_count: Number(views?.count ?? 0),
    created_at: String(legacy?.created_at ?? ""),
  };
}

export async function getUserRecentTweets(
  tokens: AuthTokens,
  userId: string,
  count = 20,
  _d?: Dispatcher,
): Promise<RecentTweet[]> {
  const json = await gqlGet(
    "UserTweets",
    tokens,
    { userId, count, includePromotedContent: false, withQuickPromoteEligibilityTweetFields: false, withVoice: false, withV2Timeline: true },
    { ...TWEET_FEATURES, rweb_tipjar_consumption_enabled: true, communities_web_enable_tweet_community_results_fetch: true, c9s_tweet_anatomy_moderator_badge_enabled: true, articles_preview_enabled: true, creator_subscriptions_quote_tweet_preview_enabled: false, rweb_video_timestamps_enabled: true },
  );
  const byId = new Map<string, RecentTweet>();
  for (const result of collectTweetResults(json)) {
    const tweet = normalizeTweetResult(result);
    if (tweet && !byId.has(tweet.id)) byId.set(tweet.id, tweet);
  }

  return Array.from(byId.values()).slice(0, count);
}

/** Busca tweets recentes para uma keyword (aba "Latest" do X).
 *  Usa GraphQL SearchTimeline e devolve tweets normalizados com view_count. */
export async function searchRecentTweets(
  tokens: AuthTokens,
  query: string,
  count = 40,
  _d?: Dispatcher,
): Promise<RecentTweet[]> {
  const json = await gqlGet(
    "SearchTimeline",
    tokens,
    {
      rawQuery: query,
      count,
      querySource: "typed_query",
      product: "Latest",
    },
    {
      ...TWEET_FEATURES,
      rweb_tipjar_consumption_enabled: true,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      articles_preview_enabled: true,
      creator_subscriptions_quote_tweet_preview_enabled: false,
      rweb_video_timestamps_enabled: true,
    },
  );
  const byId = new Map<string, RecentTweet>();
  for (const result of collectTweetResults(json)) {
    const tweet = normalizeTweetResult(result);
    if (tweet && !byId.has(tweet.id)) byId.set(tweet.id, tweet);
  }
  return Array.from(byId.values());
}

/** Simula atividade de navegador real para manter a sessão "viva".
 *  Faz chamadas de leitura que o Chrome dispararia ao abrir x.com/home —
 *  isso renova ct0/att via Set-Cookie e sinaliza ao X que a sessão está em uso
 *  (não é só um robô que aparece pra postar e some). Não posta, não curte. */
export async function keepAliveSession(
  tokens: AuthTokens,
  _d?: Dispatcher,
): Promise<{ refreshed: boolean; viewer_screen_name?: string }> {
  let viewer_screen_name: string | undefined;
  try {
    const user = await getAuthenticatedUserFromCookies(tokens);
    viewer_screen_name = user.screen_name;
    // Segunda chamada "humana": ler os próprios tweets (timeline-style).
    if (user.id) {
      try { await getUserRecentTweets(tokens, user.id, 10); } catch { /* tolera */ }
    }
  } catch (e) {
    throw e;
  }
  return { refreshed: !!tokens.refreshed, viewer_screen_name };
}

// ============================================================================
// Profile editing — uses the legacy /1.1/account/ endpoints with web cookies
// ============================================================================

/** POST form-urlencoded para /1.1/account/* — espelha como o web faria. */
async function accountFormPost(
  path: string,
  tokens: AuthTokens,
  form: Record<string, string>,
  d?: Dispatcher,
) {
  const body = new URLSearchParams(form).toString();
  const h = await headers(tokens, "POST", `/1.1/${path}`);
  h["content-type"] = "application/x-www-form-urlencoded";
  const res = await doFetch(`https://api.x.com/1.1/${path}`, {
    method: "POST",
    headers: h,
    body,
  }, d);
  applySetCookies(tokens, res);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || json?.errors) {
    throw xApiError(`X /1.1/${path}`, res.status, text, json);
  }
  return json;
}

/** Liga/desliga "tweets protegidos" (conta privada). protected=false = pública. */
export async function setProtected(tokens: AuthTokens, isProtected: boolean, d?: Dispatcher) {
  return await accountFormPost("account/settings.json", tokens, { protected: isProtected ? "true" : "false" }, d);
}

/** POST multipart/form-data — usado pelo update_profile_image. */
async function accountMultipartPost(
  path: string,
  tokens: AuthTokens,
  fields: Record<string, string | { value: string; isBase64?: boolean }>,
  d?: Dispatcher,
) {
  const boundary = `----WebKitFormBoundary${Math.random().toString(36).slice(2)}`;
  const chunks: string[] = [];
  for (const [name, raw] of Object.entries(fields)) {
    const value = typeof raw === "string" ? raw : raw.value;
    chunks.push(`--${boundary}\r\n`);
    chunks.push(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    chunks.push(`${value}\r\n`);
  }
  chunks.push(`--${boundary}--\r\n`);
  const body = chunks.join("");

  const h = await headers(tokens, "POST", `/1.1/${path}`);
  h["content-type"] = `multipart/form-data; boundary=${boundary}`;
  const res = await doFetch(`https://api.x.com/1.1/${path}`, {
    method: "POST",
    headers: h,
    body,
  }, d);
  applySetCookies(tokens, res);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || json?.errors) {
    throw xApiError(`X /1.1/${path}`, res.status, text, json);
  }
  return json;
}

/** Atualiza nome, descrição/bio, localização, url do perfil. */
export async function updateProfile(
  tokens: AuthTokens,
  fields: { name?: string; description?: string; location?: string; url?: string },
  d?: Dispatcher,
) {
  const form: Record<string, string> = {};
  if (fields.name !== undefined) form.name = fields.name.slice(0, 50);
  if (fields.description !== undefined) form.description = fields.description.slice(0, 160);
  if (fields.location !== undefined) form.location = fields.location.slice(0, 30);
  if (fields.url !== undefined) form.url = fields.url.slice(0, 100);
  if (!Object.keys(form).length) throw new Error("Nada para atualizar");
  return await accountFormPost("account/update_profile.json", tokens, form, d);
}

/** Troca a foto de perfil. `imageBase64` = string base64 sem prefixo data:. */
export async function updateProfileImage(
  tokens: AuthTokens,
  imageBase64: string,
  d?: Dispatcher,
) {
  return await accountFormPost("account/update_profile_image.json", tokens, {
    image: imageBase64,
  }, d);
}

/** Troca o banner do perfil. `imageBase64` = string base64 sem prefixo data:. */
export async function updateProfileBanner(
  tokens: AuthTokens,
  imageBase64: string,
  d?: Dispatcher,
) {
  return await accountFormPost("account/update_profile_banner.json", tokens, {
    banner: imageBase64,
  }, d);
}

/** Troca o @ (screen_name). Risco maior — pode falhar se em uso ou flagged. */
export async function updateUsername(
  tokens: AuthTokens,
  newUsername: string,
  d?: Dispatcher,
) {
  const sn = newUsername.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(sn)) {
    throw new Error("@ inválido (1-15 caracteres, letras/números/underline)");
  }
  return await accountFormPost("account/settings.json", tokens, { screen_name: sn }, d);
}
