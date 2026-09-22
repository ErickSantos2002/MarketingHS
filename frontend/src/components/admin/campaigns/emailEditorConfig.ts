import { subirImagemDeEmail } from '@/lib/config';
import { ErroApi } from '@/lib/api';
import { toast } from 'sonner';
import { socialIconsFor, type SocialLinksConfig } from '@/lib/socialLinks';

// Configuração do Unlayer (react-email-editor) COMPARTILHADA entre o
// CampaignWizard (email de campanha) e o TemplateEditor (biblioteca de
// templates) — Fase 4 do plano de email marketing. Não duplicar estes
// valores nos dois componentes; qualquer ajuste de merge tag, tema ou
// upload de imagem deve ser feito aqui, uma única vez.

export const EMAIL_MERGE_TAGS = {
  nome: { name: 'Nome do contato', value: '{{nome}}', sample: 'João Silva' },
  empresa: { name: 'Empresa', value: '{{empresa}}', sample: 'Empresa LTDA' },
  email: { name: 'Email', value: '{{email}}', sample: 'joao@empresa.com' },
  // Substituída pelo worker (backend/app/worker.py) no momento do envio, por
  // destinatário — ver app/email/montagem.py. Se o HTML final não contiver a
  // tag/o link, o worker injeta um rodapé automático de descadastro; mas
  // templates podem (e devem) incluir esta tag explicitamente para
  // controlar posição e estilo do link de descadastro.
  unsubscribe_url: {
    name: 'Link de descadastro',
    value: '{{unsubscribe_url}}',
    sample: 'https://exemplo.com/descadastrar?lid=...&e=...&t=...',
  },
};

export const BASE_EMAIL_DESIGN = {
  body: {
    rows: [
      // Cabeçalho em TEXTO, não imagem. O src anterior apontava para
      // ai-fastlane.lovable.app/lovable-uploads/logo-placeholder.png — host
      // antigo, arquivo que nunca existiu -> todo e-mail saía com um ícone de
      // imagem quebrada no topo. Texto continua sendo a escolha certa: a
      // maioria dos clientes de e-mail bloqueia imagens por padrão — um
      // cabeçalho em texto aparece sempre, mesmo com imagem bloqueada. Para
      // usar o logo da casa: subir a imagem pelo próprio editor (o Unlayer
      // hospeda) e trocar este bloco.
      {
        cells: [1],
        columns: [{
          contents: [{
            type: 'text',
            values: {
              text: '<p style="font-size:24px;font-weight:bold;color:#534AB7;text-align:center;margin:0;">Health &amp; Safety</p>',
            },
          }],
        }],
      },
      {
        cells: [1],
        columns: [{
          contents: [{
            type: 'text',
            values: {
              text: '<p>Olá, {{nome}}!</p><p>Escreva sua mensagem aqui.</p>',
              fontSize: '16px',
            },
          }],
        }],
      },
      {
        cells: [1],
        columns: [{
          contents: [{
            type: 'button',
            values: {
              // href OBRIGATORIO: sem ele o botao nao aponta para nada -- CTA
              // quebrado numa campanha real, e nenhum link rastreavel para o
              // tracking de clique do Resend reescrever. https://healthsafety.com.br
              // e so um destino padrao; o admin troca por campanha no editor.
              href: {
                name: 'web',
                values: { href: 'https://healthsafety.com.br', target: '_blank' },
              },
              text: 'Ver mais',
              backgroundColor: '#534AB7',
              color: '#FFFFFF',
              borderRadius: '8px',
              textAlign: 'center',
            },
          }],
        }],
      },
      {
        cells: [1],
        columns: [{
          contents: [{
            type: 'text',
            values: {
              text: '<p style="font-size:12px;color:#888;">Health &amp; Safety — Você está recebendo este e-mail porque se cadastrou em um de nossos canais.</p>',
            },
          }],
        }],
      },
    ],
  },
};

// VITE_UNLAYER_PROJECT_ID (Unlayer → Builder → Settings → General → Project ID)
// é lida aqui e enviada em `options.projectId`. Projeto atual: `dnmkt`, id
// 288591, sem restrição de Allowed Domains — o mesmo id vale para localhost e
// produção.
//
// VERIFICADO no navegador (POST api.unlayer.com/v2/editor/auth + /editor/session
// retornam 200 com projectId 288591): a chave ESTÁ sendo lida e o editor NÃO
// roda mais em modo anônimo. O que ainda não aparece é limitação de PLANO, não
// de configuração — o token de sessão devolve as entitlements do plano Free com:
//   locale: false            -> interface continua em inglês
//   mobileDesignMode: false  -> seletor de dispositivo de EDIÇÃO só mostra desktop
//   undoRedo / imageEditor / stockImages / saveBlock / sendTestEmail: false
// Ou seja, traduzir a UI e editar layout mobile exigem upgrade do plano Unlayer;
// nenhuma opção no código libera isso. O PREVIEW (ícone de olho) segue com
// desktop/tablet/mobile em qualquer plano.

