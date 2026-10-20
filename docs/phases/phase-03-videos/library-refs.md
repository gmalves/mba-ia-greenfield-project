---
libs:
  "@nestjs/bullmq":
    version: "^12.0.0"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-10-20T13:50:05-03:00"
  bullmq:
    version: "^6.3.19"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-20T13:50:05-03:00"
  ioredis:
    version: "^6.0.0"
    context7_id: "/redis/ioredis"
    fetched_at: "2026-10-20T13:50:05-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1153.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-20T13:50:05-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1153.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-20T13:50:05-03:00"
  fluent-ffmpeg:
    version: "^2.1.3"
    context7_id: "/fluent-ffmpeg/node-fluent-ffmpeg"
    fetched_at: "2026-10-20T13:50:05-03:00"
  "@types/fluent-ffmpeg":
    version: "^2.1.28"
    context7_id: "/fluent-ffmpeg/node-fluent-ffmpeg"
    fetched_at: "2026-10-20T13:50:05-03:00"
  nanoid:
    version: "^6.0.2"
    context7_id: "/ai/nanoid"
    fetched_at: "2026-10-20T13:50:05-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-20T13:21:45-03:00"
---

# phase-03-videos — Library References

Distilled docs for libraries decided in this slice. Pulled via Context7. Re-fetch when the underlying TD changes (resolve refreshes this file when the lib set in `## Decisions Index` drifts from the cached set here).

## @nestjs/bullmq

**Source:** `/nestjs/bull` (Context7) — High reputation, 316 snippets, benchmark 86.72. Maps to `phase-03-videos/TD-02` Decision A (BullMQ wrapper inside NestJS 11). Version confirmed via `npm view` (`latest` = 12.0.0); peer deps `@nestjs/core`/`@nestjs/common` `^10 || ^11 || ^12` and `bullmq ^3 || ^4 || ^5 || ^6`, so 12.0.0 is compatible with the project's NestJS 11 + bullmq 6.

### Global config: `forRoot` / `forRootAsync`

The shared Redis connection is configured once via `forRoot`. Per the config pattern (`phase-01-configuracao-base/TD-03`), `queue.config.ts` is a namespaced `registerAs` and the connection is wired through `ConfigService` with `forRootAsync`:

```typescript
// queue.config.ts — namespaced registerAs, same shape as storage.config.ts / worker.config.ts
import { registerAs } from "@nestjs/config";

export default registerAs("queue", () => ({
  host: process.env.REDIS_HOST ?? "redis",   // Docker Compose service name, never localhost
  port: Number(process.env.REDIS_PORT ?? 6379),
}));

// queues.module.ts
import { BullModule } from "@nestjs/bullmq";

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: config.get("queue"),
      }),
    }),
  ],
})
export class QueuesModule {}
```

### Registering a queue: `registerQueue`

`registerQueue` registers a queue provider (injectable via `@InjectQueue`) and — when `processors` are passed — also creates the workers for that queue. The API side only registers queues; the worker side (TD-03) additionally declares the processors.

```typescript
BullModule.registerQueue({
  name: "video-processing",
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
});
```

### Producer: `@InjectQueue`

```typescript
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

@Injectable()
export class VideoProcessingService {
  constructor(@InjectQueue("video-processing") private readonly queue: Queue) {}

  async enqueue(videoId: string) {
    await this.queue.add("process", { videoId });
  }
}
```

`@InjectQueue(name)` resolves the token `BullQueue_<name>` (or `BullQueue_default`); the injected type is bullmq's `Queue`.

### Consumer: `@Processor` + `WorkerHost`

```typescript
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";

@Processor("video-processing", { concurrency: 1 })
export class VideoProcessingConsumer extends WorkerHost {
  async process(job: Job<{ videoId: string }>): Promise<void> {
    // probe + thumbnail via fluent-ffmpeg, update the video row to READY
  }
}
```

### Integration notes (TD-02 + TD-03)

- **One queue, one producer (API) and one consumer (worker).** The API module imports `registerQueue({ name: "video-processing" })` without `processors`; the worker entrypoint (TD-03 Decision A) boots the same `VideosModule`/`VideoProcessingConsumer` via `NestFactory.createApplicationContext(...)` — connecting the queue and starting `WorkerHost` consumers without ever opening the HTTP server. `@nestjs/bullmq` attaches an `onApplicationShutdown` hook that closes workers, the queue, and (with `forceDisconnectOnShutdown`) the Redis connection.
- **`defaultJobOptions` at register time** is the idiomatic place for `attempts`/`backoff`, matching the "failed jobs retry" requirement.
- **Config via `forRootAsync` + `ConfigService`** (not literals), consistent with `phase-01-configuracao-base/TD-03`. Redis host is the Compose service name `redis`, per the Docker networking rule.

