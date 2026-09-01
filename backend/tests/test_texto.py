"""A parte text/plain do e-mail.

Espelha `_shared/htmlToText.ts`. As expectativas abaixo vêm do comportamento do
original, não do que seria "bonito": a parte texto tem de ser o espelho exato do
HTML enviado, e divergir do original mudaria o que o contato lê.
"""

from app.texto import html_para_texto


def test_condicional_do_outlook_sai_com_o_conteudo():
    """⚠️ Os comentários saem ANTES das tags. Os condicionais do Outlook
    (`<!--[if mso]>`) embrulham markup de verdade — processar as tags primeiro
    faria esse markup só-Outlook vazar para o texto, duplicando botões."""
    html = ("<style>.a{color:red}</style>"
            "<!--[if mso]><td>lixo</td><![endif]-->"
            "<p>Olá</p>")
    assert html_para_texto(html) == "Olá"


def test_entidade_e_espaco_que_nao_quebra():
    """&nbsp; vira espaço COMUM: o colapso usa [ \\t\\f\\v]+, que não pega
    U+00A0 — eles sobreviveriam como espaços duplos espalhados pelo texto."""
    assert html_para_texto("<p>Ol&aacute;&nbsp;&nbsp;mundo</p>") == "Olá mundo"


def test_uma_quebra_por_fechamento_de_bloco():
    assert html_para_texto("<p>um</p><p>dois<br>três</p>") == "um\ndois\ntrês"


def test_lista_vira_travessao():
    assert html_para_texto("<ul><li>um</li><li>dois</li></ul>") == "- um\n- dois"


def test_codepoint_invisivel_some():
    assert html_para_texto("<p>a&#8203;b&#847;</p>") == "ab"


def test_link_vira_texto_e_url():
    assert html_para_texto('<a href="https://x.test/a">Clique</a>') == "Clique (https://x.test/a)"


def test_link_nao_repete_a_url_quando_o_texto_ja_e_ela():
    html = '<a href="https://x.test/a">https://x.test/a</a>'
    assert html_para_texto(html) == "https://x.test/a"


def test_ancora_e_mailto_nao_ganham_url():
    assert html_para_texto('<a href="#topo">Voltar</a>') == "Voltar"
    assert html_para_texto('<a href="mailto:a@b.c">Escreva</a>') == "Escreva"


def test_imagem_vira_o_alt_e_some_sem_alt():
    assert html_para_texto('<img src="x.png" alt="Logo da HS">') == "Logo da HS"
    assert html_para_texto('<img src="x.png" alt="">') == ""


def test_entidade_escapada_nao_vira_tag():
    """⚠️ As tags saem ANTES de decodificar as entidades. Na ordem inversa um
    "&lt;script&gt;" escrito no corpo viraria tag de verdade e sumiria."""
    assert html_para_texto("<p>&lt;script&gt;</p>") == "<script>"


def test_nunca_levanta():
    """Uma exceção aqui derrubaria o envio de um destinatário inteiro."""
    for entrada in ("<p>&#xFFFFFFFF;<<<", "", None, "<a href=>x</a>"):
        assert isinstance(html_para_texto(entrada), str)
