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

/**
 * Lists branches for a repository sorted by most recent commit activity.
 *
 * @param {object} options
 * @param {string} options.token - GitHub token.
 * @param {string} options.owner - Repository owner.
 * @param {string} options.repo - Repository name.
 * @param {string} [options.filter] - Optional substring filter applied to branch names.
 * @returns {Promise<string[]>} Branch names, most recently active first, capped at 25.
 */
async function listBranches({ token, owner, repo, filter = '' }) {
  if (!token) {
    throw new Error('Missing GitHub token. Set the TARGET_GITHUB_TOKEN setting.');
  }

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/branches?per_page=100`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'github-discord-bot',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub branches API returned ${response.status} ${response.statusText}: ${text}`);
  }

  const branches = await response.json();
  const lowerFilter = filter.toLowerCase();

  return branches
    .filter(b => !lowerFilter || b.name.toLowerCase().includes(lowerFilter))
    .sort((a, b) => {
      const dateA = new Date(a.commit.commit.author.date);
      const dateB = new Date(b.commit.commit.author.date);
      return dateB - dateA;
    })
    .map(b => b.name)
    .slice(0, 25);
}

/**
 * Lists issues for a repository filtered by state and creation/close date.
 *
 * @param {object} options
 * @param {string} options.token - GitHub token.
 * @param {string} options.owner - Repository owner.
 * @param {string} options.repo - Repository name.
 * @param {'open'|'closed'} options.state - Issue state to filter by.
 * @param {number} options.days - Number of days to look back.
 * @returns {Promise<Array<{number: number, title: string, html_url: string, created_at: string, closed_at: string|null}>>}
 */
async function listIssues({ token, owner, repo, state, days }) {
  if (!token) {
    throw new Error('Missing GitHub token. Set the TARGET_GITHUB_TOKEN setting.');
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?state=${state}&since=${since}&per_page=100&sort=created&direction=desc`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'github-discord-bot',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub issues API returned ${response.status} ${response.statusText}: ${text}`);
  }

  const issues = await response.json();
  // Exclude pull requests (GitHub issues API returns PRs too)
  const filtered = issues.filter(i => !i.pull_request);

  if (state === 'closed') {
    // For closed issues, filter by closed_at within the window
    const sinceDate = new Date(since);
    return filtered.filter(i => i.closed_at && new Date(i.closed_at) >= sinceDate);
  }

  return filtered;
}

/**
 * Fetches the latest successful run of a workflow.
 *
 * @param {object} options
 * @param {string} options.token - GitHub token.
 * @param {string} options.owner - Repository owner.
 * @param {string} options.repo - Repository name.
 * @param {string} options.workflowFile - Workflow file name (e.g. "deploy.yml") or workflow id.
 * @returns {Promise<{id: number, head_commit: {sha: string, message: string}, head_branch: string, status: string, conclusion: string, created_at: string}|null>}
 */
async function getLatestSuccessfulWorkflowRun({ token, owner, repo, workflowFile }) {
  if (!token) {
    throw new Error('Missing GitHub token. Set the TARGET_GITHUB_TOKEN setting.');
  }
  if (!workflowFile) {
    throw new Error('Missing workflow file. Set the TARGET_WORKFLOW_FILE setting.');
  }

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(
    workflowFile
  )}/runs?status=completed&conclusion=success&per_page=1&sort=created&direction=desc`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'github-discord-bot',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub workflow runs API returned ${response.status} ${response.statusText}: ${text}`);
  }

  const data = await response.json();
  const run = data.workflow_runs?.[0];

  if (!run) {
    return null;
  }

  return {
    id: run.id,
    head_commit: run.head_commit,
    head_branch: run.head_branch,
    status: run.status,
    conclusion: run.conclusion,
    created_at: run.created_at,
  };
}

/**
 * Gets the commit SHA for a branch.
 *
 * @param {object} options
 * @param {string} options.token - GitHub token.
 * @param {string} options.owner - Repository owner.
 * @param {string} options.repo - Repository name.
 * @param {string} options.branch - Branch name.
 * @returns {Promise<string>} The commit SHA for the branch.
 */
async function getBranchCommitSha({ token, owner, repo, branch }) {
  if (!token) {
    throw new Error('Missing GitHub token. Set the TARGET_GITHUB_TOKEN setting.');
  }

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'github-discord-bot',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub branch API returned ${response.status} ${response.statusText}: ${text}`);
  }

  const data = await response.json();
  return data.commit.sha;
}

/**
 * Compares two commits and returns the commits between them.
 *
 * @param {object} options
 * @param {string} options.token - GitHub token.
 * @param {string} options.owner - Repository owner.
 * @param {string} options.repo - Repository name.
 * @param {string} options.base - Base commit SHA (the "deployed" version).
 * @param {string} options.head - Head commit SHA (usually main).
 * @returns {Promise<Array<{sha: string, message: string, html_url: string, author: {login: string}}>>}
 */
async function compareCommits({ token, owner, repo, base, head }) {
  if (!token) {
    throw new Error('Missing GitHub token. Set the TARGET_GITHUB_TOKEN setting.');
  }

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'github-discord-bot',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub compare API returned ${response.status} ${response.statusText}: ${text}`);
  }

  const data = await response.json();

  return (data.commits || []).map(commit => ({
    sha: commit.sha.substring(0, 7),
    message: commit.commit.message.split('\n')[0],
    html_url: commit.html_url,
    author: { login: commit.author?.login || commit.commit.author.name },
  }));
}

module.exports = { parseRepoUrl, triggerWorkflowDispatch, listBranches, listIssues, getLatestSuccessfulWorkflowRun, getBranchCommitSha, compareCommits };
