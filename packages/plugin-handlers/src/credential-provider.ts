export interface CredentialEnvelope {
  token: string
  expiresAt?: number
  source: 'cache' | 'mint'
}

export interface ICredentialProvider<TRequest, TResult = CredentialEnvelope> {
  getCredential(request: TRequest): Promise<TResult>
}
