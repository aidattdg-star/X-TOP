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
