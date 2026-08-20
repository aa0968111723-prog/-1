import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { Pinecone } from '@pinecone-database/pinecone';

// Load environment variables from .env if present
dotenv.config({ override: true });

/**
 * Kept in step with src/lib/financeContext.ts. The client sends the same rules
 * with every grounded request; the server sets them as the system instruction
 * so they cannot be dropped by a caller that forgets.
 */
const FINANCE_SYSTEM_PROMPT = `你是 FinTracker 的財務助理。使用繁體中文，簡潔、具體。

【資料來源】
使用者訊息會附上一份 FINANCE_CONTEXT JSON，那是由本機的分析引擎精確計算出來的。
- 只依據 FINANCE_CONTEXT 回答財務數字。
- FINANCE_CONTEXT 裡沒有的東西，就說你手上沒有那項資料，並說明使用者可以去哪裡看。
- 絕對不要編造交易、金額、日期或分類。
- 不要自己重新加總大量數字。引擎已經算好了（而且是用整數精確運算），
  直接引用 income / expense / categoryChanges 等欄位。你可以做簡單的比較與百分比說明。
- 金額一律寫成 NT$ 加千分位，例如 NT$ 1,280。

【隱私】
FINANCE_CONTEXT 只包含彙總數字，不含備註與商家名稱。
使用者若問到某一筆的細節，請告訴他在「收支明細」可以看到，不要猜內容。

【語氣】
陳述事實，不評價。不要說「亂花」「浪費」「太多」「不該」這類字眼，
也不要暗示使用者做錯了。使用者要的是看清楚自己的錢，不是被自己的記帳軟體訓話。
提出建議時給具體可執行的做法，並說清楚那是根據哪個數字。`;

