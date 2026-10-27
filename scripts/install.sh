#!/usr/bin/env sh
# ==============================================================================
# T Bot 2.0 — Linux & macOS Uzaktan Tek Komutla Kurulum Betiği
# Kullanım: curl -fsSL https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.sh | sh
# ==============================================================================

set -e

# Renk Ayarları (Terminal ve NO_COLOR kontrolü)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  CYAN="\033[36m"
  GREEN="\033[32;1m"
  YELLOW="\033[33m"
  RED="\033[31;1m"
  BOLD="\033[1m"
  DIM="\033[2m"
  RESET="\033[0m"
else
  CYAN=""
  GREEN=""
  YELLOW=""
  RED=""
  BOLD=""
  DIM=""
  RESET=""
fi

show_header() {
  printf "\n"
  printf "${CYAN}    ______     ____        __   ___     ____ ${RESET}\n"
  printf "${CYAN}   /_  __/    / __ )____  / /_ |__ \\   / __ \\ ${RESET}\n"
  printf "${CYAN}    / /      / __  / __ \\/ __/ __/ /  / / / / ${RESET}\n"
  printf "${CYAN}   / /      / /_/ / /_/ / /_  / __/__/ /_/ /  ${RESET}\n"
  printf "${CYAN}  /_/      /_____/\\____/\\__/ /____(_)____/   ${RESET}\n"
  printf "\n"
  printf "${BOLD}${GREEN}  T Bot 2.0 — Tri-Core Local AI Agent & Autonomous Gateway${RESET}\n"
  printf "${DIM}  https://github.com/egemenkrdsek-boop/t-bot${RESET}\n"
  printf "${DIM}  ─────────────────────────────────────────────────────────────${RESET}\n"
  printf "\n"
}

show_error_and_exit() {
  printf "\n${RED}[HATA] %s${RESET}\n" "$1" >&2
  if [ -n "$2" ]; then
    printf "${YELLOW}Çözüm: %s${RESET}\n" "$2" >&2
  fi
  printf "\n" >&2
  exit 1
}

show_header

# ------------------------------------------------------------------------------
# ADIM 1: Sistem Gereksinimleri Kontrolü (Node.js >= 20.3, npm, git)
# ------------------------------------------------------------------------------
printf "${BOLD}${CYAN}[1/3] Sistem gereksinimleri kontrol ediliyor...${RESET}\n"

# Node.js Kontrolü
if ! command -v node >/dev/null 2>&1; then
  show_error_and_exit \
    "Node.js sisteminizde kurulu değil veya PATH çevre değişkenine eklenmemiş." \
    "T Bot 2.0 için Node.js 20.3 veya üzeri gereklidir.\n        macOS için: brew install node\n        Ubuntu/Debian için: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs\n        veya nvm ile: nvm install 20"
fi

NODE_VER_RAW=$(node -v 2>/dev/null || echo "")
NODE_MAJOR=$(echo "$NODE_VER_RAW" | sed -E 's/^v([0-9]+)\..*/\1/')
NODE_MINOR=$(echo "$NODE_VER_RAW" | sed -E 's/^v[0-9]+\.([0-9]+)\..*/\1/')

if [ -n "$NODE_MAJOR" ]; then
  if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "${NODE_MINOR:-0}" -lt 3 ]; }; then
    show_error_and_exit \
      "Mevcut Node.js sürümünüz ($NODE_VER_RAW) gereksinimleri karşılamıyor." \
      "T Bot 2.0 için en az Node.js 20.3 veya üzeri gereklidir. Lütfen Node.js sürümünüzü güncelleyin."
  fi
  printf "  ${GREEN}✓${RESET} Node.js: ${BOLD}%s${RESET}\n" "$NODE_VER_RAW"
else
  printf "  ${YELLOW}!${RESET} Node.js sürümü doğrulanamadı, kuruluma devam ediliyor.\n"
fi

# npm Kontrolü
if ! command -v npm >/dev/null 2>&1; then
  show_error_and_exit \
    "npm paket yöneticisi sisteminizde bulunamadı." \
    "Node.js kurulumunuzun eksiksiz olduğundan emin olun."
fi
NPM_VER=$(npm -v 2>/dev/null || echo "")
printf "  ${GREEN}✓${RESET} npm: ${BOLD}v%s${RESET}\n" "$NPM_VER"

# Git Kontrolü
if ! command -v git >/dev/null 2>&1; then
  show_error_and_exit \
    "Git sisteminizde bulunamadı veya PATH ortam değişkeninde yer almıyor." \
    "T Bot 2.0'ı GitHub üzerinden kurabilmek için Git gereklidir.\n        macOS: xcode-select --install veya brew install git\n        Linux: sudo apt install git veya sudo dnf install git"
fi
GIT_VER=$(git --version 2>/dev/null || echo "")
printf "  ${GREEN}✓${RESET} Git: ${BOLD}%s${RESET}\n" "$GIT_VER"

