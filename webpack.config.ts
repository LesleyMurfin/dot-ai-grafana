import type { Configuration } from 'webpack';
import webpack from 'webpack';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

/**
 * Project webpack extension: ship a single AMD module.js with no async chunk files.
 * Grafana 11.4 was 404'ing hashed chunks (e.g. 260.js) under /public/plugins/... even
 * when the files existed on disk; one bundle avoids that failure mode.
 */
const config = async (env: Env): Promise<Configuration> => {
  const base = await grafanaConfig(env);

  base.optimization = {
    ...base.optimization,
    runtimeChunk: false,
    splitChunks: false,
  };

  base.plugins = [
    ...(base.plugins ?? []),
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
  ];

  // Prefer plain [name].js without ?_cache= so only module.js is requested.
  if (base.output) {
    base.output.chunkFilename = '[name].js';
  }

  return base;
};

export default config;
