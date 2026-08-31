// O Supabase saiu. Este toco existe para que tela ainda não portada estoure
// alto em vez de quebrar em silêncio — a falha característica desta travessia,
// e a que custou caro no HS.OS.
//
// Quando este arquivo puder ser apagado sem quebrar nada, a portagem acabou.

export const MARCA_NAO_PORTADO = '[MarketingHS] não portado:';

function naoPortado(alvo: string): never {
  throw new Error(
    `${MARCA_NAO_PORTADO} ${alvo}. ` +
    `Esta tela ainda fala com o Supabase. Escreva o endpoint no backend e ` +
    `troque por @/lib/api.`
  );
}

// `supabase.auth.getUser()` é acesso encadeado: sem este proxy intermediário o
// erro chega como "getUser is not a function", que não diz nada a quem lê.
const auth = new Proxy({} as never, {
  get: (_a, prop: string) => () => naoPortado(`supabase.auth.${prop}()`),
});

export const supabase = new Proxy({} as never, {
  get(_alvo, prop: string) {
    if (prop === 'auth') return auth;
    if (prop === 'from') return (tabela: string) => naoPortado(`supabase.from('${tabela}')`);
    if (prop === 'rpc') return (fn: string) => naoPortado(`supabase.rpc('${fn}')`);
    if (prop === 'functions') {
      return { invoke: (nome: string) => naoPortado(`supabase.functions.invoke('${nome}')`) };
    }
    if (prop === 'storage') {
      return { from: (b: string) => naoPortado(`supabase.storage.from('${b}')`) };
    }
    if (prop === 'channel') return (c: string) => naoPortado(`supabase.channel('${c}')`);
    return () => naoPortado(`supabase.${prop}`);
  },
});
