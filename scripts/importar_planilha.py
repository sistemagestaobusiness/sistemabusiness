"""Importa a aba Plan1 (fluxo de caixa) da planilha Business para o banco.

Uso:  python3 -I scripts/importar_planilha.py PLANILHA.xlsx SAIDA.sql [--realizado-ate AAAA-MM-DD]

Gera um SQL com categorias (linhas do fluxo) e lançamentos (uma célula = um lançamento) e confere,
mês a mês, se o saldo calculado bate com a linha "Saldo" da planilha. A SAÍDA TEM NOMES DE CLIENTES:
não versionar (fica fora do git, ver .gitignore).

Regras (tiradas da própria planilha):
- Entradas: linhas 2 e 5-76, 78 (BPO), 105-107 (fórmula "Total Entradas"). As linhas 79-103 (clientes do BPO)
  só contam quando a célula da linha 78 é =SUM(79:103) daquela coluna; senão vale o número digitado na 78.
- Pagamentos: linhas 112-150.
- Colunas mensais set/2018 a fev/2019 viram um lançamento no dia 1 do mês.
- Linha oculta = categoria arquivada (sai da grade, continua no saldo).
- Comentário da célula = descrição; conta da célula (=1000+500) também vai na descrição.
- Até --realizado-ate: CONCILIADO (a conciliação era feita na planilha); depois: PREVISTO.
"""
import datetime as dt
import re
import sys
from collections import defaultdict

import openpyxl

ENTRADAS = [2] + list(range(5, 77)) + [78] + list(range(105, 108))
BPO_FILHOS = list(range(79, 104))
SAIDAS = list(range(112, 151))
CORES = {118: '#FFF2A8', 119: '#F8C9B4'}  # pró-labore Rodrigo (amarelo) e Alexandre (salmão), como na planilha


def secao(r):
    if r == 2: return 'Sócios'
    if 5 <= r <= 76: return 'Clientes'
    if r == 78 or r in BPO_FILHOS: return 'BPO'
    if 105 <= r <= 107: return 'Outros'
    if 141 <= r <= 148: return 'Dívidas, consórcios e aplicações'
    return 'Pagamentos'


def comentario(c):
    if not c.comment: return None
    t = c.comment.text
    if 'Comentário:' in t: t = t.split('Comentário:', 1)[1]
    t = re.sub(r'^\s*Alexandre Bezerra:\s*', '', t.strip())
    return ' '.join(t.split()) or None


def q(s):
    return 'null' if s is None else "'" + str(s).replace("'", "''") + "'"


