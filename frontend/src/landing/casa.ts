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
  // Os mesmos do site oficial, na mesma ordem (healthsafety.com.br, pedido
  // do Nicholson em 27/10). `numero` é o que vai no `tel:`; `rotulo`, o que
  // se lê. O 4007 é número de capitais: sem DDD e sem +55 (com +55 a ligação
  // não completa), e com o asterisco que remete à `notaDoTelefone`.
  telefones: [
    { rotulo: "4007-1507", numero: "40071507", asterisco: true, detalhe: "Capitais e regiões metropolitanas" },
    { rotulo: "(81) 98177-1177", numero: "+5581981771177", asterisco: false, detalhe: "" },
  ],
  // O texto do site oficial, palavra por palavra.
  notaDoTelefone:
    "Caso a localidade não possua o serviço 4000 ou 4007 é necessário informar o número da " +
    "operadora mais o DDD 11: (0 xx 11 4007 1507).",
  instagram: { rotulo: "@healthsafety.oficial", url: "https://www.instagram.com/healthsafety.oficial/" },
  site: { rotulo: "healthsafety.com.br", url: "https://www.healthsafety.com.br" },
} as const;
