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
const apiKey = process.env.API_KEY;
if (!apiKey) {
  console.error("API_KEY is missing in .env");
  throw new Error("API_KEY is missing in .env");
}
const ai = new GoogleGenAI({ apiKey });

// --- Helper Functions ---

// 1. Memory Tools (Backend Implementation)
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
  // Simple SQL LIKE search for this MVP. 
  // In production, use Vector Embeddings (pgvector/sqlite-vss).
  const terms = query.split(' ').filter(t => t.length > 3).map(t => `%${t}%`);
  
  if (terms.length === 0) return "Please provide more specific keywords.";

  // Dynamically build query OR clause
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

// 2. Tool Definitions
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
  { googleSearch: {} } // Enable Google Search
];

// --- API Endpoints ---

// 1. Config (Pass API Key to frontend for Live Mode if needed)
app.get('/api/config', (req, res) => {
  res.json({ apiKey: process.env.API_KEY });
});

// 2. Sessions
app.get('/api/sessions', async (req, res) => {
  const sessions = await db.all('SELECT * FROM sessions ORDER BY created_at DESC');
  // Hydrate with last message for preview? For now just return sessions.
  // Ideally we join or subquery, but let's keep it simple.
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

// 3. Chat (Streaming + Tool Use)
app.post('/api/chat', async (req, res) => {
  const { message, history, sessionId } = req.body;

  // Save User Message
  await db.run(
    'INSERT INTO messages (id, session_id, role, text, timestamp, image) VALUES (?, ?, ?, ?, ?, ?)',
    [Date.now().toString(), sessionId, 'user', message, Date.now(), null]
  );

  // Prepare Gemini History
  // We need to convert DB/Frontend format to Gemini format
  const geminiHistory = history.map((msg: any) => ({
    role: msg.role === 'model' ? 'model' : 'user',
    parts: [{ text: msg.text }]
  }));

  // Start Response
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const chat = ai.chats.create({
      model: 'gemini-2.5-flash',
      history: geminiHistory,
      config: {
        tools: tools,
        systemInstruction: "You are a personal agent with access to a long-term memory database. Always check memory if the user asks about personal details.",
      }
    });

    // Initial Stream
    let resultStream = await chat.sendMessageStream({ message: message });
    let fullText = '';
    let toolCalls = [];

    // Helper to process stream
    for await (const chunk of resultStream) {
      // 1. Text
      const text = chunk.text;
      if (text) {
        fullText += text;
        res.write(JSON.stringify({ type: 'text', content: text }) + '\n');
      }

      // 2. Tool Calls
      const calls = chunk.functionCalls;
      if (calls && calls.length > 0) {
          toolCalls.push(...calls);
      }
    }

    // Handle Tool Execution (Single turn for simplicity, or loop)
    // For a robust agent, we loop.
    if (toolCalls.length > 0) {
       const functionResponses = [];
       
       for (const call of toolCalls) {
         let responseObj = { result: 'Unknown tool' };
         
         // Notify frontend tool is executing
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

       // Send tool outputs back to model
       const toolResultStream = await chat.sendMessageStream({ message: functionResponses });
       
       for await (const chunk of toolResultStream) {
         const text = chunk.text;
         if (text) {
           fullText += text;
           res.write(JSON.stringify({ type: 'text', content: text }) + '\n');
         }
         
         // Grounding Metadata (Sources)
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

    // Save Model Response
    await db.run(
        'INSERT INTO messages (id, session_id, role, text, timestamp, image) VALUES (?, ?, ?, ?, ?, ?)',
        [Date.now().toString() + 'r', sessionId, 'model', fullText, Date.now(), null]
    );

    res.end();

  } catch (error) {
    console.error('Chat error:', error);
    res.write(JSON.stringify({ type: 'error', content: 'Internal server error' }));
    res.end();
  }
});

// Start
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});