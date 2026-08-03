'use strict';

/**
 * ContractPdfGenerator.js
 *
 * Gera o PDF de contratos de empréstimo (bilateral e multilateral) usando pdfkit.
 * Retorna um Buffer com o PDF em memória (sem escrita em disco).
 *
 * Design:
 *  - Usa pdfkit para evitar dependência de browser/puppeteer (memória limitada no Fly.io)
 *  - PDF em memória → criptografado pelo contractStorageHelper antes do upload
 *  - Fontes embutidas (sem dependência de fontes do sistema)
 *
 * Autor: infra-agent
 * Data: 2026-05-18
 */

const PDFDocument = require('pdfkit');

/**
 * Formata valor monetário em BRL.
 * @param {number} value
 * @returns {string} ex: "R$ 1.500,00"
 */
function _brl(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/**
 * Formata data no padrão brasileiro.
 * @param {string|Date} date
 */
function _dataBR(date) {
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric'
  });
}

/**
 * Gera o PDF de um contrato bilateral (Tipo 1: tomador + admin).
 *
 * @param {object} data
 * @param {object} data.loan          — { id, valor, parcelas, taxaJuros, dataVencimento }
 * @param {object} data.caixinha      — { id, nome }
 * @param {object} data.borrower      — { id, nome, email, cpf_last4? }
 * @param {object} data.approver      — { id, nome, email } — admin da caixinha
 * @param {string} data.contractId
 * @param {Date}   data.generatedAt
 * @returns {Promise<Buffer>}
 */
async function generateBilateralPdf(data) {
  const { loan, caixinha, borrower, approver, contractId, generatedAt } = data;
  return _buildPdf((doc) => {
    _addHeader(doc, 'CONTRATO DE EMPRÉSTIMO', contractId, generatedAt);

    doc.moveDown();
    _section(doc, '1. PARTES');
    doc.fontSize(11).text(
      `TOMADOR: ${borrower.nome} — ${borrower.email}` +
      (borrower.cpf_last4 ? ` (CPF: ***-${borrower.cpf_last4})` : '')
    );
    doc.text(`CREDOR/AUTORIZADOR: ${approver.nome} — ${approver.email}`);
    doc.text(`CAIXINHA: ${caixinha.nome} (ID: ${caixinha.id})`);

    doc.moveDown();
    _section(doc, '2. OBJETO');
    doc.fontSize(11).text(
      `O TOMADOR solicita e o AUTORIZADOR, na qualidade de administrador da Caixinha ` +
      `"${caixinha.nome}", aprova o empréstimo no valor de ${_brl(loan.valor)}, ` +
      `a ser pago em ${loan.parcelas} parcela(s), com taxa de juros de ${loan.taxaJuros}% ao mês.`
    );

    doc.moveDown();
    _section(doc, '3. CONDIÇÕES DE PAGAMENTO');
    doc.fontSize(11).text(`Valor total: ${_brl(loan.valor)}`);
    doc.text(`Número de parcelas: ${loan.parcelas}`);
    doc.text(`Taxa de juros: ${loan.taxaJuros}% ao mês`);
    doc.text(`Data de vencimento da primeira parcela: ${_dataBR(loan.dataVencimento)}`);

    _clausulaSaida(doc, '4');
    _clausulaPlataforma(doc, '5');
    _clausulaForo(doc, '6');

    _addSignatureBlock(doc, [
      { label: 'TOMADOR', nome: borrower.nome, email: borrower.email },
      { label: 'AUTORIZADOR (Admin da Caixinha)', nome: approver.nome, email: approver.email },
    ], generatedAt);
  });
}

/**
 * Gera o PDF de um contrato multilateral (Tipo 2: tomador + N membros).
 *
 * @param {object} data
 * @param {object} data.loan
 * @param {object} data.caixinha
 * @param {object} data.borrower
 * @param {object[]} data.members     — [{ id, nome, email }] — membros votantes
 * @param {string} data.contractId
 * @param {Date}   data.generatedAt
 * @returns {Promise<Buffer>}
 */
