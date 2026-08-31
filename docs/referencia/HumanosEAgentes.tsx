import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { DiagnosticoModalHumanos } from "@/components/landing/humanoseagentes/DiagnosticoModalHumanos";
import { HaNavbar } from "@/components/landing/humanoseagentes/HaNavbar";
import { HaHero } from "@/components/landing/humanoseagentes/HaHero";
import { HaLogos } from "@/components/landing/humanoseagentes/HaLogos";
import { HaOrganograma } from "@/components/landing/humanoseagentes/HaOrganograma";
import { HaOQueFazemos } from "@/components/landing/humanoseagentes/HaOQueFazemos";
import { HaCases } from "@/components/landing/humanoseagentes/HaCases";
import { HaTransicao } from "@/components/landing/humanoseagentes/HaTransicao";


import { HaFundadores } from "@/components/landing/humanoseagentes/HaFundadores";
import { HaCtaFinal } from "@/components/landing/humanoseagentes/HaCtaFinal";
import { HaFooter } from "@/components/landing/humanoseagentes/HaFooter";
import { useReveal } from "@/components/landing/humanoseagentes/useReveal";
import { useClarity } from "@/hooks/useClarity";
import "@/components/landing/humanoseagentes/humanoseagentes.css";

const PAGE_URL = "https://dnmkt.dnia.ai/humanoseagentes";
const PAGE_TITLE = "Humanos e Agentes | dn.ia — IA que trabalha na sua empresa";
const PAGE_DESCRIPTION =
  "Sua empresa usa IA, mas IA ainda não trabalha na sua empresa. Conheça o dn.os: agentes de IA integrados à sua operação, enquanto você foca no que só você pode decidir.";
const OG_IMAGE = "https://dnmkt.dnia.ai/og/humanoseagentes.png";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://dnia.ai/#organization",
      name: "dn.ia",
      url: "https://dnia.ai",
      logo: "https://dnmkt.dnia.ai/favicon.png",
      sameAs: [
        "https://www.instagram.com/dnia.ai",
        "https://www.linkedin.com/company/dnia-ai",
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://dnmkt.dnia.ai/#website",
      url: "https://dnmkt.dnia.ai",
      name: "dn.ia",
      inLanguage: "pt-BR",
      publisher: { "@id": "https://dnia.ai/#organization" },
    },
    {
      "@type": "WebPage",
      "@id": `${PAGE_URL}#webpage`,
      url: PAGE_URL,
      name: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
      inLanguage: "pt-BR",
      isPartOf: { "@id": "https://dnmkt.dnia.ai/#website" },
      about: { "@id": `${PAGE_URL}#service` },
    },
    {
      "@type": "Service",
      "@id": `${PAGE_URL}#service`,
      name: "dn.os — sistema operacional de IA para empresas",
      serviceType: "Implementação de agentes de IA",
      description:
        "Implementação de agentes de IA integrados à operação da empresa, com acompanhamento estratégico para que humanos foquem em decisão e crescimento.",
      provider: { "@id": "https://dnia.ai/#organization" },
      areaServed: { "@type": "Country", name: "Brasil" },
      audience: { "@type": "BusinessAudience", audienceType: "Empresários e líderes" },
      url: PAGE_URL,
    },
  ],
};

const HumanosEAgentes = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  useClarity("humanoseagentes");
  useReveal();

  const openModal = () => setIsModalOpen(true);

  return (
    <div className="ha-root min-h-screen">
      <Helmet>
        <html lang="pt-BR" />
        <title>{PAGE_TITLE}</title>
        <meta name="description" content={PAGE_DESCRIPTION} />
        <link rel="canonical" href={PAGE_URL} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={PAGE_TITLE} />
        <meta property="og:description" content={PAGE_DESCRIPTION} />
        <meta property="og:url" content={PAGE_URL} />
        <meta property="og:image" content={OG_IMAGE} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={PAGE_TITLE} />
        <meta name="twitter:description" content={PAGE_DESCRIPTION} />
        <meta name="twitter:image" content={OG_IMAGE} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <HaNavbar onOpenModal={openModal} />

      <main>
        <HaHero onOpenModal={openModal} />
        <HaLogos />
        <HaTransicao />
        <HaOQueFazemos />
        <HaOrganograma onOpenModal={openModal} />
        <HaCases onOpenModal={openModal} />
        
        <HaFundadores />
        <HaCtaFinal onOpenModal={openModal} />
      </main>

      <HaFooter />

      <DiagnosticoModalHumanos isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      {/* Preload Nexus iframe to warm cache */}
      <iframe
        src="https://nexus.dnia.ai/schedule/9cdd014b-a8ab-46ab-bbfb-0fb1e154e540?tag=humanoseagentes&source=humanoseagentes"
        aria-hidden="true"
        tabIndex={-1}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
          border: 0,
          left: -9999,
          top: -9999,
        }}
        loading="eager"
        title="preload"
      />
    </div>
  );
};

export default HumanosEAgentes;
