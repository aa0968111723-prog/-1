import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({});
try {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: "hello",
  });
  console.log(response.text);
} catch (e) {
  console.error(e.message);
}
