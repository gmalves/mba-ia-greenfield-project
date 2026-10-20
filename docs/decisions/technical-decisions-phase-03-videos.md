---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-20
scope_description: "Backend and infrastructure for video upload (up to 10GB), background processing (queue + FFmpeg worker), object storage, unique video URLs, and streaming/download delivery."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — primary subproject. Owns the object-storage service, the message queue, the FFmpeg video worker, the video entity + lifecycle, and the upload/streaming/download delivery endpoints.
- `next-frontend/` — **no open decision in this document.** Phase 03 declares no screen capability (its deliverables are system-level: upload, processing, streaming, unique URLs). The upload screen and management panel belong to Fase 04; the player page belongs to Fase 05. The FE consumes phase-03 contracts unchanged via the OpenAPI chain (`next-frontend-openapi-typing/TD-01..TD-05`): upload initiation, video status, and streaming/download URLs. Direct FE→storage streaming is already fixed by the C4 diagram (`Rel(frontend, storage, "Streams", "HTTPS")`).

> Cross-doc anchors (already decided — do NOT reopen):
> - **Object storage = "S3 or MinIO"** and **worker = "FFmpeg"** are fixed by `docs/diagrams/software-arch.mermaid`. The queue is the diagram's only `TBD` — resolved here.
> - **Strict BFF:** `next-frontend-config-base/TD-03` — the browser talks only to same-origin `/api/**`; Route Handlers / RSC read `env.API_URL` server-side. Any "browser uploads directly" path must still flow through a BFF Route Handler that issues the presigned URL (the browser talks to object storage, never to the Nest API directly).
> - **Config pattern:** `phase-01-configuracao-base/TD-03` — namespaced `registerAs` configs. Phase 03 adds `storage.config.ts`, `queue.config.ts`, `worker.config.ts` in the same shape.
> - **OpenAPI:** `openapi-docs-nestjs/TD-01..TD-03` — `@nestjs/swagger` + CLI plugin, runtime UI + `openapi.json` export, prod exposure dev/staging only. Phase 03 endpoints (upload session, video status, streaming/download URL issuance) must be decorated so their shapes land in `openapi.json` and propagate to the FE via codegen.
> - **Error envelope:** `phase-02-auth/TD-07` — `{ statusCode, error, message }` with machine-readable `error` codes; phase 03 domain errors (e.g., `UPLOAD_NOT_FOUND`, `VIDEO_NOT_READY`) follow it.
> - **Auth guards:** `phase-02-auth/TD-02` — custom `@nestjs/jwt` guards; upload/management endpoints are authenticated, streaming/download of public videos is anonymous (Fase 05).

---

## TD-01: Object Storage Service

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Videos (up to 10GB) and thumbnails must be stored outside the API filesystem. The C4 diagram names the container "S3 or MinIO". The choice is which storage product the backend targets. Local development runs entirely in Docker Compose, so a self-hostable option that mirrors the production API is strongly preferred. The frontend streams directly from storage (`Rel(frontend, storage, "Streams")`), so the product must expose HTTPS GET (Range-capable) for media.

**Options:**

### Option A: MinIO (self-hosted, S3-compatible API)
- Run MinIO as a Docker Compose service. The backend talks to it via the AWS S3 API (`@aws-sdk/client-s3`) with `endpoint` + `forcePathStyle` pointed at the MinIO service name (`minio`).
- **Pros:** Local dev = production parity (same S3 API, no cloud credentials needed). Matches the diagram's "S3 or MinIO" exactly. Free/self-hosted for dev and small deployments. Swappable to AWS S3 or Cloudflare R2 later by changing endpoint/credentials only (no code change). Supports multipart upload, presigned URLs, and HTTP Range natively.
- **Cons:** One more Compose service + container to run. MinIO is S3-_compatible_, not 100% identical — a few S3 features (e.g., some lifecycle/ACL nuances) differ, irrelevant for this project's scope. Team must operate the storage service in non-AWS environments.

### Option B: AWS S3 (managed, cloud-only)
- Target AWS S3 directly; local dev either uses a real S3 bucket (internet + credentials) or a shim.
- **Pros:** Zero infrastructure to run; managed durability/scale; full S3 feature set.
- **Cons:** Local Docker-only dev breaks without cloud credentials/network. Costs accrue during development. Locks the project to AWS before it has a deploy target (deploy is Fase 07). No offline local development.

