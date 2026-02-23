import { SlideUp } from './SlideUp'

export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string
  title: string
  description?: string
}) {
  return (
    <div className="mx-auto mb-16 max-w-2xl text-center">
      {eyebrow && (
        <SlideUp>
          <p className="mb-3 font-mono text-sm tracking-widest text-gold-500 uppercase text-halo-strong">
            {eyebrow}
          </p>
        </SlideUp>
      )}
      <SlideUp delay={0.05}>
        <h2 className="font-display text-balance text-4xl text-gold-400 text-halo md:text-5xl">
          {title}
        </h2>
      </SlideUp>
      {description && (
        <SlideUp delay={0.1}>
          <p className="mt-4 text-balance text-lg leading-relaxed text-moon-200 text-halo">
            {description}
          </p>
        </SlideUp>
      )}
    </div>
  )
}
