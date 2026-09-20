#!/usr/bin/env bash
#
# Reescreve o histórico para tirar o e-mail pessoal dos 33 commits.
#
# Por que existe: sair do código não tirou do ar. O endereço está na AUTORIA
# de todo commit — metadado, não arquivo — e é servido hoje pela API pública:
#   curl -s api.github.com/repos/com-quem-anda/com-quem-anda.github.io/commits
# Além disso aparece no CONTEÚDO de três commits antigos.
#
# O QUE ISTO NÃO FAZ, e você precisa saber antes de rodar:
#   - Não apaga do GitHub na hora. Commits antigos seguem acessíveis pelo SHA
#     direto até o GitHub coletar lixo. Para purgar de verdade, abra chamado
#     em support.github.com pedindo remoção das referências antigas.
#   - Não alcança forks nem clones que já existam.
#   - Muda TODOS os SHAs. Quem tiver clone precisa clonar de novo.
#
# Este script para antes do push. Empurrar é decisão sua, num comando à parte.

set -euo pipefail

NOVO_EMAIL="10932531+RikoDalge@users.noreply.github.com"
NOVO_NOME="RikoDalge"
ANTIGO_EMAIL="10932531+RikoDalge@users.noreply.github.com"
REMOTO="git@github.com:com-quem-anda/com-quem-anda.github.io.git"

cd "$(dirname "$0")/.."
RAIZ="$(pwd)"

echo "== 1. conferindo pré-condições =="

if ! command -v git-filter-repo >/dev/null 2>&1; then
  cat <<'FIM'
git-filter-repo não está instalado. Instale com um destes:
    brew install git-filter-repo
    pipx install git-filter-repo
Não use git filter-branch: é lento e erra em casos de borda que este
repositório tem (commits de merge e reescrita de mensagem).
FIM
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "árvore suja. Comite ou guarde antes — a reescrita mexe em tudo."
  git status --short
  exit 1
fi

echo "   ok: filter-repo presente, árvore limpa"
echo "   commits com o e-mail antigo na autoria: $(git log --all --format='%ae' | grep -c "$ANTIGO_EMAIL" || true)"
echo "   commits com o e-mail antigo no conteúdo: $(git log --all -S"$ANTIGO_EMAIL" --oneline | wc -l | tr -d ' ')"

echo
echo "== 2. backup =="
BACKUP="/tmp/cqa-backup-$(date +%Y%m%d-%H%M%S).bundle"
git bundle create "$BACKUP" --all
echo "   $BACKUP"
echo "   para desfazer tudo:  git clone $BACKUP repo-restaurado"

echo
echo "== 3. confirmação =="
echo "Isto reescreve os SHAs dos $(git rev-list --all --count) commits. Não tem desfazer sem o backup."
read -r -p "Digite REESCREVER para seguir: " resposta
[ "$resposta" = "REESCREVER" ] || { echo "abortado."; exit 1; }

echo
echo "== 4. reescrevendo autoria =="
cat > /tmp/cqa-mailmap <<FIM
$NOVO_NOME <$NOVO_EMAIL> <$ANTIGO_EMAIL>
FIM
git filter-repo --mailmap /tmp/cqa-mailmap --force

echo
echo "== 5. reescrevendo conteúdo =="
# literal: evita que o texto seja lido como regex.
cat > /tmp/cqa-replace <<FIM
literal:$ANTIGO_EMAIL==>$NOVO_EMAIL
FIM
git filter-repo --replace-text /tmp/cqa-replace --force

rm -f /tmp/cqa-mailmap /tmp/cqa-replace

echo
echo "== 6. conferindo =="
RESTA_AUTOR=$(git log --all --format='%ae' | grep -c "$ANTIGO_EMAIL" || true)
RESTA_TEXTO=$(git log --all -S"$ANTIGO_EMAIL" --oneline | wc -l | tr -d ' ')
echo "   na autoria: $RESTA_AUTOR   no conteúdo: $RESTA_TEXTO"
if [ "$RESTA_AUTOR" != "0" ] || [ "$RESTA_TEXTO" != "0" ]; then
  echo "   AINDA SOBRA. Não empurre. Restaure de $BACKUP e investigue."
  exit 1
fi
echo "   limpo."

echo
cat <<FIM
== 7. falta empurrar, e isto o script não faz por você ==

O filter-repo removeu o remoto de propósito, para não haver push acidental.
Confira o histórico primeiro:

    git log --format='%h %an <%ae> %s' | head

Se estiver certo:

    git remote add origin $REMOTO
    git push --force --all origin
    git push --force --tags origin

Depois:
  - Ligue "Block command line pushes that expose my email" em
    github.com/settings/emails — impede reincidência.
  - Abra chamado em support.github.com pedindo a remoção das referências
    antigas em cache. Sem isso os SHAs velhos seguem alcançáveis.
  - O workflow republica sozinho no push. Confira o site depois.

Backup: $BACKUP
FIM
