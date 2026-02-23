import { createGitHubClient } from '@nitejar/connectors-github'
import type { GitHubConfig } from './types'

/** Attachment shape compatible with WorkItemAttachment (avoids cross-package dep) */
export interface GitHubImageAttachment {
  type: 'image'
  dataUrl: string
  mimeType: string
  fileSize: number
}

interface ExtractionContext {
  config: GitHubConfig
  installationId: number
  owner: string
  repo: string
}

const MAX_GITHUB_IMAGES = 3
const MAX_GITHUB_IMAGE_BYTES = 2 * 1024 * 1024 // 2 MB

const IMG_SRC_REGEX = /<img\s[^>]*src="([^"]+)"[^>]*>/gi
const GITHUB_CONTENT_HOST = /\.githubusercontent\.com$/

function createOctokit(ctx: ExtractionContext) {
  if (ctx.config.appId && ctx.config.privateKey && ctx.installationId) {
    return createGitHubClient({
      appId: ctx.config.appId,
      privateKey: ctx.config.privateKey,
      installationId: ctx.installationId,
    })
  }
  return null
}

function extractImageUrls(html: string): string[] {
  const urls: string[] = []
  let match: RegExpExecArray | null
  while ((match = IMG_SRC_REGEX.exec(html)) !== null) {
    const src = match[1]!
    try {
      const host = new URL(src).hostname
      if (GITHUB_CONTENT_HOST.test(host)) {
        urls.push(src)
      }
    } catch {
      // skip malformed URLs
    }
  }
  return urls.slice(0, MAX_GITHUB_IMAGES)
}

async function downloadAsDataUrl(
  url: string
): Promise<{ dataUrl: string; mimeType: string; fileSize: number } | null> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) return null

  const contentLength = response.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_GITHUB_IMAGE_BYTES) {
    return null
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_GITHUB_IMAGE_BYTES) return null

  const mimeType = response.headers.get('content-type') || 'image/png'
  const base64 = buffer.toString('base64')
  return {
    dataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
    fileSize: buffer.byteLength,
  }
}

/**
 * Fetch body_html for a GitHub issue comment and extract embedded images
 * as base64 data URLs.
 */
export async function extractImagesFromComment(
  ctx: ExtractionContext,
  issueNumber: number,
  commentId: number
): Promise<GitHubImageAttachment[]> {
  const octokit = createOctokit(ctx)
  if (!octokit) return []

  const { data } = await octokit.issues.getComment({
    owner: ctx.owner,
    repo: ctx.repo,
    comment_id: commentId,
    mediaType: { format: 'full' },
  })

  const bodyHtml = (data as Record<string, unknown>).body_html as string | undefined
  if (!bodyHtml) return []

  return downloadImages(extractImageUrls(bodyHtml))
}

/**
 * Fetch body_html for a GitHub issue and extract embedded images
 * as base64 data URLs.
 */
export async function extractImagesFromIssue(
  ctx: ExtractionContext,
  issueNumber: number
): Promise<GitHubImageAttachment[]> {
  const octokit = createOctokit(ctx)
  if (!octokit) return []

  const { data } = await octokit.issues.get({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: issueNumber,
    mediaType: { format: 'full' },
  })

  const bodyHtml = (data as Record<string, unknown>).body_html as string | undefined
  if (!bodyHtml) return []

  return downloadImages(extractImageUrls(bodyHtml))
}

async function downloadImages(urls: string[]): Promise<GitHubImageAttachment[]> {
  const attachments: GitHubImageAttachment[] = []
  for (const url of urls) {
    try {
      const result = await downloadAsDataUrl(url)
      if (result) {
        attachments.push({
          type: 'image',
          dataUrl: result.dataUrl,
          mimeType: result.mimeType,
          fileSize: result.fileSize,
        })
      }
    } catch {
      // best-effort: skip individual failures
    }
  }
  return attachments
}
