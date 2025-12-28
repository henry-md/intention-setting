import React, { useState, useEffect } from 'react';
import { ArrowLeft, X, Plus, ChevronRight, ChevronDown } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import type { User } from '../types/User';
import type { Group } from '../types/Group';
import { getNormalizedHostname } from '../utils/urlNormalization';

interface GroupEditProps {
  user: User | null;
  groupId: string;
  onBack: () => void;
}

/**
 * Full-page editor for a single group's contents. Child of Popup.tsx, accessed from Groups.tsx when clicking a group.
 * NOT the list view - Groups.tsx shows all groups, this edits one group's URLs and nested groups.
 * Replaces the entire view (not a tab), shows back button to return to Groups.tsx.
 */
const GroupEdit: React.FC<GroupEditProps> = ({ user, groupId, onBack }) => {
  const [group, setGroup] = useState<Group | null>(null);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupName, setGroupName] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [newItemInput, setNewItemInput] = useState('');
  const [inputError, setInputError] = useState('');

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

    // Check if adding this group would create a circular dependency
    if (item.startsWith('group:') && wouldCreateCircularDependency(item)) {
      alert('Cannot add this group: it would create a circular dependency');
      return;
    }

    const updatedGroup = { ...group, items: [...group.items, item] };
    const updatedGroups = allGroups.map(g => g.id === groupId ? updatedGroup : g);

    setGroup(updatedGroup);
    setAllGroups(updatedGroups);
    await saveGroupsToFirestore(updatedGroups);
    setShowAddMenu(false);
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

  // Check if adding a group would create circular dependency
  const wouldCreateCircularDependency = (itemToAdd: string): boolean => {
    if (!itemToAdd.startsWith('group:')) return false;

    // If trying to add itself
    if (itemToAdd === groupId) return true;

    // Check if the group to add contains this group (directly or indirectly)
    const visited = new Set<string>();
    const queue = [itemToAdd];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      if (currentId === groupId) return true;

      const currentGroup = allGroups.find(g => g.id === currentId);
      if (currentGroup) {
        const groupItems = currentGroup.items.filter(i => i.startsWith('group:'));
        queue.push(...groupItems);
      }
    }

    return false;
  };

  // Validate URL
  const isValidUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('.');
    } catch {
      return false;
    }
  };

  // Handle adding item from text input
  const handleAddItemFromInput = async () => {
    if (!group || !newItemInput.trim()) return;

    let itemToAdd = newItemInput.trim();
    setInputError('');

    // Check if it's a reference to another group by name
    const matchingGroup = allGroups.find(
      g => g.name.toLowerCase() === itemToAdd.toLowerCase() && g.id !== groupId
    );

    if (matchingGroup) {
      // It's a group name
      itemToAdd = matchingGroup.id;

      // Check for circular dependency
      if (wouldCreateCircularDependency(itemToAdd)) {
        setInputError('Cannot add this group: it would create a circular dependency');
        return;
      }

      // Check if already in another group
      const isInAnotherGroup = allGroups.some(
        g => g.id !== groupId && g.items.includes(itemToAdd)
      );
      if (isInAnotherGroup) {
        setInputError('This group is already in another group');
        return;
      }

      // Check if already in this group
      if (group.items.includes(itemToAdd)) {
        setInputError('This group is already in the current group');
        return;
      }
    } else {
      // It's a URL - normalize it
      // If no domain extension is provided, add .com
      if (!itemToAdd.includes('.')) {
        itemToAdd = itemToAdd + '.com';
      }

      if (!itemToAdd.startsWith('http://') && !itemToAdd.startsWith('https://')) {
        itemToAdd = 'https://' + itemToAdd;
      }

      if (!isValidUrl(itemToAdd)) {
        setInputError('Please enter a valid URL (e.g., youtube.com)');
        return;
      }

      // Normalize the URL
      const { normalizeUrl } = await import('../utils/urlNormalization');
      itemToAdd = normalizeUrl(itemToAdd);

      // Check if URL is already in another group
      const isInAnotherGroup = allGroups.some(
        g => g.id !== groupId && g.items.includes(itemToAdd)
      );
      if (isInAnotherGroup) {
        setInputError('This URL is already in another group');
        return;
      }

      // Check if already in this group
      if (group.items.includes(itemToAdd)) {
        setInputError('This URL is already in the current group');
        return;
      }
    }

    // Add the item
    await handleAddItem(itemToAdd);
    setNewItemInput('');
    setInputError('');
  };

  // Get available groups (not in any group, not this group, no circular dependency)
  const getAvailableGroups = () => {
    if (!group) return [];

    // Find which groups are already in other groups
    const groupsInOtherGroups = new Set<string>();
    allGroups.forEach(g => {
      if (g.id !== groupId) {
        g.items.forEach(item => {
          if (item.startsWith('group:')) {
            groupsInOtherGroups.add(item);
          }
        });
      }
    });

    // Available groups: not this group, not in this group, not would cause circular dependency, not in other groups
    return allGroups.filter(
      g => g.id !== groupId &&
           !group.items.includes(g.id) &&
           !wouldCreateCircularDependency(g.id) &&
           !groupsInOtherGroups.has(g.id)
    );
  };

  // Toggle expanded state
  const toggleExpanded = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  // Render nested item
  const renderItem = (item: string, depth: number = 0): React.ReactNode => {
    const isGroup = item.startsWith('group:');
    const isExpanded = expandedItems.has(item);

    if (isGroup) {
      const nestedGroup = allGroups.find(g => g.id === item);
      if (!nestedGroup) return null;

      return (
        <div key={item} style={{ marginLeft: `${depth * 16}px` }}>
          <div className="flex items-center gap-2 py-2 px-3 bg-slate-600 rounded-lg mb-2">
            <button
              onClick={() => toggleExpanded(item)}
              className="text-gray-300 hover:text-white"
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            <div className="flex-1 flex items-center gap-2">
              <span className="text-white text-sm font-medium">{nestedGroup.name}</span>
              <span className="text-xs text-gray-400">({nestedGroup.items.length} items)</span>
            </div>
            <button
              onClick={() => handleRemoveItem(item)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          {isExpanded && (
            <div className="ml-4">
              {nestedGroup.items.map(nestedItem => renderItem(nestedItem, depth + 1))}
            </div>
          )}
        </div>
      );
    } else {
      // It's a URL
      return (
        <div
          key={item}
          className="flex items-center gap-2 py-2 px-3 bg-slate-600 rounded-lg mb-2"
          style={{ marginLeft: `${depth * 16}px` }}
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
      );
    }
  };

  if (loading || !group) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  const availGroups = getAvailableGroups();

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
        <div className="flex gap-2">
          <input
            type="text"
            value={newItemInput}
            onChange={(e) => {
              setNewItemInput(e.target.value);
              setInputError('');
            }}
            onKeyPress={(e) => e.key === 'Enter' && handleAddItemFromInput()}
            placeholder="Enter URL (e.g., youtube.com) or group name"
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

        {/* Error Message */}
        {inputError && (
          <p className="text-red-400 text-sm">{inputError}</p>
        )}

        {/* Available Groups Dropdown */}
        {availGroups.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg flex items-center justify-between"
            >
              <span>Or select from existing groups</span>
              <ChevronDown size={16} className={showAddMenu ? 'transform rotate-180' : ''} />
            </button>

            {showAddMenu && (
              <div className="absolute top-full mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                {availGroups.map(g => (
                  <button
                    key={g.id}
                    onClick={() => handleAddItem(g.id)}
                    className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center gap-2"
                  >
                    <span className="font-medium">{g.name}</span>
                    <span className="text-xs text-gray-400">({g.items.length} items)</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Items List */}
      <div className="flex flex-col space-y-2">
        {group.items.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">
            No items in this group yet. Add some URLs or groups!
          </p>
        ) : (
          group.items.map(item => renderItem(item))
        )}
      </div>
    </div>
  );
};

export default GroupEdit;
