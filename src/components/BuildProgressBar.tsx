import { LoaderCircle } from 'lucide-react';
import { useElapsedSeconds } from '@/hooks/use-elapsed-seconds';
import {
	describeBuildActivityLabel,
	describeBuildHeadline,
	describeBuildLineCount,
	type BuildStatus,
} from '@/routes/chat/utils/build-status';

interface BuildProgressBarProps {
	status: BuildStatus | null;
}

/** Step, elapsed time and current activity of a running Think build. */
export function BuildProgressBar({ status }: BuildProgressBarProps) {
	const elapsedSeconds = useElapsedSeconds(status?.startedAt ?? null);
	if (!status) return null;
	const lineCount = describeBuildLineCount(status.activity);

	return (
		<div className="mb-2 rounded-lg border border-kumo-line bg-kumo-elevated px-3 py-2 text-sm">
			<p className="text-xs font-medium tabular-nums text-kumo-subtle">
				{describeBuildHeadline(status.step, elapsedSeconds)}
			</p>
			<div className="mt-1 flex min-w-0 items-center gap-2">
				<LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 motion-safe:animate-spin text-kumo-brand" />
				<p role="status" className="min-w-0 truncate text-kumo-strong">
					{describeBuildActivityLabel(status.activity)}
				</p>
				{lineCount && <span className="shrink-0 tabular-nums text-kumo-subtle">· {lineCount}</span>}
			</div>
		</div>
	);
}
