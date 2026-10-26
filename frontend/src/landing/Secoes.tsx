import type { CSSProperties, MouseEvent } from "react";
import type { Secao } from "./secoes";

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

function Numeros({ secao }: { secao: DaSecao<"numeros"> }) {
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

function Cartoes({ secao }: { secao: DaSecao<"cartoes"> }) {
  return (
    <ul className="cartoes" style={colunas(secao.itens.length, 3)}>
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
        {secao.blocos.map((bloco, i) => bloco.tipo === "p"
          ? <p key={i}>{bloco.texto}</p>
          : <ul key={i}>{bloco.itens.map((item, j) => <li key={j}>{item}</li>)}</ul>)}
      </div>
      {secao.imagem && (
        <img className="texto-imagem-foto" src={secao.imagem} alt={secao.titulo} loading="lazy" />
      )}
    </div>
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
            ? <img src={item.imagem} alt={item.nome} loading="lazy" />
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
      <Cabeca secao={secao} idTitulo={idTitulo} />
      {secao.texto && <p className="chamada-texto">{secao.texto}</p>}
      {secao.itens.length > 0 && (
        <ul className="chamada-itens">
          {secao.itens.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )}
      <a className="chamada-botao" href="#formulario" onClick={irParaFormulario}>{secao.botao}</a>
      {secao.nota && <p className="chamada-nota">{secao.nota}</p>}
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
        // `texto_imagem` e `chamada` põem o cabeçalho dentro do próprio leiaute.
        const cabecaPropria = secao.tipo === "texto_imagem" || secao.tipo === "chamada";
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
