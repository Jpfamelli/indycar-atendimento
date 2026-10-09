// Conferência SÓ LEITURA contra o banco real: monta a ficha de um cliente que
// tenha serviço concluído e imprime (sem telefone inteiro). Não grava nada.
process.env.SO_FUNCOES = '1';
const srv = await import('../server.js').then(m => m.default || m);
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: ag } = await sb.from('agendamentos').select('cliente_id').eq('status', 'concluido').not('cliente_id', 'is', null)
  .order('inicio_em', { ascending: false }).limit(1).maybeSingle();
const id = process.argv[2] || ag?.cliente_id;
console.log('cliente_id:', id);
const f = await srv.fichaDoCliente(id);
if (f.cliente) f.cliente.nome = String(f.cliente.nome || '').split(' ')[0] + '…';
console.log(JSON.stringify(f, null, 2).slice(0, 2500));
console.log('--- saude ---');
console.log(JSON.stringify(await srv.lerSaude()));
console.log('--- chave (mascara) ---');
console.log(JSON.stringify(await srv.lerChaveMascarada()));
process.exit(0);
