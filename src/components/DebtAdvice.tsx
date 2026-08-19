import React, { useMemo, useState, useEffect } from 'react';
import { Debt, Transaction, BudgetConfig, RecurringTransaction, Goal } from '../types';
import { Lightbulb, Heart, ShieldAlert, Sparkles, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { getLocalMonthKey } from '../lib/datetime';
import { formatMoney } from '../lib/money';

interface Props {
  debts: Debt[];
  monthlyIncome: number;
  transactions: Transaction[];
  budgets: Record<string, BudgetConfig>;
  recurring: RecurringTransaction[];
  goals: Goal[];
}

const QUOTES = [
  "每一個微小的還款或儲蓄，都是通往財富自由的一大步。",
  "別被過去的負債綁架，現在的你能決定未來的模樣。",
  "面對問題是解決問題的第一步，你已經在路上了！",
  "慢慢來沒關係，重要的是方向是對的。",
  "時間是你最好的朋友，堅持下去，隧道盡頭就是光。",
  "不求一步登天，但求每天比昨天進步一點點。",
  "財務健康就像種樹，現在開始澆水，未來就能乘涼。",
  "理財不是為了變得富有，而是為了獲得自由。",
  "每一份辛苦賺來的錢，都值得被好好對待。"
];

export default function DebtAdvice({ debts, monthlyIncome, transactions, budgets, recurring, goals }: Props) {
  const [quoteIndex, setQuoteIndex] = useState(0);

  useEffect(() => {
    setQuoteIndex(Math.floor(Math.random() * QUOTES.length));
  }, []);

  const analysis = useMemo(() => {
    // 1. Debt Analysis
    const totalDebt = debts.reduce((sum, d) => sum + d.amount, 0);
    const totalMonthlyPayment = debts.reduce((sum, d) => sum + (d.monthlyPayment || 0), 0);
    
    let weightedInterestSum = 0;
    debts.forEach(d => {
      weightedInterestSum += d.amount * (d.interestRate || 0);
    });
    const avgInterestRate = totalDebt > 0 ? weightedInterestSum / totalDebt : 0;
    
    const income = monthlyIncome > 0 ? monthlyIncome : 1; 
    const dtiRatio = (totalMonthlyPayment / income) * 100;
    const highInterestDebts = debts.filter(d => (d.interestRate || 0) > 8);

    // 2. Spending & Budget Analysis
    // Must be the LOCAL month: toISOString() is UTC, so on the last day of a
    // month in UTC+8 after 16:00 local it rolls to the next month and the
    // "this month" filters below silently return 0.
    const currentMonthPrefix = getLocalMonthKey();
    const thisMonthExpenses = transactions
      .filter(t => t.type === 'expense' && t.date.startsWith(currentMonthPrefix))
      .reduce((sum, t) => sum + t.amount, 0);

    const thisMonthIncomes = transactions
      .filter(t => t.type === 'income' && t.date.startsWith(currentMonthPrefix))
      .reduce((sum, t) => sum + t.amount, 0);
      
    // Count recurring
    const totalRecurringExpense = recurring
      .filter(r => r.type === 'expense')
      .reduce((sum, r) => {
        if (r.frequency === 'monthly') return sum + r.amount;
        if (r.frequency === 'yearly') return sum + r.amount / 12;
        if (r.frequency === 'weekly') return sum + r.amount * 4.33;
        if (r.frequency === 'daily') return sum + r.amount * 30;
        return sum;
      }, 0);

    const actualMonthlyIncome = Math.max(income, thisMonthIncomes);
    const expectedOutflow = totalMonthlyPayment + thisMonthExpenses + totalRecurringExpense;
    const cashflowMargin = actualMonthlyIncome - expectedOutflow;
    const marginRatio = (cashflowMargin / actualMonthlyIncome) * 100;

    const suggestions: { id: string; type: 'warning' | 'info' | 'success'; title: string; desc: string; category: string }[] = [];

    // --- Income & Career Advice ---
    const minimumSurvivalIncome = expectedOutflow;
    const safeIncomeTarget = expectedOutflow > 0 ? expectedOutflow / 0.7 : 30000; // Aim for 30% savings

    if (actualMonthlyIncome < minimumSurvivalIncome && expectedOutflow > 0) {
      suggestions.push({
        id: 'income-survival',
        type: 'warning',
        category: '收入',
        title: `目標月薪建議：至少需達 ${formatMoney(Math.ceil(minimumSurvivalIncome))}`,
        desc: `您目前的固定開銷與還款總額約為 ${formatMoney(Math.ceil(expectedOutflow))}。要達到收支平衡，您目前的薪水或兼職收入必須至少達到這個基本門檻。趁現在積極尋找高時薪兼職或評估轉職機會！`
      });
    } else if (actualMonthlyIncome < safeIncomeTarget && expectedOutflow > 0) {
      suggestions.push({
        id: 'income-growth',
        type: 'info',
        category: '收入',
        title: `進階月薪目標：朝 ${formatMoney(Math.ceil(safeIncomeTarget))} 邁進`,
        desc: `為了擁有健康的財務體質（將開銷控制在 70% 以內，保留 30% 儲蓄與投資空間），建議您的目標月收入應達到 ${formatMoney(Math.ceil(safeIncomeTarget))}。持續投資自己，提升職場競爭力吧！`
      });
    } else if (actualMonthlyIncome >= safeIncomeTarget && expectedOutflow > 0) {
      suggestions.push({
        id: 'income-excellent',
        type: 'success',
        category: '收入',
        title: '收入水準足以支撐健康理財',
        desc: `您的收入能夠很好地覆蓋目前的生活水準與負債，並有充足的餘裕。請將注意力放在「資產配置」與「提高投資報酬率」上，加速累積淨資產。`
      });
    }

    // --- Debt Advice ---
    if (totalDebt > 0) {
      if (dtiRatio > 40) {
        suggestions.push({
          id: 'high-dti',
          type: 'warning',
          category: '負債',
          title: '每月還款壓力過重',
          desc: `固定還款已經佔月收 ${dtiRatio.toFixed(1)}%。這會嚴重擠壓生活費。強烈建議打給銀行申請「債務整合」，或申請「前置協商」拉長還款期數、降低月付金。生活才是第一優先。`
        });
      } else if (dtiRatio > 0 && monthlyIncome > 0) {
        suggestions.push({
          id: 'good-dti',
          type: 'success',
          category: '負債',
          title: '健康的還款比例',
          desc: `固定還款佔月收 ${dtiRatio.toFixed(1)}%，在安全範圍內（< 40%）。若現金有餘裕，建議把多餘的錢拿去提早還清利率最高的貸款（雪球還款法）。`
        });
      }

      if (debts.length >= 3 && avgInterestRate > 6) {
        suggestions.push({
          id: 'consolidation',
          type: 'warning',
          category: '負債',
          title: '多筆貸款，必須整合',
          desc: '您目前有多筆債務且平均利率偏高（>6%），這會讓您每個月都在幫銀行打工。建議向往來已久或薪轉銀行申請「信貸來代償多筆高利卡債/小額信貸」，集中火力還款。'
        });
      }

      if (highInterestDebts.length > 0) {
        suggestions.push({
          id: 'high-interest',
          type: 'warning',
          category: '負債',
          title: '警報：高利債務侵蝕本金',
          desc: `發現 ${highInterestDebts.length} 筆利率 >8% 的高利債務（如卡循、小額貸）。高利貸會帶來複利地獄，請暫停所有投資，並把每月結餘 100% 拿去還清這些負債！`
        });
      }
    } else {
      suggestions.push({
        id: 'no-debt',
        type: 'success',
        category: '負債',
        title: '無負債，太棒了！',
        desc: '這是一個極好的財務基礎，代表你所有的收入都可以為自己所用。請持續專注在提升儲蓄率與投資自己。'
      });
    }

    // --- Cash flow & Budget Advice ---
    if (marginRatio < 0) {
      suggestions.push({
        id: 'negative-cashflow',
        type: 'warning',
        category: '收支',
        title: '每月入不敷出',
        desc: `您的月支出加還款超過了月收入 (缺口: ${formatMoney(Math.abs(cashflowMargin))})！請立即檢視本月不必要的開銷（飲料、外食、娛樂），並積極尋找兼職、外包工作增加開源。`
      });
    } else if (marginRatio < 10) {
      suggestions.push({
        id: 'tight-margin',
        type: 'warning',
        category: '收支',
        title: '結餘過少，風險承受低',
        desc: `本月預計結餘只有總收的 ${marginRatio.toFixed(1)}%。這讓您很難應對突發事件。可以試著戒掉每天一杯咖啡、取消沒在看的訂閱服務，目標把結餘提升到 20% 以上。`
      });
    } else if (marginRatio >= 20) {
      suggestions.push({
        id: 'healthy-margin',
        type: 'success',
        category: '收支',
        title: '優良的儲蓄體質',
        desc: `本月擁有 ${marginRatio.toFixed(1)}% 的結餘空間，理財習慣非常好！請把這些錢放入自動存錢帳戶，或依「核心目標」進行投資。`
      });
    }

    // --- Target & Goals Advice ---
    const totalGoalsNeeds = goals.reduce((sum, g) => sum + (g.targetAmount - g.currentAmount), 0);
    if (goals.length > 0 && cashflowMargin > 0) {
      const monthsToReachGoals = totalGoalsNeeds / cashflowMargin;
      if (monthsToReachGoals > 60) {
        suggestions.push({
           id: 'goals-too-long',
           type: 'info',
           category: '目標',
           title: '理財目標需要耐心或調整',
           desc: `依照您目前的月結餘，完成所有目標大約需要 ${(monthsToReachGoals/12).toFixed(1)} 年。若覺得太久，可以試著先集中完成一個小目標，或者想辦法在假日展開一項新的收入來源！`
        });
      } else {
        suggestions.push({
           id: 'goals-on-track',
           type: 'success',
           category: '目標',
           title: '夢想就在不遠處',
           desc: `太好了！依目前的財務留存度，大約只要 ${(monthsToReachGoals/12).toFixed(1)} 年就能達成所有設定的理財目標。保持現在的節奏！`
        });
      }
    } else if (goals.length === 0) {
      suggestions.push({
        id: 'no-goals',
        type: 'info',
        category: '目標',
        title: '設定一個小目標吧',
        desc: '還沒有設定理財目標嗎？有了目標（例如：年底存到5萬、出國基金），存錢會變得更有動力喔！到「負債與目標」新增一個看看。'
      });
    }

    return { totalDebt, avgInterestRate, dtiRatio, marginRatio, cashflowMargin, suggestions };
  }, [debts, monthlyIncome, transactions, recurring, goals]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Motivational Quote */}
      <div className="bg-gradient-to-r from-[#CD7A70]/10 via-[#D1A066]/10 to-[#87A2B4]/10 p-6 rounded-[24px] border border-black/5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform duration-700">
          <Heart size={80} />
        </div>
        <div className="relative z-10 flex flex-col items-center text-center space-y-4">
          <Sparkles className="text-[#D1A066] mb-1" size={24} />
          <p className="text-lg sm:text-2xl font-black text-[#5C5248] tracking-widest leading-relaxed font-sans">
            "{QUOTES[quoteIndex]}"
          </p>
          <button 
            onClick={() => setQuoteIndex((quoteIndex + 1) % QUOTES.length)}
            className="text-xs font-bold bg-white/50 hover:bg-white text-[#82786D] px-4 py-2 rounded-full transition-colors mt-2 shadow-sm border border-black/5"
          >
            換一句正能量
          </button>
        </div>
      </div>

      <div className="bg-[#FAF6F0] p-6 lg:p-8 rounded-[32px] border border-black/5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-3 text-[#5C5248]">
            <div className="w-10 h-10 bg-[#87A2B4] text-white flex items-center justify-center rounded-2xl shadow-inner">
              <Lightbulb size={20} />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black">AI 全站財務健檢</h2>
              <p className="text-xs font-bold text-[#82786D] mt-1">根據您的收支、負債與目標，量身打造解困與成長策略</p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2">
            {analysis.cashflowMargin !== 0 && (
              <div className="text-[11px] font-bold px-3 py-1.5 bg-white rounded-xl border border-black/5 shadow-sm">
                預估月結餘: <span className={cn(analysis.cashflowMargin >= 0 ? "text-[#769C7C]" : "text-[#CD7A70]")}>{analysis.cashflowMargin > 0 ? '+' : ''}{formatMoney(analysis.cashflowMargin)}</span>
              </div>
            )}
            {analysis.totalDebt > 0 && (
              <div className="text-[11px] font-bold px-3 py-1.5 bg-white rounded-xl border border-black/5 shadow-sm text-[#82786D]">
                平均貸款利率: <span className="text-[#D1A066]">{analysis.avgInterestRate.toFixed(2)}%</span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {analysis.suggestions.map(s => (
            <div 
              key={s.id} 
              className={cn(
                "p-5 rounded-[20px] border flex gap-4 transition-all hover:-translate-y-0.5",
                s.type === 'warning' ? "bg-white border-[#CD7A70]/30 shadow-[0_4px_20px_rgba(205,122,112,0.1)]" :
                s.type === 'success' ? "bg-white border-[#769C7C]/30 shadow-[0_4px_20px_rgba(118,156,124,0.1)]" :
                "bg-white border-[#87A2B4]/30 shadow-[0_4px_20px_rgba(135,162,180,0.1)]"
              )}
            >
              <div className={cn(
                "w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-opacity-10",
                s.type === 'warning' ? "bg-[#CD7A70] text-[#CD7A70]" :
                s.type === 'success' ? "bg-[#769C7C] text-[#769C7C]" :
                "bg-[#87A2B4] text-[#87A2B4]"
              )}>
                {s.type === 'warning' ? <AlertTriangle size={20} /> :
                 s.type === 'success' ? <CheckCircle2 size={20} /> :
                 <Lightbulb size={20} />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={cn(
                    "text-[10px] font-black px-1.5 py-0.5 rounded",
                    s.type === 'warning' ? "bg-[#CD7A70]/10 text-[#CD7A70]" :
                    s.type === 'success' ? "bg-[#769C7C]/10 text-[#769C7C]" :
                    "bg-[#87A2B4]/10 text-[#87A2B4]"
                  )}>
                    {s.category}
                  </span>
                  <h3 className="font-extrabold text-[#5C5248] text-sm md:text-base">
                    {s.title}
                  </h3>
                </div>
                <p className="text-[13px] text-[#82786D] leading-relaxed font-medium">
                  {s.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
        
        {monthlyIncome === 0 && (
          <div className="mt-6 p-4 bg-white/50 backdrop-blur border border-[#D1A066]/30 rounded-2xl flex flex-col items-center justify-center text-center">
            <span className="text-xl mb-2">💰</span>
            <p className="text-sm text-[#5C5248] font-bold mb-1">想要更精準的分析嗎？</p>
            <p className="text-xs text-[#82786D]">請在上方「預算規劃」設定您的「每月固定薪資收入」，AI 才能計算您的真實負擔與結餘空間。</p>
          </div>
        )}
      </div>
    </div>
  );
}

