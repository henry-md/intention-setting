import React, { useState, useEffect } from 'react';
import { Plus, MoreVertical, Edit2, Trash2 } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import type { User } from '../types/User';
import type { Group } from '../types/Group';
import { getNormalizedHostname } from '../utils/urlNormalization';
import Spinner from '../components/Spinner';

interface GroupsProps {
  user: User | null;
  onEditGroup: (groupId: string) => void;
}

/**
 * List view showing all groups as cards. Child of Popup.tsx, renders inside the Groups tab.
 * NOT the editor - clicking a group navigates to GroupEdit.tsx for editing.
 * Sibling to Home.tsx and Limits.tsx (other tabs).
 */
const Groups: React.FC<GroupsProps> = ({ user, onEditGroup }) => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Fetch groups from Firestore
  useEffect(() => {
    const fetchGroups = async () => {
      if (!user?.uid) {
        setLoading(false);
        return;
      }

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const data = userDoc.data();
          setGroups(data.groups || []);
        }
      } catch (error) {
        console.error('Error fetching groups:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, [user?.uid]);

  // Save groups to Firestore
  const saveGroupsToFirestore = async (newGroups: Group[]) => {
    if (!user?.uid) return;

    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, { groups: newGroups }, { merge: true });
    } catch (error) {
      console.error('Error saving groups:', error);
    }
  };

  // Create new group
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;

    const newGroup: Group = {
      id: `group:${Date.now()}`,
      name: newGroupName.trim(),
      items: [],
      createdAt: new Date().toISOString(),
    };

    const updatedGroups = [...groups, newGroup];
    setGroups(updatedGroups);
    await saveGroupsToFirestore(updatedGroups);
    setNewGroupName('');
    setShowCreateForm(false);

    // Automatically navigate to edit page
    onEditGroup(newGroup.id);
  };

  // Delete group
  const handleDeleteGroup = async (groupId: string) => {
    const updatedGroups = groups.filter(g => g.id !== groupId);
    setGroups(updatedGroups);
    await saveGroupsToFirestore(updatedGroups);
    setOpenMenuId(null);
  };

  // Get URLs from a group (recursively if it contains other groups)
  const getGroupUrls = (group: Group): string[] => {
    const urls: string[] = [];

    for (const item of group.items) {
      if (item.startsWith('group:')) {
        // It's a nested group, find it and get its URLs
        const nestedGroup = groups.find(g => g.id === item);
        if (nestedGroup) {
          urls.push(...getGroupUrls(nestedGroup));
        }
      } else {
        // It's a URL
        urls.push(item);
      }
    }

    return urls;
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col space-y-4 p-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Groups</h3>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="purple-button"
          title="Create Group"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Create Group Form */}
      {showCreateForm && (
        <div className="flex gap-2">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleCreateGroup()}
            placeholder="Group name..."
            className="flex-1 px-3 py-2 border border-gray-600 bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            autoFocus
          />
          <button onClick={handleCreateGroup} className="purple-button px-4">
            Create
          </button>
        </div>
      )}

      {/* Groups List */}
      <div className="flex flex-col space-y-3">
        {groups.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">
            No groups yet. Create one to get started!
          </p>
        ) : (
          groups.map((group) => {
            const urls = getGroupUrls(group);
            const displayUrls = urls.slice(0, 5); // Show max 5 icons

            return (
              <div
                key={group.id}
                onClick={() => onEditGroup(group.id)}
                className="bg-slate-700 hover:bg-slate-600 rounded-lg p-4 flex items-center gap-4 cursor-pointer transition-colors"
              >
                {/* Site Icons */}
                <div className="flex items-center gap-1">
                  {displayUrls.length > 0 ? (
                    <>
                      {displayUrls.map((url, idx) => (
                        <img
                          key={idx}
                          src={`https://www.google.com/s2/favicons?domain=${getNormalizedHostname(url)}&sz=32`}
                          alt=""
                          className="w-5 h-5"
                          onError={(e) => {
                            e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23666"/></svg>';
                          }}
                        />
                      ))}
                      {urls.length > 5 && (
                        <span className="text-xs text-gray-400 ml-1">
                          +{urls.length - 5}
                        </span>
                      )}
                    </>
                  ) : (
                    <div className="w-5 h-5 rounded bg-gray-600" />
                  )}
                </div>

                {/* Group Name */}
                <span className="flex-1 text-white font-medium">
                  {group.name}
                </span>

                {/* Menu */}
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === group.id ? null : group.id);
                    }}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <MoreVertical size={20} />
                  </button>

                  {openMenuId === group.id && (
                    <div className="absolute right-0 mt-2 w-32 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-10">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditGroup(group.id);
                          setOpenMenuId(null);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center gap-2 rounded-t-lg"
                      >
                        <Edit2 size={14} />
                        Edit
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteGroup(group.id);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2 rounded-b-lg"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default Groups;
