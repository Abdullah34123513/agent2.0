import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the current directory
// This allows you to visit http://localhost:3001 to see the app
// Fix: Use path.resolve() instead of __dirname to avoid TypeScript errors
app.use(express.static(path.resolve()));

// Database Setup
let db: Database;

async function initDb() {
  db = await open({
    filename: './agent.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      role TEXT,
      text TEXT,
      timestamp INTEGER,
      image TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT,
      category TEXT,
      timestamp INTEGER
    );
  `);
  console.log('Database initialized');
}

// --- Gemini Setup ---
// We lazily initialize this to allow the server to start even if the key is missing initially
let ai: GoogleGenAI | null = null;
const apiKey = process.env.API_KEY;
if (apiKey) {
  ai = new GoogleGenAI({ apiKey });
} else {
  console.warn("WARNING: API_KEY is missing in .env. AI features will fail until configured.");
}

// --- Helper Functions ---

async function storeMemory(content: string, category: string = 'general') {
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const timestamp = Date.now();
  await db.run(
    'INSERT INTO memories (id, content, category, timestamp) VALUES (?, ?, ?, ?)',
    [id, content, category, timestamp]
  );
  return `Memory stored: "${content}"`;
}

async function searchMemory(query: string) {
  const terms = query.split(' ').filter(t => t.length > 3).map(t => `%${t}%`);
  if (terms.length === 0) return "Please provide more specific keywords.";

  const whereClause = terms.map(() => `content LIKE ?`).join(' OR ');
  const memories = await db.all(
    `SELECT content, category, timestamp FROM memories WHERE ${whereClause} LIMIT 5`,
    terms
  );

  if (memories.length === 0) return "No relevant memories found.";
  
  return JSON.stringify(memories.map(m => ({
    content: m.content,
    date: new Date(m.timestamp).toISOString().split('T')[0]
  })));
}

const tools = [
  {
    functionDeclarations: [
      {
        name: 'remember_fact',
        description: 'Store a fact or user preference in long-term memory database.',
        parameters: {
          type: 'OBJECT',
          properties: {
            fact: { type: 'STRING', description: 'The information to remember.' },
            category: { type: 'STRING', description: 'Category (e.g., user_info, preference, fact).' }
          },
          required: ['fact']
        }
      },
      {
        name: 'recall_memories',
        description: 'Search long-term memory database for facts.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Search keywords.' }
          },
          required: ['query']
        }
      }
    ]
  },
  { googleSearch: {} }
];

// --- API Endpoints ---

app.get('/api/config', (req, res) => {
  res.json({ apiKey: process.env.API_KEY || '' });
});

app.get('/api/sessions', async (req, res) => {
  const sessions = await db.all('SELECT * FROM sessions ORDER BY created_at DESC');
  const result = [];
  for (const s of sessions) {
     const msgs = await db.all('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC', s.id);
     result.push({ ...s, messages: msgs });
  }
  res.json(result);
});

app.post('/api/sessions', async (req, res) => {
  const { id, title, created_at } = req.body;
  await db.run(
    'INSERT INTO sessions (id, title, created_at) VALUES (?, ?, ?)',
    [id, title, created_at]
  );
  res.json({ success: true });
});

app.delete('/api/sessions/:id', async (req, res) => {
  await db.run('DELETE FROM sessions WHERE id = ?', req.params.id);
  res.json({ success: true });
});

app.post('/api/chat', async (req, res) => {
  const { message, history, sessionId, model } = req.body;

  if (!ai) {
    res.status(500).json({ error: "API Key not configured on server." });
    return;
  }

  // Use the user-selected model or default to flash
  // Map common names to actual model IDs if needed, or use directly
  const selectedModel = model || 'gemini-2.5-flash';

  await db.run(
    'INSERT INTO messages (id, session_id, role, text, timestamp, image) VALUES (?, ?, ?, ?, ?, ?)',
    [Date.now().toString(), sessionId, 'user', message, Date.now(), null]
  );

  const geminiHistory = history.map((msg: any) => ({
    role: msg.role === 'model' ? 'model' : 'user',
    parts: [{ text: msg.text }]
  }));

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const chat = ai.chats.create({
      model: selectedModel,
      history: geminiHistory,
      config: {
        tools: tools,
        systemInstruction: "You are a personal agent. Use your memory tools to store and retrieve user details.",
      }
    });

    let resultStream = await chat.sendMessageStream({ message: message });
    let fullText = '';
    let toolCalls = [];

    for await (const chunk of resultStream) {
      const text = chunk.text;
      if (text) {
        fullText += text;
        res.write(JSON.stringify({ type: 'text', content: text }) + '\n');
      }
      const calls = chunk.functionCalls;
      if (calls && calls.length > 0) {
          toolCalls.push(...calls);
      }
    }

    if (toolCalls.length > 0) {
       const functionResponses = [];
       
       for (const call of toolCalls) {
         let responseObj = { result: 'Unknown tool' };
         
         res.write(JSON.stringify({ type: 'tool_start', tool: call.name }) + '\n');

         if (call.name === 'remember_fact') {
           const result = await storeMemory(call.args.fact, call.args.category);
           responseObj = { result };
         } else if (call.name === 'recall_memories') {
           const result = await searchMemory(call.args.query);
           responseObj = { result };
         }

         functionResponses.push({
           functionResponse: {
             name: call.name,
             response: responseObj
           }
         });
       }

       const toolResultStream = await chat.sendMessageStream({ message: functionResponses });
       
       for await (const chunk of toolResultStream) {
         const text = chunk.text;
         if (text) {
           fullText += text;
           res.write(JSON.stringify({ type: 'text', content: text }) + '\n');
         }
         
         if (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks) {
            const chunks = chunk.candidates[0].groundingMetadata.groundingChunks;
            const sources = chunks
                .filter((c: any) => c.web?.uri && c.web?.title)
                .map((c: any) => ({ title: c.web.title, uri: c.web.uri }));
            
            if (sources.length > 0) {
                res.write(JSON.stringify({ type: 'sources', content: sources }) + '\n');
            }
         }
       }
    }

    await db.run(
        'INSERT INTO messages (id, session_id, role, text, timestamp, image) VALUES (?, ?, ?, ?, ?, ?)',
        [Date.now().toString() + 'r', sessionId, 'model', fullText, Date.now(), null]
    );

    res.end();

  } catch (error: any) {
    console.error('Chat error:', error);
    res.write(JSON.stringify({ type: 'error', content: error.message || 'Internal server error' }));
    res.end();
  }
});

// Fallback for any other route to serve index.html (SPA support)
app.get('*', (req, res) => {
    // Fix: Use path.resolve() instead of __dirname to avoid TypeScript errors
    res.sendFile(path.join(path.resolve(), 'index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Visit http://localhost:${PORT} to view your agent.`);
  });
});