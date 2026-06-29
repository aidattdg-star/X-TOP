// Pool rotativo de contas X para leituras (busca, monitor) e ações genéricas.
// Estratégia: "menos usada recentemente" — escolhe a conta active com
// cooldown_until expirado/nulo, ordenada por last_used_at ASC NULLS FIRST.
// Em erro de rate-limit/cookies, pausa 15min e tenta a próxima.
//
// Server-only. Sempre invocar dentro do handler (carrega supabaseAdmin lazy).

type AuthTokens = { ct0: string; auth_token: string; cookie_string?: string; refreshed?: boolean };
type ProxyInfo = { ip: string; port: number; username?: string | null; password?: string | null };

export type PoolAccount = {
  id: string;
  username: string;
  tokens: AuthTokens;
  proxy: ProxyInfo | null;
};

const COOLDOWN_MIN = 15;
const MIN_GAP_SECONDS = 30;

/** Marca cooldown_until = now()+15min. Usar quando a conta tomar 401/403/429/timeout. */
export async function markAccountCooldown(admin: any, accountId: string, minutes = COOLDOWN_MIN) {
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await admin
    .from("twitter_accounts")
    .update({ cooldown_until: until, last_used_at: new Date().toISOString() })
    .eq("id", accountId);
}

/** Apenas atualiza last_used_at — para callers que já têm a conta fixada (ex: educar). */
export async function markAccountUsed(admin: any, accountId: string) {
  await admin
    .from("twitter_accounts")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", accountId);
}

/** Conta TRAVADA/bloqueada pelo X (precisa verificação) — não adianta insistir. */
export function isLockedError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("temporarily locked") ||
    m.includes("account is locked") ||
    m.includes("denied by access control") ||
    m.includes("malicious activity") ||
    m.includes("ldapgroup")
  );
}

/** Decide se uma mensagem de erro indica rate-limit/cookies/bloqueio — pula a conta e tenta outra. */
export function isRateLimitOrAuthError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("429") ||
    m.includes("rate") ||
    m.includes("limit") ||
    m.includes("unauthorized") ||
    m.includes("forbidden") ||
    m.includes("timeout") ||
    m.includes("cookies") ||
    m.includes("ct0") ||
    m.includes("auth_token") ||
    isLockedError(m)
  );
}

/** Busca a próxima conta livre, marca como usada, retorna dados + proxy. */
async function pickNext(admin: any, userId: string, excludeIds: Set<string>): Promise<PoolAccount | null> {
  const nowIso = new Date().toISOString();
  const gapAgo = new Date(Date.now() - MIN_GAP_SECONDS * 1000).toISOString();

  let q = admin
    .from("twitter_accounts")
    .select("id, username, auth_tokens, proxy_id, cooldown_until, last_used_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .or(`cooldown_until.is.null,cooldown_until.lt.${nowIso}`)
    .or(`last_used_at.is.null,last_used_at.lt.${gapAgo}`)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(20);

  const { data: rows } = await q;
  const candidates = (rows ?? []).filter((r: any) => {
    if (excludeIds.has(r.id)) return false;
    const t = r.auth_tokens || {};
    return t.ct0 && t.auth_token;
  });
  if (!candidates.length) return null;

  const chosen = candidates[0];

  // Reserva: marca last_used_at agora para próxima chamada pegar outra.
  await admin
    .from("twitter_accounts")
    .update({ last_used_at: nowIso })
    .eq("id", chosen.id);

  const { loadProxyOrFallback } = await import("@/lib/proxy-pool.server");
  const proxy = (await loadProxyOrFallback(admin, chosen.proxy_id)) as ProxyInfo | null;

  return {
    id: chosen.id,
    username: chosen.username,
    tokens: chosen.auth_tokens as AuthTokens,
    proxy,
  };
}

/**
 * Executa `fn` com uma conta do pool. Em erro de rate-limit/auth, pausa a
 * conta 15min e tenta a próxima — até `maxAttempts`.
 * Em sucesso, se os tokens rotacionaram (refreshed), persiste em twitter_accounts.
 */
export async function withRotator<T>(
  admin: any,
  userId: string,
  fn: (acc: PoolAccount) => Promise<T>,
  opts: { maxAttempts?: number } = {},
): Promise<{ ok: true; value: T; account: PoolAccount } | { ok: false; reason: string; tried: number }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const tried = new Set<string>();

  for (let i = 0; i < maxAttempts; i++) {
    const acc = await pickNext(admin, userId, tried);
    if (!acc) {
      return { ok: false, reason: tried.size ? "all_accounts_cooldown" : "no_accounts_available", tried: tried.size };
    }
    tried.add(acc.id);

    try {
      const value = await fn(acc);
      // Persiste tokens rotacionados
      if (acc.tokens.refreshed) {
        const { refreshed: _r, ...persist } = acc.tokens;
        await admin
          .from("twitter_accounts")
          .update({ auth_tokens: persist, updated_at: new Date().toISOString() })
          .eq("id", acc.id);
      }
      return { ok: true, value, account: acc };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isLockedError(msg)) {
        // Conta TRAVADA pelo X: não adianta insistir — descansa 6h e sinaliza LIMITADA.
        await markAccountCooldown(admin, acc.id, 360);
        try {
          await admin.from("twitter_accounts")
            .update({ limited_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", acc.id);
        } catch { /* coluna pode não existir */ }
        continue; // tenta a próxima conta
      }
      if (isRateLimitOrAuthError(msg)) {
        await markAccountCooldown(admin, acc.id);
        continue;
      }
      // Erro não recuperável: propaga
      throw err;
    }
  }

  return { ok: false, reason: "max_attempts_exceeded", tried: tried.size };
}
