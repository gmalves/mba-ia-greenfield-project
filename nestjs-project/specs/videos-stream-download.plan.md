---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.9
target_file: test/videos-stream-download.e2e-spec.ts
---

# GET /videos/:id/stream + /download Test Plan

## Application Overview

Endpoints de emissão de presigned `GET` URLs para reprodução via streaming (`HTTP Range`, sem download completo) e para download (`Content-Disposition: attachment`), direcionando o navegador direto ao object storage. Acesso anônimo.

## Test Scenarios

### 1. GET /videos/:id/stream

**Setup:** `beforeAll` bootstrap via `Test.createTestingModule({ imports: [AppModule] })` + `ValidationPipe`; DB Docker real; `beforeEach` limpa `videos` e `channels`; cenários de sucesso usam um `Video` em `READY` (seed); cenário de erro usa um `Video` fora de `READY`. Sem autenticação (endpoint anônimo).

#### 1.1. stream-ready-url

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. GET /videos/:id/stream de um `Video` em `READY`
    - expect: 200 e body `{ url, expires_in }`
    - expect: `url` é uma presigned GET compatível com `HTTP Range`

#### 1.2. stream-not-ready-409

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. GET /videos/:id/stream de um `Video` fora de `READY`
    - expect: 409 e body `error: "VIDEO_NOT_READY"`

#### 1.3. stream-unknown-404

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. GET /videos/<id-inexistente>/stream
    - expect: 404 e body `error: "UPLOAD_NOT_FOUND"`

### 2. GET /videos/:id/download

**Setup:** idem ao grupo 1.

#### 2.1. download-ready-url

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. GET /videos/:id/download de um `Video` em `READY`
    - expect: 200 e body `{ url }`
    - expect: `url` carrega `Content-Disposition: attachment`
