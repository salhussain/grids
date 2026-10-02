import { createRemoteJWKSet, jwtVerify } from 'jose';
import { unauthorized } from '../errors.js';

export interface VerifiedToken {
  subject: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

/** Verifies JWT access tokens (RS256) issued for the API audience, against the issuer's JWKS. */
export class JwtTokenVerifier implements TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly issuer: string,
    private readonly audience: string,
    jwksUrl = `${issuer.replace(/\/$/, '')}/jwks`,
  ) {
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  async verify(token: string): Promise<VerifiedToken> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['RS256'],
        typ: 'at+jwt',
      });
      if (!payload.sub) throw new Error('no sub');
      return { subject: payload.sub };
    } catch (e) {
      throw unauthorized(e instanceof Error ? e.message : 'invalid token');
    }
  }
}
