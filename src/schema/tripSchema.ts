import { z } from "zod";

export const tripSchema = z.object({
  title: z.string().min(3),
  slug: z.string().min(3),
  destination: z.string().min(2),

  durationDays: z.number().min(1),
  durationNights: z.number().min(0),

  description: z.string(),

  tripTypeId: z.number(),

  status: z.string(),

  price: z.number().min(1),

  discountedPrice: z.number().optional(),

  totalSeats: z.number().min(1),
});