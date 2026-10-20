---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-20T13:42:05-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-20T13:52:19-03:00"
  docs/project-plan.md: "2026-10-20T13:05:53-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-20T13:21:45-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-20T13:07:29-03:00"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-10-20T13:07:29-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-20T13:07:29-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-20T13:07:29-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-20T13:07:29-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-20T13:05:53-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Implementar o upload de vídeos de até 10GB sem impacto na performance — com pré-cadastro automático do vídeo como rascunho ao iniciar o upload —, o processamento automático do vídeo após o upload em segundo plano (fila + worker FFmpeg com extração de duração e metadados e geração de thumbnail a partir de um frame), a URL única por vídeo sem conflito, e a entrega via streaming (sem necessidade de download completo) e download do vídeo pelo usuário.

---

## Step Implementations

### SI-03.1 — Dependencies and Configuration Namespaces

**Description:** Instalar as 8 dependências da fase (S3 SDK, BullMQ, Redis, fluent-ffmpeg, nanoid) e criar os namespaces de configuração `storage`, `queue` e `worker` no padrão `registerAs` herdado da Fase 01, com validação Joi das novas variáveis de ambiente.

**Technical actions:**

1. Instalar `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@nestjs/bullmq`, `bullmq`, `ioredis`, `fluent-ffmpeg`, `@types/fluent-ffmpeg` (dev) e `nanoid` (per `phase-03-videos/TD-01`, `TD-02`, `TD-04`, `TD-07`)
2. Criar `src/config/storage.config.ts` — `registerAs('storage', …)` expondo `endpoint`, `accessKeyId`, `secretAccessKey`, `region`, `bucket` (per `phase-01-configuracao-base/TD-03`)
3. Criar `src/config/queue.config.ts` — `registerAs('queue', …)` expondo `host`/`port` do Redis (Compose service name `redis`, nunca `localhost`)
4. Criar `src/config/worker.config.ts` — `registerAs('worker', …)` expondo parâmetros do worker (concurrency, paths)
5. Estender `src/config/env.validation.ts` (Joi) + `.env.example` com `STORAGE_*`, `REDIS_*`, `WORKER_*` e registrar os 3 namespaces no `ConfigModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `env.validation` | Integration: novas vars `STORAGE_*`/`REDIS_*`/`WORKER_*` validadas e coerce-tipadas | `src/config/env.validation.integration-spec.ts` (estender) |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose exec nestjs-api npm install` conclui sem erro e as 8 dependências aparecem em `package.json`
- `storage.config.ts`, `queue.config.ts` e `worker.config.ts` existem e exportam factories `registerAs` tipadas
- Configuração inválida (ex.: `REDIS_PORT` não-numérico) falha na inicialização via schema Joi com mensagem clara

---

### SI-03.2 — Docker Compose: MinIO, Redis, and Worker Service

**Description:** Adicionar os serviços de infraestrutura da fase ao `docker-compose.yml` — MinIO (object storage S3-compatível), Redis (para o BullMQ) e o serviço `worker` (segundo entrypoint da app Nest que consome a fila sem abrir porta HTTP), com FFmpeg isolado na imagem do worker.

**Technical actions:**

1. Adicionar serviço `minio` ao `docker-compose.yml` — imagem `minio/minio`, porta 9000, healthcheck, volume e credenciais `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` (per `phase-03-videos/TD-01`)
2. Adicionar serviço `redis` ao `docker-compose.yml` — imagem `redis:7-alpine`, porta 6379, usado pelo BullMQ (per `phase-03-videos/TD-02`)
3. Adicionar serviço `worker` ao `docker-compose.yml` — segundo entrypoint da mesma app Nest, consome a fila `video-processing` sem expor porta HTTP (per `phase-03-videos/TD-03`)
4. Adicionar stage `worker` no `Dockerfile` — instala `ffmpeg` na imagem, mantendo a imagem da API enxuta (per `phase-03-videos/TD-03`, `TD-04`)
5. Conectar `STORAGE_ENDPOINT`/`REDIS_HOST` via Compose service names (`minio`, `redis`) no env dos serviços

**Tests:** _(empty — Infra)_

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `docker compose up -d` sobe `minio`, `redis` e `worker` com status `running` (`docker compose ps`)
- `worker` não expõe porta HTTP e registra conexão com a fila `video-processing` nos logs
- `minio` responde ao healthcheck e o bucket configurado é criado

