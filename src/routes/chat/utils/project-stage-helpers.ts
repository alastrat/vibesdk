import { msg } from '@/lib/i18n';

export interface ProjectStage {
    id: 'bootstrap' | 'blueprint' | 'code';
    title: string;
    status: 'pending' | 'active' | 'completed' | 'error';
    metadata?: string;
}

/** The stage titles are marked as messages here and translated where they are shown. */
export const initialStages: ProjectStage[] = [
    {
        id: 'bootstrap',
        title: msg('Bootstrapping project'),
        status: 'active',
    },
    {
        id: 'blueprint',
        title: msg('Generating Blueprint'),
        status: 'pending',
    },
    { id: 'code', title: msg('Generating code'), status: 'pending' },
];

/**
 * Update a specific stage's status and metadata
 */
export function updateStage(
    stages: ProjectStage[],
    stageId: ProjectStage['id'],
    updates: Partial<Omit<ProjectStage, 'id'>>
): ProjectStage[] {
    return stages.map(stage =>
        stage.id === stageId
            ? { ...stage, ...updates }
            : stage
    );
}

/**
 * Complete multiple stages at once
 */
export function completeStages(
    stages: ProjectStage[],
    stageIds: ProjectStage['id'][]
): ProjectStage[] {
    return stages.map(stage =>
        stageIds.includes(stage.id)
            ? { ...stage, status: 'completed' as const }
            : stage
    );
}

/**
 * Get the status of a specific stage
 */
export function getStageStatus(
    stages: ProjectStage[],
    stageId: ProjectStage['id']
): ProjectStage['status'] | undefined {
    return stages.find(stage => stage.id === stageId)?.status;
}

/**
 * Check if a stage is completed
 */
export function isStageCompleted(
    stages: ProjectStage[],
    stageId: ProjectStage['id']
): boolean {
    return getStageStatus(stages, stageId) === 'completed';
}
