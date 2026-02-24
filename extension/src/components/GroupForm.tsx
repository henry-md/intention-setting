import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Pencil } from 'lucide-react';
import type { Group } from '../types/Group';
import { normalizeUrl } from '../utils/urlNormalization';
import { checkTyposquatting } from '../utils/typosquatting';
import { prepareUrl } from '../utils/urlValidation';
import { ReorderList } from './ui/reorder-list';
import { formatUrlForDisplay, getFaviconUrl, FAVICON_FALLBACK } from '../utils/urlDisplay';

interface GroupFormProps {
  groupId?: string; // If provided, we're editing; if not, we're creating
  initialName?: string;
  initialItems?: string[];
  allGroups: Group[];
  onSave: (name: string, items: string[]) => Promise<void>;
  onCancel: () => void;
  enableReordering?: boolean; // If true, items can be reordered (edit mode)
  onReorder?: (reorderedItems: string[]) => Promise<void>; // Called when items are reordered
}

/**
 * Shared form component for both creating and editing groups.
 * When groupId is provided, displays name as a header (edit mode).
 * When groupId is not provided, displays name as an input field (create mode).
 * Includes "dump contents from group" functionality in both modes.
 */
export const GroupForm: React.FC<GroupFormProps> = ({
  groupId,
  initialName = '',
  initialItems = [],
  allGroups,
  onSave,
  onCancel,
  enableReordering = false,
  onReorder,
}) => {
  const [groupName, setGroupName] = useState(initialName);
  const [items, setItems] = useState<string[]>(initialItems);
  const [newItemInput, setNewItemInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isNameFocused, setIsNameFocused] = useState(false);
  const [typosquattingWarning, setTyposquattingWarning] = useState<{
    url: string;
    suggestion: string;
  } | null>(null);
  const groupNameInputRef = useRef<HTMLInputElement>(null);

  const isEditMode = !!groupId;

  // Update state when groupId changes (switching to a different group in edit mode)
  useEffect(() => {
    if (groupId) {
      setGroupName(initialName);
      setItems(initialItems);
    }
  }, [groupId]);

  // Helper: Add a URL that's already been validated and typosquatting-checked
  const addNormalizedUrl = async (url: string) => {
    // Normalize the URL
    const normalizedUrl = normalizeUrl(url);

    // Check if already in the current group items
    if (items.includes(normalizedUrl)) {
      setInputError('This URL is already in the current group');
      setTyposquattingWarning(null);
      return;
    }

    // Add the item
    const newItems = [...items, normalizedUrl];
    setItems(newItems);
    setNewItemInput('');
    setInputError('');
    setTyposquattingWarning(null);

    // In edit mode, save immediately
    if (isEditMode) {
      await onSave(groupName, newItems);
    }
  };

  // Handle adding item from text input
  const handleAddItemFromInput = async () => {
    if (!newItemInput.trim()) return;

    const input = newItemInput.trim();
    setInputError('');

    // Check if it's a reference to another group by name
    const matchingGroup = allGroups.find(
      g => g.name.toLowerCase() === input.toLowerCase() && g.id !== groupId
    );

    if (matchingGroup) {
      // Dump all URLs from the selected group into this group
      const urlsFromGroup = matchingGroup.items.filter(item => !item.startsWith('group:'));

      if (urlsFromGroup.length === 0) {
        setInputError('This group has no URLs to dump');
        return;
      }

      // Add all URLs that aren't already in this group
      const urlsToAdd = urlsFromGroup.filter(url => !items.includes(url));

      if (urlsToAdd.length === 0) {
        setInputError('All URLs from this group are already in the current group');
        return;
      }

      // Add all the URLs
      const newItems = [...items, ...urlsToAdd];
      setItems(newItems);
      setNewItemInput('');
      setInputError('');
      setShowSuggestions(false);

      // In edit mode, save immediately
      if (isEditMode) {
        await onSave(groupName, newItems);
      }
    } else {
      // It's a URL
      try {
        // Prepare and validate URL
        const preparedUrl = prepareUrl(input);

        // Check for typosquatting
        const typoCheck = checkTyposquatting(preparedUrl);
        if (typoCheck.isSuspicious && typoCheck.suggestion) {
          setTyposquattingWarning({
            url: preparedUrl,
            suggestion: typoCheck.suggestion + '.com',
          });
          return;
        }

        // Add the URL (normalize, check duplicates, add)
        await addNormalizedUrl(preparedUrl);
      } catch (error) {
        setInputError(error instanceof Error ? error.message : 'Invalid URL');
      }
    }
  };

  // Remove item from group
  const handleRemoveItem = async (item: string) => {
    const newItems = items.filter(i => i !== item);
    setItems(newItems);

    // In edit mode, save immediately
    if (isEditMode) {
      await onSave(groupName, newItems);
    }
  };

  // Handle reordering items (edit mode only)
  const handleReorderItems = async (reorderedElements: React.ReactElement[]) => {
    // Extract item IDs from the reordered React elements using data-item attribute
    const newItems = reorderedElements.map(element => {
      const props = element.props as { 'data-item'?: string };
      return props['data-item'] as string;
    });

    setItems(newItems);

    if (onReorder) {
      await onReorder(newItems);
    }
  };

  // Get matching group suggestions for search
  const getGroupSuggestions = () => {
    if (!newItemInput.trim()) return [];

    const input = newItemInput.toLowerCase();
    return allGroups.filter(
      g => g.id !== groupId && g.name.toLowerCase().includes(input)
    );
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!groupName.trim()) {
      setInputError('Please enter a group name');
      return;
    }

    await onSave(groupName.trim(), items);
  };

  // Update group name (for edit mode)
  const handleUpdateName = async () => {
    if (!groupName.trim()) return;
    // In edit mode, we save immediately on blur/enter
    if (isEditMode && groupName.trim() !== initialName) {
      await onSave(groupName.trim(), items);
    }
  };

  const groupSuggestions = getGroupSuggestions();

  return (
    <div className="bg-zinc-700 rounded-lg p-4 space-y-3">
      {/* Group Name - Header or Input based on mode */}
      {isEditMode ? (
        <div className={isNameFocused ? 'flex w-full items-center gap-3' : 'inline-flex items-center gap-1.5'}>
          <input
            ref={groupNameInputRef}
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onFocus={() => setIsNameFocused(true)}
            onBlur={async () => {
              setIsNameFocused(false);
              await handleUpdateName();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleUpdateName();
                e.currentTarget.blur();
              }
            }}
            className={`text-lg font-semibold bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-zinc-500 rounded px-2 py-1 min-w-0 ${
              isNameFocused ? 'flex-1 mr-1' : 'w-fit'
            }`}
            style={
              isNameFocused
                ? undefined
                : { width: `${Math.max(1, Math.min(groupName.length + 1, 28))}ch` }
            }
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={async () => {
              if (document.activeElement !== groupNameInputRef.current) {
                groupNameInputRef.current?.focus();
                return;
              }
              await handleUpdateName();
              groupNameInputRef.current?.blur();
            }}
            aria-label={isNameFocused ? 'Save group name' : 'Edit group name'}
            title={isNameFocused ? 'Save group name' : 'Edit group name'}
            className={`text-zinc-400 hover:text-white transition-colors ${isNameFocused ? 'ml-auto pl-1' : ''}`}
          >
            <Pencil className={isNameFocused ? 'h-4 w-4' : 'h-3 w-3'} />
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="Group name"
          className="w-full px-3 py-2 border border-zinc-600 bg-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-500 text-sm"
          autoFocus
        />
      )}

      {/* URL Input */}
      <div className="flex flex-col space-y-2">
        <div className="relative">
          <div className="flex gap-2">
            <input
              type="text"
              value={newItemInput}
              onChange={(e) => {
                setNewItemInput(e.target.value);
                setInputError('');
                setShowSuggestions(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddItemFromInput();
                }
              }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Enter URL or search for group (e.g., youtube.com)"
              className="flex-1 px-3 py-2 border border-zinc-600 bg-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-500 text-sm"
            />
            <button
              onClick={handleAddItemFromInput}
              className="purple-button"
              title="Add item"
            >
              <Plus size={20} />
            </button>
          </div>

          {/* Group Suggestions Dropdown */}
          {showSuggestions && groupSuggestions.length > 0 && (
            <div className="absolute top-full mt-1 w-full bg-zinc-800 border border-zinc-600 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
              <div className="px-3 py-1 text-xs text-zinc-400 border-b border-zinc-600">
                Dump contents from existing group
              </div>
              {groupSuggestions.map(g => (
                <button
                  key={g.id}
                  onClick={() => {
                    setNewItemInput(g.name);
                    setShowSuggestions(false);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-white hover:bg-zinc-700 flex items-center gap-2"
                >
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-zinc-400">({g.items.length} items)</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Items List */}
        {items.length > 0 && (
          enableReordering ? (
            <ReorderList
              withDragHandle={false}
              className="gap-2"
              itemClassName="bg-zinc-600 rounded-lg"
              onReorderFinish={handleReorderItems}
              children={items.map(item => (
                <div
                  key={item}
                  data-item={item}
                  className="flex items-center gap-2 py-2 px-3"
                >
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
                    onClick={() => handleRemoveItem(item)}
                    className="text-zinc-400 hover:text-white transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              )) as React.ReactElement[]}
            />
          ) : (
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={index} className="flex items-center gap-2 py-2 px-3 bg-zinc-600 rounded-lg">
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
                    onClick={() => handleRemoveItem(item)}
                    className="text-zinc-400 hover:text-white transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )
        )}

        {/* Error Message */}
        {inputError && (
          <p className="text-red-400 text-sm">{inputError}</p>
        )}

        {/* Typosquatting Warning Dialog */}
        {typosquattingWarning && (
          <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-amber-400 text-xl">⚠️</span>
              <div className="flex-1">
                <p className="text-amber-100 text-sm font-medium mb-1">
                  Possible typo detected
                </p>
                <p className="text-amber-200 text-xs">
                  Did you mean <span className="font-bold">{typosquattingWarning.suggestion}</span>?
                </p>
                <p className="text-amber-300 text-xs mt-1">
                  You entered: {formatUrlForDisplay(typosquattingWarning.url)}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const correctedUrl = 'https://' + typosquattingWarning.suggestion;
                  await addNormalizedUrl(correctedUrl);
                }}
                className="flex-1 px-3 py-2 border border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/10 text-sm rounded-lg"
              >
                Use {typosquattingWarning.suggestion}
              </button>
              <button
                onClick={async () => {
                  await addNormalizedUrl(typosquattingWarning.url);
                }}
                className="flex-1 px-3 py-2 bg-zinc-600 hover:bg-zinc-700 text-white text-sm rounded-lg"
              >
                Keep original
              </button>
              <button
                onClick={() => {
                  setTyposquattingWarning(null);
                }}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons - Only show in create mode */}
      {!isEditMode && (
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 bg-zinc-600 hover:bg-zinc-700 text-white rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!groupName.trim()}
            className="flex-1 purple-button px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Group
          </button>
        </div>
      )}
    </div>
  );
};
