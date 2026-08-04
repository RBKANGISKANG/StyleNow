/** @type {import('next').NextConfig} */
const nextConfig = {
  // The domain layer is consumed as TypeScript source straight from the
  // workspace — no build step, no drift between API and web.
  transpilePackages: ['@stylenow/api', '@stylenow/shared'],
  webpack: (config) => {
    // The API package uses NodeNext resolution ("./x.js" specifiers for .ts
    // sources); teach webpack the same mapping.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
