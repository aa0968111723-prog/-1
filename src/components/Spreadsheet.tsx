import React, { useState } from 'react';
import { SpreadsheetRecord } from '../types';
import { Plus, Trash2, TrendingUp, Save } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '../lib/utils';

interface Props {
  records: SpreadsheetRecord[];
  onAdd: (record: Omit<SpreadsheetRecord, 'id'>) => void;
  onUpdate: (id: string, record: Partial<SpreadsheetRecord>) => void;
  onDelete: (id: string) => void;
}

export default function Spreadsheet({ records, onAdd, onUpdate, onDelete }: Props) {
  const [newPeriod, setNewPeriod] = useState(
    new Date().getFullYear() + '年' + (new Date().getMonth() + 1) + '月'
  );
  const [newAssets, setNewAssets] = useState('');
  const [newLiabilities, setNewLiabilities] = useState('');
  const [newNote, setNewNote] = useState('');

  const sortedRecords = [...records].sort((a, b) => a.period.localeCompare(b.period));

  const chartData = sortedRecords.map(r => ({
    period: r.period,
    assets: r.assets,
    liabilities: r.liabilities,
    netWorth: r.assets - r.liabilities,
  }));

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPeriod.trim()) return;

    onAdd({
      period: newPeriod.trim(),
      assets: Number(newAssets) || 0,
      liabilities: Number(newLiabilities) || 0,
      note: newNote.trim(),
    });

    // Predict next month for convenience if it matches YYYY年MM月 pattern
    const match = newPeriod.match(/^(\d{4})年(\d{1,2})月/);
    if (match) {
        let y = parseInt(match[1]);
        let m = parseInt(match[2]);
        m += 1;
        if (m > 12) {
            m = 1;
            y += 1;
        }
        setNewPeriod(`${y}年${m}月`);
    } else {
        setNewPeriod('');
    }
    setNewAssets('');
    setNewLiabilities('');
    setNewNote('');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: 'TWD',
      maximumFractionDigits: 0
    }).format(amount);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Chart Section */}
      {chartData.length > 0 && (
        <div className="bg-white/60 p-6 rounded-[32px] border border-black/5 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-[#769C7C] text-white flex items-center justify-center rounded-2xl shadow-inner">
              <TrendingUp size={20} />
            </div>
            <h2 className="text-xl font-black text-[#5C5248]">長期淨值趨勢</h2>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorNetWorth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#769C7C" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#769C7C" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorDebt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#CD7A70" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#CD7A70" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EAE4DB" />
                <XAxis 
                  dataKey="period" 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#82786D', fontSize: 12 }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#82786D', fontSize: 12 }}
                  tickFormatter={(val) => `$${val/10000}W`}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
                  formatter={(value: number) => formatCurrency(value)}
                  labelStyle={{ color: '#5C5248', fontWeight: 'bold', marginBottom: '8px' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="netWorth" 
                  name="淨值"
                  stroke="#769C7C" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorNetWorth)" 
                />
                <Area 
                  type="monotone" 
                  dataKey="liabilities" 
                  name="總負債"
                  stroke="#CD7A70" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorDebt)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="bg-[#FAF6F0] p-6 lg:p-8 rounded-[32px] border border-black/5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-3 text-[#5C5248]">
            <div className="w-10 h-10 bg-[#D1A066] text-white flex items-center justify-center rounded-2xl shadow-inner">
              <Save size={20} />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black">長期財務試算表</h2>
              <p className="text-xs font-bold text-[#82786D] mt-1">手動記錄每月或每年的資產負債狀態，打造自己的財富快照</p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleAdd} className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm mb-6 flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 space-y-2 w-full">
            <label className="text-xs font-bold text-[#82786D]">紀錄週期 (如 2023年1月)</label>
            <input 
              required
              type="text"
              value={newPeriod}
              onChange={(e) => setNewPeriod(e.target.value)}
              className="w-full bg-[#FAF6F0] border-none rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#D1A066]/50"
              placeholder="e.g. 2023年Q1"
            />
          </div>
          <div className="flex-1 space-y-2 w-full">
            <label className="text-xs font-bold text-[#82786D]">總資產</label>
            <input 
              required
              type="number"
              value={newAssets}
              onChange={(e) => setNewAssets(e.target.value)}
              className="w-full bg-[#FAF6F0] border-none rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#769C7C]/50"
              placeholder="0"
            />
          </div>
          <div className="flex-1 space-y-2 w-full">
            <label className="text-xs font-bold text-[#82786D]">總負債</label>
            <input 
              required
              type="number"
              value={newLiabilities}
              onChange={(e) => setNewLiabilities(e.target.value)}
              className="w-full bg-[#FAF6F0] border-none rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#CD7A70]/50"
              placeholder="0"
            />
          </div>
          <div className="flex-1 space-y-2 w-full md:w-auto md:min-w-[150px]">
             <label className="text-xs font-bold text-[#82786D]">備註</label>
             <input 
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="w-full bg-[#FAF6F0] border-none rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#87A2B4]/50"
                placeholder="發年終/繳稅..."
              />
          </div>
          <button 
            type="submit"
            className="w-full md:w-auto h-[44px] px-6 bg-[#5C5248] hover:bg-[#82786D] text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <Plus size={18} /> 新增紀錄
          </button>
        </form>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-black/5 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[700px] border-collapse">
              <thead>
                <tr className="border-b border-black/10 text-[11px] uppercase tracking-widest text-[#82786D] bg-[#FAF6F0]/50">
                  <th className="py-3 px-4 font-bold">紀錄週期</th>
                  <th className="py-3 px-4 font-bold text-right">總資產</th>
                  <th className="py-3 px-4 font-bold text-right">總負債</th>
                  <th className="py-3 px-4 font-bold text-right">淨值 (Net Worth)</th>
                  <th className="py-3 px-4 font-bold">備註</th>
                  <th className="py-3 px-4 font-bold w-12 text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedRecords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#82786D] text-sm">
                      尚無紀錄，請建立第一筆財務快照
                    </td>
                  </tr>
                ) : (
                  sortedRecords.map((r, i) => {
                    const netWorth = r.assets - r.liabilities;
                    return (
                      <tr key={r.id} className="border-b border-black/5 hover:bg-[#FAF6F0]/50 transition-colors">
                        <td className="py-3 px-4 font-bold text-[#5C5248] text-sm">{r.period}</td>
                        <td className="py-3 px-4 text-right text-sm text-[#769C7C] font-mono">
                           <input 
                              type="number" 
                              value={r.assets || ''}
                              onChange={(e) => onUpdate(r.id, { assets: Number(e.target.value) || 0 })}
                              className="w-24 text-right bg-transparent border-none p-0 focus:ring-0 text-inherit"
                           />
                        </td>
                        <td className="py-3 px-4 text-right text-sm text-[#CD7A70] font-mono">
                           <input 
                              type="number" 
                              value={r.liabilities || ''}
                              onChange={(e) => onUpdate(r.id, { liabilities: Number(e.target.value) || 0 })}
                              className="w-24 text-right bg-transparent border-none p-0 focus:ring-0 text-inherit"
                           />
                        </td>
                        <td className="py-3 px-4 text-right font-black text-sm text-[#5C5248] font-mono">
                          {formatCurrency(netWorth)}
                        </td>
                        <td className="py-3 px-4 text-sm text-[#82786D]">
                           <input 
                              type="text" 
                              value={r.note || ''}
                              onChange={(e) => onUpdate(r.id, { note: e.target.value })}
                              className="w-full bg-transparent border-none p-0 focus:ring-0 text-inherit"
                           />
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button 
                            onClick={() => onDelete(r.id)}
                            className="text-[#82786D]/50 hover:text-[#CD7A70] transition-colors p-1"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
