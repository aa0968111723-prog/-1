import React, { useState } from 'react';
import { Transaction, Debt, Goal } from '../types';
import { BrainCircuit, Loader2, TrendingUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { apiFetch } from '../lib/api';

interface Props {
  transactions: Transaction[];
  debts: Debt[];
  goals: Goal[];
}

export default function CashflowInference({ transactions, debts, goals }: Props) {
  const [inference, setInference] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleInfer = async () => {
    setIsLoading(true);
    setInference(null);

    // Prepare data payload for Gemini
    const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0;
    const totalDebt = debts.reduce((sum, d) => sum + d.amount, 0);
    const netWorth = (totalIncome - totalExpense) - totalDebt;

    const summary = {
      metrics: {
        totalIncome,
        totalExpense,
        netWorth,
        savingsRate: savingsRate.toFixed(2) + '%',
      },
      recentTransactions: transactions.slice(0, 50).map(t => ({ amount: t.amount, type: t.type, category: t.category, date: t.date })),
      debts: debts.map(d => ({ name: d.name, amount: d.amount, rate: d.interestRate + '%', due: d.dueDate || 'None' })),
      goals: goals.map(g => ({ name: g.name, current: g.currentAmount, target: g.targetAmount, due: g.targetDate || 'None' }))
    };

    const prompt = `你是一位持有 CFP 特許金融分析師執照的頂級 AI 財富管理顧問。
請根據以下使用者的真實財務數據，進行深度「金流推論與長期規劃」。

你必須包含以下具體且高度結構化的分析區塊：
1. 📊 **資金水位與結構診斷**: 評估目前的儲蓄率、淨資產健康度，點出最該注意的收支破口。
2. 🏦 **債務清償與優化路徑 (若有負債)**: 若數據中有負債，請給出精算後的還款順序、估計總利息損失，以及預估清償期限；若無，可省略此段或恭喜用戶。
3. 🎯 **長期目標達成率深度預測**: 針對給定的儲蓄目標（goals），以目前的儲蓄率（Savings Rate）建立數學推斷，具體推測「能提早多少個月」或「將延遲多少個月」達標。給出具體的「每月資金缺口」數據。
4. 💡 **未來 6 個月強致勝行動清單**: 給出 3 個具體、具備「明確金額」或「百分比」要求的高槓桿執行步驟。

用戶目前的財務數據（JSON 格式）：
${JSON.stringify(summary)}

要求：
- 使用生動、專業、切中要害的語氣，要有說服力。
- 使用 Markdown 語法，善用大小標題與 Bullet points。
- 若數據極少，請根據常理給予良好的個人財務破冰建議。`;

    try {
      const res = await apiFetch('/api/gemini/chat', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      if (res.ok) {
        setInference(data.text);
      } else {
        setInference('推論失敗，請稍後再試。');
      }
    } catch (error) {
      setInference('AI 推論發生錯誤，請確認網路連線與設定。');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="glass p-6 relative overflow-hidden bg-gradient-to-br from-[#F5EFEB]/80 to-[#EAE4DB]/80 border shadow-sm">
      <div className="absolute -top-10 -right-10 text-[#A08BA6]/10 transform rotate-12">
        <BrainCircuit size={150} />
      </div>
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <TrendingUp className="text-[#A08BA6]" size={24} />
            <h2 className="text-xl font-bold text-[#5C5248]">AI 金流推論與理財健檢</h2>
          </div>
          <button
            onClick={handleInfer}
            disabled={isLoading || (transactions.length === 0 && debts.length === 0)}
            className="bg-[#A08BA6]/10 hover:bg-[#A08BA6]/20 text-[#5C5248] border border-[#A08BA6]/30 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all disabled:opacity-50 shadow-sm"
          >
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <BrainCircuit size={18} />}
            開始深度推論
          </button>
        </div>

        {inference ? (
          <div className="bg-white/60 rounded-2xl p-6 border border-black/5 text-[#5C5248] prose prose-sm max-w-none shadow-inner prose-slate">
             <div className="markdown-body">
               <ReactMarkdown>{inference}</ReactMarkdown>
             </div>
          </div>
        ) : (
          <div className="text-center text-[#82786D] py-12 px-6 bg-white/30 rounded-2xl border border-black/5 flex flex-col items-center gap-4">
            <BrainCircuit size={48} className="text-[#A08BA6]/40" />
            <p className="font-medium">點擊右上方按鈕，AI 將為您的真實花費進行大數據推論，<br />揭露未來的金流軌跡與目標達成率。</p>
          </div>
        )}
      </div>
    </div>
  );
}