---

### SI-03.3 — Video Entity and Migration

**Description:** Criar a entidade `Video` (id `nanoid(11)`, status enum `UPLOADING`/`PROCESSING`/`READY`/`FAILED`, chaves de object storage e metadados de processamento), a migração TypeORM correspondente e o módulo `VideosModule`.

**Technical actions:**

1. Criar `src/videos/entities/video-status.enum.ts` — enum `VideoStatus` com `UPLOADING`, `PROCESSING`, `READY`, `FAILED` (per `phase-03-videos/TD-08`)
2. Criar `src/videos/entities/video.entity.ts` — colunas per `### Data Model → Video` (id `varchar(11)` nanoid, `channel_id` FK → `channels.id`, `status` default `UPLOADING`, `mime_type`, `size_bytes`, `duration_seconds`, `width`, `height`, `video_object_key`, `thumbnail_object_key`, `upload_id`, `created_at`, `updated_at`) (per `phase-03-videos/TD-07`, `TD-08`)
3. Gerar migração `xxxx-create-videos` (constraints, FK `channel_id`, índice `(status)`)
4. Criar `src/videos/videos.module.ts` — `TypeOrmModule.forFeature([Video])`; registrar `VideosModule` em `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: constraints (not null, enum, FK), default `UPLOADING`, timestamps auto | `src/videos/entities/video.entity.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- A migração cria a tabela `videos` com a coluna `status` do tipo enum e default `UPLOADING`
- Inserir um `Video` com `status` inválido viola a constraint do enum
- `channel_id` referencia `channels.id` (FK) e violações de integridade são rejeitadas

---

### SI-03.4 — Object Storage Service and Queue Registration

**Description:** Criar o `StorageService` (wrapper `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` para multipart e presigned URLs) e registrar a fila `video-processing` via `@nestjs/bullmq`, com a conexão Redis vinda do `queue.config`.

**Technical actions:**

1. Criar `src/storage/storage.service.ts` — `StorageService` com `S3Client` (MinIO: `forcePathStyle: true`, endpoint do `storage.config`) e `getSignedUrl` (`@aws-sdk/s3-request-presigner`); métodos `createMultipartUpload`, `getPresignedPartUrls` (array de `{ part_number, url }`), `completeMultipartUpload`, `abortMultipartUpload`, `getPresignedGetUrl` (per `phase-03-videos/TD-01`, `TD-05`, `TD-06`)
2. Criar `src/storage/storage.module.ts` — provê `StorageService` injetando `storageConfig` via `ConfigType`/`@Inject(storageConfig.KEY)`
3. Criar `src/queues/queues.module.ts` — `BullModule.forRootAsync` (conexão do `queue.config`) + `BullModule.registerQueue({ name: 'video-processing', defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } } })` (per `phase-03-videos/TD-02`)
4. Registrar `StorageModule` e `QueuesModule` em `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: multipart init/complete/abort e presign contra MinIO local | `src/storage/storage.service.integration-spec.ts` |
| `QueuesModule` | Unit: compilação do módulo com imports configurados | `src/queues/queues.module.spec.ts` |

**Dependencies:** SI-03.1, SI-03.2

**Acceptance criteria:**

- `StorageService.createMultipartUpload` retorna um `UploadId` e `getPresignedPartUrls` retorna uma URL presignada por parte
- `QueuesModule` registra a fila `video-processing` e a conexão Redis usa `queue.config.host` (Compose service name `redis`)
- `AppModule` compila com `StorageModule` e `QueuesModule` registrados

---

### SI-03.5 — Upload Init (POST /videos)

**Route:** POST /videos
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Authenticated

**Description:** Implementar o endpoint de inicialização do upload: pré-cadastro do vídeo como rascunho (`UPLOADING`) + criação do multipart upload no object storage, retornando `{ id, upload_id }`.

**Technical actions:**

1. Criar `src/videos/dto/create-video.dto.ts` — `CreateVideoDto` com `title` (opcional), `mime_type` (required), `size_bytes` (required, ≤ 10GB) com decoradores `class-validator` + `@ApiProperty` (per `phase-03-videos/TD-05`)
2. Implementar `initUpload(dto, channelId)` em `VideosService` — gerar `id` via `nanoid(11)`, criar `Video` em `UPLOADING` com `channel_id` do usuário autenticado, chamar `storage.createMultipartUpload` e persistir `upload_id` + `video_object_key` (per `phase-03-videos/TD-05`, `TD-07`, `TD-08`)
3. Criar `src/videos/videos.controller.ts` — `@Post('videos')` chamando `initUpload`, retornando 201 `{ id, upload_id }`; decoradores `@ApiOperation`/`@ApiResponse` (per `openapi-docs-nestjs/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: `initUpload` cria `Video` em `UPLOADING`, chama storage e seta `upload_id`; rejeita `size_bytes` > 10GB (mock repo/storage) | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration: `initUpload` persiste `Video` (`UPLOADING`) + `upload_id` no DB | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.3, SI-03.4

