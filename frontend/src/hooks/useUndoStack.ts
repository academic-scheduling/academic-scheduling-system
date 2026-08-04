import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "../api/client";

// Taslak öğelere (haftalık giriş / sınav) yapılan değişiklikleri geri alan
// KALICI, çok adımlı yığın. Her kayıt, geri almak için uygulanacak TERS işlemi
// tutar. Yığın localStorage'da saklanır → sayfa yenilenince kaybolmaz.
//
// Ters işlem türleri:
//  - patch  : taşıma/düzenlemenin tersi — id'yi eski alan değerlerine döndürür.
//  - delete : EKLEMENİN tersi — eklenen öğeyi siler.
//  - create : SİLMENİN tersi — öğeyi payload'dan yeniden yaratır (YENİ id alır).
//
// create geri alınınca öğe yeni bir id ile döner; yığında kalan ve aynı ESKİ
// id'ye atıfta bulunan işlemler yeni id'ye REMAP edilir (id kayması bozmasın).

export type UndoEntity = "weekly-entries" | "exams";

export type UndoAction =
  | { type: "patch"; id: number; body: Record<string, unknown> }
  | { type: "delete"; id: number }
  | { type: "create"; restoreId: number; body: Record<string, unknown> };

export type UndoOp = { label: string; entity: UndoEntity; action: UndoAction };

// Yığın kalıcı olduğu ve her taşımada büyüdüğü için üst sınır: en eski işlemler
// düşer (100 adımdan öteye geri alınamaz — pratikte fazlasıyla yeterli).
const MAX_OPS = 100;

export type UndoResult = { ok: boolean; label: string; message?: string };

function loadStack(key: string): UndoOp[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as UndoOp[]) : [];
  } catch {
    return [];
  }
}

/** create geri alınınca eski id → yeni id: kalan işlemlerdeki atıfları güncelle. */
function remapId(op: UndoOp, entity: UndoEntity, oldId: number, newId: number): UndoOp {
  if (op.entity !== entity) return op;
  const a = op.action;
  if ((a.type === "patch" || a.type === "delete") && a.id === oldId) {
    return { ...op, action: { ...a, id: newId } };
  }
  if (a.type === "create" && a.restoreId === oldId) {
    return { ...op, action: { ...a, restoreId: newId } };
  }
  return op;
}

function newIdOf(res: unknown): number | undefined {
  const r = res as { entry?: { id?: number }; exam?: { id?: number }; id?: number };
  return r?.entry?.id ?? r?.exam?.id ?? r?.id;
}

export function useUndoStack(storageKey: string) {
  const ref = useRef<UndoOp[]>(loadStack(storageKey));
  const [count, setCount] = useState(ref.current.length);
  const [busy, setBusy] = useState(false);

  const save = useCallback(() => {
    setCount(ref.current.length);
    try {
      localStorage.setItem(storageKey, JSON.stringify(ref.current));
    } catch {
      /* kota dolabilir — yığın yine bellekte çalışır */
    }
  }, [storageKey]);

  /** Bir mutasyonun TERSİNİ yığına ekler (mutasyon BAŞARILI olduktan sonra). */
  const record = useCallback((op: UndoOp) => {
    const next = [...ref.current, op];
    ref.current = next.length > MAX_OPS ? next.slice(next.length - MAX_OPS) : next;
    save();
  }, [save]);

  /** Yığındaki son işlemi geri alır (uygular). Sonuç: çağıran reload + bildirim yapar. */
  const undo = useCallback(async (): Promise<UndoResult | null> => {
    const op = ref.current[ref.current.length - 1];
    if (!op) return null;
    setBusy(true);
    try {
      const { entity, action } = op;
      if (action.type === "patch") {
        await api.patch(`/${entity}/${action.id}`, action.body);
        ref.current = ref.current.slice(0, -1);
      } else if (action.type === "delete") {
        await api.delete(`/${entity}/${action.id}`);
        ref.current = ref.current.slice(0, -1);
      } else {
        const res = await api.post(`/${entity}`, action.body);
        const newId = newIdOf(res);
        const rest = ref.current.slice(0, -1);
        ref.current = newId != null
          ? rest.map((o) => remapId(o, entity, action.restoreId, newId))
          : rest;
      }
      save();
      return { ok: true, label: op.label };
    } catch (e) {
      // Başarısız (öğe artık yok / yayınlanmış / pencere hatası): işlemi yine de
      // düş ki aynı hatayla sonsuz takılmayalım; çağırana hatayı bildir.
      ref.current = ref.current.slice(0, -1);
      save();
      return {
        ok: false,
        label: op.label,
        message: e instanceof ApiError ? e.message : "Geri alınamadı",
      };
    } finally {
      setBusy(false);
    }
  }, [save]);

  return { record, undo, count, busy };
}
