// Helper unico de identificacao do chamador, usado pelas Edge Functions que
// precisam distinguir:
//   - internal: server-to-server (WEBHOOK_SECRET ou chave da tabela api_keys)
//   - admin:    JWT de usuario logado com role 'admin' em user_roles
//   - user:     JWT de usuario logado sem role admin
//   - public:   chave publicavel/anon do projeto (chamadas das landing pages)
//   - none:     sem Authorization valido -> deve ser rejeitado
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth } from './auth.ts';

export type CallerKind = 'internal' | 'admin' | 'user' | 'public' | 'none';

export interface Caller {
  kind: CallerKind;
  userId?: string;
}

export const PRIVILEGED: CallerKind[] = ['internal', 'admin'];

export function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function publicKeys(): string[] {
  return [
    Deno.env.get('SUPABASE_ANON_KEY'),
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY'),
  ].filter((v): v is string => !!v);
}

function decodeRole(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json);
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

export async function identifyCaller(req: Request, sb?: any): Promise<Caller> {
  const raw = req.headers.get('Authorization') || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
  if (!token) return { kind: 'none' };

  const admin = sb || serviceClient();

  // 1. Server-to-server (WEBHOOK_SECRET / api_keys)
  try {
    if (await validateAuth(req, admin, 'write')) return { kind: 'internal' };
  } catch (_err) {
    // segue para os outros caminhos
  }

  // 2. Chave publicavel/anon do projeto (landing pages anonimas)
  if (publicKeys().includes(token)) return { kind: 'public' };
  if (token.startsWith('sb_publishable_')) return { kind: 'public' };
  // JWT com role 'anon' = chave publicavel do projeto (landing pages). A chave anon
  // e publica por definicao, entao aceitar esse token apenas concede o nivel MENOS
  // privilegiado ('public'); nada sensivel depende dele.
  if (decodeRole(token) === 'anon') return { kind: 'public' };

  // 3. JWT de usuario
  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: claims } = await userClient.auth.getClaims(token);
    const role = claims?.claims?.role as string | undefined;
    const userId = claims?.claims?.sub as string | undefined;
    // JWT anon assinado pelo projeto = chamada publica das landing pages.
    if (role === 'anon') return { kind: 'public' };
    if (!userId) return { kind: 'none' };

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();

    return { kind: roleRow ? 'admin' : 'user', userId };
  } catch (err) {
    console.error('identifyCaller: erro ao validar JWT', err);
    return { kind: 'none' };
  }
}

export async function isPrivileged(req: Request, sb?: any): Promise<boolean> {
  const caller = await identifyCaller(req, sb);
  return PRIVILEGED.includes(caller.kind);
}

export function forbidden(corsHeaders: Record<string, string>, status = 403) {
  return new Response(
    JSON.stringify({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

/** Garante que o chamador e admin (JWT com role admin) ou server-to-server. */
export async function requireAdmin(
  req: Request,
  corsHeaders: Record<string, string>,
  sb?: any,
): Promise<Response | null> {
  const caller = await identifyCaller(req, sb);
  if (PRIVILEGED.includes(caller.kind)) return null;
  return forbidden(corsHeaders, caller.kind === 'none' ? 401 : 403);
}
