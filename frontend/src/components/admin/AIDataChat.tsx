import { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Trash2, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAIChat, type ChatMessage } from '@/hooks/useAIChat';
import { cn } from '@/lib/utils';

export function AIDataChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const { messages, isLoading, sendMessage, clearMessages } = useAIChat();
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change or chat opens
  useEffect(() => {
    const scrollToBottom = () => {
      if (scrollViewportRef.current) {
        scrollViewportRef.current.scrollTop = scrollViewportRef.current.scrollHeight;
      }
    };
    // Use setTimeout to ensure DOM has updated
    const timer = setTimeout(scrollToBottom, 50);
    return () => clearTimeout(timer);
  }, [messages, isOpen]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;
    
    const message = input;
    setInput('');
    await sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Floating button when closed
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-r from-primary to-accent shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 flex items-center justify-center group"
        aria-label="Abrir DNIA AI"
      >
        <Sparkles className="h-7 w-7 text-white group-hover:animate-pulse" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[380px] h-[500px] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-primary to-accent text-white">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <span className="font-semibold">DNIA AI</span>
          <span className="text-xs opacity-80">Analista de Dados</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white hover:bg-white/20"
            onClick={clearMessages}
            title="Limpar conversa"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white hover:bg-white/20"
            onClick={() => setIsOpen(false)}
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      {/* Messages area with native scroll */}
      <div 
        ref={scrollViewportRef} 
        className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
      >
        <div className="space-y-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Analisando...</span>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-border bg-muted/30">
        <div className="flex gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre seus leads..."
            className="min-h-[44px] max-h-[100px] resize-none text-sm"
            disabled={isLoading}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading}
            className="h-11 w-11 shrink-0 bg-gradient-to-r from-primary to-accent hover:opacity-90"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-xl px-3 py-2 text-sm',
          isUser
            ? 'bg-gradient-to-r from-primary to-accent text-white'
            : 'bg-muted text-foreground'
        )}
      >
        <div className="break-words">
          {formatMessage(message.content)}
        </div>
      </div>
    </div>
  );
}

// Parse markdown table and return React element
function parseMarkdownTable(lines: string[]): React.ReactNode | null {
  if (lines.length < 2) return null;
  
  // Check if first line looks like a table header
  const headerLine = lines[0].trim();
  if (!headerLine.startsWith('|') || !headerLine.endsWith('|')) return null;
  
  // Find table boundaries
  const tableLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      tableLines.push(trimmed);
    } else if (tableLines.length > 0) {
      break;
    }
  }
  
  if (tableLines.length < 2) return null;
  
  // Parse headers
  const headers = tableLines[0]
    .split('|')
    .filter(Boolean)
    .map(h => h.trim());
  
  // Skip separator line (index 1) and parse data rows
  const dataRows = tableLines.slice(2).map(row =>
    row.split('|').filter(Boolean).map(cell => cell.trim())
  );
  
  return (
    <div className="overflow-x-auto my-2 rounded border border-border">
      <table className="min-w-full text-xs">
        <thead className="bg-muted/80">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-2 py-1.5 text-left font-semibold border-b border-border">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-1 border-b border-border/50">
                  {formatInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Parse list items
function parseList(lines: string[]): { element: React.ReactNode; count: number } | null {
  const listItems: string[] = [];
  let isOrdered = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^[-*•]\s+/)) {
      listItems.push(trimmed.replace(/^[-*•]\s+/, ''));
    } else if (trimmed.match(/^\d+\.\s+/)) {
      isOrdered = true;
      listItems.push(trimmed.replace(/^\d+\.\s+/, ''));
    } else if (listItems.length > 0) {
      break;
    }
  }
  
  if (listItems.length === 0) return null;
  
  const ListTag = isOrdered ? 'ol' : 'ul';
  
  return {
    element: (
      <ListTag className={cn(
        "my-1.5 ml-4 space-y-0.5",
        isOrdered ? "list-decimal" : "list-disc"
      )}>
        {listItems.map((item, i) => (
          <li key={i} className="text-sm">{formatInline(item)}</li>
        ))}
      </ListTag>
    ),
    count: listItems.length
  };
}

