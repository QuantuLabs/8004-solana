#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ATOM_REPO_DIR="${REPO_ROOT}/../8004-atom"
ATOM_CRATE_DIR="${ATOM_REPO_DIR}/programs/atom-engine"
ATOM_REPO_URL="https://github.com/QuantuLabs/8004-atom.git"
ATOM_REQUIRED_REV="5c60f808c48c02f99ecb738c170db7c513fd689f"

if [[ ! -d "${ATOM_REPO_DIR}" ]]; then
  echo "[setup] Cloning ${ATOM_REPO_URL} into ${ATOM_REPO_DIR}"
  git clone "${ATOM_REPO_URL}" "${ATOM_REPO_DIR}"
fi

if [[ ! -d "${ATOM_REPO_DIR}/.git" ]]; then
  echo "[error] ${ATOM_REPO_DIR} exists but is not a git repository." >&2
  exit 1
fi

echo "[setup] Fetching atom-engine dependency"
git -C "${ATOM_REPO_DIR}" fetch --all --prune --no-tags >/dev/null
git -C "${ATOM_REPO_DIR}" fetch origin "${ATOM_REQUIRED_REV}" --no-tags >/dev/null 2>&1 || true

CURRENT_HEAD="$(git -C "${ATOM_REPO_DIR}" rev-parse HEAD)"
if [[ "${CURRENT_HEAD}" != "${ATOM_REQUIRED_REV}" ]]; then
  if [[ -n "$(git -C "${ATOM_REPO_DIR}" status --porcelain)" ]]; then
    echo "[error] ${ATOM_REPO_DIR} has local changes and is not at required revision ${ATOM_REQUIRED_REV}." >&2
    echo "[hint] Commit/stash your changes in 8004-atom, then rerun this script." >&2
    exit 1
  fi

  echo "[setup] Checking out required revision ${ATOM_REQUIRED_REV}"
  git -C "${ATOM_REPO_DIR}" checkout --quiet "${ATOM_REQUIRED_REV}"
fi

if [[ ! -f "${ATOM_CRATE_DIR}/Cargo.toml" ]]; then
  echo "[error] Missing crate at ${ATOM_CRATE_DIR}" >&2
  exit 1
fi

echo "[ok] atom-engine dependency ready at ${ATOM_CRATE_DIR}"
echo "[note] This repository intentionally keeps a path dependency for reproducible mainnet hash builds."
