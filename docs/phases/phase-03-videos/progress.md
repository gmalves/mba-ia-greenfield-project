# phase-03-videos — Progress

**Status:** completed
**SIs:** 11/11 completed

### SI-03.1 — Dependencies and Configuration Namespaces
- **Status:** completed
- **Tests:** 11 passing
- **Observations:**
  - **ioredis deviation:** plan pinned `ioredis@^6.0.0`, but `typeorm@0.3.28` declares `peerOptional ioredis@^5.0.4`; npm failed with ERESOLVE. Installed `ioredis@^5.11.1` (satisfies typeorm `^5.0.4` and bullmq `>=5.0.0`). Deviation approved by operator.
  - **`.env.example` follow-up:** NOT extended — a global environment permission rule blocks `.env*` files by design. `env.validation.ts` already covers every new var; the operator will apply `STORAGE_*`/`REDIS_*`/`WORKER_*` to `.env.example` manually outside this session.
  - **nanoid@6.0.2 engine note:** declares engines `^22 || ^24 || >=26`; container runs node 25.6.0 (EBADENGINE warning only — `require('nanoid')` verified working at runtime).

### SI-03.2 — Docker Compose: MinIO, Redis, and Worker Service
- **Status:** completed
- **Tests:** no tests (infra)
- **Observations:**
  - **MinIO image deviation:** plan pinned `minio/minio` (Docker Hub), but MinIO removed its public Docker Hub images (~Sep 2026) and `quay.io/minio/minio` now requires auth (401). Replaced with `pgsty/silo:latest` (community MinIO fork preserving S3 API, `MINIO_*` env vars and the `server` command). Bucket creation moved to a `minio-init` one-shot service (`mc mb --ignore-existing`) because this fork ignores `MINIO_DEFAULT_BUCKETS`.
  - **worker entrypoint deferred:** the `worker` service builds the shared dev image `target: worker` (with FFmpeg) but holds a placeholder (`tail -f /dev/null`); the real `start:worker` entrypoint lands in SI-03.10. The AC "registra conexão com a fila `video-processing` nos logs" is only observable after SI-03.4 + SI-03.10.

### SI-03.3 — Video Entity and Migration
- **Status:** completed
- **Tests:** 8 passing (6 entity + 2 migrations)
- **Observations:**
  - Fixed a pre-existing idempotency gap in `migrations.integration-spec.ts`: `beforeAll` dropped tables but not Postgres enum types, so `CREATE TYPE` failed (and Jest hung on the open DB handle) on re-runs once `videos_status_enum` was introduced. Added explicit `DROP TYPE IF EXISTS ... CASCADE` for both enum types.
  - `size_bytes` (bigint) and `duration_seconds` (numeric) use a TypeORM transformer so the entity exposes `number | null` — Postgres returns both as strings by default.
  - `Video → Channel` is modeled unidirectional (`@ManyToOne(() => Channel)`, no inverse on `Channel`) since the plan's Data Model only specifies the many-to-one direction.

### SI-03.4 — Object Storage Service and Queue Registration
- **Status:** completed
- **Tests:** 5 passing (4 storage + 1 queues)
- **Observations:**
  - Added `transformIgnorePatterns` to both Jest configs (`package.json` and `test/jest-e2e.json`) because `@nestjs/bullmq` and `@nestjs/bull-shared` ship ESM-only (`type: module`); Jest's runtime cannot `require` ESM, so ts-jest now transpiles those two packages. `bullmq` and `ioredis` are CJS (dual) and remain ignored.
  - `QueuesModule` uses `exports: [BullModule]` so downstream modules (VideosModule in SI-03.5) can `@InjectQueue('video-processing')` across the module boundary.

### SI-03.5 — Upload Init (POST /videos)
- **Status:** completed
- **Tests:** 6 passing (2 unit + 1 integration + 3 e2e)
- **Observations:**
  - Implemented `initUpload(dto, userId)` (the SI wrote `initUpload(dto, channelId)`): the service resolves the channel from `userId` internally (injecting `Repository<Channel>`) so the controller stays thin and `ChannelsService` is left untouched; the Video's `channel_id` is still the authenticated user's channel.
  - Added `nanoid` to `transformIgnorePatterns` in both Jest configs — nanoid@6 is ESM-only (`type: module`, no CJS build), the same failure mode as `@nestjs/bullmq`.
  - `CreateVideoDto` uses only class-validator decorators + JSDoc (no manual `@ApiProperty`), per the `nestjs-dtos` rule — the Swagger CLI plugin auto-generates the OpenAPI schema.

