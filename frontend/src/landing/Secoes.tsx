import { useRef, useState, type CSSProperties, type MouseEvent, type SyntheticEvent } from "react";
import type { BlocoDoCorpo } from "./campos";
import { miniaturaDoYoutube, playerDoYoutube, type Secao } from "./secoes";

// Colunas da grade no desktop: o maior divisor de `n` até `teto`, para não
// sobrar um cartão órfão na última linha (4 cartões viram 2×2, 8 logos 4×2).
// Sem divisor bom, o teto. No celular a grade é `auto-fit` (landing.css).
function colunas(n: number, teto: number): CSSProperties {
  let c = Math.min(n, teto);
  while (c > 2 && n % c !== 0) c--;
  if (n > teto && n % c !== 0) c = teto;
  return { "--colunas": c } as CSSProperties;
}

// As seções da landing, depois do topo (frente landing-secoes, 26/10).
//
// Recebem a lista já lida por `secoesDaConfig` — tipo conhecido, texto
// aparado, imagem só http(s). Mesmo assim, tudo aqui é texto puro: nunca
// `dangerouslySetInnerHTML`. A config é editada no admin, mas a página é
// pública, e HTML colado viraria script.

type DaSecao<T extends Secao["tipo"]> = Extract<Secao, { tipo: T }>;

// O primeiro campo de verdade do formulário do topo — nunca a isca
// (`.captura-isca`), que fica fora da tela e fora do Tab.
const PRIMEIRO_CAMPO = [
  "#formulario .captura-campo input",
  "#formulario .captura-campo select",
  "#formulario .captura-campo textarea",
  "#formulario .captura-grupo input",
].join(", ");

// O botão da chamada é uma âncora (`#formulario`): sem JS, ou se algo falhar
// aqui, o navegador ainda rola até o formulário. Com JS, rola suave e põe o
// foco no primeiro campo — a pessoa clicou para preencher.
function irParaFormulario(evento: MouseEvent<HTMLAnchorElement>) {
  const alvo = document.getElementById("formulario");
  if (!alvo) return;
  evento.preventDefault();
  const suave = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  alvo.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start" });
  document.querySelector<HTMLElement>(PRIMEIRO_CAMPO)?.focus({ preventScroll: true });
}

function Cabeca({ secao, idTitulo }: { secao: Secao; idTitulo: string }) {
  if (!secao.titulo && !secao.subtitulo) return null;
  return (
    <header className="secao-cabeca">
      {secao.titulo && <h2 id={idTitulo}>{secao.titulo}</h2>}
      {secao.subtitulo && <p className="secao-sub">{secao.subtitulo}</p>}
    </header>
  );
}

export function Numeros({ secao }: { secao: DaSecao<"numeros"> }) {
  return (
    <ul className="numeros">
      {secao.itens.map((item, i) => (
        <li key={i}>
          <strong className="numeros-valor">{item.valor}</strong>
          {item.rotulo && <span className="numeros-rotulo">{item.rotulo}</span>}
        </li>
      ))}
    </ul>
  );
}

