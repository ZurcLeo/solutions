/** @type {import('jest').Config} */
module.exports = {
  // Padrões de arquivos de teste reais
  testMatch: [
    '**/__tests__/**/*.js',
    '**/*.spec.js',
  ],

  // Excluir node_modules e scripts manuais de validação
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.manual\\.js$',
  ],

  // Não falhar se ainda não houver testes (fase inicial)
  passWithNoTests: true,

  // Ambiente Node.js (sem jsdom)
  testEnvironment: 'node',
};
