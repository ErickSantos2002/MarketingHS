import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { api, ErroApi } from '@/lib/api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface UseAIChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  conversationId: string | null;
  isLoadingHistory: boolean;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Olá! 👋 Sou o **Assistente de dados** do MarketingHS. Posso responder qualquer pergunta sobre seus leads!\n\nExemplos:\n- "Quantos leads tivemos hoje?"\n- "Qual cargo mais comum?"\n- "Compare os leads de ontem com os de hoje"',
  timestamp: new Date(),
};

interface ConversaResumo {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversaDetalhe {
  id: string;
  mensagens: { role: 'user' | 'assistant'; content: string; created_at: string }[];
}

interface RespostaMensagem {
  texto: string;
}

export function useAIChat(): UseAIChatReturn {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const hasInitialized = useRef(false);

  // Carrega a conversa mais recente (com o histórico de mensagens) ou cria
  // uma nova, uma única vez por montagem do hook.
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const carregarOuCriarConversa = async () => {
      setIsLoadingHistory(true);
      try {
        const conversas = await api.get<ConversaResumo[]>('/ia/conversas');

        if (conversas.length > 0) {
          const id = conversas[0].id;
          const detalhe = await api.get<ConversaDetalhe>(`/ia/conversas/${id}`);
          if (detalhe.mensagens.length > 0) {
            const carregadas: ChatMessage[] = detalhe.mensagens.map((m, i) => ({
              id: `${id}-${i}`,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.created_at),
            }));
            setMessages([WELCOME_MESSAGE, ...carregadas]);
          }
          setConversationId(id);
        } else {
          const nova = await api.post<ConversaResumo>('/ia/conversas');
          setConversationId(nova.id);
        }
      } catch (error) {
        console.error('Erro ao carregar conversa:', error);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    carregarOuCriarConversa();
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // ⚠️ Gravar a pergunta e chamar a IA é UMA rota só — ver
      // /ia/conversas/{id}/mensagens. Sem conversa ainda (histórico ainda
      // carregando ou falhou), cria uma na hora.
      let id = conversationId;
      if (!id) {
        const nova = await api.post<ConversaResumo>('/ia/conversas');
        id = nova.id;
        setConversationId(id);
      }

      const resultado = await api.post<RespostaMensagem>(
        `/ia/conversas/${id}/mensagens`, { conteudo: content.trim() });

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: resultado.texto || 'Desculpe, não consegui processar sua pergunta.',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('AI Chat error:', error);

      const mensagem = error instanceof ErroApi ? error.message : 'Erro desconhecido. Tente novamente.';

      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `❌ ${mensagem}`,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorMessage]);

      toast.error('Erro', { description: mensagem });
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, isLoading]);

  const clearMessages = useCallback(async () => {
    try {
      const nova = await api.post<ConversaResumo>('/ia/conversas');
      setConversationId(nova.id);
      setMessages([WELCOME_MESSAGE]);
    } catch (error) {
      console.error('Erro ao criar nova conversa:', error);
      setMessages([WELCOME_MESSAGE]);
    }
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
    conversationId,
    isLoadingHistory,
  };
}