// Uma tabela de verdade (leitor de tela anuncia linha e coluna). No celular o
// CSS empilha cada linha num cartão e o `data-rotulo` vira o nome da coluna
// ao lado do valor — sem rolagem horizontal da página.
function Comparativo({ secao }: { secao: DaSecao<"comparativo"> }) {
  const { a, b } = secao.colunas;
  return (
    <div className="comparativo">
      <table>
        <thead>
          <tr>
            <td aria-hidden="true" />
            <th scope="col">{a}</th>
            <th scope="col" className="comparativo-b">{b}</th>
          </tr>
        </thead>
        <tbody>
          {secao.linhas.map((linha, i) => (
            <tr key={i}>
              <th scope="row">{linha.criterio}</th>
              <td data-rotulo={a}>{linha.a || "—"}</td>
              <td data-rotulo={b} className="comparativo-b">{linha.b || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Passos({ secao }: { secao: DaSecao<"passos"> }) {
  return (
    <ol className="passos">
      {secao.itens.map((item, i) => (
        <li key={i}>
          <span className="passos-numero" aria-hidden="true">{i + 1}</span>
          <div>
            {item.titulo && <h3>{item.titulo}</h3>}
            {item.texto && <p>{item.texto}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// Com foto, a foto manda: até 4 por linha, sem caixa em volta. Sem foto, uma
// lista em grade com fio no topo de cada item (landing.css).
function Cartoes({ secao }: { secao: DaSecao<"cartoes"> }) {
  const comFoto = secao.itens.some((item) => item.imagem);
  return (
    <ul className={comFoto ? "cartoes cartoes-com-foto" : "cartoes"}
        style={colunas(secao.itens.length, comFoto ? 4 : 3)}>
      {secao.itens.map((item, i) => (
        <li key={i} className={item.imagem ? "cartao cartao-com-imagem" : "cartao"}>
          {/* Alt vazio: a imagem ilustra o título que vem logo abaixo. */}
          {item.imagem && <img src={item.imagem} alt="" loading="lazy" />}
          <div className="cartao-texto">
            {item.titulo && <h3>{item.titulo}</h3>}
            {item.texto && <p>{item.texto}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TextoImagem({ secao, idTitulo }: { secao: DaSecao<"texto_imagem">; idTitulo: string }) {
  return (
    <div className={["texto-imagem", secao.imagem && "texto-imagem-com-imagem",
                     secao.lado === "esquerda" && "texto-imagem-esquerda"].filter(Boolean).join(" ")}>
      <div className="texto-imagem-texto">
        <Cabeca secao={secao} idTitulo={idTitulo} />
        <Blocos blocos={secao.blocos} />
      </div>
      {secao.imagem && (
        <img className="texto-imagem-foto" src={secao.imagem} alt={secao.titulo} loading="lazy" />
      )}
    </div>
  );
}

// Logos têm proporções muito diferentes (CCR é quadrado, Mineração Caraíba é
// quatro vezes mais largo que alto). Mesma altura para todos faria o quadrado
// sumir; mesma largura faria o largo gritar. A altura sai da proporção
// (raiz quadrada, o ajuste de peso visual usual), entre 34 e 76 px.
function alturaDoLogo(largura: number, altura: number): number {
  if (!largura || !altura) return 44;
  const proporcao = largura / altura;
  return Math.round(Math.min(76, Math.max(34, 46 * Math.sqrt(2.6 / proporcao))));
}

function ImagemDeLogo({ src, nome, className }: { src: string; nome: string; className?: string }) {
  const [altura, setAltura] = useState<number | null>(null);
  const aoCarregar = (e: SyntheticEvent<HTMLImageElement>) =>
    setAltura(alturaDoLogo(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight));
  return (
    <img className={className} src={src} alt={nome} loading="lazy" onLoad={aoCarregar}
         style={altura ? ({ "--altura-logo": `${altura}px` } as CSSProperties) : undefined} />
  );
}

// Logo sem arquivo ainda aparece como o nome em texto, no mesmo ladrilho —
// a grade fica alinhada com ou sem imagem.
function Logos({ secao }: { secao: DaSecao<"logos"> }) {
  return (
    <ul className="logos" style={colunas(secao.itens.length, 6)}>
      {secao.itens.map((item, i) => (
        <li key={i}>
          {item.imagem
            ? <ImagemDeLogo src={item.imagem} nome={item.nome} />
            : <span>{item.nome}</span>}
        </li>
      ))}
    </ul>
  );
}

// `<details>`/`<summary>`: abre e fecha sem JS, e o leitor de tela já
// anuncia como expansível.
function Perguntas({ secao }: { secao: DaSecao<"perguntas"> }) {
  return (
    <div className="perguntas">
      {secao.itens.map((item, i) => (
        <details key={i}>
          <summary>{item.pergunta}</summary>
          <p>{item.resposta}</p>
        </details>
      ))}
    </div>
  );
}

function Chamada({ secao, idTitulo }: { secao: DaSecao<"chamada">; idTitulo: string }) {
  return (
    <div className="chamada">
      <div className="chamada-texto-bloco">
        <Cabeca secao={secao} idTitulo={idTitulo} />
        {secao.texto && <p className="chamada-texto">{secao.texto}</p>}
        {secao.itens.length > 0 && (
          <ul className="chamada-itens">
            {secao.itens.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        )}
      </div>
      <div className="chamada-acao">
        <a className="chamada-botao" href="#formulario" onClick={irParaFormulario}>{secao.botao}</a>
        {secao.nota && <p className="chamada-nota">{secao.nota}</p>}
      </div>
    </div>
  );
}

// Parágrafos e listas do texto de uma seção (a regra do `corpo`).
function Blocos({ blocos }: { blocos: BlocoDoCorpo[] }) {
  return (
    <>
      {blocos.map((bloco, i) => bloco.tipo === "p"
        ? <p key={i}>{bloco.texto}</p>
        : <ul key={i}>{bloco.itens.map((item, j) => <li key={j}>{item}</li>)}</ul>)}
    </>
  );
}

// Selos ao lado do texto (no celular, abaixo). O selo é a prova: grande,
// na cor original, com o nome embaixo — o mesmo nome é o alt, então o
// leitor de tela ouve "ISO 9001" uma vez só (legenda `aria-hidden`).
function Certificacoes({ secao, idTitulo }: { secao: DaSecao<"certificacoes">; idTitulo: string }) {
  return (
    <div className="certificacoes">
      <div className="certificacoes-texto">
        <Cabeca secao={secao} idTitulo={idTitulo} />
        <Blocos blocos={secao.blocos} />
      </div>
      <ul className="selos">
        {secao.itens.map((item, i) => (
          <li key={i}>
            <img src={item.imagem} alt={item.nome || "Selo de certificação"} loading="lazy" />
            {item.nome && <span aria-hidden="true">{item.nome}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// A primeira citação abre em corpo grande; as outras seguem em colunas,
// menores. Aspas tipográficas penduradas na margem (`.depoimento p`), sem
// caixa, sem ícone de pessoa: o que dá peso é o nome e a empresa.
function Depoimentos({ secao }: { secao: DaSecao<"depoimentos"> }) {
  return (
    <ul className="depoimentos" style={colunas(Math.max(secao.itens.length - 1, 1), 3)}>
      {secao.itens.map((item, i) => {
        const quem = [item.cargo, item.empresa].filter(Boolean).join(", ");
        return (
          <li key={i} className={i === 0 ? "depoimento depoimento-destaque" : "depoimento"}>
            <figure>
              <blockquote>
                <p>“{item.texto}”</p>
              </blockquote>
              {/* O logo vem depois do nome, pequeno, com alt vazio: a
                  empresa já está escrita (e, sem ela, o logo é enfeite). A
                  altura sai da proporção, como na seção de logos. */}
              <figcaption>
                <span className="depoimento-quem">
                  <strong>{item.nome}</strong>
                  {quem && <span>{quem}</span>}
                </span>
                {item.logo && <ImagemDeLogo className="depoimento-logo" src={item.logo} nome="" />}
              </figcaption>
            </figure>
          </li>
        );
      })}
    </ul>
  );
}

// Fachada do YouTube: até o clique, a página mostra só a miniatura (de
// i.ytimg.com) e um botão — nenhum script nem cookie do YouTube carrega
// antes de a pessoa pedir. O clique troca a fachada pelo player
// (youtube-nocookie, já tocando) e passa o foco para ele.
function Video({ secao, idTitulo }: { secao: DaSecao<"video">; idTitulo: string }) {
  const [tocando, setTocando] = useState(false);
  // `maxresdefault` não existe em todo vídeo — e quando falta, o YouTube
  // devolve 200 com um cinza de 120×90, não um erro. Os dois casos caem no
  // `hqdefault`, que todo vídeo tem.
  const [grande, setGrande] = useState(true);
  const player = useRef<HTMLIFrameElement>(null);
  const rotulo = secao.titulo ? `Assistir ao vídeo: ${secao.titulo}` : "Assistir ao vídeo";
  const temTexto = !!(secao.titulo || secao.subtitulo || secao.blocos.length);
  return (
    <div className={["video", temTexto && "video-com-texto", secao.vertical && "video-vertical"]
                    .filter(Boolean).join(" ")}>
      {temTexto && (
        <div className="video-texto">
          <Cabeca secao={secao} idTitulo={idTitulo} />
          <Blocos blocos={secao.blocos} />
        </div>
      )}
      <div className="video-quadro">
        {tocando ? (
          <iframe ref={player} src={playerDoYoutube(secao.video)} title={secao.titulo || "Vídeo"}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
                  onLoad={() => player.current?.focus()} />
        ) : (
          <button type="button" className="video-fachada" aria-label={rotulo} onClick={() => setTocando(true)}>
            <img src={miniaturaDoYoutube(secao.video, grande)} alt="" loading="lazy"
                 onLoad={(e) => { if (grande && e.currentTarget.naturalWidth <= 120) setGrande(false); }}
                 onError={() => grande && setGrande(false)} />
            <span className="video-play" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" focusable="false">
                <path fill="currentColor" d="M8 5.5v13l10.5-6.5z" />
              </svg>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function Corpo({ secao, idTitulo }: { secao: Secao; idTitulo: string }) {
  switch (secao.tipo) {
    case "numeros": return <Numeros secao={secao} />;
    case "comparativo": return <Comparativo secao={secao} />;
    case "passos": return <Passos secao={secao} />;
    case "cartoes": return <Cartoes secao={secao} />;
    case "texto_imagem": return <TextoImagem secao={secao} idTitulo={idTitulo} />;
    case "logos": return <Logos secao={secao} />;
    case "perguntas": return <Perguntas secao={secao} />;
    case "chamada": return <Chamada secao={secao} idTitulo={idTitulo} />;
    case "certificacoes": return <Certificacoes secao={secao} idTitulo={idTitulo} />;
    case "depoimentos": return <Depoimentos secao={secao} />;
    case "video": return <Video secao={secao} idTitulo={idTitulo} />;
  }
  return null;
}

export function Secoes({ secoes }: { secoes: Secao[] }) {
  return (
    <div className="landing-secoes">
      {secoes.map((secao, i) => {
        // Id do título pela posição, não pelo `id` da config: aquele é texto
        // livre e pode ter espaço, o que quebraria o `aria-labelledby`.
        const idTitulo = `secao-${i}-titulo`;
        // Estes põem o cabeçalho dentro do próprio leiaute (texto ao lado).
        const cabecaPropria = secao.tipo === "texto_imagem" || secao.tipo === "chamada"
          || secao.tipo === "certificacoes" || secao.tipo === "video";
        return (
          <section key={secao.id} className={`secao secao-${secao.tipo}`}
                   aria-labelledby={secao.titulo ? idTitulo : undefined}>
            <div className="secao-miolo">
              {!cabecaPropria && <Cabeca secao={secao} idTitulo={idTitulo} />}
              <Corpo secao={secao} idTitulo={idTitulo} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
