import type { PipelineCounts } from './pipelineCounts';

export interface ProgressWidths {
  uploaded: number;
  smsSent: number;
  confirmed: number;
  assigned: number;
  delivered: number;
}

/** Stacked bar segment widths as % of total orders (mutually exclusive pipeline stages). */
export function getProgressWidths(
  pipeline: PipelineCounts,
  total: number,
): ProgressWidths {
  if (total <= 0) {
    return { uploaded: 0, smsSent: 0, confirmed: 0, assigned: 0, delivered: 0 };
  }
  return {
    uploaded: (pipeline.uploaded / total) * 100,
    smsSent: (pipeline.sms_sent / total) * 100,
    confirmed: (pipeline.confirmed / total) * 100,
    assigned: (pipeline.assigned / total) * 100,
    delivered: (pipeline.delivered / total) * 100,
  };
}
