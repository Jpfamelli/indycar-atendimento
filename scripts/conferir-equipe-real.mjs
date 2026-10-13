// Conferência SÓ LEITURA da central da equipe contra o banco real (usa o .env).
// Lista a equipe com último acesso/MFA (Auth Admin: listUsers), o rodízio, as
// conversas sem dono, a carga de tarefas, a auditoria e os números do resumo
// do dia. NÃO grava nada: nenhuma notificação, nenhum convite, nenhum update.
// E-mails saem mascarados. Uso: node scripts/conferir-equipe-real.mjs
process.env.SO_FUNCOES = '1';
const srv = await import('../server.js').then(m => m.default || m);

const mascara = e => (e ? String(e).replace(/^(.).*(@.*)$/, '$1•••$2') : e);
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: admin } = await sb.from('perfis').select('id,papel').eq('papel', 'admin').eq('ativo', true).limit(1).maybeSingle();
const quem = { id: admin?.id, papel: 'admin' };

const l = await srv.EQUIPE().listar(quem);
console.log('--- equipe ---', l.ok, l.avisos);
for (const p of l.pessoas || []) {
  console.log(`${String(p.nome || '').split(' ')[0].padEnd(12)} ${p.papel.padEnd(9)} ${p.situacao.padEnd(20)} mfa=${p.mfa.ativo} ` +
    `login=${p.ultimo_login_em ? p.ultimo_login_em.slice(0, 16) : '—'} acesso=${p.ultimo_acesso_em ? p.ultimo_acesso_em.slice(0, 16) : '—'} ` +
    `apps=${p.apps.length} rodizio=${p.recebe_leads} conversas=${p.carga.conversas_abertas} tarefas=${p.carga.tarefas_abertas} ${mascara(p.email)}`);
}
console.log('--- rodízio ---');
const r = await srv.RODIZIO().previa();
console.log(JSON.stringify({ proximo: r.proximo?.nome?.split(' ')[0], motivo: r.proximo?.motivo, fila: r.fila?.map(f => `${f.nome?.split(' ')[0]}:${f.carga}`), fora: r.fora?.map(f => `${f.nome?.split(' ')[0]}:${f.motivo}`) }));
const sd = await srv.RODIZIO().semDono({ minutos: 15 });
console.log('--- sem dono há 15+ min ---', sd.total, (sd.conversas || []).slice(0, 3).map(c => `${c.espera_min} min`));
const c = await srv.TAREFAS().cargaDaEquipe(quem);
console.log('--- carga de tarefas ---', JSON.stringify(c.total), (c.pessoas || []).map(p => `${p.nome?.split(' ')[0]}:${p.abertas}/${p.conversas_abertas}`).join(' '));
const aud = srv.AUDITORIA();
const a = await aud.consultar(aud.lerFiltros({ por_pagina: '5' }).filtros);
console.log('--- auditoria ---', a.ok, 'total', a.total, (a.itens || []).map(i => `${i.acao}@${i.created_at?.slice(0, 16)}`));
const n = await srv.AUTOMACOES().numerosDoDia(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()));
console.log('--- números do resumo do dia (sem notificar) ---', JSON.stringify(n));
console.log(srv.AUTOMACOES().textoDoResumo(n));
process.exit(0);
