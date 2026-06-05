#!/bin/sh

set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

yarn build

PACKAGE_TGZ=$(npm pack --silent)
PACKAGE_PATH="$REPO_ROOT/$PACKAGE_TGZ"
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/teamblind-mcp-publish-test.XXXXXX")

cleanup() {
  rm -rf "$TEST_DIR"
  rm -f "$PACKAGE_PATH"
}

trap cleanup EXIT INT TERM

if [ "$#" -eq 0 ]; then
  set -- --login
fi

printf 'Testing packed package from %s\n' "$PACKAGE_PATH"
printf 'Running from clean temp dir %s\n' "$TEST_DIR"

cd "$TEST_DIR"
npm exec --yes --package "$PACKAGE_PATH" teamblind-mcp -- "$@"
