// 给 logger/config 的 requireEnv 提供兜底测试 secret
process.env.JWT_SECRET ||= 'test-jwt-secret-do-not-use-in-prod-min-32-chars';
process.env.ENCRYPTION_KEY ||= 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25n';
process.env.LOG_LEVEL ||= 'error';
process.env.NODE_ENV ||= 'test';
