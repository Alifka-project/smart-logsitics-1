import React, { useMemo, useRef } from 'react';
import FileUpload, { type FileUploadHandle } from '../Upload/FileUpload';
import useDeliveryStore from '../../store/useDeliveryStore';
import {
  computePipelineCounts,
  countReadyToAssign,
} from '../../utils/pipelineCounts';
import UploadZone from './UploadZone';
import ProgressOverview from './ProgressOverview';
import ActionCards from './ActionCards';
import PipelineStatus from './PipelineStatus';
import RecentUploads from './RecentUploads';

interface ManageTabProps {
  onSwitchToDeliveriesTab: () => void;
  onUploadSuccess: (result: { count: number; warnings?: string[]; fileHash?: string }) => void;
  onUploadError: (result: { errors?: string[] }) => void;
  onDuplicateFile: () => void;
  onToastError: (message: string) => void;
}

export default function ManageTab({
  onSwitchToDeliveriesTab,
  onUploadSuccess,
  onUploadError,
  onDuplicateFile,
  onToastError,
}: ManageTabProps) {
  const fileUploadRef = useRef<FileUploadHandle>(null);
  const deliveries = useDeliveryStore((s) => s.deliveries ?? []);
  const recentUploads = useDeliveryStore((s) => s.recentUploads ?? []);

  const pipeline = useMemo(() => computePipelineCounts(deliveries), [deliveries]);
  const readyAssign = useMemo(() => countReadyToAssign(deliveries), [deliveries]);
  const total = deliveries.length;

  return (
    <div className="space-y-6">
      <FileUpload
        ref={fileUploadRef}
        hideDefaultUI
        skipNavigate
        onSuccess={(p) =>
          onUploadSuccess({
            count: p.count,
            warnings: p.warnings,
            fileHash: p.fileHash,
          })
        }
        onError={(e) => onUploadError({ errors: e.errors })}
      />

      <UploadZone
        fileUploadRef={fileUploadRef}
        onDuplicate={onDuplicateFile}
        onUploadErrorToast={onToastError}
      />

      <ProgressOverview pipeline={pipeline} total={total} />

      <ActionCards
        pipeline={pipeline}
        deliveries={deliveries}
        onSwitchToDeliveriesTab={onSwitchToDeliveriesTab}
      />

      <PipelineStatus
        pipeline={pipeline}
        totalDeliveries={deliveries.length}
        readyAssignCount={readyAssign}
        onViewAllDeliveries={onSwitchToDeliveriesTab}
        onReadyToAssign={() => {
          onSwitchToDeliveriesTab();
          useDeliveryStore.getState().setDeliveryListFilter('confirmed');
        }}
      />

      <RecentUploads uploads={recentUploads} />
    </div>
  );
}
