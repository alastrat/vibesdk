import type { LucideIcon } from 'lucide-react';
import { Rocket, Brain, Code, Bug, Settings } from 'lucide-react';
import { msg } from '@/lib/i18n';

export interface WorkflowTab {
	id: string;
	label: string;
	icon: LucideIcon;
	description: string;
	patterns?: string[];
}

/** Labels and descriptions are marked as messages here and translated where they are shown. */
export const WORKFLOW_TABS = {
	quickstart: {
		id: 'quickstart',
		label: msg('Quick Start'),
		icon: Rocket,
		description: msg('Most commonly customized settings'),
		patterns: ['template', 'blueprint', 'conversational'],
	},
	planning: {
		id: 'planning',
		label: msg('Planning'),
		icon: Brain,
		description: msg('Project planning and setup'),
		patterns: ['phase', 'project', 'suggestion', 'generation'],
	},
	coding: {
		id: 'coding',
		label: msg('Coding'),
		icon: Code,
		description: msg('Development and implementation'),
		patterns: ['implementation', 'file', 'regeneration'],
	},
	debugging: {
		id: 'debugging',
		label: msg('Debugging'),
		icon: Bug,
		description: msg('Code fixing and review'),
		patterns: ['fixer', 'fix', 'review', 'debug'],
	},
	advanced: {
		id: 'advanced',
		label: msg('Advanced'),
		icon: Settings,
		description: msg('Specialized operations'),
		patterns: ['screenshot', 'analysis', 'vision'],
	},
} as const;

export type WorkflowTabId = keyof typeof WORKFLOW_TABS;
