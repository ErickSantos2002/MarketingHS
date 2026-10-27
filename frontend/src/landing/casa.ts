// A casa: o que toda landing mostra no rodapé (frente landing-confianca,
// 27/10/2026). Fixo no código, não na config — toda landing é da Health &
// Safety, e endereço e telefone não mudam de página para página. Mudou o
// endereço, um telefone ou o Instagram? É aqui, e só aqui.
//
// ⚠️ Só sintaxe apagável (o teste node importa este arquivo direto).
//
// O logo NÃO mora aqui: é ativo do bundle (`./marca/`), importado no
// `Landing.tsx`. Os dois PNG de lá são derivados dos arquivos da marca
// (`~/projetos/landing-phoebus/imagens/logo-hs-cor.png` e
// `logo-hs-branco.png`, fora do repositório):
//   - `logo-hs-horizontal-branco.png`: o horizontal em branco, 72 px de
//     altura (o dobro do que aparece no cabeçalho). O "&" do original é
//     branco sobre o azul — recolorir tudo para branco o apagaria, então
//     ele foi VAZADO (fica a cor do fundo), como no logo empilhado oficial.
//   - `logo-hs-empilhado-branco.png`: o empilhado oficial, sem a margem
//     transparente, 120 px de altura.
// Os dois só têm alfa (branco + transparência em 16 níveis) e pesam menos de
// 4 KB: o Vite os embute no `main.js` como data URI, sem arquivo a mais em
// `dist-landing/` (cujos nomes são fixos, ver `vite.landing.config.ts`).

export const CASA = {
  nome: "Health & Safety",
  endereco: { rua: "Rua Viscondessa do Livramento, 54", cidade: "Recife - PE" },
  // `numero` é o que vai no `tel:` (com o +55); `rotulo`, o que se lê.
  telefones: [
    { rotulo: "(81) 3052-3350", numero: "+558130523350" },
    { rotulo: "(11) 3042-6479", numero: "+551130426479" },
  ],
  instagram: { rotulo: "@healthsafety.oficial", url: "https://www.instagram.com/healthsafety.oficial/" },
  site: { rotulo: "healthsafety.com.br", url: "https://www.healthsafety.com.br" },
} as const;
