export enum Role {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

export interface ToolCall {
  id: string;
  name: string;
  args: any;
}

export interface ToolResult {
  id: string;
  name: string;
  result: any;
}

export interface Source {
    title: string;
    uri: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  timestamp: number;
  isLoading?: boolean;
  image?: string; // base64
  sources?: Source[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
}

export interface AudioVisualizerProps {
  stream?: MediaStream;
  analyser?: AnalyserNode;
  isActive: boolean;
}

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error'
}