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
INSTALL_REF=${TBOT_INSTALL_REF:-release}
case "$INSTALL_REF" in *[!A-Za-z0-9._/-]*|*..*) printf 'TBOT_INSTALL_REF must be a branch or tag name.\n' >&2; exit 1 ;; esac
BACKUP=
STAGING=$(mktemp -d "${TMPDIR:-/tmp}/tbot-install.XXXXXXXX")
cleanup() { rm -rf -- "$STAGING" ${BACKUP:+"$BACKUP"}; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
printf 'Building T Bot CLI from GitHub %s in a temporary checkout...\n' "$INSTALL_REF"
git clone --depth 1 --branch "$INSTALL_REF" -- 'https://github.com/egemenkrdsek-boop/t-bot.git' "$STAGING"
if [ -n "$PINNED_REVISION" ]; then
  git -C "$STAGING" fetch --depth 1 origin "$PINNED_REVISION"
  git -C "$STAGING" checkout --detach "$PINNED_REVISION" --
fi
REVISION=$(git -C "$STAGING" rev-parse HEAD)
if [ -n "$PINNED_REVISION" ]; then
  EXPECTED_REVISION="$PINNED_REVISION"
elif EXPECTED_REVISION=$(git -C "$STAGING" rev-parse --verify "refs/remotes/origin/$INSTALL_REF" 2>/dev/null); then
  :
elif EXPECTED_REVISION=$(git -C "$STAGING" rev-parse --verify "refs/tags/$INSTALL_REF" 2>/dev/null); then
  :
else
  printf 'Unable to verify the requested ref: %s\n' "$INSTALL_REF" >&2; exit 1
fi
[ "$REVISION" = "$EXPECTED_REVISION" ] || { printf 'Checkout does not match the requested revision.\n' >&2; exit 1; }
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
NPM_PREFIX=$(npm prefix --global)
[ -n "$NPM_PREFIX" ] || { printf 'Unable to resolve npm global prefix.\n' >&2; exit 1; }
GLOBAL_ROOT="$NPM_PREFIX/lib/node_modules"
PACKAGE_DIR="$GLOBAL_ROOT/t-bot-cli"
BIN_DIR="$NPM_PREFIX/bin"
SHIMS='tbot t-bot t-bot-cli'
BACKED_UP=0
# Best-effort rollback: copy the previous package directory and bin shims
# before npm mutates the prefix. Shared dependencies at the prefix root are
# not copied; this protects the CLI entry point, not a full snapshot.
if [ -d "$PACKAGE_DIR" ]; then
  BACKUP=$(mktemp -d "${TMPDIR:-/tmp}/tbot-cli-backup.XXXXXXXX")
  cp -R "$PACKAGE_DIR" "$BACKUP/package"
  for name in $SHIMS; do
    if [ -e "$BIN_DIR/$name" ] || [ -L "$BIN_DIR/$name" ]; then cp -P "$BIN_DIR/$name" "$BACKUP/bin-$name"; fi
  done
  BACKED_UP=1
fi
restore_previous() {
  [ "$BACKED_UP" = 1 ] || return 0
  rm -rf "$PACKAGE_DIR" || return 1
  mkdir -p "$GLOBAL_ROOT" || return 1
  cp -R "$BACKUP/package" "$PACKAGE_DIR" || return 1
  for name in $SHIMS; do
    if [ -e "$BACKUP/bin-$name" ] || [ -L "$BACKUP/bin-$name" ]; then
      cp -P "$BACKUP/bin-$name" "$BIN_DIR/$name" || return 1
    fi
  done
}
uninstall_step_failed() {
  printf '%s\n' "$1" >&2
  if restore_previous; then printf 'Previous T Bot CLI restored.\n' >&2
  else printf 'The previous CLI could not be restored automatically. Reinstall it with: npm install -g t-bot-cli@<previous-version>\n' >&2
  fi
  exit 1
}
npm install --global --ignore-scripts "$TARBALL" || uninstall_step_failed 'npm install failed. Check the build output, network access and npm global prefix permissions.'
TBOT_BIN="$BIN_DIR/tbot"
[ -x "$TBOT_BIN" ] || uninstall_step_failed "CLI executable not found: $TBOT_BIN"
"$TBOT_BIN" --help || uninstall_step_failed 'Installed CLI failed the --help check.'
INSTALLED_VERSION=$("$TBOT_BIN" --version) || uninstall_step_failed 'Installed CLI failed to report its version.'
[ "$INSTALLED_VERSION" = "T Bot $VERSION" ] || uninstall_step_failed 'Installed CLI failed the expected version check.'
printf '%s\n' "$INSTALLED_VERSION"
printf 'T Bot CLI installed and verified. Run tbot config, then tbot.\n'
case ":$PATH:" in
  *":$NPM_PREFIX/bin:"*) ;;
  *) printf 'Add this directory to PATH in your shell profile: %s/bin\n' "$NPM_PREFIX" ;;
esac
