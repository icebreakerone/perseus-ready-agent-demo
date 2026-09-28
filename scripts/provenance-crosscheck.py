"""Cross-check our TypeScript provenance implementation with ib1-provenance.

  edp-record FIXTURES OUT   write an EDP-style record signed by the reference library
  verify ROOT_CA RECORD     verify a record with the reference library, print decoded steps

Run with: uvx --with ib1-provenance python scripts/provenance-crosscheck.py ...
"""
import json
import sys

from ib1.provenance import Record
from ib1.provenance.certificates import CertificatesProviderSelfContainedRecord
from ib1.provenance.signing import SignerFiles

TF = "https://registry.core.sandbox.trust.ib1.org/trust-framework"
SCHEME = "https://registry.core.sandbox.trust.ib1.org/scheme/perseus"


def edp_record(fixtures, out):
    with open(f"{fixtures}/root-ca.pem", "rb") as f:
        provider = CertificatesProviderSelfContainedRecord(f.read())
    signer = SignerFiles(provider, f"{fixtures}/edp-bundle.pem", f"{fixtures}/edp-key.pem")
    r = Record(TF)
    perm = r.add_step({
        "type": "permission", "scheme": SCHEME, "timestamp": "2026-09-23T10:00:00Z",
        "account": "opaque-account-1", "expires": "2027-09-23T10:00:00Z",
        "allows": {"licenses": [f"{SCHEME}/license/energy-consumption-emissions-edp-cap-fsp/2026-03-12"]},
    })
    origin = r.add_step({
        "type": "origin", "scheme": SCHEME, "sourceType": f"{SCHEME}/source-type/Meter",
        "origin": "https://www.smartdcc.co.uk/", "external": True, "permissions": [perm],
        "note": "café non-ASCII check",
    })
    r.add_step({
        "type": "transfer", "scheme": SCHEME, "of": origin,
        "to": "https://directory.core.sandbox.trust.ib1.org/a/ciro1gll",
        "license": f"{SCHEME}/license/energy-consumption-emissions-edp-cap-fsp/2026-03-12",
        "path": "/readings", "parameters": {"measure": "import"}, "permissions": [perm],
    })
    with open(out, "w") as f:
        json.dump(r.sign(signer).encoded(), f)


def verify(root_ca, path):
    with open(root_ca, "rb") as f:
        provider = CertificatesProviderSelfContainedRecord(f.read())
    with open(path) as f:
        r = Record(TF, json.load(f))
    r.verify(provider)
    print(json.dumps(r.decoded()))


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    {"edp-record": edp_record, "verify": verify}[cmd](*args)
