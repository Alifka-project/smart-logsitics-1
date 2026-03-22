import React, { useMemo } from 'react';
import useDeliveryStore from '../../store/useDeliveryStore';
import type { Delivery } from '../../types';
import type { PipelineCounts } from '../../utils/pipelineCounts';
import { countFailed, countReadyToAssign, countReturned } from '../../utils/pipelineCounts';

interface ActionCardsProps {
  pipeline: PipelineCounts;
  deliveries: Delivery[];
  onSwitchToDeliveriesTab: () => void;
}

export default function ActionCards({
  pipeline,
  deliveries,
  onSwitchToDeliveriesTab,
}: ActionCardsProps) {
  const setDeliveryListFilter = useDeliveryStore((s) => s.setDeliveryListFilter);

  const readyAssign = useMemo(() => countReadyToAssign(deliveries), [deliveries]);
  const failedN = useMemo(() => countFailed(deliveries), [deliveries]);
  const returnedN = useMemo(() => countReturned(deliveries), [deliveries]);
  const issues = failedN + returnedN;

  return (
    <div
      className={`grid gap-4 ${issues > 0 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'}`}
    >
      <div
        className="rounded-xl p-4 border-2 border-[#F59E0B] bg-[#FEF3C7]"
        style={{ minHeight: 140 }}
      >
        <div className="text-3xl font-bold tabular-nums text-[#92400E]">{readyAssign}</div>
        <div className="text-sm font-semibold text-[#B45309] mt-1">Ready to assign</div>
        <p className="text-xs text-[#92400E]/90 mt-0.5">Customers confirmed ✓</p>
        <button
          type="button"
          disabled={readyAssign === 0}
          onClick={() => {
            setDeliveryListFilter('confirmed');
            onSwitchToDeliveriesTab();
          }}
          className="mt-3 w-full min-h-[40px] rounded-lg bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-3 py-2"
        >
          Assign drivers →
        </button>
      </div>

      <div
        className="rounded-xl p-4 border border-[#8B5CF6] bg-[#EDE9FE]"
        style={{ minHeight: 140 }}
      >
        <div className="text-3xl font-bold tabular-nums text-[#5B21B6]">{pipeline.assigned}</div>
        <div className="text-sm font-semibold text-[#6D28D9] mt-1">Out for delivery</div>
        <p className="text-xs text-[#5B21B6]/90 mt-0.5">Drivers on route</p>
        <button
          type="button"
          onClick={() => {
            setDeliveryListFilter('all');
            onSwitchToDeliveriesTab();
          }}
          className="mt-3 w-full min-h-[40px] rounded-lg border-2 border-[#8B5CF6] bg-white hover:bg-[#EDE9FE] text-[#5B21B6] text-sm font-semibold px-3 py-2"
        >
          Track drivers →
        </button>
      </div>

      {issues > 0 && (
        <div
          className="rounded-xl p-4 border-[1.5px] border-[#EF4444] bg-[#FEE2E2]"
          style={{ minHeight: 140 }}
        >
          <div className="text-3xl font-bold tabular-nums text-[#991B1B]">{issues}</div>
          <div className="text-sm font-semibold text-[#B91C1C] mt-1">Need attention</div>
          <p className="text-xs text-[#991B1B]/90 mt-0.5">
            {failedN} failed · {returnedN} returned
          </p>
          <button
            type="button"
            onClick={() => {
              setDeliveryListFilter('all');
              onSwitchToDeliveriesTab();
            }}
            className="mt-3 w-full min-h-[40px] rounded-lg border border-[#EF4444] bg-white hover:bg-red-50 text-[#991B1B] text-sm font-semibold px-3 py-2"
          >
            View issues →
          </button>
        </div>
      )}
    </div>
  );
}
