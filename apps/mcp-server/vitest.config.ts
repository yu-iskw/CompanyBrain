import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/mcp-server',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
