import React from 'react';
import { Plus, X } from 'lucide-react';
import { getNormalizedHostname } from '../utils/urlNormalization';

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
    <div className="flex items-center gap-2 py-2 px-3 bg-slate-600 rounded-lg">
      <img
        src={`https://www.google.com/s2/favicons?domain=${getNormalizedHostname(item)}&sz=32`}
        alt=""
        className="w-4 h-4"
        onError={(e) => {
          e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23666"/></svg>';
        }}
      />
      <span className="flex-1 text-white text-sm">
        {item.replace(/^https?:\/\//, '')}
      </span>
      <button
        onClick={() => onRemoveItem(item)}
        className="text-gray-400 hover:text-white transition-colors"
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
          className="flex-1 px-3 py-2 border border-gray-600 bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
