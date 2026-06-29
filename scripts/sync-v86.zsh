#!/usr/bin/env zsh

set -euo pipefail
emulate -L zsh

src_root=${1:-$HOME/Stuff/v86}
repo_root=${0:A:h:h}

build_dir="$src_root/build"
release_wasm="$build_dir/wasm32-unknown-unknown/release/v86.wasm"
target_dir="$repo_root/v86"

if [[ ! -d "$build_dir" ]]; then
  print -u2 "missing build directory: $build_dir"
  exit 1
fi

mkdir -p "$target_dir"

cp \
  "$build_dir/libv86.js" \
  "$build_dir/libv86.mjs" \
  "$build_dir/libv86-debug.js" \
  "$build_dir/libv86-debug.mjs" \
  "$build_dir/v86.wasm" \
  "$build_dir/v86-debug.wasm" \
  "$release_wasm" \
  "$target_dir/"

cp "$release_wasm" "$target_dir/v86-fallback.wasm"
