#!/bin/sh
# Write the certificates and keys injected from Secrets Manager (as *_PEM
# environment variables) to files readable only by this user, then start the
# app without the PEMs in its environment. Keys and leaf certificates go to
# the matching *_PATH; the Directory's CA certificates go into *_CA_DIR, where
# the app looks for intermediate.pem and root-ca.pem.
set -eu
umask 077

write_pem() { # <PEM variable> <destination>
  eval "pem=\${$1:-}"
  if [ -n "$pem" ]; then
    [ -n "$2" ] || { echo "$1 is set but its destination is not" >&2; exit 1; }
    mkdir -p "$(dirname "$2")"
    printf '%s\n' "$pem" > "$2"
  fi
  unset "$1"
}

for kind in CLIENT SIGNING; do
  eval "ca_dir=\${${kind}_CA_DIR:-}"
  eval "write_pem ${kind}_KEY_PEM \"\${${kind}_KEY_PATH:-}\""
  eval "write_pem ${kind}_CERT_PEM \"\${${kind}_CERT_PATH:-}\""
  write_pem "${kind}_INTERMEDIATE_PEM" "${ca_dir:+$ca_dir/intermediate.pem}"
  write_pem "${kind}_ROOT_CA_PEM" "${ca_dir:+$ca_dir/root-ca.pem}"
done

# The Next.js standalone server listens on $HOSTNAME. Fargate sets that to the
# task's own hostname, which would leave the server unreachable on 127.0.0.1,
# where the container health check calls it. Listen on every interface.
export HOSTNAME="${BIND_ADDRESS:-0.0.0.0}"

exec "$@"
