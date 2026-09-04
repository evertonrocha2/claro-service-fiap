import express from 'express'
import request from 'supertest'
import { expect, test } from 'vitest'
import { rateLimit } from '../rate-limit.js'

function appDeTeste(max: number, janelaMs = 60_000) {
  const app = express()
  app.post('/tentar', rateLimit({ max, windowMs: janelaMs }), (_req, res) => {
    res.json({ ok: true })
  })
  return app
}

test('deixa passar até o limite', async () => {
  const app = appDeTeste(3)
  for (let i = 0; i < 3; i++) {
    expect((await request(app).post('/tentar')).status).toBe(200)
  }
})

test('bloqueia com 429 depois do limite', async () => {
  const app = appDeTeste(2)
  await request(app).post('/tentar')
  await request(app).post('/tentar')

  const r = await request(app).post('/tentar')
  expect(r.status).toBe(429)
  expect(r.body.error.code).toBe('MUITAS_TENTATIVAS')
})

test('a janela zera com o tempo', async () => {
  const app = appDeTeste(1, 30)
  expect((await request(app).post('/tentar')).status).toBe(200)
  expect((await request(app).post('/tentar')).status).toBe(429)

  await new Promise((r) => setTimeout(r, 50))
  expect((await request(app).post('/tentar')).status).toBe(200)
})

test('a contagem é por rota, não global', async () => {
  const app = express()
  const limite = rateLimit({ max: 1, windowMs: 60_000 })
  app.post('/a', limite, (_req, res) => res.json({ ok: true }))
  app.post('/b', limite, (_req, res) => res.json({ ok: true }))

  expect((await request(app).post('/a')).status).toBe(200)
  expect((await request(app).post('/b')).status).toBe(200)
  expect((await request(app).post('/a')).status).toBe(429)
})
