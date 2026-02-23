export interface IssueIdentifier {
  owner: string
  repo: string
  issueNumber: number
}

export interface CommentIdentifier extends IssueIdentifier {
  commentId: number
}

/**
 * Creates a session key from issue identification.
 * Format: "owner/repo#issue:123"
 */
export function sessionKeyFromIssue({ owner, repo, issueNumber }: IssueIdentifier): string {
  return `${owner}/${repo}#issue:${issueNumber}`
}

/**
 * Creates a source reference from comment identification.
 * Format: "owner/repo#issue:123#comment:456"
 */
export function sourceRefFromComment({
  owner,
  repo,
  issueNumber,
  commentId,
}: CommentIdentifier): string {
  return `${owner}/${repo}#issue:${issueNumber}#comment:${commentId}`
}
