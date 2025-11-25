import React, { useState, useEffect } from 'react';
import { MessageSquare, Radio, Sparkles, AlertTriangle, Plus, Trash2, MessageCircle } from 'lucide-react';
import ChatMode from './components/ChatMode';
import LiveMode from './components/LiveMode';
import { ChatSession } from './types';

const App: React.FC = () => {
  const [mode, setMode] = useState<'chat' | 'live'>('chat');
  const [apiKey, setApiKey] = useState<string>('');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Fetch Config and Sessions on Mount
  useEffect(() => {
    const init = async () => {
      try {
        // 1. Get API Key for Live Mode
        const configRes = await fetch('http://localhost:3001/api/config');
        if (configRes.ok) {
            const config = await configRes.json();
            setApiKey(config.apiKey);
        }

        // 2. Get Sessions
        const sessionRes = await fetch('http://localhost:3001/api/sessions');
        if (sessionRes.ok) {
            const data = await sessionRes.json();
            setSessions(data);
            if (data.length > 0) {
                setActiveSessionId(data[0].id);
            } else {
                await createNewSession();
            }
        }
      } catch (err) {
        console.error("Failed to connect to backend", err);
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
    
    // Optimistic UI
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setMode('chat');

    // Sync to Backend
    await fetch('http://localhost:3001/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSession)
    });
  };

  const deleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    const newSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(newSessions);
    
    if (activeSessionId === sessionId) {
        if (newSessions.length > 0) setActiveSessionId(newSessions[0].id);
        else createNewSession();
    }

    await fetch(`http://localhost:3001/api/sessions/${sessionId}`, {
        method: 'DELETE'
    });
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
      return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">Connecting to server...</div>;
  }

  if (!apiKey) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-red-900/50 rounded-2xl p-8 text-center shadow-2xl">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-white mb-2">Backend Disconnected</h1>
          <p className="text-slate-400 mb-6">
             Could not retrieve API configuration. Please ensure <code>server.ts</code> is running on port 3001 and has a valid .env file.
          </p>
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
            <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                <h1 className="font-bold text-base leading-tight">Gemini</h1>
                <span className="text-[10px] text-indigo-400 font-bold tracking-widest uppercase">Personal Agent</span>
                </div>
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

            {/* New Chat Button */}
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

          <div className="p-4 border-t border-slate-800">
            <div className="text-xs text-slate-600 text-center">
              Powered by Google Gemini 2.5
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 h-full min-h-0 relative">
          {mode === 'chat' && activeSession ? (
            <ChatMode 
                key={activeSessionId} 
                apiKey={apiKey} // Passed but mostly unused in chat mode now
                session={activeSession}
                onUpdateSession={updateSession}
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