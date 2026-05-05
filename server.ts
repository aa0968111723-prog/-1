import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { Pinecone } from '@pinecone-database/pinecone';

// Load environment variables from .env if present
dotenv.config();

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
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: error.message || "An error occurred with the Gemini API." });
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
