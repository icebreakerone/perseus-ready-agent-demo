#!/usr/bin/env bash
# Set the app secret from the Directory-issued certificates in certs/ (as
# written by scripts/setup-certs.sh) and a session secret. An existing session
# secret is kept, so sessions survive. Nothing is written to disk.
#
#   AWS_PROFILE=kp-ib1 infra/scripts/put-secrets.sh [secret-id]
set -euo pipefail
cd "$(dirname "$0")/../.."
export AWS_PROFILE="${AWS_PROFILE:-kp-ib1}" AWS_REGION="${AWS_REGION:-eu-west-2}"
export APP="${CAP_APPLICATION_ID:-ciro1gll}"
SECRET_ID="${1:-perseusready/app}"

for kind in client signing; do
  for f in "certs/$APP-$kind-key.pem" "certs/$APP-$kind-cert.pem" \
    "certs/directory-$kind-certificates/intermediate.pem" "certs/directory-$kind-certificates/root-ca.pem"; do
    [ -s "$f" ] || { echo "Missing $f; run scripts/setup-certs.sh" >&2; exit 1; }
  done
done

{ aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text 2>/dev/null || echo '{}'; } |
  python3 -c '
import json, os, secrets, sys
try:
    existing = json.loads(sys.stdin.read() or "{}")
except json.JSONDecodeError:
    existing = {}
app = os.environ["APP"]
read = lambda path: open(path).read()
value = {}
for kind in ("client", "signing"):
    value[f"{kind}_key"] = read(f"certs/{app}-{kind}-key.pem")
    value[f"{kind}_cert"] = read(f"certs/{app}-{kind}-cert.pem")
    value[f"{kind}_intermediate"] = read(f"certs/directory-{kind}-certificates/intermediate.pem")
    value[f"{kind}_root_ca"] = read(f"certs/directory-{kind}-certificates/root-ca.pem")
value["session_secret"] = existing.get("session_secret") or secrets.token_hex(32)
print(json.dumps(value))' |
  aws secretsmanager put-secret-value --secret-id "$SECRET_ID" --secret-string file:///dev/stdin --query VersionId --output text >/dev/null

echo "Updated $SECRET_ID"