---

## bullmq

**Source:** `/taskforcesh/bullmq` (Context7) — High reputation, 4244 snippets, benchmark 68.67. Maps to `phase-03-videos/TD-02` Decision A (queue engine under `@nestjs/bullmq`). **Version flag:** Context7 indexes `v6.3.11`; `npm view bullmq version` reports `6.3.19` (latest). The API patterns below are unchanged across 6.3.x.

### Job options (`Queue.add`)

The API adds jobs with retry/backoff/cleanup options; the Nest path forwards these via `defaultJobOptions` in `registerQueue`:

```typescript
await queue.add("process", { videoId }, {
  attempts: 3,                                    // retry up to 3 times
  backoff: { type: "exponential", delay: 1000 },  // 1s, 2s, 4s…
  removeOnComplete: true,                         // clean up finished jobs
  removeOnFail: 100,                              // keep last 100 failed jobs for inspection
});
```

### Worker options

`concurrency` (default 1) caps parallel jobs per worker. A custom retry delay is set via `settings.backoffStrategy`:

```typescript
import { Worker } from "bullmq";

const worker = new Worker("video-processing", async (job) => processVideo(job), {
  connection: { host: "redis", port: 6379 },
  concurrency: 1,
  settings: {
    backoffStrategy: (attemptsMade: number) => attemptsMade * 1000,
  },
});
```

### Retry semantics

A job retries while `attemptsMade + 1 < opts.attempts`; the computed backoff delay moves it to `delayed`, else it lands in `failed`. Throwing an `UnrecoverableError` (from `bullmq`) skips retry and fails the job immediately — the escape hatch for permanent failures (e.g., a probe that reports a non-video file).

### Progress reporting

The worker reports processing progress with `job.updateProgress(number)`, observable by the API (or a `QueueEvents` listener) — maps to the transcode/probe progress the FE surfaces in Fase 04/05.

---

## ioredis

**Source:** `/redis/ioredis` (Context7) — High reputation, 9434 snippets, benchmark 76.24 (indexed versions v5.4.0 / v6.0.0; `npm view` confirms latest `6.0.0`). Maps to `phase-03-videos/TD-02` — BullMQ declares `ioredis: >=5.0.0` as an optional peer, so it is only a direct dependency if the project constructs the Redis connection explicitly rather than letting BullMQ build its own client from `{ host, port }`.

### Connection + retry options

```typescript
import Redis from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST ?? "redis",
  port: Number(process.env.REDIS_PORT ?? 6379),
  lazyConnect: false,               // connect immediately (default)
  retryStrategy(times: number) {    // default: exp backoff capped 5s + jitter
    const jitter = Math.floor(Math.random() * 200);
    return Math.min(Math.pow(2, times - 1) * 50, 5000) + jitter;
  },
});
```

### Key option for BullMQ: `maxRetriesPerRequest`

`maxRetriesPerRequest` (default 20) bounds how many reconnects a queued command waits through before being flushed with `MaxRetriesPerRequestError`. For a **worker** connection — where BullMQ uses long-lived blocking commands (BRPOPLPUSH) — set it to `null` so commands wait indefinitely through reconnects instead of erroring mid-job:

```typescript
new Redis({ host: "redis", port: 6379, maxRetriesPerRequest: null });
```

### Integration note (TD-02)

BullMQ accepts a connection in two forms: the `{ host, port }` options object (BullMQ instantiates its own ioredis client) or a prebuilt `Redis` instance passed as `connection`. Use the explicit `ioredis` instance only when the project needs to share one client or pin worker-specific options (`maxRetriesPerRequest: null`); otherwise the plain options object suffices and `ioredis` stays a transitive (peer) dependency.

---

## @aws-sdk/client-s3

**Source:** `/aws/aws-sdk-js-v3` (Context7) — High reputation, 7789 snippets, benchmark 64.33. Maps to `phase-03-videos/TD-01` (MinIO via S3 API), `TD-05` (multipart upload commands), and `TD-06` (object delivery). `npm view` confirms `3.1153.0`.

### MinIO-compatible `S3Client` (TD-01)

