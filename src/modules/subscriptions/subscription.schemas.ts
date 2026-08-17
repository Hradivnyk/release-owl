import { z } from 'zod';
import { TOKEN_REGEX } from './token.js';

export const subscribeSchema = z.object({
  email: z.string().email('Invalid email format'),
  repo: z
    .string()
    .regex(
      /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/,
      'repo must be in owner/repo format (e.g., golang/go)',
    ),
});

export const tokenSchema = z.object({
  token: z.string().regex(TOKEN_REGEX, 'Invalid token format'),
});

export const emailQuerySchema = z.object({
  email: z.string().email('Invalid email format'),
});
