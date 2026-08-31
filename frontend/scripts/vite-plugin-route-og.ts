// Plugin Vite que pré-renderiza HTMLs por rota com Open Graph próprio.
// Após o build, lê dist/index.html e, para cada rota em OG_ROUTES, emite
// dist/<slug>.html e dist/<slug>/index.html com as meta tags substituídas.
// Crawlers (WhatsApp, LinkedIn, Facebook) recebem o HTML pronto, sem hidratação.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Plugin } from "vite";
import { OG_ROUTES, SITE_ORIGIN, type OgRoute } from "./og-routes";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function upsertMetaByAttr(
  html: string,
  attr: "name" | "property",
  key: string,
  content: string,
): string {
  const safe = escapeHtml(content);
  const tag = `<meta ${attr}="${key}" content="${safe}">`;
  const re = new RegExp(
    `<meta\\s+${attr}=["']${key}["'][^>]*>`,
    "i",
  );
  if (re.test(html)) return html.replace(re, tag);
  // Inserir antes de </head>
  return html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
}

function upsertTitle(html: string, title: string): string {
  const safe = escapeHtml(title);
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safe}</title>`);
  }
  return html.replace(/<\/head>/i, `    <title>${safe}</title>\n  </head>`);
}

function upsertCanonical(html: string, href: string): string {
  const safe = escapeHtml(href);
  const tag = `<link rel="canonical" href="${safe}">`;
  if (/<link\s+rel=["']canonical["'][^>]*>/i.test(html)) {
    return html.replace(/<link\s+rel=["']canonical["'][^>]*>/i, tag);
  }
  return html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
}

function renderHtmlForRoute(baseHtml: string, route: OgRoute): string {
  const absoluteImage = route.image.startsWith("http")
    ? route.image
    : `${SITE_ORIGIN}${route.image}`;
  const absoluteUrl = `${SITE_ORIGIN}${route.path}`;

  let html = baseHtml;
  html = upsertTitle(html, route.title);
  html = upsertMetaByAttr(html, "name", "description", route.description);
  html = upsertCanonical(html, absoluteUrl);

  // Open Graph
  html = upsertMetaByAttr(html, "property", "og:title", route.title);
  html = upsertMetaByAttr(html, "property", "og:description", route.description);
  html = upsertMetaByAttr(html, "property", "og:url", absoluteUrl);
  html = upsertMetaByAttr(html, "property", "og:type", "website");
  html = upsertMetaByAttr(html, "property", "og:image", absoluteImage);
  if (route.imageWidth) {
    html = upsertMetaByAttr(html, "property", "og:image:width", String(route.imageWidth));
  }
  if (route.imageHeight) {
    html = upsertMetaByAttr(html, "property", "og:image:height", String(route.imageHeight));
  }
  if (route.imageAlt) {
    html = upsertMetaByAttr(html, "property", "og:image:alt", route.imageAlt);
  }

  // Twitter
  html = upsertMetaByAttr(html, "name", "twitter:card", "summary_large_image");
  html = upsertMetaByAttr(html, "name", "twitter:title", route.title);
  html = upsertMetaByAttr(html, "name", "twitter:description", route.description);
  html = upsertMetaByAttr(html, "name", "twitter:image", absoluteImage);

  return html;
}

function writeFileEnsureDir(filePath: string, contents: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

export default function routeOgPlugin(): Plugin {
  let outDir = "dist";

  return {
    name: "vite-plugin-route-og",
    apply: "build",
    configResolved(cfg) {
      outDir = cfg.build.outDir || "dist";
    },
    closeBundle() {
      const indexPath = resolve(outDir, "index.html");
      if (!existsSync(indexPath)) {
        this.warn(`[route-og] ${indexPath} não encontrado; pulando.`);
        return;
      }
      const baseHtml = readFileSync(indexPath, "utf-8");

      for (const route of OG_ROUTES) {
        const slug = route.path.replace(/^\//, "");
        if (!slug) continue;
        const html = renderHtmlForRoute(baseHtml, route);

        // Emite os dois caminhos para máxima compatibilidade com o hosting.
        const flatPath = resolve(outDir, `${slug}.html`);
        const dirPath = resolve(outDir, slug, "index.html");
        writeFileEnsureDir(flatPath, html);
        writeFileEnsureDir(dirPath, html);
        // eslint-disable-next-line no-console
        console.log(`[route-og] emitido ${slug}.html (+ ${slug}/index.html)`);
      }
    },
  };
}