MinIO speaks the S3 API with `endpoint` pointed at the Compose service name and `forcePathStyle: true` (v2's `s3ForcePathStyle` was renamed in v3):

```typescript
import { S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,     // http://minio:9000 (Compose service name)
  forcePathStyle: true,                       // host/bucket/key, not bucket.host/key
  region: "us-east-1",                        // MinIO ignores region but the SDK requires it
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
  },
});
```

`storage.config.ts` is a namespaced `registerAs` exposing this config (`phase-01-configuracao-base/TD-03`).

### Multipart upload commands (TD-05)

The API coordinates a browser→storage upload; the browser `PUT`s parts directly to presigned URLs, so the API only issues/validates the session and completes/aborts it. The SDK commands:

```typescript
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";

// init — returns UploadId
const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
  Bucket, Key, ContentType,
}));

// each part — the browser does this against a presigned URL (see s3-request-presigner);
// the ETag is collected and later submitted to complete
const part = await s3.send(new UploadPartCommand({
  Bucket, Key, UploadId, PartNumber: n, Body: chunk,
}));
parts.push({ PartNumber: n, ETag: part.ETag });   // ETag is REQUIRED for complete

// complete
await s3.send(new CompleteMultipartUploadCommand({
  Bucket, Key, UploadId, MultipartUpload: { Parts: parts },
}));

// abort (resume paths and failed uploads)
await s3.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }));
```

### Streaming/download objects (TD-06)

The frontend streams/downloads directly from storage over HTTP Range; the API issues a presigned GET (next section). When the API/worker itself reads or writes objects it uses `PutObjectCommand` / `GetObjectCommand`. The `Upload` helper from `@aws-sdk/lib-storage` performs concurrent multipart uploads server-side (e.g., the worker writing processed output), with `partSize` ≥ 5MB and `queueSize` concurrency:

```typescript
import { Upload } from "@aws-sdk/lib-storage";

const upload = new Upload({
  client: s3,
  params: { Bucket, Key, Body },   // stream/buffer/blob
  queueSize: 4,
  partSize: 5 * 1024 * 1024,       // minimum 5MB
  leavePartsOnError: false,        // auto-abort on failure
});
await upload.done();
```

---

## @aws-sdk/s3-request-presigner

**Source:** `/aws/aws-sdk-js-v3` (Context7) — same SDK as `client-s3`; `npm view` confirms `3.1153.0`. Maps to `phase-03-videos/TD-05` (presigned part `PUT`s) and `TD-06` (presigned `GET` for streaming/download).

### `getSignedUrl`

```typescript
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client, GetObjectCommand, PutObjectCommand, UploadPartCommand } from "@aws-sdk/client-s3";

const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 3600 });
```

`expiresIn` defaults to 900s when omitted. The same call shape signs `PutObjectCommand` (single-part upload) and `UploadPartCommand` (one presigned URL per multipart part — the BFF returns an array of `{ partNumber, url }`).

### `UNSIGNED-PAYLOAD` and header signing (TD-05/TD-06)

The presigner sets `x-amz-content-sha256: UNSIGNED-PAYLOAD` at runtime, skipping SHA256 hashing of the body — so a presigned `PUT` does **not** pin the body length at the signature level (the browser streams the part without the SDK knowing its bytes). By default `content-type` is **unsignable** in a presigned URL; to force the browser to send an exact `Content-Type`, opt in via `signableHeaders`:

```typescript
const presigned = await getSignedUrl(s3, new PutObjectCommand({
  Bucket, Key, ContentType: "video/mp4",
}), {
  expiresIn: 3600,
  signableHeaders: new Set(["content-type"]),
});
```

### Presigned GET for streaming vs. download (TD-06)

- **Streaming:** `new GetObjectCommand({ Bucket, Key })` → short-lived HTTPS GET; the browser's `<video>` element issues byte-range requests (`Range`) natively against it.
- **Download:** the same command with `ResponseContentDisposition: "attachment; filename=\"<title>.mp4\""` so the object streams as an attachment. Long playback sessions re-request the URL from the BFF as it expires.

---

## fluent-ffmpeg

**Source:** `/fluent-ffmpeg/node-fluent-ffmpeg` (Context7) — Medium reputation, 340 snippets, benchmark 81.05. Maps to `phase-03-videos/TD-04` Decision A (wrapper over image-installed FFmpeg). `npm view` confirms `2.1.3`.

### ffprobe: metadata + duration (TD-04 capability 1)

`ffprobe` is callback-based and returns a JSON object with `streams[]` (codec, `codec_type`, `width`/`height`, `duration`, `bit_rate`) and `format` (`duration`, `size`, `bit_rate`). Promisify it for the project's async style:

```typescript
import ffmpeg from "fluent-ffmpeg";
import { promisify } from "node:util";

const ffprobeAsync = promisify<string, Ffmpeg.FfprobeData>(ffmpeg.ffprobe);

const metadata = await ffprobeAsync(key);
const videoStream = metadata.streams.find((s) => s.codec_type === "video");
const durationSeconds = Number(metadata.format.duration);   // or videoStream.duration
const { width, height } = videoStream;
```

### Thumbnail from a frame (TD-04 capability 2)

`ffmpeg(...).seekInput(...).screenshots(...)` extracts a frame as an image. `screenshots` (aliases `takeScreenshots` / `thumbnail` / `screenshot`) emits a `filenames` event with the generated paths:

```typescript
ffmpeg(inputPath)
  .seekInput(0)                 // or a timemark like "00:00:01"
  .outputOptions("-frames:v", "1")
  .screenshots({
    count: 1,
    folder: outputDir,
    filename: `${videoId}.png`,
    size: "1280x?",             // keep aspect ratio
  })
  .on("filenames", (files: string[]) => {
    // upload files[0] as the thumbnail key
  })
  .on("error", (err) => reject(err));
```

`screenshots` supports `count` (evenly spaced), `timemarks`/`timestamps` (explicit offsets), `fastSeek`, and `size`.

### Custom FFmpeg flags

For flags the fluent API doesn't model, `outputOptions()` passes raw args through — used for thumbnail tuning (e.g., `-frames:v 1`, `-vf scale=...`).

### Integration notes (TD-04)

- **Binary lives in the image, not node_modules** (TD-04 Decision A): `fluent-ffmpeg` shells out to `ffmpeg`/`ffprobe` on `PATH`. The worker image installs FFmpeg; the API image stays lean (TD-03).
- **Runs only in the worker container** — never in the API process (TD-03/TD-04).
- **Callbacks → promisify**, matching the project's strict-TS async style; reject on the `error` event.
- For tests, `fluent-ffmpeg` is stubbed/mocked (unit) or driven against a tiny fixture MP4 (integration); see the `testing-guide-nestjs-project` layering.

---

## @types/fluent-ffmpeg

**Source:** `/fluent-ffmpeg/node-fluent-ffmpeg` (Context7, types companion — no separate Context7 entry). Maps to `phase-03-videos/TD-04` Decision A. `npm view` confirms `2.1.28` (types-only; dev dependency).

Runtime-free DefinitelyTyped declarations for `fluent-ffmpeg`. The types surface the namespace `Ffmpeg`:
- `Ffmpeg.FfprobeData` — the object returned by `ffprobe` (`streams`, `format`).
- `Ffmpeg.FfprobeStream` — one entry of `streams[]` (`codec_type`, `width`, `height`, `duration`, `bit_rate`).
- `Ffmpeg.Command` / `Ffmpeg.FfmpegCommand` — the fluent command chain (`seekInput`, `outputOptions`, `screenshots`).

Use these in place of hand-rolled interfaces for the probe metadata and screenshot callbacks above (see the `ffprobeAsync` typing in the `fluent-ffmpeg` section).

---

## nanoid

**Source:** `/ai/nanoid` (Context7) — High reputation, 496 snippets, benchmark 77.25. Maps to `phase-03-videos/TD-07` Decision A (short, URL-safe, non-sequential ID). `npm view` confirms `6.0.2`.

### Fixed-length ID with the default alphabet

`nanoid(size)` uses the built-in 64-char `urlAlphabet` (`A-Z a-z 0-9 _ -`, 6 bits/char) — URL-safe in paths/query/fragments with no percent-encoding:

```typescript
import { nanoid } from "nanoid";

const videoId = nanoid(11);   // ~YouTube-style length, ~66 bits entropy
```

### Custom alphabet / size

When a narrower alphabet is desired, `customAlphabet` pins both alphabet and size:

```typescript
import { customAlphabet } from "nanoid";

const videoIdGen = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-", 11);
const videoId = videoIdGen();
```

### Integration notes (TD-07)

- **11 chars ≈ YouTube length**, non-sequential (no enumeration), collision-negligible at project scale (TD-07 Decision A). The ID is the public `GET /videos/:id` segment **and** the object-storage key prefix.
- **No coordination/DB round-trip** to generate. Ordering comes from a `createdAt` column, not the ID (TD-07).
- **Enforce uniqueness at the DB level** (unique column) even though collision is near-certain to pass — per the TD-07 recommendation.

---
