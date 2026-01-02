import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Clock } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import type { User } from '../types/User';
import type { Limit, LimitUrl, LimitTarget } from '../types/Limit';
import type { Group } from '../types/Group';
import { getNormalizedHostname } from '../utils/urlNormalization';
import Spinner from '../components/Spinner';
import { LimitForm } from '../components/LimitForm';
import { GroupIcons } from '../components/GroupIcons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

interface LimitsProps {
  user: User | null;
}

/**
 * Limits management tab. Child of Popup.tsx, renders inside the Limits tab.
 * Sibling to Groups.tsx and Home.tsx (other tabs).
 * Manages hard, soft, and session time limits on URLs and groups.
 */
const Limits: React.FC<LimitsProps> = ({ user }) => {
  const [limits, setLimits] = useState<Limit[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingLimitId, setEditingLimitId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [limitToDelete, setLimitToDelete] = useState<string | null>(null);

  // Fetch limits, groups, and URLs from Firestore
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
          const fetchedLimits = data.limits || [];
          setLimits(fetchedLimits);
          setGroups(data.groups || []);

          // Auto-open create form if no limits exist
          if (fetchedLimits.length === 0) {
            setShowCreateForm(true);
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.uid]);

  // Save limits to Firestore
  const saveLimitsToFirestore = async (newLimits: Limit[]) => {
    if (!user?.uid) return;

    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, { limits: newLimits }, { merge: true });
    } catch (error) {
      console.error('Error saving limits:', error);
      throw error;
    }
  };

  // Create or update limit
  const handleSaveLimit = async (
    targetItems: LimitTarget[],
    targetUrls: LimitUrl[],
    limitType: 'hard' | 'soft' | 'session',
    timeLimit: number,
    plusOnes?: number,
    plusOneDuration?: number
  ) => {
    if (editingLimitId) {
      // Update existing limit
      const updatedLimits = limits.map(limit => {
        if (limit.id === editingLimitId) {
          const updatedLimit: Limit = {
            ...limit,
            type: limitType,
            targets: targetItems,
            urls: targetUrls,
            timeLimit,
          };

          if (limitType === 'soft') {
            updatedLimit.plusOnes = plusOnes;
            updatedLimit.plusOneDuration = plusOneDuration;
          } else {
            delete updatedLimit.plusOnes;
            delete updatedLimit.plusOneDuration;
          }

          return updatedLimit;
        }
        return limit;
      });

      setLimits(updatedLimits);
      await saveLimitsToFirestore(updatedLimits);
    } else {
      // Create new limit
      const newLimit: Limit = {
        id: `limit:${Date.now()}`,
        type: limitType,
        targets: targetItems,
        urls: targetUrls,
        timeLimit,
        createdAt: new Date().toISOString(),
      };

      if (limitType === 'soft') {
        newLimit.plusOnes = plusOnes;
        newLimit.plusOneDuration = plusOneDuration;
      }

      const updatedLimits = [...limits, newLimit];
      setLimits(updatedLimits);
      await saveLimitsToFirestore(updatedLimits);
    }

    // Reset form
    setShowCreateForm(false);
    setEditingLimitId(null);
  };

  // Delete limit
  const handleDeleteLimit = async () => {
    if (!limitToDelete) return;

    const updatedLimits = limits.filter(l => l.id !== limitToDelete);
    setLimits(updatedLimits);
    await saveLimitsToFirestore(updatedLimits);
    setDeleteDialogOpen(false);
    setLimitToDelete(null);
  };

  // Format plus-one duration from seconds to human-readable string
  const formatPlusOneDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (mins > 0 && secs > 0) {
      return `${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m`;
    } else {
      return `${secs}s`;
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Get the limit being edited
  const editingLimit = editingLimitId ? limits.find(l => l.id === editingLimitId) : null;

  return (
    <div className="h-screen w-full flex flex-col space-y-4 p-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Limits</h3>
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="purple-button"
            title="Create Limit"
          >
            <Plus size={20} />
          </button>
        )}
      </div>

      {/* Create/Edit Limit Form */}
      {showCreateForm && (
        <LimitForm
          limitId={editingLimitId || undefined}
          initialTargetItems={editingLimit?.targets || []}
          initialTargetUrls={editingLimit?.urls || []}
          initialLimitType={editingLimit?.type || 'hard'}
          initialTimeLimit={editingLimit?.timeLimit || 60}
          initialPlusOnes={editingLimit?.plusOnes || 3}
          initialPlusOneDuration={editingLimit?.plusOneDuration || 300}
          groups={groups}
          onSave={handleSaveLimit}
          onCancel={() => {
            setShowCreateForm(false);
            setEditingLimitId(null);
          }}
        />
      )}

      {/* Limits List - Hidden when form is open */}
      {!showCreateForm && (
        <div className="flex flex-col space-y-2">
        {limits.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">
            No limits set. Create one to get started!
          </p>
        ) : (
          limits.map((limit) => {
            // Handle both new and legacy limit formats
            const limitTargets = limit.targets || (limit.targetType && limit.targetId ? [{ type: limit.targetType, id: limit.targetId }] : []);

            return (
              <div
                key={limit.id}
                onClick={() => {
                  setEditingLimitId(limit.id);
                  setShowCreateForm(true);
                }}
                className="bg-slate-700 hover:bg-slate-600 rounded-lg p-3 flex items-center gap-3 cursor-pointer transition-colors"
              >
                {/* Icon */}
                <div className={`p-2 rounded-lg ${
                  limit.type === 'hard' ? 'bg-red-600' :
                  limit.type === 'soft' ? 'bg-yellow-600' :
                  'bg-blue-600'
                }`}>
                  <Clock size={16} className="text-white" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  {/* Separate groups and individual URLs */}
                  {(() => {
                    const groupTargets = limitTargets.filter(t => t.type === 'group');
                    const urlTargets = limitTargets.filter(t => t.type === 'url');

                    return (
                      <div className="space-y-1">
                        {/* Display each group on its own line */}
                        {groupTargets.map((target, idx) => {
                          const group = groups.find(g => g.id === target.id);
                          if (!group) return null;

                          return (
                            <div key={idx} className="flex items-center gap-2">
                              <GroupIcons group={group} iconSize="sm" maxIcons={5} />
                              <span className="text-white text-sm truncate">
                                {group.name}
                              </span>
                            </div>
                          );
                        })}

                        {/* Display spare URLs on a single line with plus icon */}
                        {urlTargets.length > 0 && (
                          <div className="flex items-center gap-2">
                            <Plus size={14} className="text-gray-400" />
                            <div className="flex items-center gap-1">
                              {urlTargets.map((target, idx) => (
                                <img
                                  key={idx}
                                  src={`https://www.google.com/s2/favicons?domain=${getNormalizedHostname(target.id)}&sz=32`}
                                  alt=""
                                  className="w-4 h-4"
                                  onError={(e) => {
                                    e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23666"/></svg>';
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Limit info */}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-gray-400">
                            {limit.type.charAt(0).toUpperCase() + limit.type.slice(1)}
                            {limit.type !== 'session' && ` • ${limit.timeLimit} min`}
                            {limit.type === 'session' && ' • Set on visit'}
                            {limit.type === 'soft' && limit.plusOnes !== undefined && ` • ${limit.plusOnes} plus ones`}
                            {limit.type === 'soft' && limit.plusOneDuration !== undefined && ` (${formatPlusOneDuration(limit.plusOneDuration)} each)`}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Delete Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setLimitToDelete(limit.id);
                    setDeleteDialogOpen(true);
                  }}
                  className="text-gray-400 hover:text-red-400 transition-colors"
                  title="Delete Limit"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })
        )}
      </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="bg-gray-800 border-gray-600 text-white" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-white">Delete Limit?</DialogTitle>
            <DialogDescription className="text-gray-300">
              Are you sure you want to delete this limit? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteDialogOpen(false);
                setLimitToDelete(null);
              }}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
            >
              Cancel
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteLimit();
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

export default Limits;
