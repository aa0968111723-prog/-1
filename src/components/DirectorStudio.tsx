import React, { useState, useRef } from 'react';
import { Film, Sparkles, Image as ImageIcon, Mic, Music, Loader2, Play, Pause, ChevronRight, LayoutTemplate, Activity } from 'lucide-react';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import { apiFetch } from '../lib/api';

interface SceneAssets {
  script: string;
  imagePrompt: string;
  musicPrompt: string;
  imageUrl: string | null;
  voiceUrl: string | null;
  musicUrl: string | null;
}

export default function DirectorStudio() {
  const [vision, setVision] = useState('在一個下著微雨的賽博龐克城市街頭，遠處有霓虹燈閃爍，充滿孤獨卻又溫暖的氛圍。');
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  
  // Stages: 'idle' | 'analyzing' | 'generating' | 'ready'
  const [stage, setStage] = useState<'idle' | 'analyzing' | 'generating' | 'ready'>('idle');
  const [statusText, setStatusText] = useState('');
  
  const [assets, setAssets] = useState<SceneAssets>({
    script: '',
    imagePrompt: '',
    musicPrompt: '',
    imageUrl: null,
    voiceUrl: null,
    musicUrl: null
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const audioVoiceRef = useRef<HTMLAudioElement>(null);
  const audioMusicRef = useRef<HTMLAudioElement>(null);

  const togglePlayback = () => {
    if (isPlaying) {
      audioVoiceRef.current?.pause();
      audioMusicRef.current?.pause();
    } else {
      if (audioMusicRef.current) audioMusicRef.current.volume = 0.4;
      audioVoiceRef.current?.play().catch(e => console.log(e));
      audioMusicRef.current?.play().catch(e => console.log(e));
    }
    setIsPlaying(!isPlaying);
  };

  const handleGenerateScene = async () => {
    if (!vision.trim()) return;
    setIsOrchestrating(true);
    setStage('analyzing');
    setStatusText('Gemini 正在拆解場景與自動編導...');
    
    // Reset
    setAssets({ script: '', imagePrompt: '', musicPrompt: '', imageUrl: null, voiceUrl: null, musicUrl: null });
    if (audioVoiceRef.current) audioVoiceRef.current.pause();
    if (audioMusicRef.current) audioMusicRef.current.pause();
    setIsPlaying(false);

    try {
      // Step 1: Gemini breaks down the vision into JSON
      const systemPrompt = `你是一個專業的電影導演與場景描述專家。用戶會提供一個畫面願景，請你拆解成以下三個專案，並嚴格使用 JSON 格式回傳，不可有其他多餘文字：
{
  "script": "一段給 ElevenLabs 語音朗讀的旁白口白（約30-50字，優美動人）",
  "imagePrompt": "給 Fal AI (Flux) 算圖用的英文提示詞，要有詳細的光影、構圖畫質描述",
  "musicPrompt": "給 Suno AI 生成背景配樂用的風格描述詞（英文）"
}

用戶願景：${vision}`;

      const geminiRes = await apiFetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: systemPrompt })
      });
      
      if (!geminiRes.ok) throw new Error('Gemini 編導失敗');
      const geminiData = await geminiRes.json();
      
      // Parse JSON from text
      let parsedDirection;
      try {
        const text = geminiData.text.replace(/```json/g, '').replace(/```/g, '');
        parsedDirection = JSON.parse(text);
      } catch (e) {
        throw new Error('Gemini 回傳格式非正確 JSON');
      }

      setStage('generating');
      setStatusText('並行生成多模態素材中：畫面、語音、配樂...');
      
      // We start fetching simultaneously, but await them all
      const newAssets: SceneAssets = {
        script: parsedDirection.script,
        imagePrompt: parsedDirection.imagePrompt,
        musicPrompt: parsedDirection.musicPrompt,
        imageUrl: null,
        voiceUrl: null,
        musicUrl: null
      };
      
      // Setup promises
      const falPromise = apiFetch('/api/fal/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: parsedDirection.imagePrompt, image_size: 'landscape_16_9' })
      }).then(r => r.ok ? r.json() : null).catch(() => null);

      const elevenPromise = apiFetch('/api/elevenlabs/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: parsedDirection.script })
      }).then(r => r.ok ? r.blob() : null).catch(() => null);

      const sunoPromise = apiFetch('/api/suno/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: parsedDirection.musicPrompt })
      }).then(r => r.ok ? r.json() : null).catch(() => null);

      // Wait for all generations to finish
      const [falData, elevenBlob, sunoData] = await Promise.all([falPromise, elevenPromise, sunoPromise]);

      if (falData && falData.images && falData.images.length > 0) {
        newAssets.imageUrl = falData.images[0].url;
      }
      if (elevenBlob) {
        newAssets.voiceUrl = URL.createObjectURL(elevenBlob);
      }
      if (sunoData && sunoData.audio_url) {
        newAssets.musicUrl = sunoData.audio_url;
      }

      setAssets(newAssets);
      setStage('ready');
      setStatusText('場景生成完畢');

    } catch (error: any) {
      console.error(error);
      setStage('idle');
      alert(`場景生成發生錯誤：${error.message}\n(請確認已在環境變數或 AI Studio Secrets 中設定正確的 API Keys)`);
    } finally {
      setIsOrchestrating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 md:h-[calc(100vh-8rem)]">
      
      {/* Header section */}
      <div className="glass p-6 border border-white/10 shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-lg text-white">
            <Film size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">Healing Studio / AI 導演中心</h2>
            <p className="text-white/50 text-sm">輸入您的畫面願景，系統將自動調度 Gemini (編劇), Fal (視覺), ElevenLabs (旁白) 協同生成沈浸式場景。</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <textarea
            value={vision}
            onChange={(e) => setVision(e.target.value)}
            disabled={isOrchestrating}
            className="flex-1 bg-black/40 text-white border border-white/10 rounded-xl p-4 text-sm focus:outline-none focus:border-purple-500/50 resize-none transition-all disabled:opacity-50"
            rows={2}
            placeholder="描述您的場景..."
          />
          <button
            onClick={handleGenerateScene}
            disabled={isOrchestrating || !vision.trim()}
            className="sm:w-48 bg-white text-black hover:bg-white/90 disabled:bg-white/20 disabled:text-white/40 font-bold px-6 py-4 rounded-xl transition-all flex flex-col items-center justify-center gap-1 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
          >
            {isOrchestrating ? (
              <Loader2 className="animate-spin mb-1" size={24} />
            ) : (
              <Sparkles size={24} className="mb-1 text-purple-600" />
            )}
            <span className="text-sm">Action! (生成場景)</span>
          </button>
        </div>
        
        {/* Status indicator */}
        {isOrchestrating && (
          <div className="mt-4 flex items-center justify-center gap-3 text-sm font-medium text-purple-400 animate-pulse">
            <Activity size={16} />
            {statusText}
          </div>
        )}
      </div>

      {/* Cinematic Output Area */}
      <div className="flex-1 glass border border-white/10 rounded-3xl overflow-hidden relative min-h-[400px] flex items-center justify-center group bg-black/50">
        
        {/* Background Image Container */}
        {assets.imageUrl && (
          <div className="absolute inset-0">
            <img 
              src={assets.imageUrl} 
              alt="Generated Background" 
              className="w-full h-full object-cover opacity-60 transition-opacity duration-1000 group-hover:opacity-40"
              referrerPolicy="no-referrer"
            />
            {/* Vignette effect */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent mix-blend-overlay"></div>
            <div className="absolute inset-0 bg-black/20"></div>
          </div>
        )}

        {/* Empty State */}
        {stage === 'idle' && !assets.imageUrl && (
          <div className="flex flex-col items-center text-white/20">
            <LayoutTemplate size={64} className="mb-4 opacity-50 text-purple-400/50" />
            <p className="text-lg font-medium tracking-widest uppercase">The Canvas is Empty</p>
          </div>
        )}

        {/* Generated Content UI */}
        {stage === 'ready' && (
          <div className="relative z-10 w-full h-full flex flex-col items-center justify-center p-8 max-w-4xl mx-auto text-center transform transition-all duration-700">
            
            {/* Minimal Playback Button */}
            {(assets.voiceUrl || assets.musicUrl) && (
              <button 
                onClick={togglePlayback}
                className="mb-8 w-20 h-20 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-2xl transition-all hover:scale-105 active:scale-95"
              >
                {isPlaying ? <Pause size={32} /> : <Play size={32} className="ml-2" />}
              </button>
            )}

            {/* Script Text (Subtitles) */}
            <h1 className="text-3xl md:text-4xl font-bold text-white leading-relaxed text-shadow-xl drop-shadow-2xl">
              "{assets.script}"
            </h1>

            {/* Asset Badges */}
            <div className="mt-auto pt-12 flex flex-wrap justify-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
              {assets.imageUrl && (
                <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-xs text-white/80">
                  <ImageIcon size={14} className="text-pink-400" /> Fal Flux Schnell
                </div>
              )}
              {assets.voiceUrl && (
                <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-xs text-white/80">
                  <Mic size={14} className="text-amber-400" /> ElevenLabs Multilingual
                </div>
              )}
              {assets.musicUrl && (
                 <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-xs text-white/80">
                 <Music size={14} className="text-green-400" /> Suno AI
               </div>
              )}
            </div>
            
          </div>
        )}

        {/* Hidden Audio Elements */}
        {assets.voiceUrl && <audio ref={audioVoiceRef} src={assets.voiceUrl} onEnded={() => setIsPlaying(false)} />}
        {assets.musicUrl && <audio ref={audioMusicRef} src={assets.musicUrl} loop />}
      </div>
      
    </div>
  );
}
