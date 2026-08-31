export interface PricingLot {
  price: number;
  label: string;
  endDate?: string; // ISO date string
}

export const PRICING_CONFIG = {
  lote1: {
    price: 47,
    label: "LOTE 1",
    endDate: "2026-01-20T23:59:59-03:00", // Altere esta data para controlar a transição
  } as PricingLot,
  lote2: {
    price: 97,
    label: "LOTE 2",
  } as PricingLot,
};

export function getActiveLot(): PricingLot {
  const now = new Date();
  const lote1EndDate = PRICING_CONFIG.lote1.endDate 
    ? new Date(PRICING_CONFIG.lote1.endDate) 
    : null;

  if (lote1EndDate && now <= lote1EndDate) {
    return PRICING_CONFIG.lote1;
  }
  
  return PRICING_CONFIG.lote2;
}

export function formatPrice(price: number): string {
  return `R$ ${price},00`;
}
