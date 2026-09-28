import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // mTLS, file-backed sessions and signing all need Node APIs, so keep these
  // packages out of the bundler and load them at runtime.
  serverExternalPackages: ['undici', '@peculiar/x509'],
}

export default nextConfig
