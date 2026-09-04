import express from 'express'
import request from 'supertest'
import { expect, test } from 'vitest'
import { can, isAgentRole, PERMISSIONS, requirePermission } from '../roles.js'

test('atendente cuida de atendimentos e ve os proprios numeros', () => {
  expect(can('AGENT', 'handleConversations')).toBe(true)
  expect(can('AGENT', 'viewOwnPerformance')).toBe(true)
})

test('atendente nao ve o desempenho da equipe', () => {
  expect(can('AGENT', 'viewTeamPerformance')).toBe(false)
})

test('gestor pode tudo que o atendente pode, e mais', () => {
  for (const permissao of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
    if (can('AGENT', permissao)) expect(can('MANAGER', permissao)).toBe(true)
  }
  expect(can('MANAGER', 'viewTeamPerformance')).toBe(true)
})

test('reconhece papel valido e recusa o resto', () => {
  expect(isAgentRole('AGENT')).toBe(true)
  expect(isAgentRole('MANAGER')).toBe(true)
  expect(isAgentRole('ADMIN')).toBe(false)
  expect(isAgentRole(undefined)).toBe(false)
})

function appDeTeste(role?: 'AGENT' | 'MANAGER') {
  const app = express()
  app.use((req, _res, next) => {
    if (role) req.agentRole = role
    next()
  })
  app.get('/equipe', requirePermission('viewTeamPerformance'), (_req, res) => {
    res.json({ ok: true })
  })
  return app
}

test('sem papel a rota protegida devolve 403', async () => {
  const r = await request(appDeTeste()).get('/equipe')
  expect(r.status).toBe(403)
  expect(r.body.error.code).toBe('PERMISSAO_INSUFICIENTE')
})

test('atendente nao passa na rota de gestao', async () => {
  expect((await request(appDeTeste('AGENT')).get('/equipe')).status).toBe(403)
})

test('gestor passa', async () => {
  expect((await request(appDeTeste('MANAGER')).get('/equipe')).status).toBe(200)
})
