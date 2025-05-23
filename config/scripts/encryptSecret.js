// scripts/encryptSecret.js

const crypto = require('crypto');
const { program } = require('commander');
const { RenderSecretsManager } = require('../../services/secretsManager');

program
  .name('encryptSecret')
  .description('Criptografa um segredo para uso no Render')
  .argument('<plaintext>', 'Valor do segredo em texto claro')
  .requiredOption('-k, --key <key>', 'Chave mestra em formato hexadecimal (32 bytes)')
  .action((plaintext, options) => {
    try {
      if (!/^[0-9a-f]{64}$/i.test(options.key)) {
        console.error('Erro: A chave mestra deve ser uma string hexadecimal de 64 caracteres (32 bytes)');
        process.exit(1);
      }
      
      const encrypted = RenderSecretsManager.encryptForEnvironment(plaintext, options.key);
      
      console.log('\nSegredo criptografado:');
      console.log('------------------------');
      console.log(encrypted);
      console.log('------------------------');
      console.log('\nAdicione esta string como variável de ambiente no Render.');
      console.log('Certifique-se de que a chave mestra MASTER_ENCRYPTION_KEY também esteja definida.');
    } catch (error) {
      console.error('Erro ao criptografar segredo:', error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);