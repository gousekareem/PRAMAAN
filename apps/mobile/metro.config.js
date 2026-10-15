const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '../..');

/**
 * The shared TypeScript packages live in ../../packages and are compiled by Metro from
 * source (their package.json "react-native" field points at src/index.ts).
 */
const config = {
  watchFolders: [path.join(root, 'packages/event-contracts'), path.join(root, 'packages/validation')],
  resolver: {
    extraNodeModules: {
      '@pramaan/event-contracts': path.join(root, 'packages/event-contracts'),
      '@pramaan/validation': path.join(root, 'packages/validation'),
    },
    nodeModulesPaths: [path.join(__dirname, 'node_modules')],
    resolverMainFields: ['react-native', 'browser', 'main'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
