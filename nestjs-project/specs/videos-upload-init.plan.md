---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5
target_file: test/videos-upload-init.e2e-spec.ts
---

# POST /videos Test Plan

## Application Overview

Endpoint de inicialização do upload de vídeo: pré-cadastra o vídeo como rascunho (`UPLOADING`) ligado ao canal do usuário autenticado e cria o multipart upload no object storage, retornando `{ id, upload_id }` para o cliente iniciar o envio das partes.

## Test Scenarios

### 1. POST /videos

**Setup:** `beforeAll` bootstrap via `Test.createTestingModule({ imports: [AppModule] })` + `ValidationPipe` (reproduzir config global de `main.ts`); DB Docker real; `beforeEach` limpa `videos` e `channels`; usuário/canal autenticado de fixture (JWT) para os cenários de sucesso.

#### 1.1. init-upload-success

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. POST /videos com body `{ mime_type: "video/mp4", size_bytes: 104857600, title: "Meu vídeo" }` e header `Authorization: Bearer <token>`
    - expect: 201 e body `{ id, upload_id }` (ambos strings não vazias)
    - expect: um `Video` em `UPLOADING` com `channel_id` do canal do usuário autenticado persistido no DB

#### 1.2. reject-oversized-video

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. POST /videos com body `{ mime_type: "video/mp4", size_bytes: 10737418241 }` (acima de 10GB) e header `Authorization: Bearer <token>`
    - expect: 400 e body `error: "VALIDATION_ERROR"`

#### 1.3. reject-unauthenticated

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-20T17:20:43Z

**Steps:**
  1. POST /videos com body válido e sem header `Authorization`
    - expect: 401
