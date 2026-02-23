'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getDb } from '@nitejar/database'
import { getAuth } from '@/lib/auth'
import { createSignupMarker, SIGNUP_MARKER_HEADER } from '@/lib/signup-marker'
import { hashInviteToken } from '@/lib/invitations'

type RoleValue = 'superadmin' | 'admin' | 'member'

function getField(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function redirectWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`)
}

async function userCount(): Promise<number> {
  const db = getDb()
  const result = await db
    .selectFrom('users')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirst()

  return Number(result?.count ?? 0)
}

async function getSignupHeaders(purpose: 'bootstrap' | 'invite'): Promise<Headers> {
  const incoming = new Headers(await headers())
  incoming.set(SIGNUP_MARKER_HEADER, createSignupMarker(purpose))
  return incoming
}

async function updateUserRoleAndStatus(userId: string, role: RoleValue, avatarUrl: string) {
  const db = getDb()
  await db
    .updateTable('users')
    .set({
      role,
      status: 'active',
      avatar_url: avatarUrl || null,
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', userId)
    .execute()
}

export async function bootstrapFirstUserAction(formData: FormData): Promise<void> {
  if ((await userCount()) > 0) {
    redirect('/login')
  }

  const name = getField(formData, 'name')
  const email = getField(formData, 'email').toLowerCase()
  const password = getField(formData, 'password')
  const confirmPassword = getField(formData, 'confirmPassword')
  const avatarUrl = getField(formData, 'avatarUrl')

  if (!name || !email || !password) {
    redirectWithError('/setup', 'Name, email, and password are required.')
  }

  if (password !== confirmPassword) {
    redirectWithError('/setup', 'Passwords do not match.')
  }

  try {
    const auth = getAuth()
    const signupHeaders = await getSignupHeaders('bootstrap')
    const signUpResult = await auth.api.signUpEmail({
      headers: signupHeaders,
      body: {
        name,
        email,
        password,
        image: avatarUrl || undefined,
      },
    })

    await updateUserRoleAndStatus(signUpResult.user.id, 'superadmin', avatarUrl)

    await auth.api.signInEmail({
      headers: new Headers(await headers()),
      body: {
        email,
        password,
        rememberMe: true,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create the first user.'
    redirectWithError('/setup', message)
  }

  redirect('/')
}

export async function signInAction(formData: FormData): Promise<void> {
  if ((await userCount()) === 0) {
    redirect('/setup')
  }

  const email = getField(formData, 'email').toLowerCase()
  const password = getField(formData, 'password')

  if (!email || !password) {
    redirectWithError('/login', 'Email and password are required.')
  }

  try {
    const auth = getAuth()
    await auth.api.signInEmail({
      headers: new Headers(await headers()),
      body: {
        email,
        password,
        rememberMe: true,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid email or password.'
    redirectWithError('/login', message)
  }

  redirect('/')
}

export async function signUpApprovedDomainAction(formData: FormData): Promise<void> {
  if ((await userCount()) === 0) {
    redirect('/setup')
  }

  const name = getField(formData, 'name')
  const email = getField(formData, 'email').toLowerCase()
  const password = getField(formData, 'password')
  const confirmPassword = getField(formData, 'confirmPassword')
  const avatarUrl = getField(formData, 'avatarUrl')

  if (!name || !email || !password) {
    redirectWithError('/signup', 'Name, email, and password are required.')
  }

  if (password !== confirmPassword) {
    redirectWithError('/signup', 'Passwords do not match.')
  }

  try {
    const auth = getAuth()
    await auth.api.signUpEmail({
      headers: new Headers(await headers()),
      body: {
        name,
        email,
        password,
        image: avatarUrl || undefined,
      },
    })

    await auth.api.signInEmail({
      headers: new Headers(await headers()),
      body: {
        email,
        password,
        rememberMe: true,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create account.'
    redirectWithError('/signup', message)
  }

  redirect('/')
}

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: new Headers(await headers()) })
  redirect('/login')
}

export async function acceptInviteAction(token: string, formData: FormData): Promise<void> {
  const password = getField(formData, 'password')
  const confirmPassword = getField(formData, 'confirmPassword')

  if (!password) {
    redirectWithError(`/invite/${token}`, 'Password is required.')
  }

  if (password !== confirmPassword) {
    redirectWithError(`/invite/${token}`, 'Passwords do not match.')
  }

  const db = getDb()
  const tokenHash = hashInviteToken(token)
  const invite = await db
    .selectFrom('invitations')
    .selectAll()
    .where('token_hash', '=', tokenHash)
    .where('status', '=', 'pending')
    .executeTakeFirst()

  if (!invite) {
    redirectWithError(`/invite/${token}`, 'Invite token is invalid or already used.')
  }

  const now = Math.floor(Date.now() / 1000)
  if (invite.expires_at && invite.expires_at < now) {
    await db
      .updateTable('invitations')
      .set({ status: 'expired', updated_at: now })
      .where('id', '=', invite.id)
      .execute()
    redirectWithError(`/invite/${token}`, 'Invite token has expired.')
  }

  const existing = await db
    .selectFrom('users')
    .select(['id'])
    .where('email', '=', invite.email)
    .executeTakeFirst()

  if (existing) {
    redirectWithError('/login', 'An account already exists for this invite email.')
  }

  try {
    const auth = getAuth()
    const signupHeaders = await getSignupHeaders('invite')
    const signUpResult = await auth.api.signUpEmail({
      headers: signupHeaders,
      body: {
        name: invite.name,
        email: invite.email,
        password,
        image: invite.avatar_url ?? undefined,
      },
    })

    await updateUserRoleAndStatus(
      signUpResult.user.id,
      (invite.role as RoleValue) ?? 'member',
      invite.avatar_url ?? ''
    )

    await db
      .updateTable('invitations')
      .set({ status: 'accepted', accepted_at: now, updated_at: now })
      .where('id', '=', invite.id)
      .execute()

    await auth.api.signInEmail({
      headers: new Headers(await headers()),
      body: {
        email: invite.email,
        password,
        rememberMe: true,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to accept invite.'
    redirectWithError(`/invite/${token}`, message)
  }

  redirect('/')
}