printf "\n"

# ------------------------------------------------------------------------------
# ADIM 2: T Bot 2.0 Global Kurulumu
# ------------------------------------------------------------------------------
printf "${BOLD}${CYAN}[2/3] T Bot 2.0 paketi kuruluyor...${RESET}\n"

REPO_URL="git+https://github.com/egemenkrdsek-boop/t-bot.git"
IS_LOCAL=0

if [ -f "package.json" ]; then
  if grep -q '"name": *"t-bot-cli"' package.json 2>/dev/null; then
    IS_LOCAL=1
  fi
fi

if [ "$IS_LOCAL" -eq 1 ]; then
  printf "  ${DIM}Yerel kaynak dizini algılandı. Yerel paket derlenip global yükleniyor...${RESET}\n"
  if ! npm install -g . ; then
    show_error_and_exit \
      "Yerel paket kurulumu başarısız oldu." \
      "Eğer EACCES izin hatası aldıysanız komutu 'sudo npm install -g .' ile çalıştırın veya npm global prefix ayarlarınızı yapılandırın."
  fi
else
  printf "  ${DIM}GitHub deposu klonlanıp global olarak yükleniyor (%s)...${RESET}\n" "$REPO_URL"
  if ! npm install -g "$REPO_URL" ; then
    show_error_and_exit \
      "npm install komutu başarısız oldu." \
      "Eğer izin hatası (EACCES) aldıysanız:\n        sudo npm install -g git+https://github.com/egemenkrdsek-boop/t-bot.git\n        veya npm global dizinini kullanıcı izinli yapın: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally"
  fi
fi

printf "  ${GREEN}✓${RESET} Paket başarıyla yüklendi.\n\n"

# ------------------------------------------------------------------------------
# ADIM 3: Doğrulama (tbot --help) ve PATH Kontrolü
# ------------------------------------------------------------------------------
printf "${BOLD}${CYAN}[3/3] Kurulum doğrulanıyor...${RESET}\n"

# Oturum PATH'ine npm global bin ekleme kontrolü
NPM_PREFIX=$(npm prefix -g 2>/dev/null || echo "")
if [ -n "$NPM_PREFIX" ] && [ -d "$NPM_PREFIX/bin" ]; then
  case ":$PATH:" in
    *":$NPM_PREFIX/bin:"*) ;;
    *) PATH="$NPM_PREFIX/bin:$PATH"; export PATH ;;
  esac
fi

if command -v tbot >/dev/null 2>&1; then
  TBOT_PATH=$(command -v tbot)
  printf "  ${GREEN}✓${RESET} 'tbot' yürütülebilir dosyası bulundu: ${DIM}%s${RESET}\n" "$TBOT_PATH"
  if tbot --help >/dev/null 2>&1; then
    printf "  ${GREEN}✓${RESET} 'tbot --help' doğrulaması başarılı.\n"
  fi
else
  printf "  ${YELLOW}! 'tbot' komutu mevcut oturumda anında bulunamadı.${RESET}\n"
  printf "  ${DIM}npm global bin dizini PATH değişkeninizde yer almıyor olabilir.${RESET}\n"
  if [ -n "$NPM_PREFIX" ]; then
    printf "  ${DIM}Kabuk profilinize (~/.bashrc veya ~/.zshrc) şunu ekleyin:${RESET}\n"
    printf "    ${CYAN}export PATH=\"%s/bin:\$PATH\"${RESET}\n" "$NPM_PREFIX"
  fi
fi

printf "\n"
printf "${GREEN}========================================================================${RESET}\n"
printf "${GREEN}✓ T Bot 2.0 başarıyla kuruldu! Başlatmak için terminale 'tbot' yazın.${RESET}\n"
printf "${GREEN}========================================================================${RESET}\n"
printf "\n"
printf "  ${BOLD}Hızlı Başlangıç İpuçları:${RESET}\n"
printf "    ${CYAN}tbot${RESET}                  ${DIM}Etkileşimli Siber-Minimalist TUI oturumu başlatır${RESET}\n"
printf "    ${CYAN}tbot config${RESET}           ${DIM}Sağlayıcı (Gemini, OpenAI, Anthropic, OpenRouter) ayarla${RESET}\n"
printf "    ${CYAN}tbot doctor${RESET}           ${DIM}Ortam ve sistem sağlığını denetle${RESET}\n"
printf "    ${CYAN}tbot --bot${RESET}            ${DIM}Sıfır-Backend Telegram Bot ağ geçidini başlat${RESET}\n"
printf "    ${CYAN}tbot --ultracode${RESET}      ${DIM}4-Aşamalı Öz-Onarımlı otonom kodlama modunu aç${RESET}\n"
printf "    ${CYAN}tbot --help${RESET}           ${DIM}Tüm komutları ve bayrakları listele${RESET}\n"
printf "\n"
