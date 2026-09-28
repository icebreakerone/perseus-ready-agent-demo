// Shared by server and client: the ordered checklist the page renders.

export type StepId =
  | 'directory'
  | 'application'
  | 'discovery'
  | 'login'
  | 'permission'
  | 'authorise'
  | 'permission-record'
  | 'data'
  | 'factors'
  | 'calculate'
  | 'report'

export type StepKind = 'auto' | 'user'
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'action'

export interface StepDefinition {
  id: StepId
  title: string
  kind: StepKind
  // What the step proves, in the terms of the CAP guide
  description: string
  references: { label: string; url: string }[]
}

const GUIDE = 'https://docs.core.trust.ib1.org/2026-03-12/scheme/perseus/carbon-accounting-providers/'
const CTG = 'https://docs.core.trust.ib1.org/2026-03-12/scheme/perseus/common-technical-guide/'
const OAUTH = 'https://specification.docs.ib1.org/oauth-with-member-identity-certificates/1.0/'
const PROVENANCE = 'https://specification.trust.ib1.org/provenance-records/1.0/'

export const STEPS: StepDefinition[] = [
  {
    id: 'directory',
    title: 'We are listed in the Directory',
    kind: 'auto',
    description:
      'Our organisation is a Directory member with the Carbon Accounting Provider role and active Trust Framework and Perseus scheme memberships.',
    references: [{ label: 'Common Technical Guide', url: CTG }],
  },
  {
    id: 'application',
    title: 'This application is registered, with valid certificates',
    kind: 'auto',
    description:
      'The application is published in the Directory, and its client (mTLS) and signing certificates were issued by the Directory with our member URL, application URL and CAP role.',
    references: [
      { label: 'Member identity certificates', url: 'https://specification.trust.ib1.org/member-identity-digital-certificates/1.0/' },
    ],
  },
  {
    id: 'discovery',
    title: 'We can discover the Energy Data Provider',
    kind: 'auto',
    description:
      "The EDP's data service is found in the Directory catalogue by the energy consumption data standard, and its OAuth authorisation server metadata is fetched.",
    references: [{ label: 'OAuth profile', url: OAUTH }],
  },
  {
    id: 'login',
    title: 'The SME signs in to their account with us',
    kind: 'user',
    description:
      'The SME followed a link from their Financial Service Provider to our public landing page, and signs in to their account with us, the CAP.',
    references: [{ label: 'CAP guide: landing page', url: GUIDE }],
  },
  {
    id: 'permission',
    title: 'The SME grants permission',
    kind: 'user',
    description:
      'Before we connect to the EDP, the SME sees the Perseus permission text for the one-permission licence and agrees to it. We log the grant.',
    references: [{ label: 'CAP guide: permission', url: GUIDE }],
  },
  {
    id: 'authorise',
    title: 'The SME authorises us with their Energy Data Provider',
    kind: 'user',
    description:
      'We push an authorisation request (PAR) over mTLS, the SME signs in at the EDP, and we exchange the code for certificate-bound tokens.',
    references: [{ label: 'OAuth profile', url: OAUTH }],
  },
  {
    id: 'permission-record',
    title: 'The EDP confirms the permission record',
    kind: 'auto',
    description:
      "We retrieve the EDP's record of the permission using the refresh token, showing the licence, account and expiry.",
    references: [{ label: 'Permission records', url: 'https://specification.docs.ib1.org/permission-records/1.0/' }],
  },
  {
    id: 'data',
    title: 'We retrieve half-hourly energy data',
    kind: 'auto',
    description:
      "Using the access token, we fetch the SME's meters and 12 complete months of half-hourly readings, verify the EDP's provenance record and add a Receipt step.",
    references: [
      { label: 'Consumption data API', url: 'https://registry.core.sandbox.trust.ib1.org/scheme/perseus/api/consumption-data@2026-03-12.json' },
      { label: 'Provenance records', url: PROVENANCE },
    ],
  },
  {
    id: 'factors',
    title: 'We obtain emission factors',
    kind: 'auto',
    description:
      'Regional half-hourly grid carbon intensity from NESO for the meter outcode, and the DESNZ natural gas conversion factor, each recorded as an external Origin step.',
    references: [
      { label: 'NESO Carbon Intensity API', url: 'https://carbon-intensity.github.io/api-definitions/' },
      { label: 'DESNZ conversion factors', url: 'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting' },
    ],
  },
  {
    id: 'calculate',
    title: 'We calculate monthly emissions',
    kind: 'auto',
    description:
      'Half-hourly consumption × the matching factor, summed into whole calendar months across all meters, recorded as Process steps.',
    references: [{ label: 'CAP guide: emissions calculation', url: GUIDE }],
  },
  {
    id: 'report',
    title: 'We create the emissions report for the FSP',
    kind: 'auto',
    description:
      'A report prepared for the named FSP only, with a Transfer step to that FSP added to the signed provenance record.',
    references: [
      { label: 'Emissions report standard', url: 'https://registry.core.sandbox.trust.ib1.org/scheme/perseus/api/emissions-data@2026-03-12.json' },
    ],
  },
]

export const stepIndex = (id: StepId) => STEPS.findIndex((s) => s.id === id)
