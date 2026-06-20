'use strict';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Parses a GitHub repository URL (or "owner/repo" shorthand) into its owner and
 * repo parts.
 *
 * Accepts forms such as:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - git@github.com:owner/repo.git
 *   - owner/repo
 *
 * @param {string} repoUrl - The repository URL or shorthand.
 * @returns {{ owner: string, repo: string }}
 * @throws {Error} If the value cannot be parsed into owner/repo.
 */
function parseRepoUrl(repoUrl) {
  if (!repoUrl || typeof repoUrl !== 'string') {
    throw new Error('Missing target repository URL. Set the TARGET_REPO_URL setting.');
  }

  const trimmed = repoUrl.trim().replace(/\/+$/, '').replace(/\.git$/, '');

  // git@github.com:owner/repo
  const sshMatch = trimmed.match(/^git@[^:]+:([^/]+)\/(.+)$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // https://github.com/owner/repo (any host)
  const urlMatch = trimmed.match(/^https?:\/\/[^/]+\/([^/]+)\/(.+)$/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  // owner/repo shorthand
  const shorthandMatch = trimmed.match(/^([^/]+)\/([^/]+)$/);
  if (shorthandMatch) {
    return { owner: shorthandMatch[1], repo: shorthandMatch[2] };
  }

  throw new Error(`Could not parse owner/repo from TARGET_REPO_URL: "${repoUrl}"`);
}

/**
 * Triggers a workflow_dispatch event on a GitHub Actions workflow in another
 * repository.
 *
 * @param {object} options
 * @param {string} options.token - GitHub token with permission to dispatch workflows.
 * @param {string} options.owner - Target repository owner.
 * @param {string} options.repo - Target repository name.
 * @param {string} options.workflowFile - Workflow file name (e.g. "ci.yml") or workflow id.
 * @param {string} options.ref - Git ref (branch or tag) to run the workflow on.
 * @param {object} [options.inputs] - Optional workflow_dispatch inputs.
 * @returns {Promise<void>} Resolves when GitHub accepts the dispatch (HTTP 204).
 * @throws {Error} If a required value is missing or GitHub returns a non-2xx response.
 */
async function triggerWorkflowDispatch({ token, owner, repo, workflowFile, ref, inputs }) {
  if (!token) {
    throw new Error('Missing GitHub token. Set the TARGET_GITHUB_TOKEN setting.');
  }
  if (!workflowFile) {
    throw new Error('Missing workflow file. Set the TARGET_WORKFLOW_FILE setting.');
  }
  if (!ref) {
    throw new Error('Missing workflow ref. Set the TARGET_WORKFLOW_REF setting.');
  }

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(
    workflowFile
  )}/dispatches`;

  const body = { ref };
  if (inputs && typeof inputs === 'object') {
    body.inputs = inputs;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'github-discord-bot',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  // A successful workflow dispatch returns 204 No Content.
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `GitHub workflow dispatch returned ${response.status} ${response.statusText}: ${text}`
    );
  }
}

module.exports = { parseRepoUrl, triggerWorkflowDispatch };