### SI-03.6 — Presigned Part URLs (POST /videos/:id/upload/parts)
- **Status:** completed
- **Tests:** 10 passing (5 unit + 2 integration + 3 e2e)
- **Observations:**
  - `videos.service.integration-spec.ts` now uses a real `StorageService` (against local MinIO) rather than the SI-03.5 mock, because the SI-03.6 test requires real presigned URLs; the `initUpload` integration test was migrated to real storage in the process.

### SI-03.7 — Upload Complete and Abort
- **Status:** completed
- **Tests:** 17 passing (9 unit + 4 integration + 4 e2e)
- **Observations:**
  - The E2E "complete-upload" scenario performs a real part upload (presigned PUT via `fetch`) to obtain a real ETag before completing, because MinIO validates ETags on `CompleteMultipartUploadCommand` — the spec's literal `etag: "etag1"` placeholder would fail against real storage.

### SI-03.8 — Video Status (GET /videos/:id)
- **Status:** completed
- **Tests:** 20 passing (12 unit + 5 integration + 3 e2e)
- **Observations:** none

### SI-03.9 — Streaming and Download URLs
- **Status:** completed
- **Tests:** 26 passing (16 unit + 6 integration + 4 e2e)
- **Observations:** none

### SI-03.10 — Worker: FFmpeg Processing
- **Status:** completed
- **Tests:** 3 passing (2 unit + 1 integration)
- **Observations:**
  - The consumer is registered in a separate `VideoProcessingModule` (not `VideosModule`/`AppModule`); `src/worker.ts` boots `AppModule + VideoProcessingModule` via a bootstrap module instead of the SI's literal `createApplicationContext(AppModule)`. This keeps the API/HTTP process (and the E2E test app) from registering the BullMQ worker, isolating queue consumption to the worker (TD-03).
  - Added `ffmpeg` to the `Dockerfile.dev` `dev` stage so the worker integration test (real ffprobe/ffmpeg) runs inside `nestjs-api`; the `worker` stage already had it. Generated a tiny MP4 fixture (`test/fixtures/sample.mp4`, ~2.8KB) for that test.
  - fluent-ffmpeg's `screenshots` `filenames` event emits the bare filename, not the full path; the consumer joins it with `tmpDir` before reading the thumbnail.

### SI-03.11 — OpenAPI Contract Sync
- **Status:** completed
- **Tests:** no tests (openapi.json export verification)
- **Observations:**
  - Changed `openapi:export` from `ts-node ... src/openapi-export.ts` to `nest build && node dist/openapi-export.js`: the ts-node path does not apply the `@nestjs/swagger` CLI plugin (`classValidatorShim`), so DTO schemas exported empty (`properties: {}`). The compiled path injects the `__OPENAPI_METADATA_FACTORY__` metadata, producing full field schemas (`minimum`/`maximum` from `@Min`/`@Max`, `minItems` from `@ArrayNotEmpty`, JSDoc descriptions). This also fixed the pre-existing empty phase-02 auth DTO schemas.

## Verification Follow-ups (operator, outside the implement session)

After the final verification, the canonical full-suite run (outside the implement session) surfaced and fixed three gaps:

1. **E2E idempotency:** `cleanAllTables` did not delete `videos` (FK to `channels`) and jest ran e2e suites in parallel against the same database — re-runs failed with cross-suite contamination. Fixed: `DELETE FROM "videos"` first and `maxWorkers: 1` in `test/jest-e2e.json` (matching the documented `--runInBand` policy). Verified with two consecutive green e2e runs.
2. **Client-reachable presigned URLs:** URLs were signed with the internal endpoint (`minio:9000`), reachable only inside the Compose network. Added `STORAGE_PUBLIC_ENDPOINT` — client-facing URLs (upload parts, stream, download, thumbnail) are now signed against it, while internal calls (worker download) keep using `STORAGE_ENDPOINT`. Tests pin the internal endpoint via `setup-env.ts` (both jest configs).
3. **Functional smoke (from the host, outside Docker):** register → confirm → login → `POST /videos` → presigned part → real PUT to `localhost:9000` → complete → worker processed (FFmpeg) → `READY` → stream URL with `Range` returned `206` and correct bytes. `videos.service.spec.ts` updated for the new `getClientGetUrl` method.
