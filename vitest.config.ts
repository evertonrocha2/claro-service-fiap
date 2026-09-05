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
    // Base vazia antes e depois da suite. Sem seed, esse e o estado esperado do
    // banco de desenvolvimento quando ninguem esta rodando teste.
    globalSetup: ['./vitest.global-setup.ts'],
  },
})