### Option C: Cloudflare R2 (managed, S3-compatible)
- Target R2 via the same S3 API; zero egress fees.
- **Pros:** S3-compatible; no egress cost (attractive for a video platform that streams a lot).
- **Cons:** Third-party vendor lock-in, same local-dev problem as Option B (needs internet + credentials), and no self-hosted local equivalent.

### Option D: Local filesystem (Docker volume)
- Store files on a mounted volume; serve them from the API.
- **Pros:** Simplest possible local setup; no extra service.
- **Cons:** No object-storage semantics (no presigned URLs, no native Range/CDN story). The architecture diagram explicitly names "S3 or MinIO", so this is a deliberate divergence. A later migration to object storage touches every storage path. 10GB files on a single volume is a scaling dead-end.

**Recommendation:** **Option A (MinIO + S3 API)** — Local dev parity with production is decisive: the project runs entirely in Docker today and deploys only in Fase 07. MinIO gives the full S3 API (multipart upload, presigned URLs, HTTP Range) with zero cloud dependency, and the `@aws-sdk/client-s3` client makes a future swap to AWS S3 or R2 a config-only change. Options B/C fail the local-only dev constraint; Option D contradicts the architecture and loses presigned-URL + Range semantics.

**Decision:** A (MinIO + S3 API)

---

## TD-02: Message Queue (Background Processing)

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** Video processing (FFmpeg) is heavy and must run out-of-band. The C4 diagram marks the queue as `TBD` — this phase resolves it. The choice is which queue product the API publishes jobs to and the worker consumes from. The API is NestJS 11 on Express; the worker is a Node process in the same codebase (see TD-03). A Redis-backed queue also gives a free cache for future phases (view counts, rate-limit stores).

**Options:**

### Option A: BullMQ (Redis)
- `@nestjs/bullmq` + `bullmq`. Redis as the backing store; `BullModule.registerQueue` on the API side, `@Processor`/`WorkerHost` on the worker side. Built-in retries (`attempts`), backoff, delays, concurrency, job progress, and repeatable jobs.
- **Pros:** NestJS-native integration (`@nestjs/bullmq`) — DI-friendly, decorator-based, first-class docs. Redis is a lightweight, single-purpose dependency already natural to the stack. Rich job semantics (retries, backoff, progress events) map directly to video processing (transcode can report progress; failed jobs retry). BullMQ v6 is the current major, actively maintained. Small operational footprint (one Redis container vs. a full broker).
- **Cons:** Redis is in-memory — queue durability depends on Redis persistence config (AOF/RDB), adequate for this project's scale but not a durable broker like RabbitMQ. Adds Redis as a new infrastructure dependency.

### Option B: RabbitMQ (AMQP)
- `@golevelup/nestjs-rabbitmq` (or `amqplib`). Dedicated message broker with exchanges/routing/acks.
- **Pros:** Purpose-built broker with strong durability, routing, and ack/retry semantics. Battle-tested at scale.
- **Cons:** Heavier operational footprint (broker + management UI + Erlang runtime). AMQP routing model is more complex than the project needs (a single `video-processing` queue). No `@nestjs`-official wrapper — relies on a third-party NestJS integration. Overkill for one queue with one consumer.

### Option C: Apache Kafka
- Distributed event log with `kafkajs` (or Confluent SDK).
- **Pros:** Industry standard for high-throughput event streams; replayable log.
- **Cons:** Heavy operational burden (ZooKeeper/KRaft, brokers, partitioning). Designed for event streaming, not job queues (no native per-job ack/retry semantics like BullMQ). Massively overkill for a single video-processing pipeline. Largest infra cost for the least immediate benefit.

### Option D: AWS SQS
- Managed queue via `@aws-sdk/client-sqs` (or `@ssut/nestjs-sqs`).
- **Pros:** Fully managed, no broker to run.
- **Cons:** Cloud-only — breaks local Docker-only dev. No local equivalent without emulation. Vendor lock-in before a deploy target exists (Fase 07).

