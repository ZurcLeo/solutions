// Importar dependências
require('dotenv').config();
const crypto = require('crypto');
const secretsManager = require('./secretsManager');
const encryptionService = require('./encryptionService');

async function runTests() {
  console.log('=================================================');
  console.log('TESTE DO SISTEMA DE CRIPTOGRAFIA');
  console.log('=================================================\n');

  // Verificar se temos acesso à chave mestra
  console.log('1. Verificando disponibilidade da chave mestra...');
  try {
    await secretsManager.initialize();
    const isCompatMode = secretsManager.isInCompatibilityMode();
    
    if (isCompatMode) {
      console.log('⚠️  AVISO: Serviço rodando em modo compatibilidade (sem chave mestra)');
      console.log('   As variáveis não serão descriptografadas, mas o sistema continuará funcionando');
    } else {
      console.log('✅ Chave mestra detectada e inicializada com sucesso');
    }
  } catch (error) {
    console.error('❌ Falha ao inicializar gerenciador de segredos:', error.message);
    process.exit(1);
  }

  // Verificar se podemos acessar a chave de criptografia
  console.log('\n2. Verificando acesso à chave de criptografia principal...');
  try {
    const keyName = 'ENCRYPTION_KEY';
    const keyValue = await secretsManager.getSecret(keyName);
    
    if (!keyValue) {
      console.error(`❌ Não foi possível obter a chave ${keyName}`);
      process.exit(1);
    }
    
    // Verificar se é uma chave hex válida
    if (/^[0-9a-f]{64}$/i.test(keyValue)) {
      console.log(`✅ Chave ${keyName} encontrada e validada (formato correto)`);
    } else {
      console.log(`⚠️  AVISO: Chave ${keyName} encontrada mas formato não é o esperado`);
      console.log(`   Formato atual: ${keyValue.substring(0, 10)}... (${keyValue.length} caracteres)`);
      
      if (keyValue.startsWith('ENC:') && secretsManager.isInCompatibilityMode()) {
        console.log('   A chave parece estar criptografada, mas estamos em modo compatibilidade');
        console.log('   Verifique se MASTER_ENCRYPTION_KEY está definida corretamente');
      }
    }
  } catch (error) {
    console.error('❌ Erro ao acessar chave de criptografia:', error.message);
  }

  // Testar o serviço de criptografia diretamente
  console.log('\n3. Teste de criptografia e descriptografia...');
  try {
    // Aguardar inicialização do serviço de criptografia
    await encryptionService.initialized;
    
    // Dados de teste
    const testData = { 
      sensitive: 'informação confidencial', 
      number: 12345, 
      nested: { value: 'teste123' } 
    };
    
    console.log('   Dados originais:', JSON.stringify(testData));
    
    // Criptografar
    const encrypted = await encryptionService.encrypt(testData);
    console.log('   Dados criptografados:', JSON.stringify(encrypted).substring(0, 100) + '...');
    
    // Descriptografar
    const decrypted = await encryptionService.decrypt(encrypted);
    console.log('   Dados descriptografados:', JSON.stringify(decrypted));
    
    // Verificar equivalência
    const isEqual = JSON.stringify(testData) === JSON.stringify(decrypted);
    
    if (isEqual) {
      console.log('✅ Teste de criptografia/descriptografia bem-sucedido!');
    } else {
      console.error('❌ Teste falhou: os dados não coincidem após descriptografia');
      console.log('   Original:', JSON.stringify(testData));
      console.log('   Descriptografado:', JSON.stringify(decrypted));
    }
  } catch (error) {
    console.error('❌ Erro durante teste de criptografia:', error.message);
  }

  // Testar simulação de dados bancários
  console.log('\n4. Teste com dados bancários simulados...');
  try {
    // Simular dados bancários
    const bankData = {
      bankName: 'Banco Teste',
      bankCode: '001',
      accountType: 'checking',
      accountNumber: '1234567890',
      branchCode: '0001',
      holderName: 'Usuario Teste',
      holderDocument: '123.456.789-00'
    };
    
    console.log('   Dados bancários originais:', JSON.stringify(bankData));
    
    // Criptografar
    const encryptedBankData = await encryptionService.encryptBankData(bankData);
    console.log('   Dados bancários criptografados:');
    console.log('   - BankName:', encryptedBankData.bankName);
    console.log('   - LastDigits:', encryptedBankData.lastDigits);
    console.log('   - Dados criptografados:', JSON.stringify(encryptedBankData.encrypted).substring(0, 70) + '...');
    
    // Descriptografar
    const decryptedBankData = await encryptionService.decryptBankData(encryptedBankData);
    console.log('   Dados bancários descriptografados:', JSON.stringify(decryptedBankData));
    
    // Verificar campos importantes
    if (decryptedBankData.accountNumber === bankData.accountNumber && 
        decryptedBankData.holderDocument === bankData.holderDocument) {
      console.log('✅ Teste de criptografia de dados bancários bem-sucedido!');
    } else {
      console.error('❌ Teste de dados bancários falhou: os dados sensíveis não coincidem');
    }
  } catch (error) {
    console.error('❌ Erro durante teste de dados bancários:', error.message);
  }

  console.log('\n=================================================');
  console.log('RESUMO DOS TESTES');
  console.log('=================================================');
  console.log('A próxima etapa é integrar o sistema de criptografia ao');
  console.log('modelo Caixinha para proteger dados financeiros sensíveis.');
}

// Executar os testes
runTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});