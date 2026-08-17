export const TOKEN_REGEX: RegExp = /^[0-9a-f]{64}$/;

export function isValidToken(token: string): boolean {
  return TOKEN_REGEX.test(token);
}
