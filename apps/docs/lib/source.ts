import { docs } from '@/.source'
import { createMDXSource } from 'fumadocs-mdx'
import { loader } from 'fumadocs-core/source'

// fumadocs-mdx@11 returns `files` as a function, but fumadocs-core@15
// expects `files` as an array.  Unwrap the function to bridge the mismatch.
const mdxSource = createMDXSource(
  docs.docs as Parameters<typeof createMDXSource>[0],
  docs.meta as Parameters<typeof createMDXSource>[1]
)
const files =
  typeof mdxSource.files === 'function'
    ? (mdxSource.files as unknown as () => typeof mdxSource.files)()
    : mdxSource.files

export const source = loader({
  baseUrl: '/',
  source: { files },
})
