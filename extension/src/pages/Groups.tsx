import React, { useState, useEffect, useCallback } from 'react';
import { Plus, MoreVertical, Edit2, Trash2 } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import type { User } from '../types/User';
import type { Group } from '../types/Group';
import type { Limit } from '../types/Limit';
import Spinner from '../components/Spinner';
import { GroupForm } from '../components/GroupForm';
import { GroupIcons } from '../components/GroupIcons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);

  // Fetch groups from Firestore
  const fetchGroups = useCallback(async () => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    console.log('Fetching groups from Firestore...');
    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        const data = userDoc.data();
        const fetchedGroups = data.groups || [];
        console.log('Fetched groups:', fetchedGroups.length);
        setGroups(fetchedGroups);

        // Auto-open create form if no groups exist (only on initial load)
        if (fetchedGroups.length === 0 && loading) {
          setShowCreateForm(true);
        }
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, loading]);

  // Initial fetch on mount
  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // Listen for updates from LLM panel
  useEffect(() => {
    const handleDataUpdate = () => {
      console.log('Received groupsOrLimitsUpdated event in Groups component');
      fetchGroups();
    };

    window.addEventListener('groupsOrLimitsUpdated', handleDataUpdate);
    console.log('Groups component: Added event listener for groupsOrLimitsUpdated');

    return () => {
      console.log('Groups component: Removing event listener');
      window.removeEventListener('groupsOrLimitsUpdated', handleDataUpdate);
    };
  }, [fetchGroups]);

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
  const handleCreateGroup = async (name: string, items: string[]) => {
    const newGroup: Group = {
      id: `group:${Date.now()}`,
      name,
      items,
      createdAt: new Date().toISOString(),
    };

    const updatedGroups = [...groups, newGroup];
    setGroups(updatedGroups);
    await saveGroupsToFirestore(updatedGroups);
    setShowCreateForm(false);
  };

  // Delete group
  const handleDeleteGroup = async () => {
    if (!groupToDelete || !user?.uid) return;

    try {
      // Update groups
      const updatedGroups = groups.filter(g => g.id !== groupToDelete);

      // Fetch and update limits that reference this group
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        const data = userDoc.data();
        const limits = (data.limits || []) as Limit[];

        // Update limits to remove the deleted group from targets
        const updatedLimits = limits
          .map(limit => {
            // Handle target-based limits
            if (limit.targets) {
              const filteredTargets = limit.targets.filter(
                target => !(target.type === 'group' && target.id === groupToDelete)
              );

              // If no targets left, delete the limit
              if (filteredTargets.length === 0) {
                return null;
              }

              // Otherwise, keep the limit with remaining targets
              return { ...limit, targets: filteredTargets };
            }

            return limit;
          })
          .filter((limit): limit is Limit => limit !== null);

        // Save both groups and limits
        await setDoc(userDocRef, {
          groups: updatedGroups,
          limits: updatedLimits
        }, { merge: true });
      } else {
        // If no user doc exists, just save groups
        await saveGroupsToFirestore(updatedGroups);
      }

      setGroups(updatedGroups);
      setDeleteDialogOpen(false);
      setGroupToDelete(null);
    } catch (error) {
      console.error('Error deleting group:', error);
      // Still close the dialog even if there's an error
      setDeleteDialogOpen(false);
      setGroupToDelete(null);
    }
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
        <GroupForm
          allGroups={groups}
          onSave={handleCreateGroup}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {/* Groups List */}
      <div className="flex flex-col space-y-3">
        {groups.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">
            No groups yet. Create one to get started!
          </p>
        ) : (
          groups.map((group) => {
            return (
              <div
                key={group.id}
                onClick={() => onEditGroup(group.id)}
                className="bg-slate-700 hover:bg-slate-600 rounded-lg p-4 flex items-center gap-4 cursor-pointer transition-colors"
              >
                {/* Site Icons */}
                <GroupIcons group={group} />

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
                          setGroupToDelete(group.id);
                          setDeleteDialogOpen(true);
                          setOpenMenuId(null);
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="bg-gray-800 border-gray-600 text-white" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-white">Delete Group?</DialogTitle>
            <DialogDescription className="text-gray-300">
              Are you sure you want to delete this group? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteDialogOpen(false);
                setGroupToDelete(null);
              }}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
            >
              Cancel
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteGroup();
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Groups;
