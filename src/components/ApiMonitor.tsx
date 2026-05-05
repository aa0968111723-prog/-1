import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Webhook, CheckCircle2, XCircle, Clock, Server, ArrowRightLeft, ShieldAlert, Trash2, Link, TrendingUp, ChevronDown, ChevronUp, Cpu, Database, Eye, Cloud, BarChart, Search, Rss, ShieldCheck, Music, Mic, Zap, Copy, Check } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatCurrency } from '../lib/formatters';
import { cn } from '../lib/utils';

interface ApiEvent {
  id: string;
  provider: string;
  endpoint: string;
  status: number;
  amount?: number;
  costUSD?: number;
  costDetails?: string;
  timestamp: Date;
  errorMessage?: string;
  requestPayload?: any;
  responsePayload?: any;
  method?: string;
  durationMs?: number;
}

const INTEGRATION_GROUPS = [
  {
    title: 'AI 引擎與模型',
    items: [
      { name: 'Google Gemini', text: 'LLM Core', icon: Cpu },
      { name: 'ElevenLabs', text: 'Voice Synthesis', icon: Mic },
      { name: 'Suno API', text: 'Music Generation', icon: Music },
      { name: 'Fal AI', text: 'Fast Config Inference', icon: Zap },
      { name: 'Replicate', text: 'Open Models', icon: Server },
      { name: 'OpenPose', text: 'Computer Vision', icon: Eye }
    ]
  },
  {
    title: '資料與向量庫',
    items: [
      { name: 'MySQL', text: 'Relational DB', icon: Database },
      { name: 'Pinecone', text: 'Vector Store (ai-director)', icon: Database }
    ]
  },
  {
    title: '外部數據源',
    items: [
      { name: 'Brave Search', text: 'Web Search API', icon: Search },
      { name: 'News API', text: 'Global News Feed', icon: Rss },
      { name: 'NewsData', text: 'News Archive API', icon: Rss }
    ]
  },
  {
    title: '基礎架構與分析',
    items: [
      { name: 'Google Cloud Platform', text: 'Core Infra (us-central1)', icon: Cloud },
      { name: 'LangSmith', text: 'LLM Tracing (ai-director)', icon: Activity },
      { name: 'PostHog', text: 'Product Analytics', icon: BarChart },
      { name: 'Google OAuth', text: 'Authentication', icon: ShieldCheck }
    ]
  }
];

