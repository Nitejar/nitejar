import { Resend } from 'resend'
import { render } from '@react-email/render'
import InviteEmail from '@/emails/InviteEmail'

const resendApiKey = process.env.RESEND_API_KEY
const resendFrom = process.env.RESEND_FROM ?? 'Nitejar <no-reply@nitejar.dev>'

interface InviteEmailInput {
  to: string
  name: string
  inviteUrl: string
}

export interface InviteEmailResult {
  sent: boolean
}

export async function sendInviteEmail({
  to,
  name,
  inviteUrl,
}: InviteEmailInput): Promise<InviteEmailResult> {
  if (!resendApiKey) {
    return { sent: false }
  }

  const resend = new Resend(resendApiKey)
  const html = await render(<InviteEmail name={name} inviteUrl={inviteUrl} />)

  await resend.emails.send({
    from: resendFrom,
    to,
    subject: "You're invited to Nitejar",
    html,
  })

  return { sent: true }
}
