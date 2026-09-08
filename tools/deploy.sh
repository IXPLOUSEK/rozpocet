#!/usr/bin/env bash
# tools/deploy.sh — nahraje appku na GitHub Pages.
# Předpoklad: `gh auth login` proběhl. Spouštět z kořene projektu.
#
#   ./tools/deploy.sh              # repozitář "rozpocet"
#   ./tools/deploy.sh jiny-nazev   # jiný název repozitáře
set -euo pipefail

REPO="${1:-rozpocet}"
GH="${GH:-$HOME/.local/bin/gh}"
[ -x "$GH" ] || GH="$(command -v gh || true)"
[ -n "$GH" ] || { echo "gh není nainstalované."; exit 1; }

command -v git >/dev/null || { echo "git chybí"; exit 1; }
[ -f rozpocet.html ] || { echo "Spusť to z kořene projektu."; exit 1; }

echo "1) kontrola přihlášení"
"$GH" auth status >/dev/null 2>&1 || { echo "   Nejsi přihlášený. Spusť: gh auth login"; exit 1; }
USER=$("$GH" api user --jq .login)
echo "   přihlášen jako $USER"

echo "2) sestavení a kontroly"
node build.mjs
node tools/gate.mjs

echo "3) repozitář"
if "$GH" repo view "$USER/$REPO" >/dev/null 2>&1; then
  echo "   $USER/$REPO už existuje"
else
  "$GH" repo create "$USER/$REPO" --public \
    --description "Rozpočet — česká appka na osobní rozpočet, jeden soubor, funguje offline" >/dev/null
  echo "   vytvořen $USER/$REPO"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "https://github.com/$USER/$REPO.git"
else
  git remote add origin "https://github.com/$USER/$REPO.git"
fi
"$GH" auth setup-git >/dev/null 2>&1 || true

echo "4) zdrojové soubory na větev main"
git add -A
git diff --cached --quiet || git commit -q -m "Aktualizace před nasazením"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || git branch -M main
git push -u origin main --force-with-lease 2>/dev/null || git push -u origin main

echo "5) appka na větev gh-pages"
# Publikuje se JEN obsah dist/: index.html a sw.js. Zdrojáky na web nepatří.
TMP=$(mktemp -d)
cp dist/index.html dist/sw.js "$TMP"/
cp NAVOD-pro-ni.md "$TMP"/ 2>/dev/null || true
touch "$TMP/.nojekyll"          # jinak Jekyll ignoruje soubory s podtržítkem
( cd "$TMP"
  git init -q -b gh-pages
  git config user.email "$(git -C "$OLDPWD" config user.email 2>/dev/null || echo noreply@example.com)"
  git config user.name  "$(git -C "$OLDPWD" config user.name  2>/dev/null || echo deploy)"
  git add -A
  git commit -q -m "Nasazení appky"
  git push -q --force "https://github.com/$USER/$REPO.git" gh-pages )
rm -rf "$TMP"

echo "6) zapnutí GitHub Pages"
"$GH" api -X POST "repos/$USER/$REPO/pages" \
  -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 \
  || "$GH" api -X PUT "repos/$USER/$REPO/pages" \
       -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 \
  || echo "   (Pages už zapnuté nebo je potřeba zapnout ručně v Settings → Pages)"

URL="https://$USER.github.io/$REPO/"
echo
echo "HOTOVO"
echo "  adresa:      $URL"
echo "  repozitář:   https://github.com/$USER/$REPO"
echo
echo "První nasazení může naběhnout do dvou minut. Pak adresu otevři v Safari"
echo "na iPhonu a dej Sdílet → Přidat na plochu."
