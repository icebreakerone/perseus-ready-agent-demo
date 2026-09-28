# Perseus Readiness Demo

A single page Next.js app showing that we, a Carbon Accounting Provider (CAP), can complete the Perseus **"FSP-initiated with one permission"** flow in the IB1 sandbox. The flow runs from our Directory listing through to an emissions report for the SME's Financial Service Provider (FSP).

This app was built to demonstrate how the Perseus scheme documentation, specification, directory tools and sample code allow a Perseus compliant CAP client to be built using a code agent with minimal intervention.

The app is deployed at https://perseusready.sandbox.demo.ib1.org. The OpenTofu stack, container image and deploy scripts are described in [infra/README.md](infra/README.md).

The total agent work time was around 40 minutes. After the initial clarifying questions, the agent produced a working, compliant demo in a single 35-minute session.

## Original prompt

This demo was built with an AI coding agent (Claude Code). This is the prompt it started from:

> Our company is a carbon accounting provider that has joined the Perseus Scheme: an open, cross-sector data-sharing system in the UK designed to automate greenhouse gas emissions reporting for small and medium-sized enterprises (SMEs). We now want to build an app to demonstrate that we are Perseus ready. This is not the user facing app, but is just intended to demonstrate that we can complete the steps required to be Perseus ready.
>
> Our organisation is listed in the Perseus directory at https://directory.core.sandbox.trust.ib1.org/organizations/4tnapijm/. The directory lists members, applications and data catalogues. A members area at https://member.core.sandbox.trust.ib1.org/ allows us to manage our member profile, applications and data catalogues. The directory has an api at https://directory.core.sandbox.trust.ib1.org/api-docs and a cli tool at https://pypi.org/project/ib1-directory-cli/ to interact with that api. Install a fresh copy with uvx.
>
> A guide to implementation for CAPs is available at https://docs.core.trust.ib1.org/2026-03-12/scheme/perseus/carbon-accounting-providers/. We want to demonstrate the "1. FSP-initiated with one permission" flow. Our idea is to demonstrate our Perseus readiness by implementing a single page Nextjs app that shows the steps eg.
>
> 1. We are listed in the directory
> 2. We have registered this application
> 3. We can authorise our user with the energy data provider (EDP)
> 4. We can use the token we receive to retrieve half-hourly energy data for our user
>    etc.
>
> Continue up to creating the emissions report.
>
> Showing a tick against each of the steps as it is completed, requesting user actions where necessary (eg. logging into the energy data account).
>
> Read the provided documentation, ask clarifying questions if necessary, and then produce a plan for implementing this app. Where the demo code diverges from the documentation, the documentation (and particularly the specifications) takes precedence.

The agent then asked four clarifying questions. The answers were:

- **Provenance:** implement it in TypeScript.
- **Certificates:** issue them with the Directory CLI.
- **Report:** an HTML report with JSON downloads, rather than a signed PDF.
- **Extra scope:** include the gas meter (summed with electricity) and the permission-record lookup, but not withdrawal or the message-delivery endpoint.

### Plan summary
A single-page Next.js app showing that we, a Carbon Accounting Provider (CAP), can complete the Perseus **"FSP-initiated with one permission"** flow in the IB1 sandbox. The flow runs from our Directory listing through to an emissions report for the SME's Financial Service Provider (FSP).

Each step runs against the live sandbox services and gets a tick when it succeeds. Each step also records the requests it made (tokens redacted) so a reviewer can see what happened. Steps that need the SME pause for them to act.

| #   | Step                                                                                      | Who  |
| --- | ----------------------------------------------------------------------------------------- | ---- |
| 1   | We are listed in the Directory (CAP role, active Trust Framework and Perseus memberships) | auto |
| 2   | This application is registered, and its client and signing certificates are valid         | auto |
| 3   | We discover the EDP from the Directory catalogue and fetch its OAuth metadata             | auto |
| 4   | The SME signs in to their account with us                                                 | SME  |
| 5   | The SME grants permission using the Registry permission text, which we log                | SME  |
| 6   | The SME authorises us at the EDP (PAR + PKCE over mTLS, then token exchange)              | SME  |
| 7   | The EDP confirms the permission record                                                    | auto |
| 8   | We retrieve 12 months of half-hourly data, verify the EDP's provenance and add a Receipt  | auto |
| 9   | We obtain NESO grid intensity and DESNZ gas factors, recorded as external Origins         | auto |
| 10  | We calculate whole-month emissions across all meters, recorded as Process steps           | auto |
| 11  | We create the report for the FSP, with a Transfer step, and sign and verify the record    | auto |