**Recommendation:** **Option A (BullMQ + Redis)** — The queue has one producer (API) and one consumer (worker) with a clear retry/progress-shaped workload; BullMQ's job semantics fit exactly and its `@nestjs/bullmq` wrapper is the path of least resistance inside NestJS 11. Redis doubles as a general-purpose cache for later phases. RabbitMQ and Kafka add operational weight the project doesn't need yet; SQS breaks local dev.

**Decision:** A (BullMQ + Redis)

---

## TD-03: Video Worker Topology

**Scope:** Repo-wide

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The C4 diagram models the "Video Worker (FFmpeg)" as its own container, separate from the API. The decision is _how_ that container is produced and run: does it share the NestJS codebase/image, or is it a separate application? This determines the Compose topology, the Dockerfile/build strategy, and where the FFmpeg binary lives (it must be present in the worker, and preferably absent from the API image to keep it lean).

**Options:**

### Option A: Same codebase, dedicated worker Compose service (shared image, worker entrypoint)
- The NestJS app keeps one codebase. A second Compose service (`video-worker`) runs the same built image but boots a dedicated entrypoint that only connects the BullMQ queue and runs `@Processor` consumers — never the HTTP server. FFmpeg/ffprobe are installed in the shared image (or a worker-only stage).
- **Pros:** One codebase, one build, one set of entities/modules — the worker reuses `VideosModule` logic without duplication. Matches the diagram's separate-container model while keeping a single deploy artifact. Separating the HTTP and worker entrypoints isolates queue consumption from request serving (a crash in one doesn't take down the other). `@nestjs/bullmq`'s `WorkerHost` consumers are the same code whether booted via HTTP or worker entrypoint.
- **Cons:** A single image means FFmpeg is either baked into both containers or requires a multi-stage build where only the worker stage adds FFmpeg (a small Dockerfile nuance). Two long-running processes to orchestrate in Compose.

### Option B: Separate worker package/app (own node_modules, own deploy)
- A new package (e.g., `video-worker/`) with its own `package.json`, Dockerfile, and deploy path, sharing types via a common package or duplicated code.
- **Pros:** Total isolation — worker has its own dependency graph (FFmpeg-only), scales/deploys independently, can be in a different language (e.g., a raw Node/FFmpeg script) if ever needed.
- **Cons:** Duplicates entity/module logic or forces a shared-package extraction (a larger monorepo refactor). Two dependency trees to maintain, two CI pipelines. Overkill for a worker that consumes the same DB/entity model the API already defines.

### Option C: Consume the queue inside the API process (no separate container)
- The API process registers the `@Processor` alongside the HTTP server; no worker service at all.
- **Pros:** Simplest — one process, one container, zero new Compose service.
- **Cons:** **Contradicts the C4 diagram** (worker is a distinct container). FFmpeg processing (CPU-heavy) competes with request serving for CPU/memory in the same process — a long transcode degrades API latency, which is exactly the "sem travar o sistema" concern this phase exists to solve. A crashed FFmpeg process can take the API down. FFmpeg would have to be in the API image.

**Recommendation:** **Option A (Same codebase, dedicated worker service)** — It honors the architecture's separate-container model while avoiding the code-duplication of Option B: the worker is a second entrypoint of the same Nest app, booted as a Compose service that consumes the queue without opening the HTTP port. The FFmpeg dependency is isolated to the worker stage/image. Option C is rejected because in-process processing reintroduces the resource contention the phase is designed to avoid.

**Decision:** A (Same codebase, dedicated worker service)

---

## TD-04: FFmpeg Execution Approach

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker must (a) extract duration and metadata from the uploaded video (ffprobe) and (b) generate a thumbnail from a video frame (ffmpeg). The choice is how Node invokes FFmpeg: through a wrapper library, a self-contained npm binary, or a bare subprocess. This runs only in the worker container (TD-03), never in the API.

**Options:**

