import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { User } from '@supabase/supabase-js';

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
  content: 'Olá! 👋 Sou o **DNIA AI**, seu analista de dados superinteligente. Posso responder qualquer pergunta sobre seus leads!\n\nExemplos:\n- "Quantos leads tivemos hoje?"\n- "Qual cargo mais comum?"\n- "Compare os leads de ontem com os de hoje"',
  timestamp: new Date(),
};

export function useAIChat(): UseAIChatReturn {
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const hasInitialized = useRef(false);

  // Get current user
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load or create conversation when user changes
  useEffect(() => {
    if (!user || hasInitialized.current) {
      if (!user) setIsLoadingHistory(false);
      return;
    }

    hasInitialized.current = true;

    const loadOrCreateConversation = async () => {
      setIsLoadingHistory(true);
      try {
        // Try to get the most recent conversation
        const { data: conversations, error: convError } = await supabase
          .from('ai_chat_conversations')
          .select('id, title, updated_at')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(1);

        if (convError) {
          console.error('Error loading conversations:', convError);
          setIsLoadingHistory(false);
          return;
        }

        let activeConversationId: string;

        if (conversations && conversations.length > 0) {
          activeConversationId = conversations[0].id;
          
          // Load messages for this conversation
          const { data: messagesData, error: msgError } = await supabase
            .from('ai_chat_messages')
            .select('id, role, content, created_at')
            .eq('conversation_id', activeConversationId)
            .order('created_at', { ascending: true });

          if (msgError) {
            console.error('Error loading messages:', msgError);
          } else if (messagesData && messagesData.length > 0) {
            const loadedMessages: ChatMessage[] = messagesData.map((msg) => ({
              id: msg.id,
              role: msg.role as 'user' | 'assistant',
              content: msg.content,
              timestamp: new Date(msg.created_at),
            }));
            setMessages([WELCOME_MESSAGE, ...loadedMessages]);
          }
        } else {
          // Create new conversation
          const { data: newConv, error: createError } = await supabase
            .from('ai_chat_conversations')
            .insert({ user_id: user.id, title: 'Nova conversa' })
            .select('id')
            .single();

          if (createError) {
            console.error('Error creating conversation:', createError);
            setIsLoadingHistory(false);
            return;
          }
          activeConversationId = newConv.id;
        }

        setConversationId(activeConversationId);
      } catch (error) {
        console.error('Error in loadOrCreateConversation:', error);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadOrCreateConversation();
  }, [user]);

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
      // Save user message to database if we have a conversation
      if (conversationId) {
        const { data: savedUserMsg, error: saveUserError } = await supabase
          .from('ai_chat_messages')
          .insert({
            conversation_id: conversationId,
            role: 'user',
            content: content.trim(),
          })
          .select('id')
          .single();

        if (saveUserError) {
          console.error('Error saving user message:', saveUserError);
        } else if (savedUserMsg) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === userMessage.id ? { ...msg, id: savedUserMsg.id } : msg
            )
          );
        }

        // Update conversation title if it's the first user message
        const userMessages = messages.filter((m) => m.role === 'user');
        if (userMessages.length === 0) {
          const title = content.trim().slice(0, 50) + (content.length > 50 ? '...' : '');
          await supabase
            .from('ai_chat_conversations')
            .update({ title, updated_at: new Date().toISOString() })
            .eq('id', conversationId);
        } else {
          await supabase
            .from('ai_chat_conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversationId);
        }
      }

      // Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Usuário não autenticado');
      }

      // Prepare messages for AI (excluding welcome message)
      const aiMessages = messages
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));
      
      aiMessages.push({ role: 'user', content: content.trim() });

      // Call AI edge function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-data-analyst`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ 
            messages: aiMessages,
            conversationId: conversationId,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        if (response.status === 429) {
          throw new Error('Limite de requisições excedido. Aguarde um momento.');
        }
        if (response.status === 402) {
          throw new Error('Créditos de IA esgotados. Entre em contato com o suporte.');
        }
        
        throw new Error(errorData.error || 'Erro ao processar sua pergunta.');
      }

      const data = await response.json();

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.response || 'Desculpe, não consegui processar sua pergunta.',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Save assistant message to database if we have a conversation
      if (conversationId) {
        const { data: savedAssistantMsg, error: saveAssistantError } = await supabase
          .from('ai_chat_messages')
          .insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: assistantMessage.content,
          })
          .select('id')
          .single();

        if (saveAssistantError) {
          console.error('Error saving assistant message:', saveAssistantError);
        } else if (savedAssistantMsg) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessage.id ? { ...msg, id: savedAssistantMsg.id } : msg
            )
          );
        }
      }
    } catch (error) {
      console.error('AI Chat error:', error);
      
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `❌ ${error instanceof Error ? error.message : 'Erro desconhecido. Tente novamente.'}`,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorMessage]);
      
      toast({
        title: 'Erro',
        description: error instanceof Error ? error.message : 'Erro ao enviar mensagem',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, messages, isLoading, toast]);

  const clearMessages = useCallback(async () => {
    if (!user) {
      setMessages([WELCOME_MESSAGE]);
      return;
    }

    try {
      // Create a new conversation
      const { data: newConv, error: createError } = await supabase
        .from('ai_chat_conversations')
        .insert({ user_id: user.id, title: 'Nova conversa' })
        .select('id')
        .single();

      if (createError) {
        console.error('Error creating new conversation:', createError);
        setMessages([WELCOME_MESSAGE]);
        return;
      }

      setConversationId(newConv.id);
      setMessages([WELCOME_MESSAGE]);
    } catch (error) {
      console.error('Error clearing messages:', error);
      setMessages([WELCOME_MESSAGE]);
    }
  }, [user]);

  return {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
    conversationId,
    isLoadingHistory,
  };
}
