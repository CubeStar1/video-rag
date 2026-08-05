import type { NextConfig } from 'next'
import { createMDX } from 'fumadocs-mdx/next'

const nextConfig: NextConfig = {
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: '*',
            },
        ],
    },
}

const withMDX = createMDX()

export default withMDX(nextConfig)
