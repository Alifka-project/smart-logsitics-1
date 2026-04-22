import { useMemo, useState } from 'react';
import { PackageCheck, AlertTriangle, CheckCircle2, Zap } from 'lucide-react';
import type { Delivery } from '../../types';
import api from '../../frontend/apiClient';
import useDeliveryStore from '../../store/useDeliveryStore';
import { useToast } from '../../hooks/useToast';

/**
 * Driver-side Picking List tab.
 *
 * Renders deliveries in `pgi-done` state assigned to the current driver.
 * Each card parses the free-text `items` string into line items (one per line
 * or JSON array), shows a checkbox + mispick-note field per line, and a
 * final "Confirm Picking List" button that flips the order to
 * `pickup-confirmed`.
 *
 * Urgent orders (`metadata.isPriority === true`) are pinned to the top with a
 * red URGENT chip so the driver handles them first.
 */

interface ParsedItem {
  index: number;
  label: string;
}

function parseItems(raw: string | null | undefined): ParsedItem[] {
  if (!raw) return [];
  const trimmed = String(raw).trim();
  if (!trimmed) return [];
  // Try JSON array first (e.g. the upload pipeline sometimes stores
  // `[{description:"..."}, ...]`).
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as unknown[];
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((entry, i) => {
          if (typeof entry === 'string') return { index: i, label: entry };
          if (entry && typeof entry === 'object') {
            const obj = entry as Record<string, unknown>;
            const label =
              (obj.description as string) ||
              (obj.name as string) ||
              (obj.item as string) ||
              (obj.label as string) ||
              JSON.stringify(obj);
            return { index: i, label };
          }
          return { index: i, label: String(entry) };
        });
      }
    } catch {
      // fall through to line-based parsing
    }
  }
  // Fallback: split on newlines, then on semicolons/commas if a single line.
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const parts = lines.length > 1
    ? lines
    : trimmed.split(/\s*[;,]\s*/).map((l) => l.trim()).filter(Boolean);
  return parts.map((label, i) => ({ index: i, label }));
}

interface PickingMeta {
  itemsChecked?: number[];
  mispickReported?: Array<{ itemIndex: number; note: string }>;
  confirmedAt?: string;
  confirmedBy?: string;
}

function readPicking(d: Delivery): PickingMeta {
  const meta = (d.metadata && typeof d.metadata === 'object')
    ? (d.metadata as unknown as Record<string, unknown>)
    : {};
  const picking = (meta.picking && typeof meta.picking === 'object')
    ? (meta.picking as PickingMeta)
    : {};
  return picking;
}

function isPriority(d: Delivery): boolean {
  const meta = (d.metadata && typeof d.metadata === 'object')
    ? (d.metadata as unknown as Record<string, unknown>)
    : {};
  return meta.isPriority === true;
}

interface Props {
  /** All deliveries the driver currently has — we filter to pgi-done inside. */
  deliveries: Delivery[];
  /** Called after a successful confirm so the parent can refetch. */
  onConfirmed?: (deliveryId: string) => void;
}

export default function PickingListPanel({ deliveries, onConfirmed }: Props) {
  const togglePickingItem = useDeliveryStore((s) => s.togglePickingItem);
  const reportMispick = useDeliveryStore((s) => s.reportMispick);
  const confirmPickingList = useDeliveryStore((s) => s.confirmPickingList);
  const { success, error: toastError } = useToast();

  const pickingOrders = useMemo(() => {
    const list = deliveries.filter((d) => {
      const s = String(d.status || '').toLowerCase();
      return s === 'pgi-done' || s === 'pgi_done';
    });
    // Urgent first, then by createdAt ascending.
    list.sort((a, b) => {
      const pa = isPriority(a) ? 1 : 0;
      const pb = isPriority(b) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const ta = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
      return ta - tb;
    });
    return list;
  }, [deliveries]);

  if (pickingOrders.length === 0) {
    return (
      <div className="pp-card p-6 text-center">
        <PackageCheck className="w-10 h-10 text-gray-400 mx-auto mb-2" />
        <div className="text-gray-700 dark:text-gray-200 font-medium">No orders to pick</div>
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Orders appear here once the warehouse posts goods issue (PGI).
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pickingOrders.map((d) => (
        <PickingCard
          key={d.id}
          delivery={d}
          onToggle={togglePickingItem}
          onReportMispick={reportMispick}
          onConfirm={confirmPickingList}
          onSuccess={onConfirmed}
          onToastSuccess={success}
          onToastError={toastError}
        />
      ))}
    </div>
  );
}

interface PickingCardProps {
  delivery: Delivery;
  onToggle: (id: string, idx: number, checked: boolean) => void;
  onReportMispick: (id: string, idx: number, note: string | null) => void;
  onConfirm: (id: string, confirmedBy?: string) => void;
  onSuccess?: (deliveryId: string) => void;
  onToastSuccess: (msg: string) => void;
  onToastError: (msg: string) => void;
}

