import type { Octokit } from '@octokit/rest'

export interface PostIssueCommentParams {
  owner: string
  repo: string
  issueNumber: number
  body: string
}

/**
 * Posts a comment on a GitHub issue.
 * Works for both issues and pull requests (PRs are issues in GitHub's API).
 */
export async function postIssueComment(
  octokit: Octokit,
  params: PostIssueCommentParams
): Promise<{ id: number; htmlUrl: string }> {
  const response = await octokit.issues.createComment({
    owner: params.owner,
    repo: params.repo,
    issue_number: params.issueNumber,
    body: params.body,
  })

  return {
    id: response.data.id,
    htmlUrl: response.data.html_url,
  }
}
