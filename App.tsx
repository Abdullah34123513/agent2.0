import React, { useState, useEffect } from 'react';
import { MessageSquare, Radio, Sparkles, AlertTriangle, Plus, Trash2, MessageCircle, ChevronDown } from 'lucide-react';
import ChatMode from './components/ChatMode';
import LiveMode from './components/LiveMode';
import { ChatSession } from './types';

const App: React.FC = () => {
  const [mode, setMode] = useState<'chat' | 'live'>('chat');
  const [apiKey, setApiKey] = useState<string>('');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Model Selection State
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');

  useEffect(() => {
    const init = async () => {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Connection timed out")), 5000)
      );

      try {
        // Use relative paths
        const fetchConfig = fetch('/api/config');
        const fetchSessions = fetch('/api/sessions');

        const [configRes, sessionRes] = await Promise.race([
            Promise.all([fetchConfig, fetchSessions]),
            timeout
        ]) as [Response, Response];

        if (configRes.ok) {
            const config = await configRes.json();
            setApiKey(config.apiKey);
        } else {
            throw new Error(`Config API Error: ${configRes.statusText}`);
        }

        if (sessionRes.ok) {
            const data = await sessionRes.json();
            setSessions(data);
            if (data.length > 0) {
                setActiveSessionId(data[0].id);
            } else {
                await createNewSession();
            }
        }
      } catch (err: any) {
        console.error("Failed to connect to backend", err);
        setError(err.message || "Failed to connect");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const createNewSession = async () => {
    const newSession: ChatSession = {
        id: Date.now().toString(),
        title: 'New Chat',
        messages: [],
        createdAt: Date.now()
    };
    
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setMode('chat');

    try {
        await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSession)
        });
    } catch (e) {
        console.error("Failed to save session", e);
    }
  };

  const deleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    const newSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(newSessions);
    
    if (activeSessionId === sessionId) {
        if (newSessions.length > 0) setActiveSessionId(newSessions[0].id);
        else createNewSession();
    }

    try {
        await fetch(`/api/sessions/${sessionId}`, {
            method: 'DELETE'
        });
    } catch (e) {
        console.error("Failed to delete session", e);
    }
  };

  const updateSession = (updatedSession: ChatSession) => {
    setSessions(prev => prev.map(s => {
        if (s.id === updatedSession.id) {
            let title = s.title;
            if (title === 'New Chat' && updatedSession.messages.length > 0) {
                const firstMsg = updatedSession.messages[0];
                if (firstMsg.role === 'user' && firstMsg.text) {
                    title = firstMsg.text.slice(0, 30) + (firstMsg.text.length > 30 ? '...' : '');
                }
            }
            return { ...updatedSession, title };
        }
        return s;
    }));
  };

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];

  if (loading) {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-500 space-y-4">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <p>Connecting to backend...</p>
        </div>
      );
  }

  // Graceful degradation: If config loads but apiKey is empty, we still show the app but warn the user.
  // If connection completely failed (network error), show the error screen.
  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-red-900/50 rounded-2xl p-8 text-center shadow-2xl">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-white mb-2">Backend Connection Failed</h1>
          <p className="text-slate-400 mb-6 text-sm">
             Could not connect to the Express server.
          </p>
          <div className="bg-slate-950 p-4 rounded-lg text-left text-xs font-mono text-red-300 overflow-auto max-h-32 mb-6 border border-slate-800">
             {error}
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="mt-6 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors text-sm"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 md:p-6 lg:p-8 font-sans">
      <div className="w-full max-w-6xl h-[90vh] flex flex-col md:flex-row gap-6">
        
        {/* Sidebar Navigation */}
        <div className="w-full md:w-72 bg-slate-900 rounded-2xl border border-slate-800 flex flex-col shrink-0 shadow-xl overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-slate-800">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                <h1 className="font-bold text-base leading-tight">Gemini</h1>
                <span className="text-[10px] text-indigo-400 font-bold tracking-widest uppercase">Personal Agent</span>
                </div>
            </div>

            {/* API Key Warning */}
            {!apiKey && (
                 <div className="mb-4 p-2 bg-yellow-900/20 border border-yellow-700/50 rounded text-xs text-yellow-500">
                    API Key missing. Chat will not respond.
                 </div>
            )}

            {/* Model Selector Dropdown */}
            <div className="relative mb-4 group">
                <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                    <ChevronDown className="w-3 h-3 text-slate-500" />
                </div>
                <select 
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full appearance-none bg-slate-950 text-slate-300 text-xs font-medium py-2 px-3 rounded-lg border border-slate-800 focus:border-indigo-500 focus:outline-none transition-colors cursor-pointer"
                >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Fast)</option>
                    <option value="gemini-3-pro-preview">Gemini 3.0 Pro (Thinking)</option>
                </select>
            </div>

            {/* Mode Switcher */}
            <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-xl mb-4">
                <button
                    onClick={() => setMode('chat')}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                        mode === 'chat' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                    <MessageSquare className="w-4 h-4" />
                    Chat
                </button>
                <button
                    onClick={() => setMode('live')}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                        mode === 'live' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                    <Radio className="w-4 h-4" />
                    Live
                </button>
            </div>

            <button
                onClick={createNewSession}
                className="w-full flex items-center gap-2 justify-center py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors font-medium text-sm border border-slate-700"
            >
                <Plus className="w-4 h-4" />
                New Conversation
            </button>
          </div>

          {/* Session History List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
             <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                History
             </div>
             {sessions.map(session => (
                 <button
                    key={session.id}
                    onClick={() => {
                        setActiveSessionId(session.id);
                        setMode('chat');
                    }}
                    className={`group w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                        activeSessionId === session.id && mode === 'chat'
                        ? 'bg-indigo-900/20 border border-indigo-500/30 text-indigo-100' 
                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 border border-transparent'
                    }`}
                 >
                    <MessageCircle className={`w-4 h-4 shrink-0 ${activeSessionId === session.id && mode === 'chat' ? 'text-indigo-400' : 'text-slate-600'}`} />
                    <div className="flex-1 min-w-0">
                        <div className="truncate text-sm font-medium">{session.title}</div>
                        <div className="text-[10px] text-slate-600 truncate">
                            {new Date(session.createdAt).toLocaleDateString()}
                        </div>
                    </div>
                    {sessions.length > 1 && (
                        <div 
                            onClick={(e) => deleteSession(e, session.id)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-900/30 hover:text-red-400 rounded-lg transition-all"
                            title="Delete Chat"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </div>
                    )}
                 </button>
             ))}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 h-full min-h-0 relative">
          {mode === 'chat' && activeSession ? (
            <ChatMode 
                key={activeSessionId} 
                apiKey={apiKey}
                session={activeSession}
                onUpdateSession={updateSession}
                selectedModel={selectedModel}
            />
          ) : (
            <LiveMode apiKey={apiKey} />
          )}
        </div>

      </div>
    </div>
  );
};

export default App;