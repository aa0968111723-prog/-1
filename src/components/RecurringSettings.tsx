import React, { useState } from 'react';
import { RecurringTransaction, Frequency, CATEGORIES, FREQUENCY_LABELS, TransactionType } from '../types';
import { Repeat, Trash2, Clock } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatCurrency, formatDate } from '../lib/formatters';

interface RecurringSettingsProps {
  recurring: RecurringTransaction[];
  onAdd: (rt: Omit<RecurringTransaction, 'id' | 'nextDate'>) => void;
  onDelete: (id: string) => void;
}

export default function RecurringSettings({ recurring, onAdd, onDelete }: RecurringSettingsProps) {
  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(CATEGORIES.expense[0]);
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');

  const handleTypeChange = (newType: TransactionType) => {
    setType(newType);
    setCategory(CATEGORIES[newType][0]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount))) return;
    
    onAdd({
      type,
      amount: Number(amount),
      category,
      frequency,
      startDate,
      note
    });

    setAmount('');
    setNote('');
  };

  return (
    <div className="glass p-6">
      <h3 className="text-lg font-semibold text-[#5C5248] mb-6 flex items-center gap-2">
        <Repeat className="text-[#87A2B4]" size={20} />
        自動化記帳 (定期)
      </h3>

      {recurring.length > 0 && (
        <div className="mb-8 space-y-3">
          <h4 className="text-[10px] font-bold text-[#82786D]/80 uppercase tracking-widest mb-3">使用中的自動排程</h4>
          {recurring.map(rt => (
            <div key={rt.id} className="flex justify-between items-center bg-white/40 p-4 rounded-2xl border border-black/5 hover:bg-white/60 transition-colors group shadow-sm">
              <div>
                <p className="text-sm font-bold text-[#5C5248] flex items-center gap-2">
                  {rt.category} 
                  <span className="text-[10px] bg-[#87A2B4]/10 text-[#87A2B4] px-2 py-0.5 rounded-md font-bold tracking-wider">
                    {FREQUENCY_LABELS[rt.frequency]}
                  </span>
                </p>
                <div className="flex items-center gap-1.5 mt-1.5 text-[#82786D] font-bold">
                  <Clock size={12} />
                  <span className="text-xs">下次: {formatDate(rt.nextDate)}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={cn("text-sm font-mono font-extrabold tabular-nums", rt.type === 'income' ? 'text-[#769C7C]' : 'text-[#CD7A70]')}>
                  {rt.type === 'income' ? '+' : '-'}{formatCurrency(rt.amount)}
                </span>
                <button 
                  onClick={() => onDelete(rt.id)} 
                  className="opacity-0 group-hover:opacity-100 text-[#CD7A70]/50 hover:text-[#CD7A70] hover:bg-[#CD7A70]/10 transition-all p-2 rounded-xl"
                  title="刪除"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          <div className="h-px bg-black/5 w-full my-6"></div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <h4 className="text-[10px] font-bold text-[#82786D]/80 uppercase tracking-widest mb-2">新增自動排程</h4>
        
        <div className="flex bg-white/60 border border-black/5 p-1 rounded-xl shadow-sm">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={cn(
              "flex-1 py-1.5 text-xs font-bold rounded-lg transition-all",
              type === 'expense' ? "bg-white text-[#5C5248] shadow-sm border border-black/5" : "text-[#82786D] hover:text-[#5C5248] hover:bg-white/50"
            )}
          >
            支出
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('income')}
            className={cn(
              "flex-1 py-1.5 text-xs font-bold rounded-lg transition-all",
              type === 'income' ? "bg-white text-[#5C5248] shadow-sm border border-black/5" : "text-[#82786D] hover:text-[#5C5248] hover:bg-white/50"
            )}
          >
            收入
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1.5">金額</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#82786D] font-bold">NT$</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                required
                min="0"
                step="any"
                className="w-full pl-11 pr-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1.5">頻率</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
              className="w-full px-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none appearance-none text-sm"
            >
              {Object.entries(FREQUENCY_LABELS).map(([val, label]) => (
                <option key={val} value={val} className="bg-white">{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1.5">分類</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none appearance-none text-sm"
            >
              {CATEGORIES[type].map(c => (
                <option key={c} value={c} className="bg-white">{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1.5">開始日期</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="w-full px-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1.5">備註 (可選)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：房租、訂閱費..."
            className="w-full px-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none text-sm"
          />
        </div>

        <button
          type="submit"
          className="w-full bg-[#87A2B4] hover:bg-[#87A2B4]/90 text-white font-bold py-3.5 rounded-xl transition-all shadow-sm active:scale-[0.98] mt-2"
        >
          建立自動排程
        </button>
      </form>
    </div>
  );
}
