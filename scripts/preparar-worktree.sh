#!/usr/bin/env bash
# Prepara uma worktree de frente paralela (ver docs/frentes/README.md).
# Rodar uma vez, de dentro da worktree: bash scripts/preparar-worktree.sh
#
# node_modules e .venv viram link para os da checkout principal — instalar de
# novo em cada frente custa minutos e disco à toa. ⚠️ Se a frente precisar
# mudar package.json ou requirements, ela não é dona disso: anota no arquivo
# da frente e a coordenadora instala na principal.
set -euo pipefail

aqui="$(git rev-parse --show-toplevel)"
principal="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
if [[ "$aqui" == "$principal" ]]; then
  echo "Esta é a checkout principal, não uma worktree. Nada a fazer." >&2
  exit 1
fi

ligar() {
  local rel="$1"
  if [[ -e "$aqui/$rel" && ! -L "$aqui/$rel" ]]; then
    echo "  $rel já existe (não é link) — deixado como está"
  else
    ln -sfn "$principal/$rel" "$aqui/$rel"
    echo "  $rel -> $principal/$rel"
  fi
}
ligar frontend/node_modules
ligar backend/.venv

# O .worktreeinclude já copia o .env quando a worktree nasce pelo Claude Code;
# isto cobre a worktree criada à mão. cp, nunca cat: credencial não passa por
# saída de terminal.
if [[ ! -f "$aqui/backend/.env" ]]; then
  cp "$principal/backend/.env" "$aqui/backend/.env"
  echo "  backend/.env copiado"
fi

nome="$(basename "$aqui")"
n="$(awk -F'|' -v f="$nome" '$2 ~ "`"f"`" {gsub(/ /,"",$3); print $3}' "$aqui/docs/frentes/README.md" | head -1)"
if [[ -n "$n" ]]; then
  echo
  echo "Frente $nome (n=$n):"
  echo "  Vite:    cd frontend && npx vite --port $((8080 + n))"
  echo "  Backend: cd backend && ./.venv/bin/python -m uvicorn app.main:app --port $((8100 + n))"
  echo "           (só a frente de backend; o Vite dela sobe com MKT_BACKEND_PORT=$((8100 + n)))"
else
  echo "Frente $nome não está na tabela de docs/frentes/README.md — confira o nome." >&2
fi
