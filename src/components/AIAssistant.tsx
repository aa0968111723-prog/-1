import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, Loader2, Sparkles, Globe, Image as ImageIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import { financeRepository } from '../lib/financeRepository';
import { buildFinanceContext, buildGroundedMessage } from '../lib/financeContext';

interface Message {
  role: 'user' | 'model';
  content: string;
  isThinking?: boolean;
  sources?: Array<{ uri: string; title: string }>;
}

export default function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{
    role: 'model',
    content: '你好，我可以看到你記在 FinTracker 裡的財務摘要，幫你回答像是「這個月花多少」「哪一類比上個月多」「哪個預算快到了」這類問題。\n\n我看到的是彙總數字，不會看到每一筆的備註內容。'
  }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Custom Background States
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [showBgSettings, setShowBgSettings] = useState(false);
  const [bgPrompt, setBgPrompt] = useState('');
  const [isGeneratingBg, setIsGeneratingBg] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');
    const newMessages: Message[] = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      // Ground the question in numbers the local engine computed exactly.
      // Without this the model has nothing to read and anything number-shaped
      // it produces is invented — see src/lib/financeContext.ts.
      const context = buildFinanceContext({
        transactions: financeRepository.getTransactions(),
        budgets: financeRepository.getBudgets(),
        debts: financeRepository.getDebts(),
        goals: financeRepository.getGoals(),
        recurring: financeRepository.getRecurring(),
      });

      const response = await fetch('/api/gemini/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages,
          message: buildGroundedMessage(userText, context),
          grounded: true,
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'API Error');
      }

      setMessages(prev => [...prev, { 
        role: 'model', 
        content: data.text || '無回應',
        sources: data.sources
      }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', content: '抱歉，處理您的請求時發生錯誤。請確認網路狀況與後端設定。' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateBg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bgPrompt.trim() || isGeneratingBg) return;

    setIsGeneratingBg(true);
    try {
      const response = await fetch('/api/gemini/generate-bg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: bgPrompt })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate background');
      }

      if (data.imageUrl) {
        setBgImage(data.imageUrl);
        setShowBgSettings(false);
        setBgPrompt('');
      }
    } catch (error) {
      console.error("Failed to generate background:", error);
    } finally {
      setIsGeneratingBg(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 p-4 rounded-full shadow-2xl transition-all duration-300 z-40 group",
          "bg-gradient-to-br from-[#60A5FA] to-[#A78BFA] hover:shadow-[0_0_20px_rgba(96,165,250,0.5)]",
          isOpen ? "scale-0 opacity-0" : "scale-100 opacity-100"
        )}
      >
        <MessageSquare className="text-white" size={24} />
      </button>

      {/* Chat Window */}
      <div 
        className={cn(
          "fixed bottom-6 right-6 w-[85vw] sm:w-[400px] h-[600px] max-h-[80vh] z-50 flex flex-col transition-all duration-300 origin-bottom-right shadow-2xl",
          "glass !rounded-2xl border border-white/20 overflow-hidden relative",
          isOpen ? "scale-100 opacity-100" : "scale-50 opacity-0 pointer-events-none"
        )}
      >
        {/* Background Layers */}
        {bgImage ? (
          <>
            <div 
              className="absolute inset-0 z-0 bg-cover bg-center transition-opacity duration-1000"
              style={{ backgroundImage: `url(${bgImage})` }}
            />
            <div className="absolute inset-0 z-0 bg-black/60 backdrop-blur-md pointer-events-none" />
          </>
        ) : (
          <div className="absolute inset-0 z-0 bg-black/40 backdrop-blur-3xl pointer-events-none" />
        )}

        {/* Content Wrapper */}
        <div className="relative z-10 flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#60A5FA] to-[#A78BFA] flex items-center justify-center shadow-lg">
                <Sparkles className="text-white w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">API & 財務智慧助理</h3>
                <p className="text-[10px] text-[#4ADE80] font-medium tracking-wider flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] animate-pulse"></span>
                  ONLINE (Thinking HIGH)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setShowBgSettings(!showBgSettings)}
                className={cn(
                  "transition-colors p-2 rounded-lg hover:bg-white/10",
                  showBgSettings ? "text-[#60A5FA] bg-white/10" : "text-white/50 hover:text-white"
                )}
                title="自訂聊天背景"
              >
                <ImageIcon size={18} />
              </button>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-white/50 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Background Settings Panel */}
          {showBgSettings && (
            <div className="p-3 border-b border-white/10 bg-white/10 backdrop-blur-md animate-in slide-in-from-top-2">
              <form onSubmit={handleGenerateBg} className="flex flex-col gap-2">
                <p className="text-[10px] font-bold text-white/70 uppercase tracking-widest mt-1">智慧生成聊天背景</p>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={bgPrompt}
                    onChange={(e) => setBgPrompt(e.target.value)}
                    placeholder="例如：賽博龐克風格的霓虹城市..."
                    className="w-full bg-black/40 text-white placeholder-white/30 text-xs rounded-lg py-2.5 pl-3 pr-10 outline-none border border-white/10 focus:border-[#60A5FA]/50 transition-all font-medium"
                  />
                  <button
                    type="submit"
                    disabled={!bgPrompt.trim() || isGeneratingBg}
                    className="absolute right-1.5 p-1.5 bg-[#60A5FA] text-black rounded-md disabled:opacity-50 disabled:bg-white/20 disabled:text-white/40 hover:bg-[#A78BFA] transition-colors"
                  >
                    {isGeneratingBg ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  </button>
                </div>
                {bgImage && (
                  <button 
                    type="button" 
                    onClick={() => { setBgImage(null); setShowBgSettings(false); }}
                    className="text-[10px] text-[#F87171] hover:text-red-400 self-end mt-1 font-bold transition-colors uppercase tracking-wider"
                  >
                    還原預設背景
                  </button>
                )}
              </form>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
          {messages.map((msg, idx) => (
            <div key={idx} className={cn("flex flex-col", msg.role === 'user' ? "items-end" : "items-start")}>
              <div className={cn(
                "max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed",
                msg.role === 'user' 
                  ? "bg-[#60A5FA] text-white rounded-tr-sm" 
                  : "bg-white/10 text-white/90 border border-white/10 rounded-tl-sm shadow-[0_4_20px_rgba(0,0,0,0.1)]"
              )}>
                {msg.role === 'model' ? (
                  <div className="markdown-body prose prose-invert max-w-none text-sm">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  msg.content
                )}
                
                {/* Sources / Grounding */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-white/10 text-xs">
                    <div className="flex items-center gap-1.5 text-white/50 mb-2 font-medium">
                      <Globe size={12} />
                      參考來源：
                    </div>
                    <ul className="space-y-1.5">
                      {msg.sources.map((src, i) => (
                        <li key={i}>
                          <a href={src.uri} target="_blank" rel="noopener noreferrer" className="text-[#60A5FA] hover:underline block truncate" title={src.title}>
                            {src.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex items-start">
              <div className="max-w-[80%] rounded-2xl p-4 bg-white/10 text-white/90 border border-white/10 rounded-tl-sm flex items-center gap-3 shadow-[0_4_20px_rgba(0,0,0,0.1)]">
                <Loader2 className="animate-spin text-[#60A5FA] w-4 h-4" />
                <span className="text-xs font-medium text-white/60 animate-pulse">深度思考與搜尋中...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

          {/* Input */}
          <form onSubmit={handleSend} className="p-3 border-t border-white/10 bg-white/5">
            <div className="relative flex items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="詢問 API 更新、開發問題..."
                className="w-full bg-black/20 text-white placeholder-white/30 text-sm rounded-xl py-3.5 pl-4 pr-12 outline-none border border-white/10 focus:border-[#60A5FA]/50 focus:bg-black/40 transition-all font-medium"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="absolute right-2 p-2 bg-[#60A5FA] text-black rounded-lg disabled:opacity-50 disabled:bg-white/20 disabled:text-white/40 hover:bg-[#A78BFA] transition-colors"
              >
                <Send size={16} />
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
