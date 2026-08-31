// Resolução de segredos de integração: Vault do Postgres primeiro (RPC
// get_integration_secret, migration 20260714160000_resend_config.sql),
// com fallback para Deno.env.get quando o Vault não tiver o valor (ainda
// não migrado pela UI) OU a chamada falhar por qualquer motivo (rede, RPC
// ausente, permissão, timeout) -- NUNCA lança.
//
// Usada por process-email-queue, email-unsubscribe e resend-webhook para
// ler RESEND_API_KEY / UNSUBSCRIBE_SECRET / RESEND_WEBHOOK_SECRET. É
// CRÍTICO que todos os consumidores usem esta mesma função (mesma ordem de
// resolução): o token de descadastro é assinado em process-email-queue e
// verificado em email-unsubscribe -- se as duas pontas lessem o
// UNSUBSCRIBE_SECRET de fontes diferentes (uma do Vault, outra do env),
// todo descadastro passaria a dar 401. Mesma lógica para
// RESEND_WEBHOOK_SECRET: se a leitura falhar sem cair no env, a
// verificação de assinatura Svix falha e TODOS os eventos do Resend são
// rejeitados em silêncio (401).
export async function getIntegrationSecret(sb: any, name: string): Promise<string | null> {
  try {
    const { data, error: rpcErr } = await sb.rpc('get_integration_secret', { p_name: name })
    if (!rpcErr && typeof data === 'string' && data.length > 0) return data
    if (rpcErr) console.error(`getIntegrationSecret: RPC error for ${name}:`, rpcErr)
  } catch (err) {
    // Defesa em profundidade: qualquer exceção (rede, client mal configurado)
    // nunca pode propagar -- cai no env exatamente como um erro "normal" do RPC.
    console.error(`getIntegrationSecret: exceção inesperada para ${name}:`, err)
  }

  const envValue = Deno.env.get(name)
  return envValue && envValue.length > 0 ? envValue : null
}
