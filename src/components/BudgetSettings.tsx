import React, { useState } from 'react';
import { CATEGORIES, BudgetConfig } from '../types';
import { Target, Bell, Trash2, Wallet } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatCurrency } from '../lib/formatters';

interface BudgetSettingsProps {
  budgets: Record<string, BudgetConfig>;
  onUpdateBudget: (category: string, config: BudgetConfig) => void;
  onDeleteBudget: (category: string) => void;
}

export default function BudgetSettings({ budgets, onUpdateBudget, onDeleteBudget }: BudgetSettingsProps) {
  const [category, setCategory] = useState(CATEGORIES.expense[0]);
  const [amount, setAmount] = useState('');
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertThreshold, setAlertThreshold] = useState('80');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount))) return;
    onUpdateBudget(category, {
      amount: Number(amount),
      alertEnabled,
      alertThreshold: Number(alertThreshold)
    });
    setAmount('');
  };

  const hasConfiguredBudgets = Object.keys(budgets).length > 0;
  const totalBudget = Object.values(budgets).reduce((sum, config) => sum + config.amount, 0);

  return (
    <div className="space-y-6">
      {hasConfiguredBudgets && (
        <div className="glass p-6 text-center">
          <div className="text-[10px] font-bold text-[#82786D] uppercase tracking-[0.2em] mb-2">本月總編列預算</div>
          <div className="text-4xl font-extrabold text-[#769C7C] tracking-tighter">
            {formatCurrency(totalBudget)}
          </div>
        </div>
      )}

      <div className="glass p-6">
        <h3 className="text-lg font-bold text-[#5C5248] mb-6 flex items-center gap-2">
          <Target className="text-[#87A2B4]" size={20} />
          每月預算設定
        </h3>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-2">支出分類</label>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                const config = budgets[e.target.value];
                if (config) {
                  setAmount(config.amount.toString());
                  setAlertEnabled(config.alertEnabled);
                  setAlertThreshold(config.alertThreshold.toString());
                } else {
                  setAmount('');
                  setAlertEnabled(false);
                  setAlertThreshold('80');
                }
              }}
              className="w-full px-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none appearance-none"
            >
              {CATEGORIES.expense.map(c => (
                <option key={c} value={c} className="bg-white text-[#5C5248]">{c}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-2">預算金額</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                required
                min="0"
                step="any"
                className="w-full px-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-2">提醒閾值 (%)</label>
              <input
                type="number"
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(e.target.value)}
                min="1"
                max="100"
                className="w-full px-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none"
              />
            </div>
          </div>

          <label className="flex items-center justify-between p-4 bg-white/60 rounded-xl border border-black/5 cursor-pointer">
            <div className="flex items-center gap-2 text-[#5C5248] font-bold">
              <Bell size={18} />
              啟用預算提醒
            </div>
            <input
              type="checkbox"
              checked={alertEnabled}
              onChange={(e) => setAlertEnabled(e.target.checked)}
              className="w-5 h-5 accent-[#87A2B4]"
            />
          </label>

          <button
            type="submit"
            className="w-full bg-[#87A2B4] hover:bg-[#87A2B4]/90 text-white font-bold py-3.5 rounded-xl transition-all shadow-sm active:scale-[0.98]"
          >
            儲存預算設定
          </button>
        </form>
      </div>

      {hasConfiguredBudgets && (
        <div className="glass p-6">
          <h3 className="text-lg font-bold text-[#5C5248] mb-6 flex items-center gap-2">
            <Wallet className="text-[#87A2B4]" size={20} />
            已設定之預算明細
          </h3>
          <div className="space-y-3">
            {Object.entries(budgets).map(([cat, config]) => (
              <div key={cat} className="bg-white/40 border border-black/5 p-4 rounded-xl flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
                <div className="flex flex-col">
                  <span className="font-bold text-[#5C5248]">{cat}</span>
                  <span className="text-[10px] text-[#82786D] tracking-wider uppercase flex items-center gap-1 mt-1">
                    {config.alertEnabled ? <Bell size={10} className="text-[#D1A066]" /> : null}
                    {config.alertEnabled ? `當花費達到 ${config.alertThreshold}% 時提醒` : '未啟用提醒'}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono font-extrabold text-[#769C7C]">{formatCurrency(config.amount)}</span>
                  <button
                    onClick={() => onDeleteBudget(cat)}
                    className="p-2 text-[#CD7A70]/60 hover:text-[#CD7A70] hover:bg-[#CD7A70]/10 rounded-xl transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
