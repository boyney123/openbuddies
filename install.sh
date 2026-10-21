#!/usr/bin/env bash
# Installs OpenBuddies on macOS or Linux:
#
#   curl -fsSL https://raw.githubusercontent.com/boyney123/openbuddies/main/install.sh | bash
#
# The program goes in ~/.openbuddies: OpenBuddies itself, and Node.js too if this computer doesn't have version 22 or
# newer. Nothing needs sudo. The `openbuddies` command is a small launcher in a folder already on your PATH (such as
# /opt/homebrew/bin), or, if none can be written, one PATH line in your shell's startup file. Then `openbuddies init`
# sets up your household, kept in ~/openbuddies (settings, chats and files: the folder to back up), and starts it.
# Run it again any time to update; `openbuddies update` does that too, keeping a copy of the household first.
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

# 3. Make the `openbuddies` command work, in this terminal too. Best: a small launcher in a folder that's already on the
#    PATH and writable without sudo. Otherwise: add $INSTALL_DIR/bin to the shell's startup file, for new terminals.
cli="$INSTALL_DIR/lib/node_modules/openbuddies/dist/src/cli/index.js"
node_path="$(command -v node)"
launcher=""
for d in "$HOME/.local/bin" "$HOME/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
  case ":$ORIGINAL_PATH:" in
    *":$d:"*) if [ -d "$d" ] && [ -w "$d" ]; then launcher="$d/openbuddies"; break; fi ;;
  esac
done
new_path=0
if [ -n "$launcher" ]; then
  # The absolute Node path, so it runs with the Node it was installed for whatever else is on the PATH.
  printf '#!/bin/sh\n# OpenBuddies launcher, made by its installer (%s/bin). Running the installer again remakes it.\nexec "%s" "%s" "$@"\n' "$INSTALL_DIR" "$node_path" "$cli" >"$launcher"
  chmod +x "$launcher"
else
  case "$(basename "${SHELL:-sh}")" in
    zsh) rc="$HOME/.zshrc" ;;
    bash) if [ "$os" = darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
    *) rc="$HOME/.profile" ;;
  esac
  case ":$ORIGINAL_PATH:" in
    *":$INSTALL_DIR/bin:"*) ;;
    *)
      if ! grep -qsF "$INSTALL_DIR/bin" "$rc"; then
        printf '\n# OpenBuddies\nexport PATH="%s/bin:$PATH"\n' "$INSTALL_DIR" >>"$rc"
      fi
      new_path=1
      ;;
  esac
fi

# 4. The first time: set up a household, which ends by starting OpenBuddies and showing the code to scan. After that:
#    restart the household's server on the new version.
has_household=0
{ [ -f "$HOME/.openbuddiesrc" ] || [ -f "$HOME/openbuddies/openbuddies.yaml" ]; } && has_household=1
if [ "$has_household" = 1 ]; then
  say "Restarting OpenBuddies on the new version…"
  "$INSTALL_DIR/bin/openbuddies" start --no-open --no-qr || true
  say "Next time, 'openbuddies update' does this for you, and keeps a copy of your household first."
elif [ "$RUN_INIT" = 1 ] && { true </dev/tty; } 2>/dev/null; then
  echo
  "$INSTALL_DIR/bin/openbuddies" init </dev/tty
else
  say "Next, set up your household: openbuddies init"
fi
if [ "$new_path" = 1 ]; then
  echo
  say "The 'openbuddies' command works in new terminals. In this one, run this first:"
  echo "  export PATH=\"$INSTALL_DIR/bin:\$PATH\""
fi