Sources: the [CAP implementation guide](https://docs.core.trust.ib1.org/2026-03-12/scheme/perseus/carbon-accounting-providers/) and the specifications it links to. Where the sandbox differs from the specifications, the app follows the specification where it can. Where it can't, it isolates the difference in configuration and labels it in the UI as a "Sandbox note" (see [Known sandbox deviations](#known-sandbox-deviations)).

## Setup

Requirements: Node 20+, [uv](https://docs.astral.sh/uv/) (for `uvx`, also used by the tests), and a Directory login for the organisation `4tnapijm`.

```sh
npm install
cp .env.example .env.local        # then set SESSION_SECRET (openssl rand -hex 32)
scripts/setup-certs.sh            # once: issues certificates in the Directory
npm run dev
```

Then open http://localhost:3000.

### Certificates

`scripts/setup-certs.sh` uses a fresh copy of [ib1-directory-cli](https://pypi.org/project/ib1-directory-cli/) (`uvx --refresh`) to:

1. Issue a **client** certificate (mTLS) and a **signing** certificate (provenance) for the application `a/ciro1gll`. The CLI generates each P-256 key locally, and only the CSR is sent. **This writes to the Directory, so the script asks before each certificate.** Run `directory login` first if you have no cached token.
2. Download the Directory's client and signing CA bundles.

Everything goes into `certs/`, which git ignores. The mTLS connection presents the leaf certificate followed by the Client Issuer intermediate; a leaf-only bundle fails the handshake.

### The SME's EDP login

Step 6 sends the SME to the sandbox EDP's own login. IB1 doesn't publish test credentials for it. Use the account IB1 gave you, or ask them for one.

### Starting from an FSP link

The FSP-initiated flow starts from a link the FSP sends the SME. The landing page accepts `?fsp=<Directory member URL>`, for example `http://localhost:3000/?fsp=https://directory.core.sandbox.trust.ib1.org/m/hfp7r4t3`. The app accepts it only if the Directory gives that member the FSP role. Without the parameter, `FSP_MEMBER_URL` is used.

## Deployment

The demo runs on AWS at https://perseusready.sandbox.demo.ib1.org. The OpenTofu stack, container image and deploy scripts are described in [infra/README.md](infra/README.md).

## How it works

- `lib/runner.ts`: one handler per automatic step. Each step checks that earlier steps are done, and re-running a step clears the later ones.
- `lib/http.ts`: all outbound requests. mTLS uses an undici agent with our client certificate, and server certificates are always verified.
- `lib/oauth.ts`: RFC 8414 discovery (mTLS endpoint aliases), PKCE S256, PAR, token exchange and the permission record. The `client_id` is our application URL, the scope is the licence URL, and there is no client secret.
- `lib/provenance.ts`: a TypeScript port of [ib1-provenance](https://pypi.org/project/ib1-provenance/) (Provenance Records 1.0): nested signed containers, ES256 (DER) signatures, and self-contained certificates. `tests/provenance.test.ts` checks it against the Python library in both directions.
- `lib/emissions.ts`: half-hourly consumption × factor, summed into whole calendar months only (the last 12 completed months), across all meters.
- `lib/intensity.ts`: NESO regional intensity by outcode, fetched in 13-day chunks because the API rejects windows of 14 days or more.
- `lib/factors.ts`: DESNZ natural gas factors for 2024–2026, each applied from its publication date.
- Session state is a file-backed JSON store under `.data/sessions/`. Permission grants are appended to `.data/permission-log.jsonl` with timestamp, user, IP, user agent, licence and FSP.

The provenance record is signed at each point the guide requires:

```
EDP record(s) ─ verified ─▶ + Receipt per meter          ─ sign
                           + Origin (NESO) + Origin (DESNZ) ─ sign
                           + Process (electricity, gas)     ─ sign
                           + Transfer to FSP (per process)  ─ sign ─ verify
```

## Tests

```sh
npm test          # unit tests; the provenance cross-check runs the Python library via uvx
npm run typecheck
```

The tests create a throwaway test CA in a temporary directory using `scripts/gen-test-certs.py`, so no private keys are stored in the repository.

## Known sandbox deviations

| Where                              | Specification / guide                    | Sandbox                                                                    | What the app does                                                                           |
| ---------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| EDP `endpointURL` in the Directory | Base of the consumption data API         | `https://perseus-demo-energy.ib1.org/consumption/datasources/` returns 404 | Uses `EDP_RESOURCE_BASE_OVERRIDE` (`https://mtls.perseus-demo-energy.ib1.org`) and flags it |
| Catalogue `publisher`              | Member URL on the Directory host         | Sometimes on `sandbox.core.sandbox.trust.ib1.org`                          | Matches on the member identifier and flags it                                               |
| Permission record wrapper          | `{"permission": …}`                      | `{"permissions": …}`                                                       | Accepts both and flags it                                                                   |
| Scope                              | Licence URL only                         | Server adds `offline_access` itself                                        | Sends the licence URL only                                                                  |
| EDP scheme membership              | Current agreement                        | Perseus agreement expired 2026-09-04                                       | Warns; a production CAP would not connect                                                   |
| CAP → FSP transfer licence         | Not explicit for the one-permission flow | –                                                                          | Uses the one-permission licence (it covers the onward transfer) and notes it                |

Out of scope for this demo: withdrawal of permission, the message delivery endpoint, the signed PDF report, and the Directory allowlist check for server certificates.

## License

[MIT](LICENSE)
