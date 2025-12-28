import React from 'react';
import type { User } from '../types/User';

interface LimitsProps {
  user: User | null;
}

/**
 * Placeholder tab for future limits functionality. Child of Popup.tsx, renders inside the Limits tab.
 * Sibling to Groups.tsx and Home.tsx (other tabs).
 */
const Limits: React.FC<LimitsProps> = () => {
  return (
    <div className="h-screen w-full flex flex-col space-y-4 p-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Limits</h3>
      </div>

      <div className="flex items-center justify-center flex-1">
        <p className="text-gray-400 text-center">
          Limits page coming soon...
        </p>
      </div>
    </div>
  );
};

export default Limits;
