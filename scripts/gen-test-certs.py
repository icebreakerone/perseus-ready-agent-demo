"""Generate a throwaway signing CA hierarchy with IB1 extensions for tests.

Usage: uvx --with cryptography --with asn1crypto python scripts/gen-test-certs.py OUT_DIR

Run automatically by the tests (tests/fixtures.ts).
"""
import datetime
import sys
from pathlib import Path

import asn1crypto.core as asn1
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

OUT = Path(sys.argv[1])
NOW = datetime.datetime.now(datetime.UTC)
DIRECTORY = "https://directory.core.sandbox.trust.ib1.org"
SCHEME = "https://registry.core.sandbox.trust.ib1.org/scheme/perseus"


class Utf8Seq(asn1.SequenceOf):
    _child_spec = asn1.UTF8String


def name(cn, org="Core Trust Framework"):
    return x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "GB"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, org),
        x509.NameAttribute(NameOID.COMMON_NAME, cn),
    ])


def cert(subject, key, issuer_name, issuer_key, ca, extensions=()):
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer_name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(NOW - datetime.timedelta(days=1))
        .not_valid_after(NOW + datetime.timedelta(days=365))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(issuer_key.public_key()), critical=False
        )
    )
    if not ca:
        builder = builder.add_extension(
            x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.CLIENT_AUTH]), critical=False
        )
    builder = builder.add_extension(
        x509.KeyUsage(
            digital_signature=True, content_commitment=False, key_encipherment=False,
            data_encipherment=False, key_agreement=False, key_cert_sign=ca, crl_sign=ca,
            encipher_only=False, decipher_only=False,
        ),
        critical=True,
    )
    for ext in extensions:
        builder = builder.add_extension(ext, critical=False)
    return builder.sign(issuer_key, hashes.SHA256())


def pem(c):
    return c.public_bytes(serialization.Encoding.PEM).decode()


def key_pem(k):
    return k.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()


root_key = ec.generate_private_key(ec.SECP256R1())
root_name = name("Test signing CA")
root = cert(root_name, root_key, root_name, root_key, True)
int_key = ec.generate_private_key(ec.SECP256R1())
int_name = name("Test signing issuer")
intermediate = cert(int_name, int_key, root_name, root_key, True)

(OUT / "root-ca.pem").write_text(pem(root))
(OUT / "intermediate.pem").write_text(pem(intermediate))

for party, app, member, role in [
    ("edp", "a/edp00001", "m/7a1qv915", "energy-data-provider"),
    ("cap", "a/ciro1gll", "m/4tnapijm", "carbon-accounting-provider"),
]:
    k = ec.generate_private_key(ec.SECP256R1())
    app_url = f"{DIRECTORY}/{app}"
    leaf = cert(
        name(app_url, org=f"Test {party.upper()}"), k, int_name, int_key, False,
        extensions=[
            x509.SubjectAlternativeName([x509.UniformResourceIdentifier(app_url)]),
            x509.UnrecognizedExtension(
                x509.ObjectIdentifier("1.3.6.1.4.1.62329.1.1"),
                Utf8Seq([f"{SCHEME}/role/{role}"]).dump(),
            ),
            x509.UnrecognizedExtension(
                x509.ObjectIdentifier("1.3.6.1.4.1.62329.1.3"),
                asn1.UTF8String(f"{DIRECTORY}/{member}").dump(),
            ),
        ],
    )
    (OUT / f"{party}-bundle.pem").write_text(pem(leaf) + pem(intermediate))
    (OUT / f"{party}-key.pem").write_text(key_pem(k))

print("wrote test certificates to", OUT)
