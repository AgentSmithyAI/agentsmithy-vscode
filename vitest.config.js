'use strict';
Object.defineProperty(exports, '__esModule', {value: true});
const config_1 = require('vitest/config');
exports.default = (0, config_1.defineConfig)({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: true,
    reporters: 'default',
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html'],
    },
  },
  esbuild: {
    target: 'es2022',
  },
});
//# sourceMappingURL=vitest.config.js.map