function PickingCard({
  delivery,
  onToggle,
  onReportMispick,
  onConfirm,
  onSuccess,
  onToastSuccess,
  onToastError,
}: PickingCardProps) {
  const items = useMemo(() => parseItems(delivery.items), [delivery.items]);
  const picking = readPicking(delivery);
  const checked = new Set<number>(picking.itemsChecked || []);
  const mispickByIdx = new Map<number, string>(
    (picking.mispickReported || []).map((m) => [m.itemIndex, m.note]),
  );
  const [openMispickIdx, setOpenMispickIdx] = useState<number | null>(null);
  const [mispickDraft, setMispickDraft] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const totalItems = items.length;
  const coveredCount = new Set<number>([...checked, ...mispickByIdx.keys()]).size;
  const allCovered = totalItems > 0 && coveredCount === totalItems;

  async function handleToggle(item: ParsedItem, nextChecked: boolean): Promise<void> {
    onToggle(delivery.id, item.index, nextChecked);
    try {
      await api.post(`/deliveries/driver/${delivery.id}/picking/item`, {
        itemIndex: item.index,
        checked: nextChecked,
        itemLabel: item.label,
      });
    } catch (err: unknown) {
      // Roll back
      onToggle(delivery.id, item.index, !nextChecked);
      onToastError(`Could not update item — ${(err as Error).message}`);
    }
  }

  function openMispick(idx: number): void {
    setOpenMispickIdx(idx);
    setMispickDraft(mispickByIdx.get(idx) || '');
  }

  function submitMispick(idx: number): void {
    const note = mispickDraft.trim();
    if (!note) {
      onReportMispick(delivery.id, idx, null);
      setOpenMispickIdx(null);
      return;
    }
    onReportMispick(delivery.id, idx, note);
    setOpenMispickIdx(null);
  }

  async function handleConfirm(): Promise<void> {
    if (!allCovered) {
      onToastError('Please check every line or report a mispick first.');
      return;
    }
    setSubmitting(true);
    try {
      const mispicks = Array.from(mispickByIdx.entries()).map(([itemIndex, note]) => ({
        itemIndex,
        note,
      }));
      await api.post(`/deliveries/driver/${delivery.id}/picking/confirm`, {
        mispickReported: mispicks,
        totalItems,
      });
      onConfirm(delivery.id);
      onToastSuccess(`Picking confirmed — ${delivery.customer || 'order'}`);
      if (onSuccess) onSuccess(delivery.id);
    } catch (err: unknown) {
      onToastError(`Confirm failed — ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  const priority = isPriority(delivery);

  return (
    <div
      className={`pp-card overflow-hidden ${
        priority ? 'ring-2 ring-red-400 dark:ring-red-500/70' : ''
      }`}
    >
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-amber-50 to-white dark:from-amber-900/20 dark:to-gray-900">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {priority && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                  <Zap className="w-3 h-3" />
                  URGENT
                </span>
              )}
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                PGI Done
              </span>
            </div>
            <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">
              {delivery.customer || 'Unnamed customer'}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {delivery.poNumber ? `PO ${delivery.poNumber}` : delivery.deliveryNumber || delivery.id}
              {delivery.address ? ` — ${delivery.address}` : ''}
            </div>
          </div>
          <div className="text-right text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
            {coveredCount}/{totalItems} items
          </div>
        </div>
      </div>

      <div className="p-4 space-y-2">
        {items.length === 0 && (
          <div className="text-sm text-gray-500 dark:text-gray-400 italic">
            No line items parsed from this order. Verify with the warehouse paperwork before confirming.
          </div>
        )}
        {items.map((item) => {
          const isChecked = checked.has(item.index);
          const mispickNote = mispickByIdx.get(item.index);
          return (
            <div
              key={item.index}
              className="flex items-start gap-3 p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40"
            >
              <input
                id={`pick-${delivery.id}-${item.index}`}
                type="checkbox"
                checked={isChecked}
                onChange={(e) => void handleToggle(item, e.target.checked)}
                disabled={submitting}
                className="mt-1 w-5 h-5 accent-emerald-600 touch-manipulation"
              />
              <label
                htmlFor={`pick-${delivery.id}-${item.index}`}
                className="flex-1 min-w-0 text-sm text-gray-800 dark:text-gray-100 leading-snug cursor-pointer"
              >
                {item.label}
                {mispickNote && (
                  <div className="mt-1 flex items-start gap-1 text-[12px] text-red-700 dark:text-red-300">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>Mispick: {mispickNote}</span>
                  </div>
                )}
              </label>
              <button
                type="button"
                onClick={() => openMispick(item.index)}
                className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline whitespace-nowrap"
              >
                {mispickNote ? 'Edit mispick' : 'Report mispick'}
              </button>
            </div>
          );
        })}

        {openMispickIdx !== null && (
          <div className="mt-2 p-3 rounded-lg border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20">
            <div className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1">
              Mispick note for item #{openMispickIdx + 1}
            </div>
            <textarea
              value={mispickDraft}
              onChange={(e) => setMispickDraft(e.target.value)}
              placeholder="What's wrong? (wrong qty, damaged, missing, etc.)"
              className="w-full text-sm rounded border border-red-300 dark:border-red-700 bg-white dark:bg-gray-900 p-2"
              rows={2}
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button
                type="button"
                onClick={() => setOpenMispickIdx(null)}
                className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => submitMispick(openMispickIdx)}
                className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-700 text-white font-semibold"
              >
                Save note
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between gap-2">
        <div className="text-xs text-gray-600 dark:text-gray-300">
          {allCovered ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              Ready to confirm
            </span>
          ) : (
            <span>Check every item or mark a mispick to enable confirm.</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={!allCovered || submitting}
          className={`px-4 py-2 text-sm rounded-lg font-semibold transition-colors touch-manipulation ${
            allCovered && !submitting
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
              : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-400'
          }`}
        >
          {submitting ? 'Confirming…' : 'Confirm Picking List'}
        </button>
      </div>
    </div>
  );
}
