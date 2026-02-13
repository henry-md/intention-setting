import React, { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import type { User } from '../types/User';
import type { Group } from '../types/Group';
import { GroupForm } from '../components/GroupForm';
import Spinner from '../components/Spinner';
import { syncLimitsToStorage } from '../utils/syncLimitsToStorage';

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
      // Sync to chrome.storage for content script access
      await syncLimitsToStorage(user.uid);
    } catch (error) {
      console.error('Error saving groups:', error);
    }
  };

  // Save group with updated name and items
  const handleSaveGroup = async (name: string, items: string[]) => {
    if (!group) return;

    const updatedGroup = { ...group, name, items };
    const updatedGroups = allGroups.map(g => g.id === groupId ? updatedGroup : g);

    setGroup(updatedGroup);
    setAllGroups(updatedGroups);
    await saveGroupsToFirestore(updatedGroups);
  };

  // Handle reordering items
  const handleReorderItems = async (reorderedItems: string[]) => {
    if (!group) return;

    const updatedGroup = { ...group, items: reorderedItems };
    const updatedGroups = allGroups.map(g => g.id === groupId ? updatedGroup : g);

    setGroup(updatedGroup);
    setAllGroups(updatedGroups);
    await saveGroupsToFirestore(updatedGroups);
  };

  if (loading || !group) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col space-y-4 p-4 overflow-y-auto">
      {/* Header with Back Button */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-white">
          <ArrowLeft size={20} />
        </button>
      </div>

      {/* Group Form */}
      <GroupForm
        groupId={groupId}
        initialName={group.name}
        initialItems={group.items}
        allGroups={allGroups}
        onSave={handleSaveGroup}
        onCancel={onBack}
        enableReordering={true}
        onReorder={handleReorderItems}
      />
    </div>
  );
};

export default GroupEdit;
