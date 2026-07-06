import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    environmentMatchGlobs: [
      ['bonario-server/**', 'node'],
      ['bonario-frontend/**', 'happy-dom']
    ]
  }
});