/* Dublê da Auth Admin API do Supabase (sb.auth.admin) para os testes da equipe.
   Guarda usuários em memória, imita o gatilho que cria o perfil e registra
   cada chamada (com a senha MASCARADA no registro, para o teste conferir que
   ninguém guarda senha em lugar nenhum). Não é teste: é apoio. */
'use strict';
const crypto = require('node:crypto');

function criarAuthFalsa({ db, falhar = {}, semGatilho = false } = {}) {
  const usuarios = new Map();
  const chamadas = [];
  const senhas = new Map();      // id -> senha (só para o teste conferir que a senha foi aplicada)
  const registra = (nome, args) => chamadas.push({ nome, args: JSON.parse(JSON.stringify(args, (k, v) => (k === 'password' ? '•••' : v))) });

  const admin = {
    async createUser(attrs) {
      registra('createUser', attrs);
      if (falhar.createUser) return { data: { user: null }, error: { message: falhar.createUser } };
      if ([...usuarios.values()].some(u => u.email === attrs.email)) return { data: { user: null }, error: { message: 'A user with this email address has already been registered', code: 'email_exists' } };
      const id = crypto.randomUUID();
      const u = { id, email: attrs.email, user_metadata: attrs.user_metadata || {}, app_metadata: attrs.app_metadata || {},
        email_confirmed_at: attrs.email_confirm ? new Date().toISOString() : null, last_sign_in_at: null, banned_until: null, factors: [] };
      usuarios.set(id, u);
      senhas.set(id, attrs.password);
      // o gatilho do banco cria o perfil como atendente
      if (db && !semGatilho) (db.perfis = db.perfis || []).push({ id, email: attrs.email, nome: attrs.user_metadata?.nome || null, papel: 'atendente', ativo: true,
        apps: ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador', 'ads'], recebe_leads: true, precisa_trocar_senha: false, preferencias: {} });
      return { data: { user: u }, error: null };
    },
    async updateUserById(id, attrs) {
      registra('updateUserById', { id, ...attrs });
      if (falhar.updateUserById) return { data: { user: null }, error: { message: falhar.updateUserById } };
      const u = usuarios.get(id) || { id, factors: [] };
      usuarios.set(id, u);
      if (attrs.password) senhas.set(id, attrs.password);
      if (attrs.ban_duration) u.banned_until = attrs.ban_duration === 'none' ? null : new Date(Date.now() + 1e12).toISOString();
      return { data: { user: u }, error: null };
    },
    async deleteUser(id) {
      registra('deleteUser', { id });
      usuarios.delete(id);
      if (db?.perfis) db.perfis = db.perfis.filter(p => p.id !== id);
      return { data: {}, error: null };
    },
    async listUsers({ page = 1, perPage = 50 } = {}) {
      registra('listUsers', { page, perPage });
      if (falhar.listUsers) return { data: { users: [] }, error: { message: falhar.listUsers } };
      const todos = [...usuarios.values()];
      return { data: { users: todos.slice((page - 1) * perPage, page * perPage) }, error: null };
    },
    mfa: {
      async listFactors({ userId }) {
        registra('mfa.listFactors', { userId });
        return { data: { factors: usuarios.get(userId)?.factors || [] }, error: null };
      },
      async deleteFactor({ id, userId }) {
        registra('mfa.deleteFactor', { id, userId });
        const u = usuarios.get(userId);
        if (u) u.factors = u.factors.filter(f => f.id !== id);
        return { data: { id }, error: null };
      },
    },
  };
  /** Cadastra um usuário já existente (sem passar pelo createUser). */
  function semear(u) { usuarios.set(u.id, { factors: [], last_sign_in_at: null, banned_until: null, ...u }); }
  return { admin, usuarios, chamadas, senhas, semear };
}

module.exports = { criarAuthFalsa };
