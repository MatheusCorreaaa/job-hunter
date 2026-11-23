#!/usr/bin/env bash
set -euo pipefail

base="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
version=43.8.12
architecture="$(uname -m)"
os="$(uname -s)"

case "$os:$architecture" in
  Darwin:arm64) target=darwin-arm64; checksum=d48d1b50bb4afa3e96991c350cff5ef0d493731456b13c003bc4f354f5909dcb ;;
  Darwin:x86_64) target=darwin-x64; checksum=5d9185374c3a0676db02768037c484eafa8846f7630b4fe31c761434ab61b6f7 ;;
  Linux:x86_64) target=linux-x64; checksum=737419891e0a749488c854db5d3b47f46ae128355566b5e7b916dd030c631663 ;;
  *) printf 'Plataforma não contemplada por este iniciador.\n' >&2; exit 1 ;;
esac

cache="${XDG_CACHE_HOME:-$HOME/.cache}/job-hunter"
runtime="$cache/electron-$version-$target"
if [ "$os" = Darwin ]; then
  executable="$runtime/Electron.app/Contents/MacOS/Electron"
else
  executable="$runtime/electron"
fi

if [ ! -x "$executable" ] || [ ! -f "$runtime/.ready" ]; then
  mkdir -p "$cache"
  stage="$(mktemp -d "$cache/.download.XXXXXXXX")"
  trap 'rm -rf -- "$stage"' EXIT
  printf 'Baixando o Electron oficial para a primeira abertura…\n'
  curl --fail --location --retry 2 --output "$stage/electron.zip" \
    "https://github.com/electron/electron/releases/download/v$version/electron-v$version-$target.zip"
  if command -v sha256sum >/dev/null; then
    printf '%s  %s\n' "$checksum" "$stage/electron.zip" | sha256sum --check --status
  else
    printf '%s  %s\n' "$checksum" "$stage/electron.zip" | shasum -a 256 --check
  fi
  mkdir -p "$runtime"
  unzip -qo "$stage/electron.zip" -d "$runtime"
  touch "$runtime/.ready"
  rm -rf -- "$stage"
  trap - EXIT
fi

if [ "$os" = Linux ]; then
  exec "$executable" --disable-setuid-sandbox "$base/app"
fi
exec "$executable" "$base/app"
