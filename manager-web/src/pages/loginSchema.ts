import { z } from 'zod';

export const loginSchema = z.object({
  username: z
    .string()
    .min(1, '请输入用户名')
    .max(50, '用户名过长'),
  password: z
    .string()
    .min(1, '请输入密码')
    .max(128, '密码过长'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
