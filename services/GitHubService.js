const axios  = require('axios');
const { logger } = require('../logger');

const GITHUB_API = 'https://api.github.com';

/**
 * Serviço de integração com a API do GitHub.
 *
 * Usado pelo QA Orchestrator (Fase 3) para:
 *   - Criar branches de autofix
 *   - Aplicar patches em arquivos
 *   - Abrir PRs automáticos
 *   - Limpar branches após falha de validação
 *
 * Env vars necessárias:
 *   GITHUB_TOKEN         — Personal Access Token (repo + pull_request scopes)
 *   GITHUB_REPO_OWNER    — Dono do repositório (org ou usuário)
 *   GITHUB_REPO_NAME     — Nome do repositório
 *   GITHUB_MAIN_BRANCH   — Branch base (default: 'main')
 */
class GitHubService {
  constructor() {
    this.token      = process.env.GITHUB_TOKEN;
    this.owner      = process.env.GITHUB_REPO_OWNER || 'eloscloud';
    this.repo       = process.env.GITHUB_REPO_NAME  || 'eloscloud';
    this.mainBranch = process.env.GITHUB_MAIN_BRANCH || 'main';
  }

  _isConfigured() {
    return !!(this.token && this.owner && this.repo);
  }

  _headers() {
    return {
      Authorization:  `Bearer ${this.token}`,
      Accept:         'application/vnd.github.v3+json',
      'User-Agent':   'ElosCloud-QA-Bot/1.0',
      'Content-Type': 'application/json',
    };
  }

  /**
   * Retorna o SHA do HEAD da branch principal.
   */
  async getMainBranchSHA() {
    const res = await axios.get(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/git/ref/heads/${this.mainBranch}`,
      { headers: this._headers() }
    );
    return res.data.object.sha;
  }

  /**
   * Cria uma branch nova a partir do HEAD da main.
   *
   * @param {string} branchName
   * @returns {Promise<string>} nome da branch criada
   */
  async createBranch(branchName) {
    const sha = await this.getMainBranchSHA();
    await axios.post(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/git/refs`,
      { ref: `refs/heads/${branchName}`, sha },
      { headers: this._headers() }
    );
    logger.info('GitHubService: branch criada', {
      service: 'GitHubService', branchName,
    });
    return branchName;
  }

  /**
   * Retorna o conteúdo atual de um arquivo no repositório.
   *
   * @param {string} filePath    - caminho relativo ao root do repo (ex: "backend/models/Foo.js")
   * @param {string} [branchName] - branch específica; usa main se omitido
   * @returns {Promise<{ content: string, sha: string }>}
   */
  async getFileContent(filePath, branchName = null) {
    const params = branchName ? { ref: branchName } : {};
    const res = await axios.get(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/contents/${filePath}`,
      { headers: this._headers(), params }
    );
    return {
      content: Buffer.from(res.data.content, 'base64').toString('utf-8'),
      sha:     res.data.sha,
    };
  }

  /**
   * Atualiza o conteúdo de um arquivo em uma branch específica.
   *
   * @param {string} branchName
   * @param {string} filePath
   * @param {string} newContent    - conteúdo completo do arquivo pós-patch
   * @param {string} originalSha   - SHA atual do arquivo (obrigatório pelo GitHub API)
   * @param {string} commitMessage
   */
  async updateFile(branchName, filePath, newContent, originalSha, commitMessage) {
    await axios.put(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/contents/${filePath}`,
      {
        message: commitMessage,
        content: Buffer.from(newContent).toString('base64'),
        sha:     originalSha,
        branch:  branchName,
      },
      { headers: this._headers() }
    );
    logger.info('GitHubService: arquivo atualizado', {
      service: 'GitHubService', branchName, filePath,
    });
  }

  /**
   * Abre um Pull Request de autofix.
   *
   * @param {string} branchName
   * @param {object} fix
   * @param {string} fix.flowId
   * @param {string} fix.stepId
   * @param {string} fix.description   - título curto do fix
   * @param {string} fix.explanation   - descrição longa para o body do PR
   * @param {object} fix.patch         - { oldCode, newCode }
   * @returns {Promise<string>} URL do PR criado
   */
  async openPR(branchName, fix) {
    const body = [
      '## Bug detectado automaticamente pelo QA Orchestrator',
      '',
      fix.explanation,
      '',
      '### Patch aplicado',
      '```diff',
      `- ${fix.patch.oldCode.split('\n').join('\n- ')}`,
      `+ ${fix.patch.newCode.split('\n').join('\n+ ')}`,
      '```',
      '',
      `**Flow:** \`${fix.flowId}\`  |  **Step:** \`${fix.stepId}\``,
      '',
      '> 🤖 Gerado automaticamente pelo QA Orchestrator — revisar antes de fazer merge.',
    ].join('\n');

    const res = await axios.post(
      `${GITHUB_API}/repos/${this.owner}/${this.repo}/pulls`,
      {
        title: `[QA-Auto] Fix: ${fix.flowId}/${fix.stepId} — ${fix.description}`,
        body,
        head:  branchName,
        base:  this.mainBranch,
      },
      { headers: this._headers() }
    );

    logger.info('GitHubService: PR aberto', {
      service: 'GitHubService', prUrl: res.data.html_url, branchName,
    });
    return res.data.html_url;
  }

  /**
   * Deleta uma branch (cleanup em caso de falha de validação).
   *
   * @param {string} branchName
   */
  async deleteBranch(branchName) {
    try {
      await axios.delete(
        `${GITHUB_API}/repos/${this.owner}/${this.repo}/git/refs/heads/${branchName}`,
        { headers: this._headers() }
      );
      logger.info('GitHubService: branch deletada', {
        service: 'GitHubService', branchName,
      });
    } catch (err) {
      // Não é crítico — loga e segue
      logger.warn('GitHubService: falha ao deletar branch', {
        service: 'GitHubService', branchName, error: err.message,
      });
    }
  }

  /**
   * Cria uma branch, aplica o patch no arquivo indicado e retorna o nome da branch.
   * Lança erro se o patch não for aplicável (oldCode não encontrado no arquivo).
   *
   * @param {object} fix - objeto de fix gerado pelo QAOrchestratorService
   * @returns {Promise<string>} nome da branch criada
   */
  async createBranchWithFix(fix) {
    const slug       = `${fix.flowId}-${fix.stepId}`.replace(/[^a-z0-9-]/gi, '-');
    const branchName = `qa/autofix-${slug}-${Date.now()}`;

    await this.createBranch(branchName);

    const { content: currentContent, sha } = await this.getFileContent(
      fix.filePath, branchName
    );

    if (!currentContent.includes(fix.patch.oldCode)) {
      await this.deleteBranch(branchName);
      throw new Error(
        `GitHubService: patch não aplicável — oldCode não encontrado em ${fix.filePath}`
      );
    }

    const patchedContent = currentContent.replace(fix.patch.oldCode, fix.patch.newCode);

    await this.updateFile(
      branchName,
      fix.filePath,
      patchedContent,
      sha,
      `[QA-Auto] Fix ${fix.flowId}/${fix.stepId}: ${fix.description}`
    );

    return branchName;
  }
}

module.exports = new GitHubService();
