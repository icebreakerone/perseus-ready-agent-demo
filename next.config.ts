import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // A self-contained server for the container image.
  output: 'standalone',
  // mTLS, file-backed sessions and signing all need Node APIs, so keep these
  // packages out of the bundler and load them at runtime.
  serverExternalPackages: ['undici', '@peculiar/x509'],
}

export default nextConfig
