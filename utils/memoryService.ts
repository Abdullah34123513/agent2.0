export interface MemoryItem {
  id: string;
  content: string;
  category: string;
  timestamp: number;
}

// Client-side service to talk to the Backend Memory API
export const MemoryService = {
  // Store a new fact via API
  async store(content: string, category: string = 'general'): Promise<string> {
    try {
        // We don't actually call this directly from frontend usually, 
        // the Backend Chat Agent calls its own DB.
        // But for debugging or direct addition:
        return "Memory storage is now handled automatically by the backend agent.";
    } catch (e) {
        return "Failed to store memory.";
    }
  },

  // Search for relevant facts
  async search(query: string): Promise<string> {
    // Similarly, search is now done by the backend agent during tool use.
    return "Memory search is handled by backend.";
  },

  // Get all memories (for debugging)
  async getAll(): Promise<MemoryItem[]> {
    // You could implement a GET /api/memories endpoint if needed
    return [];
  }
};