export default function ApiMonitor() {
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [isListening, setIsListening] = useState(true); // Always listen for local events
  const [totalCost, setTotalCost] = useState(0);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Listen to local API calls via window events
  useEffect(() => {
    const handleLocalApiLog = (e: any) => {
      if (!isListening) return;
      const detail = e.detail;
      setEvents(prev => {
        const newEvents = [detail, ...prev].slice(0, 100);
        return newEvents;
      });
      if (detail.costUSD) {
        setTotalCost(prev => prev + detail.costUSD);
      }
    };

    window.addEventListener('api-log-event', handleLocalApiLog);
    return () => window.removeEventListener('api-log-event', handleLocalApiLog);
  }, [isListening]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const error4xxCount = useMemo(() => events.filter(e => e.status === 400).length, [events]);
  const error5xxCount = useMemo(() => events.filter(e => e.status >= 500).length, [events]);

  const chartData = useMemo(() => {
    const grouped = [...events].reverse().reduce((acc: any, event) => {
      const timeStr = event.timestamp.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
      if (!acc[timeStr]) {
        acc[timeStr] = { time: timeStr, error400: 0, error500: 0 };
      }
      if (event.status >= 400 && event.status < 500) {
        acc[timeStr].error400 += 1;
      } else if (event.status >= 500) {
        acc[timeStr].error500 += 1;
      }
      return acc;
    }, {});
    return Object.values(grouped);
  }, [events]);

  return (
    <div className="space-y-6">
      {/* Target URL Setting - Replaced with Real-time Status */}
      <div className="glass p-6 gap-4 border border-white/10 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-10 flex">
           <Activity size={100} className="text-[#60A5FA] animate-pulse" />
        </div>
        <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
           <div>
              <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                 <ShieldAlert className="text-[#60A5FA]" /> 真實本地串接事件 (Real-time Internal Events)
              </h2>
              <p className="text-white/50 text-sm mt-1">此儀表板完全反射本機端或雲端元件與第三方服務的 100% 真實資料來往，包含花費預估與真實 Latency。</p>
           </div>
           <div className="flex gap-4">
              <div className="bg-black/30 border border-[#4ADE80]/30 rounded-xl px-4 py-2 text-center">
                 <div className="text-[10px] text-[#4ADE80] font-bold tracking-widest uppercase">總請求數</div>
                 <div className="text-xl font-bold text-white font-mono">{events.length}</div>
              </div>
              <div className="bg-black/30 border border-[#F59E0B]/30 rounded-xl px-4 py-2 text-center min-w-[100px]">
                 <div className="text-[10px] text-[#F59E0B] font-bold tracking-widest uppercase">預估總花費</div>
                 <div className="text-xl font-bold text-white font-mono">NT${(totalCost * 32).toFixed(4)}</div>
              </div>
           </div>
        </div>
      </div>

      {/* System Architectures & Integrations */}
      <div className="glass p-6 border border-white/10">
        <div className="flex items-center gap-2 text-white/50 mb-6 font-bold uppercase tracking-widest text-xs">
          <Server size={14} /> 系統環境整合狀態 (Active Integrations)
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {INTEGRATION_GROUPS.map((group, gIdx) => (
            <div key={gIdx} className="space-y-4">
              <div className="text-white/40 text-[10px] font-bold uppercase tracking-widest border-b border-white/5 pb-2">
                {group.title}
              </div>
              <div className="space-y-2">
                {group.items.map((item, iIdx) => {
                  const Icon = item.icon;
                  return (
                    <div key={iIdx} className="flex items-center gap-3 bg-white/5 border border-white/5 p-2 rounded-lg hover:bg-white/10 transition-colors">
                      <div className="p-1.5 bg-black/20 rounded-md text-[#60A5FA]">
                        <Icon size={14} />
                      </div>
                      <div className="flex-1">
                        <div className="text-white/90 text-xs font-bold">{item.name}</div>
                        <div className="text-white/40 text-[10px]">{item.text}</div>
                      </div>
                      <div className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] shadow-[0_0_8px_#4ADE80]" />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Error Summary */}
      <div className="grid grid-cols-2 gap-6">
         <div className="glass p-4 border border-[#F59E0B]/30 bg-[#F59E0B]/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#F59E0B]/20 rounded-lg">
                 <ShieldAlert className="text-[#F59E0B]" size={20} />
              </div>
              <div>
                 <div className="text-white/60 text-xs font-bold uppercase">400 錯誤數量 (Client)</div>
                 <div className="text-xl font-bold text-[#F59E0B]">{error4xxCount}</div>
              </div>
            </div>
         </div>
         <div className="glass p-4 border border-[#EF4444]/30 bg-[#EF4444]/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#EF4444]/20 rounded-lg">
                 <ShieldAlert className="text-[#EF4444]" size={20} />
              </div>
              <div>
                 <div className="text-white/60 text-xs font-bold uppercase">500 錯誤數量 (Server)</div>
                 <div className="text-xl font-bold text-[#EF4444]">{error5xxCount}</div>
              </div>
            </div>
         </div>
      </div>

      {/* Error Trends Chart */}
      <div className="glass p-6 border border-white/10">
        <div className="flex items-center gap-2 text-white/50 mb-6 font-bold uppercase tracking-widest text-xs">
          <TrendingUp size={14} /> 錯誤趨勢分析 (每分鐘)
        </div>
        <div className="h-[250px] w-full">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" vertical={false} />
                <XAxis dataKey="time" stroke="#ffffff50" fontSize={12} tickMargin={8} />
                <YAxis stroke="#ffffff50" fontSize={12} tickMargin={8} allowDecimals={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Line type="monotone" name="4xx 錯誤" dataKey="error400" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3, fill: '#F59E0B', strokeWidth: 0 }} activeDot={{ r: 5 }} />
                <Line type="monotone" name="5xx 錯誤" dataKey="error500" stroke="#EF4444" strokeWidth={2} dot={{ r: 3, fill: '#EF4444', strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full w-full flex items-center justify-center text-white/30 text-sm">
              累積足夠的事件資料後將顯示動態趨勢圖表
            </div>
          )}
        </div>
      </div>

      {/* Main Terminal/Monitor Area */}
      <div className="glass overflow-hidden flex flex-col h-[600px]">
        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-black/20">
          <div className="flex items-center gap-3">
            <Server className="text-[#A78BFA]" size={20} />
            <h3 className="font-semibold text-white tracking-wide">即時 Webhook 日誌</h3>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setEvents([])}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-all border bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
            >
              <Trash2 size={16} />
              <span className="hidden sm:inline">清除日誌</span>
            </button>
            <button
              onClick={() => setIsListening(!isListening)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-bold transition-all border",
                isListening 
                  ? "bg-white/10 border-white/10 text-white hover:bg-white/20"
                  : "bg-[#60A5FA]/20 border-[#60A5FA]/50 text-[#60A5FA] hover:bg-[#60A5FA]/30"
              )}
            >
              {isListening ? '暫停接收' : '開始接收'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-sm scrollbar-hide bg-black/40">
          {events.length === 0 ? (
            <div className="h-full flex items-center justify-center text-white/30 italic">
              等待事件接入中...
            </div>
          ) : (
            events.map((evt) => {
              const isSuccess = evt.status >= 200 && evt.status < 300;
              const isClientError = evt.status >= 400 && evt.status < 500;
              const isServerError = evt.status >= 500;
              let statusColor = "text-[#4ADE80]";
              let borderColor = "border-[#4ADE80]/30";
              let bgColor = "bg-[#4ADE80]/5";
              if (isClientError) { statusColor = "text-[#F59E0B]"; borderColor = "border-[#F59E0B]/30"; bgColor = "bg-[#F59E0B]/5"; }
              if (isServerError) { statusColor = "text-[#EF4444]"; borderColor = "border-[#EF4444]/30"; bgColor = "bg-[#EF4444]/5"; }

              return (
              <div key={evt.id} className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-4 duration-500">
                <div 
                  onClick={() => setExpandedEventId(expandedEventId === evt.id ? null : evt.id)}
                  className={cn(
                    "p-3 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer transition-all hover:brightness-110",
                    expandedEventId === evt.id ? "brightness-110" : "",
                    bgColor,
                    expandedEventId === evt.id ? borderColor : "border-white/5"
                  )}
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className="text-white/40 text-xs shrink-0 flex items-center gap-1.5">
                      <Clock size={12} />
                      {evt.timestamp.toLocaleTimeString('zh-TW', { hour12: false })}
                    </div>
                    
                    <div className="flex items-center gap-2 w-32 shrink-0">
                      {isSuccess ? <CheckCircle2 size={16} className={statusColor} /> : <XCircle size={16} className={statusColor} />}
                      <span className="font-bold text-white truncate">{evt.provider}</span>
                    </div>

                    <div className={cn("shrink-0 hidden sm:flex items-center gap-2", statusColor)}>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold uppercase", isSuccess ? "bg-[#4ADE80]/20" : isClientError ? "bg-[#F59E0B]/20" : "bg-[#EF4444]/20")}>
                        {evt.method}
                      </span>
                      <span className="font-bold">{evt.status}</span>
                    </div>
                    
                    <div className="text-[#60A5FA]/90 truncate max-w-[200px] md:max-w-none flex-1">
                      {evt.endpoint}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    {evt.costUSD ? (
                      <div className="text-right flex flex-col">
                         <div className="text-[#F59E0B] font-bold text-base font-mono">
                           NT${(evt.costUSD * 32).toFixed(4)}
                         </div>
                         <div className="text-[10px] text-white/40 uppercase tracking-widest leading-none">
                           {evt.costDetails}
                         </div>
                      </div>
                    ) : evt.amount ? (
                      <div className="text-right text-[#4ADE80] font-bold text-base">
                        +{formatCurrency(evt.amount)}
                      </div>
                    ) : null}
                    {evt.durationMs && (
                      <div className="text-white/40 text-xs text-right w-16 hidden lg:block">
                        {evt.durationMs}ms
                      </div>
                    )}
                    <div className="text-white/30 hidden md:block">
                      {expandedEventId === evt.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>
                </div>

                {expandedEventId === evt.id && (
                  <div className="p-4 rounded-xl border border-white/10 bg-black/50 text-xs font-mono overflow-auto animate-in slide-in-from-top-1">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <div className="text-white/40 mb-2 uppercase tracking-widest font-bold border-b border-white/5 pb-1">基本傳輸資訊 (Meta)</div>
                          <div className="text-white/70 space-y-1.5">
                            <p className="flex justify-between"><span className="text-white/40">Event ID:</span> <span className="text-white/90">{evt.id}</span></p>
                            <p className="flex justify-between"><span className="text-white/40">Provider:</span> <span className="text-white/90">{evt.provider}</span></p>
                            <p className="flex justify-between"><span className="text-white/40">Endpoint:</span> <span className="text-[#60A5FA]">{evt.endpoint}</span></p>
                            <p className="flex justify-between"><span className="text-white/40">Timestamp:</span> <span className="text-white/90">{evt.timestamp.toISOString()}</span></p>
                            {evt.durationMs && <p className="flex justify-between"><span className="text-white/40">Latency:</span> <span className="text-[#F59E0B] font-mono">{evt.durationMs} ms</span></p>}
                            {evt.costUSD !== undefined && (
                              <>
                                <p className="flex justify-between"><span className="text-white/40">Est. Cost:</span> <span className="text-[#F59E0B] font-mono">NT${(evt.costUSD * 32).toFixed(4)}</span></p>
                                <p className="flex justify-between"><span className="text-white/40">Cost Unit:</span> <span className="text-white/90">{evt.costDetails}</span></p>
                              </>
                            )}
                          </div>
                        </div>

                        {!isSuccess && (
                          <div>
                            <div className={cn("mb-2 uppercase tracking-widest font-bold border-b pb-1", statusColor, borderColor)}>錯誤原因 (Error Message)</div>
                            <div className={cn("p-2 rounded break-all whitespace-pre-wrap", statusColor, bgColor)}>
                              {evt.errorMessage || '遠端伺服器未提供進一步的錯誤詳情，請檢查傳遞參數或伺服器端日誌。'}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        <div>
                          <div className="flex items-center justify-between mb-2 border-b border-white/5 pb-1">
                            <div className="text-white/40 uppercase tracking-widest font-bold">請求夾帶資料 (Request Payload)</div>
                            {evt.requestPayload && (
                              <button onClick={() => handleCopy(JSON.stringify(evt.requestPayload, null, 2), `req-${evt.id}`)} className="text-white/30 hover:text-white transition-colors">
                                {copiedId === `req-${evt.id}` ? <Check size={14} className="text-[#4ADE80]" /> : <Copy size={14} />}
                              </button>
                            )}
                          </div>
                          {evt.requestPayload ? (
                            <pre className="bg-black/60 p-3 rounded-lg border border-white/10 overflow-x-auto text-[11px] text-[#A78BFA] max-h-[200px]">
                              {JSON.stringify(evt.requestPayload, null, 2)}
                            </pre>
                          ) : (
                            <div className="text-white/30 italic p-2 bg-black/30 rounded-lg">無請求 Payload 紀錄</div>
                          )}
                        </div>

                        {evt.responsePayload && (
                          <div>
                            <div className="flex items-center justify-between mb-2 border-b border-white/5 pb-1">
                              <div className="text-white/40 uppercase tracking-widest font-bold">伺服器回應 (Response Payload)</div>
                              <button onClick={() => handleCopy(JSON.stringify(evt.responsePayload, null, 2), `res-${evt.id}`)} className="text-white/30 hover:text-white transition-colors">
                                {copiedId === `res-${evt.id}` ? <Check size={14} className="text-[#4ADE80]" /> : <Copy size={14} />}
                              </button>
                            </div>
                            <pre className={cn("bg-black/60 p-3 rounded-lg border border-white/10 overflow-x-auto text-[11px] max-h-[200px]", isSuccess ? "text-[#4ADE80]" : "text-[#F87171]")}>
                              {JSON.stringify(evt.responsePayload, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
          )}
        </div>
      </div>
    </div>
  );
}
