import * as jose from 'jose';

export type JwtRole = 'attendee' | 'staff' | 'admin';

export interface JwtPayload {
  sub: string;
  role: JwtRole;
  email?: string;  // present for staff/admin
  [key: string]: unknown;
}

const ALG = 'HS256';

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signToken(payload: JwtPayload, secret: string, expiry: string = '90d'): Promise<string> {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(encodeSecret(secret));
}

export async function verifyToken(token: string, secret: string): Promise<JwtPayload> {
  const { payload } = await jose.jwtVerify(token, encodeSecret(secret));
  return payload as unknown as JwtPayload;
}
