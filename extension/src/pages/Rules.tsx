import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, Clock, Folder } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import type { User } from '../types/User';
import type { Rule, RuleTarget } from '../types/Rule';
import type { Group } from '../types/Group';
import { getNormalizedHostname } from '../utils/urlNormalization';
import Spinner from '../components/Spinner';
import { RuleForm } from '../components/RuleForm';
import { GroupIcons } from '../components/GroupIcons';
import { syncRulesToStorage } from '../utils/syncRulesToStorage';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

interface RulesProps {
  user: User | null;
  onNavigateToGroups: () => void;
}

/**
 * Rules management tab. Child of Popup.tsx, renders inside the Rules tab.
 * Manages hard, soft, and session time limits on URLs and groups.
 * Includes Groups modal for managing URL groups.
 */
const Rules: React.FC<RulesProps> = ({ user, onNavigateToGroups }) => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<string | null>(null);
  const isInitialLoad = useRef(true);

  // Fetch rules, groups, and URLs from Firestore
  const fetchData = useCallback(async () => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    console.log('Fetching rules and groups from Firestore...');
    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        const data = userDoc.data();
        const fetchedRules = data.rules || [];
        console.log('Fetched rules:', fetchedRules.length);
        setRules(fetchedRules);
        setGroups(data.groups || []);

        // Auto-open create form if no rules exist (only on initial load)
        if (fetchedRules.length === 0 && isInitialLoad.current) {
          setShowCreateForm(true);
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      isInitialLoad.current = false;
    }
  }, [user?.uid]);

  // Initial fetch on mount
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for updates from LLM panel
  useEffect(() => {
    const handleDataUpdate = () => {
      console.log('Received groupsOrRulesUpdated event in Rules component');
      fetchData();
    };

    window.addEventListener('groupsOrRulesUpdated', handleDataUpdate);
    console.log('Rules component: Added event listener for groupsOrRulesUpdated');

    return () => {
      console.log('Rules component: Removing event listener');
      window.removeEventListener('groupsOrRulesUpdated', handleDataUpdate);
    };
  }, [fetchData]);

  // Save rules to Firestore
  const saveRulesToFirestore = async (newRules: Rule[]) => {
    if (!user?.uid) return;

    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, { rules: newRules }, { merge: true });
      // Sync to chrome.storage for content script access
      await syncRulesToStorage(user.uid);
    } catch (error) {
      console.error('Error saving rules:', error);
      throw error;
    }
  };

  // Create or update rule
  const handleSaveRule = async (
    name: string,
    targetItems: RuleTarget[],
    ruleType: 'hard' | 'soft' | 'session',
    timeLimit: number,
    plusOnes?: number,
    plusOneDuration?: number
  ) => {
    if (editingRuleId) {
      // Update existing rule
      const updatedRules = rules.map(rule => {
        if (rule.id === editingRuleId) {
          const updatedRule: Rule = {
            ...rule,
            name: name || undefined,
            type: ruleType,
            targets: targetItems,
            timeLimit,
          };

          if (ruleType === 'soft') {
            updatedRule.plusOnes = plusOnes;
            updatedRule.plusOneDuration = plusOneDuration;
          } else {
            delete updatedRule.plusOnes;
            delete updatedRule.plusOneDuration;
          }

          return updatedRule;
        }
        return rule;
      });

      setRules(updatedRules);
      await saveRulesToFirestore(updatedRules);
    } else {
      // Create new rule
      const newRule: Rule = {
        id: `rule:${Date.now()}`,
        type: ruleType,
        targets: targetItems,
        timeLimit,
        createdAt: new Date().toISOString(),
      };

      if (name) {
        newRule.name = name;
      }

      if (ruleType === 'soft') {
        newRule.plusOnes = plusOnes;
        newRule.plusOneDuration = plusOneDuration;
      }

      const updatedRules = [...rules, newRule];
      setRules(updatedRules);
      await saveRulesToFirestore(updatedRules);
    }

    // Reset form
    setShowCreateForm(false);
    setEditingRuleId(null);
  };

  // Delete rule
  const handleDeleteRule = async () => {
    if (!ruleToDelete) return;

    const updatedRules = rules.filter(r => r.id !== ruleToDelete);
    setRules(updatedRules);
    await saveRulesToFirestore(updatedRules);
    setDeleteDialogOpen(false);
    setRuleToDelete(null);
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
      <div className="h-full w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Get the rule being edited
  const editingRule = editingRuleId ? rules.find(r => r.id === editingRuleId) : null;

  return (
    <div className="h-full w-full flex flex-col space-y-4 p-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Rules</h3>
        {!showCreateForm && (
          <div className="flex items-center gap-2">
            <button
              onClick={onNavigateToGroups}
              className="purple-button flex items-center gap-2"
              title="Manage Groups"
            >
              <Folder size={18} />
              <span className="text-sm">Groups</span>
            </button>
            <button
              onClick={() => setShowCreateForm(true)}
              className="purple-button"
              title="Create Rule"
            >
              <Plus size={20} />
            </button>
          </div>
        )}
      </div>

      {/* Create/Edit Rule Form */}
      {showCreateForm && (
        <RuleForm
          ruleId={editingRuleId || undefined}
          initialName={editingRule?.name || ''}
          initialTargetItems={editingRule?.targets || []}
          initialRuleType={editingRule?.type || 'hard'}
          initialTimeLimit={editingRule?.timeLimit || 60}
          initialPlusOnes={editingRule?.plusOnes || 3}
          initialPlusOneDuration={editingRule?.plusOneDuration || 300}
          groups={groups}
          onSave={handleSaveRule}
          onCancel={() => {
            setShowCreateForm(false);
            setEditingRuleId(null);
          }}
        />
      )}

      {/* Rules List - Hidden when form is open */}
      {!showCreateForm && (
        <div className="flex flex-col space-y-2">
        {rules.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">
            No rules set. Create one to get started!
          </p>
        ) : (
          rules.map((rule) => {
            const ruleTargets = rule.targets || [];

            return (
              <div
                key={rule.id}
                onClick={() => {
                  setEditingRuleId(rule.id);
                  setShowCreateForm(true);
                }}
                className="bg-slate-700 hover:bg-slate-600 rounded-lg p-3 flex items-center gap-3 cursor-pointer transition-colors"
              >
                {/* Icon */}
                <div className={`p-2 rounded-lg ${
                  rule.type === 'hard' ? 'bg-red-600' :
                  rule.type === 'soft' ? 'bg-yellow-600' :
                  'bg-blue-600'
                }`}>
                  <Clock size={16} className="text-white" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  {/* Separate groups and individual URLs */}
                  {(() => {
                    const groupTargets = ruleTargets.filter(t => t.type === 'group');
                    const urlTargets = ruleTargets.filter(t => t.type === 'url');

                    return (
                      <div className="space-y-1">
                        {/* Display rule name if it exists */}
                        {rule.name && (
                          <div className="text-white font-medium text-sm mb-1">
                            {rule.name}
                          </div>
                        )}

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

                        {/* Rule info */}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-gray-400">
                            {rule.type.charAt(0).toUpperCase() + rule.type.slice(1)}
                            {rule.type !== 'session' && ` • ${rule.timeLimit} min`}
                            {rule.type === 'session' && ' • Set on visit'}
                            {rule.type === 'soft' && rule.plusOnes !== undefined && ` • ${rule.plusOnes} plus ones`}
                            {rule.type === 'soft' && rule.plusOneDuration !== undefined && ` (${formatPlusOneDuration(rule.plusOneDuration)} each)`}
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
                    setRuleToDelete(rule.id);
                    setDeleteDialogOpen(true);
                  }}
                  className="text-gray-400 hover:text-red-400 transition-colors"
                  title="Delete Rule"
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
            <DialogTitle className="text-white">Delete Rule?</DialogTitle>
            <DialogDescription className="text-gray-300">
              Are you sure you want to delete this rule? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteDialogOpen(false);
                setRuleToDelete(null);
              }}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
            >
              Cancel
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteRule();
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

export default Rules;
