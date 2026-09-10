// Endereço público de uma landing.
//
// ⚠️ A landing NÃO é rota deste SPA: é servida pelo backend em `GET /p/{slug}`
// (casca HTML com as `og:*` preenchidas, ver `backend/app/routers/landing.py`).
// O remix montava `/${slug}` na raiz porque as landings da dn.ia moravam dentro
// do próprio SPA — aqui esse endereço cai no 404 do admin. Todo link para uma
// landing sai desta função, para não haver um sexto lugar montando à mão.
//
// Em desenvolvimento o Vite repassa `/p/` ao backend (`vite.config.ts`); em
// produção quem roteia é o nginx. A URL limpa do anúncio, sem o `/p/`, depende
// do host de produção, que ainda não foi decidido.

function slugLimpo(slug: string): string {
  return slug.replace(/^\/+/, '');
}

export function caminhoDaLanding(slug: string): string {
  return `/p/${slugLimpo(slug)}`;
}

export function urlDaLanding(slug: string): string {
  return `${window.location.origin}${caminhoDaLanding(slug)}`;
}
