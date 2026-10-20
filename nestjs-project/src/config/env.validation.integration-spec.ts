import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  STORAGE_ACCESS_KEY: 'minioadmin',
  STORAGE_SECRET_KEY: 'minioadmin',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const result = validate({});
    expect(result.error).toBeUndefined();
    const value = result.value as Record<string, string>;
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — storage/queue/worker namespaces', () => {
  it('should reject REDIS_PORT with a non-numeric value', () => {
    const { error } = validate({ REDIS_PORT: 'not-a-number' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('REDIS_PORT');
  });

  it('should coerce REDIS_PORT to a number', () => {
    const result = validate({ REDIS_PORT: '6380' });
    expect(result.error).toBeUndefined();
    const value = result.value as { REDIS_PORT: number };
    expect(value.REDIS_PORT).toBe(6380);
  });

  it('should coerce WORKER_CONCURRENCY to a number', () => {
    const result = validate({ WORKER_CONCURRENCY: '4' });
    expect(result.error).toBeUndefined();
    const value = result.value as { WORKER_CONCURRENCY: number };
    expect(value.WORKER_CONCURRENCY).toBe(4);
  });

  it('should reject WORKER_CONCURRENCY below 1', () => {
    const { error } = validate({ WORKER_CONCURRENCY: '0' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('WORKER_CONCURRENCY');
  });

  it('should apply default REDIS_HOST when not set', () => {
    const result = validate({});
    expect(result.error).toBeUndefined();
    const value = result.value as { REDIS_HOST: string };
    expect(value.REDIS_HOST).toBe('redis');
  });

  it('should apply default STORAGE_REGION when not set', () => {
    const result = validate({});
    expect(result.error).toBeUndefined();
    const value = result.value as { STORAGE_REGION: string };
    expect(value.STORAGE_REGION).toBe('us-east-1');
  });

  it('should apply default STORAGE_BUCKET when not set', () => {
    const result = validate({});
    expect(result.error).toBeUndefined();
    const value = result.value as { STORAGE_BUCKET: string };
    expect(value.STORAGE_BUCKET).toBe('streamtube-videos');
  });
});
