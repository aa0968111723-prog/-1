import { useEffect, useState } from 'react';
import { Cloud, CloudOff, Loader2, LogOut, Mail, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { authController, AuthState } from '../lib/cloud/auth';
import { SyncStatus } from '../lib/cloud/syncEngine';
import { financeSync as syncEngine } from '../lib/cloud/financeSync';
import { getDeviceLabel } from '../lib/cloud/device';
import { cn } from '../lib/utils';

/**
 * The door to the cloud half.
 *
 * Everything below is optional by design. FinTracker is a local-first ledger:
 * the pet, quick add and every analytic work with no account at all. This
 * panel adds cross-device sync and nothing else, and it says so rather than
 * implying the user is missing out by staying local.
 *
 * Two things it is careful about:
 *
 *  - It never presents a sync failure as a data problem. The ledger is on the
 *    device; a failed cycle is a background condition with a retry button, not
 *    an error the user has to resolve before they can carry on.
 *  - It states plainly, before sign-in, that logging in MERGES rather than
 *    replaces. "登入" in most apps means "download my stuff over this", and a
 *    user with 200 unsynced local entries deserves to know which it is.
 */


export default function AccountPanel() {
  const [auth, setAuth] = useState<AuthState>(authController.getState());
  const [sync, setSync] = useState<SyncStatus>(syncEngine.getStatus());
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'idle' | 'code-sent'>('idle');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => authController.subscribe(setAuth), []);
  useEffect(() => syncEngine.subscribe(setSync), []);
  useEffect(() => {
    setPending(syncEngine.countPending());
  }, [sync]);

  // The sync triggers live in App, not here — see lib/cloud/financeSync.ts.
  // A settings panel must not be the thing keeping sync alive.

  const sendCode = async () => {
    setBusy(true);
    setMessage(null);
    const r = await authController.sendEmailCode(email);
    setBusy(false);
    if (r.ok) {
      setStage('code-sent');
      setMessage('驗證碼寄出了，請查看信箱。');
    } else {
      setMessage(r.error ?? '寄送失敗');
    }
  };

  const verify = async () => {
    setBusy(true);
    setMessage(null);
    const r = await authController.verifyEmailCode(email, code);
    setBusy(false);
    if (!r.ok) setMessage(r.error ?? '驗證失敗');
    else {
      setStage('idle');
      setCode('');
    }
  };

  if (!auth.cloudAvailable) {
    return (
      <div className="text-sm font-bold text-[#82786D] leading-relaxed">
        這個版本沒有啟用雲端同步，所有資料留在這台裝置上。
        App 的功能完全不受影響 —— 記帳、桌寵、分析都照常。
      </div>
    );
  }

  if (auth.loading) {
    return (
      <div className="flex items-center gap-2 text-sm font-bold text-[#82786D]">
        <Loader2 size={16} className="animate-spin" /> 確認登入狀態…
      </div>
    );
  }

  if (auth.mode === 'signed-in' && auth.user) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#7D9D81]/15 flex items-center justify-center">
            <Cloud size={18} className="text-[#7D9D81]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-extrabold text-[#5C5248] text-sm truncate">{auth.user.email ?? '已登入'}</p>
            <p className="text-xs font-bold text-[#A79C90]">{getDeviceLabel()}</p>
          </div>
        </div>

        <SyncRow status={sync} pending={pending} onRetry={() => void syncEngine.sync(auth.user!.id)} />

        <button
          type="button"
          onClick={() => void authController.signOut()}
          className="w-full py-3 rounded-2xl font-extrabold bg-white border border-black/5 text-[#82786D] hover:bg-black/[0.02] transition-all active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <LogOut size={16} /> 登出
        </button>
        <p className="text-xs font-bold text-[#A79C90] text-center leading-relaxed">
          登出只是停止同步。<span className="text-[#5C5248]">這台裝置上的帳會留著。</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 shrink-0 rounded-full bg-[#EAE4DB] flex items-center justify-center">
          <CloudOff size={18} className="text-[#A79C90]" />
        </div>
        <div>
          <p className="font-extrabold text-[#5C5248] text-sm">目前只存在這台裝置</p>
          <p className="text-xs font-bold text-[#82786D] mt-0.5 leading-relaxed">
            這樣完全可以用。登入只多一件事：手機和電腦看到同一本帳。
          </p>
        </div>
      </div>

      {stage === 'idle' ? (
        <>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="你的 Email"
            className="w-full px-4 py-3 rounded-2xl bg-white border border-black/5 text-sm font-bold text-[#5C5248] placeholder:text-[#C4B9AC] outline-none focus:border-[#87A2B4]"
          />
          <button
            type="button"
            onClick={sendCode}
            disabled={busy || !email.trim()}
            className="w-full py-3 rounded-2xl font-extrabold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
            寄驗證碼
          </button>
        </>
      ) : (
        <>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="6 位數驗證碼"
            className="w-full px-4 py-3 rounded-2xl bg-white border border-black/5 text-lg font-extrabold tracking-[0.3em] text-center text-[#5C5248] placeholder:tracking-normal placeholder:text-sm placeholder:text-[#C4B9AC] outline-none focus:border-[#87A2B4]"
          />
          <button
            type="button"
            onClick={verify}
            disabled={busy || code.trim().length < 6}
            className="w-full py-3 rounded-2xl font-extrabold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            登入
          </button>
          <button
            type="button"
            onClick={() => { setStage('idle'); setMessage(null); }}
            className="w-full py-2 text-xs font-bold text-[#A79C90] hover:text-[#5C5248]"
          >
            換一個 Email
          </button>
        </>
      )}

      {message && <p className="text-xs font-bold text-[#82786D] text-center">{message}</p>}

      {/*
        Said BEFORE sign-in, not after. In most apps "登入" means "replace what
        is here with what is in my account", and someone with 200 unsynced
        local entries has a right to know which one this is.
      */}
      <p className="text-xs font-bold text-[#A79C90] leading-relaxed">
        登入<span className="text-[#5C5248]">不會蓋掉</span>這台裝置上的帳。
        本機和雲端的資料會依 id 合併，兩邊都不會消失。
      </p>
    </div>
  );
}