### Option A: fluent-ffmpeg (wrapper) + FFmpeg installed in the worker image
- `fluent-ffmpeg` provides a fluent Node API over the `ffmpeg`/`ffprobe` binaries; the binaries are installed in the worker Docker image (apt-get or a base image with FFmpeg).
- **Pros:** Readable, composable API for the exact operations needed (probe metadata, extract a frame at a timestamp as a JPEG/PNG thumbnail, optionally transcode). Widely used, mature. Binaries live in the image (not node_modules), so builds stay deterministic and platform-correct. Decouples the JS wrapper from the binary version (upgrade FFmpeg by bumping the image).
- **Cons:** Requires FFmpeg/ffprobe to be present at runtime (the Docker image must install them) — a small image-build cost. fluent-ffmpeg wraps a CLI, so some advanced flags still need `.outputOptions()`.

### Option B: ffmpeg-static (npm-bundled static binaries)
- `ffmpeg-static` + `ffprobe-static` download platform-specific binaries at install time into node_modules; invoke them directly.
- **Pros:** No system install needed — the binary ships with the npm package. Simplest local setup.
- **Cons:** Binaries land in node_modules (large, platform-specific, tied to the npm lifecycle — a fresh `npm install` re-downloads them; a platform mismatch breaks silently). Less control over the exact FFmpeg version/patches. Pollutes the API image if not carefully scoped to the worker.

### Option C: Bare `child_process` + system FFmpeg (no wrapper)
- Spawn `ffmpeg`/`ffprobe` directly via `child_process.spawn`, parse stdout/JSON manually.
- **Pros:** Zero npm wrapper dependency; full control; minimal surface.
- **Cons:** Hand-rolled argument building and stdout/stderr parsing for every operation (probe JSON, frame extraction, error handling) — reinventing what fluent-ffmpeg already provides. More error-prone (quoting, escaping, exit-code handling).

**Recommendation:** **Option A (fluent-ffmpeg + image-installed FFmpeg)** — The wrapper eliminates the argument/parsing boilerplate for the two concrete operations (probe + frame extraction) without the node_modules-binary coupling of Option B. Installing FFmpeg in the worker image (not via ffmpeg-static) keeps the binary version explicit and out of the API image. Option C is rejected as re-implementing a solved wrapper.

**Decision:** A (fluent-ffmpeg + image-installed FFmpeg)

---

## TD-05: Upload Protocol for Large (10GB) Files

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** The phase requires uploading files up to 10GB "sem travar o sistema" and — per the project's Pontos de Atenção — resumable after a connection failure. The C4 diagram shows `api → storage "Uploads"`, but relaying 10GB _through_ the Nest API would saturate its memory/CPU, exactly the failure this phase forbids. The decision is the protocol that lets a 10GB upload reach object storage without the API acting as a byte-relay, while respecting the strict-BFF model (the browser never talks to the Nest API directly; it may talk to object storage via a presigned URL issued by a BFF Route Handler).

**Options:**

### Option A: Presigned S3 multipart upload (browser → storage, API coordinates)
- The BFF Route Handler calls the backend, which creates an S3 multipart upload session (or returns per-part presigned URLs). The browser splits the file into ≥5MB parts and `PUT`s each directly to storage with a presigned URL, then asks the API to complete/abort the multipart upload. Resume = query `ListParts` and re-upload only missing parts.
- **Pros:** **10GB never passes through the API** — the browser uploads directly to storage, so the API stays responsive (the core "sem travar o sistema" requirement). **Native resumability** via multipart part semantics (retry a failed part, list completed parts). Uses only the S3 API already adopted in TD-01 — no extra service or protocol. Progress is client-computed (per-part completion) and reported to the API on complete. Fits the strict-BFF model: the browser talks to MinIO (not Nest) for bytes; Nest only issues/validates the session.
- **Cons:** Resumability is manual on the client — the upload library must track parts and re-request presigned URLs for incomplete parts (the AWS SDK's `Upload`/`lib-storage` or a thin wrapper handles this, but it's more client logic than a single `PUT`). Requires the API to coordinate session state (init/complete/abort endpoints) and to enforce size/type limits at the presign step.

