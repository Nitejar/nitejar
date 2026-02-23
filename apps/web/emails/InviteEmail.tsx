import { Button, Container, Heading, Hr, Link, Section, Text } from '@react-email/components'

interface InviteEmailProps {
  name: string
  inviteUrl: string
}

export default function InviteEmail({ name, inviteUrl }: InviteEmailProps) {
  return (
    <Container style={{ fontFamily: 'Arial, sans-serif', maxWidth: '560px' }}>
      <Heading as="h2">You&apos;re invited to Nitejar</Heading>
      <Text>Hey {name},</Text>
      <Text>
        You&apos;ve been invited to join the Nitejar control plane. Use the link below to accept
        your invite and set up your account.
      </Text>
      <Section style={{ margin: '24px 0' }}>
        <Button
          href={inviteUrl}
          style={{
            backgroundColor: '#1f2937',
            color: '#ffffff',
            padding: '12px 20px',
            borderRadius: '6px',
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          Accept invite
        </Button>
      </Section>
      <Text>If the button doesn&apos;t work, copy and paste this link in your browser:</Text>
      <Link href={inviteUrl}>{inviteUrl}</Link>
      <Hr />
      <Text style={{ fontSize: '12px', color: '#6b7280' }}>
        This invite link will expire in 7 days.
      </Text>
    </Container>
  )
}