function SyncRow({ status, pending, onRetry }: { status: SyncStatus; pending: number; onRetry: () => void }) {
  const lastSync = status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('zh-TW') : null;

  if (status.phase === 'syncing') {
    return (
      <Row icon={<Loader2 size={14} className="animate-spin text-[#87A2B4]" />} title="同步中…" />
    );
  }
  if (status.phase === 'error' || status.phase === 'offline') {
    return (
      <div className="rounded-2xl bg-[#D1A066]/10 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-extrabold text-[#8A6634]">
          <AlertCircle size={14} />
          {status.phase === 'offline' ? '目前沒有網路，稍後會自動再試' : '同步暫時失敗'}
        </div>
        {/* The reassurance matters more than the error. */}
        <p className="text-xs font-bold text-[#8A6634]/80 leading-relaxed">
          你記的帳都還在這台裝置上，沒有遺失。
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-extrabold text-[#8A6634] underline flex items-center gap-1"
        >
          <RefreshCw size={12} /> 重新同步
        </button>
      </div>
    );
  }
  if (pending > 0) {
    return <Row icon={<Cloud size={14} className="text-[#A79C90]" />} title={`等待同步 ${pending} 筆`} subtitle={lastSync ? `上次同步：${lastSync}` : undefined} />;
  }
  return (
    <Row
      icon={<Check size={14} className="text-[#7D9D81]" />}
      title="已同步"
      subtitle={lastSync ? `上次同步：${lastSync}` : undefined}
    />
  );
}

function Row({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className={cn('flex items-center gap-2 rounded-2xl bg-[#EAE4DB]/50 p-3')}>
      {icon}
      <div className="min-w-0">
        <p className="text-xs font-extrabold text-[#5C5248]">{title}</p>
        {subtitle && <p className="text-[11px] font-bold text-[#A79C90] truncate">{subtitle}</p>}
      </div>
    </div>
  );
}
