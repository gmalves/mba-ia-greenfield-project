---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: test/videos-status.e2e-spec.ts
---

# GET /videos/:id Test Plan

## Application Overview

Endpoint de status do vídeo: expõe estado, título, duração e URL do thumbnail para o FE consumir a evolução `UPLOADING` → `PROCESSING` → `READY`/`FAILED`.

## Test Scenarios

### 1. GET /videos/:id

**Setup:** `beforeAll` bootstrap via `Test.createTestingModule({ imports: [AppModule] })` + `ValidationPipe`; DB Docker real; `beforeEach` limpa `videos` e `channels`; usuário/canal autenticado de fixture (JWT); cenário de sucesso usa um `Video` persistido (seed) com metadados conhecidos.

#### 1.1. get-video-status

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. GET /videos/:id com header `Authorization: Bearer <token>`, para um `Video` existente
    - expect: 200 e body `{ id, status, title, duration_seconds, thumbnail_url }`

#### 1.2. unknown-video-404

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. GET /videos/<id-inexistente> com header `Authorization: Bearer <token>`
    - expect: 404 e body `error: "UPLOAD_NOT_FOUND"`

#### 1.3. thumbnail-url-only-when-ready

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. GET /videos/:id de um `Video` fora de `READY` (ex.: `UPLOADING`)
    - expect: 200 e `thumbnail_url` nulo
  2. GET /videos/:id de um `Video` em `READY` (seed com `thumbnail_object_key`)
    - expect: 200 e `thumbnail_url` preenchido (presigned GET do thumbnail)
