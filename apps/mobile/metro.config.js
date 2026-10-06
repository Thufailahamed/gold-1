// Metro config: the app lives in the GoldOS monorepo but installs with npm on
// its own, and consumes the shared domain package straight from source.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "../../packages/shared");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), sharedRoot];

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@goldos/shared") {
    return { type: "sourceFile", filePath: path.join(sharedRoot, "src/index.ts") };
  }
  // packages/shared imports zod; resolve it (and anything else it needs) from
  // this app's node_modules rather than the pnpm store.
  if (context.originModulePath.startsWith(sharedRoot) && !moduleName.startsWith(".")) {
    return (defaultResolve ?? context.resolveRequest)(
      { ...context, originModulePath: path.join(projectRoot, "package.json") },
      moduleName,
      platform
    );
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
