import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, Loader, Meter } from '@cloudflare/kumo';
import { BILLING_PATH, TASK_FAILED_MESSAGE, type TaskView } from '@/api-types';
import { useCancelTask, useResumeTask, useStoreTasks } from '@/hooks/use-store-translations';
import { useI18n } from '@/lib/i18n';
import { formatNumber } from '../../../shared/i18n/format';
import { creditsUsedText, taskBadge, taskIsUnfinished, taskLabel, taskTime, taskWaitsForAllowance, translatedPercent } from './translations-format';

/** The store's tasks, newest first, with their progress, what they cost and what the seller can do about each. */
export function TaskActivity({ appId }: { appId: string }) {
	const { t } = useI18n();
	const tasks = useStoreTasks(appId);

	return (
		<section className="grid gap-3">
			<h2 className="text-lg font-semibold text-kumo-strong">{t('Activity')}</h2>
			{tasks.data ? (
				tasks.data.length > 0 ? (
					<ul className="grid gap-3">
						{tasks.data.map((task) => (
							<TaskRow key={task.id} appId={appId} task={task} />
						))}
					</ul>
				) : (
					<Empty title={t('No translations yet')} description={t('Translations you start show up here, with their progress and the credits they used.')} />
				)
			) : tasks.isError ? (
				<p className="text-sm text-kumo-subtle">{tasks.error.message}</p>
			) : (
				<div className="flex justify-center py-8">
					<Loader />
				</div>
			)}
		</section>
	);
}

function TaskRow({ appId, task }: { appId: string; task: TaskView }) {
	const { locale, t } = useI18n();
	const cancel = useCancelTask(appId);
	const badge = taskBadge(task);
	const { done, total } = task.progress;

	return (
		<li className="grid gap-2 rounded-lg border border-kumo-line p-3 text-sm">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="font-medium text-kumo-default">{taskLabel(task)}</span>
				<Badge variant={badge.variant}>{t(badge.label)}</Badge>
			</div>
			{total > 0 && <Meter label={t('{done} of {total} texts', { done: formatNumber(done, locale), total: formatNumber(total, locale) })} value={translatedPercent({ total, translated: done })} />}
			<span className="text-kumo-subtle">
				{taskTime(task, locale)} · {creditsUsedText(task.creditsUsed, locale)}
			</span>
			<TaskNotice appId={appId} task={task} />
			{taskIsUnfinished(task) && (
				<Button
					size="sm"
					variant="secondary"
					className="w-fit"
					disabled={cancel.isPending}
					loading={cancel.isPending}
					onClick={() => cancel.mutate(task.id, { onSuccess: () => toast.success(t('Canceled. What was translated stays.')), onError: (error) => toast.error(error.message) })}
				>
					{t('Cancel')}
				</Button>
			)}
		</li>
	);
}

/** Why a task stopped or waits, and what gets it going again; nothing for a task with nothing to say. */
export function TaskNotice({ appId, task }: { appId: string; task: TaskView }) {
	const { t, tn } = useI18n();
	const resume = useResumeTask(appId);
	const start = (label: string) => (
		<Button size="sm" variant="secondary" disabled={resume.isPending} loading={resume.isPending} onClick={() => resume.mutate(task.id, { onError: (error) => toast.error(error.message) })}>
			{label}
		</Button>
	);

	if (task.status === 'paused' && task.pauseReason === 'credits') {
		return (
			<Notice
				text={t("Paused: you're out of AI credits")}
				actions={
					<>
						<Link to={BILLING_PATH} className="text-sm font-medium text-kumo-default underline underline-offset-2">
							{t('Add credits')}
						</Link>
						{start(t('Resume'))}
					</>
				}
			/>
		);
	}
	if (task.status === 'paused') return <Notice text={t('Paused')} actions={start(t('Resume'))} />;
	if (taskWaitsForAllowance(task)) return <Notice text={t("Waiting for tomorrow's allowance")} />;
	if (task.status === 'failed') return <Notice text={t(task.lastError ?? TASK_FAILED_MESSAGE)} actions={start(t('Retry'))} />;
	if (task.lastError && taskIsUnfinished(task)) return <Notice text={t(task.lastError)} />;
	if (task.status === 'done' && task.progress.skipped > 0) {
		return <Notice text={tn("{count} text couldn't be translated", "{count} texts couldn't be translated", task.progress.skipped)} />;
	}
	return null;
}

function Notice({ text, actions }: { text: string; actions?: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ring ring-kumo-hairline">
			<span className="text-sm text-kumo-default">{text}</span>
			{actions && <span className="flex flex-wrap items-center gap-3">{actions}</span>}
		</div>
	);
}
