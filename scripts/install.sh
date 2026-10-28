#!/usr/bin/env sh
set -eu
for tool in node npm git; do
  command -v "$tool" >/dev/null 2>&1 || { printf 'Required command missing: %s. Install Node.js >=22.12 and Git.\n' "$tool" >&2; exit 1; }
done
node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<12))process.exit(1)" || { printf 'Node.js >=22.12.0 is required.\n' >&2; exit 1; }
PINNED_REVISION=${TBOT_INSTALL_REVISION:-}
case "$PINNED_REVISION" in *[!0-9a-fA-F]*) printf 'TBOT_INSTALL_REVISION must be a full 40-character commit SHA.\n' >&2; exit 1 ;; esac
if [ -n "$PINNED_REVISION" ] && [ "${#PINNED_REVISION}" -ne 40 ]; then
  printf 'TBOT_INSTALL_REVISION must be a full 40-character commit SHA.\n' >&2; exit 1
fi
PINNED_REVISION=$(printf '%s' "$PINNED_REVISION" | tr 'A-F' 'a-f')
INSTALL_REF=${TBOT_INSTALL_REF:-main}
case "$INSTALL_REF" in *[!A-Za-z0-9._/-]*|*..*) printf 'TBOT_INSTALL_REF must be a branch or tag name.\n' >&2; exit 1 ;; esac
STAGING=$(mktemp -d "${TMPDIR:-/tmp}/tbot-install.XXXXXXXX")
trap 'rm -rf -- "$STAGING"' EXIT
trap 'exit 1' HUP INT TERM
printf 'Building T Bot CLI from GitHub %s in a temporary checkout...\n' "$INSTALL_REF"
git clone --depth 1 --branch "$INSTALL_REF" -- 'https://github.com/egemenkrdsek-boop/t-bot.git' "$STAGING"
if [ -n "$PINNED_REVISION" ]; then
  git -C "$STAGING" fetch --depth 1 origin "$PINNED_REVISION"
  git -C "$STAGING" checkout --detach "$PINNED_REVISION" --
fi
REVISION=$(git -C "$STAGING" rev-parse HEAD)
EXPECTED_REVISION="$PINNED_REVISION"
if [ -z "$EXPECTED_REVISION" ] && [ "$INSTALL_REF" = "main" ]; then EXPECTED_REVISION=$(git -C "$STAGING" rev-parse refs/remotes/origin/main); fi
if [ -n "$EXPECTED_REVISION" ]; then [ "$REVISION" = "$EXPECTED_REVISION" ] || { printf 'Checkout does not match the requested revision.\n' >&2; exit 1; }; fi
printf 'Source revision: %s\n' "$REVISION"
(
  cd "$STAGING"
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --global=false --include=dev --ignore-scripts=false
)
VERSION=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version' "$STAGING/package.json")
BUILT_VERSION=$(node "$STAGING/dist/index.js" --version)
[ "$BUILT_VERSION" = "T Bot $VERSION" ] || { printf 'Built CLI version check failed; global CLI was not changed.\n' >&2; exit 1; }
node "$STAGING/dist/index.js" --help >/dev/null
(cd "$STAGING" && npm pack --global=false --ignore-scripts)
TARBALL="$STAGING/t-bot-cli-$VERSION.tgz"
[ -f "$TARBALL" ] || { printf 'CLI package missing: %s\n' "$TARBALL" >&2; exit 1; }
# Only a completely built package reaches the global installation.
npm install --global --ignore-scripts "$TARBALL"
NPM_PREFIX=$(npm prefix --global)
TBOT_BIN="$NPM_PREFIX/bin/tbot"
[ -x "$TBOT_BIN" ] || { printf 'CLI executable not found: %s\n' "$TBOT_BIN" >&2; exit 1; }
"$TBOT_BIN" --help
INSTALLED_VERSION=$("$TBOT_BIN" --version)
[ "$INSTALLED_VERSION" = "T Bot $VERSION" ] || { printf 'Installed CLI failed the expected version check.\n' >&2; exit 1; }
printf '%s\n' "$INSTALLED_VERSION"
printf 'T Bot CLI installed and verified. Run tbot config, then tbot.\n'
case ":$PATH:" in
  *":$NPM_PREFIX/bin:"*) ;;
  *) printf 'Add this directory to PATH in your shell profile: %s/bin\n' "$NPM_PREFIX" ;;
esac
