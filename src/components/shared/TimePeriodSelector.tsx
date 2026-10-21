import { t, useI18n, msg } from '@/lib/i18n';
import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from 'lucide-react';
import type { TimePeriod } from '@/api-types';

interface TimePeriodSelectorProps {
  value: TimePeriod;
  onValueChange: (period: TimePeriod) => void;
  className?: string;
  disabled?: boolean;
  showForSort?: 'popular' | 'trending' | 'all'; // Show only for certain sort types
}

const TIME_PERIODS: Array<{
  value: TimePeriod;
  label: string;
  shortLabel: string;
}> = [
  { value: 'today', label: msg("Today"), shortLabel: msg("Today") },
  { value: 'week', label: msg("This Week"), shortLabel: msg('Week') },
  { value: 'month', label: msg("This Month"), shortLabel: msg('Month') },
  { value: 'all', label: msg("All Time"), shortLabel: msg('All') },
];

export const TimePeriodSelector: React.FC<TimePeriodSelectorProps> = ({
  value,
  onValueChange,
  className,
  disabled,
  showForSort = 'all'
}) => {
	useI18n();
  // Don't show the selector for 'recent' sort - it doesn't make sense
  if (showForSort !== 'all' && showForSort !== 'popular' && showForSort !== 'trending') {
    return null;
  }

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <Calendar className="h-4 w-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TIME_PERIODS.map((period) => (
          <SelectItem key={period.value} value={period.value}>
            {t(period.label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};