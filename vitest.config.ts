import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/src/**/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/generated/**'],
    testTimeout: 30_000,
    // Os testes de integração compartilham um único MySQL e limpam tabelas entre
    // si. Rodar arquivos em paralelo faria um teste apagar o estado do outro.
    fileParallelism: false,
    // Banco separado do de desenvolvimento: sem isso, rodar a suite apagava as
    // contas e as conversas da demonstracao, e nada avisava.
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: ['./vitest.global-setup.ts'],
  },
})
