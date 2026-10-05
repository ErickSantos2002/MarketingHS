import { useAuth } from '@/hooks/useAuth';

interface Props {
  status: string | null;
  /** O contato já tem card no GrowthHS (`ecosystem.growthhs_card_id`). */
  jaNoGrowthHS?: boolean;
}

/**
 * Destaque do contato com status "Lead Qualificado".
 *
 * Desde o R5 (05/10/2026) o "Enviar ao comercial" vale para qualquer contato e
 * mora só no cabeçalho da ficha (LeadDetailSheet). Antes o botão existia aqui
 * também — com o do cabeçalho aberto a todos, os dois juntos virariam o mesmo
 * botão duas vezes na mesma tela. O banner ficou como destaque e aponta para
 * o botão.
 */
export function QualifiedBanner({ status, jaNoGrowthHS = false }: Props) {
  // O botão do cabeçalho é só de admin: a dica só faz sentido para quem o vê.
  const { isAdmin } = useAuth();
  if (status !== 'Lead Qualificado') return null;

  return (
    <div className="mx-6 mt-2 p-3 rounded-lg bg-[--tint-info] border border-info/30">
      <p className="text-sm text-[--on-tint-info] font-medium">
        {jaNoGrowthHS
          ? 'Este lead está pronto para o comercial e já está no GrowthHS'
          : isAdmin
          ? 'Este lead está pronto para o comercial — use "Enviar ao comercial" no topo da ficha'
          : 'Este lead está pronto para o comercial'}
      </p>
    </div>
  );
}
