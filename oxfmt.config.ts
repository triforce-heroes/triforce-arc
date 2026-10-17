import baseConfig from "@rheactor/rheactor-oxc-config/oxfmt";

const config = {
  ...baseConfig,
  ignorePatterns: [...(baseConfig.ignorePatterns ?? []), "workspace/**"],
};

export default config;
