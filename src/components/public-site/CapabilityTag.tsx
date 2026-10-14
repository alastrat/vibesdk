import { StatusBadge } from '@/components/marketing/ComingSoon';
import { CAPABILITIES, type CapabilityId } from '@/lib/capabilities';

/** The capability's status badge from the registry; nothing once it's available. */
export function CapabilityTag({ id, tone = 'light' }: { id: CapabilityId; tone?: 'light' | 'dark' }) {
	const { status } = CAPABILITIES[id];
	return status === 'available' ? null : <StatusBadge status={status} tone={tone} />;
}