**Acceptance criteria:**

- `POST /videos` com body válido retorna 201 com `{ id, upload_id }` e cria um `Video` em `UPLOADING` ligado ao canal do usuário autenticado
- `POST /videos` com `size_bytes` > 10GB retorna 400 com `VALIDATION_ERROR`
- `POST /videos` sem token de acesso retorna 401

---

### SI-03.6 — Presigned Part URLs (POST /videos/:id/upload/parts)

**Route:** POST /videos/:id/upload/parts
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Authenticated

**Description:** Implementar o endpoint que emite uma presigned `PUT` URL por parte do multipart upload, permitindo ao cliente enviar bytes direto ao object storage sem relé via API.

**Technical actions:**

1. Criar `src/videos/dto/upload-parts.dto.ts` — `UploadPartsDto` com `part_numbers: number[]` (required, não vazio) com `class-validator` + `@ApiProperty`
2. Criar `src/videos/exceptions/upload-not-found.exception.ts` — `UploadNotFoundException` com `errorCode: 'UPLOAD_NOT_FOUND'` (per Error Catalog)
3. Implementar `getPresignedPartUrls(id, partNumbers)` em `VideosService` — localizar o `Video` (lançar `UploadNotFoundException` se ausente ou `upload_id` nulo), chamar `storage.getPresignedPartUrls` (per `phase-03-videos/TD-05`)
4. Adicionar `@Post('videos/:id/upload/parts')` a `VideosController` — 200 `{ parts: [{ part_number, url }] }`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: `getPresignedPartUrls` lança `UploadNotFoundException` para id ausente; retorna `parts` por parte (mock repo/storage) | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration: `getPresignedPartUrls` gera URLs presignadas contra MinIO para um `Video` em `UPLOADING` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.4, SI-03.5

**Acceptance criteria:**

- `POST /videos/:id/upload/parts` com `part_numbers` válido retorna 200 com `{ parts: [{ part_number, url }] }` — uma URL por parte
- `POST /videos/:id/upload/parts` para um `id` inexistente retorna 404 com `UPLOAD_NOT_FOUND`
- `POST /videos/:id/upload/parts` com `part_numbers` vazio retorna 400 com `VALIDATION_ERROR`

---

### SI-03.7 — Upload Complete and Abort

**Route:** POST /videos/:id/upload/complete, POST /videos/:id/upload/abort
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Authenticated

**Description:** Implementar os endpoints de conclusão e aborto do multipart upload: `complete` finaliza o upload no S3, transiciona o vídeo para `PROCESSING` e enfileira o job; `abort` descarta o upload e marca o vídeo como `FAILED`.

**Technical actions:**

1. Criar `src/videos/dto/complete-upload.dto.ts` — `CompleteUploadDto` com `parts: Array<{ part_number: number, etag: string }>` (required, não vazio) com `class-validator` + `@ApiProperty`
2. Criar `src/videos/exceptions/invalid-upload-state.exception.ts` — `InvalidUploadStateException` com `errorCode: 'INVALID_UPLOAD_STATE'` (per Error Catalog)
3. Implementar `completeUpload(id, dto)` em `VideosService` — validar `status === 'UPLOADING'` (lançar `InvalidUploadStateException` senão), chamar `storage.completeMultipartUpload`, transicionar para `PROCESSING` e enfilear job `process` com payload `{ videoId }` na fila `video-processing` (per `phase-03-videos/TD-05`, `TD-08`)
4. Implementar `abortUpload(id)` em `VideosService` — validar `status === 'UPLOADING'`, chamar `storage.abortMultipartUpload` e transicionar para `FAILED` (per `phase-03-videos/TD-05`, `TD-08`)
5. Adicionar `@Post('videos/:id/upload/complete')` e `@Post('videos/:id/upload/abort')` a `VideosController` — 200 `{ id, status }` e 204 respectivamente

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: `completeUpload` transiciona para `PROCESSING` e enfileira; `abortUpload` transiciona para `FAILED`; ambos lançam `InvalidUploadStateException` fora de `UPLOADING` (mock repo/storage/queue) | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration: `completeUpload` persiste `status = PROCESSING` e adiciona job na fila; `abortUpload` persiste `status = FAILED` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.4, SI-03.6