// Main message formatter
function formatMessage(content: string): React.ReactNode {
  const elements: React.ReactNode[] = [];
  
  // Split by code blocks first
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  const segments: { type: 'text' | 'code'; content: string; language?: string }[] = [];
  
  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', content: match[2], language: match[1] });
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) });
  }
  
  segments.forEach((segment, segIndex) => {
    if (segment.type === 'code') {
      elements.push(
        <pre key={`code-${segIndex}`} className="bg-background/60 rounded-md p-2 my-2 overflow-x-auto text-xs font-mono border border-border/50">
          <code>{segment.content.trim()}</code>
        </pre>
      );
      return;
    }
    
    // Process text content
    const lines = segment.content.split('\n');
    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // Empty line
      if (!trimmedLine) {
        elements.push(<div key={`space-${segIndex}-${i}`} className="h-2" />);
        i++;
        continue;
      }
      
      // Check for table
      if (trimmedLine.startsWith('|') && trimmedLine.endsWith('|')) {
        const tableLines = [];
        let j = i;
        while (j < lines.length && lines[j].trim().startsWith('|') && lines[j].trim().endsWith('|')) {
          tableLines.push(lines[j]);
          j++;
        }
        const table = parseMarkdownTable(tableLines);
        if (table) {
          elements.push(<div key={`table-${segIndex}-${i}`}>{table}</div>);
          i = j;
          continue;
        }
      }
      
      // Check for list
      if (trimmedLine.match(/^[-*•]\s+/) || trimmedLine.match(/^\d+\.\s+/)) {
        const listResult = parseList(lines.slice(i));
        if (listResult) {
          elements.push(<div key={`list-${segIndex}-${i}`}>{listResult.element}</div>);
          i += listResult.count;
          continue;
        }
      }
      
      // Check for headers
      if (trimmedLine.startsWith('### ')) {
        elements.push(
          <h4 key={`h4-${segIndex}-${i}`} className="font-semibold text-sm mt-2 mb-1">
            {formatInline(trimmedLine.slice(4))}
          </h4>
        );
        i++;
        continue;
      }
      
      if (trimmedLine.startsWith('## ')) {
        elements.push(
          <h3 key={`h3-${segIndex}-${i}`} className="font-bold text-sm mt-2 mb-1">
            {formatInline(trimmedLine.slice(3))}
          </h3>
        );
        i++;
        continue;
      }
      
      if (trimmedLine.startsWith('# ')) {
        elements.push(
          <h2 key={`h2-${segIndex}-${i}`} className="font-bold text-base mt-2 mb-1">
            {formatInline(trimmedLine.slice(2))}
          </h2>
        );
        i++;
        continue;
      }
      
      // Horizontal rule
      if (trimmedLine.match(/^[-—]{3,}$/)) {
        elements.push(<hr key={`hr-${segIndex}-${i}`} className="my-2 border-border/50" />);
        i++;
        continue;
      }
      
      // Regular paragraph
      elements.push(
        <p key={`p-${segIndex}-${i}`} className="text-sm leading-relaxed">
          {formatInline(trimmedLine)}
        </p>
      );
      i++;
    }
  });
  
  return <div className="space-y-1">{elements}</div>;
}

// Inline formatting: bold, italic, code, links
function formatInline(text: string): React.ReactNode {
  if (!text) return text;
  
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;
  
  // Process inline patterns
  const patterns = [
    { regex: /\*\*(.+?)\*\*/g, render: (match: string) => <strong key={keyIndex++}>{match}</strong> },
    { regex: /\*(.+?)\*/g, render: (match: string) => <em key={keyIndex++}>{match}</em> },
    { regex: /`([^`]+)`/g, render: (match: string) => (
      <code key={keyIndex++} className="bg-background/60 px-1 py-0.5 rounded text-xs font-mono">
        {match}
      </code>
    )},
  ];
  
  // Simple approach: process bold first, then italic, then code
  const processPattern = (text: string, regex: RegExp, render: (m: string) => React.ReactNode): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    let lastIdx = 0;
    let match;
    
    const regexCopy = new RegExp(regex.source, regex.flags);
    
    while ((match = regexCopy.exec(text)) !== null) {
      if (match.index > lastIdx) {
        result.push(text.slice(lastIdx, match.index));
      }
      result.push(render(match[1]));
      lastIdx = match.index + match[0].length;
    }
    
    if (lastIdx < text.length) {
      result.push(text.slice(lastIdx));
    }
    
    return result.length > 0 ? result : [text];
  };
  
  // Process bold
  const boldParts = processPattern(remaining, /\*\*(.+?)\*\*/g, (m) => <strong key={keyIndex++}>{m}</strong>);
  
  // Process italic in each part
  const italicParts = boldParts.flatMap(part => {
    if (typeof part === 'string') {
      return processPattern(part, /\*([^*]+)\*/g, (m) => <em key={keyIndex++}>{m}</em>);
    }
    return [part];
  });
  
  // Process inline code in each part
  const codeParts = italicParts.flatMap(part => {
    if (typeof part === 'string') {
      return processPattern(part, /`([^`]+)`/g, (m) => (
        <code key={keyIndex++} className="bg-background/60 px-1 py-0.5 rounded text-xs font-mono">
          {m}
        </code>
      ));
    }
    return [part];
  });
  
  return codeParts.length === 1 ? codeParts[0] : <>{codeParts}</>;
}
