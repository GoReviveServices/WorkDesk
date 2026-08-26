import { z } from 'zod';

const VALID_HSN_CODES = [
  '84713010', '84433990', '85171290', '84715000', '84733099',
  '85287219', '85176290', '84713090', '84716060', '85171890',
  '85258010', '84717090', '85285900', '85163100', '85171300',
  '84716040', '85258090', '84431920', '850760', '85076000',
  '998434', '85044090', '85183000', '854442', '90328990',
  '850410', '85071000', '847330', '85363000', '997331', '3208',
];

export const bulkModelSchema = z.object({
  make: z.string().min(1, 'Brand is required'),
  product_name: z.string().min(1, 'Product Category Name is required'),
  sub_producd: z.string().min(1, 'Sub Category is required'),
  model: z.string().min(1, 'Model Name is required'),

  hsn_code: z
    .string()
    .min(1, 'HSN Code is required')
    .refine((val) => VALID_HSN_CODES.includes(val), {
      message: 'Invalid HSN Code. Must match an allowed option from the system.',
    }),

  color: z.string().optional().default(''),

  ram_cap: z.string().optional().default(''),
  strg1: z.string().optional().default(''),
  strg2: z.string().optional().default(''),
  cpu_core: z.string().optional().default(''),
  cpu_gen: z.string().optional().default(''),
  cpu_speed: z.string().optional().default(''),
  gpu_type: z.string().optional().default(''),
  gpu_cap: z.string().optional().default(''),
  display_type: z.string().optional().default(''),
  display_size: z.string().optional().default(''),
  op_drive: z.string().optional().default(''),

  keyboard: z.enum(['Y', 'N', '']).optional().default(''),
  model_typenew: z.enum(['Y', 'N', '']).optional().default(''),
});

export type BulkModelPayload = z.infer<typeof bulkModelSchema>;

export interface FieldError {
  message: string;
  suggestion?: string;
}

export type ValidatedRow = {
  id: string;
  rowIndex: number;
  data: Partial<BulkModelPayload>;
  original: Record<string, string>;
  isValid: boolean;
  errors: Record<string, FieldError>;
};