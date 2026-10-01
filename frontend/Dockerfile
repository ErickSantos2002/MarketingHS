# Front do admin: build do Vite servido pelo nginx, que também é o proxy para
# a API. Um domínio só — o front chama /api (VITE_API_URL fica sem definir e o
# código cai no padrão '/api'), e a landing pública (/p/<slug>, /landing/) é
# servida pelo backend, então o nginx repassa esses prefixos também.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Template, não conf pronto: a imagem do nginx passa o arquivo pelo envsubst
# ao subir. No EasyPanel o backend é `<projeto>_<serviço>:8000`.
ENV BACKEND_UPSTREAM=backend:8000
# Nenhum proxy de confiança por padrão; no EasyPanel, a rede do Traefik
# (REAL_IP_FROM=10.0.0.0/8) — sem isso o limite de taxa por IP veria só o Traefik.
ENV REAL_IP_FROM=127.0.0.1/32
COPY nginx.conf /etc/nginx/templates/default.conf.template
