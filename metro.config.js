// Expo Metro config with one surgical override: resolve `plist` to its Node
// build instead of its browser build. The browser build parses XML via the
// global `DOMParser`, which Hermes doesn't provide (login fails with
// "malformed document. First element should be <plist>"); the Node build uses
// pure-JS @xmldom/xmldom, which works in Hermes. Scoped to `plist` only.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const PLIST_NODE_BUILD = path.resolve(__dirname, 'node_modules/plist/dist/index.js');
const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'plist') {
    return { type: 'sourceFile', filePath: PLIST_NODE_BUILD };
  }
  const resolve = upstreamResolveRequest || context.resolveRequest;
  return resolve(context, moduleName, platform);
};

module.exports = config;