**Acceptance criteria:**

- `POST /videos/:id/upload/complete` com `parts` válido retorna 200 `{ id, status: "PROCESSING" }` e enfileira o job `process`
- `POST /videos/:id/upload/complete` em vídeo fora de `UPLOADING` retorna 409 com `INVALID_UPLOAD_STATE`
- `POST /videos/:id/upload/abort` em `UPLOADING` retorna 204 e persiste `status = FAILED`
- `POST /videos/:id/upload/complete` para um `id` inexistente retorna 404 com `UPLOAD_NOT_FOUND`

---

### SI-03.8 — Video Status (GET /videos/:id)

**Route:** GET /videos/:id
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Authenticated

**Description:** Implementar o endpoint de status do vídeo, expondo estado, título, duração e URL do thumbnail para o FE consumir a evolução `UPLOADING` → `PROCESSING` → `READY`/`FAILED`.

**Technical actions:**

1. Implementar `findById(id)` em `VideosService` — localizar o `Video` (lançar `UploadNotFoundException` se ausente), retornar `{ id, status, title, duration_seconds, thumbnail_url }`; `thumbnail_url` é uma presigned `GET` do thumbnail quando `status === 'READY'` (per `phase-03-videos/TD-08`)
2. Adicionar `@Get('videos/:id')` a `VideosController` — 200 com o payload acima; `@ApiParam`/`@ApiResponse` (per `openapi-docs-nestjs/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: `findById` lança `UploadNotFoundException` para id ausente; monta `thumbnail_url` apenas quando `READY` (mock repo/storage) | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration: `findById` retorna status + metadados persistidos no DB | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.3

**Acceptance criteria:**

- `GET /videos/:id` de um vídeo existente retorna 200 com `{ id, status, title, duration_seconds, thumbnail_url }`
- `GET /videos/:id` de um vídeo inexistente retorna 404 com `UPLOAD_NOT_FOUND`
- `thumbnail_url` só é preenchido quando `status` é `READY`

---

### SI-03.9 — Streaming and Download URLs (GET /videos/:id/stream, /videos/:id/download)

**Route:** GET /videos/:id/stream, GET /videos/:id/download
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Anonymous

**Description:** Implementar a emissão de presigned `GET` URLs para reprodução via streaming (`HTTP Range`, sem download completo) e para download (`Content-Disposition: attachment`), direcionando o navegador direto ao object storage.

**Technical actions:**

1. Criar `src/videos/exceptions/video-not-ready.exception.ts` — `VideoNotReadyException` com `errorCode: 'VIDEO_NOT_READY'` (per Error Catalog)
2. Implementar `getStreamUrl(id)` em `VideosService` — validar `status === 'READY'` (lançar `VideoNotReadyException` senão) e chamar `storage.getPresignedGetUrl` com `ResponseContentDisposition` omitido (streaming via `HTTP Range`) (per `phase-03-videos/TD-06`)
3. Implementar `getDownloadUrl(id)` em `VideosService` — validar `status === 'READY'` e chamar `storage.getPresignedGetUrl` com `ResponseContentDisposition: attachment` (per `phase-03-videos/TD-06`)
4. Adicionar `@Get('videos/:id/stream')` e `@Get('videos/:id/download')` a `VideosController` — 200 `{ url, expires_in }` (stream) e `{ url }` (download)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: `getStreamUrl`/`getDownloadUrl` lançam `VideoNotReadyException` fora de `READY`; download seta `Content-Disposition: attachment` (mock repo/storage) | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration: presigned GET contra MinIO para um `Video` em `READY` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.4, SI-03.8

**Acceptance criteria:**

- `GET /videos/:id/stream` de um vídeo `READY` retorna 200 com `{ url, expires_in }` e a URL suporta `HTTP Range`
- `GET /videos/:id/download` de um vídeo `READY` retorna 200 com `{ url }` e a URL carrega `Content-Disposition: attachment`
- `GET /videos/:id/stream` de um vídeo não `READY` retorna 409 com `VIDEO_NOT_READY`
- `GET /videos/:id/stream` de um vídeo inexistente retorna 404 com `UPLOAD_NOT_FOUND`

---

### SI-03.10 — Worker: FFmpeg Processing (probe + thumbnail + status)

**Description:** Implementar o consumidor da fila `video-processing` (segundo entrypoint da app Nest) que executa `ffprobe` para extrair duração/metadados, gera thumbnail via `fluent-ffmpeg`, envia o thumbnail ao storage e transiciona o vídeo para `READY`/`FAILED`.

**Technical actions:**

1. Criar `src/videos/video-processing.consumer.ts` — `@Processor('video-processing', { concurrency: 1 })` estendendo `WorkerHost`: `process(job)` faz `ffprobe` (duração/width/height), extrai thumbnail com `ffmpeg(...).screenshots(...)`, faz upload do thumbnail via `StorageService` e atualiza o `Video` para `READY`; em falha permanente (ex.: arquivo não-vídeo) lança `UnrecoverableError` e marca `FAILED` (per `phase-03-videos/TD-02`, `TD-04`)
2. Criar entrypoint do worker (ex.: `src/worker.ts`) — `NestFactory.createApplicationContext(AppModule)` que boota o consumer sem abrir o servidor HTTP (per `phase-03-videos/TD-03`)
3. Adicionar script `start:worker` em `package.json` + entrada de build no `nest-cli.json` para o entrypoint do worker

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingConsumer` | Unit: `process(job)` executa probe + thumbnail e atualiza para `READY`; falha permanente marca `FAILED` (mock ffmpeg/storage/repo) | `src/videos/video-processing.consumer.spec.ts` |
| `VideoProcessingConsumer` | Integration: probe + thumbnail de um MP4 fixture, upload do thumbnail e atualização do `Video` para `READY` | `src/videos/video-processing.consumer.integration-spec.ts` |

**Dependencies:** SI-03.4, SI-03.3, SI-03.2

**Acceptance criteria:**

- Consumir um job `process` de um `Video` em `PROCESSING` persiste `duration_seconds`/`width`/`height` e `status = READY`
- O thumbnail é gerado, enviado ao storage e `thumbnail_object_key` é preenchido
- Um job com arquivo não-vídeo transiciona o vídeo para `FAILED` sem retry (falha permanente)

---

### SI-03.11 — OpenAPI Contract Sync

**Description:** Garantir que os endpoints de vídeo (upload session, status, streaming/download) apareçam tipados em `openapi.json`, regenerando e commitando o artefato para propagar o contrato ao FE via codegen.

**Technical actions:**

1. Regenerar `openapi.json` via script de export (per `openapi-docs-nestjs/TD-02`)
2. Verificar que os 7 endpoints de vídeo + schemas dos DTOs (`CreateVideoDto`, `UploadPartsDto`, `CompleteUploadDto`) aparecem em `openapi.json` com respostas tipadas por status e contratos de erro
3. Commitar `openapi.json` atualizado

**Tests:** _(empty — verificação é o AC do export do `openapi.json`)_

**Dependencies:** SI-03.5, SI-03.6, SI-03.7, SI-03.8, SI-03.9

**Acceptance criteria:**

- `openapi.json` contém os endpoints `POST /videos`, `POST /videos/{id}/upload/parts`, `POST /videos/{id}/upload/complete`, `POST /videos/{id}/upload/abort`, `GET /videos/{id}`, `GET /videos/{id}/stream`, `GET /videos/{id}/download`
- Os schemas dos DTOs de vídeo aparecem em `openapi.json` (propagação via CLI plugin + `@ApiProperty` explícito)
- `openapi.json` é commitado sem drift (nenhuma mudança pendente)

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | varchar(11) | PK, generated | `nanoid(11)` — curta, URL-safe, não-sequencial (phase-03-videos/TD-07) |
| channel_id | uuid | FK → channels.id, not null | Canal proprietário; upload é autenticado |
| title | varchar | nullable | Definido no init ou preenchido depois (Fase 04) |
| status | enum | not null, default `UPLOADING` | values: `UPLOADING`, `PROCESSING`, `READY`, `FAILED` (phase-03-videos/TD-08) |
| mime_type | varchar | not null | Content type do vídeo, informado no upload init |
| size_bytes | bigint | nullable | Tamanho total informado no init (≤ 10GB) |
| duration_seconds | numeric | nullable | Extraído pelo worker via `ffprobe` (phase-03-videos/TD-04) |
| width | integer | nullable | Largura do stream de vídeo (phase-03-videos/TD-04) |
| height | integer | nullable | Altura do stream de vídeo (phase-03-videos/TD-04) |
| video_object_key | varchar | not null | Chave no object storage = prefixo do `id` (phase-03-videos/TD-07) |
| thumbnail_object_key | varchar | nullable | Chave do thumbnail gerado pelo worker (phase-03-videos/TD-04) |
| upload_id | varchar | nullable | S3 multipart `UploadId` enquanto em `UPLOADING` (phase-03-videos/TD-05) |
| created_at | timestamptz | not null, auto-generated | `@CreateDateColumn` |
| updated_at | timestamptz | not null, auto-generated | `@UpdateDateColumn` |

**Relations:** Video → Channel (many-to-one)
**Indexes:** `(id)` — PK; `(channel_id)` — FK; `(status)` — para polling de status e consultas do worker

### API Contracts

#### POST /videos (SI-03.5)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer <access_token>

**Request body:**
- title: string, optional — título do rascunho (pré-cadastro)
- mime_type: string, required — content type do vídeo
- size_bytes: number, required — tamanho total em bytes (≤ 10GB)

**Response 201:**
- id: string (nanoid)
- upload_id: string (S3 multipart `UploadId`)

**Error responses:**
- 401: when the access token is missing or invalid
- 400 validation error: when the request body fails schema validation (including `size_bytes` > 10GB)

---

#### POST /videos/:id/upload/parts (SI-03.6)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer <access_token>

**Request body:**
- part_numbers: number[], required — números de parte (1-based) a assinar (ex.: `[1..N]`)

**Response 200:**
- parts: Array<{ part_number: number, url: string }> — uma presigned `PUT` URL por parte

**Error responses:**
- 404 UPLOAD_NOT_FOUND: when the video or its S3 `UploadId` does not exist
- 401: when the access token is missing or invalid
- 400 validation error: when `part_numbers` is empty or contains an invalid part number

---

#### POST /videos/:id/upload/complete (SI-03.7)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer <access_token>

**Request body:**
- parts: Array<{ part_number: number, etag: string }>, required — `ETag`s coletados de cada presigned `PUT`

**Response 200:**
- id: string
- status: `PROCESSING` — job de processamento enfileirado

**Error responses:**
- 404 UPLOAD_NOT_FOUND: when the video or its S3 `UploadId` does not exist
- 409 INVALID_UPLOAD_STATE: when the video is not in `UPLOADING` (already completed or aborted)
- 401: when the access token is missing or invalid
- 400 validation error: when `parts` is empty or a part `etag` is missing

---

#### POST /videos/:id/upload/abort (SI-03.7)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 204:** No content.

**Error responses:**
- 404 UPLOAD_NOT_FOUND: when the video or its S3 `UploadId` does not exist
- 409 INVALID_UPLOAD_STATE: when the video is not in `UPLOADING`
- 401: when the access token is missing or invalid

---

#### GET /videos/:id (SI-03.8)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- id: string
- status: `UPLOADING` | `PROCESSING` | `READY` | `FAILED`
- title: string | null
- duration_seconds: number | null — presente quando `READY`
- thumbnail_url: string | null — presigned `GET` do thumbnail, presente quando `READY`

**Error responses:**
- 404 UPLOAD_NOT_FOUND: when the video does not exist
- 401: when the access token is missing or invalid

---

#### GET /videos/:id/stream (SI-03.9)

**Response 200:**
- url: string — presigned `GET` URL de curta duração, compatível com `HTTP Range`
- expires_in: number — segundos até a URL expirar

**Error responses:**
- 404 UPLOAD_NOT_FOUND: when the video does not exist
- 409 VIDEO_NOT_READY: when the video is not in `READY`

---

#### GET /videos/:id/download (SI-03.9)

**Response 200:**
- url: string — presigned `GET` URL de curta duração com `Content-Disposition: attachment`

**Error responses:**
- 404 UPLOAD_NOT_FOUND: when the video does not exist
- 409 VIDEO_NOT_READY: when the video is not in `READY`

### Authorization Matrix

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ | ✓ | — |
| POST /videos/:id/upload/parts | ✗ | ✓ | — |
| POST /videos/:id/upload/complete | ✗ | ✓ | — |
| POST /videos/:id/upload/abort | ✗ | ✓ | — |
| GET /videos/:id | ✗ | ✓ | — |
| GET /videos/:id/stream | ✓ | ✓ | — |
| GET /videos/:id/download | ✓ | ✓ | — |

Upload/management endpoints are authenticated; streaming/download of public videos is anonymous (all videos are effectively public in Phase 03 — visibility lands in Fase 04). Owner-level enforcement is not applied in this phase: the channel is derived from the authenticated user (phase-03-videos/TD-08 keeps visibility orthogonal).

### Error Catalog

**Error response format** (inherited from phase-02-auth/TD-07 — established in Phase 02):
```
{ statusCode: number, error: string, message: string }
```
The `error` field carries the domain error code; `VALIDATION_ERROR` covers request validation.

| Code | HTTP | Trigger |
|------|------|---------|
| UPLOAD_NOT_FOUND | 404 | A video or its S3 upload session (`UploadId`) referenced by the request does not exist |
| VIDEO_NOT_READY | 409 | Streaming or download URL requested for a video not in `READY` |
| INVALID_UPLOAD_STATE | 409 | Complete/abort requested when the video is not in `UPLOADING` |

### Events/Messages

#### video-processing — job `process`

**Payload:**

```json
{ "videoId": "nanoid(11)" }
```

**Producer:** `VideosService` (Nest API) — enqueues on multipart complete (per phase-03-videos/TD-02)
**Consumer:** `VideoProcessingConsumer` (worker entrypoint, `WorkerHost`) — `ffprobe` probe + thumbnail extraction + status transition to `READY`/`FAILED` (per phase-03-videos/TD-02, TD-04)
**Trigger:** after `POST /videos/:id/upload/complete` completes the S3 multipart upload and the video transitions to `PROCESSING`
**Delivery semantics:** at-least-once — BullMQ `attempts: 3`, exponential backoff; `UnrecoverableError` for permanent failures (e.g., a non-video file) skips retry (per phase-03-videos/TD-02)

The worker reports progress via `job.updateProgress(number)`; the FE surfaces this progress in Fase 04/05.

---

<!-- phase-a-complete -->

## Dependency Map

SI-03.1 (no deps)
└── SI-03.2

SI-03.3 (no deps)

SI-03.1 + SI-03.2
└── SI-03.4

SI-03.3 + SI-03.4
└── SI-03.5
    └── SI-03.6
        └── SI-03.7

SI-03.3
└── SI-03.8

SI-03.4 + SI-03.8
└── SI-03.9

SI-03.2 + SI-03.3 + SI-03.4
└── SI-03.10

SI-03.5 + SI-03.6 + SI-03.7 + SI-03.8 + SI-03.9
└── SI-03.11

Linearized implementation order: SI-03.1 → SI-03.2 + SI-03.3 (parallel) → SI-03.4 → SI-03.5 → SI-03.6 → SI-03.7; SI-03.8 (independent, after SI-03.3); SI-03.9 (after SI-03.8); SI-03.10 (after SI-03.4); SI-03.11 (last, after all endpoint SIs)

---

## Deliverables

- [ ] SI-03.1 — Dependencies and Configuration Namespaces
- [ ] SI-03.2 — Docker Compose: MinIO, Redis, and Worker Service
- [ ] SI-03.3 — Video Entity and Migration
- [ ] SI-03.4 — Object Storage Service and Queue Registration
- [ ] SI-03.5 — Upload Init (POST /videos)
- [ ] SI-03.6 — Presigned Part URLs (POST /videos/:id/upload/parts)
- [ ] SI-03.7 — Upload Complete and Abort
- [ ] SI-03.8 — Video Status (GET /videos/:id)
- [ ] SI-03.9 — Streaming and Download URLs
- [ ] SI-03.10 — Worker: FFmpeg Processing
- [ ] SI-03.11 — OpenAPI Contract Sync

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
