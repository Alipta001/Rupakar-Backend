import { z } from 'zod';

export const wishlistProductIdSchema = z.object({
  productId: z.string().trim().min(1),
});
