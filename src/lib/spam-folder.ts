// Pasta "SPAM" = contas que NÃO devem aparecer em nenhum seletor do SaaS.
// (o usuário joga contas que não quer usar nessa pasta). Match por nome.

export function isSpamFolderName(name?: string | null): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return n === "spam" || /(^|[^a-z])spam([^a-z]|$)/i.test(n);
}

export function spamFolderIdSet(folders?: { id: string; name: string }[] | null): Set<string> {
  return new Set((folders ?? []).filter((f) => isSpamFolderName(f.name)).map((f) => f.id));
}

/** true se a conta está numa pasta "spam" (deve ser escondida dos seletores). */
export function isSpamAccount(folderId: string | null | undefined, spamIds: Set<string>): boolean {
  return !!folderId && spamIds.has(folderId);
}
