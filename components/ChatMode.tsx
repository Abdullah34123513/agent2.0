import React, { useState, useRef, useEffect } from 'react';
import { Send, Image as ImageIcon, Loader2, Link as LinkIcon, Globe, Database, ArrowRight } from 'lucide-react';
import { ChatSession, ChatMessage, Role } from '../types';

interface ChatModeProps {
  apiKey: string;
  session: ChatSession;
  onUpdateSession: (session: ChatSession) => void;
  selectedModel?: string;
}

const ChatMode: React.FC<ChatModeProps> = ({ session, onUpdateSession, selectedModel = 'gemini-2.5-flash' }) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [session.messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: Role.USER,
      text: input,
      timestamp: Date.now()
    };

    const updatedMessages = [...session.messages, userMessage];
    const newModelMsgId = (Date.now() + 1).toString();
    const modelMessage: ChatMessage = {
        id: newModelMsgId,
        role: Role.MODEL,
        text: '',
        timestamp: Date.now() + 1,
        isLoading: true
    };

    onUpdateSession({
      ...session,
      messages: [...updatedMessages, modelMessage]
    });

    setInput('');
    setIsLoading(true);

    try {
      // Use relative path since we are serving from the same origin now
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.text,
          history: session.messages,
          sessionId: session.id,
          model: selectedModel
        })
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let accumulatedSources: any[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                
                if (data.type === 'text') {
                    accumulatedText += data.content;
                } else if (data.type === 'tool_start') {
                    setActiveTool(data.tool);
                } else if (data.type === 'sources') {
                    accumulatedSources = data.content;
                } else if (data.type === 'error') {
                    accumulatedText += `\n[Error: ${data.content}]`;
                }

                onUpdateSession({
                    ...session,
                    messages: [...updatedMessages, {
                        ...modelMessage,
                        text: accumulatedText,
                        isLoading: false,
                        sources: accumulatedSources.length > 0 ? accumulatedSources : undefined
                    }]
                });

            } catch (e) {
                console.error("Error parsing chunk", e);
            }
        }
      }

    } catch (error) {
      console.error("Error:", error);
      onUpdateSession({
        ...session,
        messages: [...updatedMessages, { ...modelMessage, text: "Error connecting to server. Please check if the backend is running at http://localhost:3001", isLoading: false }]
      });
    } finally {
      setIsLoading(false);
      setActiveTool(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Simple formatter since we removed ReactMarkdown
  const formatText = (text: string) => {
      return text.split('\n').map((str, i) => (
          <p key={i} className="min-h-[1em] mb-1">{str}</p>
      ));
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-xl overflow-hidden shadow-2xl border border-slate-800">
      
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {session.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 opacity-50">
            <Globe className="w-16 h-16 mb-4" />
            <p>Start a conversation with {selectedModel}</p>
          </div>
        )}
        
        {session.messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === Role.USER ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl p-4 shadow-md ${
                msg.role === Role.USER
                  ? 'bg-indigo-600 text-white rounded-tr-none'
                  : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700'
              }`}
            >
              <div className="prose prose-invert prose-sm max-w-none break-words whitespace-pre-wrap font-sans">
                {msg.text}
                {msg.isLoading && (
                    <span className="inline-block w-2 h-4 ml-1 bg-indigo-400 animate-pulse align-middle"></span>
                )}
              </div>

              {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700/50">
                      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2 flex items-center gap-1">
                          <LinkIcon className="w-3 h-3" /> Sources
                      </div>
                      <div className="flex flex-wrap gap-2">
                          {msg.sources.map((source, idx) => (
                              <a 
                                  key={idx} 
                                  href={source.uri} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 bg-slate-900/50 hover:bg-slate-900 px-2 py-1 rounded text-xs text-indigo-300 hover:text-indigo-200 transition-colors border border-slate-700/50"
                              >
                                  <span className="truncate max-w-[150px]">{source.title}</span>
                                  <ArrowRight className="w-2.5 h-2.5 opacity-50" />
                              </a>
                          ))}
                      </div>
                  </div>
              )}
            </div>
          </div>
        ))}
        
        {activeTool && (
            <div className="flex justify-start">
                <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-900/50 px-3 py-1.5 rounded-full border border-slate-800 animate-pulse">
                    {activeTool === 'remember_fact' || activeTool === 'recall_memories' ? (
                        <Database className="w-3 h-3 text-emerald-500" />
                    ) : (
                        <Globe className="w-3 h-3 text-blue-500" />
                    )}
                    <span>
                        {activeTool === 'remember_fact' ? 'Saving memory...' :
                         activeTool === 'recall_memories' ? 'Searching database...' :
                         activeTool === 'googleSearch' ? 'Searching Google...' :
                         'Processing...'}
                    </span>
                </div>
            </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-slate-950 border-t border-slate-800">
        <div className="relative flex items-end gap-2 bg-slate-900 rounded-xl p-2 border border-slate-800 focus-within:border-indigo-500/50 transition-colors">
          <button className="p-2 text-slate-400 hover:text-indigo-400 transition-colors rounded-lg hover:bg-slate-800">
            <ImageIcon className="w-5 h-5" />
          </button>
          
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${selectedModel}...`}
            className="flex-1 bg-transparent text-slate-200 placeholder-slate-500 text-sm p-2 max-h-32 focus:outline-none resize-none"
            rows={1}
            style={{ minHeight: '40px' }}
          />
          
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className={`p-2 rounded-lg transition-all ${
              input.trim() && !isLoading
                ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
        <div className="text-center mt-2 flex justify-between px-2">
             <span className="text-[10px] text-slate-600">Model: {selectedModel}</span>
             <span className="text-[10px] text-slate-600">Secure Backend Connected</span>
        </div>
      </div>
    </div>
  );
};

export default ChatMode;