import { z } from 'zod';

export const commonSchemas = {
    id: z.string().uuid({ message: 'Invalid ID format' }),
    email: z.string().email({ message: 'Invalid email address' }).toLowerCase(),
    phone: z.string().min(10, { message: 'Phone number must be at least 10 digits' }),
};

type ValidationResult<T> = { success: true; data: T } | { success: false; error: string };

export function validateBody<T>(body: unknown, schema: z.ZodSchema<T>): ValidationResult<T> {
    const result = schema.safeParse(body);
    if (!result.success) {
        return { success: false, error: result.error.issues[0].message };
    }
    return { success: true, data: result.data };
}

export async function validateParams<Output, Input = unknown>(
    params: Promise<Input>,
    schema: z.ZodType<Output, z.ZodTypeDef, Input>
): Promise<ValidationResult<Output>> {
    const resolvedParams = await params;
    const result = schema.safeParse(resolvedParams);
    if (!result.success) {
        return { success: false, error: `Invalid parameters: ${result.error.issues[0].message}` };
    }
    return { success: true, data: result.data };
}
