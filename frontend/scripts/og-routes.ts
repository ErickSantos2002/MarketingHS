// Configuração de rotas com Open Graph próprio.
// Usado pelo plugin Vite (vite-plugin-route-og) para emitir HTMLs pré-renderizados
// em dist/<slug>.html e dist/<slug>/index.html, e pelos componentes de página
// para sincronizar as mesmas tags via react-helmet-async.

export const SITE_ORIGIN = "https://dnmkt.dnia.ai";

export interface OgRoute {
  /** Path da rota, começando com "/". Ex: "/ianamesa170626" */
  path: string;
  title: string;
  description: string;
  /** Caminho absoluto da imagem servida em /public. Ex: "/og/ianamesa170626.png" */
  image: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
}

export const OG_ROUTES: OgRoute[] = [
  {
    path: "/ianamesa170626",
    title: "IA na Mesa de Decisão | Evento VIP em BH — 17/06/2026",
    description:
      "Encontro presencial em Belo Horizonte para empresários e líderes verem IA funcionando na prática: sistemas construídos ao vivo e estratégias reais de gestão com inteligência artificial. 17/06/2026, das 8h às 14h, com almoço incluso.",
    image: "/og/ianamesa170626.png",
    imageWidth: 1200,
    imageHeight: 630,
    imageAlt: "IA na Mesa de Decisão — Evento VIP presencial em Belo Horizonte, 17 de junho de 2026",
  },
  {
    path: "/cafecomia",
    title: "Café com IA | Encontro fechado em BH — 29/07/2026",
    description:
      "Manhã fechada para 40 empresários e líderes. Veja o organograma da dn.ia — humanos e agentes de IA operando ao vivo. 29/07/2026, 8h30 às 12h, Nova Suíça, BH. Café da manhã incluso.",
    image: "/__l5e/assets-v1/217421be-fb25-4ba0-aba8-841255ee1ee4/cafecomia-og-v2.jpg",
    imageWidth: 1200,
    imageHeight: 630,
    imageAlt: "Café com IA — encontro fechado em Belo Horizonte, 29 de julho de 2026",
  },
];

export function getOgRoute(path: string): OgRoute | undefined {
  return OG_ROUTES.find((r) => r.path === path);
}
