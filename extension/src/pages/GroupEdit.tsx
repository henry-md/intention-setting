import React, { useState, useEffect } from 'react';
import { ArrowLeft, X, Plus } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import type { User } from '../types/User';
import type { Group } from '../types/Group';
import { getNormalizedHostname, normalizeUrl } from '../utils/urlNormalization';
import { checkTyposquatting } from '../utils/typosquatting';
import { prepareUrl } from '../utils/urlValidation';
import { ReorderList } from '../components/ui/reorder-list';
import Spinner from '../components/Spinner';

interface GroupEditProps {
  user: User | null;
  groupId: string;
  onBack: () => void;
}

/**
 * Full-page editor for a single group's contents. Child of Popup.tsx, accessed from Groups.tsx when clicking a group.
 * NOT the list view - Groups.tsx shows all groups, this edits one group's URLs.
 * Groups are one-level deep only - selecting another group dumps its URLs into the current group.
 * Replaces the entire view (not a tab), shows back button to return to Groups.tsx.
 */
const GroupEdit: React.FC<GroupEditProps> = ({ user, groupId, onBack }) => {
  const [group, setGroup] = useState<Group | null>(null);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupName, setGroupName] = useState('');
  const [newItemInput, setNewItemInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [typosquattingWarning, setTyposquattingWarning] = useState<{
    url: string;
    suggestion: string;
  } | null>(null);

  // Fetch group and all groups
  useEffect(() => {
    const fetchData = async () => {
      if (!user?.uid) {
        setLoading(false);
        return;
      }

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const data = userDoc.data();
          const groups = data.groups || [];

          setAllGroups(groups);

          const currentGroup = groups.find((g: Group) => g.id === groupId);
          if (currentGroup) {
            setGroup(currentGroup);
            setGroupName(currentGroup.name);
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.uid, groupId]);

  // Save groups to Firestore
  const saveGroupsToFirestore = async (updatedGroups: Group[]) => {
    if (!user?.uid) return;

    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, { groups: updatedGroups }, { merge: true });
    } catch (error) {
      console.error('Error saving groups:', error);
    }
  };

  // Update group name
  const handleUpdateName = async () => {
    if (!group || !groupName.trim()) return;

    const updatedGroup = { ...group, name: groupName.trim() };
    const updatedGroups = allGroups.map(g => g.id === groupId ? updatedGroup : g);

    setGroup(updatedGroup);
    setAllGroups(updatedGroups);
    await saveGroupsToFirestore(updatedGroups);
  };

  // Add item to group
  const handleAddItem = async (item: string) => {
    if (!group) return;

    // Check if item already exists in this group
    if (group.items.includes(item)) {
      return;
    }

    // Don't allow adding groups anymore, only URLs
    if (item.startsWith('group:')) {
      return;
    }

    const updatedGroup = { ...group, items: [...group.items, item] };
    const updatedGroups = allGroups.map(g => g.id === groupId ? updatedGroup : g);

    setGroup(updatedGroup);
    setAllGroups(updatedGroups);
    await saveGroupsToFirestore(updatedGroups);
  };

  // Remove item from group
  const handleRemoveItem = async (item: string) => {
    if (!group) return;

    const updatedGroup = { ...group, items: group.items.filter(i => i !== item) };
    const updatedGroups = allGroups.map(g => g.id === groupId ? updatedGroup : g);

    setGroup(updatedGroup);
    setAllGroups(updatedGroups);
    await saveGroupsToFirestore(updatedGroups);
  };

  // Handle reordering items
  const handleReorderItems = async (reorderedElements: React.ReactElement[]) => {
    if (!group) return;

    // Extract item IDs from the reordered React elements using data-item attribute
    const newItems = reorderedElements.map(element => {
      const props = element.props as { 'data-item'?: string };
      return props['data-item'] as string;
    });

    const updatedGroup = { ...group, items: newItems };
    const updatedGroups = allGroups.map(g => g.id === groupId ? updatedGroup : g);

    setGroup(updatedGroup);
    setAllGroups(updatedGroups);
    await saveGroupsToFirestore(updatedGroups);
  };

  // Save group items directly (used when dumping URLs from another group)
  const saveGroupItems = async (newItems: string[]) => {
    if (!group) return;

    const updatedGroup = { ...group, items: newItems };
    const updatedGroups = allGroups.map(g => g.id === groupId ? updatedGroup : g);

    setGroup(updatedGroup);
    setAllGroups(updatedGroups);
    await saveGroupsToFirestore(updatedGroups);
  };

  // Helper: Add a URL that's already been validated and typosquatting-checked
  // Normalizes, checks for duplicates, and adds to group
  const addNormalizedUrl = async (url: string) => {
    if (!group) return;

    // Normalize the URL
    const normalizedUrl = normalizeUrl(url);

    // Check if already in this group
    if (group.items.includes(normalizedUrl)) {
      setInputError('This URL is already in the current group');
      setTyposquattingWarning(null);
      return;
    }

    // Add the item
    await handleAddItem(normalizedUrl);
    setNewItemInput('');
    setInputError('');
    setTyposquattingWarning(null);
  };

  // Handle adding item from text input
  const handleAddItemFromInput = async () => {
    if (!group || !newItemInput.trim()) return;

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
      const urlsToAdd = urlsFromGroup.filter(url => !group.items.includes(url));

      if (urlsToAdd.length === 0) {
        setInputError('All URLs from this group are already in the current group');
        return;
      }

      // Add all the URLs
      const updatedItems = [...group.items, ...urlsToAdd];
      await saveGroupItems(updatedItems);

      setNewItemInput('');
      setInputError('');
      setShowSuggestions(false);
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

  // Get matching group suggestions for search
  const getGroupSuggestions = () => {
    if (!newItemInput.trim()) return [];

    const input = newItemInput.toLowerCase();
    return allGroups.filter(
      g => g.id !== groupId && g.name.toLowerCase().includes(input)
    );
  };

  if (loading || !group) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const groupSuggestions = getGroupSuggestions();

  return (
    <div className="h-screen w-full flex flex-col space-y-4 p-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-white">
          <ArrowLeft size={20} />
        </button>
        <input
          type="text"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          onBlur={handleUpdateName}
          onKeyPress={(e) => e.key === 'Enter' && handleUpdateName()}
          className="flex-1 text-lg font-semibold bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
        />
      </div>

      {/* Add Item Section */}
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
              onKeyPress={(e) => e.key === 'Enter' && handleAddItemFromInput()}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Enter URL or search for group (e.g., youtube.com)"
              className="flex-1 px-3 py-2 border border-gray-600 bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
            <div className="absolute top-full mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
              <div className="px-3 py-1 text-xs text-gray-400 border-b border-gray-600">
                Dump contents from existing group
              </div>
              {groupSuggestions.map(g => (
                <button
                  key={g.id}
                  onClick={() => {
                    setNewItemInput(g.name);
                    setShowSuggestions(false);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center gap-2"
                >
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-gray-400">({g.items.length} items)</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Error Message */}
        {inputError && (
          <p className="text-red-400 text-sm">{inputError}</p>
        )}

        {/* Typosquatting Warning Dialog */}
        {typosquattingWarning && (
          <div className="bg-yellow-900 border border-yellow-600 rounded-lg p-3 space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-yellow-500 text-xl">⚠️</span>
              <div className="flex-1">
                <p className="text-yellow-100 text-sm font-medium mb-1">
                  Possible typo detected
                </p>
                <p className="text-yellow-200 text-xs">
                  Did you mean <span className="font-bold">{typosquattingWarning.suggestion}</span>?
                </p>
                <p className="text-yellow-300 text-xs mt-1">
                  You entered: {typosquattingWarning.url.replace(/^https?:\/\//, '')}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  // Use the suggested correct domain
                  const correctedUrl = 'https://' + typosquattingWarning.suggestion;
                  await addNormalizedUrl(correctedUrl);
                }}
                className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg"
              >
                Use {typosquattingWarning.suggestion}
              </button>
              <button
                onClick={async () => {
                  // User confirms they want to use the original (potentially misspelled) URL
                  await addNormalizedUrl(typosquattingWarning.url);
                }}
                className="flex-1 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg"
              >
                Keep original
              </button>
              <button
                onClick={() => {
                  // Cancel and go back to editing
                  setTyposquattingWarning(null);
                }}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Items List */}
      {group.items.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">
          No items in this group yet. Add some URLs!
        </p>
      ) : (
        <ReorderList
          withDragHandle={false}
          className="gap-2"
          itemClassName="bg-slate-600 rounded-lg"
          onReorderFinish={handleReorderItems}
          children={group.items.map(item => (
            <div
              key={item}
              data-item={item}
              className="flex items-center gap-2 py-2 px-3"
            >
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
                onClick={() => handleRemoveItem(item)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          )) as React.ReactElement[]}
        />
      )}
    </div>
  );
};

export default GroupEdit;
