#!/usr/bin/env bash
# Installs OpenBuddies on macOS or Linux:
#
#   curl -fsSL https://raw.githubusercontent.com/boyney123/openbuddies/main/install.sh | bash
#
# Everything goes in ~/.openbuddies: OpenBuddies itself, and Node.js too if this computer doesn't have version 22 or
# newer. Nothing needs sudo and nothing else on the computer changes, apart from one PATH line in your shell's startup
# file. Then it runs `openbuddies init` to set up your household. Run it again any time to update.
#
# Options (pass them with `| bash -s -- --no-init`):
#   --no-init    install or update only
# Environment:
#   OPENBUDDIES_INSTALL_DIR   where to install (default ~/.openbuddies)
#   OPENBUDDIES_PACKAGE       what to install (default openbuddies@latest; a .tgz path works, for testing)

set -euo pipefail

INSTALL_DIR="${OPENBUDDIES_INSTALL_DIR:-$HOME/.openbuddies}"
PACKAGE="${OPENBUDDIES_PACKAGE:-openbuddies@latest}"
MIN_NODE=22
NODE_LINE=24 # the Node.js release line installed when the computer's Node is missing or too old
RUN_INIT=1
for arg in "$@"; do
  case "$arg" in
    --no-init) RUN_INIT=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "OpenBuddies runs on macOS or Linux. On Windows, install it inside WSL2." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "OpenBuddies doesn't support this processor ($(uname -m)) yet." ;;
esac
command -v curl >/dev/null || fail "This needs curl. Install it and run this again."
command -v tar >/dev/null || fail "This needs tar. Install it and run this again."

ORIGINAL_PATH="$PATH"
mkdir -p "$INSTALL_DIR/bin"
export PATH="$INSTALL_DIR/bin:$PATH"

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# 1. Node.js: the computer's own if it's new enough, otherwise a private copy in $INSTALL_DIR/node.
if command -v node >/dev/null && [ "$(node_major)" -ge "$MIN_NODE" ]; then
  say "Using Node.js $(node --version)."
else
  say "Installing Node.js $NODE_LINE into $INSTALL_DIR (this computer doesn't have Node.js $MIN_NODE or newer)…"
  base="https://nodejs.org/dist/latest-v${NODE_LINE}.x"
  sums="$(curl -fsSL "$base/SHASUMS256.txt")" || fail "Couldn't reach nodejs.org. Check your internet connection."
  file="$(printf '%s\n' "$sums" | awk -v want="-$os-$arch.tar.gz" 'substr($2, length($2) - length(want) + 1) == want { print $2; exit }')"
  [ -n "$file" ] || fail "Couldn't find Node.js for $os-$arch."
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "$base/$file" -o "$tmp/$file" || fail "Couldn't download Node.js. Check your internet connection."
  expected="$(printf '%s\n' "$sums" | awk -v f="$file" '$2 == f { print $1 }')"
  if command -v shasum >/dev/null; then actual="$(shasum -a 256 "$tmp/$file" | awk '{ print $1 }')"; else actual="$(sha256sum "$tmp/$file" | awk '{ print $1 }')"; fi
  [ "$expected" = "$actual" ] || fail "The Node.js download didn't match its checksum, so it wasn't used. Try again."
  rm -rf "$INSTALL_DIR/node"
  mkdir -p "$INSTALL_DIR/node"
  tar -xzf "$tmp/$file" -C "$INSTALL_DIR/node" --strip-components=1
  for b in node npm npx; do ln -sf "../node/bin/$b" "$INSTALL_DIR/bin/$b"; done
  hash -r
  say "Installed Node.js $(node --version)."
fi

# 2. OpenBuddies, into the same folder.
updating=0
[ -x "$INSTALL_DIR/bin/openbuddies" ] && updating=1
say "$([ "$updating" = 1 ] && echo Updating || echo Installing) OpenBuddies…"
npm install --global --prefix "$INSTALL_DIR" --no-fund --no-audit --no-update-notifier --loglevel=error "$PACKAGE" || fail "Couldn't install OpenBuddies."
"$INSTALL_DIR/bin/openbuddies" --help >/dev/null || fail "OpenBuddies installed but won't run. Please open an issue: https://github.com/boyney123/openbuddies/issues"
version="$(node -p 'require(process.argv[1]).version' "$INSTALL_DIR/lib/node_modules/openbuddies/package.json")"
say "OpenBuddies $version is installed."

# 3. Put `openbuddies` on the PATH for new terminals.
case "$(basename "${SHELL:-sh}")" in
  zsh) rc="$HOME/.zshrc" ;;
  bash) if [ "$os" = darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
  *) rc="$HOME/.profile" ;;
esac
new_path=0
case ":$ORIGINAL_PATH:" in
  *":$INSTALL_DIR/bin:"*) ;;
  *)
    if ! grep -qsF "$INSTALL_DIR/bin" "$rc"; then
      printf '\n# OpenBuddies\nexport PATH="%s/bin:$PATH"\n' "$INSTALL_DIR" >>"$rc"
      say "Added OpenBuddies to your PATH in $rc."
    fi
    new_path=1
    ;;
esac

# 4. Set up a household, the first time. (A household already set up just needs restarting on the new version.)
has_household=0
{ [ -f "$HOME/.openbuddiesrc" ] || [ -f "$HOME/openbuddies/openbuddies.yaml" ]; } && has_household=1
if [ "$has_household" = 1 ]; then
  say "Your household is already set up. Run 'openbuddies start' to restart OpenBuddies on the new version."
elif [ "$RUN_INIT" = 1 ] && { true </dev/tty; } 2>/dev/null; then
  echo
  "$INSTALL_DIR/bin/openbuddies" init </dev/tty
else
  say "Next, set up your household: openbuddies init"
fi
if [ "$new_path" = 1 ]; then
  echo
  say "Open a new terminal to use the 'openbuddies' command (or run: export PATH=\"$INSTALL_DIR/bin:\$PATH\")."
fi
