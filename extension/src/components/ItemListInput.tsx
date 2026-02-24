import React from 'react';
import { Plus, X } from 'lucide-react';
import { formatUrlForDisplay, getFaviconUrl, FAVICON_FALLBACK } from '../utils/urlDisplay';

interface ItemListInputProps {
  items: string[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onAddItem: () => void;
  onRemoveItem: (item: string) => void;
  placeholder: string;
  error?: string;
  renderItem?: (item: string) => React.ReactNode;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Reusable component for adding and displaying a list of items (URLs, group names, etc.)
 * Shows an input field with a Plus button, and displays added items below with remove buttons
 */
export const ItemListInput: React.FC<ItemListInputProps> = ({
  items,
  inputValue,
  onInputChange,
  onAddItem,
  onRemoveItem,
  placeholder,
  error,
  renderItem,
  onKeyDown,
}) => {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onAddItem();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (onKeyDown) {
      onKeyDown(e);
    }
  };

  const defaultRenderItem = (item: string) => (
    <div className="flex items-center gap-2 py-2 px-3 bg-zinc-600 rounded-lg">
      <img
        src={getFaviconUrl(item)}
        alt=""
        className="w-4 h-4"
        onError={(e) => {
          e.currentTarget.src = FAVICON_FALLBACK;
        }}
      />
      <span className="flex-1 text-white text-sm">
        {formatUrlForDisplay(item)}
      </span>
      <button
        onClick={() => onRemoveItem(item)}
        className="text-zinc-400 hover:text-white transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyPress={handleKeyPress}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 border border-zinc-600 bg-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-500 text-sm"
        />
        <button
          onClick={onAddItem}
          className="purple-button"
          title="Add item"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      {/* List of items */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index}>
              {renderItem ? renderItem(item) : defaultRenderItem(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
