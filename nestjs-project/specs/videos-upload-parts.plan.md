---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: test/videos-upload-parts.e2e-spec.ts
---

# POST /videos/:id/upload/parts Test Plan

## Application Overview

Endpoint que emite uma presigned `PUT` URL por parte do multipart upload, permitindo ao cliente enviar bytes diretamente ao object storage sem relé via API.

## Test Scenarios

### 1. POST /videos/:id/upload/parts

**Setup:** `beforeAll` bootstrap via `Test.createTestingModule({ imports: [AppModule] })` + `ValidationPipe`; DB Docker real; `beforeEach` limpa `videos` e `channels`; usuário/canal autenticado de fixture (JWT); cenário de sucesso usa um `Video` em `UPLOADING` com `upload_id` preenchido (seed).

#### 1.1. sign-part-urls

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. POST /videos/:id/upload/parts com body `{ part_numbers: [1, 2] }` e header `Authorization: Bearer <token>`, para um `Video` em `UPLOADING`
    - expect: 200 e body `{ parts: [{ part_number: 1, url }, { part_number: 2, url }] }` — uma URL por parte

#### 1.2. unknown-video-404

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. POST /videos/<id-inexistente>/upload/parts com body `{ part_numbers: [1] }` e header `Authorization: Bearer <token>`
    - expect: 404 e body `error: "UPLOAD_NOT_FOUND"`

#### 1.3. empty-part-numbers-400

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. POST /videos/:id/upload/parts com body `{ part_numbers: [] }` e header `Authorization: Bearer <token>`
    - expect: 400 e body `error: "VALIDATION_ERROR"`
