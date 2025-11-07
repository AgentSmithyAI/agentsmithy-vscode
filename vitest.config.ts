import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'src/chatWebviewProvider.__tests__/**/*.test.ts'],
    environment: 'node',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    reporters: 'default',
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'json'],
      exclude: [
        'coverage/**',
        'dist/**',
        'out/**',
        '**/node_modules/**',
        '**/__tests__/**',
        '**/mocks/**',
        '*.config.*',
        '*.mjs',
      ],
    },
  },
  esbuild: {
    target: 'es2022',
  },
});