const UNLAYER_PROJECT_ID = Number(import.meta.env.VITE_UNLAYER_PROJECT_ID) || undefined;

export const EMAIL_EDITOR_OPTIONS = {
  ...(UNLAYER_PROJECT_ID ? { projectId: UNLAYER_PROJECT_ID } : {}),
  locale: 'pt-BR',
  fonts: { showDefaultFonts: true },
  features: {
    // `tables: true` liga os controles de tabela (inserir grade, Cell/Row/Column,
    // merge de celulas, Table properties) na barra do editor de texto rico. E a
    // unica forma de montar uma tabela aqui: o bloco "Table" nativo do Unlayer e
    // recurso de plano pago e nao aparece na palette em modo anonimo (ver o
    // comentario de UNLAYER_PROJECT_ID abaixo).
    // ATENCAO: so vale para blocos do tipo `text` (a ferramenta legada). Blocos
    // criados pela ferramenta nova "Paragraph" NAO ganham o menu de tabela --
    // verificado no editor. BASE_EMAIL_DESIGN usa `type: 'text'`, entao todo
    // template criado a partir dele ja nasce com o recurso disponivel.
    textEditor: { spellChecker: true, tables: true },
  },
  tools: {
    image: { enabled: true },
    button: { enabled: true },
    divider: { enabled: true },
    social: { enabled: true },
  },
  appearance: {
    theme: 'dark',
    panels: {
      tools: { dock: 'right' },
    },
  },
  mergeTags: EMAIL_MERGE_TAGS,
} as any;

/**
 * Options do editor com o bloco "Social" ja pre-preenchido com as redes salvas
 * em /settings -> Redes sociais. O admin arrasta o bloco e os icones ja vem com
 * as URLs certas; ainda da para editar/remover por campanha.
 *
 * O Unlayer le `defaultValues` na INICIALIZACAO do editor -- montar o editor
 * antes da config chegar do banco perde o pre-preenchimento (o bloco nasce
 * vazio). Por isso os dois editores esperam `useSocialLinks().loading` virar
 * false antes de montar. Sem nenhuma rede configurada, devolve as options
 * padrao: nao adianta declarar um defaultValues com lista vazia.
 */
export function buildEmailEditorOptions(social: SocialLinksConfig | null) {
  const icons = social ? socialIconsFor(social) : [];
  if (!social || icons.length === 0) return EMAIL_EDITOR_OPTIONS;

  return {
    ...EMAIL_EDITOR_OPTIONS,
    tools: {
      ...EMAIL_EDITOR_OPTIONS.tools,
      social: {
        enabled: true,
        properties: {
          icons: { value: { iconType: social.iconType, icons } },
          spacing: { value: 8 },
          align: { value: 'center' },
        },
      },
    },
  } as any;
}

// Handler de upload de imagem do Unlayer.
//
// ⚠️ A imagem vai para o NOSSO backend (`POST /imagens`) e é servida por
// `/publico/imagem/{id}`, SEM autenticação — quem busca a imagem é o cliente de
// e-mail de quem recebeu, que não tem sessão aqui. Uma URL autenticada faria o
// e-mail chegar quebrado para todo mundo, e o defeito só apareceria na caixa de
// entrada dos outros.
//
// Antes isto subia para o storage do Supabase, bucket `email-assets`. Não há
// Supabase: todo upload de imagem no editor falhava, e a tela só dizia "Erro ao
// fazer upload da imagem".
//
// `folder` separa os assets de campanha dos de template, para organização.
export function registerEmailImageUpload(unlayer: any, folder: 'campaigns' | 'templates') {
  unlayer.registerCallback('image', async (file: any, done: any) => {
    try {
      const anexo = file.attachments[0];
      const { url } = await subirImagemDeEmail(anexo, folder);
      done({ progress: 100, url });
    } catch (e) {
      // A mensagem do servidor é a útil: diz se foi o tipo (SVG não entra, por
      // causa de script embutido) ou o tamanho.
      toast.error(e instanceof ErroApi ? e.message : 'Erro ao fazer upload da imagem');
      done({ progress: 0 });
    }
  });
}
