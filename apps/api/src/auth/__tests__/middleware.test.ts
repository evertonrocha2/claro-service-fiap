import express from 'express'
import request from 'supertest'
import { expect, test } from 'vitest'
import { optionalAuth, requireAuth } from '../middleware.js'
import { TokenService } from '../tokens.js'

const tokens = new TokenService('segredo-de-teste-com-mais-de-32-caracteres')

function appDeTeste() {
  const app = express()
  app.get('/aberto', optionalAuth(tokens), (req, res) => {
    res.json({ sujeito: req.auth ?? null })
  })
  app.get('/fechado', requireAuth(tokens), (req, res) => {
    res.json({ sujeito: req.auth })
  })
  return app
}

test('rota aberta funciona sem token', async () => {
  const r = await request(appDeTeste()).get('/aberto')
  expect(r.status).toBe(200)
  expect(r.body.sujeito).toBeNull()
})

test('rota aberta popula req.auth quando o token é válido', async () => {
  const token = await tokens.signAccess({ subjectId: 'c1', kind: 'CUSTOMER' })
  const r = await request(appDeTeste()).get('/aberto').set('Authorization', `Bearer ${token}`)
  expect(r.body.sujeito).toEqual({ subjectId: 'c1', kind: 'CUSTOMER' })
})

test('rota aberta ignora token inválido em vez de recusar', async () => {
  const r = await request(appDeTeste()).get('/aberto').set('Authorization', 'Bearer lixo')
  expect(r.status).toBe(200)
  expect(r.body.sujeito).toBeNull()
})

test('rota fechada devolve 401 sem token', async () => {
  const r = await request(appDeTeste()).get('/fechado')
  expect(r.status).toBe(401)
  expect(r.body.error.code).toBe('NAO_AUTENTICADO')
})

test('rota fechada devolve 401 com token inválido', async () => {
  const r = await request(appDeTeste()).get('/fechado').set('Authorization', 'Bearer lixo')
  expect(r.status).toBe(401)
})

test('rota fechada aceita token válido', async () => {
  const token = await tokens.signAccess({ subjectId: 'c1', kind: 'CUSTOMER' })
  const r = await request(appDeTeste()).get('/fechado').set('Authorization', `Bearer ${token}`)
  expect(r.status).toBe(200)
  expect(r.body.sujeito.subjectId).toBe('c1')
})

test('header sem o prefixo Bearer é ignorado', async () => {
  const token = await tokens.signAccess({ subjectId: 'c1', kind: 'CUSTOMER' })
  const r = await request(appDeTeste()).get('/fechado').set('Authorization', token)
  expect(r.status).toBe(401)
})
