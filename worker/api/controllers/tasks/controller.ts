/** The signed-in seller's background tasks: list them, cancel one, and resume a paused or failed one. A seller only ever sees and changes their own. */

import type { RouteContext } from '../../types/route-context';
import { msg } from '../../../../shared/i18n/translate';
import type { TaskView } from '../../../../shared/types/tasks';
import { TaskService, type TaskRecord } from '../../../database/services/TaskService';
import { serverAnalytics } from '../../../services/posthog/analytics';
import { trackTaskEnded } from '../../../services/tasks/task-events';
import { wakeTaskRunner } from '../../../services/tasks/scheduler';
import { taskView } from '../../../services/tasks/task-view';
import { TranslationsApiController, type Reply } from '../storeTranslations/translations-api';

/** A seller's task list shows this many, newest first. */
const TASK_LIST_LIMIT = 50;

const TASK_NOT_FOUND = msg("That task isn't there, or it has already finished.");
const CANNOT_RESUME = msg("This task can't be resumed. It may have finished, the same work may already be queued, or you may have too many unfinished tasks.");

export class TasksController extends TranslationsApiController {
	/** The seller's tasks, newest first; `appId` narrows them to one store's. */
	static async list(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Reply<TaskView[]>> {
		const user = context.user!;
		try {
			const paused = await this.pausedReply<TaskView[]>(env, user);
			if (paused) return paused;
			const appId = context.queryParams.get('appId') ?? undefined;
			const records = await new TaskService(env).listForUser(user.id, { appId, limit: TASK_LIST_LIMIT });
			return this.createSuccessResponse(records.flatMap((record) => taskView(record) ?? []));
		} catch (error) {
			return this.handleError(error, 'list tasks') as Reply<TaskView[]>;
		}
	}

	static async cancel(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Reply<TaskView>> {
		const user = context.user!;
		try {
			const paused = await this.pausedReply<TaskView>(env, user);
			if (paused) return paused;
			const canceled = await new TaskService(env).cancel(context.pathParams.id ?? '', user.id);
			if (!canceled) return this.refusal<TaskView>(env, user, 404, TASK_NOT_FOUND);
			this.trackEnded(env, canceled);
			return this.viewReply(canceled);
		} catch (error) {
			return this.handleError(error, 'cancel a task') as Reply<TaskView>;
		}
	}

	/** Queues a paused or failed task again where it stopped, and wakes the seller's runner. */
	static async resume(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Reply<TaskView>> {
		const user = context.user!;
		try {
			const paused = await this.pausedReply<TaskView>(env, user);
			if (paused) return paused;
			const tasks = new TaskService(env);
			const id = context.pathParams.id ?? '';
			const resumed = await tasks.resume(id, user.id);
			if (!resumed) {
				const own = await tasks.findForUser(id, user.id);
				return own ? this.refusal<TaskView>(env, user, 409, CANNOT_RESUME) : this.refusal<TaskView>(env, user, 404, TASK_NOT_FOUND);
			}
			await wakeTaskRunner(env, user.id);
			return this.viewReply(resumed);
		} catch (error) {
			return this.handleError(error, 'resume a task') as Reply<TaskView>;
		}
	}

	/** Cancels end a task outside the runner, so the runner can't report them. Analytics can't fail the request. */
	private static trackEnded(env: Env, task: TaskRecord): void {
		try {
			trackTaskEnded(serverAnalytics(env), task);
		} catch (error) {
			this.logger.warn('Could not record a canceled task', { taskId: task.id, error });
		}
	}

	private static viewReply(task: TaskRecord): Reply<TaskView> {
		const view = taskView(task);
		if (!view) throw new Error(`Task ${task.id} has a payload its kind can't read`);
		return this.createSuccessResponse(view);
	}
}