const GENERIC_SYSTEM_PROMPT =
  "You are an expert AI financial advisor and API integration specialist. You can help users building finance apps, analyzing website payment flows, and checking API statuses. Respond in Traditional Chinese. Be concise and professional.";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to parse JSON bodies
  app.use(express.json());

  // ==========================================
  // API Routes Start Here
  // ==========================================

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", environment: process.env.NODE_ENV || "development" });
  });

  // Example: Real Gemini API Route (Using @google/genai in Backend)
  app.post("/api/gemini/chat", async (req, res) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }
      
      // Import dynamically to preserve lightweight server startup if key is missing initially
      const { GoogleGenAI } = await import("@google/genai");
      
      // Attempt to load the API key prioritizing the specific User configured key if present
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
         return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: error.message || "An error occurred with the Gemini API." });
    }
  });

  // Assistant Chat Route
  app.post("/api/gemini/assistant", async (req, res) => {
    try {
      const { messages = [], message, grounded } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }
      
      const { GoogleGenAI } = await import("@google/genai");
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
         return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }

      const contents = messages.map((msg: any) => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));
      contents.push({ role: 'user', parts: [{ text: message }] });

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents,
        config: {
          // A grounded request carries a FINANCE_CONTEXT payload the local
          // analytics engine computed exactly. In that mode the model must
          // answer from those numbers and nothing else, and web search is
          // turned OFF — searching the internet to answer "我這個月花多少"
          // can only produce a made-up figure.
          systemInstruction: grounded ? FINANCE_SYSTEM_PROMPT : GENERIC_SYSTEM_PROMPT,
          ...(grounded ? {} : { tools: [{ googleSearch: {} }] }),
        }
      });

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources: { uri: string; title: string }[] = [];
      
      for (const chunk of chunks) {
        if (chunk.web?.uri) {
          sources.push({ uri: chunk.web.uri, title: chunk.web.title });
        }
      }

      res.json({ text: response.text, sources: sources.length > 0 ? sources : undefined });
    } catch (error: any) {
      console.error("Gemini Assistant Error:", error);
      res.status(500).json({ error: error.message || "An error occurred." });
    }
  });

  // Background Image Generator
  app.post("/api/gemini/generate-bg", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt) return res.status(400).json({ error: "Prompt is required" });
      
      const { GoogleGenAI } = await import("@google/genai");
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-image',
        contents: {
          parts: [{ text: `Aesthetically pleasing background image for a dark mode compatible chat window, ${prompt}` }],
        },
        config: {
          imageConfig: {
            aspectRatio: "3:4"
          }
        }
      });

      let base64Image = null;
      let mimeType = null;
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
           base64Image = part.inlineData.data;
           mimeType = part.inlineData.mimeType || 'image/png';
           break;
        }
      }
      
      if (!base64Image) throw new Error("No image generated");
      
      res.json({ imageUrl: `data:${mimeType};base64,${base64Image}` });
    } catch (error: any) {
      console.error("Gemini BG Gen Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ElevenLabs Text-to-Speech API integration
  app.post("/api/elevenlabs/tts", async (req, res) => {
    try {
      const { text, voiceId = "21m00Tcm4TlvDq8ikWAM" } = req.body; // Default voice: Rachel
      
      if (!text) {
        return res.status(400).json({ error: "Text is required" });
      }
      
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
         return res.status(500).json({ error: "ELEVENLABS_API_KEY is not configured on the server." });
      }

      // Fetch audio from ElevenLabs
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2", // Multilingual model supports Chinese
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        let parsedErr;
        try { parsedErr = JSON.parse(errText); } catch(e) { parsedErr = { message: errText }; }
        throw new Error(parsedErr.detail?.message || parsedErr.message || `ElevenLabs API HTTP error: ${response.status}`);
      }

      // Return the audio stream back to the client
      res.setHeader("Content-Type", "audio/mpeg");
      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (error: any) {
      console.error("ElevenLabs API Error:", error);
      res.status(500).json({ error: error.message || "An error occurred with ElevenLabs API." });
    }
  });

  app.get("/api/pinecone/status", async (req, res) => {
    try {
      const apiKey = process.env.PINECONE_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "PINECONE_API_KEY is not configured." });
      }
      
      const pc = new Pinecone({ apiKey });
      const indexes = await pc.listIndexes();
      
      res.json({ 
        status: "connected", 
        indexes: indexes.indexes || []
      });
    } catch (error: any) {
      console.error("Pinecone Error:", error);
      res.status(500).json({ error: error.message || "An error occurred with Pinecone." });
    }
  });

  // Suno AI Music Generation API (Proxy / Mock depending on wrapper)
  app.post("/api/suno/generate", async (req, res) => {
    try {
      const { prompt } = req.body;
      const apiKey = process.env.SUNO_API_KEY;
      
      if (!prompt) return res.status(400).json({ error: "Prompt is required" });
      if (!apiKey) return res.status(500).json({ error: "SUNO_API_KEY is not configured." });

      // Note: Because Suno doesn't have an official public REST API, this is set up to route
      // to a common unofficial endpoint wrapper, or return a mock audio file for testing.
      // Replace the fetch URL with your specific Suno provider's endpoint.
      
      /* Example real integration:
      const response = await fetch("https://api.sunoaiapi.com/api/v1/generate", { ... });
      */
      
      // Simulating the API response for the playground demonstration
      await new Promise(r => setTimeout(r, 2000));
      
      res.json({
        id: "mock_suno_12345",
        status: "completed",
        title: "AI Director Theme",
        audio_url: "https://actions.google.com/sounds/v1/water/rain_on_roof.ogg", // Public test audio URL
        prompt: prompt
      });
    } catch (error: any) {
      console.error("Suno API Error:", error);
      res.status(500).json({ error: error.message || "An error occurred with Suno API." });
    }
  });

  // Fal AI Image Generation API
  app.post("/api/fal/generate", async (req, res) => {
    try {
      const { prompt, image_size = "landscape_4_3" } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }
      
      const apiKey = process.env.FAL_API_KEY;
      if (!apiKey) {
         return res.status(500).json({ error: "FAL_API_KEY is not configured on the server." });
      }

      // Using the fal.run flux/schnell endpoint for fast text-to-image
      const response = await fetch("https://fal.run/fal-ai/flux/schnell", {
        method: "POST",
        headers: {
          "Authorization": `Key ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prompt, image_size })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Fal API HTTP error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Fal API Error:", error);
      res.status(500).json({ error: error.message || "An error occurred with Fal API." });
    }
  });

  // ==========================================
  // Vite Middleware & Static Serving
  // ==========================================

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve the dist folder
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // SPA fallback
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