async function generateMultilateralPdf(data) {
  const { loan, caixinha, borrower, members, contractId, generatedAt } = data;
  return _buildPdf((doc) => {
    _addHeader(doc, 'CONTRATO DE EMPRÉSTIMO COLETIVO', contractId, generatedAt);

    doc.moveDown();
    _section(doc, '1. PARTES');
    doc.fontSize(11).text(
      `TOMADOR: ${borrower.nome} — ${borrower.email}` +
      (borrower.cpf_last4 ? ` (CPF: ***-${borrower.cpf_last4})` : '')
    );
    doc.text(`CAIXINHA: ${caixinha.nome} (ID: ${caixinha.id})`);
    doc.moveDown(0.5);
    doc.text('MEMBROS DO GRUPO (todos os abaixo assinam como credores solidários):');
    members.forEach((m, i) => doc.text(`  ${i + 1}. ${m.nome} — ${m.email}`));

    doc.moveDown();
    _section(doc, '2. OBJETO');
    doc.fontSize(11).text(
      `O TOMADOR solicita e os MEMBROS, em votação coletiva com quorum atingido conforme ` +
      `as regras da Caixinha "${caixinha.nome}", aprovam o empréstimo no valor de ` +
      `${_brl(loan.valor)}, a ser pago em ${loan.parcelas} parcela(s), ` +
      `com taxa de juros de ${loan.taxaJuros}% ao mês.`
    );

    doc.moveDown();
    _section(doc, '3. CONDIÇÕES DE PAGAMENTO');
    doc.fontSize(11).text(`Valor total: ${_brl(loan.valor)}`);
    doc.text(`Número de parcelas: ${loan.parcelas}`);
    doc.text(`Taxa de juros: ${loan.taxaJuros}% ao mês`);
    doc.text(`Data de vencimento da primeira parcela: ${_dataBR(loan.dataVencimento)}`);

    doc.moveDown();
    _section(doc, '4. SAÍDA DE MEMBRO');
    doc.fontSize(11).text(
      'Caso um MEMBRO signatário deste contrato solicite saída da Caixinha antes da ' +
      'quitação total do empréstimo pelo TOMADOR, o presente contrato será cancelado e ' +
      'um novo contrato será gerado com os membros remanescentes. O membro que solicitar ' +
      'saída deverá regularizar quaisquer pendências financeiras com a Caixinha antes ' +
      'da efetivação da saída, podendo utilizar seu saldo disponível na Caixinha ou ' +
      'realizar pagamento via boleto ou cartão de crédito.'
    );

    _clausulaPlataforma(doc, '5');
    _clausulaForo(doc, '6');

    _addSignatureBlock(doc, [
      { label: 'TOMADOR', nome: borrower.nome, email: borrower.email },
      ...members.map(m => ({ label: 'MEMBRO', nome: m.nome, email: m.email })),
    ], generatedAt);
  });
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function _buildPdf(fillFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      fillFn(doc);
    } catch (err) {
      reject(err);
      return;
    }

    doc.end();
  });
}

function _addHeader(doc, title, contractId, generatedAt) {
  doc
    .fontSize(18).font('Helvetica-Bold')
    .text('ElosCloud', { align: 'center' })
    .moveDown(0.3)
    .fontSize(15)
    .text(title, { align: 'center' })
    .moveDown(0.3)
    .fontSize(9).font('Helvetica')
    .text(`Contrato ID: ${contractId}`, { align: 'center' })
    .text(`Gerado em: ${_dataBR(generatedAt)}`, { align: 'center' })
    .moveTo(60, doc.y + 8).lineTo(doc.page.width - 60, doc.y + 8).stroke()
    .moveDown(1);
}

function _section(doc, title) {
  doc.fontSize(12).font('Helvetica-Bold').text(title).font('Helvetica').moveDown(0.3);
}

function _clausulaSaida(doc, num) {
  doc.moveDown();
  _section(doc, `${num}. SAÍDA DA CAIXINHA`);
  doc.fontSize(11).text(
    'Na hipótese de o TOMADOR solicitar saída da Caixinha antes da quitação total do ' +
    'empréstimo, todas as parcelas vincendas tornam-se imediatamente exigíveis. O valor ' +
    'poderá ser compensado com o saldo disponível do TOMADOR na Caixinha ou liquidado ' +
    'via boleto bancário ou cartão de crédito.'
  );
}

function _clausulaPlataforma(doc, num) {
  doc.moveDown();
  _section(doc, `${num}. PLATAFORMA`);
  doc.fontSize(11).text(
    'A ElosCloud atua exclusivamente como plataforma tecnológica, não sendo parte neste ' +
    'contrato, não respondendo por inadimplência, ilicitude ou quaisquer danos decorrentes ' +
    'das obrigações aqui assumidas pelas partes.'
  );
}

function _clausulaForo(doc, num) {
  doc.moveDown();
  _section(doc, `${num}. FORO`);
  doc.fontSize(11).text(
    'As partes elegem o foro da Comarca de São Paulo/SP para dirimir quaisquer controvérsias ' +
    'oriundas deste instrumento, renunciando a qualquer outro, por mais privilegiado que seja.'
  );
}

function _addSignatureBlock(doc, parties, generatedAt) {
  doc.moveDown(2);
  doc
    .fontSize(10).font('Helvetica')
    .text(`São Paulo, ${_dataBR(generatedAt)}`, { align: 'center' })
    .moveDown(1);

  parties.forEach(p => {
    doc
      .moveTo(doc.page.width / 2 - 100, doc.y)
      .lineTo(doc.page.width / 2 + 100, doc.y)
      .stroke()
      .moveDown(0.3)
      .text(`${p.label}: ${p.nome}`, { align: 'center' })
      .text(p.email, { align: 'center' })
      .moveDown(1.5);
  });

  doc.moveDown();
  doc.fontSize(8).fillColor('grey')
    .text(
      'Este documento foi assinado eletronicamente via Clicksign, conforme a Lei 14.063/2020 ' +
      '(Art. 4º, II — assinatura eletrônica avançada). A autenticidade pode ser verificada ' +
      'pelo código do documento no Clicksign.',
      { align: 'center' }
    );
}

module.exports = { generateBilateralPdf, generateMultilateralPdf };
