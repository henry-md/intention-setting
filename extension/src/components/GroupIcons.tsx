import React from 'react';
import type { Group } from '../types/Group';
import { getFaviconUrl, FAVICON_FALLBACK } from '../utils/urlDisplay';

interface GroupIconsProps {
  group: Group;
  maxIcons?: number;
  iconSize?: 'sm' | 'md' | 'lg';
}

/**
 * Displays favicon icons for URLs in a group
 * Groups are one-level deep only (no nesting)
 * Shows up to maxIcons favicons with a +X indicator for additional URLs
 */
export const GroupIcons: React.FC<GroupIconsProps> = ({
  group,
  maxIcons = 5,
  iconSize = 'md',
}) => {
  // Groups only contain URLs (no nesting)
  const urls = group.items.filter(item => !item.startsWith('group:'));
  const displayUrls = urls.slice(0, maxIcons);

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  if (displayUrls.length === 0) {
    return <div className={`${sizeClasses[iconSize]} rounded bg-gray-600`} />;
  }

  return (
    <div className="flex items-center gap-1">
      {displayUrls.map((url, idx) => (
        <img
          key={idx}
          src={getFaviconUrl(url)}
          alt=""
          className={sizeClasses[iconSize]}
          onError={(e) => {
            e.currentTarget.src = FAVICON_FALLBACK;
          }}
        />
      ))}
      {urls.length > maxIcons && (
        <span className="text-xs text-gray-400 ml-1">
          +{urls.length - maxIcons}
        </span>
      )}
    </div>
  );
};
