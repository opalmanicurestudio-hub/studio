import type {NextConfig} from 'next';
const nextConfig: NextConfig = {
  /* config options here */
  productionBrowserSourceMaps: true,
  // TEMPORARY (front desk crash): browser code is left unshortened so an error names the real value and function.
  // Remove once the /pos crash is fixed — it makes the downloaded files larger.
  webpack: (config: any, { dev, isServer }: { dev: boolean; isServer: boolean }) => { if (!dev && !isServer) config.optimization.minimize = false; return config; },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'api.qrserver.com',
        port: '',
        pathname: '/**',
      },
      // Uploaded product photos live in Firebase Storage. next/image refuses
      // to optimize a host that isn't listed here and answers 400 instead —
      // which is why every uploaded image rendered as a broken icon while
      // stock/demo images kept working.
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};
export default nextConfig;