### Option B: tus resumable upload protocol (tus-js-client + tus server)
- Adopt the tus.io protocol: the browser uses `tus-js-client` to POST/PATCH a `tusd` or `tus-node-server` (with an S3 backend) that reassembles chunks into storage. Resume is built into the protocol (`Upload-Offset` header).
- **Pros:** **Resumability is first-class** — the protocol itself handles offsets and resume, no custom part-tracking. Well-specified (tus.io spec), good client libraries.
- **Cons:** **Adds a dedicated tus server** (tusd container or tus-node-server) between the browser and storage — a new service to run, secure, and scale. Diverges from the S3-native multipart model adopted in TD-01 (tus is a shim over S3, not the S3 way). The API still needs upload-session endpoints; the browser still needs the BFF to mint the tus endpoint/credentials. More moving parts for a single upload flow.

### Option C: Backend-proxied streaming (browser → Nest → S3)
- The browser `POST`s the file (single or chunked `multipart/form-data`) to the BFF, which streams it through Nest into S3 via `Upload`/`lib-storage`.
- **Pros:** Simplest mental model — one `fetch` to the API; no presigned URLs, no client-side multipart logic. Everything stays behind the BFF.
- **Cons:** **10GB flows through the Nest process** — memory/CPU spikes, request timeouts, and exactly the "travar o sistema" failure this phase forbids. No built-in resume (a dropped connection loses the upload; retry = full re-upload). File-size limits collide with Express/body-parser defaults and require careful streaming config. Directly violates the phase's core non-functional requirement.

### Option D: Custom chunked upload (API reassembles)
- Custom endpoints (`init`, `chunk N/M`, `complete`) where the browser posts fixed chunks to the API, which writes them to storage.
- **Pros:** Full control over chunk size, resume, and progress reporting.
- **Cons:** Re-invents resumable-upload semantics that Options A/B already standardize; the API is still a byte-relay (chunks flow through Nest); error/edge-case handling (out-of-order chunks, missing chunk, concurrent completes) is substantial custom code with a high bug surface.

