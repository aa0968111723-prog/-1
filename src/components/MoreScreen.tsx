import { ChevronRight } from 'lucide-react';

export type MoreDestination =
  | 'planning'
  | 'liabilities'
  | 'advisor'
  | 'spreadsheet'
  | 'pet'
  | 'download';

interface MoreItem {
  key: MoreDestination;
  emoji: string;
  label: string;
  hint: string;
}

/**
 * 每天不會用到、但確實存在的功能都在這裡。
 *
 * 這一頁的重點是「東西沒有被刪掉」：預算、負債、目標、試算表、AI 全都還在，
 * 只是不再佔用主導覽的位置。所有既有資料一筆都沒有動。
 */
const ITEMS: MoreItem[] = [
  { key: 'planning', emoji: '📊', label: '預算與循環記帳', hint: '每月預算、固定收支自動記帳' },
  { key: 'liabilities', emoji: '🎯', label: '負債與目標', hint: '貸款攤還、存錢目標' },
  { key: 'spreadsheet', emoji: '📝', label: '長期試算表', hint: '資產與負債的長期紀錄' },
  { key: 'advisor', emoji: '✨', label: 'AI 財務顧問', hint: '需要網路，會把摘要送去分析' },
  { key: 'pet', emoji: '🐣', label: '小財設定與資料備份', hint: '桌寵、快速記帳、匯出 JSON' },
  { key: 'download', emoji: '⬇️', label: '下載 Android App', hint: '把小財裝到手機桌面上' },
];

interface MoreScreenProps {
  onNavigate: (destination: MoreDestination) => void;
  build?: { version: string; commit: string; builtAt: string };
}

export default function MoreScreen({ onNavigate, build }: MoreScreenProps) {
  return (
    <div className="space-y-4">
      <div className="glass rounded-[24px] p-2">
        <ul>
          {ITEMS.map(item => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onNavigate(item.key)}
                className="w-full flex items-center gap-3 px-3 min-h-[60px] py-2 rounded-2xl text-left hover:bg-white/70 active:bg-white transition-colors"
              >
                <span className="text-xl shrink-0" aria-hidden>
                  {item.emoji}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-extrabold text-[#5C5248] truncate">
                    {item.label}
                  </span>
                  <span className="block text-xs font-bold text-[#A79C90] truncate">
                    {item.hint}
                  </span>
                </span>
                <ChevronRight size={18} className="text-[#C4BAB0] shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {build && (
        <p className="text-center text-[11px] font-bold text-[#A79C90]">
          小財記帳 v{build.version} · {build.commit}
        </p>
      )}
    </div>
  );
}
