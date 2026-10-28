#!/usr/bin/env sh
set -eu
for tool in node npm git; do
  command -v "$tool" >/dev/null 2>&1 || { printf 'Required command missing: %s. Install Node.js >=22.12 and Git.\n' "$tool" >&2; exit 1; }
done
node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<12))process.exit(1)" || { printf 'Node.js >=22.12.0 is required.\n' >&2; exit 1; }
printf 'Installing T Bot CLI from GitHub main...\n'
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --global 'git+https://github.com/egemenkrdsek-boop/t-bot.git#main'
NPM_PREFIX=$(npm prefix --global)
TBOT_BIN="$NPM_PREFIX/bin/tbot"
[ -x "$TBOT_BIN" ] || { printf 'CLI executable not found: %s\n' "$TBOT_BIN" >&2; exit 1; }
"$TBOT_BIN" --help
"$TBOT_BIN" --version
printf 'T Bot CLI installed and verified. Run tbot config, then tbot.\n'
case ":$PATH:" in
  *":$NPM_PREFIX/bin:"*) ;;
  *) printf 'Add this directory to PATH in your shell profile: %s/bin\n' "$NPM_PREFIX" ;;
esac