**Recommendation:** **Option A (Presigned S3 multipart upload)** — It is the only option that simultaneously (1) keeps 10GB off the API (the phase's central requirement), (2) provides resumability at no extra-service cost (S3 multipart part semantics), and (3) reuses the storage stack already chosen in TD-01 without introducing a tus server (Option B) or relaying bytes through Nest (Options C/D). The resumability is client-managed, which is acceptable: the AWS SDK `Upload`/`lib-storage` and browser-side wrappers handle part tracking, and the FE upload screen (Fase 04) consumes a BFF `init → presigned part URLs → complete` sequence. The diagram's `api → storage "Uploads"` is satisfied by the API coordinating the upload and the worker writing processed output — not by relaying user bytes.

**Decision:** A (Presigned S3 multipart upload)

---

## TD-06: Video Delivery — Streaming and Download

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Once a video is processed, the user must be able to (a) start playback without downloading the whole file (streaming) and (b) download it explicitly. The C4 diagram fixes that the frontend streams directly from storage (`Rel(frontend, storage, "Streams")`). The decision is the delivery mechanism: progressive byte-range over HTTP, or a segmented adaptive-bitrate protocol (HLS/DASH). It also settles how download is delivered (the same presigned GET with an attachment disposition).

**Options:**

### Option A: HTTP Range (progressive) + presigned GET download
- Serve the original file from storage over HTTP with `Range`/`206 Partial Content` support. The `<video>` element requests byte ranges for seeking (start playback without full download). The API issues a short-lived presigned `GET` URL for the media. Download = the same presigned GET with `response-content-disposition=attachment` (or a `Content-Disposition` header the storage sets per-key).
- **Pros:** **No transcoding pipeline** — the uploaded file is served as-is; playback and seek work via byte ranges natively supported by object storage and all browsers. **Matches the diagram exactly** (frontend streams from storage over HTTPS). Simplest possible delivery (one presigned-URL mechanism covers both streaming and download). 10GB files stream fine — the browser pulls only the bytes it needs.
- **Cons:** **Single quality** — no adaptive bitrate (a low-bandwidth viewer gets the one uploaded rendition). Seeking beyond the buffered window re-requests ranges (fine, but no client-side playlist). Presigned URLs are time-limited, so long playback sessions need the FE to refresh the URL (handled by re-requesting from the BFF).

### Option B: HLS (transcode to segments + playlist)
- FFmpeg transcodes the upload into HLS segments (`-f hls`) at one or more bitrates; the frontend plays an `.m3u8` manifest; delivery is many small segment GETs.
- **Pros:** **Adaptive bitrate** — multiple renditions, quality switching, resilient to variable bandwidth. Segments are CDN/edge-cache friendly. The de-facto standard for long-form video.
- **Cons:** **Adds a transcoding pipeline** (CPU-heavy, multiplies storage for segments, more worker work and failure modes). Significantly more complex than the phase requires — the deliverable is "streaming without full download", not adaptive quality. Segment lifecycle/cleanup becomes a new concern. Would delay Phase 03 materially for a capability the plan does not ask for yet.

### Option C: MPEG-DASH
- Similar to HLS but with a DASH manifest (`.mpd`); served via HTTP.
- **Pros:** Codec-agnostic, adaptive bitrate.
- **Cons:** **Less universal browser support** than HLS (Safari/iOS prefers HLS; DASH needs MSE). Same transcoding-pipeline cost as Option B with a smaller playback-ecosystem payoff. Rejected on the same grounds as B, plus weaker native support.

**Recommendation:** **Option A (HTTP Range + presigned GET)** — The phase requirement is "reprodução via streaming (sem necessidade de download completo)", which HTTP Range satisfies directly (byte-range seeking = no full download) at near-zero cost, with no transcoding and no new storage layout. It matches the C4 diagram's direct FE→storage streaming. HLS/DASH (Options B/C) buy adaptive bitrate, which the plan does not require in Phase 03 and which would force a whole transcoding pipeline into the worker — a decision better made when a multi-bitrate requirement actually appears. Download reuses the same presigned-GET mechanism with `Content-Disposition: attachment`.

**Decision:** A (HTTP Range + presigned GET)

---

## TD-07: Unique Video Identifier / URL

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a short, unique, URL-safe identifier that never collides with another video and serves as the public `GET /videos/:id` segment and the object-storage key prefix. The project's Pontos de Atenção add: "cada vídeo precisa de uma URL curta e única". The choice is the ID scheme.

**Options:**

### Option A: nanoid (URL-safe, fixed short length)
- Generate a URL-safe random ID with a custom alphabet and short length (e.g., 11 chars ≈ YouTube-style length, collision-safe at project scale).
- **Pros:** **Short and URL-clean** (`[A-Za-z0-9_-]`), non-sequential (no enumeration of videos), no coordination/DB round-trip to generate (no sequence, no central counter). Collision probability negligible at any realistic video count. Fits the "URL curta e única" requirement directly.
- **Cons:** Random IDs are not sortable by creation time (unlike ULID) — acceptable, ordering comes from a `createdAt` column. Requires a uniqueness check on insert (near-certain pass, but enforce at the DB level).

### Option B: UUID v4
- Standard 36-char UUID (`8-4-4-4-12`).
- **Pros:** Ubiquitous, no dependency (or `crypto.randomUUID()` built-in), collision-safe by construction.
- **Cons:** **Long and hyphenated** — poor URL ergonomics vs. the "URL curta" requirement; leaks nothing but wastes path space. No meaningful benefit over nanoid for a public ID.

### Option C: cuid2
- Collision-resistant, roughly-sortable, ~24 chars.
- **Pros:** Collision-resistant with high-security randomness; includes some monotonicity.
- **Cons:** **Longer than needed** (24 chars vs. 11). The monotonic/sortable property is a non-requirement (videos order by `createdAt`). Extra dependency for a property the project doesn't use.

### Option D: Auto-increment + base62 (YouTube-style)
- Encode a DB sequence/auto-increment ID in base62 (`1` → `b`, etc.).
- **Pros:** Shortest possible IDs; human-readable; deterministic.
- **Cons:** **Sequential = enumerable** — anyone can scrape video IDs in order, leaking upload volume and enabling mass crawling. Requires a central sequence (DB sequence or a counter service) — a coordination point. Shortness here isn't worth the enumeration/privacy cost for a platform where anonymous browsing is central.

**Recommendation:** **Option A (nanoid, ~11 chars URL-safe)** — It delivers the "URL curta e única" requirement with the smallest ID that is still non-sequential and collision-safe, with no coordination point and no extra ordering complexity. UUID (B) is too long, cuid2 (C) buys unused monotonicity, and base62 (D) reintroduces sequential enumeration that hurts a platform with anonymous browsing.

**Decision:** A (nanoid, ~11 chars URL-safe)

---

## TD-08: Video Lifecycle / Status State Machine

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** The upload flow requires the video row to exist _before_ the bytes arrive ("pré-cadastro automático do vídeo como rascunho ao iniciar o upload") and to move through processing states after. The FE (Fases 04/05) must render a deterministic status ("processing…", "ready", "failed") during and after processing. The decision is how to model this lifecycle so that the pre-cadastro state, processing outcome, and phase-04 visibility (draft/public/unlisted) are all represented without ambiguity.

**Options:**

### Option A: Explicit enum status state machine
- A `status` enum on the video row: `UPLOADING` (pre-cadastro, before bytes complete) → `PROCESSING` (worker claimed job) → `READY` (processing succeeded), plus `FAILED` (processing errored, with an error detail). Visibility (draft/public/unlisted) is a separate concern handled in Fase 04.
- **Pros:** **Single source of truth for "what state is this video in"** — the FE can render "processing…" deterministically off `status`. The pre-cadastro requirement maps 1:1 to the `UPLOADING` state. Worker updates are idempotent (`UPLOADING→PROCESSING→READY|FAILED`) and observable. Easy to enumerate and validate. Keeps processing state decoupled from visibility (Fase 04), so phase-04 changes don't rewrite phase-03 semantics.
- **Cons:** An enum column to maintain (additive, cheap). Requires the API to expose the status in the video DTO and to reject reads/writes in invalid states (a small guard).

### Option B: Boolean flags (isUploaded, isProcessed, processingError)
- Model state as independent booleans rather than a single enum.
- **Pros:** Avoids "choosing a status vocabulary" upfront.
- **Cons:** **Invalid combinations are representable** (e.g., `isProcessed=true` with a `processingError` set) — the machine's invariants live in scattered checks, not the type. Harder for the FE to switch on ("which of 3 booleans do I read?"). No clean idempotent transition the worker can assert.

### Option C: Timestamp-derived status (no explicit status column)
- Infer state from nullable timestamps (`uploadStartedAt`, `uploadCompletedAt`, `processingCompletedAt`, `failedAt`).
- **Pros:** No status column; state is implied by which timestamps are set.
- **Cons:** **State is recomputed by convention**, not stored — every reader (API, FE, worker) must agree on the timestamp→state mapping; adding a state later breaks the convention. Failure reason still needs a column anyway. Obscure and error-prone for the FE's "processing…" UI.

**Recommendation:** **Option A (Explicit enum state machine)** — The pre-cadastro requirement is fundamentally a state-modeling decision: the row is created in `UPLOADING` before bytes arrive, then transitions deterministically through `PROCESSING` to `READY`/`FAILED`. An explicit enum makes those transitions type-checked, idempotent for the worker, and trivially consumable by the FE's status UI, while keeping Fase 04's visibility concern (draft/public/unlisted) orthogonal. Options B/C trade a tiny amount of upfront vocabulary for scattered invariants and convention-based state that the FE and worker would each re-implement.

**Decision:** A (Explicit enum state machine)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Object Storage Service | **A** (MinIO + S3 API) | A |
| TD-02 | Backend | Message Queue | **A** (BullMQ + Redis) | A |
| TD-03 | Repo-wide | Video Worker Topology | **A** (Same codebase, dedicated worker service) | A |
| TD-04 | Backend | FFmpeg Execution Approach | **A** (fluent-ffmpeg + image-installed FFmpeg) | A |
| TD-05 | Cross-layer | Upload Protocol (10GB) | **A** (Presigned S3 multipart upload) | A |
| TD-06 | Cross-layer | Video Delivery (Streaming + Download) | **A** (HTTP Range + presigned GET) | A |
| TD-07 | Backend | Unique Video Identifier / URL | **A** (nanoid, ~11 chars URL-safe) | A |
| TD-08 | Backend | Video Lifecycle / Status State Machine | **A** (Explicit enum state machine) | A |
