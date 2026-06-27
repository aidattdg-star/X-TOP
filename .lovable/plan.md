## Visão geral
Nova área **Mídias** com pastas por categoria, e edição completa de perfil das contas (foto, banner, nome, bio, @) — individual ou em lote.

## Banco

**`media_folders`** — pastas customizáveis por usuário
- `category` (`profile_picture` | `tweet_media` | outras futuras)
- `name`, `user_id`, timestamps
- 2 pastas seedadas automaticamente no primeiro acesso ("Fotos de perfil", "Mídias para tweets")

**`media_files`** — referência aos arquivos no Storage
- `folder_id`, `user_id`, `storage_path`, `mime_type`, `size_bytes`, `width`, `height`, `original_filename`

**Storage**: bucket privado `media` com RLS por `user_id` no path (`{userId}/{folderId}/{uuid}.ext`).

**`profile_update_log`** — auditoria
- `twitter_account_id`, `field` (avatar/banner/name/bio/username), `old_value`, `new_value`, `status` (ok/failed), `error`, `created_at`

## Twitter client — novas funções
`src/lib/twitter-client.server.ts`:
- `updateProfileImage(tokens, imageBuffer, dispatcher)` → POST `/1.1/account/update_profile_image.json` (multipart, base64)
- `updateProfileBanner(tokens, imageBuffer, dispatcher)` → POST `/1.1/account/update_profile_banner.json`
- `updateProfile(tokens, { name?, description?, location?, url? }, dispatcher)` → POST `/1.1/account/update_profile.json`
- `updateUsername(tokens, newUsername, dispatcher)` → POST `/1.1/account/settings.json` com `screen_name`

Todas usam os mesmos cookies (ct0, auth_token) + headers do Bearer público que já temos.

## Server functions (`src/lib/media.functions.ts` + `src/lib/account-profile.functions.ts`)

**Mídias:**
- `listMediaFolders()`, `createMediaFolder({ name, category })`, `deleteMediaFolder({ id })`
- `listMediaFiles({ folderId })`
- `uploadMediaFile({ folderId, base64, filename, mimeType })` — valida tamanho/tipo, salva no Storage, cria row
- `deleteMediaFile({ id })`

**Perfis:**
- `applyAvatarToAccounts({ accountIds, mediaFileId?, folderId?, mode: 'same'|'random' })`
- `applyBannerToAccounts({ accountIds, mediaFileId?, folderId?, mode })`
- `updateAccountProfile({ accountId, name?, bio? })` (lote via map no client ou wrapper `updateAccountsProfile`)
- `updateAccountUsername({ accountId, newUsername })` — só individual, com confirmação extra na UI

Cada execução loga em `profile_update_log` e, em sucesso, atualiza `twitter_accounts.display_name` / `profile_picture_url`.

## UI

**Nova rota `/media`** (em `_authenticated`):
- Sidebar com pastas (criar/deletar) agrupadas por categoria
- Grid de thumbnails da pasta selecionada
- Drag-and-drop / botão de upload (múltiplos arquivos)
- Validação client: máx 2MB para avatar, 5MB para banner, 15MB tweet media

**`/accounts` — extensões:**
- Card de cada conta ganha botões: "Trocar foto", "Trocar banner", "Editar perfil"
- Botão "Editar @username" (com modal de confirmação avisando do risco)
- Barra de ações em lote no topo: checkbox por card → "Aplicar foto", "Aplicar banner", "Editar perfil em lote"
- Modal de aplicar foto: seleciona pasta → toggle "mesma foto" vs "1 aleatória por conta" → escolhe arquivo (se mesma) → mostra preview e lista de contas afetadas → confirma

## Limites e segurança
- Upload roda dentro de server fn autenticada (`requireSupabaseAuth`); base64 no body do RPC; rejeita > 8MB no servidor.
- Avatar redimensionado server-side se >2MB (usando `sharp`? — não, sharp não roda no Worker). Solução: redimensionar no client com Canvas antes do upload.
- @ rename: 1 tentativa por dia por conta (controle em `profile_update_log`), bloqueio na UI se já trocou hoje.

## Não muda
- Cookies/auth do X continuam vindo de `twitter_accounts.auth_tokens`.
- Sem novo cron, sem novo secret.
