import { z } from 'zod';

export const HcmBalanceResponseSchema = z.object({
  employeeId: z.string(),
  locationId: z.string(),
  balance: z.number(),
  lastUpdated: z.string().default(() => new Date().toISOString()), 
});

export const HcmDeductResponseSchema = z.object({
  transactionId: z.string(),
  remainingBalance: z.number(),
  status: z
    .enum(['SUCCESS', 'PENDING', 'FAILED'])
    .optional()
    .default('SUCCESS'),
});

export const HcmBatchPayloadSchema = z.object({
  batchId: z.string(),
  generatedAt: z.string(),
  balances: z.array(
    z.object({
      employeeId: z.string(),
      locationId: z.string(),
      balance: z.number(),
    }),
  ),
});
