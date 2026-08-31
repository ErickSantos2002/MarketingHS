import { EMAIL_MERGE_TAGS } from '@/components/admin/campaigns/emailEditorConfig';

// Substitui as merge tags do template pelos valores de exemplo declarados em
// EMAIL_MERGE_TAGS (fonte unica das tags -- ver o comentario no topo de
// emailEditorConfig.ts: nao duplicar a lista aqui). Usado na visualizacao de
// templates (/templates/:id/preview) para o admin ver o email como o contato
// vai ver, em vez de um "Ola, {{nome}}!" cru.
//
// No envio real quem substitui as tags e o worker process-email-queue, por
// destinatario -- esta funcao NAO participa de nenhum envio.

// `{{...}}` nao contem caracteres especiais de regex alem das chaves (que so
// sao especiais dentro de um quantificador), mas escapamos assim mesmo: a lista
// de tags pode crescer e um valor com `.` ou `?` viraria um match errado silencioso.
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function applySampleMergeTags(html: string): string {
  let out = html;
  for (const tag of Object.values(EMAIL_MERGE_TAGS)) {
    out = out.replace(new RegExp(escapeRegExp(tag.value), 'g'), tag.sample);
  }
  return out;
}
