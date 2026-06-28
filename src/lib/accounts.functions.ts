import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const testTwitterAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { account_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: acc, error } = await context.supabase
      .from("twitter_accounts")
      .select("id, username, auth_tokens")
      .eq("id", data.account_id)
      .maybeSingle();
    if (error || !acc) throw new Error("Conta não encontrada");

    const tokens = acc.auth_tokens as { ct0?: string; auth_token?: string; cookie_string?: string };
    if (!tokens?.auth_token) {
      await context.supabase
        .from("twitter_accounts")
        .update({ status: "banned" })
        .eq("id", acc.id);
      throw new Error("auth_token ausente. Atualize a conta.");
    }

    const { verifySession, bootstrapCt0FromAuthToken } = await import("@/lib/twitter-client.server");

    // Se faltar ct0, busca um novo a partir do auth_token.
    let ct0 = tokens.ct0;
    let cookie_string = tokens.cookie_string;
    if (!ct0) {
      const boot = await bootstrapCt0FromAuthToken(tokens.auth_token);
      ct0 = boot.ct0;
      cookie_string = boot.cookie_string;
    }

    try {
      const result = await verifySession(
        { ct0: ct0!, auth_token: tokens.auth_token, cookie_string },
        acc.username,
      );
      await context.supabase
        .from("twitter_accounts")
        .update({
          status: "active",
          display_name: result.name || undefined,
          auth_tokens: { ct0, auth_token: tokens.auth_token, cookie_string },
        })
        .eq("id", acc.id);
      return { id: result.id, screen_name: result.screen_name, name: result.name };
    } catch (e) {
      await context.supabase
        .from("twitter_accounts")
        .update({ status: "banned" })
        .eq("id", acc.id);
      throw e instanceof Error ? e : new Error(String(e));
    }
  });

/** Teste de postagem: a conta publica 2 tweets "hello world" (distintos, pra
 *  não cair na trava de duplicado do X). Comprova que sessão + proxy + escrita
 *  funcionam de verdade. Retorna o resultado de cada um (com link). */
export const testPostTweets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { account_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: acc, error } = await context.supabase
      .from("twitter_accounts")
      .select("id, username, auth_tokens, proxy_id")
      .eq("id", data.account_id)
      .maybeSingle();
    if (error || !acc) throw new Error("Conta não encontrada");

    const tokens = acc.auth_tokens as { ct0?: string; auth_token?: string; cookie_string?: string };
    if (!tokens?.auth_token) throw new Error("auth_token ausente. Atualize a conta.");

    const { postTweet, bootstrapCt0FromAuthToken, buildDispatcher } = await import(
      "@/lib/twitter-client.server"
    );

    // ct0 fresco se faltar
    let ct0 = tokens.ct0;
    let cookie_string = tokens.cookie_string;
    if (!ct0) {
      const boot = await bootstrapCt0FromAuthToken(tokens.auth_token);
      ct0 = boot.ct0;
      cookie_string = boot.cookie_string;
    }

    // proxy da conta (escrita SEMPRE vai pelo proxy)
    let proxy: { ip: string; port: number; username: string | null; password: string | null } | null = null;
    if (acc.proxy_id) {
      const { data: p } = await context.supabase
        .from("proxies")
        .select("ip, port, username, password")
        .eq("id", acc.proxy_id)
        .maybeSingle();
      proxy = p as any;
    }
    const dispatcher = buildDispatcher(proxy);
    const tok = { ct0: ct0!, auth_token: tokens.auth_token, cookie_string };

    // sufixo curto único por execução (evita duplicado entre testes repetidos)
    const tag = Math.random().toString(36).slice(2, 6);
    const texts = [`hello world · ${tag}`, `hello world 2 · ${tag}`];

    const results: { text: string; ok: boolean; url?: string; error?: string }[] = [];
    for (const text of texts) {
      try {
        const r = await postTweet(tok, text, dispatcher);
        results.push({ text, ok: true, url: `https://x.com/${acc.username}/status/${r.rest_id}` });
      } catch (e) {
        results.push({ text, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // persiste ct0/cookies rotacionados pela escrita
    if (tok.ct0 !== tokens.ct0 || tok.cookie_string !== tokens.cookie_string) {
      await context.supabase
        .from("twitter_accounts")
        .update({
          status: "active",
          auth_tokens: { ct0: tok.ct0, auth_token: tok.auth_token, cookie_string: tok.cookie_string },
        })
        .eq("id", acc.id);
    }

    const okCount = results.filter((r) => r.ok).length;
    return { username: acc.username, ok_count: okCount, total: texts.length, results };
  });

/** Detecta @, nome e foto a partir de SÓ o auth_token.
 *  Faz bootstrap do ct0 (Set-Cookie do X) e devolve já os tokens prontos pra salvar. */
export const detectAccountFromCookies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { auth_token: string; cookie_string?: string }) => input)
  .handler(async ({ data }) => {
    const auth_token = data.auth_token?.trim().replace(/^auth_token=/, "");
    if (!auth_token) throw new Error("Informe o auth_token.");

    const { getAuthenticatedUserFromCookies, bootstrapCt0FromAuthToken } = await import(
      "@/lib/twitter-client.server"
    );

    const boot = await bootstrapCt0FromAuthToken(auth_token);
    // Se o usuário colou o cookie completo do navegador, preferimos ele
    // (com o ct0 atualizado), porque traz guest_id/kdt/twid/att etc.
    const cookie_string = data.cookie_string
      ? mergeCt0(data.cookie_string, boot.ct0, auth_token)
      : boot.cookie_string;

    const user = await getAuthenticatedUserFromCookies({
      ct0: boot.ct0,
      auth_token,
      cookie_string,
    });

    return {
      id: user.id,
      username: user.screen_name,
      name: user.name,
      profile_picture_url: user.profile_picture_url,
      tokens: { ct0: boot.ct0, auth_token, cookie_string },
    };
  });

function mergeCt0(cookieString: string, ct0: string, auth_token: string): string {
  let s = cookieString.trim().replace(/;\s*$/, "");
  // garante auth_token correto
  if (/(?:^|;\s*)auth_token=/.test(s)) {
    s = s.replace(/(^|;\s*)auth_token=[^;]*/i, `$1auth_token=${auth_token}`);
  } else {
    s = `${s}; auth_token=${auth_token}`;
  }
  // garante ct0 do bootstrap
  if (/(?:^|;\s*)ct0=/.test(s)) {
    s = s.replace(/(^|;\s*)ct0=[^;]*/i, `$1ct0=${ct0}`);
  } else {
    s = `${s}; ct0=${ct0}`;
  }
  return s;
}
