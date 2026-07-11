import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@companybrain/mcp-adapter',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**'],
  },
});
