---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: test/videos-upload-complete-abort.e2e-spec.ts
---

# POST /videos/:id/upload/complete + abort Test Plan

## Application Overview

Endpoints de conclusão e aborto do multipart upload: `complete` finaliza o upload no S3, transiciona o vídeo para `PROCESSING` e enfileira o job de processamento; `abort` descarta o upload e marca o vídeo como `FAILED`.

## Test Scenarios

### 1. POST /videos/:id/upload/complete

**Setup:** `beforeAll` bootstrap via `Test.createTestingModule({ imports: [AppModule] })` + `ValidationPipe`; DB Docker real; `beforeEach` limpa `videos` e `channels`; usuário/canal autenticado de fixture (JWT); cenários de sucesso/estado usam um `Video` em `UPLOADING` com `upload_id` (seed); cenário de estado inválido usa um `Video` já fora de `UPLOADING`.

#### 1.1. complete-upload

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. POST /videos/:id/upload/complete com body `{ parts: [{ part_number: 1, etag: "etag1" }] }` e header `Authorization: Bearer <token>`, para um `Video` em `UPLOADING`
    - expect: 200 e body `{ id, status: "PROCESSING" }`
    - expect: um job `process` com payload `{ videoId: <id> }` enfileirado na fila `video-processing`

#### 1.2. complete-invalid-state

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. POST /videos/:id/upload/complete com body `{ parts: [...] }` e header `Authorization: Bearer <token>`, para um `Video` fora de `UPLOADING` (ex.: já `PROCESSING`)
    - expect: 409 e body `error: "INVALID_UPLOAD_STATE"`

#### 1.3. complete-unknown-video

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. POST /videos/<id-inexistente>/upload/complete com body `{ parts: [...] }` e header `Authorization: Bearer <token>`
    - expect: 404 e body `error: "UPLOAD_NOT_FOUND"`

### 2. POST /videos/:id/upload/abort

**Setup:** idem ao grupo 1.

#### 2.1. abort-upload

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. POST /videos/:id/upload/abort com header `Authorization: Bearer <token>`, para um `Video` em `UPLOADING`
    - expect: 204 (sem body)
    - expect: `Video` persistido com `status = FAILED`
