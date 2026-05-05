import React, { useState } from 'react';
import { Cpu, Send, Loader2, Sparkles, Key, Mic, Play, Image as ImageIcon, Music, Database } from 'lucide-react';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import { apiFetch } from '../lib/api';

export default function ApiPlayground() {
  // Gemini State
  const [prompt, setPrompt] = useState('分析目前加密貨幣市場對個人理財的影響，約100字以內。');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // ElevenLabs State
  const [elevenText, setElevenText] = useState('您好，歡迎使用 AI Director 系統！測試語音生成能力。');
  const [elevenAudioUrl, setElevenAudioUrl] = useState<string | null>(null);
  const [isElevenLoading, setIsElevenLoading] = useState(false);
  const [elevenError, setElevenError] = useState('');

  // Fal AI State
  const [falPrompt, setFalPrompt] = useState('一隻在賽博龐克城市中喝咖啡的可愛柴犬，電影級光影，高畫質');
  const [falImageUrl, setFalImageUrl] = useState<string | null>(null);
  const [isFalLoading, setIsFalLoading] = useState(false);
  const [falError, setFalError] = useState('');

  // Suno AI State
  const [sunoPrompt, setSunoPrompt] = useState('一首關於在下雨天喝咖啡的輕快爵士樂');
  const [sunoAudioUrl, setSunoAudioUrl] = useState<string | null>(null);
  const [sunoSongTitle, setSunoSongTitle] = useState<string | null>(null);
  const [isSunoLoading, setIsSunoLoading] = useState(false);
  const [sunoError, setSunoError] = useState('');

  // Pinecone State
  const [pineconeResponse, setPineconeResponse] = useState<any>(null);
  const [isPineconeLoading, setIsPineconeLoading] = useState(false);
  const [pineconeError, setPineconeError] = useState('');

  const handleTestGemini = async () => {
    if (!prompt.trim()) return;
    
    setIsLoading(true);
    setError('');
    setResponse('');
    
    try {
      const res = await apiFetch('/api/gemini/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || `HTTP Error ${res.status}`);
      }
      
      setResponse(data.text);
    } catch (err: any) {
      console.error(err);
      setError(err.message || '連線後端發生錯誤');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestElevenLabs = async () => {
    if (!elevenText.trim()) return;
    
    setIsElevenLoading(true);
    setElevenError('');
    if (elevenAudioUrl) {
      URL.revokeObjectURL(elevenAudioUrl);
      setElevenAudioUrl(null);
    }
    
    try {
      const res = await apiFetch('/api/elevenlabs/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: elevenText })
      });
      
      if (!res.ok) {
        // Since we expect a blob for success, check content type or parse as JSON on error
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
           const data = await res.json();
           throw new Error(data.error || `HTTP Error ${res.status}`);
        } else {
           const text = await res.text();
           throw new Error(`HTTP Error ${res.status}: ${text}`);
        }
      }
      
      // Parse success response as Blob (Audio buffer)
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setElevenAudioUrl(url);
    } catch (err: any) {
      console.error(err);
      setElevenError(err.message || '連線後端發生錯誤');
    } finally {
      setIsElevenLoading(false);
    }
  };

  const handleTestFal = async () => {
    if (!falPrompt.trim()) return;
    
    setIsFalLoading(true);
    setFalError('');
    setFalImageUrl(null);
    
    try {
      const res = await apiFetch('/api/fal/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt: falPrompt })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || `HTTP Error ${res.status}`);
      }
      
      if (data.images && data.images.length > 0) {
        setFalImageUrl(data.images[0].url);
      } else {
        throw new Error("Fal API 返回了空的影像陣列");
      }
    } catch (err: any) {
      console.error(err);
      setFalError(err.message || '連線後端發生錯誤');
    } finally {
      setIsFalLoading(false);
    }
  };

  const handleTestSuno = async () => {
    if (!sunoPrompt.trim()) return;
    
    setIsSunoLoading(true);
    setSunoError('');
    setSunoAudioUrl(null);
    setSunoSongTitle(null);
    
    try {
      const res = await apiFetch('/api/suno/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: sunoPrompt })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || `HTTP Error ${res.status}`);
      }
      
      setSunoAudioUrl(data.audio_url);
      setSunoSongTitle(data.title);
    } catch (err: any) {
      console.error(err);
      setSunoError(err.message || '連線後端發生錯誤');
    } finally {
      setIsSunoLoading(false);
    }
  };

  const handleTestPinecone = async () => {
    setIsPineconeLoading(true);
    setPineconeError('');
    setPineconeResponse(null);
    
    try {
      const res = await apiFetch('/api/pinecone/status');
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || `HTTP Error ${res.status}`);
      }
      
      setPineconeResponse(data);
    } catch (err: any) {
      console.error(err);
      setPineconeError(err.message || '連線後端發生錯誤');
    } finally {
      setIsPineconeLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass p-6 border border-white/10">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3 text-white">
            <div className="p-2 bg-[#60A5FA]/20 rounded-lg text-[#60A5FA]">
              <Cpu size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">AI 整合測試中心 (API Integration Testing)</h2>
              <p className="text-white/50 text-sm mt-1">
                透過真實的 Node.js 後端呼叫 API，避免在前端洩漏您的環境變數 (Keys)。
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 bg-[#4ADE80]/10 border border-[#4ADE80]/30 px-3 py-1.5 rounded-full">
            <Key size={14} className="text-[#4ADE80]" />
            <span className="text-[#4ADE80] text-xs font-bold uppercase">使用後端真實 API Key</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Gemini Test Form */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Sparkles size={16} className="text-[#A78BFA]" />
                Google Gemini (2.5-Flash)
              </h3>
              <span className="text-xs text-white/40 font-mono">POST /api/gemini/chat</span>
            </div>
            
            <div>
              <label className="text-[10px] text-white/50 font-bold uppercase tracking-widest mb-2 block">
                傳送提示詞 (Prompt)
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full h-32 bg-black/20 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:border-[#60A5FA]/50 resize-none font-mono"
                placeholder="輸入測試文字..."
              />
            </div>
            
            <button
              onClick={handleTestGemini}
              disabled={isLoading || !prompt.trim()}
              className="w-full flex items-center justify-center gap-2 bg-[#60A5FA] hover:bg-[#3B82F6] disabled:bg-white/10 disabled:text-white/30 text-white px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> 處理中...
                </>
              ) : (
                <>
                  <Send size={16} /> 傳送測試請求
                </>
              )}
            </button>
          </div>

          {/* Response Area */}
          <div className="space-y-4 h-full flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h3 className="font-bold text-white">後端回應 (Server Response)</h3>
              {response && <span className="text-xs text-[#4ADE80] font-mono">200 OK</span>}
              {error && <span className="text-xs text-[#F87171] font-mono">500 ERR</span>}
            </div>

            <div className="flex-1 bg-black/30 border border-white/5 rounded-lg p-4 min-h-[200px] overflow-y-auto">
              {isLoading && (
                <div className="h-full flex items-center justify-center text-[#60A5FA] animate-pulse">
                  等待後端處理...
                </div>
              )}
              
              {!isLoading && !response && !error && (
                <div className="h-full flex items-center justify-center text-white/30 italic text-sm">
                  尚未發送請求
                </div>
              )}

              {error && (
                <div className="text-[#F87171] text-sm break-all">
                  <div className="font-bold mb-2">發生錯誤：</div>
                  {error}
                </div>
              )}

              {response && (
                <div className="prose prose-invert prose-sm max-w-none text-white/90">
                  <ReactMarkdown>{response}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ElevenLabs API Card */}
      <div className="glass p-6 border border-white/10 mt-6 cursor-default transition-all duration-300">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ElevenLabs Test Form */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Mic size={16} className="text-[#F59E0B]" />
                ElevenLabs (Text-to-Speech)
              </h3>
              <span className="text-xs text-white/40 font-mono">POST /api/elevenlabs/tts</span>
            </div>
            
            <div>
              <label className="text-[10px] text-white/50 font-bold uppercase tracking-widest mb-2 block">
                輸入語音台詞 (Text)
              </label>
              <textarea
                value={elevenText}
                onChange={(e) => setElevenText(e.target.value)}
                className="w-full h-32 bg-black/20 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:border-[#F59E0B]/50 resize-none font-mono"
                placeholder="輸入要產生的文字..."
              />
            </div>
            
            <button
              onClick={handleTestElevenLabs}
              disabled={isElevenLoading || !elevenText.trim()}
              className="w-full flex items-center justify-center gap-2 bg-[#F59E0B] hover:bg-[#D97706] disabled:bg-white/10 disabled:text-white/30 text-white px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
            >
              {isElevenLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> 合成語音中...
                </>
              ) : (
                <>
                  <Play size={16} fill="currentColor" /> 產生錄音檔
                </>
              )}
            </button>
          </div>

          {/* Response Area */}
          <div className="space-y-4 h-full flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h3 className="font-bold text-white">音訊結果 (Audio Output)</h3>
              {elevenAudioUrl && <span className="text-xs text-[#4ADE80] font-mono">200 OK (MPEG)</span>}
              {elevenError && <span className="text-xs text-[#F87171] font-mono">500 ERR</span>}
            </div>

            <div className="flex-1 bg-black/30 border border-white/5 rounded-lg p-4 min-h-[200px] flex flex-col items-center justify-center">
              {isElevenLoading && (
                <div className="text-[#F59E0B] animate-pulse flex flex-col items-center">
                  <Mic size={32} className="mb-2 opacity-50" />
                  <p>與 ElevenLabs 連線合成中...</p>
                </div>
              )}
              
              {!isElevenLoading && !elevenAudioUrl && !elevenError && (
                <div className="text-white/30 italic text-sm text-center">
                  <div className="p-3 bg-white/5 rounded-full inline-flex mb-3">
                    <Mic size={24} className="opacity-50" />
                  </div>
                  <p>尚未發送語音請求</p>
                </div>
              )}

              {elevenError && (
                <div className="text-[#F87171] text-sm break-all w-full leading-relaxed">
                  <div className="font-bold mb-2">語音合成發生錯誤：</div>
                  {elevenError}
                </div>
              )}

              {elevenAudioUrl && (
                <div className="w-full flex flex-col items-center">
                  <div className="w-full max-w-sm glass p-4 rounded-xl border border-white/10 shadow-lg">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-[#F59E0B]/20 rounded-lg text-[#F59E0B]">
                        <Mic size={20} />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">語音合成完畢</div>
                        <div className="text-xs text-white/50">Model: eleven_multilingual_v2</div>
                      </div>
                    </div>
                    
                    <audio 
                      controls 
                      src={elevenAudioUrl} 
                      className="w-full [&::-webkit-media-controls-panel]:bg-white/10 [&::-webkit-media-controls-current-time-display]:text-white [&::-webkit-media-controls-time-remaining-display]:text-white"
                      autoPlay
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Fal AI API Card */}
      <div className="glass p-6 border border-white/10 mt-6 cursor-default transition-all duration-300">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Fal AI Test Form */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h3 className="font-bold text-white flex items-center gap-2">
                <ImageIcon size={16} className="text-[#EC4899]" />
                Fal AI (Flux Text-to-Image)
              </h3>
              <span className="text-xs text-white/40 font-mono">POST /api/fal/generate</span>
            </div>
            
            <div>
              <label className="text-[10px] text-white/50 font-bold uppercase tracking-widest mb-2 block">
                輸入影像提示詞 (Prompt)
              </label>
              <textarea
                value={falPrompt}
                onChange={(e) => setFalPrompt(e.target.value)}
                className="w-full h-32 bg-black/20 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:border-[#EC4899]/50 resize-none font-mono"
                placeholder="描述你想要生成的影像畫面..."
              />
            </div>
            
            <button
              onClick={handleTestFal}
              disabled={isFalLoading || !falPrompt.trim()}
              className="w-full flex items-center justify-center gap-2 bg-[#EC4899] hover:bg-[#DB2777] disabled:bg-white/10 disabled:text-white/30 text-white px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
            >
              {isFalLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> AI 生成影像中...
                </>
              ) : (
                <>
                  <Sparkles size={16} /> 魔法生成
                </>
              )}
            </button>
          </div>

          {/* Response Area */}
          <div className="space-y-4 h-full flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h3 className="font-bold text-white">影像結果 (Image Output)</h3>
              {falImageUrl && <span className="text-xs text-[#4ADE80] font-mono">200 OK (URL)</span>}
              {falError && <span className="text-xs text-[#F87171] font-mono">500 ERR</span>}
            </div>

            <div className="flex-1 bg-black/30 border border-white/5 rounded-lg p-4 min-h-[200px] flex flex-col items-center justify-center relative overflow-hidden">
              {isFalLoading && (
                <div className="text-[#EC4899] animate-pulse flex flex-col items-center z-10">
                  <ImageIcon size={32} className="mb-2 opacity-50" />
                  <p>請求已送出，等待算圖完成...</p>
                </div>
              )}
              
              {!isFalLoading && !falImageUrl && !falError && (
                <div className="text-white/30 italic text-sm text-center">
                  <div className="p-3 bg-white/5 rounded-full inline-flex mb-3">
                    <ImageIcon size={24} className="opacity-50" />
                  </div>
                  <p>尚未發送生圖請求</p>
                </div>
              )}

              {falError && (
                <div className="text-[#F87171] text-sm break-all w-full leading-relaxed bg-black/50 p-4 rounded-lg">
                  <div className="font-bold mb-2">生成影像失敗：</div>
                  {falError}
                </div>
              )}

              {falImageUrl && !isFalLoading && (
                <div className="w-full h-full flex items-center justify-center animate-in fade-in zoom-in duration-500">
                  <img 
                    src={falImageUrl} 
                    alt="AI Generated" 
                    className="max-h-[300px] object-contain rounded-lg shadow-2xl border border-white/20"
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
        {/* Suno AI Card */}
        <div className="glass p-6 border border-white/10 cursor-default transition-all duration-300">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Music size={16} className="text-[#34D399]" />
                Suno AI (Music Gen)
              </h3>
              <span className="text-xs text-white/40 font-mono">POST /api/suno/generate</span>
            </div>
            
            <div>
              <input
                value={sunoPrompt}
                onChange={(e) => setSunoPrompt(e.target.value)}
                className="w-full bg-black/20 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:border-[#34D399]/50"
                placeholder="描述你想要的音樂風格..."
              />
            </div>
            
            <button
              onClick={handleTestSuno}
              disabled={isSunoLoading || !sunoPrompt.trim()}
              className="w-full flex items-center justify-center gap-2 bg-[#10B981] hover:bg-[#059669] disabled:bg-white/10 disabled:text-white/30 text-white px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
            >
              {isSunoLoading ? (
                <><Loader2 size={16} className="animate-spin" /> 音樂創作中...</>
              ) : (
                <><Music size={16} /> 創作音樂</>
              )}
            </button>
            
            <div className="bg-black/30 border border-white/5 rounded-lg p-4 min-h-[140px] flex flex-col items-center justify-center">
               {sunoError && <div className="text-[#F87171] text-xs">{sunoError}</div>}
               {isSunoLoading && <div className="text-[#34D399] animate-pulse text-xs text-center">後端請求中...</div>}
               {sunoAudioUrl && (
                 <div className="w-full flex flex-col items-center">
                    <div className="text-sm font-bold text-white mb-2">{sunoSongTitle} (Mock)</div>
                    <audio controls src={sunoAudioUrl} className="w-full h-8" />
                 </div>
               )}
               {!isSunoLoading && !sunoError && !sunoAudioUrl && (
                 <div className="text-white/30 text-xs italic">準備就緒</div>
               )}
            </div>
          </div>
        </div>

        {/* Pinecone Vector DB Card */}
        <div className="glass p-6 border border-white/10 cursor-default transition-all duration-300">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Database size={16} className="text-[#60A5FA]" />
                Pinecone (Vector Core)
              </h3>
              <span className="text-xs text-white/40 font-mono">GET /api/pinecone/status</span>
            </div>
            
            <button
              onClick={handleTestPinecone}
              disabled={isPineconeLoading}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-bold transition-all mt-4"
            >
              {isPineconeLoading ? (
                <><Loader2 size={16} className="animate-spin" /> 嗅探資料庫中...</>
              ) : (
                <><Database size={16} /> 檢查叢集狀態</>
              )}
            </button>
            
            <div className="bg-black/30 border border-white/5 rounded-lg p-4 min-h-[140px] flex flex-col justify-center">
               {pineconeError && <div className="text-[#F87171] text-xs">{pineconeError}</div>}
               {isPineconeLoading && <div className="text-[#60A5FA] animate-pulse text-xs text-center border-t-0">測試連線中...</div>}
               {pineconeResponse && (
                 <div className="text-xs text-[#4ADE80]">
                    <div className="font-bold mb-1 border-b border-white/10 pb-1">回應 Payload:</div>
                    <pre className="font-mono mt-2 overflow-x-auto">
                      {JSON.stringify(pineconeResponse, null, 2)}
                    </pre>
                 </div>
               )}
               {!isPineconeLoading && !pineconeError && !pineconeResponse && (
                 <div className="text-white/30 text-xs italic text-center">準備就緒</div>
               )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
