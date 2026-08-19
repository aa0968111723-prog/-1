import { useState, useEffect } from 'react';
import { PetSettings as PetSettingsType, PetSize, PetEdge, PetAutoCollapse, PetAnimationLevel } from '../lib/petSettings';
import { FinancePet, isNativePetAvailable, PetStatus } from '../lib/petBridge';
import { cn } from '../lib/utils';

interface PetSettingsProps {
  settings: PetSettingsType;
  onChange: (settings: PetSettingsType) => void;
}

function OptionRow<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-black/5 last:border-b-0">
      <span className="text-sm font-bold text-[#5C5248] shrink-0">{label}</span>
      <div className="flex bg-[#EAE4DB]/50 p-1 rounded-xl border border-black/5">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={cn(
              'px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap',
              value === opt.value ? 'bg-white text-[#5C5248] shadow-sm' : 'text-[#82786D] hover:text-[#5C5248]',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function PetSettings({ settings, onChange }: PetSettingsProps) {
  const native = isNativePetAvailable();
  const [status, setStatus] = useState<PetStatus | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refreshStatus = async () => {
    try {
      setStatus(await FinancePet.getPetStatus());
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    if (native) refreshStatus();
  }, [native]);

  const update = (patch: Partial<PetSettingsType>) => {
    const next = { ...settings, ...patch };
    onChange(next);
    if (native) FinancePet.setPetSettings({ settings: next }).catch(() => {});
  };

  const startPetFlow = async () => {
    setBusy(true);
    setError('');
    try {
      let { granted } = await FinancePet.canDrawOverlays();
      if (!granted) {
        ({ granted } = await FinancePet.requestOverlayPermission());
      }
      if (!granted) {
        setError('尚未取得懸浮視窗權限。FinTracker 本體仍可正常使用，隨時可以再試一次。');
        return;
      }
      const nextSettings = { ...settings, enabled: true };
      const result = await FinancePet.startPet({ settings: nextSettings });
      if (result.started) {
        onChange(nextSettings);
        setShowOnboarding(false);
      } else {
        setError(`桌寵啟動失敗（${result.reason ?? '未知原因'}），請再試一次。`);
      }
    } finally {
      setBusy(false);
      refreshStatus();
    }
  };

  const stopPetFlow = async () => {
    setBusy(true);
    try {
      await FinancePet.stopPet();
      onChange({ ...settings, enabled: false });
    } finally {
      setBusy(false);
      refreshStatus();
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="glass rounded-[24px] p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#FFE9A8] to-[#F7C873] flex items-center justify-center text-3xl shadow-inner border border-white/60">
            🐣
          </div>
          <div>
            <h2 className="font-extrabold text-[#5C5248] text-xl">{settings.petName || '小財'}桌寵</h2>
            <p className="text-sm text-[#82786D] font-bold">
              {native
                ? settings.enabled
                  ? `正在陪你記帳${status?.running ? '' : '（服務未執行，可重新開啟）'}`
                  : '浮在手機畫面上，點一下就能快速記帳'
                : '桌寵需要 Android App 版本（Capacitor），網頁版可先預覽設定'}
            </p>
          </div>
        </div>

        {settings.enabled ? (
          <button
            type="button"
            onClick={stopPetFlow}
            disabled={busy || !native}
            className="w-full py-3.5 rounded-2xl font-extrabold bg-white border border-black/5 text-[#CD7A70] hover:bg-[#CD7A70]/5 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            關閉桌寵
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowOnboarding(true)}
            disabled={busy || !native}
            className="w-full py-3.5 rounded-2xl font-extrabold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            開啟桌寵
          </button>
        )}
        {error && <p className="text-sm font-bold text-[#CD7A70]">{error}</p>}
      </div>

      <div className="glass rounded-[24px] p-6">
        <h3 className="font-extrabold text-[#5C5248] mb-2">桌寵設定</h3>
        <OptionRow<PetSize>
          label="大小"
          value={settings.size}
          options={[
            { value: 'small', label: '小' },
            { value: 'medium', label: '中' },
            { value: 'large', label: '大' },
          ]}
          onSelect={v => update({ size: v })}
        />
        <OptionRow<PetEdge>
          label="停靠"
          value={settings.edge}
          options={[
            { value: 'left', label: '左' },
            { value: 'right', label: '右' },
            { value: 'auto', label: '自動' },
          ]}
          onSelect={v => update({ edge: v })}
        />
        <OptionRow<PetAutoCollapse>
          label="自動收邊"
          value={settings.autoCollapse}
          options={[
            { value: '5s', label: '5 秒' },
            { value: '15s', label: '15 秒' },
            { value: 'off', label: '永不' },
          ]}
          onSelect={v => update({ autoCollapse: v })}
        />
        <OptionRow<PetAnimationLevel>
          label="動畫"
          value={settings.animation}
          options={[
            { value: 'full', label: '完整' },
            { value: 'simple', label: '簡化' },
          ]}
          onSelect={v => update({ animation: v })}
        />
        <OptionRow
          label="快速記帳"
          value={settings.fastMode ? 'fast' : 'confirm'}
          options={[
            { value: 'confirm', label: '確認後新增' },
            { value: 'fast', label: '點分類直接新增' },
          ]}
          onSelect={v => update({ fastMode: v === 'fast' })}
        />
        <OptionRow
          label="隱私"
          value={settings.showAmounts ? 'show' : 'hide'}
          options={[
            { value: 'hide', label: '隱藏金額' },
            { value: 'show', label: '顯示今日支出' },
          ]}
          onSelect={v => update({ showAmounts: v === 'show' })}
        />
        <div className="flex items-center justify-between gap-3 py-3">
          <span className="text-sm font-bold text-[#5C5248] shrink-0">桌寵名稱</span>
          <input
            type="text"
            value={settings.petName}
            maxLength={8}
            onChange={e => update({ petName: e.target.value })}
            className="w-32 px-3 py-1.5 text-sm text-right bg-white/70 border border-black/5 text-[#5C5248] font-bold rounded-xl outline-none focus:ring-2 focus:ring-[#87A2B4]/40"
          />
        </div>
      </div>

      {/* Overlay permission onboarding：先說明，再導向系統設定 */}
      {showOnboarding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-[#FAF6F0] w-full max-w-sm rounded-[28px] shadow-2xl p-8 text-center space-y-5 animate-in zoom-in-95 duration-200">
            <div className="text-6xl">🐣</div>
            <h3 className="font-extrabold text-[#5C5248] text-xl">讓{settings.petName || '小財'}陪著你</h3>
            <p className="text-sm text-[#82786D] font-bold leading-relaxed">
              開啟桌寵後，{settings.petName || '小財'}可以浮在手機畫面上，
              點一下就能快速記帳。
              <br />
              <br />
              接下來會前往 Android 設定，允許「顯示在其他應用程式上層」。
            </p>
            <button
              type="button"
              onClick={startPetFlow}
              disabled={busy}
              className="w-full py-3.5 rounded-2xl font-extrabold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? '啟動中…' : '開啟桌寵'}
            </button>
            <button
              type="button"
              onClick={() => setShowOnboarding(false)}
              className="w-full py-2 text-sm font-bold text-[#82786D] hover:text-[#5C5248] transition-colors"
            >
              先不要
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
