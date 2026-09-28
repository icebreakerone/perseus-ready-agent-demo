#!/usr/bin/env bash
# Obtain this application's client (mTLS) and signing certificates from the
# IB1 Directory, and the Directory's CA bundles.
#
# Signing certificates is a write to the Directory: each run issues new
# certificates for the application. Run it once, by hand.
set -euo pipefail

APP="${CAP_APPLICATION_ID:-ciro1gll}"
ORG="${CAP_MEMBER_ID:-4tnapijm}"
OUT="${1:-certs}"

# Always a fresh copy of the CLI
directory() { uvx --refresh --from ib1-directory-cli directory --organization "$ORG" "$@"; }

mkdir -p "$OUT"
cd "$OUT"

for type in client signing; do
  if [[ -f "$APP-$type-cert.pem" ]]; then
    echo "$OUT/$APP-$type-cert.pem already exists; delete it to issue a new one."
    continue
  fi
  read -r -p "Issue a new $type certificate for application $APP in the Directory? [y/N] " answer
  [[ "$answer" == [yY] ]] || { echo "Skipped $type certificate."; continue; }
  # Generates a P-256 key locally (mode 0600); only the CSR is sent.
  directory cert sign "$APP" "$type" --name "perseus-ready-demo $type"
done

for type in client signing; do
  directory ca download "$type"
  rm -rf "directory-$type-certificates"
  unzip -q -o "directory-$type-certificates.zip" -d "directory-$type-certificates"
  rm "directory-$type-certificates.zip"
done

echo
for type in client signing; do
  [[ -f "$APP-$type-cert.pem" ]] || continue
  echo "== $type certificate"
  openssl x509 -in "$APP-$type-cert.pem" -noout -subject -serial -enddate -ext subjectAltName
  openssl verify -CAfile "directory-$type-certificates/root-ca.pem" \
    -untrusted "directory-$type-certificates/intermediate.pem" "$APP-$type-cert.pem"
done
