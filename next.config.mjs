/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { isServer, webpack }) {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    };
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    // Verovio's ESM build contains Node-only branches (import "node:module" etc.)
    // that webpack cannot resolve for the browser. Ignore those imports — the
    // runtime branches are gated behind ENVIRONMENT_IS_NODE so they never run.
    if (!isServer) {
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^node:(module|fs|path|url|crypto)$/,
        }),
      );
    }
    return config;
  },
};

export default nextConfig;
