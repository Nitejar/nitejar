import { source } from '@/lib/source'
import { DocsPage, DocsBody, DocsDescription, DocsTitle } from 'fumadocs-ui/page'
import { notFound } from 'next/navigation'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { ComponentType } from 'react'

interface PageProps {
  params: Promise<{ slug?: string[] }>
}

export default async function Page(props: PageProps) {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  const pageData = page.data as typeof page.data & {
    body: ComponentType<{ components?: Record<string, unknown> }>
    toc: unknown
  }
  const MDX = pageData.body

  return (
    <DocsPage toc={pageData.toc as never}>
      <DocsTitle>{pageData.title}</DocsTitle>
      <DocsDescription>{pageData.description}</DocsDescription>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents }} />
      </DocsBody>
    </DocsPage>
  )
}

export async function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: PageProps) {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  const ogParams = new URLSearchParams({ variant: 'docs' })
  if (page.data.title) ogParams.set('title', page.data.title)
  if (page.data.description) ogParams.set('description', page.data.description)
  const ogImage = `https://nitejar.dev/api/og?${ogParams.toString()}`

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image' as const,
      title: page.data.title,
      description: page.data.description,
      images: [ogImage],
    },
  }
}
