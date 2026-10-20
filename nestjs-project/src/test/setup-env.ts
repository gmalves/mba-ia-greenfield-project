// Os testes rodam DENTRO da rede do compose (hostnames internos, ex.: "minio").
// Este pin garante que URLs pre-assinadas consumidas pelos proprios testes continuem
// apontando para o endpoint interno, independentemente do STORAGE_PUBLIC_ENDPOINT
// configurado no .env para clientes externos (navegador).
process.env.STORAGE_PUBLIC_ENDPOINT =
  process.env.STORAGE_ENDPOINT ?? 'http://minio:9000';
