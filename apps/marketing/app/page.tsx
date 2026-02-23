import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Hero } from '@/components/hero/Hero'
import { QuickStart } from '@/components/sections/QuickStart'
import { Features } from '@/components/sections/Features'
import { UseCases } from '@/components/sections/UseCases'
import { HowItWorks } from '@/components/sections/HowItWorks'
import { Collaboration } from '@/components/sections/Collaboration'
import { Personality } from '@/components/sections/Personality'
import { Community } from '@/components/sections/Community'
import {
  StarFieldBackground,
  LandscapeImage,
  LandscapeImageMobile,
} from '@/components/shared/LandscapeBackground'

export default function Home() {
  return (
    <div className="relative min-h-screen">
      <StarFieldBackground />
      {/* Desktop landscape — absolute to page bottom */}
      <LandscapeImage />
      <div className="relative z-10">
        <Navbar />
        <main className="relative">
          <Hero />
          <QuickStart />
          <Features />
          <UseCases />
          <HowItWorks />
          <Collaboration />
          <Personality />
          <Community />
          {/* Mobile landscape — absolute to bottom of main content */}
          <LandscapeImageMobile />
        </main>
        <Footer />
      </div>
    </div>
  )
}
