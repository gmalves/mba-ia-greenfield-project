import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || 'http://minio:9000',
  // Endpoint usado para ASSINAR URLs entregues a clientes externos (navegador).
  // Em ambiente local, clientes acessam via host (localhost:9000); serviços entre si usam o endpoint interno.
  // Fallback: mesmo que o endpoint interno (comportamento anterior).
  publicEndpoint:
    process.env.STORAGE_PUBLIC_ENDPOINT ||
    process.env.STORAGE_ENDPOINT ||
    'http://minio:9000',
  accessKeyId: process.env.STORAGE_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.STORAGE_SECRET_KEY || 'minioadmin',
  region: process.env.STORAGE_REGION || 'us-east-1',
  bucket: process.env.STORAGE_BUCKET || 'streamtube-videos',
}));