def main():
    arq, saida = sys.argv[1], sys.argv[2]
    ate = dt.date.today()
    if '--realizado-ate' in sys.argv: ate = dt.date.fromisoformat(sys.argv[sys.argv.index('--realizado-ate') + 1])
    wf = openpyxl.load_workbook(arq)['Plan1']                    # fórmulas, comentários, formatação
    wv = openpyxl.load_workbook(arq, data_only=True)['Plan1']    # valores calculados pelo Excel

    colunas = []  # (coluna, data, mensal?)
    for c in range(1, wf.max_column + 1):
        h = wf.cell(1, c).value
        if isinstance(h, dt.datetime): colunas.append((c, h.date(), c < 11))

    cats, ordem = {}, 0
    for r in ENTRADAS + BPO_FILHOS + SAIDAS:
        nome = wf.cell(r, 1).value
        nome = ' '.join(str(nome).split()) if nome else f'Linha {r} (sem nome)'
        ordem += 10
        cats[r] = dict(nome=nome, tipo='SAIDA' if r in SAIDAS else 'ENTRADA', secao=secao(r), ordem=ordem,
                       arquivada=bool(wf.row_dimensions[r].hidden), cor=CORES.get(r))

    lancs, ignorados = [], defaultdict(int)
    for c, data, mensal in colunas:
        bpo_formula = str(wf.cell(78, c).value or '').upper().startswith('=SUM(')
        for r in cats:
            v = wv.cell(r, c).value
            if not isinstance(v, (int, float)) or abs(v) < 0.005: continue
            if r == 78 and bpo_formula: continue                # soma dos filhos: importa os filhos
            if r in BPO_FILHOS and not bpo_formula:
                ignorados['bpo_fora_do_total'] += 1; continue   # não entrava no saldo da planilha
            f = wf.cell(r, c).value
            partes = []
            com = comentario(wf.cell(r, c))
            if com: partes.append(com)
            if isinstance(f, str) and f.startswith('='): partes.append(f'planilha: {f}')
            if mensal: partes.append('total do mês (planilha)')
            lancs.append(dict(r=r, data=data, valor=round(v, 2), desc=' · '.join(partes) or None,
                              status='CONCILIADO' if data <= ate else 'PREVISTO'))

    # usados no nome sem nome? remove categorias vazias sem nome
    usadas = {l['r'] for l in lancs}
    cats = {r: k for r, k in cats.items() if r in usadas or not k['nome'].startswith('Linha ')}

    # conferência do saldo com a linha 153 da planilha (no último dia de cada mês e nos meses fechados)
    mov = defaultdict(float)
    for l in lancs: mov[l['data']] += l['valor'] if cats[l['r']]['tipo'] == 'ENTRADA' else -l['valor']
    saldo, difs, ultimo = 0.0, [], {}
    for c, data, mensal in colunas:
        saldo += mov.get(data, 0)
        plan = wv.cell(153, c).value
        if isinstance(plan, (int, float)): ultimo[(data.year, data.month)] = (data, saldo, plan)
    for (a, m), (data, s, p) in sorted(ultimo.items()):
        if abs(s - p) > 0.05: difs.append((data, round(s, 2), round(p, 2), round(s - p, 2)))

    with open(saida, 'w', encoding='utf-8') as o:
        o.write('-- Importação da planilha Business (gerado por scripts/importar_planilha.py). CONTÉM NOMES DE CLIENTES.\n')
        o.write(f'-- {len(cats)} linhas do fluxo, {len(lancs)} lançamentos; realizado até {ate.isoformat()}.\nbegin;\n')
        o.write("insert into public.contas (nome, saldo_inicial, data_inicial) values ('C6', 0, '2018-09-01');\n")
        o.write('create temp table _mapa (linha int, id bigint) on commit drop;\n')
        for r, k in cats.items():
            o.write(f"with n as (insert into public.categorias (nome, tipo, secao, ordem, arquivada, cor) values "
                    f"({q(k['nome'])}, '{k['tipo']}', {q(k['secao'])}, {k['ordem']}, {str(k['arquivada']).lower()}, {q(k['cor'])}) returning id) "
                    f"insert into _mapa select {r}, id from n;\n")
        for i in range(0, len(lancs), 500):
            o.write('insert into public.lancamentos (data, valor, categoria_id, conta_id, descricao, status)\n'
                    'select v.data::date, v.valor, m.id, (select min(id) from public.contas), v.descricao, v.status\n'
                    'from (values\n')
            o.write(',\n'.join(f"  ('{l['data']}', {l['valor']}, {l['r']}, {q(l['desc'])}, '{l['status']}')" for l in lancs[i:i + 500]))
            o.write('\n) v(data, valor, linha, descricao, status) join _mapa m on m.linha = v.linha;\n')
        o.write('commit;\n')

    print(f'{len(cats)} linhas do fluxo ({sum(k["arquivada"] for k in cats.values())} arquivadas), {len(lancs)} lançamentos')
    print(f'células de clientes BPO fora do total da planilha (não importadas): {ignorados["bpo_fora_do_total"]}')
    print(f'negativos: {sum(1 for l in lancs if l["valor"] < 0)}')
    print(f'meses com saldo diferente da planilha (mais de 5 centavos): {len(difs)}; maior diferença em centavos de arredondamento: {max((abs(s - p) for _, s, p in ultimo.values()), default=0):.2f}')
    for d in difs[:40]: print('  ', d)


if __name__ == '__main__':
    main()
